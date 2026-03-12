/**
 * Internal Metrics Collector — rolling window for built-in dashboard.
 * No external dependencies (Prometheus/Grafana not required).
 * Data stays in-process, resets on restart.
 */

import { pool } from './db/pool';

// ─── Ring Buffer ──────────────────────────────────────────────────────────────

const WINDOW_SIZE = 60; // 60 data points = 60 minutes at 1/min resolution

interface TimePoint {
  ts: number; // epoch ms
  requests: number;
  errors: number;    // 5xx
  toolCalls: number;
  toolErrors: number;
  llmCalls: number;
  llmLatencySumMs: number;
  llmLatencyCount: number;
}

const ring: TimePoint[] = [];
let currentPoint: TimePoint = freshPoint();

function freshPoint(): TimePoint {
  return { ts: Date.now(), requests: 0, errors: 0, toolCalls: 0, toolErrors: 0, llmCalls: 0, llmLatencySumMs: 0, llmLatencyCount: 0 };
}

// Flush current point to ring every 60s
setInterval(() => {
  currentPoint.ts = Date.now();
  ring.push({ ...currentPoint });
  if (ring.length > WINDOW_SIZE) ring.shift();
  currentPoint = freshPoint();
}, 60_000).unref();

// ─── Increment Functions (called from middleware/tool-executor/llm-client) ────

export function recordRequest(statusCode: number): void {
  currentPoint.requests++;
  if (statusCode >= 500) currentPoint.errors++;
}

export function recordToolCall(success: boolean): void {
  currentPoint.toolCalls++;
  if (!success) currentPoint.toolErrors++;
}

export function recordLlmCall(durationMs: number): void {
  currentPoint.llmCalls++;
  currentPoint.llmLatencySumMs += durationMs;
  currentPoint.llmLatencyCount++;
}

// ─── MCP Server State ─────────────────────────────────────────────────────────

interface McpServerState {
  name: string;
  url: string;
  status: 'online' | 'degraded' | 'offline';
  lastCheck: number;
  toolCount: number;
}

const mcpStates = new Map<string, McpServerState>();

export function updateMcpState(name: string, url: string, status: 'online' | 'degraded' | 'offline', toolCount: number): void {
  mcpStates.set(name, { name, url, status, lastCheck: Date.now(), toolCount });
}

// ─── Snapshot (called by admin API) ───────────────────────────────────────────

export interface DashboardSnapshot {
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  eventLoopLag: number;
  db: { totalCount: number; idleCount: number; waitingCount: number };
  requests: { perMin: number; errorRate: number; history: { ts: number; requests: number; errors: number }[] };
  llm: { callsPerMin: number; avgLatencyMs: number; history: { ts: number; calls: number; avgMs: number }[] };
  tools: { callsPerMin: number; errorRate: number; history: { ts: number; calls: number; errors: number }[] };
  mcpServers: McpServerState[];
}

export async function getSnapshot(): Promise<DashboardSnapshot> {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // Event loop lag (rough estimate)
  const lagStart = Date.now();
  await new Promise(r => setImmediate(r));
  const eventLoopLag = Date.now() - lagStart;

  // DB pool stats
  const dbPool = {
    totalCount: (pool as any).totalCount || 0,
    idleCount: (pool as any).idleCount || 0,
    waitingCount: (pool as any).waitingCount || 0,
  };

  // Aggregate ring buffer
  const last5 = ring.slice(-5);
  const reqPerMin = last5.length > 0 ? last5.reduce((s, p) => s + p.requests, 0) / last5.length : currentPoint.requests;
  const errPerMin = last5.length > 0 ? last5.reduce((s, p) => s + p.errors, 0) / last5.length : currentPoint.errors;
  const errorRate = reqPerMin > 0 ? errPerMin / reqPerMin : 0;

  const llmLast5 = last5.length > 0 ? last5 : [currentPoint];
  const llmCallsPerMin = llmLast5.reduce((s, p) => s + p.llmCalls, 0) / llmLast5.length;
  const llmLatencyTotal = llmLast5.reduce((s, p) => s + p.llmLatencySumMs, 0);
  const llmLatencyCount = llmLast5.reduce((s, p) => s + p.llmLatencyCount, 0);
  const avgLatencyMs = llmLatencyCount > 0 ? Math.round(llmLatencyTotal / llmLatencyCount) : 0;

  const toolLast5 = last5.length > 0 ? last5 : [currentPoint];
  const toolCallsPerMin = toolLast5.reduce((s, p) => s + p.toolCalls, 0) / toolLast5.length;
  const toolErrRate = toolLast5.reduce((s, p) => s + p.toolCalls, 0) > 0
    ? toolLast5.reduce((s, p) => s + p.toolErrors, 0) / toolLast5.reduce((s, p) => s + p.toolCalls, 0)
    : 0;

  return {
    uptime: Math.round(uptime),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    eventLoopLag,
    db: dbPool,
    requests: {
      perMin: Math.round(reqPerMin),
      errorRate: Math.round(errorRate * 1000) / 1000,
      history: ring.map(p => ({ ts: p.ts, requests: p.requests, errors: p.errors })),
    },
    llm: {
      callsPerMin: Math.round(llmCallsPerMin * 10) / 10,
      avgLatencyMs,
      history: ring.map(p => ({
        ts: p.ts,
        calls: p.llmCalls,
        avgMs: p.llmLatencyCount > 0 ? Math.round(p.llmLatencySumMs / p.llmLatencyCount) : 0,
      })),
    },
    tools: {
      callsPerMin: Math.round(toolCallsPerMin * 10) / 10,
      errorRate: Math.round(toolErrRate * 1000) / 1000,
      history: ring.map(p => ({ ts: p.ts, calls: p.toolCalls, errors: p.toolErrors })),
    },
    mcpServers: [...mcpStates.values()],
  };
}
