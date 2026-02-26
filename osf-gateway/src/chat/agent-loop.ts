import { callLlm, ChatMessage, LlmConfig, ToolCall } from './llm-client';
import { getMcpTools, callMcpTool } from './tool-executor';

export interface AgentLoopParams {
  systemPrompt: string;
  userMessage: string;
  tools: string[];          // Tool name whitelist
  llmConfig: LlmConfig;
  maxIterations: number;
  userId?: string;
  onToolCall?: (name: string, args: Record<string, unknown>, result: string) => void;
}

export interface AgentLoopResult {
  content: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; result: string }>;
}

/**
 * Shared agent loop: LLM + tool calling cycle.
 * Used by agent runner, chain runner, and flow engine.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { systemPrompt, userMessage, tools: toolWhitelist, llmConfig, maxIterations, userId, onToolCall } = params;

  // Get MCP tools filtered to whitelist
  const allTools = await getMcpTools();
  const agentTools = allTools.filter((t: any) => toolWhitelist.includes(t.function.name));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const allToolCalls: AgentLoopResult['toolCalls'] = [];
  let finalContent = '';

  for (let i = 0; i < maxIterations; i++) {
    const response = await callLlm(messages, agentTools, llmConfig, userId);

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

        const result = await callMcpTool(toolName, toolArgs);

        if (onToolCall) onToolCall(toolName, toolArgs, result);

        messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
        allToolCalls.push({ name: toolName, arguments: toolArgs, result });
      }
      continue;
    }

    finalContent = response.content || '';
    break;
  }

  return { content: finalContent, toolCalls: allToolCalls };
}
