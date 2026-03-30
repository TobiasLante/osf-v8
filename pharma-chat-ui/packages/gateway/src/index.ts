import express from 'express';
import { llmRouter } from './llm-proxy';
import { mcpRouter } from './mcp-proxy';
import { i3xRouter } from './i3x-proxy';
import { fdaRouter } from './fda-api';

const app = express();
const PORT = parseInt(process.env.PORT || '3101', 10);

// ── Rate limiting (in-memory, per IP) ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60', 10);

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    return;
  }
  next();
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);

// ── CORS ──
const allowedOrigins = new Set([
  'http://localhost:3100',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Body parser
app.use(express.json({ limit: '2mb' }));

// Rate limit on mutation endpoints
app.use('/api/chat', rateLimit);
app.use('/api/tools/call', rateLimit);
app.use('/api/enrich', rateLimit);

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.2.0', timestamp: new Date().toISOString() });
});

// Routes
app.use(llmRouter);
app.use(mcpRouter);
app.use(i3xRouter);
app.use(fdaRouter);

// Start
const server = app.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
  console.log(`[gateway] MCP_URL = ${process.env.MCP_URL || 'http://192.168.178.150:30900'}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[gateway] ${signal} received, shutting down...`);
  server.close(() => {
    console.log('[gateway] closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
