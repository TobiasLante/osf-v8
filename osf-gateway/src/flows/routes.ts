import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { pool } from '../db/pool';
import { getMcpTools, getMcpToolsForServer, MCP_SERVERS } from '../chat/tool-executor';
import { getAllAgents } from '../agents/registry';
import { executeFlow, resumeFlow } from './engine';
import { runRegistry } from './run-registry';
import { getTemplates, getTemplate, instantiateTemplate } from './templates';
import { logger } from '../logger';

const router = Router();

// ─── Validation schemas ────────────────────────────────────────────────────
const saveFlowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional().nullable(),
  flowTabId: z.string().min(1).max(50),
  icon: z.string().max(4).optional(),
});

const ensureTabSchema = z.object({
  flowTabId: z.string().min(1).max(50),
});

const publishSchema = z.object({
  name: z.string().max(100).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  icon: z.string().max(4).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).optional().nullable(),
});

// ─── Agent list for Node-RED editor dropdowns ──────────────────────────────
// Returns built-in agents + all open-source community agents
router.get('/api/agents', requireAuth, async (req: Request, res: Response) => {
  try {
    const all = await getAllAgents();
    const agents = all.map(a => ({ id: a.id, name: a.name, icon: a.icon, type: a.type, category: a.category }));
    res.json({ agents });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow agents list error');
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// ─── MCP tool list for Node-RED editor dropdowns (all servers) ──────────────
router.get('/api/tools', requireAuth, async (_req: Request, res: Response) => {
  try {
    const tools = await getMcpTools();
    const toolNames = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
    }));
    res.json({ tools: toolNames });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow tools list error');
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// ─── MCP tool list per server ───────────────────────────────────────────────
router.get('/api/tools/:server', requireAuth, async (req: Request, res: Response) => {
  const server = req.params.server;
  if (!MCP_SERVERS[server]) {
    res.status(400).json({ error: `Unknown MCP server: ${server}` });
    return;
  }
  try {
    const tools = await getMcpToolsForServer(server);
    const toolNames = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
    }));
    res.json({ tools: toolNames });
  } catch (err: any) {
    logger.error({ err: err.message, server }, 'Flow tools list error');
    res.status(500).json({ error: `Failed to fetch ${server} tools` });
  }
});

// ─── List tabs from user's Node-RED flows ──────────────────────────────────
router.get('/api/tabs', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
      [req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.json({ tabs: [] });
      return;
    }
    const flows = result.rows[0].flow_json;
    const tabs = (Array.isArray(flows) ? flows : [])
      .filter((n: any) => n.type === 'tab')
      .map((t: any) => ({ id: t.id, label: t.label || 'Unnamed Tab' }));
    res.json({ tabs });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow tabs error');
    res.status(500).json({ error: 'Failed to fetch tabs' });
  }
});

// ─── User's saved flows ────────────────────────────────────────────────────
router.get('/api/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT uf.*, lr.status as last_run_status, lr.started_at as last_run_at
       FROM user_flows uf
       LEFT JOIN LATERAL (
         SELECT status, started_at FROM flow_runs
         WHERE flow_id = uf.id ORDER BY started_at DESC LIMIT 1
       ) lr ON true
       WHERE uf.user_id = $1
       ORDER BY uf.updated_at DESC`,
      [req.user!.userId]
    );
    res.json({ flows: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'My flows error');
    res.status(500).json({ error: 'Failed to fetch flows' });
  }
});

// Helper: extract tab node + all child nodes for a given tab ID
async function snapshotTab(userId: string, flowTabId: string): Promise<any[] | null> {
  const result = await pool.query(
    'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  const flows: any[] = result.rows[0].flow_json;
  if (!Array.isArray(flows)) return null;
  const tabNode = flows.find((n: any) => n.id === flowTabId && n.type === 'tab');
  if (!tabNode) return null;
  const childNodes = flows.filter((n: any) => n.z === flowTabId);
  return [tabNode, ...childNodes];
}

// ─── Save flow from Node-RED editor ────────────────────────────────────────
router.post('/api/save', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = saveFlowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { name, description, flowTabId, icon } = parsed.data;

    // Snapshot the tab's nodes from Node-RED
    const snapshot = await snapshotTab(req.user!.userId, flowTabId);

    // Upsert: if a flow already exists for this tab, update it
    const existing = await pool.query(
      'SELECT id FROM user_flows WHERE user_id = $1 AND flow_tab_id = $2',
      [req.user!.userId, flowTabId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE user_flows SET name = $1, description = $2, icon = COALESCE($3, icon),
         flow_snapshot = COALESCE($4, flow_snapshot), updated_at = NOW() WHERE id = $5`,
        [name, description || null, icon || null, snapshot ? JSON.stringify(snapshot) : null, existing.rows[0].id]
      );
      res.json({ id: existing.rows[0].id, updated: true });
    } else {
      const result = await pool.query(
        `INSERT INTO user_flows (user_id, name, description, flow_tab_id, icon, flow_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.user!.userId, name, description || null, flowTabId, icon || '🔀', snapshot ? JSON.stringify(snapshot) : null]
      );
      res.status(201).json({ id: result.rows[0].id, created: true });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Save flow error');
    res.status(500).json({ error: 'Failed to save flow' });
  }
});

// ─── Ensure tab exists in Node-RED (restore from snapshot if needed) ──────
router.post('/api/ensure-tab', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = ensureTabSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { flowTabId } = parsed.data;
    const userId = req.user!.userId;

    // Check if tab exists in Node-RED flows
    const nrResult = await pool.query(
      'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
      [userId]
    );
    const flows: any[] = nrResult.rows.length > 0 ? nrResult.rows[0].flow_json : [];
    const tabExists = Array.isArray(flows) && flows.some((n: any) => n.id === flowTabId && n.type === 'tab');

    if (tabExists) {
      res.json({ ok: true, restored: false });
      return;
    }

    // Tab doesn't exist — try to restore from snapshot
    const snapResult = await pool.query(
      'SELECT flow_snapshot FROM user_flows WHERE user_id = $1 AND flow_tab_id = $2',
      [userId, flowTabId]
    );
    const snapshot = snapResult.rows[0]?.flow_snapshot;
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      res.status(404).json({ error: 'Tab not found and no snapshot available' });
      return;
    }

    // Inject snapshot nodes into the user's Node-RED flows
    const merged = [...(Array.isArray(flows) ? flows : []), ...snapshot];
    const revision = Date.now().toString();

    if (nrResult.rows.length > 0) {
      await pool.query(
        `UPDATE nodered_flows SET flow_json = $1, revision = $2, updated_at = NOW() WHERE user_id = $3`,
        [JSON.stringify(merged), revision, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO nodered_flows (user_id, flow_json, revision) VALUES ($1, $2, $3)`,
        [userId, JSON.stringify(merged), revision]
      );
    }

    logger.info({ userId, flowTabId }, 'Restored flow tab from snapshot');
    res.json({ ok: true, restored: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Ensure tab error');
    res.status(500).json({ error: 'Failed to ensure tab' });
  }
});

// ─── Delete flow ───────────────────────────────────────────────────────────
router.delete('/api/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM user_flows WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Delete flow error');
    res.status(500).json({ error: 'Failed to delete flow' });
  }
});

// ─── Run flow (async start, returns runId) ──────────────────────────────────
router.post('/api/run/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tier = req.user!.tier || 'free';
    const runId = await executeFlow(req.params.id, req.user!.userId, tier);
    res.json({ runId });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow execution error');
    res.status(500).json({ error: err.message || 'Flow execution failed' });
  }
});

// ─── Poll flow events ───────────────────────────────────────────────────────
router.get('/api/runs/:id/events', requireAuth, async (req: Request, res: Response) => {
  try {
    const after = parseInt(req.query.after as string) || -1;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);

    // Verify ownership
    const run = await pool.query(
      'SELECT status FROM flow_runs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.userId]
    );
    if (run.rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Fetch events after cursor
    const events = await pool.query(
      'SELECT seq, event FROM flow_run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
      [req.params.id, after, limit]
    );

    res.json({
      status: run.rows[0].status,
      events: events.rows.map(r => ({ seq: r.seq, ...r.event })),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow events poll error');
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ─── Run history ───────────────────────────────────────────────────────────
router.get('/api/runs', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT fr.*, uf.name as flow_name, uf.icon as flow_icon
       FROM flow_runs fr LEFT JOIN user_flows uf ON uf.id = fr.flow_id
       WHERE fr.user_id = $1 ORDER BY fr.started_at DESC LIMIT 50`,
      [req.user!.userId]
    );
    res.json({ runs: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow runs error');
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

// ─── Pending human inputs ──────────────────────────────────────────────────
router.get('/api/runs/:id/pending', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM flow_pending_inputs WHERE run_id = $1 AND user_id = $2 AND response IS NULL ORDER BY created_at DESC`,
      [req.params.id, req.user!.userId]
    );
    res.json({ pending: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pending inputs' });
  }
});

// ─── Respond to human input (async, triggers resume) ────────────────────────
router.post('/api/runs/:id/respond', requireAuth, async (req: Request, res: Response) => {
  const { response } = req.body;
  if (!response) {
    res.status(400).json({ error: 'response required' });
    return;
  }

  try {
    // resumeFlow runs async in the background (writes events to DB)
    const resumePromise = resumeFlow(req.params.id, req.user!.userId, response).catch(err => {
      logger.error({ err: err.message, runId: req.params.id }, 'Async flow resume crashed');
    });
    runRegistry.register(req.params.id, resumePromise);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Flow resume error');
    res.status(500).json({ error: err.message || 'Failed to resume flow' });
  }
});

// ─── Public flows (marketplace) ──────────────────────────────────────────────
router.get('/api/public', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT uf.id, uf.name, uf.description, uf.icon, uf.category, uf.difficulty,
              uf.created_at, uf.updated_at, u.name as author_name, u.email as author_email
       FROM user_flows uf
       LEFT JOIN users u ON u.id = uf.user_id
       WHERE uf.is_public = true
       ORDER BY uf.updated_at DESC`
    );
    res.json({ flows: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Public flows error');
    res.status(500).json({ error: 'Failed to fetch public flows' });
  }
});

// ─── Publish flow to marketplace ────────────────────────────────────────────
router.post('/api/:id/publish', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { name, description, icon, category, difficulty } = parsed.data;
    const result = await pool.query(
      `UPDATE user_flows
       SET is_public = true,
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           icon = COALESCE($3, icon),
           category = COALESCE($4, category),
           difficulty = COALESCE($5, difficulty),
           updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING id`,
      [name || null, description || null, icon || null, category || null, difficulty || null, req.params.id, req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json({ ok: true, message: 'Flow published to marketplace' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Publish flow error');
    res.status(500).json({ error: 'Failed to publish flow' });
  }
});

// ─── Unpublish flow ─────────────────────────────────────────────────────────
router.post('/api/:id/unpublish', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE user_flows SET is_public = false, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    res.json({ ok: true, message: 'Flow unpublished' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Unpublish flow error');
    res.status(500).json({ error: 'Failed to unpublish flow' });
  }
});

// ─── Flow Templates ─────────────────────────────────────────────────────────

// List available templates
router.get('/api/templates', requireAuth, (_req: Request, res: Response) => {
  try {
    const templates = getTemplates().map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      version: t.version,
      nodeCount: t.nodes.filter((n: any) => n.type !== 'tab' && n.type !== 'comment').length,
    }));
    res.json({ templates });
  } catch (err: any) {
    logger.error({ err: err.message }, 'List templates error');
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// Get template details
router.get('/api/templates/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const template = getTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ template });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Get template error');
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// Install template into user's Node-RED + create a user_flow entry
router.post('/api/templates/:id/install', requireAuth, async (req: Request, res: Response) => {
  try {
    const template = getTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const userId = req.user!.userId;
    const customName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : template.name;
    const freshNodes = instantiateTemplate(template);

    // Find the tab node to get its new ID
    const tabNode = freshNodes.find((n: any) => n.type === 'tab');
    if (!tabNode) {
      res.status(500).json({ error: 'Template has no tab node' });
      return;
    }

    // Apply custom name to the tab node so it shows correctly in Node-RED
    tabNode.label = customName;

    // Load existing Node-RED flows for this user
    const nrResult = await pool.query(
      'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
      [userId]
    );
    const existingFlows: any[] = nrResult.rows.length > 0 ? (nrResult.rows[0].flow_json || []) : [];

    // Merge: add template nodes to existing flows
    const merged = [...(Array.isArray(existingFlows) ? existingFlows : []), ...freshNodes];
    const revision = Date.now().toString();

    if (nrResult.rows.length > 0) {
      await pool.query(
        'UPDATE nodered_flows SET flow_json = $1, revision = $2, updated_at = NOW() WHERE user_id = $3',
        [JSON.stringify(merged), revision, userId]
      );
    } else {
      await pool.query(
        'INSERT INTO nodered_flows (user_id, flow_json, revision) VALUES ($1, $2, $3)',
        [userId, JSON.stringify(merged), revision]
      );
    }

    // Create a user_flow entry so it shows up in the flows list
    const flowResult = await pool.query(
      `INSERT INTO user_flows (user_id, name, description, flow_tab_id, icon, flow_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, customName, template.description, tabNode.id, template.icon, JSON.stringify(freshNodes)]
    );

    logger.info({ userId, templateId: template.id, tabId: tabNode.id }, 'Template installed');
    res.status(201).json({
      id: flowResult.rows[0].id,
      tabId: tabNode.id,
      name: customName,
      installed: true,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Install template error');
    res.status(500).json({ error: 'Failed to install template' });
  }
});

export default router;
