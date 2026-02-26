import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';

const MCP_URL = process.env.MCP_URL || 'http://factory-v3-fertigung:8020';

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

    const resp = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc, id, method, params }),
    });

    const data = await resp.json();
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
