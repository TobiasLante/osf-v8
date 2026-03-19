import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('feature-flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults all flags to expected values', async () => {
    delete process.env.FF_FORCE_DISCUSSION;
    delete process.env.FF_FORCE_SIMPLE;
    delete process.env.FF_DISABLE_KG_PHASE;
    delete process.env.FF_DISABLE_DEBATE;
    delete process.env.FF_CATEGORY_TOOL_SELECTION;
    delete process.env.FF_ENABLE_MCP_CB;

    const { ff } = await import('../feature-flags');

    expect(ff.forceDiscussion).toBe(false);
    expect(ff.forceSimple).toBe(false);
    expect(ff.disableKgPhase).toBe(false);
    expect(ff.disableDebate).toBe(false);
    expect(ff.useCategoryToolSelection).toBe(true);
    expect(ff.enableMcpCircuitBreaker).toBe(true);
  });

  it('overrides flags via ENV "true"', async () => {
    process.env.FF_FORCE_DISCUSSION = 'true';

    const { ff } = await import('../feature-flags');

    expect(ff.forceDiscussion).toBe(true);
  });

  it('returns default fallback message', async () => {
    delete process.env.FF_LLM_FALLBACK_MESSAGE;

    const { ff } = await import('../feature-flags');

    expect(ff.llmFallbackMessage).toContain('nicht erreichbar');
  });

  it('overrides fallback message via ENV', async () => {
    process.env.FF_LLM_FALLBACK_MESSAGE = 'Custom offline message';

    const { ff } = await import('../feature-flags');

    expect(ff.llmFallbackMessage).toBe('Custom offline message');
  });
});
