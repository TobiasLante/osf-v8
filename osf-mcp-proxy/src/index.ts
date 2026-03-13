import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
});

const PORT = parseInt(process.env.PORT || '8034', 10);
const MCP_FACTORY_URL = process.env.MCP_FACTORY_URL || process.env.MCP_URL || 'http://localhost:8020';
const MCP_HISTORIAN_URL = process.env.MCP_HISTORIAN_URL || 'http://localhost:8030';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://osf-gateway:8012';
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// ─── JWT Auth Middleware ────────────────────────────────────────────────

interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as unknown as JwtPayload;
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  }

  res.status(401).json({ error: 'Missing Authorization header' });
}

// ─── Governance: Tool Permission Check via Gateway API ─────────────────

async function isToolAllowed(userId: string, toolName: string): Promise<boolean> {
  try {
    const resp = await fetch(`${GATEWAY_URL}/admin/check-tool-permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({ userId, toolName }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return true; // Fallback: allow if gateway unreachable
    const data = await resp.json() as { allowed: boolean };
    return data.allowed;
  } catch {
    return true; // Fallback: allow if governance check fails
  }
}

async function filterToolsForUser(userId: string, tools: any[]): Promise<string[]> {
  try {
    const resp = await fetch(`${GATEWAY_URL}/admin/filter-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.INTERNAL_SECRET || '' },
      body: JSON.stringify({ userId, toolNames: tools.map((t: any) => t.name) }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return tools.map((t: any) => t.name); // Fallback: allow all
    const data = await resp.json() as { allowed: string[] };
    return data.allowed;
  } catch {
    return tools.map((t: any) => t.name); // Fallback: allow all
  }
}

// ─── Rate Limiting (simple in-memory) ──────────────────────────────────

const rateLimitWindows = new Map<string, number[]>();

function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const timestamps = rateLimitWindows.get(key) || [];
  const valid = timestamps.filter(t => now - t < 60_000);
  if (valid.length >= maxPerMinute) {
    rateLimitWindows.set(key, valid);
    return false;
  }
  valid.push(now);
  rateLimitWindows.set(key, valid);
  return true;
}

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitWindows.entries()) {
    const valid = timestamps.filter(t => now - t < 60_000);
    if (valid.length === 0) rateLimitWindows.delete(key);
    else rateLimitWindows.set(key, valid);
  }
}, 5 * 60_000).unref();

// ─── Allowed JSON-RPC methods ──────────────────────────────────────────

const ALLOWED_METHODS = new Set([
  'initialize',
  'tools/list',
  'tools/call',
  'notifications/initialized',
]);

// ─── Express App ───────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'osf-mcp-proxy',
    mcpFactoryUrl: MCP_FACTORY_URL,
    mcpHistorianUrl: MCP_HISTORIAN_URL,
  });
});

// POST /mcp — JSON-RPC proxy
app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
  try {
    // Rate limit
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
      logger.warn({ method, userId: req.user!.userId }, 'MCP method blocked');
      res.status(403).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32601, message: `Method '${method}' not allowed` },
      });
      return;
    }

    // Governance: check tools/call permission
    if (method === 'tools/call' && params?.name) {
      const allowed = await isToolAllowed(req.user!.userId, params.name);
      if (!allowed) {
        res.status(403).json({
          jsonrpc: '2.0',
          id: id || null,
          error: { code: -32001, message: `Zugriff verweigert: Tool "${params.name}" ist fuer Ihre Rolle nicht freigegeben.` },
        });
        return;
      }
    }

    const resp = await fetch(`${MCP_FACTORY_URL}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc, id, method, params }),
    });

    const data: any = await resp.json();

    // Governance: filter tools/list response
    if (method === 'tools/list' && data.result?.tools) {
      const allowedNames = await filterToolsForUser(req.user!.userId, data.result.tools);
      const allowedSet = new Set(allowedNames);
      data.result.tools = data.result.tools.filter((t: any) => allowedSet.has(t.name));
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

// ─── Start ─────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'MCP Proxy HTTP server started');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  process.exit(0);
});
