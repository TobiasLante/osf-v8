/**
 * Central configuration — ALL magic numbers in one place.
 * Every value can be overridden via ENV (for K8s ConfigMap changes without code deploy).
 */

function str(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback;
}

function int(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 0) return fallback;
  return n;
}

function bool(envKey: string, fallback: boolean): boolean {
  const v = process.env[envKey];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

export const config = {
  llm: {
    urlFree: str('LLM_URL_FREE', 'http://localhost:5002'),
    urlPremium: str('LLM_URL_PREMIUM', 'http://localhost:5001'),
    modelFree: str('LLM_MODEL_FREE', 'qwen2.5-14b-instruct'),
    modelPremium: str('LLM_MODEL_PREMIUM', 'qwen2.5-32b-instruct'),
    // Anthropic API (Haiku) — used when llmProvider=haiku is passed
    anthropicApiKey: str('ANTHROPIC_API_KEY', ''),
    anthropicModel: str('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),
    anthropicUrl: str('ANTHROPIC_URL', 'https://api.anthropic.com/v1'),
    maxConcurrency: int('LLM_MAX_CONCURRENCY', 4),
    maxQueueDepth: int('LLM_MAX_QUEUE_DEPTH', 10),
    semaphoreTimeoutMs: int('LLM_SEMAPHORE_TIMEOUT_MS', 180_000),
    perRequestTimeoutMs: int('LLM_REQUEST_TIMEOUT_MS', 300_000),
    circuitBreakerThreshold: int('LLM_CB_THRESHOLD', 10),
    circuitBreakerResetMs: int('LLM_CB_RESET_MS', 120_000),
  },
  pipeline: {
    timeoutMs: int('PIPELINE_TIMEOUT_MS', 900_000),
    heartbeatIntervalMs: int('HEARTBEAT_INTERVAL_MS', 8_000),
    maxToolLoopIterations: int('MAX_TOOL_LOOP_ITERATIONS', 8),
    maxDiscussionToolLoopIterations: int('MAX_DISCUSSION_TOOL_LOOP_ITERATIONS', 10),
  },
  truncation: {
    toolResult: int('TRUNCATION_TOOL_RESULT', 12_000),
    kgToolResult: int('TRUNCATION_KG_TOOL_RESULT', 8_000),
    specialistKpi: int('TRUNCATION_SPECIALIST_KPI', 2_000),
    debateDraft: int('TRUNCATION_DEBATE_DRAFT', 6_000),
    followUpToolResult: int('TRUNCATION_FOLLOWUP_TOOL_RESULT', 1_200),
    agentToolResult: int('TRUNCATION_AGENT_TOOL_RESULT', 6_000),
  },
  mcp: {
    perAttemptTimeoutMs: int('MCP_PER_ATTEMPT_TIMEOUT_MS', 60_000),
    retryCount: int('MCP_RETRY_COUNT', 3),
    circuitBreakerThreshold: int('MCP_CB_THRESHOLD', 3),
    circuitBreakerResetMs: int('MCP_CB_RESET_MS', 60_000),
    toolCacheTtlMs: int('MCP_TOOL_CACHE_TTL_MS', 5 * 60_000),
  },
  db: {
    maxConsecutiveErrors: int('DB_MAX_CONSECUTIVE_ERRORS', 5),
    statementTimeoutMs: int('DB_STATEMENT_TIMEOUT_MS', 30_000),
  },
  kgSync: {
    watchdogTimeoutMs: int('KG_SYNC_WATCHDOG_MS', 180_000),
    watchdogCheckIntervalMs: int('KG_SYNC_WATCHDOG_CHECK_MS', 30_000),
  },
  shutdown: {
    drainPeriodMs: int('SHUTDOWN_DRAIN_MS', 10_000),
    flowDrainTimeoutMs: int('SHUTDOWN_FLOW_DRAIN_MS', 240_000),
  },
  cache: {
    llmCacheTtlMs: int('LLM_CACHE_TTL_MS', 5 * 60_000),
    llmCacheMaxSize: int('LLM_CACHE_MAX_SIZE', 200),
  },
} as const;
