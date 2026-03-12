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
      if (!['user', 'demo', 'admin'].includes(role)) {
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

// Strip HTML tags to prevent stored XSS
function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

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
      [sanitizeHtml(title), sanitizeHtml(content), req.user!.userId, authorName, published !== false]
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
      values.push(sanitizeHtml(title));
    }
    if (content !== undefined) {
      updates.push(`content = $${idx++}`);
      values.push(sanitizeHtml(content));
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
    const safeMessage = sanitizeHtml(message);
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE banner SET message = $1, type = $2, active = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
        [safeMessage, type || 'news', active ?? false, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO banner (message, type, active) VALUES ($1, $2, $3) RETURNING *`,
        [safeMessage, type || 'news', active ?? false]
      );
    }

    res.json({ banner: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: upsert banner failed');
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

// ─── Infrastructure Proxy (Factory Simulator v3) ─────────────────────────

const FACTORY_SIM_BASE = process.env.FACTORY_SIM_URL || 'http://localhost:8888';

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
    { name: 'MCP ERP', url: (process.env.MCP_URL_ERP || 'http://localhost:8020') + '/health' },
    { name: 'MCP Manufacturing', url: (process.env.MCP_URL_OEE || 'http://localhost:8020') + '/health' },
    { name: 'MCP QMS', url: (process.env.MCP_URL_QMS || 'http://localhost:8020') + '/health' },
    { name: 'MCP WMS/TMS', url: (process.env.MCP_URL_TMS || 'http://localhost:8020') + '/health' },
    { name: 'Factory Simulator', url: (process.env.FACTORY_SIM_URL || 'http://localhost:8888') + '/api/health/live' },
    { name: 'LLM Free', url: (process.env.LLM_URL_FREE || 'http://localhost:5002') + '/health' },
    { name: 'LLM Premium', url: (process.env.LLM_URL_PREMIUM || 'http://localhost:5001') + '/health' },
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
  const llmUrlFree = process.env.LLM_URL_FREE || 'http://localhost:5002';
  const llmUrlPremium = process.env.LLM_URL_PREMIUM || 'http://localhost:5001';
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
    { name: 'ERP', url: (process.env.MCP_URL_ERP || 'http://localhost:8020') + '/health' },
    { name: 'Manufacturing', url: (process.env.MCP_URL_OEE || 'http://localhost:8020') + '/health' },
    { name: 'QMS', url: (process.env.MCP_URL_QMS || 'http://localhost:8020') + '/health' },
    { name: 'WMS/TMS', url: (process.env.MCP_URL_TMS || 'http://localhost:8020') + '/health' },
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
  const mcpAnyDown = mcpResults.some(m => !m.ok);
  let mcpStatus: HealthStatus = 'healthy';
  if (mcpResults.every(m => !m.ok)) { mcpStatus = 'critical'; alerts.push({ severity: 'critical', component: 'mcp', message: 'All MCP services offline' }); }
  else if (mcpAnyDown) { const down = mcpResults.filter(m => !m.ok).map(m => m.name); mcpStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'mcp', message: `MCP offline: ${down.join(', ')}` }); }

  // --- All Factory Services (comprehensive check) ---
  const FACTORY_SERVICES = [
    { name: 'Fertigung', url: process.env.FACTORY_SIM_URL || 'http://localhost:8888', hasLeader: true, hasMcp: true, mcpPort: 8020 },
    { name: 'Montage', url: process.env.MONTAGE_URL || 'http://localhost:8890', hasLeader: true },
    { name: 'WMS', url: process.env.WMS_URL || 'http://localhost:8889', hasLeader: true },
    { name: 'Chef-Nadja', url: process.env.CHEF_URL || 'http://localhost:8891', hasLeader: false },
  ];

  const factoryResults = await Promise.all(
    FACTORY_SERVICES.map(async (svc) => {
      const start = Date.now();
      const result: Record<string, any> = { name: svc.name, ok: false, latencyMs: 0, leader: null, ready: false };
      try {
        const liveRes = await fetch(`${svc.url}/api/health/live`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        result.latencyMs = Date.now() - start;
        result.ok = liveRes !== null && liveRes.ok;
        if (svc.hasLeader) {
          // With 2 replicas (leader+backup), a single request may hit the backup.
          // Fire 3 ready checks in parallel to maximize chance of hitting the leader.
          const readyChecks = await Promise.all([
            fetch(`${svc.url}/api/health/ready`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
            fetch(`${svc.url}/api/health/ready`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
            fetch(`${svc.url}/api/health/ready`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null),
          ]);
          const leaderHit: any = readyChecks.find((d: any) => d?.ready === true || d?.status === 'ready' || d?.leader === true);
          if (leaderHit) {
            result.ready = true;
            result.leader = true;
            result.podId = leaderHit.podId || null;
          } else if (readyChecks.some((d: any) => d !== null)) {
            result.ready = false;
            result.leader = false;
          }
        } else {
          result.ready = result.ok;
        }
      } catch { result.latencyMs = Date.now() - start; }
      return result;
    })
  );

  let factoryStatus: HealthStatus = 'healthy';
  const factoryDown = factoryResults.filter(f => !f.ok);
  const factoryNoLeader = factoryResults.filter(f => f.ok && !f.ready);
  if (factoryDown.length === factoryResults.length) {
    factoryStatus = 'critical';
    alerts.push({ severity: 'critical', component: 'factory', message: 'All factory services offline' });
  } else if (factoryDown.length > 0) {
    factoryStatus = 'critical';
    alerts.push({ severity: 'critical', component: 'factory', message: `Offline: ${factoryDown.map(f => f.name).join(', ')}` });
  } else if (factoryNoLeader.length > 0) {
    factoryStatus = 'degraded';
    alerts.push({ severity: 'warning', component: 'factory', message: `No leader: ${factoryNoLeader.map(f => f.name).join(', ')}` });
  }

  // --- Databases (direct connection check to all PG instances) ---
  const DB_CHECKS = [
    { name: 'ERP (erpdb)', host: process.env.ERP_DB_HOST || 'localhost', port: parseInt(process.env.ERP_DB_PORT || '5432'), database: 'erpdb' },
    { name: 'Factory (bigdata)', host: process.env.FACTORY_DB_HOST || 'localhost', port: parseInt(process.env.FACTORY_DB_PORT || '5432'), database: 'bigdata_homelab' },
    { name: 'QMS (qmsdb)', host: process.env.QMS_DB_HOST || 'localhost', port: parseInt(process.env.QMS_DB_PORT || '5432'), database: 'qmsdb' },
  ];
  const dbChecks = await Promise.all(
    DB_CHECKS.map(async (db) => {
      const start = Date.now();
      try {
        const { Pool: PgPool } = await import('pg');
        const p = new PgPool({ host: db.host, port: db.port, database: db.database, user: 'admin', password: process.env.FACTORY_DB_PASSWORD || '', max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
        await p.query('SELECT 1');
        await p.end();
        return { name: db.name, ok: true, latencyMs: Date.now() - start };
      } catch (err: any) {
        return { name: db.name, ok: false, latencyMs: Date.now() - start, error: err.message };
      }
    })
  );
  let dbsStatus: HealthStatus = 'healthy';
  const dbsDown = dbChecks.filter(d => !d.ok);
  if (dbsDown.length > 0) {
    dbsStatus = dbsDown.length === dbChecks.length ? 'critical' : 'degraded';
    alerts.push({ severity: dbsDown.length >= 3 ? 'critical' : 'warning', component: 'databases', message: `Offline: ${dbsDown.map(d => d.name).join(', ')}` });
  }

  // --- MQTT Broker ---
  let mqttStatus: HealthStatus = 'healthy';
  let mqttReachable = false;
  try {
    const net = await import('net');
    mqttReachable = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host: process.env.MQTT_HOST || 'localhost', port: parseInt(process.env.MQTT_PORT || '1883'), timeout: 3000 });
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => resolve(false));
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    });
  } catch { /* unreachable */ }
  if (!mqttReachable) { mqttStatus = 'critical'; alerts.push({ severity: 'critical', component: 'mqtt', message: 'MQTT broker unreachable' }); }

  // --- Email (Resend) ---
  let emailStatus: HealthStatus = 'healthy';
  let emailConfigured = !!process.env.RESEND_API_KEY;
  let emailReachable = false;
  if (emailConfigured) {
    try {
      const r = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      // Even a 401 (restricted key) means API is reachable
      emailReachable = r.status < 500;
    } catch { /* unreachable */ }
    if (!emailReachable) { emailStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'email', message: 'Resend API unreachable' }); }
  } else {
    emailStatus = 'critical';
    alerts.push({ severity: 'critical', component: 'email', message: 'RESEND_API_KEY not configured — emails disabled' });
  }

  // --- Cloudflare ---
  let cfStatus: HealthStatus = 'healthy';
  let cfReachable = false;
  try {
    const r = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(3000) });
    cfReachable = r.ok;
  } catch { /* unreachable */ }
  if (!cfReachable) { cfStatus = 'degraded'; alerts.push({ severity: 'warning', component: 'cloudflare', message: 'Cloudflare unreachable' }); }

  // --- Overall ---
  const statuses = [gatewayStatus, dbStatus, llmStatus, nrStatus, mcpStatus, factoryStatus, dbsStatus, mqttStatus, emailStatus, cfStatus];
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
      factory: { status: factoryStatus, services: factoryResults, kgSync: await (async () => {
        try {
          const r = await fetch(`${FACTORY_SIM_BASE}/api/health/kg-sync`, { signal: AbortSignal.timeout(5000) });
          return r.ok ? await r.json() : null;
        } catch { return null; }
      })() },
      databases: { status: dbsStatus, checks: dbChecks },
      mqtt: { status: mqttStatus, reachable: mqttReachable },
      email: { status: emailStatus, configured: emailConfigured, reachable: emailReachable },
      cloudflare: { status: cfStatus, reachable: cfReachable },
    },
    alerts,
    checkedAt: new Date().toISOString(),
  });
});

// GET /admin/activity — user session activity
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to as string || new Date().toISOString().slice(0, 10);

    const daysDiff = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
    const granularity = daysDiff <= 14 ? 'daily' : daysDiff <= 90 ? 'weekly' : 'monthly';

    const trunc = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

    // Per-user activity: time span from first to last event per period
    // Combines chat sessions, messages, agent runs, and flow runs
    const userActivity = await pool.query(`
      WITH all_events AS (
        SELECT user_id, created_at AS ts FROM chat_sessions
        UNION ALL
        SELECT cs.user_id, cm.created_at AS ts FROM chat_messages cm JOIN chat_sessions cs ON cs.id = cm.session_id
        UNION ALL
        SELECT user_id, started_at AS ts FROM agent_runs
        UNION ALL
        SELECT user_id, finished_at AS ts FROM agent_runs WHERE finished_at IS NOT NULL
        UNION ALL
        SELECT user_id, started_at AS ts FROM flow_runs WHERE started_at IS NOT NULL
        UNION ALL
        SELECT user_id, finished_at AS ts FROM flow_runs WHERE finished_at IS NOT NULL
      )
      SELECT
        ae.user_id,
        u.email AS user_email,
        u.name AS user_name,
        date_trunc($1, ae.ts)::date AS period,
        COUNT(*)::int AS session_count,
        ROUND(EXTRACT(EPOCH FROM (MAX(ae.ts) - MIN(ae.ts))) / 60)::int AS total_minutes
      FROM all_events ae
      JOIN users u ON u.id = ae.user_id
      WHERE ae.ts >= $2::date AND ae.ts < ($3::date + INTERVAL '1 day')
      GROUP BY ae.user_id, u.email, u.name, date_trunc($1, ae.ts)
      ORDER BY period DESC, total_minutes DESC
    `, [trunc, from, to]);

    // Totals per period (sum of per-user spans, not overall span)
    const totals = await pool.query(`
      WITH all_events AS (
        SELECT user_id, created_at AS ts FROM chat_sessions
        UNION ALL
        SELECT cs.user_id, cm.created_at AS ts FROM chat_messages cm JOIN chat_sessions cs ON cs.id = cm.session_id
        UNION ALL
        SELECT user_id, started_at AS ts FROM agent_runs
        UNION ALL
        SELECT user_id, finished_at AS ts FROM agent_runs WHERE finished_at IS NOT NULL
        UNION ALL
        SELECT user_id, started_at AS ts FROM flow_runs WHERE started_at IS NOT NULL
        UNION ALL
        SELECT user_id, finished_at AS ts FROM flow_runs WHERE finished_at IS NOT NULL
      ),
      per_user AS (
        SELECT
          date_trunc($1, ae.ts)::date AS period,
          ae.user_id,
          ROUND(EXTRACT(EPOCH FROM (MAX(ae.ts) - MIN(ae.ts))) / 60)::int AS user_minutes
        FROM all_events ae
        WHERE ae.ts >= $2::date AND ae.ts < ($3::date + INTERVAL '1 day')
        GROUP BY date_trunc($1, ae.ts), ae.user_id
      )
      SELECT
        period,
        SUM(user_minutes)::int AS total_minutes,
        COUNT(*)::int AS active_users
      FROM per_user
      GROUP BY period
      ORDER BY period DESC
    `, [trunc, from, to]);

    res.json({
      granularity,
      data: userActivity.rows,
      totals: totals.rows,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Activity query failed');
    res.status(500).json({ error: 'Failed to fetch activity data' });
  }
});

// ─── Historian Proxy (v9/v2) ──────────────────────────────────────────────

// Proxy /admin/historian/* → Historian service :8030
const HISTORIAN_URL = process.env.HISTORIAN_URL || 'http://localhost:8030';

router.all('/historian/*', async (req: Request, res: Response) => {
  // Strip /admin/historian prefix → forward remainder to historian
  const subPath = req.path.replace(/^\/historian/, '') || '/';
  const targetUrl = `${HISTORIAN_URL}${subPath}`;

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const resp = await fetch(targetUrl, fetchOpts);
    const data = await resp.text();

    res.status(resp.status);
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/json');
    res.send(data);
  } catch (err: any) {
    logger.error({ err: err.message, path: subPath }, 'Historian proxy failed');
    res.status(502).json({ error: 'Historian service unavailable', detail: err.message });
  }
});

// ─── Agent Monitoring (v9) ───────────────────────────────────────────────

// GET /admin/agents/status — status of all background agents (KG Agent, Historian)
router.get('/agents/status', async (_req: Request, res: Response) => {
  const agents: any[] = [];

  // 1. KG Agent status (runs in-process)
  try {
    const { getKgAgentStats } = await import('../kg-agent/index');
    const stats = getKgAgentStats();
    agents.push({
      name: 'KG Agent',
      type: 'in-process',
      description: 'Auto-discovers machines/sensors from MQTT UNS → Apache AGE graph',
      status: stats ? 'running' : 'stopped',
      ...stats,
    });
  } catch {
    agents.push({
      name: 'KG Agent',
      type: 'in-process',
      status: 'unknown',
      error: 'Could not load KG Agent module',
    });
  }

  // 2. Historian status (external service)
  const historianUrl = process.env.HISTORIAN_URL || 'http://localhost:8030';
  try {
    const r = await fetch(`${historianUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const data: Record<string, unknown> = await r.json() as Record<string, unknown>;
      agents.push({
        name: 'Historian',
        type: 'service',
        description: 'MQTT → TimescaleDB time-series + History MCP server',
        status: 'running',
        url: historianUrl,
        ...data,
      });
    } else {
      agents.push({ name: 'Historian', type: 'service', status: 'error', url: historianUrl, error: `HTTP ${r.status}` });
    }
  } catch (err: any) {
    agents.push({ name: 'Historian', type: 'service', status: 'offline', url: historianUrl, error: err.message });
  }

  // 3. MCP servers from registry
  try {
    const result = await pool.query(
      "SELECT name, url, status, tool_count, health_check_at, error_message FROM mcp_servers ORDER BY name"
    );
    for (const row of result.rows) {
      agents.push({
        name: `MCP: ${row.name}`,
        type: 'mcp-server',
        status: row.status,
        url: row.url,
        toolCount: row.tool_count,
        lastHealthCheck: row.health_check_at,
        error: row.error_message,
      });
    }
  } catch {
    // mcp_servers table may not exist
  }

  res.json({ agents, checkedAt: new Date().toISOString() });
});

// ─── MCP Server Registry (v9) ────────────────────────────────────────────

// GET /admin/mcp-servers — list all registered MCP servers
router.get('/mcp-servers', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, url, auth_type, status, tool_count, categories, health_check_at, error_message, created_at FROM mcp_servers ORDER BY created_at'
    );
    res.json({ servers: result.rows });
  } catch (err: any) {
    if (err.code === '42P01') { res.json({ servers: [] }); return; }
    logger.error({ err: err.message }, 'Admin: list MCP servers failed');
    res.status(500).json({ error: 'Failed to list MCP servers' });
  }
});

// GET /admin/mcp-servers/:id — single server with tools
router.get('/mcp-servers/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, url, auth_type, status, tools, tool_count, categories, health_check_at, error_message, created_at FROM mcp_servers WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: get MCP server failed');
    res.status(500).json({ error: 'Failed to get MCP server' });
  }
});

// POST /admin/mcp-servers — register new MCP server (triggers discovery)
router.post('/mcp-servers', async (req: Request, res: Response) => {
  try {
    const { name, url, auth_type } = req.body;
    if (!name || !url) {
      res.status(400).json({ error: 'name and url required' });
      return;
    }

    // Insert as pending
    const result = await pool.query(
      `INSERT INTO mcp_servers (name, url, auth_type, status, added_by)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING id, name, url, status, created_at`,
      [name.trim(), url.trim(), auth_type || 'none', req.user!.userId]
    );

    const server = result.rows[0];

    // Async discovery: connect, fetch tools, update status
    discoverMcpServer(server.id, url.trim()).catch(err => {
      logger.error({ err: err.message, serverId: server.id }, 'MCP discovery failed');
    });

    res.status(201).json(server);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: create MCP server failed');
    res.status(500).json({ error: 'Failed to create MCP server' });
  }
});

// POST /admin/mcp-servers/:id/discover — re-run discovery
router.post('/mcp-servers/:id/discover', async (req: Request, res: Response) => {
  try {
    const server = await pool.query('SELECT id, url FROM mcp_servers WHERE id = $1', [req.params.id]);
    if (server.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }

    discoverMcpServer(server.rows[0].id, server.rows[0].url).catch(err => {
      logger.error({ err: err.message, serverId: req.params.id }, 'MCP re-discovery failed');
    });

    res.json({ ok: true, message: 'Discovery started' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: discover MCP server failed');
    res.status(500).json({ error: 'Failed to start discovery' });
  }
});

// GET /admin/mcp-servers/:id/tools — tools with governance classification
router.get('/mcp-servers/:id/tools', async (req: Request, res: Response) => {
  try {
    const server = await pool.query('SELECT id, name, tools FROM mcp_servers WHERE id = $1', [req.params.id]);
    if (server.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }

    const rawTools: any[] = server.rows[0].tools || [];
    const toolNames = rawTools.map((t: any) => t.name);

    // Fetch classifications for these tools
    const classResult = toolNames.length > 0
      ? await pool.query(
          `SELECT tool_name, category_id, sensitivity, status FROM tool_classifications WHERE tool_name = ANY($1)`,
          [toolNames]
        )
      : { rows: [] };

    const classMap = new Map(classResult.rows.map((r: any) => [r.tool_name, r]));

    const tools = rawTools.map((t: any) => {
      const c = classMap.get(t.name);
      return {
        name: t.name,
        description: t.description || '',
        category: c?.category_id || null,
        sensitivity: c?.sensitivity || null,
        governanceStatus: c?.status || 'unclassified',
      };
    });

    res.json({ serverName: server.rows[0].name, tools });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: get MCP server tools failed');
    res.status(500).json({ error: 'Failed to get server tools' });
  }
});

// DELETE /admin/mcp-servers/:id — remove server
router.delete('/mcp-servers/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM mcp_servers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: delete MCP server failed');
    res.status(500).json({ error: 'Failed to delete MCP server' });
  }
});

// ─── Governance: Roles CRUD ──────────────────────────────────────────────

// GET /admin/roles — list all factory roles
router.get('/roles', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT fr.*,
        (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = fr.id) as user_count,
        COALESCE(
          (SELECT json_agg(rp.category_id) FROM role_permissions rp WHERE rp.role_id = fr.id),
          '[]'
        ) as categories
      FROM factory_roles fr ORDER BY fr.is_system DESC, fr.name
    `);
    res.json({ roles: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: list roles failed');
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

// POST /admin/roles — create factory role
router.post('/roles', async (req: Request, res: Response) => {
  try {
    const { id, name, description } = req.body;
    if (!id || !name) {
      res.status(400).json({ error: 'id and name required' });
      return;
    }
    // Validate id format (lowercase alphanumeric + underscore)
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) {
      res.status(400).json({ error: 'id must be lowercase alphanumeric with underscores, 2-31 chars' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO factory_roles (id, name, description, is_system)
       VALUES ($1, $2, $3, false) RETURNING *`,
      [id, name, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Role ID already exists' }); return; }
    logger.error({ err: err.message }, 'Admin: create role failed');
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /admin/roles/:id — update role
router.put('/roles/:id', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
    values.push(req.params.id);
    await pool.query(`UPDATE factory_roles SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: update role failed');
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /admin/roles/:id — delete role (system roles protected)
router.delete('/roles/:id', async (req: Request, res: Response) => {
  try {
    const check = await pool.query('SELECT is_system FROM factory_roles WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) { res.status(404).json({ error: 'Role not found' }); return; }
    if (check.rows[0].is_system) { res.status(403).json({ error: 'System roles cannot be deleted' }); return; }
    await pool.query('DELETE FROM factory_roles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: delete role failed');
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// PUT /admin/roles/:id/permissions — set category permissions for a role
router.put('/roles/:id/permissions', async (req: Request, res: Response) => {
  try {
    const { categories } = req.body; // string[]
    if (!Array.isArray(categories)) { res.status(400).json({ error: 'categories array required' }); return; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id]);
      for (const catId of categories) {
        await client.query(
          'INSERT INTO role_permissions (role_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, catId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Invalidate permission cache for all users with this role
    const { invalidatePermissionCache } = await import('../auth/permissions');
    invalidatePermissionCache();

    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: set role permissions failed');
    res.status(500).json({ error: 'Failed to set permissions' });
  }
});

// ─── Governance: User Role Assignment ────────────────────────────────────

// GET /admin/users/:id/roles — get roles for a user
router.get('/users/:id/roles', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ur.role_id, fr.name, ur.assigned_at
       FROM user_roles ur JOIN factory_roles fr ON fr.id = ur.role_id
       WHERE ur.user_id = $1 ORDER BY fr.name`,
      [req.params.id]
    );
    res.json({ roles: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: get user roles failed');
    res.status(500).json({ error: 'Failed to get user roles' });
  }
});

// PUT /admin/users/:id/roles — set roles for a user (replaces all)
router.put('/users/:id/roles', async (req: Request, res: Response) => {
  try {
    const { roles } = req.body; // string[] of role_ids
    if (!Array.isArray(roles)) { res.status(400).json({ error: 'roles array required' }); return; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
      for (const roleId of roles) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [req.params.id, roleId, req.user!.userId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Invalidate permission cache for this user
    const { invalidatePermissionCache } = await import('../auth/permissions');
    invalidatePermissionCache(req.params.id);

    // Audit
    const { audit: auditLog } = await import('../auth/audit');
    auditLog({
      user_id: req.user!.userId,
      user_email: req.user!.email,
      action: 'role_change',
      detail: `Set roles for user ${req.params.id}: ${roles.join(', ')}`,
    });

    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: set user roles failed');
    res.status(500).json({ error: 'Failed to set user roles' });
  }
});

// ─── Governance: Tool Classifications ────────────────────────────────────

// GET /admin/tool-classifications — list with optional status filter
router.get('/tool-classifications', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    let query = `
      SELECT tc.*, cat.name as category_name
      FROM tool_classifications tc
      LEFT JOIN tool_categories cat ON cat.id = tc.category_id
    `;
    const params: any[] = [];
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query += ' WHERE tc.status = $1';
      params.push(status);
    }
    query += ' ORDER BY tc.status, tc.tool_name';
    const result = await pool.query(query, params);

    // Also get pending count
    const pendingCount = await pool.query("SELECT COUNT(*) as c FROM tool_classifications WHERE status = 'pending'");

    res.json({
      classifications: result.rows,
      pending_count: parseInt(pendingCount.rows[0].c),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: list tool classifications failed');
    res.status(500).json({ error: 'Failed to list classifications' });
  }
});

// PUT /admin/tool-classifications/:toolName — approve/reject/change category
router.put('/tool-classifications/:toolName', async (req: Request, res: Response) => {
  try {
    const { status, category_id, sensitivity } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (status !== undefined) {
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      updates.push(`status = $${idx++}`);
      values.push(status);
      if (status === 'approved' || status === 'rejected') {
        updates.push(`reviewed_by = $${idx++}`);
        values.push(req.user!.userId);
        updates.push(`reviewed_at = NOW()`);
      }
    }
    if (category_id !== undefined) { updates.push(`category_id = $${idx++}`); values.push(category_id); }
    if (sensitivity !== undefined) { updates.push(`sensitivity = $${idx++}`); values.push(sensitivity); }

    if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

    values.push(decodeURIComponent(req.params.toolName));
    const result = await pool.query(
      `UPDATE tool_classifications SET ${updates.join(', ')} WHERE tool_name = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'Tool not found' }); return; }

    // Invalidate all permission caches (tool classification changed)
    const { invalidatePermissionCache } = await import('../auth/permissions');
    invalidatePermissionCache();

    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: update tool classification failed');
    res.status(500).json({ error: 'Failed to update classification' });
  }
});

// POST /admin/tool-classifications/bulk-approve — approve all pending
router.post('/tool-classifications/bulk-approve', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE tool_classifications SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE status = 'pending' RETURNING tool_name`,
      [req.user!.userId]
    );
    const { invalidatePermissionCache } = await import('../auth/permissions');
    invalidatePermissionCache();
    res.json({ approved: result.rowCount, tools: result.rows.map((r: any) => r.tool_name) });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: bulk approve failed');
    res.status(500).json({ error: 'Failed to bulk approve' });
  }
});

// ─── Governance: Tool Categories ─────────────────────────────────────────

// GET /admin/tool-categories — list all categories
router.get('/tool-categories', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT tc.*,
        (SELECT COUNT(*) FROM tool_classifications cl WHERE cl.category_id = tc.id) as tool_count
       FROM tool_categories tc ORDER BY tc.name`
    );
    res.json({ categories: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: list categories failed');
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// ─── Governance: Audit Log ───────────────────────────────────────────────

// GET /admin/audit — query audit log
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const action = req.query.action as string;
    const userSearch = req.query.user as string;
    const toolSearch = req.query.tool as string;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (action) {
      where += ` AND action = $${idx++}`;
      params.push(action);
    }
    if (userSearch) {
      where += ` AND (user_email ILIKE $${idx++})`;
      params.push(`%${userSearch}%`);
    }
    if (toolSearch) {
      where += ` AND (tool_name ILIKE $${idx++})`;
      params.push(`%${toolSearch}%`);
    }

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY ts DESC LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    const countResult = await pool.query(`SELECT COUNT(*) as c FROM audit_log ${where}`, params.slice(0, -2));

    res.json({
      entries: result.rows,
      total: parseInt(countResult.rows[0].c),
      limit,
      offset,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Admin: audit log query failed');
    res.status(500).json({ error: 'Failed to query audit log' });
  }
});

// ─── Discovery + Governance Agent Integration ─────────────────────────────

// Discovery logic: connect to MCP server, fetch tools, categorize, update DB
async function discoverMcpServer(serverId: string, url: string): Promise<void> {
  const baseUrl = url.replace(/\/mcp\/?$/, '');

  try {
    // 1. Connect + fetch tools
    const resp = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: any = await resp.json();
    const rawTools = data.result?.tools || [];

    // 2. Convert to OpenAI format
    const tools = rawTools.map((t: any) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    // 3. Categorize based on tool name prefixes
    const categories = new Set<string>();
    for (const t of rawTools) {
      const name = (t.name || '').toLowerCase();
      if (name.startsWith('factory_get_') || name.startsWith('factory_search_')) categories.add('erp');
      if (name.includes('oee') || name.includes('production')) categories.add('oee');
      if (name.includes('kg_') || name.startsWith('kg_')) categories.add('kg');
      if (name.includes('uns_') || name.startsWith('uns_')) categories.add('uns');
      if (name.includes('quality') || name.includes('cpk')) categories.add('qms');
      if (name.includes('warehouse') || name.includes('wms') || name.includes('tms')) categories.add('tms');
      if (name.includes('history')) categories.add('history');
      if (name.includes('maintenance')) categories.add('maintenance');
    }

    // 4. Update DB
    await pool.query(
      `UPDATE mcp_servers SET
        status = 'online',
        tools = $1,
        tool_count = $2,
        categories = $3,
        health_check_at = NOW(),
        error_message = NULL
       WHERE id = $4`,
      [JSON.stringify(tools), tools.length, [...categories], serverId]
    );

    logger.info({ serverId, toolCount: tools.length, categories: [...categories] }, 'MCP server discovered');

    // Trigger Governance Agent to classify tools (async, non-blocking)
    classifyToolsViaGovernanceAgent(serverId, rawTools).catch(err => {
      logger.warn({ err: err.message, serverId }, 'Governance classification failed (non-critical)');
    });
  } catch (err: any) {
    await pool.query(
      `UPDATE mcp_servers SET status = 'error', error_message = $1, health_check_at = NOW() WHERE id = $2`,
      [err.message, serverId]
    );
    throw err;
  }
}

/** Call Governance Agent /classify-batch and store results as pending tool classifications. */
async function classifyToolsViaGovernanceAgent(serverId: string, rawTools: any[]): Promise<void> {
  const governanceUrl = process.env.GOVERNANCE_AGENT_URL || 'http://localhost:8031';

  const toolInputs = rawTools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
  }));

  if (toolInputs.length === 0) return;

  const resp = await fetch(`${governanceUrl}/classify-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools: toolInputs }),
    signal: AbortSignal.timeout(120_000), // 2min for large batches
  });

  if (!resp.ok) {
    throw new Error(`Governance Agent returned ${resp.status}: ${await resp.text()}`);
  }

  const data: any = await resp.json();
  const classifications = data.classifications || [];

  // Upsert into tool_classifications as 'pending'
  for (const c of classifications) {
    await pool.query(
      `INSERT INTO tool_classifications (tool_name, tool_description, category_id, sensitivity, status, classified_by, mcp_server_id)
       VALUES ($1, $2, $3, $4, 'approved', 'agent', $5)
       ON CONFLICT (tool_name) DO UPDATE SET
         tool_description = EXCLUDED.tool_description,
         category_id = EXCLUDED.category_id,
         sensitivity = EXCLUDED.sensitivity,
         classified_by = 'agent',
         mcp_server_id = EXCLUDED.mcp_server_id
       WHERE tool_classifications.status IN ('pending', 'approved')`,
      [c.tool_name, c.tool_description, c.category, c.sensitivity, serverId]
    );
  }

  logger.info({ serverId, classified: classifications.length }, 'Governance Agent classified tools');
}

export default router;
