import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

const mockQuery = vi.fn();
vi.mock('../../db/pool', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

vi.mock('../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Skip auth middleware for tests
vi.mock('../../auth/middleware', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

async function createTestServer() {
  const app = express();

  // Dynamic import after mocks are set up
  const { default: auditExportRoutes } = await import('../audit-export');
  app.use('/admin/audit', auditExportRoutes);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  return { server, port: addr.port };
}

describe('audit-export', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns 400 when "from" is missing', async () => {
    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/admin/audit/export`);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('from');
    } finally {
      server.close();
    }
  });

  it('returns 400 for invalid date', async () => {
    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/admin/audit/export?from=not-a-date`);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('Invalid date');
    } finally {
      server.close();
    }
  });

  it('returns 400 when range exceeds 90 days', async () => {
    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2025-01-01&to=2025-12-31`
      );
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('90 days');
    } finally {
      server.close();
    }
  });

  it('returns 400 for invalid format', async () => {
    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2026-03-01&format=xml`
      );
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('format');
    } finally {
      server.close();
    }
  });

  it('exports CSV with BOM and header row', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          ts: '2026-03-01T10:00:00Z',
          user_id: 'u1',
          user_email: 'test@example.com',
          action: 'tool_call',
          tool_name: 'query_erp',
          tool_category: 'production',
          source: 'chat',
          ip_address: '1.2.3.4',
          detail: 'test detail',
        },
      ],
    });

    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2026-03-01&to=2026-03-13&format=csv`
      );
      expect(resp.status).toBe(200);

      const contentType = resp.headers.get('content-type');
      expect(contentType).toContain('text/csv');

      const disposition = resp.headers.get('content-disposition');
      expect(disposition).toContain('audit-export-');
      expect(disposition).toContain('.csv');

      const buf = Buffer.from(await resp.arrayBuffer());
      // UTF-8 BOM: EF BB BF
      expect(buf[0]).toBe(0xEF);
      expect(buf[1]).toBe(0xBB);
      expect(buf[2]).toBe(0xBF);
      const text = buf.toString('utf-8');
      // Header row
      expect(text).toContain('id,ts,user_id,user_email,action');
      // Data row
      expect(text).toContain('test@example.com');
      expect(text).toContain('query_erp');
    } finally {
      server.close();
    }
  });

  it('exports JSON array', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          ts: '2026-03-01T10:00:00Z',
          user_id: 'u1',
          user_email: 'test@example.com',
          action: 'tool_call',
          tool_name: 'query_erp',
          tool_category: null,
          source: 'chat',
          ip_address: null,
          detail: null,
        },
      ],
    });

    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2026-03-01&to=2026-03-13&format=json`
      );
      expect(resp.status).toBe(200);

      const contentType = resp.headers.get('content-type');
      expect(contentType).toContain('application/json');

      const text = await resp.text();
      const data = JSON.parse(text);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].user_email).toBe('test@example.com');
    } finally {
      server.close();
    }
  });

  it('returns empty CSV for no results', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2026-03-01&to=2026-03-13`
      );
      expect(resp.status).toBe(200);

      const text = await resp.text();
      const lines = text.split('\n').filter(l => l.trim());
      // BOM + header only
      expect(lines).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('returns empty JSON array for no results', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const { server, port } = await createTestServer();
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/admin/audit/export?from=2026-03-01&to=2026-03-13&format=json`
      );
      const text = await resp.text();
      const data = JSON.parse(text);
      expect(data).toEqual([]);
    } finally {
      server.close();
    }
  });
});
