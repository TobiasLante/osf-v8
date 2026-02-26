import { NodeExecutor } from './types';

/**
 * Sanitize a string to be used as a JSON key.
 */
function sanitizeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Execute an osf-context node.
 * Aggregates all upstream outputs into a single merged JSON object.
 * Keys are derived from upstream node labels (sanitized) or fallback to input_<id>.
 */
export const executeOsfContext: NodeExecutor = async (input) => {
  const keyOverrides: Record<string, string> = input.config.keyOverrides || {};
  const merged: Record<string, any> = {};

  for (const upstream of input.allInputs ?? []) {
    // Use override key if configured, otherwise sanitize the label
    const key = keyOverrides[upstream.nodeId]
      || sanitizeKey(upstream.nodeLabel)
      || `input_${upstream.nodeId.slice(0, 6)}`;

    try {
      merged[key] = JSON.parse(upstream.output);
    } catch {
      merged[key] = upstream.output;
    }
  }

  // If no upstream inputs, pass through previousOutput
  if (Object.keys(merged).length === 0 && input.previousOutput) {
    try {
      return { output: input.previousOutput };
    } catch {
      return { output: input.previousOutput };
    }
  }

  return { output: JSON.stringify(merged) };
};
