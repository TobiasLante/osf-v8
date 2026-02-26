import { ChainDef } from './registry';
import { evaluateCondition } from './conditions';
import { getAgent } from '../agents/registry';
import { callLlm, getLlmConfig, ChatMessage } from '../chat/llm-client';
import { getMcpTools, callMcpTool } from '../chat/tool-executor';
import { pool } from '../db/pool';
import { Response } from 'express';
import { logger } from '../logger';

export async function runChain(
  chain: ChainDef,
  userId: string,
  tier: string,
  res: Response
): Promise<void> {
  // Create chain run record
  const runResult = await pool.query(
    `INSERT INTO chain_runs (user_id, chain_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, chain.id]
  );
  const runId = runResult.rows[0].id;

  res.write(`data: ${JSON.stringify({ type: 'chain_start', runId, chain: chain.id, totalSteps: chain.steps.length })}\n\n`);

  const stepResults: Array<{ agentId: string; label?: string; content: string; skipped: boolean; reason?: string }> = [];

  try {
    const llmConfig = await getLlmConfig(userId, tier);
    let previousResult = '';

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      const stepNum = i + 1;

      // Evaluate condition
      const condition = step.condition || 'always';
      res.write(`data: ${JSON.stringify({ type: 'condition_check', step: stepNum, condition, agentId: step.agentId })}\n\n`);

      const condResult = await evaluateCondition(condition, previousResult);

      if (!condResult.met) {
        res.write(`data: ${JSON.stringify({ type: 'step_skipped', step: stepNum, agentId: step.agentId, label: step.label, reason: condResult.reason })}\n\n`);
        stepResults.push({ agentId: step.agentId, label: step.label, content: '', skipped: true, reason: condResult.reason });
        continue;
      }

      // Resolve agent
      const agent = await getAgent(step.agentId);
      if (!agent) {
        const errMsg = `Agent "${step.agentId}" not found`;
        res.write(`data: ${JSON.stringify({ type: 'step_error', step: stepNum, agentId: step.agentId, error: errMsg })}\n\n`);
        stepResults.push({ agentId: step.agentId, label: step.label, content: '', skipped: true, reason: errMsg });
        continue;
      }

      res.write(`data: ${JSON.stringify({ type: 'step_start', step: stepNum, agentId: step.agentId, label: step.label || agent.name, conditionReason: condResult.reason })}\n\n`);

      // Build messages with optional context from previous step
      const contextMsg = step.passContext && previousResult
        ? `\n\n--- Context from previous agent ---\n${previousResult}\n--- End context ---\n\nPlease run your full analysis now, taking the above context into account.`
        : 'Please run your full analysis now.';

      const allTools = await getMcpTools();
      const agentTools = allTools.filter((t: any) => agent.tools.includes(t.function.name));

      const messages: ChatMessage[] = [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: contextMsg },
      ];

      const allToolCalls: any[] = [];
      let finalContent = '';
      const maxIterations = agent.type === 'strategic' ? 10 : 6;

      // Agent loop
      for (let j = 0; j < maxIterations; j++) {
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
            try { toolArgs = JSON.parse(tc.function.arguments); } catch { /* empty */ }

            res.write(`data: ${JSON.stringify({ type: 'tool_start', step: stepNum, name: toolName, arguments: toolArgs })}\n\n`);

            const result = await callMcpTool(toolName, toolArgs);

            res.write(`data: ${JSON.stringify({ type: 'tool_result', step: stepNum, name: toolName, result })}\n\n`);

            messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
            allToolCalls.push({ name: toolName, arguments: toolArgs, result });
          }
          continue;
        }

        finalContent = response.content || '';
        break;
      }

      // Stream content
      const chunkSize = 30;
      for (let k = 0; k < finalContent.length; k += chunkSize) {
        res.write(`data: ${JSON.stringify({ type: 'step_content', step: stepNum, text: finalContent.slice(k, k + chunkSize) })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'step_done', step: stepNum, agentId: step.agentId, toolCallCount: allToolCalls.length })}\n\n`);

      stepResults.push({ agentId: step.agentId, label: step.label, content: finalContent, skipped: false });
      previousResult = finalContent;
    }

    // Update run record
    await pool.query(
      `UPDATE chain_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ steps: stepResults }), runId]
    );

    res.write(`data: ${JSON.stringify({ type: 'chain_complete', runId, stepsExecuted: stepResults.filter(s => !s.skipped).length, stepsSkipped: stepResults.filter(s => s.skipped).length })}\n\n`);
  } catch (err: any) {
    logger.error({ err: err.message, chainId: chain.id, userId }, 'Chain run error');

    await pool.query(
      `UPDATE chain_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ error: err.message, steps: stepResults }), runId]
    );

    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Chain execution failed' })}\n\n`);
  }
}
