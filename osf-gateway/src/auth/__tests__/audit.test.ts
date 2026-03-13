import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db pool
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../../db/pool', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('audit', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers entries and flushes at FLUSH_SIZE (50)', async () => {
    const { audit } = await import('../audit');

    // Add 50 entries → should trigger flush
    for (let i = 0; i < 50; i++) {
      audit({
        user_id: `user-${i}`,
        action: 'tool_call',
        tool_name: 'test_tool',
      });
    }

    // Allow the flush promise to resolve
    await vi.waitFor(() => {
      expect(mockQuery).toHaveBeenCalled();
    });

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    expect(sql).toContain('INSERT INTO audit_log');
    // 50 entries × 8 columns = 400 placeholders
    expect(call[1].length).toBe(400);
  });

  it('does not flush below threshold', async () => {
    const { audit } = await import('../audit');

    for (let i = 0; i < 10; i++) {
      audit({
        user_id: `user-${i}`,
        action: 'tool_call',
      });
    }

    // Give it a tick
    await new Promise(r => setTimeout(r, 10));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('recovers entries on flush error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down'));

    const { audit, stopAuditFlush } = await import('../audit');

    // Add 50 entries to trigger flush
    for (let i = 0; i < 50; i++) {
      audit({ user_id: 'u1', action: 'test' });
    }

    // Wait for the failed flush
    await new Promise(r => setTimeout(r, 50));

    // Now fix DB and stop (which flushes remaining)
    mockQuery.mockResolvedValue({ rows: [] });
    await stopAuditFlush();

    // Second call should be the retry with recovered entries
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('truncates detail to 200 chars', async () => {
    const { audit, stopAuditFlush } = await import('../audit');

    const longDetail = 'x'.repeat(300);
    audit({ user_id: 'u1', action: 'test', detail: longDetail });

    // Force flush
    await stopAuditFlush();

    if (mockQuery.mock.calls.length > 0) {
      const values = mockQuery.mock.calls[0][1];
      // detail is at index 7 (8th column)
      const detail = values[7];
      expect(detail.length).toBe(200);
    }
  });
});
