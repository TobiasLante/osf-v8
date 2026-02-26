import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { logger } from '../logger';

const router = Router();

// GET /news — public, only published news
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, title, content, author_name, created_at
       FROM news WHERE published = TRUE ORDER BY created_at DESC`
    );
    res.json({ news: result.rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Public news fetch failed');
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// GET /news/banner — public, active banner (cached 60s)
router.get('/banner', async (_req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=60');
    const result = await pool.query(
      `SELECT message, type, active FROM banner WHERE active = TRUE ORDER BY updated_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      res.json({ banner: null });
      return;
    }
    res.json({ banner: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Public banner fetch failed');
    res.status(500).json({ error: 'Failed to fetch banner' });
  }
});

export default router;
