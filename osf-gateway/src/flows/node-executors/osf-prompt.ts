import { NodeExecutor } from './types';
import { callLlm } from '../../chat/llm-client';

export const executeOsfPrompt: NodeExecutor = async (input) => {
  const promptTemplate = input.config.prompt || '{{input}}';
  const prompt = promptTemplate.replace(/\{\{input\}\}/g, input.previousOutput || '');

  const response = await callLlm(
    [{ role: 'user', content: prompt }],
    undefined,
    input.llmConfig,
    input.userId
  );

  return { output: response.content || '' };
};
