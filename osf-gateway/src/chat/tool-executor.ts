import { logger } from '../logger';

// ─── Retry Helper ─────────────────────────────────────────────────────────────
const RETRY_BACKOFF = [1000, 2000, 4000];
const PER_ATTEMPT_TIMEOUT = 10_000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      // Don't retry on 4xx — only on 5xx
      if (resp.ok || (resp.status >= 400 && resp.status < 500)) {
        return resp;
      }
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err: any) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      const delay = RETRY_BACKOFF[attempt] || 4000;
      logger.warn({ url, attempt: attempt + 1, err: lastError?.message }, 'MCP fetch retry');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError || new Error('fetchWithRetry: all attempts failed');
}

export const MCP_SERVERS: Record<string, string> = {
  erp: process.env.MCP_URL_ERP || 'http://factory-v3-fertigung:8020',
  oee: process.env.MCP_URL_OEE || 'http://factory-v3-fertigung:8020',
  qms: process.env.MCP_URL_QMS || 'http://factory-v3-fertigung:8020',
  tms: process.env.MCP_URL_TMS || 'http://factory-v3-fertigung:8020',
  uns: process.env.MCP_URL_UNS || 'http://factory-v3-fertigung:8025',
  kg:  process.env.MCP_URL_KG  || 'http://factory-v3-fertigung:8020',
};

const CACHE_TTL = 5 * 60 * 1000; // 5 min

// Per-URL cache (dedup: multiple logical servers may share the same URL)
const urlToolCache: Record<string, { tools: any[]; time: number }> = {};

async function fetchToolsFromUrl(url: string): Promise<any[]> {
  const now = Date.now();
  const cached = urlToolCache[url];
  if (cached && now - cached.time < CACHE_TTL) {
    return cached.tools;
  }

  const resp = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  if (!resp.ok) throw new Error(`MCP tools/list failed at ${url}: ${resp.status}`);
  const data: any = await resp.json();
  const tools = (data.result?.tools || []).map((t: any) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  urlToolCache[url] = { tools, time: now };
  return tools;
}

export async function getMcpToolsForServer(server: string): Promise<any[]> {
  const url = MCP_SERVERS[server];
  if (!url) throw new Error(`Unknown MCP server: ${server}`);
  return fetchToolsFromUrl(url);
}

/** Get tools from ALL MCP servers combined, deduplicated by tool name */
export async function getMcpTools(): Promise<any[]> {
  // Deduplicate URLs so we don't query the same endpoint multiple times
  const uniqueUrls = [...new Set(Object.values(MCP_SERVERS))];
  const results = await Promise.allSettled(
    uniqueUrls.map(url => fetchToolsFromUrl(url))
  );

  const seen = new Set<string>();
  const tools: any[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const t of r.value) {
      const name = t.function.name;
      if (!seen.has(name)) {
        seen.add(name);
        tools.push(t);
      }
    }
  }
  return tools;
}

// Tool name → server URL mapping (built lazily)
let toolServerMap: Map<string, string> | null = null;
let toolServerMapTime = 0;

async function getToolServerMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (toolServerMap && now - toolServerMapTime < CACHE_TTL) {
    return toolServerMap;
  }

  toolServerMap = new Map();
  for (const server of Object.keys(MCP_SERVERS)) {
    try {
      const tools = await getMcpToolsForServer(server);
      for (const t of tools) {
        // First server wins — no overwrite
        if (!toolServerMap.has(t.function.name)) {
          toolServerMap.set(t.function.name, server);
        }
      }
    } catch {
      // Server unavailable, skip
    }
  }
  toolServerMapTime = now;
  return toolServerMap;
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const map = await getToolServerMap();
  const server = map.get(name);
  if (!server) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  const url = MCP_SERVERS[server];
  let resp: Response;
  try {
    resp = await fetchWithRetry(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (err: any) {
    return JSON.stringify({ error: `MCP unreachable after retries: ${err.message}` });
  }

  if (!resp.ok) {
    const text = await resp.text();
    return JSON.stringify({ error: `MCP error ${resp.status}: ${text}` });
  }

  const data: any = await resp.json();
  if (data.error) {
    return JSON.stringify({ error: data.error.message });
  }

  const content = data.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    return content[0].text || JSON.stringify(content);
  }
  return JSON.stringify(data.result);
}
