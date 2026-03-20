import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db/pool module before importing internal-metrics
vi.mock('../db/pool', () => ({
  pool: {
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
    query: vi.fn(),
  },
}));

describe('internal-metrics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recordRequest increments counters', async () => {
    const metrics = await import('../internal-metrics');

    metrics.recordRequest(200);
    metrics.recordRequest(200);
    metrics.recordRequest(500);

    // getSnapshot should reflect current point
    const snap = await metrics.getSnapshot();
    expect(snap.uptime).toBeGreaterThanOrEqual(0);
    expect(snap.memory.rss).toBeGreaterThan(0);
    expect(snap.memory.heapUsed).toBeGreaterThan(0);
  });

  it('recordToolCall tracks successes and errors', async () => {
    const metrics = await import('../internal-metrics');

    metrics.recordToolCall(true);
    metrics.recordToolCall(true);
    metrics.recordToolCall(false);

    const snap = await metrics.getSnapshot();
    expect(snap).toBeDefined();
    expect(snap.tools).toBeDefined();
  });

  it('recordLlmCall tracks latency', async () => {
    const metrics = await import('../internal-metrics');

    metrics.recordLlmCall(100);
    metrics.recordLlmCall(200);

    const snap = await metrics.getSnapshot();
    expect(snap.llm).toBeDefined();
  });

  it('getSnapshot has correct shape', async () => {
    const metrics = await import('../internal-metrics');
    const snap = await metrics.getSnapshot();

    expect(snap).toHaveProperty('uptime');
    expect(snap).toHaveProperty('memory');
    expect(snap).toHaveProperty('eventLoopLag');
    expect(snap).toHaveProperty('db');
    expect(snap).toHaveProperty('requests');
    expect(snap).toHaveProperty('llm');
    expect(snap).toHaveProperty('tools');
    expect(snap).toHaveProperty('mcpServers');

    expect(snap.requests).toHaveProperty('perMin');
    expect(snap.requests).toHaveProperty('errorRate');
    expect(snap.requests).toHaveProperty('history');
    expect(Array.isArray(snap.requests.history)).toBe(true);
  });

  it('updateMcpState appears in snapshot', async () => {
    const metrics = await import('../internal-metrics');

    metrics.updateMcpState('test-server', 'http://localhost:8020', 'online', 5);

    const snap = await metrics.getSnapshot();
    const server = snap.mcpServers.find(s => s.name === 'test-server');
    expect(server).toBeDefined();
    expect(server!.status).toBe('online');
    expect(server!.toolCount).toBe(5);
  });
});
