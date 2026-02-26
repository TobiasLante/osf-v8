import { NodeExecutor, tryParseJson } from './types';

/**
 * Executor for native Node-RED 'template' node.
 * Simple Mustache-style template rendering: {{payload}}, {{payload.field}}, etc.
 */
export const executeNativeTemplate: NodeExecutor = async (input) => {
  const template: string = input.config.template || '';
  const syntax = input.config.syntax || 'mustache';

  // Use upstream msg if available
  const msg: any = input.msg
    ? { ...input.msg }
    : { payload: tryParseJson(input.previousOutput) };

  if (syntax === 'plain') {
    msg.payload = template;
    return { output: template, msg };
  }

  // Simple Mustache replacement: {{path.to.value}}
  const result = template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const parts = path.trim().split('.');
    let value: any = msg;
    for (const p of parts) {
      if (value === undefined || value === null) return '';
      value = value[p];
    }
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });

  msg.payload = result;
  return { output: result, msg };
};
