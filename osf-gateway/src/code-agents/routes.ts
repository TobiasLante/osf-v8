import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { pool } from '../db/pool';
import { checkRateLimit } from '../rate-limit';
import { logger } from '../logger';
import githubOAuthRouter from './github-oauth';
import { handleWebhook } from './webhook';
import { registerRepo, syncRepo } from './repo-sync';
import { getCodeAgent, getUserCodeAgents, getPublicCodeAgents, deleteCodeAgent, safeAgent } from './registry';
import { executeSandbox } from './sandbox';
import { createSdkCallbacks } from './sdk-runtime';

const router = Router();

// --- GitHub OAuth sub-routes ---
router.use('/github', githubOAuthRouter);

// --- GitHub Webhook (no auth — verified by HMAC) ---
router.post('/github/webhook', handleWebhook);

// --- Code Agent CRUD ---

// POST /code-agents — register agent from GitHub repo
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { repoFullName, repoUrl } = req.body;

    if (!repoFullName || !repoUrl) {
      res.status(400).json({ error: 'repoFullName and repoUrl are required' });
      return;
    }

    // Check if already registered
    const existing = await pool.query(
      'SELECT id FROM code_agents WHERE user_id = $1 AND repo_full_name = $2',
      [req.user!.userId, repoFullName]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'This repo is already registered', agentId: existing.rows[0].id });
      return;
    }

    const agentId = await registerRepo(req.user!.userId, repoFullName, repoUrl);
    res.status(201).json({ agentId, message: 'Agent registered. Syncing from GitHub...' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Register code agent error');
    res.status(400).json({ error: err.message });
  }
});

// GET /code-agents — list all public deployed code agents
router.get('/', async (_req: Request, res: Response) => {
  try {
    const agents = await getPublicCodeAgents();
    res.json({ agents: agents.map(safeAgent) });
  } catch (err: any) {
    logger.error({ err: err.message }, 'List code agents error');
    res.status(500).json({ error: 'Failed to list code agents' });
  }
});

// GET /code-agents/mine — user's own code agents
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    const agents = await getUserCodeAgents(req.user!.userId);
    res.json({ agents: agents.map(safeAgent) });
  } catch (err: any) {
    logger.error({ err: err.message }, 'My code agents error');
    res.status(500).json({ error: 'Failed to fetch your code agents' });
  }
});

// GET /code-agents/:id — agent detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agent = await getCodeAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Code agent not found' });
      return;
    }
    res.json({ agent: safeAgent(agent) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch code agent' });
  }
});

// POST /code-agents/:id/sync — re-sync from GitHub
router.post('/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const agent = await getCodeAgent(req.params.id);
    if (!agent || agent.userId !== req.user!.userId) {
      res.status(404).json({ error: 'Code agent not found or not owned by you' });
      return;
    }

    // Sync in background
    syncRepo(agent.id, req.user!.userId).catch(err => {
      logger.error({ err: err.message, agentId: agent.id }, 'Manual sync failed');
    });

    res.json({ ok: true, message: 'Sync started' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Sync code agent error');
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// DELETE /code-agents/:id — delete code agent
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteCodeAgent(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Code agent not found or not owned by you' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Delete code agent error');
    res.status(500).json({ error: 'Failed to delete code agent' });
  }
});

// POST /code-agents/:id/run — execute code agent (SSE)
router.post('/:id/run', requireAuth, async (req: Request, res: Response) => {
  if (!checkRateLimit(`code-agent:${req.user!.userId}`, 3)) {
    res.status(429).json({ error: 'Too many runs. Please wait a minute.' });
    return;
  }

  const agent = await getCodeAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Code agent not found' });
    return;
  }

  if (agent.deployStatus !== 'deployed' || !agent.bundledCode) {
    res.status(400).json({ error: 'Agent is not deployed yet. Please sync first.' });
    return;
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  // Create run record
  const runResult = await pool.query(
    `INSERT INTO code_agent_runs (agent_id, user_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [agent.id, req.user!.userId]
  );
  const runId = runResult.rows[0].id;
  const startTime = Date.now();

  res.write(`data: ${JSON.stringify({ type: 'run_start', runId, agent: agent.name })}\n\n`);

  const logs: string[] = [];
  const tier = req.user!.tier || 'free';

  try {
    const callbacks = createSdkCallbacks(req.user!.userId, agent.id, tier, res, logs);
    const { result, error } = await executeSandbox(agent.bundledCode, callbacks, agent.timeoutSeconds);

    const executionTime = Date.now() - startTime;

    if (error) {
      await pool.query(
        `UPDATE code_agent_runs SET status = 'failed', logs = $2, result = $3, execution_time_ms = $4, finished_at = NOW() WHERE id = $1`,
        [runId, JSON.stringify(logs), JSON.stringify({ error }), executionTime]
      );
      res.write(`data: ${JSON.stringify({ type: 'error', message: error })}\n\n`);
    } else {
      await pool.query(
        `UPDATE code_agent_runs SET status = 'completed', logs = $2, result = $3, execution_time_ms = $4, finished_at = NOW() WHERE id = $1`,
        [runId, JSON.stringify(logs), JSON.stringify(result), executionTime]
      );

      if (result) {
        res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', runId, executionTime })}\n\n`);
  } catch (err: any) {
    logger.error({ err: err.message, agentId: agent.id, userId: req.user!.userId }, 'Code agent run error');

    await pool.query(
      `UPDATE code_agent_runs SET status = 'failed', logs = $2, result = $3, execution_time_ms = $4, finished_at = NOW() WHERE id = $1`,
      [runId, JSON.stringify(logs), JSON.stringify({ error: err.message }), Date.now() - startTime]
    );

    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Execution failed' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', runId })}\n\n`);
  }

  res.end();
});

// GET /code-agents/:id/runs — run history
router.get('/:id/runs', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, status, logs, result, execution_time_ms, started_at, finished_at
       FROM code_agent_runs WHERE agent_id = $1 AND user_id = $2
       ORDER BY started_at DESC LIMIT 20`,
      [req.params.id, req.user!.userId]
    );
    res.json({ runs: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

export default router;
