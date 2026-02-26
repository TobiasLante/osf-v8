import { NodeExecutor } from './types';

/**
 * Executor for native Node-RED 'delay' node.
 * Delays execution for a specified time, then passes msg through.
 */
export const executeNativeDelay: NodeExecutor = async (input) => {
  const timeout = parseInt(input.config.timeout, 10) || 5;
  const units = input.config.timeoutUnits || 'seconds';

  let ms = timeout;
  switch (units) {
    case 'milliseconds': ms = timeout; break;
    case 'seconds': ms = timeout * 1000; break;
    case 'minutes': ms = timeout * 60 * 1000; break;
    default: ms = timeout * 1000;
  }

  // Cap at 60 seconds for safety
  ms = Math.min(ms, 60_000);

  await new Promise(resolve => setTimeout(resolve, ms));

  return { output: input.previousOutput, msg: input.msg };
};
