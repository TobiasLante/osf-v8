import { Router, Request, Response } from 'express';
import type { IRouter } from 'express';

const MCP_URL = process.env.MCP_URL || 'http://192.168.178.150:30900';

export const mcpRouter: IRouter = Router();

// Fetch tool list from MCP server
mcpRouter.get('/api/tools', async (_req: Request, res: Response) => {
  try {
    const tools = await mcpListTools();
    res.json(tools);
  } catch (err: any) {
    console.error('[mcp-proxy] tools/list error:', err.message);
    res.status(502).json({ error: 'MCP server unreachable' });
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
    res.status(502).json({ error: 'Tool call failed' });
  }
});

// ── Internal helpers (also used by llm-proxy) ──

const MCP_TIMEOUT_MS = 15_000;

export async function mcpListTools() {
  const resp = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
  const data: any = await resp.json();
  return data.result?.tools || [];
}

export async function mcpCallTool(name: string, args: Record<string, any>): Promise<string> {
  const resp = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`MCP tool HTTP ${resp.status}`);
  const data: any = await resp.json();
  if (data.error) throw new Error(data.error.message || 'MCP tool error');

  // MCP returns {content: [{type: "text", text: "..."}]}.
  // Extract the actual text so the LLM sees clean data, not a nested envelope.
  const result = data.result;
  if (result?.content && Array.isArray(result.content)) {
    const textParts = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text);
    return textParts.join('\n');
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}
