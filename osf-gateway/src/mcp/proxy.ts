import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';
import { isToolAllowed, filterToolsForUser } from '../auth/permissions';
import { audit } from '../auth/audit';
import { getMcpTools, getMcpServersCached, callMcpTool } from '../chat/tool-executor';

const router = Router();

// Allowed JSON-RPC methods (whitelist)
const ALLOWED_METHODS = new Set([
  'initialize',
  'tools/list',
  'tools/call',
  'notifications/initialized',
]);

// POST / — JSON-RPC MCP proxy
// Routes tools to the correct MCP server via mcp_servers DB table (same as chat tool-executor).
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

    // ── tools/list: merge tools from ALL registered MCP servers ──
    if (method === 'tools/list') {
      const allTools = await getMcpTools();
      // Convert to MCP format
      const mcpTools = allTools.map((t: any) => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description || '',
        inputSchema: t.function?.parameters || t.inputSchema || {},
      }));
      // Governance filter
      const filtered = await filterToolsForUser(req.user!.userId, allTools);
      const allowedNames = new Set(filtered.map((t: any) => t.function?.name || t.name));
      const result = mcpTools.filter(t => allowedNames.has(t.name));
      res.json({ jsonrpc: '2.0', id, result: { tools: result } });
      return;
    }

    // ── tools/call: route to correct server via tool-executor ──
    if (method === 'tools/call' && params?.name) {
      // Governance check
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

      // Execute via tool-executor (handles server discovery, retries, circuit breaker)
      const resultText = await callMcpTool(params.name, params.arguments || {});
      let resultContent: any;
      try {
        resultContent = JSON.parse(resultText);
      } catch {
        resultContent = resultText;
      }

      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent) }],
        },
      });
      return;
    }

    // Fallback for other methods (initialize, notifications)
    res.json({ jsonrpc: '2.0', id, result: {} });
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
