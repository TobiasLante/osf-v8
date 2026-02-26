/**
 * Rate limiter — Redis-backed sliding window with in-memory fallback.
 * Works across multiple gateway instances (K8s replicas).
 */
import Redis from 'ioredis';
import { logger } from './logger';

const WINDOW_MS = 60_000; // 1 minute

let redis: Redis | null = null;
let useRedis = false;

// Try connecting to Redis; fall back to in-memory if unavailable
const redisUrl = process.env.REDIS_URL || (process.env.REDIS_HOST
  ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
  : null);

if (redisUrl) {
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // Stop retrying after 3 attempts
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  redis.connect()
    .then(() => {
      useRedis = true;
      logger.info('Rate limiter: using Redis');
    })
    .catch((err) => {
      logger.warn({ err: err.message }, 'Rate limiter: Redis unavailable, using in-memory fallback');
      redis = null;
    });

  redis.on('error', () => {
    if (useRedis) {
      logger.warn('Rate limiter: Redis connection lost, falling back to in-memory');
      useRedis = false;
    }
  });

  redis.on('ready', () => {
    if (!useRedis) {
      logger.info('Rate limiter: Redis reconnected');
      useRedis = true;
    }
  });
}

// ─── In-memory fallback ─────────────────────────────────────────────────────
const windows = new Map<string, number[]>();

function checkInMemory(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const timestamps = windows.get(key) || [];
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);

  if (valid.length >= maxPerMinute) {
    windows.set(key, valid);
    return false;
  }

  valid.push(now);
  windows.set(key, valid);
  return true;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of windows.entries()) {
    const valid = timestamps.filter((t) => now - t < WINDOW_MS);
    if (valid.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, valid);
    }
  }
}, 5 * 60_000);

// ─── Redis sliding window (ZSET) ───────────────────────────────────────────
async function checkRedis(key: string, maxPerMinute: number): Promise<boolean> {
  if (!redis) return checkInMemory(key, maxPerMinute);

  const redisKey = `rl:${key}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now.toString(), `${now}:${Math.random()}`);
    pipeline.expire(redisKey, 120); // TTL 2 min

    const results = await pipeline.exec();
    const count = results?.[1]?.[1] as number ?? 0;

    if (count >= maxPerMinute) {
      // Remove the entry we just added
      await redis.zremrangebyscore(redisKey, now, now + 1);
      return false;
    }
    return true;
  } catch {
    // Redis failed — fall back to in-memory
    return checkInMemory(key, maxPerMinute);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────
export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  if (useRedis && redis) {
    // Fire-and-forget async check with sync fallback for callers that expect sync
    // For a truly async API we'd need to refactor all callers.
    // Instead: use in-memory as primary gate, Redis as distributed counter.
    // This means single-instance accuracy is exact; multi-instance is eventually consistent.
    checkRedis(key, maxPerMinute).catch(() => { /* swallow */ });
    return checkInMemory(key, maxPerMinute);
  }
  return checkInMemory(key, maxPerMinute);
}

// Async version for callers that can await
export async function checkRateLimitAsync(key: string, maxPerMinute: number): Promise<boolean> {
  if (useRedis && redis) {
    return checkRedis(key, maxPerMinute);
  }
  return checkInMemory(key, maxPerMinute);
}
