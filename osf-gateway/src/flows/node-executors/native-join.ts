import { NodeExecutor, tryParseJson } from './types';

/**
 * Executor for native Node-RED 'join' node.
 * Joins all upstream inputs into a single array or object.
 */
export const executeNativeJoin: NodeExecutor = async (input) => {
  const mode = input.config.mode || 'auto';

  // Collect all upstream outputs
  if (input.allInputs && input.allInputs.length > 1) {
    if (mode === 'object' || mode === 'custom') {
      const result: Record<string, any> = {};
      input.allInputs.forEach((u, i) => {
        const key = u.nodeLabel || `item_${i}`;
        // Prefer msg.payload from upstream if available
        result[key] = u.msg ? u.msg.payload : tryParseJson(u.output);
      });
      const msg = { payload: result };
      return { output: JSON.stringify(result), msg };
    }

    // Default: join as array
    const items = input.allInputs.map(u =>
      u.msg ? u.msg.payload : tryParseJson(u.output)
    );
    const msg = { payload: items };
    return { output: JSON.stringify(items), msg };
  }

  // Single input — use msg.payload
  const msg: any = input.msg || { payload: tryParseJson(input.previousOutput) };
  const data = msg.payload;

  if (Array.isArray(data)) {
    return { output: JSON.stringify(data), msg };
  }

  msg.payload = [data];
  return { output: JSON.stringify([data]), msg };
};
