import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { callLlm, getLlmConfig, ChatMessage, ToolCall, LlmConfig } from './llm-client';
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
import { callLlmJson, runDynamicDiscussion, emitSSE } from '../agents/discussion-runner';
import { loadPrompt } from '../prompt-loader';

const router = Router();

// ─── Skills-based Tool Selector ─────────────────────────────────────────
// Reads skills.md, asks LLM which tools are relevant for the user's question,
// returns only those tool schemas (instead of all 148).

let cachedSkills: string | null = null;

function getSkills(): string {
  if (!cachedSkills) {
    cachedSkills = loadPrompt('skills');
  }
  return cachedSkills;
}

async function selectTools(
  message: string,
  allTools: any[],
  llmConfig: LlmConfig,
  userId: string,
): Promise<any[]> {
  const skills = getSkills();
  if (!skills) {
    logger.warn('skills.md not found, using all tools');
    return allTools;
  }

  const allToolNames = allTools.map((t: any) => t.function.name);

  try {
    const result = await callLlmJson<{ tools: string[] }>(
      [
        { role: 'system', content: 'You are a tool selector for a manufacturing AI assistant. Given the user\'s question and the skills reference, select 10-20 relevant tools. Return ONLY a JSON object.' },
        { role: 'user', content: `SKILLS REFERENCE:\n${skills}\n\nUSER QUESTION: "${message}"\n\nSelect 10-20 tools that are needed to answer this question. Include tools for related domains if the question spans multiple areas.\n\nRESPONSE FORMAT: Pure JSON, NO Markdown.\n{"tools": ["tool_name_1", "tool_name_2", ...]}` },
      ],
      llmConfig,
      userId,
    );

    // Filter to only tools that actually exist
    const selectedNames = (result.tools || []).filter((name: string) => allToolNames.includes(name));

    if (selectedNames.length < 2) {
      logger.warn({ selectedNames, message: message.slice(0, 80) }, 'Tool selector returned too few tools, using all');
      return allTools;
    }

    logger.info({ count: selectedNames.length, tools: selectedNames, message: message.slice(0, 80) }, 'Skills-based tool selection');
    return allTools.filter((t: any) => selectedNames.includes(t.function.name));
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Tool selector failed, using all tools');
    return allTools;
  }
}

function getSystemPrompt(language?: string): string {
  const langInstruction = language === 'en'
    ? '\n\nIMPORTANT: Always respond in English.'
    : language === 'de'
    ? '\n\nWICHTIG: Antworte immer auf Deutsch.'
    : '\n\nAlways respond in the same language as the user\'s message.';

  const skills = loadPrompt('chat-skills');
  return skills + langInstruction;
}

// ─── Intent Classifier ──────────────────────────────────────────────────

async function classifyIntent(
  message: string,
  freeLlmConfig: LlmConfig,
  userId: string,
): Promise<boolean> {
  const classifierPrompt = `Klassifiziere die folgende User-Frage:

"${message}"

EINFACH (complex=false): Fragen die mit 1-3 Tool-Aufrufen beantwortet werden können. Konkrete Datenpunkte, Status-Abfragen, einfache Vergleiche zweier Werte, Auflistungen.
Beispiele EINFACH:
- "Wie ist der Status/OEE von Maschine X?" → 1 Tool-Aufruf
- "Wie viel Bestand haben wir von Artikel X?" → 1 Tool-Aufruf
- "Gibt es SPC-Alarme?" → 1 Tool-Aufruf
- "Welche 5 Materialien haben die geringste Reichweite?" → 1 Tool-Aufruf
- "Welche Kunden haben die schlechteste OTD?" → 1 Tool-Aufruf
- "Vergleiche OEE von Maschine 1001 und 1002" → 2 Tool-Aufrufe
- "Gibt es Aufträge die hinter dem Zeitplan liegen?" → 1-2 Tool-Aufrufe
- "Hallo", "Was kannst du?" → kein Tool nötig

KOMPLEX (complex=true): NUR wenn die Frage eine TIEFGEHENDE ANALYSE über MEHRERE BEREICHE erfordert — Ursachenforschung, strategische Optimierung, Cross-Domain-Zusammenhänge, What-If-Szenarien, Schichtberichte.
Beispiele KOMPLEX:
- "Erstelle einen kompletten Schichtbericht" → braucht 10+ Tools, Synthese
- "Was passiert wenn Maschine X ausfällt?" → Impact-Analyse über alle Bereiche
- "Wo sind die 3 größten Risiken und wie bewerten wir sie?" → strategische Analyse
- "Wie können wir die Liefertreue von 70% auf 95% steigern?" → Optimierungsstrategie
- "Erstelle ein Executive Summary der Fabrik" → Cross-Domain-Synthese

ANTWORT-FORMAT: Reines JSON, KEIN Markdown.
{"complex": true}  oder  {"complex": false}

WICHTIG: Im Zweifel eher EINFACH. Nur echte Cross-Domain-Analysen und strategische Fragen sind komplex.`;

  try {
    const result = await callLlmJson<{ complex: boolean }>(
      [
        { role: 'system', content: 'Du bist ein Intent-Classifier für eine Manufacturing-AI. Antworte nur mit JSON.' },
        { role: 'user', content: classifierPrompt },
      ],
      freeLlmConfig,
      userId,
    );
    return result.complex === true;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Intent classifier failed, defaulting to simple');
    return false;
  }
}

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
  const { message, sessionId: reqSessionId, language } = req.body;
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

  // SSE headers (explicit CORS — validate origin against whitelist)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const origin = req.headers.origin;
  const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
  const SSE_ALLOWED_ORIGINS = new Set([
    'https://openshopfloor.zeroguess.ai',
    'https://osf-api.zeroguess.ai',
    'https://demo.zeroguess.ai',
    'http://localhost:3000',
    'http://localhost:3001',
    ...EXTRA_ORIGINS,
  ]);
  if (origin && SSE_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.flushHeaders();

  // ── Abort controller: cancelled when client disconnects or pipeline times out ──
  const pipelineAbort = new AbortController();
  const PIPELINE_TIMEOUT = 15 * 60_000; // 15min max for entire pipeline (discussions need ~10min)
  const pipelineTimer = setTimeout(() => {
    logger.warn({ userId: req.user!.userId }, 'Chat pipeline timeout (15min)');
    pipelineAbort.abort();
  }, PIPELINE_TIMEOUT);

  res.on('close', () => {
    if (!res.writableEnded) {
      logger.info({ userId: req.user!.userId }, 'Client disconnected, aborting pipeline');
      pipelineAbort.abort();
    }
  });

  // Heartbeat to keep Cloudflare alive during long-running discussions (CF drops idle SSE after ~100s)
  const cfHeartbeat = setInterval(() => {
    if (pipelineAbort.signal.aborted) return;
    try { res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`); } catch { /* closed */ }
  }, 15_000);

  try {
    // Create or use session
    let sessionId = reqSessionId;
    if (!sessionId) {
      sessionId = await createSession(req.user!.userId, message.slice(0, 80));
      res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);
    }

    // Save user message
    await saveMessage(sessionId, 'user', message);

    // Load all tools, history, and LLM configs in parallel
    const freeLlmConfig = await getLlmConfig(req.user!.userId, 'free');
    const [allTools, history, llmConfig] = await Promise.all([
      getMcpTools(),
      getSessionMessages(sessionId, req.user!.userId, 20),
      getLlmConfig(req.user!.userId, tier),
    ]);

    // Skills-based tool selection: LLM picks 10-20 relevant tools from skills.md
    const tools = await selectTools(message, allTools, freeLlmConfig, req.user!.userId);

    // Build messages
    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt(language) },
      ...history.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      })),
    ];

    // ── Intent Classification: simple vs complex ──
    // Always use free tier (14B) for classification — fast, consistent, independent of user tier
    const isComplex = await classifyIntent(message, freeLlmConfig, req.user!.userId);

    if (isComplex) {
      logger.info({ userId: req.user!.userId, message: message.slice(0, 80) }, 'Complex intent → dynamic discussion');

      try {
        const finalText = await runDynamicDiscussion(
          message,
          req.user!.userId,
          tier,
          sessionId,
          res,
          pipelineAbort.signal,
          language,
        );

        // Stream final text as content chunks
        if (!pipelineAbort.signal.aborted) {
          const chunkSize = 20;
          for (let i = 0; i < finalText.length; i += chunkSize) {
            const chunk = finalText.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
          }

          // Save assistant message
          await saveMessage(sessionId, 'assistant', finalText);

          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        }
        clearTimeout(pipelineTimer);
        clearInterval(cfHeartbeat);
        res.end();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Dynamic discussion error');
        if (!res.writableEnded) {
          const msg = pipelineAbort.signal.aborted
            ? (language === 'en' ? 'Pipeline aborted (timeout or connection lost).' : 'Pipeline abgebrochen (Timeout oder Verbindung getrennt).')
            : (language === 'en' ? 'Multi-agent discussion failed. Please try again.' : 'Multi-Agent-Diskussion fehlgeschlagen. Versuche es erneut.');
          res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        }
        clearTimeout(pipelineTimer);
        clearInterval(cfHeartbeat);
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // ── Simple intent → normal tool-loop flow ──

    // Tool loop (max 5 iterations)
    let fullContent = '';
    const allToolCalls: any[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await callLlm(messages, tools, llmConfig, req.user!.userId);

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
    clearTimeout(pipelineTimer);
    clearInterval(cfHeartbeat);
    res.end();
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat completion error');
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred processing your request' })}\n\n`);
    }
    clearTimeout(pipelineTimer);
    clearInterval(cfHeartbeat);
    if (!res.writableEnded) res.end();
  }
});

export default router;
