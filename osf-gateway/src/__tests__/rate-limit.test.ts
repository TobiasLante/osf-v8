import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('rate-limit (in-memory path)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Ensure no Redis connection
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PASSWORD;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('allows requests within limit', async () => {
    const { checkRateLimit } = await import('../rate-limit');

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('test-user', 5)).toBe(true);
    }
  });

  it('rejects request N+1 over limit', async () => {
    const { checkRateLimit } = await import('../rate-limit');

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit('limit-user', 3);
    }

    expect(checkRateLimit('limit-user', 3)).toBe(false);
  });

  it('resets after window expires', async () => {
    const { checkRateLimit } = await import('../rate-limit');

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit('expire-user', 3);
    }
    expect(checkRateLimit('expire-user', 3)).toBe(false);

    // Advance past 1-minute window
    vi.advanceTimersByTime(61_000);

    expect(checkRateLimit('expire-user', 3)).toBe(true);
  });

  it('tracks keys independently', async () => {
    const { checkRateLimit } = await import('../rate-limit');

    for (let i = 0; i < 2; i++) {
      checkRateLimit('user-a', 2);
    }
    expect(checkRateLimit('user-a', 2)).toBe(false);

    // Different key should still be allowed
    expect(checkRateLimit('user-b', 2)).toBe(true);
  });
});
