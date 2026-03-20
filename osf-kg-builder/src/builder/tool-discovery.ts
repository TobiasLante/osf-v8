import { config } from '../shared/config';
import { logger } from '../shared/logger';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: any;
  sampleOutput?: string;
  /** Which MCP endpoint serves this tool */
  mcpUrl: string;
}

export interface ToolDiscoveryResult {
  tools: McpToolInfo[];
  discoveredAt: string;
}

// ── URL → Tool mapping (built during discovery) ───────────────────

let toolUrlMap = new Map<string, string>();

/**
 * Get the MCP URL that serves a given tool.
 * Falls back to the primary MCP proxy if not found.
 */
export function getMcpUrlForTool(toolName: string): string {
  return toolUrlMap.get(toolName) || config.mcpProxy.url;
}

// ── Generic MCP call against a specific URL ───────────────────────

async function mcpCallUrl(url: string, method: string, params: any = {}, authToken?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const endpoint = url.endsWith('/mcp') ? url : `${url}/mcp`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`MCP HTTP ${res.status} from ${endpoint}`);
  const data = await res.json() as any;
  if (data.error) throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}

/**
 * Discover tools from a single MCP endpoint.
 */
async function discoverFromUrl(url: string): Promise<McpToolInfo[]> {
  try {
    const result = await mcpCallUrl(url, 'tools/list');
    const tools = result?.tools || [];
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema,
      mcpUrl: url,
    }));
  } catch (e: any) {
    logger.warn({ url, err: e.message }, 'Tool discovery failed for endpoint');
    return [];
  }
}

/**
 * List tools from all configured MCP endpoints (primary + historian).
 */
export async function listMcpTools(authToken?: string): Promise<McpToolInfo[]> {
  const allTools: McpToolInfo[] = [];

  // Primary MCP endpoint (factory sim)
  const primaryTools = await discoverFromUrl(config.mcpProxy.url);
  allTools.push(...primaryTools);

  // Historian (if configured)
  if (config.historian.url) {
    const historianTools = await discoverFromUrl(config.historian.url);
    allTools.push(...historianTools);
    logger.info({ count: historianTools.length, url: config.historian.url }, 'Historian tools discovered');
  }

  // Build URL map — atomic swap to avoid race conditions during reads
  const newMap = new Map<string, string>();
  for (const tool of allTools) {
    newMap.set(tool.name, tool.mcpUrl);
  }
  toolUrlMap = newMap;

  return allTools;
}

/**
 * Call a specific tool — routes to the correct MCP endpoint automatically.
 */
export async function sampleMcpTool(toolName: string, args: Record<string, any>, authToken?: string): Promise<string> {
  const url = getMcpUrlForTool(toolName);
  try {
    const result = await mcpCallUrl(url, 'tools/call', { name: toolName, arguments: args }, authToken);
    // MCP response: { content: [{ type: "text", text: "..." }] }
    if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
      return result.content[0].text.substring(0, 2000);
    }
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return text.substring(0, 2000);
  } catch (e: any) {
    logger.warn({ tool: toolName, url, err: e.message }, 'Tool sample failed');
    return `ERROR: ${e.message}`;
  }
}

/**
 * Discover all tools from all endpoints and sample each one.
 */
export async function discoverAndSample(authToken?: string): Promise<ToolDiscoveryResult> {
  logger.info('Starting MCP tool discovery (multi-source)');
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
