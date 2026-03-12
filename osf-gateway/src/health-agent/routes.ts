import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { logger } from '../logger';

const router = Router();

// All health-agent routes require admin
router.use(requireAuth, requireAdmin);

// GET /health-agent/reports — list recent health check reports
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const [countResult, result] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM health_checks'),
      pool.query(
        'SELECT id, status, report, tool_calls, duration_ms, created_at FROM health_checks ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
    ]);

    res.json({
      reports: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err: any) {
    // Table might not exist yet (first health agent run creates it)
    if (err.code === '42P01') {
      res.json({ reports: [], total: 0, limit: 20, offset: 0 });
      return;
    }
    logger.error({ err: err.message }, 'health-agent: list reports failed');
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// GET /health-agent/reports/:id — single report
router.get('/reports/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid report ID' });
      return;
    }

    const result = await pool.query(
      'SELECT id, status, report, tool_calls, duration_ms, created_at FROM health_checks WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '42P01') {
      res.status(404).json({ error: 'No health checks yet' });
      return;
    }
    logger.error({ err: err.message }, 'health-agent: get report failed');
    res.status(500).json({ error: 'Failed to get report' });
  }
});

export default router;
