import { NodeExecutor, tryParseJson } from './types';

/**
 * Executor for native Node-RED 'split' node.
 * Splits an array, string, or object into multi-output.
 */
export const executeNativeSplit: NodeExecutor = async (input) => {
  // Use msg.payload if available
  const msg: any = input.msg || { payload: tryParseJson(input.previousOutput) };
  const data = msg.payload;

  // If array, split into multi-output
  if (Array.isArray(data)) {
    const multiOutput = data.map((item: any) =>
      typeof item === 'string' ? item : JSON.stringify(item)
    );
    return {
      output: multiOutput[0] || '',
      multiOutput,
    };
  }

  // If string, split by delimiter
  if (typeof data === 'string') {
    const splt = input.config.splt || '\n';
    const parts = data.split(splt).filter((s: string) => s.length > 0);
    return {
      output: parts[0] || '',
      multiOutput: parts,
    };
  }

  // If object, split into key-value pairs
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data);
    const multiOutput = entries.map(([k, v]) => JSON.stringify({ key: k, value: v }));
    return {
      output: multiOutput[0] || '',
      multiOutput,
    };
  }

  return { output: input.previousOutput };
};
