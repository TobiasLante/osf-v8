import express from 'express';
import { llmRouter } from './llm-proxy';
import { mcpRouter } from './mcp-proxy';
import { fdaRouter } from './fda-api';

const app = express();
const PORT = parseInt(process.env.PORT || '3101', 10);

// CORS
const allowedOrigins = [
  'http://localhost:3100',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Allow non-browser requests (curl, etc.)
    res.setHeader('Access-Control-Allow-Origin', '*');
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
app.use(express.json({ limit: '10mb' }));

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.2.0', timestamp: new Date().toISOString() });
});

// Routes
app.use(llmRouter);
app.use(mcpRouter);
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
