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
import { validateEncryptionKey } from './auth/crypto';

const PORT = parseInt(process.env.PORT || '8012', 10);
let httpServer: http.Server;
let nrPodManager: NrPodManager;

async function main() {
  // Validate critical env vars early
  validateEncryptionKey();

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
        scriptSrcAttr: ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  });
  const defaultHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://openshopfloor.zeroguess.ai'],
        frameAncestors: ["'none'"],
      },
    },
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
    if (req.path.startsWith('/demo-ui')) {
      return next(); // Skip helmet for proxied chat-ui (needs iframe embedding)
    } else if (req.path.startsWith('/flows/editor')) {
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
  const IS_PROD = process.env.NODE_ENV === 'production';
  const ALLOWED_ORIGINS = [
    'https://openshopfloor.zeroguess.ai',
    'https://osf-api.zeroguess.ai',
    ...(IS_PROD ? [] : ['http://localhost:3000', 'http://localhost:3001']),
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
    express.json({ limit: '5mb' })(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: 'Invalid JSON in request body' });
        return;
      }
      next();
    });
  });

  // CSRF protection for state-changing requests from browsers
  app.use((req, res, next) => {
    // Skip safe methods and API-key auth
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-api-key']) return next();
    if (req.headers.authorization) return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // If there's an origin header, it must match allowed origins
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'CSRF: Origin not allowed' });
      return;
    }

    // If there's a referer but no origin, check referer
    if (!origin && referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (!ALLOWED_ORIGINS.includes(refOrigin)) {
          res.status(403).json({ error: 'CSRF: Referer not allowed' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'CSRF: Invalid referer' });
        return;
      }
    }

    // Block cookie-authenticated requests with neither origin nor referer
    if (!origin && !referer && (req.cookies?.osf_access_token || req.cookies?.osf_editor_token)) {
      res.status(403).json({ error: 'CSRF: Origin header required' });
      return;
    }

    next();
  });

  // Health check (no auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.APP_VERSION || 'unknown' });
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

  // V7-DISABLED: V7 Gateway Proxy — disabled for V8 migration.
  // All agents now run through V8 /agents/run/:id SSE endpoint.
  // To re-enable: remove the `if (false)` wrapper below.
  if (false) { // V7-DISABLED
  const V7_BASE = 'http://192.168.178.150:30813';
  const V7_MAX_ENTRIES = 500;
  const v7Results = new Map<string, { result: any; timestamp: number }>();
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of v7Results) {
      if (val.timestamp < cutoff) v7Results.delete(key);
    }
  }, 5 * 60 * 1000);

  const FACTORY_SIM_BASE = process.env.FACTORY_SIM_URL || 'http://factory-v3-fertigung.factory.svc.cluster.local:8888';
  app.get('/v7/llm-status', requireAuth, async (_req, res) => {
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

  app.get('/v7/agents', requireAuth, async (_req, res) => {
    try {
      const upstream = await fetch(`${V7_BASE}/api/agents`);
      const data = await upstream.json();
      res.json(data);
    } catch (err: any) {
      logger.error({ err: err.message }, 'V7 proxy /agents failed');
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });

  app.post('/v7/agents/:agent/execute', requireAuth, async (req, res) => {
    const { agent } = req.params;
    const sessionId = req.body.sessionId;
    try {
      const upstream = fetch(`${V7_BASE}/api/agents/${agent}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
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
      res.status(202).json({ accepted: true, sessionId, agent });

      if (sessionId) {
        (check.response ? Promise.resolve(check.response) : upstream)
          .then(async (r: any) => {
            if (r.ok) {
              const data = await r.json();
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

  app.get('/v7/result/:sessionId', requireAuth, (req, res) => {
    const { sessionId } = req.params;
    const entry = v7Results.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Result not ready yet' });
      return;
    }
    res.json(entry.result);
  });

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

  app.all('/v7-api/*', requireAuth, async (req, res) => {
    const raw = req.originalUrl.replace('/v7-api/', '/api/');
    let normalized: string;
    try {
      const parsed = new URL(raw, V7_BASE);
      normalized = parsed.pathname + parsed.search;
    } catch {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
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

      res.status(upstream.status);
      for (const [key, value] of upstream.headers) {
        if (!['transfer-encoding', 'content-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      const body = await upstream.text();
      res.send(body);
    } catch (err: any) {
      logger.error({ err: err.message, path: req.path }, 'V7-API proxy failed');
      res.status(502).json({ error: 'V7 gateway unreachable' });
    }
  });
  } // END V7-DISABLED

  // Chat-UI reverse proxy (NodePort 30881 not externally reachable)
  const CHAT_UI_URL = process.env.CHAT_UI_URL || 'http://osf-chat-ui:80';

  // /demo-ui/api/* → strip /demo-ui prefix and forward internally (chat-ui JS calls /api/mcp etc.)
  app.use('/demo-ui/api', (req, res, next) => {
    // Rewrite path: /demo-ui/api/mcp → /mcp, /demo-ui/api/chat/completions → /chat/completions
    req.url = req.url; // already stripped /demo-ui/api by express mount
    req.path; // recalculated by express
    next('route'); // skip to next matching route
  });
  // Actually re-route: since next('route') won't work across app.use, use explicit redirect
  app.all('/demo-ui/api/*', (req, res) => {
    // Forward /demo-ui/api/X to /X by re-dispatching
    const newPath = req.originalUrl.replace('/demo-ui/api', '');
    req.url = newPath || '/';
    (req.app as any).handle(req, res, () => {
      res.status(404).json({ error: 'Not found' });
    });
  });

  // /demo-ui/* → proxy static files from chat-ui
  app.use('/demo-ui', async (req, res) => {
    try {
      const target = `${CHAT_UI_URL}${req.url}`;
      const upstream = await fetch(target, { signal: AbortSignal.timeout(10000) });
      res.status(upstream.status);
      for (const [key, value] of upstream.headers) {
        if (!['transfer-encoding', 'connection', 'content-security-policy', 'x-frame-options'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      // Allow embedding in iframe
      res.removeHeader('X-Frame-Options');
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err: any) {
      res.status(502).json({ error: 'Chat UI unreachable' });
    }
  });

  // UNS live stream (MQTT → SSE)
  app.use('/uns', unsRoutes);

  // Internal API for NR pods (authenticated via pod secret, no user auth)
  app.use('/internal', internalApiRoutes);

  // Routes
  // /api/* aliases (chat-ui JS calls /api/mcp, /api/chat/*, /api/agents/*, etc.)
  app.use('/api/mcp', mcpProxy);
  app.use('/api/chat', chatRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/agents', agentRoutes);
  app.get('/api/llm/status', (_req, res) => {
    const queueInfo = getLlmStatus();
    const safeServers = queueInfo.servers.map((s, i) => ({ name: `llm-${i}`, active: s.active, queued: s.queued }));
    res.json({ online: true, servers: safeServers });
  });
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

async function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown...');

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
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
