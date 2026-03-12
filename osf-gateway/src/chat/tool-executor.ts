import { logger } from '../logger';
import { config } from '../config';
import { ff } from '../feature-flags';
import { pool } from '../db/pool';

// ─── MCP Circuit Breaker ──────────────────────────────────────────────────────
class McpCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' = 'closed';

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= config.mcp.circuitBreakerThreshold) {
      if (this.state !== 'open') {
        logger.warn({ failures: this.failures }, 'MCP circuit breaker OPEN');
      }
      this.state = 'open';
    }
  }

  canAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (Date.now() - this.lastFailure > config.mcp.circuitBreakerResetMs) {
      this.state = 'closed';
      this.failures = 0;
      logger.info('MCP circuit breaker RESET');
      return true;
    }
    return false;
  }
}

const mcpCircuitBreakers = new Map<string, McpCircuitBreaker>();
function getMcpCircuitBreaker(url: string): McpCircuitBreaker {
  let cb = mcpCircuitBreakers.get(url);
  if (!cb) {
    cb = new McpCircuitBreaker();
    mcpCircuitBreakers.set(url, cb);
  }
  return cb;
}

// ─── Retry Helper ─────────────────────────────────────────────────────────────
const RETRY_BACKOFF = [2000, 4000, 8000];
const PER_ATTEMPT_TIMEOUT = config.mcp.perAttemptTimeoutMs;

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

function stripMcpSuffix(url: string): string {
  return url.replace(/\/mcp\/?$/, '');
}

// ─── Dynamic MCP Server Registry (v9) ────────────────────────────────────────
// Loads from mcp_servers DB table. Falls back to env vars for backward compat.

const ENV_FALLBACK_SERVERS: Record<string, string> = {
  erp: stripMcpSuffix(process.env.MCP_ERP_URL || process.env.MCP_URL_ERP || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020'),
  oee: stripMcpSuffix(process.env.MCP_OEE_URL || process.env.MCP_URL_OEE || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020'),
  qms: stripMcpSuffix(process.env.MCP_QMS_URL || process.env.MCP_URL_QMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020'),
  tms: stripMcpSuffix(process.env.MCP_TMS_URL || process.env.MCP_URL_TMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020'),
  uns: stripMcpSuffix(process.env.MCP_UNS_URL || process.env.MCP_URL_UNS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8025'),
  kg:  stripMcpSuffix(process.env.MCP_KG_URL  || process.env.MCP_URL_KG  || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020'),
};

let dbServersCache: Record<string, string> | null = null;
let dbServersCacheTime = 0;
const DB_CACHE_TTL = 60_000; // Reload from DB every 60s

async function loadMcpServersFromDb(): Promise<Record<string, string>> {
  try {
    const result = await pool.query(
      "SELECT name, url FROM mcp_servers WHERE status = 'online'"
    );
    const servers: Record<string, string> = {};
    for (const row of result.rows) {
      servers[row.name] = stripMcpSuffix(row.url);
    }
    return servers;
  } catch {
    // Table may not exist yet or DB down — silent fallback
    return {};
  }
}

async function getMcpServers(): Promise<Record<string, string>> {
  const now = Date.now();
  if (dbServersCache && now - dbServersCacheTime < DB_CACHE_TTL) {
    return dbServersCache;
  }

  const dbServers = await loadMcpServersFromDb();
  // Merge: DB servers override env fallbacks
  const merged = { ...ENV_FALLBACK_SERVERS, ...dbServers };
  dbServersCache = merged;
  dbServersCacheTime = now;
  return merged;
}

// Synchronous access for backward compat (uses cache or env fallback)
export function getMcpServersCached(): Record<string, string> {
  return dbServersCache || ENV_FALLBACK_SERVERS;
}

// Legacy export for code that reads MCP_SERVERS directly
export const MCP_SERVERS = ENV_FALLBACK_SERVERS;

const CACHE_TTL = config.mcp.toolCacheTtlMs;

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
    signal: AbortSignal.timeout(10_000),
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
  const servers = await getMcpServers();
  const url = servers[server];
  if (!url) throw new Error(`Unknown MCP server: ${server}`);
  return fetchToolsFromUrl(url);
}

/** Get tools from ALL MCP servers combined, deduplicated by tool name */
export async function getMcpTools(): Promise<any[]> {
  const servers = await getMcpServers();
  // Deduplicate URLs so we don't query the same endpoint multiple times
  const uniqueUrls = [...new Set(Object.values(servers))];
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

  const servers = await getMcpServers();
  toolServerMap = new Map();
  for (const server of Object.keys(servers)) {
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

  const servers = getMcpServersCached();
  const url = servers[server];

  // Circuit breaker check — fast-fail if MCP server is known-down
  if (ff.enableMcpCircuitBreaker) {
    const cb = getMcpCircuitBreaker(url);
    if (!cb.canAttempt()) {
      return JSON.stringify({ error: `MCP server temporarily unavailable (circuit breaker open)` });
    }
  }

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
    if (ff.enableMcpCircuitBreaker) getMcpCircuitBreaker(url).recordFailure();
    return JSON.stringify({ error: `MCP unreachable after retries: ${err.message}` });
  }

  if (!resp.ok) {
    const text = await resp.text();
    if (ff.enableMcpCircuitBreaker && resp.status >= 500) getMcpCircuitBreaker(url).recordFailure();
    return JSON.stringify({ error: `MCP error ${resp.status}: ${text}` });
  }

  // Success — reset circuit breaker
  if (ff.enableMcpCircuitBreaker) getMcpCircuitBreaker(url).recordSuccess();

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
