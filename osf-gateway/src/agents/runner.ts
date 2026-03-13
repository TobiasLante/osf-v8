import { AgentDef } from './registry';
import { callLlm, getLlmConfig, ChatMessage, LlmConfig } from '../chat/llm-client';
import { getMcpTools, callMcpTool } from '../chat/tool-executor';
import { pool } from '../db/pool';
import { Response } from 'express';
import { logger } from '../logger';
import { config } from '../config';

export interface RunAgentOptions {
  userMessage?: string;
  params?: Record<string, unknown>;
  llmProvider?: string;
}

export async function runAgent(
  agent: AgentDef,
  userId: string,
  tier: string,
  res: Response,
  options?: RunAgentOptions
): Promise<void> {
  // Abort controller: 15min max runtime + abort on client disconnect
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900_000); // 15min max
  res.on('close', () => controller.abort());

  // Heartbeat to keep Cloudflare alive (CF drops idle SSE after ~100s)
  const heartbeat = setInterval(() => {
    if (controller.signal.aborted || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    try { res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`); } catch { /* closed */ }
  }, config.pipeline.heartbeatIntervalMs);

  function safeWrite(res: Response, data: string): boolean {
    if (res.writableEnded) return false;
    try { res.write(data); return true; } catch { return false; }
  }

  // Create agent run record (skip for anonymous/public runs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isAnonymous = !userId || !UUID_RE.test(userId) || userId === '00000000-0000-0000-0000-000000000000';
  let runId: string | null = null;
  if (!isAnonymous) {
    const runResult = await pool.query(
      `INSERT INTO agent_runs (user_id, agent_id, status) VALUES ($1, $2, 'running') RETURNING id`,
      [userId, agent.id]
    );
    runId = runResult.rows[0].id;
  }

  safeWrite(res, `data: ${JSON.stringify({ type: 'run_start', runId, agent: agent.id })}\n\n`);

  try {
    // Get all MCP tools, filter to agent's allowed tools
    // Strategic agents (e.g. impact-analysis) use premium LLM (5001) for better multi-step tool calling + larger context
    const effectiveTier = agent.type === 'strategic' ? 'premium' : tier;
    const [allTools, llmConfig] = await Promise.all([
      getMcpTools(),
      getLlmConfig(userId, effectiveTier),
    ]);
    const agentTools = allTools.filter((t: any) =>
      agent.tools.includes(t.function.name)
    );

    // Build user message — use custom message if provided, append params if relevant
    let userMsg = options?.userMessage || 'Please run your full analysis now.';
    const language = options?.params?.language as string | undefined;
    if (options?.params) {
      const relevantParams = Object.entries(options.params)
        .filter(([k]) => !['sessionId', 'language'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      if (relevantParams) userMsg += `\n\n${relevantParams}`;
    }

    // Append language instruction to system prompt
    let systemPrompt = agent.systemPrompt;
    if (language === 'en') {
      systemPrompt += '\n\nIMPORTANT: Always respond in English.';
    } else if (language === 'de') {
      systemPrompt += '\n\nWICHTIG: Antworte immer auf Deutsch.';
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ];

    const allToolCalls: any[] = [];
    let finalContent = '';

    // Agent loop (max 10 iterations for strategic agents)
    const maxIterations = agent.type === 'strategic' ? 10 : 6;

    for (let i = 0; i < maxIterations; i++) {
      // Abort check at start of each iteration
      if (controller.signal.aborted) {
        logger.info({ agentId: agent.id, iteration: i }, 'Agent run aborted');
        break;
      }

      // Send heartbeat every 15s to keep SSE connection alive (Cloudflare kills idle connections after ~100s)
      const heartbeat = setInterval(() => {
        safeWrite(res, `data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
      }, 15_000);
      let response;
      try {
        response = await callLlm(messages, agentTools, llmConfig, undefined, controller.signal);
      } finally {
        clearInterval(heartbeat);
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
        });

        for (const tc of response.tool_calls) {
          if (controller.signal.aborted) break;

          const toolName = tc.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch { logger.debug({ toolName: tc.function.name }, 'Failed to parse tool arguments'); }

          safeWrite(res, `data: ${JSON.stringify({ type: 'tool_start', name: toolName, arguments: toolArgs })}\n\n`);

          const rawResult = await callMcpTool(toolName, toolArgs);
          // Truncate extremely large tool results to avoid context overflow
          const result = rawResult.length > config.truncation.agentToolResult ? rawResult.slice(0, config.truncation.agentToolResult) + '\n... (truncated)' : rawResult;

          safeWrite(res, `data: ${JSON.stringify({ type: 'tool_result', name: toolName, result })}\n\n`);

          messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
          allToolCalls.push({ name: toolName, arguments: toolArgs, result });
        }

        continue;
      }

      // Final content
      finalContent = response.content || '';

      // Stream content
      const chunkSize = 30;
      for (let j = 0; j < finalContent.length; j += chunkSize) {
        safeWrite(res, `data: ${JSON.stringify({ type: 'content', text: finalContent.slice(j, j + chunkSize) })}\n\n`);
      }

      break;
    }

    // Update run record
    if (runId) {
      await pool.query(
        `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ content: finalContent, tool_calls: allToolCalls }), runId]
      );
    }

    safeWrite(res, `data: ${JSON.stringify({ type: 'done', runId })}\n\n`);
  } catch (err: any) {
    logger.error({ err: err.message, agentId: agent.id, userId }, 'Agent run error');

    if (runId) {
      await pool.query(
        `UPDATE agent_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: err.message }), runId]
      ).catch(dbErr => logger.error({ err: dbErr.message }, 'Failed to update agent_runs on error'));
    }

    safeWrite(res, `data: ${JSON.stringify({ type: 'error', message: 'Agent execution failed' })}\n\n`);
    if (!res.writableEnded) res.end();
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}
