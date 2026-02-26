import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pool, initSchema } from './db/pool';
import { logger, logSecurity } from './logger';
import { runRegistry } from './flows/run-registry';
import authRoutes from './auth/routes';
import chatRoutes from './chat/routes';
import mcpProxy from './mcp/proxy';
import agentRoutes from './agents/routes';
import challengeRoutes from './challenges/routes';
import chainRoutes from './chains/routes';
import flowRoutes from './flows/routes';
import codeAgentRoutes from './code-agents/routes';
import adminRoutes from './admin/routes';
import newsRoutes from './news/routes';
import marketplaceRoutes from './marketplace/routes';
import { initNodeRedProxy } from './nodered/proxy';
import { NrPodManager } from './nodered/pod-manager';
import internalApiRoutes from './nodered/internal-api';
import { getLlmStatus } from './chat/llm-client';
import unsRoutes from './uns/stream';
import { requireAuth } from './auth/middleware';

const PORT = parseInt(process.env.PORT || '8080', 10);
let httpServer: http.Server;
let nrPodManager: NrPodManager;

async function main() {
  await initSchema();

  const app = express();

  // Security headers
  const editorHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://openshopfloor.zeroguess.ai'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameAncestors: ["'self'", 'https://openshopfloor.zeroguess.ai'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  });
  const defaultHelmet = helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    permittedCrossDomainPolicies: false,
  });
  // Permissions-Policy header (helmet doesn't support it natively)
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/flows/editor')) {
      editorHelmet(req, res, next);
    } else {
      defaultHelmet(req, res, next);
    }
  });

  // Trust proxy (behind cloudflared)
  app.set('trust proxy', 1);

  // Request ID middleware
  app.use((req, _res, next) => {
    req.requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
    next();
  });

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logData = {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 100),
      };
      if (res.statusCode >= 400) {
        logger.warn(logData, 'request');
      } else {
        logger.info(logData, 'request');
      }
    });
    next();
  });

  // CORS
  const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
  const ALLOWED_ORIGINS = [
    'https://openshopfloor.zeroguess.ai',
    'https://osf-api.zeroguess.ai',
    'http://localhost:3000',
    'http://localhost:3001',
    ...EXTRA_ORIGINS,
  ];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        logSecurity('cors.blocked', { origin });
        callback(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  }));
  app.use(cookieParser());
  // Skip body parsing for proxied NR editor routes — http-proxy needs the raw stream
  app.use((req, res, next) => {
    if (req.path.startsWith('/flows/editor') && req.method !== 'GET') {
      return next();
    }
    express.json({ limit: '5mb' })(req, res, next);
  });

  // CSRF protection for state-changing requests from browsers
  app.use((req, res, next) => {
    // Skip safe methods and API-key auth
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-api-key']) return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // If there's an origin header, it must match allowed origins
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'CSRF: Origin not allowed' });
      return;
    }

    // If there's a referer but no origin, check referer
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (!ALLOWED_ORIGINS.includes(refOrigin)) {
        res.status(403).json({ error: 'CSRF: Referer not allowed' });
        return;
      }
    }

    next();
  });

  // Health check (no auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness probe — checks DB connectivity
  app.get('/health/ready', async (_req, res) => {
    const { checkDbReady } = await import('./db/pool');
    const dbOk = await checkDbReady();
    if (dbOk) {
      res.json({ status: 'ready', db: 'ok' });
    } else {
      res.status(503).json({ status: 'not_ready', db: 'unreachable' });
    }
  });

  // LLM status check (no auth, lightweight)
  const LLM_URL_FREE = process.env.LLM_URL_FREE || 'http://192.168.178.120:5002';
  const LLM_URL_PREMIUM = process.env.LLM_URL_PREMIUM || 'http://192.168.178.120:5001';

  app.get('/llm/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'max-age=5');
    try {
      const urls = [LLM_URL_FREE, LLM_URL_PREMIUM];
      const checks = await Promise.allSettled(
        urls.map(url =>
          fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(3000) })
            .then(r => ({ url, reachable: r.ok }))
        )
      );

      const reachable = checks.some(
        r => r.status === 'fulfilled' && r.value.reachable
      );

      if (!reachable) {
        res.json({
          online: false,
          servers: [],
          message: 'Der LLM-Server ist gerade offline. OpenShopFloor ist ein Open-Source-Projekt — ab und zu braucht auch die Hardware eine Pause. Bitte versuche es später erneut.',
        });
        return;
      }

      const queueInfo = getLlmStatus();
      // Strip internal URLs from public response
      const safeServers = queueInfo.servers.map((s, i) => ({
        name: `llm-${i}`,
        active: s.active,
        queued: s.queued,
      }));
      res.json({ online: true, servers: safeServers });
    } catch {
      res.json({ online: false, servers: [], message: 'LLM-Status konnte nicht abgefragt werden.' });
    }
  });

  // V7 Gateway Proxy (deep analysis agents)
  const V7_BASE = 'http://192.168.178.150:30813';

  // In-memory store for V7 agent results (sessionId → result)
  // The POST to V7 blocks 2-5min, but we return 202 immediately.
  // The result is captured async and stored here for the frontend to fetch.
  const V7_MAX_ENTRIES = 500;
  const v7Results = new Map<string, { result: any; timestamp: number }>();
  // Cleanup old results every 5 minutes + enforce max size
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of v7Results) {
      if (val.timestamp < cutoff) v7Results.delete(key);
    }
  }, 5 * 60 * 1000);

  // GET /v7/llm-status — check if LLM server is online (public, no auth)
  const FACTORY_SIM_BASE = process.env.FACTORY_SIM_URL || 'http://factory-v3-fertigung:8888';
  app.get('/v7/llm-status', async (_req, res) => {
    try {
      const upstream = await fetch(`${FACTORY_SIM_BASE}/api/infrastructure/metrics?minutes=1`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!upstream.ok) {
        res.json({ llmOnline: false });
        return;
      }
      const data: any = await upstream.json();
      const llmHost = (data.hosts || []).find((h: any) => h.hostname?.includes('llm') || h.has_gpu);
      res.json({ llmOnline: llmHost?.online === true });
    } catch {
      res.json({ llmOnline: false });
    }
  });

  // GET /v7/agents — list available V7 agents
  app.get('/v7/agents', async (_req, res) => {
    try {
      const upstream = await fetch(`${V7_BASE}/api/agents`);
      const data = await upstream.json();
      res.json(data);
    } catch (err: any) {
      logger.error({ err: err.message }, 'V7 proxy /agents failed');
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });

  // POST /v7/agents/:agent/execute — fire-and-forget, return 202 immediately
  // The V7 POST blocks until the agent finishes (2-5 min), which exceeds
  // Cloudflare's 100s timeout. We return 202 immediately, capture the result
  // async, and store it for GET /v7/result/:sessionId.
  app.post('/v7/agents/:agent/execute', requireAuth, async (req, res) => {
    const { agent } = req.params;
    const sessionId = req.body.sessionId;
    try {
      // Fire the upstream request but don't await the full response
      const upstream = fetch(`${V7_BASE}/api/agents/${agent}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      // Wait briefly (2s) for quick validation errors, then return 202
      const quickCheck = Promise.race([
        upstream.then(async (r) => {
          if (!r.ok && r.status < 500) {
            const text = await r.text();
            return { error: true, status: r.status, text };
          }
          return { error: false, response: r };
        }),
        new Promise<{ error: false; response?: any }>((resolve) => setTimeout(() => resolve({ error: false }), 2000)),
      ]);
      const check = await quickCheck;
      if (check.error) {
        res.status((check as any).status).json({ error: (check as any).text });
        return;
      }
      // Return immediately — results come via SSE + GET /v7/result/:sessionId
      res.status(202).json({ accepted: true, sessionId, agent });

      // Capture the V7 response asynchronously and store it
      if (sessionId) {
        (check.response ? Promise.resolve(check.response) : upstream)
          .then(async (r: any) => {
            if (r.ok) {
              const data = await r.json();
              // Evict oldest entry if at capacity
              if (v7Results.size >= V7_MAX_ENTRIES) {
                const oldest = v7Results.keys().next().value;
                if (oldest) v7Results.delete(oldest);
              }
              v7Results.set(sessionId, { result: data, timestamp: Date.now() });
              logger.info({ sessionId, agent }, 'V7 result captured');
            }
          })
          .catch((err: any) => {
            logger.warn({ sessionId, err: err.message }, 'V7 result capture failed');
          });
      }
    } catch (err: any) {
      logger.error({ err: err.message }, `V7 proxy /agents/${agent}/execute failed`);
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });

  // GET /v7/result/:sessionId — fetch stored agent result (after done event)
  app.get('/v7/result/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    const entry = v7Results.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Result not ready yet' });
      return;
    }
    res.json(entry.result);
  });

  // GET /v7/progress/:sessionId — SSE proxy (chunked streaming)
  app.get('/v7/progress/:sessionId', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.flushHeaders();

    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const upstream = await fetch(`${V7_BASE}/api/progress/${sessionId}`);
      if (!upstream.ok || !upstream.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'V7 upstream error' })}\n\n`);
        res.end();
        return;
      }
      const reader = (upstream.body as any).getReader();
      const decoder = new TextDecoder();
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      reader.cancel().catch(() => {});
    } catch (err: any) {
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    }
    if (!aborted) res.end();
  });

  // POST /v7/agents/:agent/stop — stop a running agent
  app.post('/v7/agents/:agent/stop', requireAuth, async (req, res) => {
    const { agent } = req.params;
    try {
      const upstream = await fetch(`${V7_BASE}/api/agents/${agent}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await upstream.json();
      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });

  // Catch-all V7 API proxy — proxies /v7-api/* to V7 gateway /api/*
  // Used by the embedded V7 chat UI (deep-analysis.html)
  app.all('/v7-api/*', requireAuth, async (req, res) => {
    // Fully decode + normalize to prevent double-encoding bypass (%252e etc.)
    const raw = req.originalUrl.replace('/v7-api/', '/api/');
    let normalized: string;
    try {
      const parsed = new URL(raw, V7_BASE);
      normalized = parsed.pathname + parsed.search;
    } catch {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    // After full URL parsing, check the resolved path
    if (!normalized.startsWith('/api/') || normalized.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const url = `${V7_BASE}${normalized}`;
    try {
      const headers: Record<string, string> = {};
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;
      if (req.headers['accept']) headers['Accept'] = req.headers['accept'] as string;

      const fetchOpts: any = { method: req.method, headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOpts.body = JSON.stringify(req.body);
      }

      const upstream = await fetch(url, fetchOpts);

      // Check if SSE response
      const ct = upstream.headers.get('content-type') || '';
      if (ct.includes('text/event-stream')) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        let aborted = false;
        req.on('close', () => { aborted = true; });
        const reader = (upstream.body as any).getReader();
        const decoder = new TextDecoder();
        try {
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch {}
        reader.cancel().catch(() => {});
        if (!aborted) res.end();
        return;
      }

      // Regular JSON/text response
      res.status(upstream.status);
      for (const [key, value] of upstream.headers) {
        if (!['transfer-encoding', 'content-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      const body = await upstream.text();
      res.send(body);
    } catch (err: any) {
      logger.error({ err: err.message, path: apiPath }, 'V7-API proxy failed');
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });

  // UNS live stream (MQTT → SSE)
  app.use('/uns', unsRoutes);

  // Internal API for NR pods (authenticated via pod secret, no user auth)
  app.use('/internal', internalApiRoutes);

  // Routes
  app.use('/auth', authRoutes);
  app.use('/chat', chatRoutes);
  app.use('/mcp', mcpProxy);
  app.use('/agents', agentRoutes);
  app.use('/challenges', challengeRoutes);
  app.use('/chains', chainRoutes);
  app.use('/flows', flowRoutes);
  app.use('/code-agents', codeAgentRoutes);
  app.use('/admin', adminRoutes);
  app.use('/news', newsRoutes);
  app.use('/marketplace', marketplaceRoutes);

  // Create HTTP server (before NR proxy which needs it for WebSocket upgrades)
  httpServer = http.createServer(app);

  // Initialize NR Pod Manager + Reverse Proxy BEFORE 404 handler
  // (otherwise the 404 catch-all intercepts /flows/auth/session etc.)
  if (process.env.NR_DISABLED !== 'true') {
    nrPodManager = new NrPodManager();
    await initNodeRedProxy(app, httpServer, nrPodManager);
    // Init pod manager (warm pool) after proxy is set up
    nrPodManager.init().catch(err => {
      logger.error({ err: err.message }, 'NR Pod Manager init failed (will retry on first request)');
    });

    // Export pod manager for admin routes
    (app as any).nrPodManager = nrPodManager;
  } else {
    logger.info('NR_DISABLED=true — skipping NR Pod Manager');
  }

  // Custom 404 handler (prevents Express default HTML error page)
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === 'CORS not allowed') {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    logger.error({ err: err.message }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'osf-gateway started');
  });
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown...');

  // 1. Stop accepting new flows
  runRegistry.stopAccepting();

  // 2. Shutdown NR pod manager (cleanup pods)
  if (nrPodManager) {
    await nrPodManager.shutdown().catch(err => {
      logger.error({ err: err.message }, 'NR Pod Manager shutdown error');
    });
  }

  // 3. Stop accepting new HTTP connections
  httpServer?.close();

  // 3. Wait up to 4 minutes for active flows to finish
  const timedOut = await runRegistry.drainOrTimeout(240_000);

  // 4. Mark timed-out runs as failed in DB
  if (timedOut.length > 0) {
    logger.warn({ runIds: timedOut }, 'Marking timed-out runs as failed');
    for (const runId of timedOut) {
      try {
        await pool.query(
          `UPDATE flow_runs SET status = 'failed', finished_at = NOW() WHERE id = $1 AND status = 'running'`,
          [runId]
        );
      } catch (err: any) {
        logger.error({ runId, err: err.message }, 'Failed to mark run as failed');
      }
    }
  }

  // 5. Close DB pool and exit
  await pool.end();
  logger.info('Graceful shutdown complete');
  process.exit(0);
});
