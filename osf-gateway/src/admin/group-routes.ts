/**
 * Learning Groups — Admin + Group-Admin routes
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { encryptApiKey } from '../auth/crypto';
import { logger } from '../logger';

const router = Router();

// ─── Middleware: requireGroupAdmin ────────────────────────────────────

async function requireGroupAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const groupId = req.params.id;
  const userId = req.user!.userId;

  // Platform admins can always manage
  if (req.user!.role === 'admin') { next(); return; }

  const result = await pool.query(
    'SELECT role FROM learning_group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (result.rows.length === 0 || result.rows[0].role !== 'group_admin') {
    res.status(403).json({ error: 'Group admin access required' });
    return;
  }
  next();
}

// ─── Admin routes (platform admin) ───────────────────────────────────

// GET /admin/groups — list all groups
router.get('/', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT g.id, g.name, g.description, g.max_members, g.created_at,
           g.llm_provider, g.llm_api_key_encrypted IS NOT NULL AS has_key,
           COUNT(m.user_id)::int AS member_count,
           u.email AS created_by_email
    FROM learning_groups g
    LEFT JOIN learning_group_members m ON m.group_id = g.id
    LEFT JOIN users u ON u.id = g.created_by
    GROUP BY g.id, u.email
    ORDER BY g.created_at DESC
  `);
  res.json({ groups: result.rows });
});

// POST /admin/groups — create group
router.post('/', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { name, description, max_members } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const result = await pool.query(
    `INSERT INTO learning_groups (name, description, max_members, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description || null, max_members || 30, req.user!.userId],
  );
  logger.info({ groupId: result.rows[0].id, name }, 'Learning group created');
  res.status(201).json(result.rows[0]);
});

// PUT /admin/groups/:id — update group
router.put('/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { name, description, max_members } = req.body;
  const result = await pool.query(
    `UPDATE learning_groups SET name = COALESCE($1, name), description = COALESCE($2, description),
     max_members = COALESCE($3, max_members), updated_at = NOW() WHERE id = $4 RETURNING *`,
    [name, description, max_members, req.params.id],
  );
  if (result.rows.length === 0) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json(result.rows[0]);
});

// DELETE /admin/groups/:id — delete group
router.delete('/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const result = await pool.query('DELETE FROM learning_groups WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) { res.status(404).json({ error: 'Group not found' }); return; }
  logger.info({ groupId: req.params.id }, 'Learning group deleted');
  res.json({ ok: true });
});

// GET /admin/groups/:id/members — list members
router.get('/:id/members', requireAuth, requireGroupAdmin, async (req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT m.user_id, m.role, m.joined_at, u.email, u.name
    FROM learning_group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = $1 ORDER BY m.joined_at
  `, [req.params.id]);
  res.json({ members: result.rows });
});

// POST /admin/groups/:id/members — add member
router.post('/:id/members', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { user_id, role } = req.body;
  if (!user_id) { res.status(400).json({ error: 'user_id is required' }); return; }

  // Check max_members
  const group = await pool.query('SELECT max_members FROM learning_groups WHERE id = $1', [req.params.id]);
  if (group.rows.length === 0) { res.status(404).json({ error: 'Group not found' }); return; }

  const count = await pool.query('SELECT COUNT(*)::int AS cnt FROM learning_group_members WHERE group_id = $1', [req.params.id]);
  if (count.rows[0].cnt >= group.rows[0].max_members) {
    res.status(400).json({ error: `Group is full (max ${group.rows[0].max_members} members)` });
    return;
  }

  await pool.query(
    `INSERT INTO learning_group_members (group_id, user_id, role)
     VALUES ($1, $2, $3) ON CONFLICT (group_id, user_id) DO UPDATE SET role = $3`,
    [req.params.id, user_id, role || 'member'],
  );
  logger.info({ groupId: req.params.id, userId: user_id, role: role || 'member' }, 'Member added to group');
  res.json({ ok: true });
});

// DELETE /admin/groups/:id/members/:userId — remove member
router.delete('/:id/members/:userId', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  await pool.query(
    'DELETE FROM learning_group_members WHERE group_id = $1 AND user_id = $2',
    [req.params.id, req.params.userId],
  );
  res.json({ ok: true });
});

// ─── Group Admin routes (token management) ───────────────────────────

// PUT /admin/groups/:id/token — set group API token
router.put('/:id/token', requireAuth, requireGroupAdmin, async (req: Request, res: Response) => {
  const { llm_provider, llm_base_url, llm_model, llm_api_key } = req.body;
  if (!llm_provider || !llm_api_key) {
    res.status(400).json({ error: 'llm_provider and llm_api_key are required' });
    return;
  }

  const encrypted = encryptApiKey(llm_api_key);
  await pool.query(
    `UPDATE learning_groups SET llm_provider = $1, llm_base_url = $2, llm_model = $3,
     llm_api_key_encrypted = $4, updated_at = NOW() WHERE id = $5`,
    [llm_provider, llm_base_url || null, llm_model || null, encrypted, req.params.id],
  );
  logger.info({ groupId: req.params.id, provider: llm_provider, setBy: req.user!.userId }, 'Group API token set');
  res.json({ ok: true });
});

// DELETE /admin/groups/:id/token — remove group API token
router.delete('/:id/token', requireAuth, requireGroupAdmin, async (req: Request, res: Response) => {
  await pool.query(
    `UPDATE learning_groups SET llm_provider = NULL, llm_base_url = NULL, llm_model = NULL,
     llm_api_key_encrypted = NULL, updated_at = NOW() WHERE id = $1`,
    [req.params.id],
  );
  res.json({ ok: true });
});

// GET /admin/groups/:id/token-status — check if token is set (no decryption)
router.get('/:id/token-status', requireAuth, requireGroupAdmin, async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT llm_provider, llm_base_url, llm_model, llm_api_key_encrypted IS NOT NULL AS has_key
     FROM learning_groups WHERE id = $1`,
    [req.params.id],
  );
  if (result.rows.length === 0) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json(result.rows[0]);
});

export default router;
