import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
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

vi.mock('../../config', () => ({
  config: {
    mcp: {
      perAttemptTimeoutMs: 5000,
      retryCount: 3,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 60_000,
      toolCacheTtlMs: 300_000,
    },
  },
}));

vi.mock('../../feature-flags', () => ({
  ff: {
    enableMcpCircuitBreaker: true,
    useCategoryToolSelection: true,
  },
}));

vi.mock('../../kg-agent/tools', () => ({
  kgSensorToolDefs: [
    { type: 'function', function: { name: 'kg_query', description: 'Query KG', parameters: {} } },
  ],
  isKgSensorTool: (name: string) => name === 'kg_query',
  handleKgSensorTool: vi.fn().mockResolvedValue('{"result": "kg data"}'),
}));

vi.mock('../../auth/permissions', () => ({
  isToolAllowed: vi.fn().mockResolvedValue(true),
  filterToolsForUser: vi.fn().mockImplementation((_userId: string, tools: any[]) => tools),
}));

vi.mock('../../auth/audit', () => ({
  audit: vi.fn(),
}));

vi.mock('../../metrics', () => ({
  toolCallsTotal: { inc: vi.fn() },
  mcpFailuresTotal: { inc: vi.fn() },
}));

vi.mock('../../internal-metrics', () => ({
  recordToolCall: vi.fn(),
}));

describe('tool-executor', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('dispatches KG sensor tools locally', async () => {
    const { callMcpTool } = await import('../tool-executor');
    const { handleKgSensorTool } = await import('../../kg-agent/tools');

    const result = await callMcpTool('kg_query', { query: 'test' }, 'user-1', 'user@test.com');

    expect(handleKgSensorTool).toHaveBeenCalledWith('kg_query', { query: 'test' });
    expect(result).toBe('{"result": "kg data"}');
  });

  it('denies tool call when governance rejects', async () => {
    const { isToolAllowed } = await import('../../auth/permissions');
    (isToolAllowed as any).mockResolvedValueOnce(false);

    const { callMcpTool } = await import('../tool-executor');
    const result = await callMcpTool('forbidden_tool', {}, 'user-1', 'user@test.com');

    expect(result).toContain('Zugriff verweigert');
  });

  it('returns error for unknown tool', async () => {
    // No MCP servers in DB
    mockQuery.mockResolvedValue({ rows: [] });
    // Stub fetch to reject (tools/list fails for all servers)
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const { callMcpTool } = await import('../tool-executor');
    const result = await callMcpTool('nonexistent_tool', {}, 'user-1');

    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
  });

  it('getMcpTools includes KG sensor tools', async () => {
    // All MCP servers fail — but KG tools are local
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    mockQuery.mockResolvedValue({ rows: [] });

    const { getMcpTools } = await import('../tool-executor');
    const tools = await getMcpTools();

    const kgTool = tools.find((t: any) => t.function.name === 'kg_query');
    expect(kgTool).toBeDefined();
  });
});
