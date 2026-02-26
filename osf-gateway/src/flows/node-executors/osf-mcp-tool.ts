import { NodeExecutor } from './types';
import { callMcpTool } from '../../chat/tool-executor';

export const executeOsfMcpTool: NodeExecutor = async (input) => {
  const toolName = input.config.toolName;
  if (!toolName) throw new Error('osf-mcp-tool: toolName not configured');

  let args: Record<string, unknown> = {};
  try {
    const rawArgs = input.config.arguments || '{}';
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch { /* use empty args */ }

  const result = await callMcpTool(toolName, args);
  return { output: result };
};
