import { NodeExecutor, tryParseJson } from './types';
import { logger } from '../../logger';

/**
 * Executor for native Node-RED 'debug' node.
 * Logs the msg and passes it through unchanged.
 */
export const executeNativeDebug: NodeExecutor = async (input) => {
  const name = input.config.name || 'debug';
  const active = input.config.active !== false;

  // Use upstream msg if available
  const msg: any = input.msg
    ? { ...input.msg }
    : { payload: tryParseJson(input.previousOutput) };

  if (active) {
    // Log the property the user configured (default: msg.payload)
    const prop = input.config.complete === 'true' ? msg : msg.payload;

    logger.info({
      nodeId: input.config.id,
      name,
      payload: prop,
    }, `[DEBUG] ${name}`);
  }

  // Pass through — debug doesn't transform data
  return { output: input.previousOutput, msg };
};
