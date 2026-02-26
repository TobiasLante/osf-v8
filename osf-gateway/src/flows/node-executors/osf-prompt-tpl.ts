import { NodeExecutor } from './types';

/**
 * Execute an osf-prompt-tpl node.
 * Simple template engine with ${context} and ${input} variable replacement.
 */
export const executeOsfPromptTpl: NodeExecutor = async (input) => {
  const template = input.config.template || '';

  const result = template
    .replace(/\$\{context\}/g, input.previousOutput || '')
    .replace(/\$\{input\}/g, input.previousOutput || '');

  return { output: result };
};
