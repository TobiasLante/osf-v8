import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { getAgent } from '../agents/registry';
import { getChain } from '../chains/registry';

const router = Router();

const deploySchema = z.object({
  sourceType: z.enum(['agent', 'chain', 'code_agent', 'flow']),
  sourceId: z.string().min(1).max(200),
  mode: z.enum(['link', 'fork']),
});

// POST /marketplace/deploy — deploy (link) or fork an agent
router.post('/deploy', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = deploySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { sourceType, sourceId, mode } = parsed.data;
    const userId = req.user!.userId;

    // Code agents: only link mode
    if (sourceType === 'code_agent' && mode === 'fork') {
      res.status(400).json({ error: 'Code agents can only be deployed as link (no fork)' });
      return;
    }

    // Check source exists
    const sourceExists = await verifySource(sourceType, sourceId);
    if (!sourceExists) {
      res.status(404).json({ error: 'Source agent not found' });
      return;
    }

    if (mode === 'fork') {
      const forkedId = await forkSource(sourceType, sourceId, userId);
      res.status(201).json({ id: forkedId, mode: 'fork', message: 'Forked successfully' });
      return;
    }

    // Link mode: create reference
    const result = await pool.query(
      `INSERT INTO user_deployed_agents (user_id, source_type, source_id, deploy_mode, source_version)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, source_type, source_id, deploy_mode) DO NOTHING
       RETURNING id`,
      [userId, sourceType, sourceId, mode]
    );

    if (result.rows.length === 0) {
      res.status(409).json({ error: 'Already deployed' });
      return;
    }

    res.status(201).json({ id: result.rows[0].id, mode: 'link', message: 'Deployed successfully' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Deploy error');
    res.status(500).json({ error: 'Failed to deploy agent' });
  }
});

// DELETE /marketplace/deploy/:id — remove deployed agent
router.delete('/deploy/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM user_deployed_agents WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Deployed agent not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Undeploy error');
    res.status(500).json({ error: 'Failed to remove deployed agent' });
  }
});

// GET /marketplace/deployed — list user's deployed agents
router.get('/deployed', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
        CASE d.source_type
          WHEN 'agent' THEN (SELECT name FROM agents WHERE id = d.source_id)
          WHEN 'chain' THEN (SELECT name FROM agent_chains WHERE id = d.source_id)
          WHEN 'code_agent' THEN (SELECT name FROM code_agents WHERE id::text = d.source_id)
          WHEN 'flow' THEN (SELECT name FROM user_flows WHERE id::text = d.source_id)
        END as name,
        CASE d.source_type
          WHEN 'agent' THEN (SELECT icon FROM agents WHERE id = d.source_id)
          WHEN 'chain' THEN (SELECT icon FROM agent_chains WHERE id = d.source_id)
          WHEN 'code_agent' THEN (SELECT icon FROM code_agents WHERE id::text = d.source_id)
          WHEN 'flow' THEN (SELECT icon FROM user_flows WHERE id::text = d.source_id)
        END as icon,
        CASE d.source_type
          WHEN 'agent' THEN (SELECT description FROM agents WHERE id = d.source_id)
          WHEN 'chain' THEN (SELECT description FROM agent_chains WHERE id = d.source_id)
          WHEN 'code_agent' THEN (SELECT description FROM code_agents WHERE id::text = d.source_id)
          WHEN 'flow' THEN (SELECT description FROM user_flows WHERE id::text = d.source_id)
        END as description
       FROM user_deployed_agents d
       WHERE d.user_id = $1
       ORDER BY d.created_at DESC`,
      [req.user!.userId]
    );

    // Resolve built-in agents/chains that aren't in DB
    const deployed = await Promise.all(result.rows.map(async (row: any) => {
      if (row.name) return row;
      if (row.source_type === 'agent') {
        const agent = await getAgent(row.source_id);
        if (agent) {
          row.name = agent.name;
          row.icon = agent.icon;
          row.description = agent.description;
        }
      } else if (row.source_type === 'chain') {
        const chain = await getChain(row.source_id);
        if (chain) {
          row.name = chain.name;
          row.icon = chain.icon;
          row.description = chain.description;
        }
      }
      return row;
    }));

    res.json({ deployed });
  } catch (err: any) {
    logger.error({ err: err.message }, 'List deployed error');
    res.status(500).json({ error: 'Failed to list deployed agents' });
  }
});

// POST /marketplace/deploy/:id/upgrade — update version pin
router.post('/deploy/:id/upgrade', requireAuth, async (req: Request, res: Response) => {
  try {
    const deployed = await pool.query(
      'SELECT source_type, source_id FROM user_deployed_agents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.userId]
    );
    if (deployed.rows.length === 0) {
      res.status(404).json({ error: 'Deployed agent not found' });
      return;
    }

    const { source_type, source_id } = deployed.rows[0];
    const table = sourceTable(source_type);
    const versionResult = await pool.query(
      `SELECT version FROM ${table} WHERE id = $1`,
      [source_id]
    );
    const latestVersion = versionResult.rows[0]?.version || 1;

    await pool.query(
      'UPDATE user_deployed_agents SET source_version = $1, pinned_version = $1 WHERE id = $2',
      [latestVersion, req.params.id]
    );
    res.json({ ok: true, version: latestVersion });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Upgrade error');
    res.status(500).json({ error: 'Failed to upgrade' });
  }
});

// GET /marketplace/check — check if user has deployed a specific agent
router.get('/check', requireAuth, async (req: Request, res: Response) => {
  try {
    const { sourceType, sourceId } = req.query;
    if (!sourceType || !sourceId) {
      res.status(400).json({ error: 'sourceType and sourceId required' });
      return;
    }
    const result = await pool.query(
      'SELECT id, deploy_mode FROM user_deployed_agents WHERE user_id = $1 AND source_type = $2 AND source_id = $3',
      [req.user!.userId, sourceType, sourceId]
    );
    res.json({ deployed: result.rows.length > 0, deployments: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Check failed' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sourceTable(sourceType: string): string {
  switch (sourceType) {
    case 'agent': return 'agents';
    case 'chain': return 'agent_chains';
    case 'code_agent': return 'code_agents';
    case 'flow': return 'user_flows';
    default: return 'agents';
  }
}

async function verifySource(sourceType: string, sourceId: string): Promise<boolean> {
  // Check built-in agents/chains first (not in DB)
  if (sourceType === 'agent') {
    const agent = await getAgent(sourceId);
    if (agent) return true;
  }
  if (sourceType === 'chain') {
    const chain = await getChain(sourceId);
    if (chain) return true;
  }
  // Then check DB
  const table = sourceTable(sourceType);
  const idCol = sourceType === 'code_agent' || sourceType === 'flow' ? 'id::text' : 'id';
  const result = await pool.query(`SELECT 1 FROM ${table} WHERE ${idCol} = $1`, [sourceId]);
  return result.rows.length > 0;
}

async function forkSource(sourceType: string, sourceId: string, userId: string): Promise<string> {
  switch (sourceType) {
    case 'agent': {
      // Try DB first, then built-in registry
      let src: any = null;
      const { rows } = await pool.query('SELECT * FROM agents WHERE id = $1', [sourceId]);
      if (rows.length > 0) {
        src = rows[0];
      } else {
        const builtIn = await getAgent(sourceId);
        if (builtIn) {
          src = {
            id: builtIn.id,
            name: builtIn.name,
            type: builtIn.type,
            category: builtIn.category,
            description: builtIn.description,
            system_prompt: (builtIn as any).systemPrompt || builtIn.description,
            tools: builtIn.tools || [],
            difficulty: builtIn.difficulty,
            icon: builtIn.icon,
          };
        }
      }
      if (!src) throw new Error('Agent not found');
      const newId = `${src.id}-fork-${Date.now().toString(36).slice(-4)}`;
      const result = await pool.query(
        `INSERT INTO agents (id, name, type, category, description, system_prompt, tools, difficulty, icon, author_id, public, open_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, false) RETURNING id`,
        [newId, `${src.name} (Fork)`, src.type, src.category, src.description, src.system_prompt, src.tools, src.difficulty, src.icon, userId]
      );
      return result.rows[0].id;
    }
    case 'chain': {
      let src: any = null;
      const { rows } = await pool.query('SELECT * FROM agent_chains WHERE id = $1', [sourceId]);
      if (rows.length > 0) {
        src = rows[0];
      } else {
        const builtIn = await getChain(sourceId);
        if (builtIn) {
          src = { id: builtIn.id, name: builtIn.name, description: builtIn.description, steps: builtIn.steps, icon: builtIn.icon, category: builtIn.category, difficulty: builtIn.difficulty };
        }
      }
      if (!src) throw new Error('Chain not found');
      const newId = `${src.id}-fork-${Date.now().toString(36).slice(-4)}`;
      const result = await pool.query(
        `INSERT INTO agent_chains (id, name, description, steps, icon, category, difficulty, author_id, open_source, public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, true) RETURNING id`,
        [newId, `${src.name} (Fork)`, src.description, JSON.stringify(src.steps), src.icon, src.category, src.difficulty, userId]
      );
      return result.rows[0].id;
    }
    case 'flow': {
      const { rows } = await pool.query('SELECT * FROM user_flows WHERE id = $1', [sourceId]);
      if (rows.length === 0) throw new Error('Flow not found');
      const src = rows[0];
      const result = await pool.query(
        `INSERT INTO user_flows (user_id, name, description, flow_tab_id, icon, flow_snapshot, category, difficulty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, `${src.name} (Fork)`, src.description, `fork-${Date.now().toString(36)}`, src.icon, JSON.stringify(src.flow_snapshot), src.category, src.difficulty]
      );
      return result.rows[0].id;
    }
    default:
      throw new Error('Fork not supported for this type');
  }
}

export default router;
