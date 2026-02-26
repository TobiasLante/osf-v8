import { AgentDef } from './registry';
import { callLlm, getLlmConfig, ChatMessage, LlmConfig } from '../chat/llm-client';
import { getMcpTools, callMcpTool } from '../chat/tool-executor';
import { pool } from '../db/pool';
import { Response } from 'express';
import { logger } from '../logger';

export async function runAgent(
  agent: AgentDef,
  userId: string,
  tier: string,
  res: Response
): Promise<void> {
  // Create agent run record
  const runResult = await pool.query(
    `INSERT INTO agent_runs (user_id, agent_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, agent.id]
  );
  const runId = runResult.rows[0].id;

  res.write(`data: ${JSON.stringify({ type: 'run_start', runId, agent: agent.id })}\n\n`);

  try {
    // Get all MCP tools, filter to agent's allowed tools
    const [allTools, llmConfig] = await Promise.all([
      getMcpTools(),
      getLlmConfig(userId, tier),
    ]);
    const agentTools = allTools.filter((t: any) =>
      agent.tools.includes(t.function.name)
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: agent.systemPrompt },
      { role: 'user', content: 'Please run your full analysis now.' },
    ];

    const allToolCalls: any[] = [];
    let finalContent = '';

    // Agent loop (max 10 iterations for strategic agents)
    const maxIterations = agent.type === 'strategic' ? 10 : 6;

    for (let i = 0; i < maxIterations; i++) {
      const response = await callLlm(messages, agentTools, llmConfig);

      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
        });

        for (const tc of response.tool_calls) {
          const toolName = tc.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch { /* empty */ }

          res.write(`data: ${JSON.stringify({ type: 'tool_start', name: toolName, arguments: toolArgs })}\n\n`);

          const result = await callMcpTool(toolName, toolArgs);

          res.write(`data: ${JSON.stringify({ type: 'tool_result', name: toolName, result })}\n\n`);

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
        res.write(`data: ${JSON.stringify({ type: 'content', text: finalContent.slice(j, j + chunkSize) })}\n\n`);
      }

      break;
    }

    // Update run record
    await pool.query(
      `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ content: finalContent, tool_calls: allToolCalls }), runId]
    );

    res.write(`data: ${JSON.stringify({ type: 'done', runId })}\n\n`);
  } catch (err: any) {
    logger.error({ err: err.message, agentId: agent.id, userId }, 'Agent run error');

    await pool.query(
      `UPDATE agent_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ error: err.message }), runId]
    );

    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Agent execution failed' })}\n\n`);
  }
}
