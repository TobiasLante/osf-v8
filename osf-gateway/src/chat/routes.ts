import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { callLlm, getLlmConfig, ChatMessage, ToolCall } from './llm-client';
import { getMcpTools, callMcpTool } from './tool-executor';
import {
  createSession,
  getUserSessions,
  getSessionMessages,
  saveMessage,
  deleteSession,
  verifySessionOwnership,
} from './session-store';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';

const router = Router();

const SYSTEM_PROMPT = `You are an AI factory assistant for OpenShopFloor. You have access to a live manufacturing simulation with real-time data through MCP tools.

You can query machine status, OEE metrics, stock levels, work orders, quality data, energy consumption, and much more. When the user asks about factory operations, use the available tools to get real data.

Always respond in the same language as the user's message. Be concise and data-driven. When showing metrics, format numbers clearly. If a tool call fails, explain what happened and suggest alternatives.`;

// GET /chat/sessions — list user sessions
router.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessions = await getUserSessions(req.user!.userId);
    res.json({ sessions });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat sessions error');
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// POST /chat/sessions — create new session
router.post('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = await createSession(req.user!.userId, req.body.title);
    res.status(201).json({ sessionId });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Create session error');
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /chat/sessions/:id/messages — get session messages (ownership enforced)
router.get('/sessions/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const messages = await getSessionMessages(req.params.id, req.user!.userId);
    res.json({ messages });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Messages error');
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// DELETE /chat/sessions/:id (ownership enforced)
router.delete('/sessions/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteSession(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// POST /chat/completions — SSE streaming chat with tool loop
router.post('/completions', requireAuth, async (req: Request, res: Response) => {
  const { message, sessionId: reqSessionId } = req.body;
  if (!message || typeof message !== 'string' || message.length > 10000) {
    res.status(400).json({ error: 'Message required (max 10000 chars)' });
    return;
  }

  const tier = req.user!.tier || 'free';

  // Rate limit check
  const rateLimitKey = `llm:${req.user!.userId}`;
  const limits: Record<string, number> = { free: 5, premium: 20, 'own-key': 50 };
  if (!checkRateLimit(rateLimitKey, limits[tier] || 5)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
    return;
  }

  // Verify session ownership if sessionId provided
  if (reqSessionId) {
    const owns = await verifySessionOwnership(reqSessionId, req.user!.userId);
    if (!owns) {
      res.status(403).json({ error: 'Session not found or access denied' });
      return;
    }
  }

  // SSE headers (explicit CORS for proxies/browsers that need it on the stream response)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.flushHeaders();

  try {
    // Create or use session
    let sessionId = reqSessionId;
    if (!sessionId) {
      sessionId = await createSession(req.user!.userId, message.slice(0, 80));
      res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);
    }

    // Save user message
    await saveMessage(sessionId, 'user', message);

    // Load tools, history, and LLM config
    const [tools, history, llmConfig] = await Promise.all([
      getMcpTools(),
      getSessionMessages(sessionId, req.user!.userId, 20),
      getLlmConfig(req.user!.userId, tier),
    ]);

    // Build messages
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      })),
    ];

    // Tool loop (max 5 iterations)
    let fullContent = '';
    const allToolCalls: any[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await callLlm(messages, tools, llmConfig);

      // If LLM returns tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
        });

        // Execute each tool call
        for (const tc of response.tool_calls) {
          const toolName = tc.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch { /* empty args */ }

          // Rate limit tools
          const toolLimitKey = `tool:${req.user!.userId}`;
          const toolLimits: Record<string, number> = { free: 30, premium: 100, 'own-key': 100 };
          if (!checkRateLimit(toolLimitKey, toolLimits[tier] || 30)) {
            const errResult = JSON.stringify({ error: 'Tool rate limit exceeded' });
            messages.push({ role: 'tool', content: errResult, tool_call_id: tc.id });
            allToolCalls.push({ name: toolName, arguments: toolArgs, result: errResult, error: true });
            continue;
          }

          res.write(`data: ${JSON.stringify({ type: 'tool_start', name: toolName, arguments: toolArgs })}\n\n`);

          // Emit KG traversal start for knowledge graph tools
          if (toolName.startsWith('kg_')) {
            res.write(`data: ${JSON.stringify({
              type: 'kg_traversal_start',
              timestamp: new Date().toISOString(),
              scenarioName: toolName.replace('kg_', '').replace(/_/g, ' '),
              entityId: (toolArgs as any).entity_id || (toolArgs as any).machine_id || (toolArgs as any).order_id || '',
            })}\n\n`);
          }

          const result = await callMcpTool(toolName, toolArgs);

          // Emit KG traversal results for knowledge graph tools
          if (toolName.startsWith('kg_')) {
            try {
              const parsed = JSON.parse(result);
              const nodes = parsed.nodes || parsed.affected_nodes || parsed.path || [];
              const edges = parsed.edges || parsed.relationships || parsed.connections || [];
              if (nodes.length > 0 || edges.length > 0) {
                res.write(`data: ${JSON.stringify({
                  type: 'kg_nodes_discovered',
                  timestamp: new Date().toISOString(),
                  nodes: Array.isArray(nodes) ? nodes.map((n: any) => ({ id: n.id || n.node_id || n, type: n.type || n.label || 'node', label: n.name || n.label || n.id || String(n) })) : [],
                  edges: Array.isArray(edges) ? edges.map((e: any) => ({ source: e.source || e.from, target: e.target || e.to, type: e.type || e.relation || 'related' })) : [],
                  centerEntity: { id: (toolArgs as any).entity_id || (toolArgs as any).machine_id || (toolArgs as any).order_id || toolName },
                })}\n\n`);
              }
              res.write(`data: ${JSON.stringify({
                type: 'kg_traversal_end',
                timestamp: new Date().toISOString(),
                totalNodes: Array.isArray(nodes) ? nodes.length : 0,
                totalEdges: Array.isArray(edges) ? edges.length : 0,
              })}\n\n`);
            } catch { /* result not JSON, skip KG events */ }
          }

          res.write(`data: ${JSON.stringify({ type: 'tool_result', name: toolName, result })}\n\n`);

          messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
          allToolCalls.push({ name: toolName, arguments: toolArgs, result });
        }

        // Continue loop — LLM will process tool results
        continue;
      }

      // No tool calls — we have final content
      fullContent = response.content || '';
      break;
    }

    // Stream the final text content
    if (fullContent) {
      const chunkSize = 20;
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        const chunk = fullContent.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
      }
    }

    // Save assistant message
    await saveMessage(sessionId, 'assistant', fullContent, allToolCalls.length > 0 ? allToolCalls : undefined);

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat completion error');
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred processing your request' })}\n\n`);
    res.end();
  }
});

export default router;
