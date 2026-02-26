import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { logger } from '../logger';
import { getLlmStatus } from '../chat/llm-client';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── User Management ──────────────────────────────────────────────────────

// GET /admin/users — list users with pagination
router.get('/users', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const [countResult, result] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM users'),
      pool.query(
        `SELECT id, email, name, role, tier, email_verified, locked_until, marketing_consent, created_at
         FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
    ]);

    res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: list users failed');
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// PUT /admin/users/:id — update user fields
router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, tier, locked_until, email_verified } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }
      updates.push(`role = $${idx++}`);
      values.push(role);
    }
    if (tier !== undefined) {
      updates.push(`tier = $${idx++}`);
      values.push(tier);
    }
    if (locked_until !== undefined) {
      updates.push(`locked_until = $${idx++}`);
      values.push(locked_until);
    }
    if (email_verified !== undefined) {
      updates.push(`email_verified = $${idx++}`);
      values.push(email_verified);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    values.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: update user failed');
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /admin/users/:id — delete user
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Prevent self-deletion
    if (id === req.user!.userId) {
      res.status(400).json({ error: 'Cannot delete yourself' });
      return;
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: delete user failed');
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /admin/users — create user manually
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = `osf_${crypto.randomUUID().replace(/-/g, '')}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, api_key, api_key_hash, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, email, name, role, tier, created_at`,
      [email, passwordHash, name || null, role || 'user', apiKey, apiKeyHash]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: create user failed');
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ─── System Stats ─────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [
      userCount,
      verifiedCount,
      activeWeek,
      flowRuns,
      agentRuns,
      chatSessions,
      recentRegistrations,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query('SELECT COUNT(*) as count FROM users WHERE email_verified = TRUE'),
      pool.query(`SELECT COUNT(DISTINCT user_id) as count FROM chat_sessions WHERE created_at > NOW() - INTERVAL '7 days'`),
      pool.query('SELECT COUNT(*) as count FROM flow_runs'),
      pool.query('SELECT COUNT(*) as count FROM agent_runs'),
      pool.query('SELECT COUNT(*) as count FROM chat_sessions'),
      pool.query(`
        SELECT date_trunc('week', created_at) as week, COUNT(*) as count
        FROM users
        WHERE created_at > NOW() - INTERVAL '8 weeks'
        GROUP BY week ORDER BY week DESC
      `),
    ]);

    res.json({
      users: {
        total: parseInt(userCount.rows[0].count),
        verified: parseInt(verifiedCount.rows[0].count),
        activeLastWeek: parseInt(activeWeek.rows[0].count),
      },
      system: {
        flowRuns: parseInt(flowRuns.rows[0].count),
        agentRuns: parseInt(agentRuns.rows[0].count),
        chatSessions: parseInt(chatSessions.rows[0].count),
      },
      registrationsPerWeek: recentRegistrations.rows.map((r: any) => ({
        week: r.week,
        count: parseInt(r.count),
      })),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: stats failed');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── News CRUD (Admin) ───────────────────────────────────────────────────

// GET /admin/news — all news (incl. unpublished)
router.get('/news', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM news ORDER BY created_at DESC'
    );
    res.json({ news: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: list news failed');
    res.status(500).json({ error: 'Failed to list news' });
  }
});

// POST /admin/news — create news
router.post('/news', async (req: Request, res: Response) => {
  try {
    const { title, content, published } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: 'Title and content required' });
      return;
    }

    // Get author name
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.user!.userId]);
    const authorName = userResult.rows[0]?.name || userResult.rows[0]?.email || 'Admin';

    const result = await pool.query(
      `INSERT INTO news (title, content, author_id, author_name, published)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, content, req.user!.userId, authorName, published !== false]
    );

    res.status(201).json({ news: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: create news failed');
    res.status(500).json({ error: 'Failed to create news' });
  }
});

// PUT /admin/news/:id — update news
router.put('/news/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, published } = req.body;

    const updates: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (content !== undefined) {
      updates.push(`content = $${idx++}`);
      values.push(content);
    }
    if (published !== undefined) {
      updates.push(`published = $${idx++}`);
      values.push(published);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE news SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'News not found' });
      return;
    }

    res.json({ news: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: update news failed');
    res.status(500).json({ error: 'Failed to update news' });
  }
});

// DELETE /admin/news/:id — delete news
router.delete('/news/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM news WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: delete news failed');
    res.status(500).json({ error: 'Failed to delete news' });
  }
});

// ─── Banner Management ──────────────────────────────────────────────────

// GET /admin/banner — get current banner
router.get('/banner', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, message, type, active, created_at, updated_at FROM banner ORDER BY updated_at DESC LIMIT 1'
    );
    res.json({ banner: result.rows[0] || null });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: get banner failed');
    res.status(500).json({ error: 'Failed to get banner' });
  }
});

// PUT /admin/banner — upsert banner
router.put('/banner', async (req: Request, res: Response) => {
  try {
    const { message, type, active } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    if (type && !['maintenance', 'news'].includes(type)) {
      res.status(400).json({ error: 'Type must be maintenance or news' });
      return;
    }

    // Upsert: update existing or insert new (single-row pattern)
    const existing = await pool.query('SELECT id FROM banner ORDER BY updated_at DESC LIMIT 1');
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE banner SET message = $1, type = $2, active = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
        [message, type || 'news', active ?? false, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO banner (message, type, active) VALUES ($1, $2, $3) RETURNING *`,
        [message, type || 'news', active ?? false]
      );
    }

    res.json({ banner: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: upsert banner failed');
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

// ─── Infrastructure Proxy (Factory Simulator v3) ─────────────────────────

const FACTORY_SIM_BASE = process.env.FACTORY_SIM_URL || 'http://factory-v3-fertigung.factory.svc.cluster.local:8888';

const INFRA_ENDPOINTS = [
  '/infrastructure/metrics',
  '/infrastructure/db-health',
  '/infrastructure/access-log',
  '/infrastructure/k8s-pods',
];

for (const endpoint of INFRA_ENDPOINTS) {
  router.get(endpoint, async (req: Request, res: Response) => {
    try {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const upstream = await fetch(`${FACTORY_SIM_BASE}/api${endpoint}${qs}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'Upstream error' });
        return;
      }
      const data = await upstream.json();
      res.json(data);
    } catch (err: any) {
      logger.error({ err: err.message, endpoint }, 'Admin: infrastructure proxy failed');
      res.status(502).json({ error: 'Infrastructure service unreachable' });
    }
  });
}

// ─── Connectivity Check ─────────────────────────────────────────────────

interface ConnCheck {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

router.get('/connectivity', async (_req: Request, res: Response) => {
  const checks: { name: string; url: string; method?: string }[] = [
    { name: 'Resend (Email)', url: 'https://api.resend.com/' },
    { name: 'GitHub API', url: 'https://api.github.com/' },
    { name: 'Cloudflare', url: 'https://cloudflare.com/cdn-cgi/trace' },
    { name: 'MCP ERP', url: (process.env.MCP_URL_ERP || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'MCP Manufacturing', url: (process.env.MCP_URL_OEE || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'MCP QMS', url: (process.env.MCP_URL_QMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'MCP WMS/TMS', url: (process.env.MCP_URL_TMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'Factory Simulator', url: (process.env.FACTORY_SIM_URL || 'http://factory-v3-fertigung.factory.svc.cluster.local:8888') + '/api/health' },
    { name: 'LLM Free', url: (process.env.LLM_URL_FREE || 'http://192.168.178.120:5002') + '/health' },
    { name: 'LLM Premium', url: (process.env.LLM_URL_PREMIUM || 'http://192.168.178.120:5001') + '/health' },
  ];

  const results: ConnCheck[] = await Promise.all(
    checks.map(async (c) => {
      const start = Date.now();
      try {
        const r = await fetch(c.url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        return { name: c.name, url: c.url, ok: r.status < 500, latencyMs: Date.now() - start };
      } catch (err: any) {
        return { name: c.name, url: c.url, ok: false, latencyMs: Date.now() - start, error: err.message || 'timeout' };
      }
    })
  );

  res.json({ checks: results, checkedAt: new Date().toISOString() });
});

// ─── NR Pod Management ───────────────────────────────────────────────────

import { NrPodManager } from '../nodered/pod-manager';

function getPodManager(req: Request): NrPodManager | null {
  return (req.app as any).nrPodManager || null;
}

// GET /admin/nr-pods — list all NR pods with status
router.get('/nr-pods', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    const [pods, poolStats] = await Promise.all([
      pm.getAllPods(),
      pm.getPoolStats(),
    ]);
    res.json({ pods, pool: poolStats });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods list failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/nr-pods/stats — aggregated 24h stats
router.get('/nr-pods/stats', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    const stats = await pm.getStats24h();
    res.json(stats);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods stats failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/nr-pods/events — recent pod lifecycle events
router.get('/nr-pods/events', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const events = await pm.getRecentEvents(Math.min(limit, 200));
    res.json({ events });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods events failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/nr-pods/:podName/release — manually release a pod
router.post('/nr-pods/:podName/release', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    await pm.releasePod(req.params.podName, 'admin_released');
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods release failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/nr-pods/cleanup — remove terminated/draining DB records and K8s orphans
router.post('/nr-pods/cleanup', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    // Remove terminated DB records older than 5 minutes
    const cleaned = await pool.query(
      `DELETE FROM nodered_pods WHERE status = 'terminated' AND created_at < NOW() - INTERVAL '5 minutes' RETURNING pod_name`
    );
    // Force-reconcile to catch orphans
    await pm.reconcileNow();
    res.json({ ok: true, cleaned: cleaned.rowCount });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods cleanup failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/nr-pods/drain-all — release all assigned pods and refresh warm pool
router.post('/nr-pods/drain-all', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  try {
    const result = await pm.drainAll();
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods drain-all failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/nr-pods/pool/scale — temporarily change pool size
router.post('/nr-pods/pool/scale', async (req: Request, res: Response) => {
  const pm = getPodManager(req);
  if (!pm) { res.status(503).json({ error: 'Pod manager not initialized' }); return; }

  const size = parseInt(req.body.size, 10);
  if (isNaN(size) || size < 0 || size > 20) {
    res.status(400).json({ error: 'Size must be between 0 and 20' });
    return;
  }

  try {
    pm.setPoolSize(size);
    res.json({ ok: true, newSize: size });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: nr-pods scale failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── Health Dashboard ────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'degraded' | 'critical';

interface HealthAlert {
  severity: 'warning' | 'critical';
  component: string;
  message: string;
}

router.get('/health', async (req: Request, res: Response) => {
  const alerts: HealthAlert[] = [];

  // --- Gateway ---
  const uptimeSeconds = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();
  const memoryMb = Math.round(memUsage.rss / 1024 / 1024);
  let gatewayStatus: HealthStatus = 'healthy';
  if (memoryMb > 512) { gatewayStatus = 'critical'; alerts.push({ severity: 'critical', component: 'gateway', message: `High memory usage (${memoryMb} MB)` }); }
  else if (memoryMb > 256) { gatewayStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'gateway', message: `Elevated memory usage (${memoryMb} MB)` }); }

  // --- Database ---
  let dbStatus: HealthStatus = 'healthy';
  let dbLatencyMs = 0;
  let dbConnectionsUsed = 0;
  let dbConnectionsMax = 0;
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - start;
    dbConnectionsUsed = (pool as any).totalCount ?? 0;
    dbConnectionsMax = (pool as any).options?.max ?? 20;
    const utilPct = dbConnectionsMax > 0 ? (dbConnectionsUsed / dbConnectionsMax) * 100 : 0;
    if (dbLatencyMs > 1000) { dbStatus = 'critical'; alerts.push({ severity: 'critical', component: 'database', message: `High latency (${dbLatencyMs}ms)` }); }
    else if (dbLatencyMs > 200 || utilPct > 80) { dbStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'database', message: dbLatencyMs > 200 ? `Elevated latency (${dbLatencyMs}ms)` : `Pool utilization high (${Math.round(utilPct)}%)` }); }
  } catch (err: any) {
    dbStatus = 'critical';
    alerts.push({ severity: 'critical', component: 'database', message: `Unreachable: ${err.message}` });
  }

  // --- LLM ---
  let llmStatus: HealthStatus = 'healthy';
  let llmOnline = false;
  let llmActiveRequests = 0;
  let llmQueuedRequests = 0;
  const llmUrlFree = process.env.LLM_URL_FREE || 'http://192.168.178.120:5002';
  const llmUrlPremium = process.env.LLM_URL_PREMIUM || 'http://192.168.178.120:5001';
  try {
    const [freeRes, premRes] = await Promise.all([
      fetch(`${llmUrlFree}/v1/models`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
      fetch(`${llmUrlPremium}/v1/models`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
    ]);
    llmOnline = (freeRes !== null && freeRes.ok) || (premRes !== null && premRes.ok);
    const queueInfo = getLlmStatus();
    for (const s of queueInfo.servers) { llmActiveRequests += s.active; llmQueuedRequests += s.queued; }
  } catch { /* ignore */ }
  if (!llmOnline) { llmStatus = 'critical'; alerts.push({ severity: 'critical', component: 'llm', message: 'LLM servers offline' }); }
  else if (llmQueuedRequests > 5) { llmStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'llm', message: `LLM queue depth high (${llmQueuedRequests})` }); }

  // --- Node-RED Pods ---
  let nrStatus: HealthStatus = 'healthy';
  let nrStats = { warm: 0, assigned: 0, starting: 0, targetSize: 3, poolHealthy: true };
  const pm = getPodManager(req);
  if (pm) {
    try {
      const stats = await pm.getPoolStats();
      nrStats = { warm: stats.warm, assigned: stats.assigned, starting: stats.starting, targetSize: stats.targetSize, poolHealthy: stats.warm >= stats.targetSize };
      if (stats.warm === 0 && stats.starting === 0) { nrStatus = 'critical'; alerts.push({ severity: 'critical', component: 'nodered', message: 'No warm or starting pods' }); }
      else if (stats.warm < stats.targetSize) { nrStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'nodered', message: `Warm pool low (${stats.warm}/${stats.targetSize})` }); }
    } catch { nrStatus = 'degraded'; }
  } else {
    nrStatus = 'degraded';
    alerts.push({ severity: 'warning', component: 'nodered', message: 'Pod manager not initialized' });
  }

  // --- MCP Services ---
  const mcpServices = [
    { name: 'ERP', url: (process.env.MCP_URL_ERP || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'Manufacturing', url: (process.env.MCP_URL_OEE || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'QMS', url: (process.env.MCP_URL_QMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
    { name: 'WMS/TMS', url: (process.env.MCP_URL_TMS || 'http://factory-v3-fertigung.factory.svc.cluster.local:8020') + '/health' },
  ];
  const mcpResults = await Promise.all(
    mcpServices.map(async (svc) => {
      const start = Date.now();
      try {
        const r = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        return { name: svc.name, ok: r.ok, latencyMs: Date.now() - start };
      } catch {
        return { name: svc.name, ok: false, latencyMs: Date.now() - start };
      }
    })
  );
  const mcpAllOk = mcpResults.every(m => m.ok);
  const mcpAnyDown = mcpResults.some(m => !m.ok);
  let mcpStatus: HealthStatus = 'healthy';
  if (mcpResults.every(m => !m.ok)) { mcpStatus = 'critical'; alerts.push({ severity: 'critical', component: 'mcp', message: 'All MCP services offline' }); }
  else if (mcpAnyDown) { mcpStatus = 'degraded'; const down = mcpResults.filter(m => !m.ok).map(m => m.name); alerts.push({ severity: 'warning', component: 'mcp', message: `MCP offline: ${down.join(', ')}` }); }

  // --- Factory Simulator ---
  let factoryStatus: HealthStatus = 'healthy';
  let factoryReachable = false;
  let factoryLatencyMs = 0;
  try {
    const start = Date.now();
    const r = await fetch(`${FACTORY_SIM_BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
    factoryLatencyMs = Date.now() - start;
    factoryReachable = r.ok;
  } catch { /* unreachable */ }
  if (!factoryReachable) { factoryStatus = 'critical'; alerts.push({ severity: 'critical', component: 'factorySim', message: 'Factory simulator unreachable' }); }
  else if (factoryLatencyMs > 2000) { factoryStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'factorySim', message: `High latency (${factoryLatencyMs}ms)` }); }

  // --- Cloudflare ---
  let cfStatus: HealthStatus = 'healthy';
  let cfReachable = false;
  try {
    const r = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(3000) });
    cfReachable = r.ok;
  } catch { /* unreachable */ }
  if (!cfReachable) { cfStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'cloudflare', message: 'Cloudflare unreachable' }); }

  // --- Overall ---
  const statuses = [gatewayStatus, dbStatus, llmStatus, nrStatus, mcpStatus, factoryStatus, cfStatus];
  let overall: HealthStatus = 'healthy';
  if (statuses.includes('critical')) overall = 'critical';
  else if (statuses.includes('degraded')) overall = 'degraded';

  res.json({
    overall,
    components: {
      gateway: { status: gatewayStatus, uptimeSeconds, memoryMb },
      database: { status: dbStatus, connectionsUsed: dbConnectionsUsed, connectionsMax: dbConnectionsMax, latencyMs: dbLatencyMs },
      llm: { status: llmStatus, online: llmOnline, activeRequests: llmActiveRequests, queuedRequests: llmQueuedRequests },
      nodered: { status: nrStatus, ...nrStats },
      mcp: { status: mcpStatus, services: mcpResults },
      factorySim: { status: factoryStatus, reachable: factoryReachable, latencyMs: factoryLatencyMs },
      cloudflare: { status: cfStatus, reachable: cfReachable },
    },
    alerts,
    checkedAt: new Date().toISOString(),
  });
});

export default router;
