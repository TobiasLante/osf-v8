import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
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

describe('permissions', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
  });

  it('isToolAllowed returns true when __all__ (tables missing)', async () => {
    // Simulate tables not existing — query throws
    mockQuery.mockRejectedValue(new Error('relation does not exist'));

    const { isToolAllowed } = await import('../permissions');
    const allowed = await isToolAllowed('user-1', 'any_tool');
    expect(allowed).toBe(true);
  });

  it('isToolAllowed returns true for approved tool in user category', async () => {
    // First call: loadUserCategories
    mockQuery.mockResolvedValueOnce({
      rows: [{ category_id: 'production' }],
    });
    // Second call: loadAllowedTools
    mockQuery.mockResolvedValueOnce({
      rows: [{ tool_name: 'query_oee' }, { tool_name: 'query_erp' }],
    });

    const { isToolAllowed } = await import('../permissions');
    const allowed = await isToolAllowed('user-1', 'query_oee');
    expect(allowed).toBe(true);
  });

  it('isToolAllowed returns false for unknown tool when governance is active', async () => {
    // loadUserCategories
    mockQuery.mockResolvedValueOnce({
      rows: [{ category_id: 'production' }],
    });
    // loadAllowedTools: COUNT check (governance active)
    mockQuery.mockResolvedValueOnce({
      rows: [{ c: '5' }],
    });
    // loadAllowedTools: SELECT tool_name
    mockQuery.mockResolvedValueOnce({
      rows: [{ tool_name: 'query_oee' }],
    });
    // Check if tool is classified
    mockQuery.mockResolvedValueOnce({
      rows: [], // Not classified
    });

    const { isToolAllowed } = await import('../permissions');
    const allowed = await isToolAllowed('user-1', 'unknown_tool');
    expect(allowed).toBe(false);
  });

  it('uses cache on second call', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ category_id: 'production' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ tool_name: 'query_oee' }],
    });

    const { isToolAllowed } = await import('../permissions');

    await isToolAllowed('user-cached', 'query_oee');
    const queryCountAfterFirst = mockQuery.mock.calls.length;

    await isToolAllowed('user-cached', 'query_oee');
    // Should not have made additional DB calls (cached)
    expect(mockQuery.mock.calls.length).toBe(queryCountAfterFirst);
  });

  it('invalidatePermissionCache clears cache', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ category_id: 'production' }],
    });

    const { isToolAllowed, invalidatePermissionCache } = await import('../permissions');

    await isToolAllowed('user-inv', 'any');
    const count1 = mockQuery.mock.calls.length;

    invalidatePermissionCache('user-inv');

    // Re-mock for the next resolution
    mockQuery.mockResolvedValueOnce({ rows: [{ category_id: 'production' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ tool_name: 'any' }] });

    await isToolAllowed('user-inv', 'any');
    expect(mockQuery.mock.calls.length).toBeGreaterThan(count1);
  });

  it('filterToolsForUser returns all when __all__', async () => {
    mockQuery.mockRejectedValue(new Error('relation does not exist'));

    const { filterToolsForUser } = await import('../permissions');
    const tools = [
      { function: { name: 'tool_a' } },
      { function: { name: 'tool_b' } },
    ];
    const filtered = await filterToolsForUser('user-1', tools);
    expect(filtered).toHaveLength(2);
  });

  it('filterToolsForUser filters to allowed tools only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ category_id: 'prod' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '5' }] }); // COUNT check
    mockQuery.mockResolvedValueOnce({ rows: [{ tool_name: 'tool_a' }] });

    const { filterToolsForUser } = await import('../permissions');
    const tools = [
      { function: { name: 'tool_a' } },
      { function: { name: 'tool_b' } },
    ];
    const filtered = await filterToolsForUser('user-2', tools);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].function.name).toBe('tool_a');
  });
});
