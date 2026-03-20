import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses default values when no ENV is set', async () => {
    delete process.env.LLM_URL_FREE;
    delete process.env.LLM_MAX_CONCURRENCY;
    delete process.env.PIPELINE_TIMEOUT_MS;

    const { config } = await import('../config');

    expect(config.llm.urlFree).toBe('http://localhost:5002');
    expect(config.llm.urlPremium).toBe('http://localhost:5001');
    expect(config.llm.maxConcurrency).toBe(4);
    expect(config.pipeline.timeoutMs).toBe(900_000);
    expect(config.shutdown.drainPeriodMs).toBe(10_000);
  });

  it('overrides with ENV values', async () => {
    process.env.LLM_URL_FREE = 'http://custom:9999';
    process.env.LLM_MAX_CONCURRENCY = '16';
    process.env.PIPELINE_TIMEOUT_MS = '60000';

    const { config } = await import('../config');

    expect(config.llm.urlFree).toBe('http://custom:9999');
    expect(config.llm.maxConcurrency).toBe(16);
    expect(config.pipeline.timeoutMs).toBe(60000);
  });

  it('falls back on invalid integer ENV', async () => {
    process.env.LLM_MAX_CONCURRENCY = 'not_a_number';

    const { config } = await import('../config');

    expect(config.llm.maxConcurrency).toBe(4);
  });

  it('parses boolean-like ENV for db config', async () => {
    process.env.DB_MAX_CONSECUTIVE_ERRORS = '10';
    process.env.DB_STATEMENT_TIMEOUT_MS = '5000';

    const { config } = await import('../config');

    expect(config.db.maxConsecutiveErrors).toBe(10);
    expect(config.db.statementTimeoutMs).toBe(5000);
  });
});
