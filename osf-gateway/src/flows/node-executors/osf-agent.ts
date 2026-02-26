import { NodeExecutor } from './types';
import { getAgent } from '../../agents/registry';
import { runAgentLoop } from '../../chat/agent-loop';

export const executeOsfAgent: NodeExecutor = async (input) => {
  const agentId = input.config.agentId;
  if (!agentId) throw new Error('osf-agent: agentId not configured');

  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`osf-agent: agent "${agentId}" not found`);

  const passContext = input.config.passContext !== false;
  const maxIterations = input.config.maxIterations || 6;

  const userMessage = passContext && input.previousOutput
    ? `--- Context from previous step ---\n${input.previousOutput}\n--- End context ---\n\nPlease run your full analysis now, taking the above context into account.`
    : 'Please run your full analysis now.';

  const result = await runAgentLoop({
    systemPrompt: agent.systemPrompt,
    userMessage,
    tools: agent.tools,
    llmConfig: input.llmConfig,
    maxIterations,
    userId: input.userId,
  });

  return { output: result.content };
};
