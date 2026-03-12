import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';
import { isToolAllowed, filterToolsForUser } from '../auth/permissions';
import { audit } from '../auth/audit';
import { getMcpTools } from '../chat/tool-executor';

const MCP_URL = process.env.MCP_URL || 'http://localhost:8020';

const router = Router();

// Allowed JSON-RPC methods (whitelist)
const ALLOWED_METHODS = new Set([
  'initialize',
  'tools/list',
  'tools/call',
  'notifications/initialized',
]);

// POST /mcp — JSON-RPC proxy to factory MCP server
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    // Rate limit: 20 MCP calls per minute per user
    if (!checkRateLimit(`mcp:${req.user!.userId}`, 20)) {
      res.status(429).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: { code: -32000, message: 'Rate limit exceeded' },
      });
      return;
    }

    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0' || !method) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
      });
      return;
    }

    // Method whitelist
    if (!ALLOWED_METHODS.has(method)) {
      logSecurity('mcp.method.blocked', { method, userId: req.user!.userId });
      res.status(403).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32601, message: `Method '${method}' not allowed` },
      });
      return;
    }

    // Governance: filter tools/list response, check tools/call permission
    if (method === 'tools/call' && params?.name) {
      const allowed = await isToolAllowed(req.user!.userId, params.name);
      if (!allowed) {
        audit({
          user_id: req.user!.userId,
          user_email: req.user!.email,
          action: 'tool_denied',
          tool_name: params.name,
          source: 'mcp_proxy',
          ip_address: req.ip,
          detail: 'MCP proxy tool call denied by governance',
        });
        res.status(403).json({
          jsonrpc: '2.0',
          id: id || null,
          error: { code: -32001, message: `Zugriff verweigert: Tool "${params.name}" ist fuer Ihre Rolle nicht freigegeben.` },
        });
        return;
      }
      audit({
        user_id: req.user!.userId,
        user_email: req.user!.email,
        action: 'tool_call',
        tool_name: params.name,
        source: 'mcp_proxy',
        ip_address: req.ip,
      });
    }

    const resp = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc, id, method, params }),
    });

    const data: any = await resp.json();

    // Governance: filter tools/list response to only allowed tools
    if (method === 'tools/list' && data.result?.tools) {
      const allTools = data.result.tools.map((t: any) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      const filtered = await filterToolsForUser(req.user!.userId, allTools);
      const allowedNames = new Set(filtered.map((t: any) => t.function.name));
      data.result.tools = data.result.tools.filter((t: any) => allowedNames.has(t.name));
    }

    res.json(data);
  } catch (err: any) {
    logger.error({ err: err.message }, 'MCP proxy error');
    res.status(502).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32000, message: 'MCP server unavailable' },
    });
  }
});

export default router;
