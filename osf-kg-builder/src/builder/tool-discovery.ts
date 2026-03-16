import { config } from '../shared/config';
import { logger } from '../shared/logger';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: any;
  sampleOutput?: string;
}

export interface ToolDiscoveryResult {
  tools: McpToolInfo[];
  discoveredAt: string;
}

async function mcpCall(method: string, params: any = {}, authToken?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${config.mcpProxy.url}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) throw new Error(`MCP proxy HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data.error) throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}

export async function listMcpTools(authToken?: string): Promise<McpToolInfo[]> {
  const result = await mcpCall('tools/list', {}, authToken);
  const tools = result?.tools || [];
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema,
  }));
}

export async function sampleMcpTool(toolName: string, args: Record<string, any>, authToken?: string): Promise<string> {
  try {
    const result = await mcpCall('tools/call', { name: toolName, arguments: args }, authToken);
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return text.substring(0, 2000);
  } catch (e: any) {
    logger.warn({ tool: toolName, err: e.message }, 'Tool sample failed');
    return `ERROR: ${e.message}`;
  }
}

export async function discoverAndSample(authToken?: string): Promise<ToolDiscoveryResult> {
  logger.info('Starting MCP tool discovery');
  const tools = await listMcpTools(authToken);
  logger.info({ count: tools.length }, 'Discovered MCP tools');

  // Sample each tool with empty args (best-effort)
  for (const tool of tools) {
    tool.sampleOutput = await sampleMcpTool(tool.name, {}, authToken);
  }

  // Filter out tools that returned errors
  const working = tools.filter(t => !t.sampleOutput?.startsWith('ERROR:'));
  logger.info({ working: working.length, failed: tools.length - working.length }, 'Tool sampling complete');

  return { tools: working, discoveredAt: new Date().toISOString() };
}
