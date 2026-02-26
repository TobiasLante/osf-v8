import { NodeExecutor } from './types';
import { callLlm, ChatMessage, LlmConfig } from '../../chat/llm-client';
import { logger } from '../../logger';

/**
 * Execute an osf-llm node.
 * Per-node LLM configuration with dual inputs:
 *  - Memory/Context (from osf-context) → system message
 *  - Prompt/User (from osf-prompt-tpl) → user message
 * Falls back to single input as user message.
 */
export const executeOsfLlm: NodeExecutor = async (input) => {
  // Identify inputs by upstream node type
  const memoryInput = input.allInputs?.find(u => u.nodeType === 'osf-context');
  const promptInput = input.allInputs?.find(u => u.nodeType === 'osf-prompt-tpl');

  const memory = memoryInput ? memoryInput.output : '';
  const userPrompt = promptInput ? promptInput.output : input.previousOutput;

  if (!userPrompt && !memory) {
    throw new Error('osf-llm: no input received');
  }

  const messages: ChatMessage[] = [];
  if (memory) {
    messages.push({ role: 'system', content: memory });
  }
  messages.push({ role: 'user', content: userPrompt || '' });

  // Build per-node LLM config, falling back to global config
  const llmUrl = input.config.llmUrl || input.llmConfig.baseUrl;
  const llmModel = input.config.llmModel || input.llmConfig.model;
  const temperature = parseFloat(input.config.temperature) || 0.3;
  const jsonMode = input.config.jsonMode === true || input.config.jsonMode === 'true';

  const nodeConfig: LlmConfig = {
    baseUrl: llmUrl,
    model: llmModel,
    apiKey: input.config.llmApiKey || input.llmConfig.apiKey,
  };

  // If JSON mode, add instruction
  if (jsonMode) {
    const lastMsg = messages[messages.length - 1];
    lastMsg.content = (lastMsg.content || '') +
      '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences. Just the raw JSON.';
  }

  logger.info({
    nodeId: input.config.id,
    model: llmModel,
    url: llmUrl,
    messageCount: messages.length,
    jsonMode,
  }, 'osf-llm calling LLM');

  const response = await callLlm(messages, undefined, nodeConfig, input.userId);
  let content = response.content || '';

  if (jsonMode) {
    // Strip code fences if present
    content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  }

  return { output: content };
};
