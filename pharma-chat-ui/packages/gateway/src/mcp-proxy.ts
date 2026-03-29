import { Router, Request, Response } from 'express';
import type { IRouter } from 'express';

const MCP_URL = process.env.MCP_URL || 'http://192.168.178.150:30900';

export const mcpRouter: IRouter = Router();

// Fetch tool list from MCP server
mcpRouter.get('/api/tools', async (_req: Request, res: Response) => {
  try {
    const tools = await mcpListTools();
    res.json({ tools });
  } catch (err: any) {
    console.error('[mcp-proxy] tools/list error:', err.message);
    res.status(502).json({ error: `MCP unreachable: ${err.message}` });
  }
});

// Forward tool call to MCP server
mcpRouter.post('/api/tools/call', async (req: Request, res: Response) => {
  const { name, arguments: args } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Missing tool name' });
    return;
  }

  try {
    const result = await mcpCallTool(name, args || {});
    res.json({ result });
  } catch (err: any) {
    console.error(`[mcp-proxy] tools/call ${name} error:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

// Stats proxy
mcpRouter.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${MCP_URL}/i3x/v0/objecttypes`);
    if (!resp.ok) {
      res.status(resp.status).json({ error: `MCP stats error: ${resp.status}` });
      return;
    }
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    console.error('[mcp-proxy] stats error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Internal helpers (also used by llm-proxy) ──

export async function mcpListTools() {
  const resp = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
  const data: any = await resp.json();
  return data.result?.tools || [];
}

export async function mcpCallTool(name: string, args: Record<string, any>) {
  const resp = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!resp.ok) throw new Error(`MCP tool HTTP ${resp.status}`);
  const data: any = await resp.json();
  if (data.error) throw new Error(data.error.message || 'MCP tool error');
  return data.result;
}
