/**
 * Governance Agent — HTTP service for LLM-based tool classification.
 * Port 8031 (configurable via GOVERNANCE_PORT).
 *
 * Endpoints:
 *   POST /classify       — classify a single tool
 *   POST /classify-batch — classify an array of tools
 *   GET  /health         — health check
 */

import http from 'node:http';
import { classifyTool, classifyBatch, ToolInput } from './classifier';

const logger = {
  info: (...args: any[]) => console.log(new Date().toISOString(), 'INFO', ...args),
  warn: (...args: any[]) => console.warn(new Date().toISOString(), 'WARN', ...args),
  error: (...args: any[]) => console.error(new Date().toISOString(), 'ERROR', ...args),
};

const PORT = parseInt(process.env.GOVERNANCE_PORT || '8031', 10);

const MAX_BODY = 1_048_576; // 1 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const GOVERNANCE_API_KEY = process.env.GOVERNANCE_API_KEY || '';

let classifiedCount = 0;
const startTime = Date.now();

function checkApiKey(req: http.IncomingMessage): boolean {
  if (!GOVERNANCE_API_KEY) return true; // No key configured — skip auth (backwards compatible)
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ') && header.slice(7) === GOVERNANCE_API_KEY) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // GET /health — no auth required
    if (url === '/health' && method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'governance-agent',
        version: '1.0.0',
        uptime_s: Math.floor((Date.now() - startTime) / 1000),
        classified_total: classifiedCount,
      });
      return;
    }

    // API key auth for POST endpoints
    if (method === 'POST' && !checkApiKey(req)) {
      sendJson(res, 401, { error: 'Unauthorized: invalid or missing API key' });
      return;
    }

    // POST /classify — single tool
    if (url === '/classify' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const tool: ToolInput = { name: body.name, description: body.description || '' };

      if (!tool.name) {
        sendJson(res, 400, { error: 'name is required' });
        return;
      }

      const result = await classifyTool(tool);
      classifiedCount++;
      sendJson(res, 200, result);
      return;
    }

    // POST /classify-batch — array of tools
    if (url === '/classify-batch' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const tools: ToolInput[] = body.tools;

      if (!Array.isArray(tools) || tools.length === 0) {
        sendJson(res, 400, { error: 'tools array is required' });
        return;
      }

      if (tools.length > 200) {
        sendJson(res, 400, { error: 'Maximum 200 tools per batch' });
        return;
      }

      logger.info(`Classifying batch of ${tools.length} tools...`);
      const results = await classifyBatch(tools);
      classifiedCount += tools.length;

      // Return paired array: tool name → classification
      const classifications = tools.map((t, i) => ({
        tool_name: t.name,
        tool_description: t.description,
        category: results[i].category,
        sensitivity: results[i].sensitivity,
      }));

      sendJson(res, 200, { classifications });
      return;
    }

    // 404
    sendJson(res, 404, { error: 'Not found' });
  } catch (err: any) {
    logger.error(`Error handling ${method} ${url}:`, err.message);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  logger.info(`Governance Agent listening on :${PORT}`);
  logger.info(`  POST /classify       — classify single tool`);
  logger.info(`  POST /classify-batch — classify tool batch`);
  logger.info(`  GET  /health         — health check`);
});

// Graceful shutdown
process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down'); server.close(); });
process.on('SIGINT', () => { logger.info('SIGINT received, shutting down'); server.close(); });
