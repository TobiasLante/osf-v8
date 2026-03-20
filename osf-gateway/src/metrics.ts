import client from 'prom-client';

// Collect default Node.js process metrics (CPU, memory, event loop, GC)
client.collectDefaultMetrics();

export const httpRequestsTotal = new client.Counter({
  name: 'osf_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
});

export const toolCallsTotal = new client.Counter({
  name: 'osf_tool_calls_total',
  help: 'Total MCP tool calls',
  labelNames: ['tool', 'status'] as const,
});

export const mcpFailuresTotal = new client.Counter({
  name: 'osf_mcp_failures_total',
  help: 'Total MCP server failures',
  labelNames: ['url'] as const,
});

export const llmLatencySeconds = new client.Histogram({
  name: 'osf_llm_latency_seconds',
  help: 'LLM request latency in seconds',
  labelNames: ['tier'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
});

export const registry = client.register;
