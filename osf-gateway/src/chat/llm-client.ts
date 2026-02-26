import { createHash } from 'crypto';
import { pool } from '../db/pool';
import { decryptApiKey } from '../auth/crypto';
import { logger } from '../logger';

// ─── LLM Concurrency Control ────────────────────────────────────────────────
class Semaphore {
  private queue: Array<() => void> = [];
  private _active = 0;
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this._active < this.max) {
      this._active++;
      return;
    }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    this._active--;
    const next = this.queue.shift();
    if (next) {
      this._active++;
      next();
    }
  }

  get active(): number { return this._active; }
  get pending(): number { return this.queue.length; }
}

const LLM_MAX_CONCURRENCY = parseInt(process.env.LLM_MAX_CONCURRENCY || '2', 10);
const semaphores = new Map<string, Semaphore>();

function getSemaphore(baseUrl: string): Semaphore {
  let sem = semaphores.get(baseUrl);
  if (!sem) {
    sem = new Semaphore(LLM_MAX_CONCURRENCY);
    semaphores.set(baseUrl, sem);
  }
  return sem;
}

/** Get queue status for all LLM servers */
export function getLlmStatus(): { servers: Array<{ url: string; active: number; queued: number }> } {
  return {
    servers: [...semaphores.entries()].map(([url, sem]) => ({
      url, active: sem.active, queued: sem.pending,
    })),
  };
}

/**
 * Check if LLM servers are overloaded (total queued requests exceed threshold).
 * Used by flow engine to reject new runs when LLM is saturated.
 */
const MAX_LLM_QUEUE_DEPTH = parseInt(process.env.LLM_MAX_QUEUE_DEPTH || '10', 10);
export function isLlmOverloaded(): { overloaded: boolean; totalQueued: number; threshold: number } {
  let totalQueued = 0;
  semaphores.forEach(sem => { totalQueued += sem.pending; });
  return { overloaded: totalQueued >= MAX_LLM_QUEUE_DEPTH, totalQueued, threshold: MAX_LLM_QUEUE_DEPTH };
}

// ─── LLM Response Cache ─────────────────────────────────────────────────────
const LLM_CACHE = new Map<string, { response: LlmResponse; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 200;

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of LLM_CACHE) {
    if (entry.expiresAt < now) LLM_CACHE.delete(key);
  }
}, 5 * 60 * 1000).unref();

// ─── Token Estimation ────────────────────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5); // ~3.5 chars/token for german/english
}

/** Check and deduct token quota for a user. Throws if quota exceeded. */
export async function checkAndDeductQuota(userId: string, tokensUsed: number): Promise<void> {
  // Reset monthly quota if needed
  await pool.query(
    `UPDATE users SET tokens_used = 0, quota_reset_at = NOW()
     WHERE id = $1 AND quota_reset_at < date_trunc('month', NOW())`,
    [userId]
  );
  // Check quota (0 = unlimited)
  const { rows } = await pool.query(
    'SELECT token_quota, tokens_used FROM users WHERE id = $1', [userId]
  );
  if (rows.length === 0) return;
  if (rows[0].token_quota > 0 && rows[0].tokens_used + tokensUsed > rows[0].token_quota) {
    throw new Error('Token-Limit erreicht. Dein monatliches Kontingent ist aufgebraucht.');
  }
  // Deduct
  await pool.query('UPDATE users SET tokens_used = tokens_used + $1 WHERE id = $2', [tokensUsed, userId]);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface LlmStreamChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

const LLM_URLS: Record<string, string> = {
  free: process.env.LLM_URL_FREE || 'http://192.168.178.120:5002',
  premium: process.env.LLM_URL_PREMIUM || 'http://192.168.178.120:5001',
};

const LLM_MODELS: Record<string, string> = {
  free: process.env.LLM_MODEL_FREE || 'qwen2.5-14b-instruct',
  premium: process.env.LLM_MODEL_PREMIUM || 'qwen2.5-32b-instruct',
};

/** Get platform default config for a tier */
function getPlatformConfig(tier: string): LlmConfig {
  return {
    baseUrl: LLM_URLS[tier] || LLM_URLS.free,
    model: LLM_MODELS[tier] || LLM_MODELS.free,
  };
}

/** Resolve LLM config: user's own provider or platform default */
export async function getLlmConfig(userId: string, tier: string): Promise<LlmConfig> {
  // Skip DB query if userId is not a valid UUID (e.g. "anonymous" from NR editor)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!userId || !UUID_RE.test(userId)) return getPlatformConfig(tier);

  const result = await pool.query(
    'SELECT llm_provider, llm_base_url, llm_model, llm_api_key_encrypted, tier FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) return getPlatformConfig(tier);

  const user = result.rows[0];
  if (!user.llm_provider || user.llm_provider === 'platform') {
    return getPlatformConfig(tier);
  }

  // Free users: ignore BYOK settings, use platform
  if (user.tier === 'free') {
    return getPlatformConfig(tier);
  }

  // User has a custom provider
  const config: LlmConfig = {
    baseUrl: user.llm_base_url || getPlatformConfig(tier).baseUrl,
    model: user.llm_model || getPlatformConfig(tier).model,
  };

  if (user.llm_api_key_encrypted) {
    try {
      config.apiKey = decryptApiKey(user.llm_api_key_encrypted);
    } catch {
      // If decryption fails, fall back to platform
      return getPlatformConfig(tier);
    }
  }

  return config;
}

export interface LlmResponse {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: string | null;
  tokensUsed?: number;
}

export async function callLlm(
  messages: ChatMessage[],
  tools: any[] | undefined,
  tierOrConfig: string | LlmConfig,
  userId?: string
): Promise<LlmResponse> {
  const config: LlmConfig = typeof tierOrConfig === 'string'
    ? getPlatformConfig(tierOrConfig)
    : tierOrConfig;

  const hasTools = tools && tools.length > 0;

  // ─── Cache check (only for non-tool calls) ──────────────────────────────
  let cacheKey: string | undefined;
  if (!hasTools) {
    cacheKey = createHash('sha256')
      .update(JSON.stringify({ model: config.model, messages }))
      .digest('hex');
    const cached = LLM_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info({ cacheKey: cacheKey.slice(0, 8) }, 'LLM cache hit');
      return cached.response;
    }
  }

  const sem = getSemaphore(config.baseUrl);
  if (sem.pending > 0) {
    logger.info({ baseUrl: config.baseUrl, pending: sem.pending }, 'LLM semaphore: queuing request');
  }
  await sem.acquire();

  try {
    const body: any = {
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    };
    if (hasTools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    const resp = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown');
      throw new Error(`LLM error ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data: any = await resp.json();
    const choice = data.choices?.[0];

    // Token estimation
    const inputTokens = estimateTokens(JSON.stringify(messages));
    const outputTokens = estimateTokens(choice?.message?.content || '');
    const tokensUsed = inputTokens + outputTokens;

    const result: LlmResponse = {
      content: choice?.message?.content || null,
      tool_calls: choice?.message?.tool_calls || [],
      finish_reason: choice?.finish_reason || null,
      tokensUsed,
    };

    // ─── Cache store (only for non-tool calls) ────────────────────────────
    if (!hasTools && cacheKey) {
      if (LLM_CACHE.size >= CACHE_MAX_SIZE) {
        // Evict oldest entry
        const firstKey = LLM_CACHE.keys().next().value;
        if (firstKey) LLM_CACHE.delete(firstKey);
      }
      LLM_CACHE.set(cacheKey, { response: result, expiresAt: Date.now() + CACHE_TTL });
    }

    // ─── Quota deduction ──────────────────────────────────────────────────
    if (userId) {
      try {
        await checkAndDeductQuota(userId, tokensUsed);
      } catch (err) {
        // Log but don't fail the request — quota exceeded will block next call
        logger.warn({ userId, tokensUsed, err: (err as Error).message }, 'Quota deduction issue');
      }
    }

    return result;
  } finally {
    sem.release();
  }
}

export async function* streamLlm(
  messages: ChatMessage[],
  tools: any[] | undefined,
  tierOrConfig: string | LlmConfig
): AsyncGenerator<LlmStreamChunk> {
  const config: LlmConfig = typeof tierOrConfig === 'string'
    ? getPlatformConfig(tierOrConfig)
    : tierOrConfig;

  const sem = getSemaphore(config.baseUrl);
  if (sem.pending > 0) {
    logger.info({ baseUrl: config.baseUrl, pending: sem.pending }, 'LLM semaphore: queuing stream request');
  }
  await sem.acquire();

  try {
    const body: any = {
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const resp = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM stream error ${resp.status}: ${text}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data);
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    sem.release();
  }
}
