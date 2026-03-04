import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { getAllAgents, getAgent, getUserAgents, createAgent, updateAgent, deleteAgent } from './registry';
import { runAgent } from './runner';
import { runDiscussionAgent } from './discussion-runner';
import { runChain } from '../chains/runner';
import { getChain } from '../chains/registry';
import { pool } from '../db/pool';
import { checkRateLimit } from '../rate-limit';
import { logger } from '../logger';

// Agent ID aliases — maps old/alternate IDs to canonical V8 IDs
const AGENT_ALIASES: Record<string, string> = {
  'otd-optimize': 'otd-deep-analyzer',
};

// Agent IDs that should delegate to a chain instead
const CHAIN_ALIASES: Record<string, string> = {
  'nightly': 'nightly-review',
};

const router = Router();

// Slug-ify: "My Cool Agent" → "my-cool-agent"
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// GET /agents — list all agents
router.get('/', async (_req: Request, res: Response) => {
  try {
    const agents = await getAllAgents();
    const list = agents.map(({ systemPrompt, ...rest }) => rest);
    res.json({ agents: list });
  } catch (err: any) {
    logger.error({ err: err.message }, 'List agents error');
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /agents/community — list only community (user-created) agents
router.get('/community', async (_req: Request, res: Response) => {
  try {
    const agents = await getAllAgents();
    const community = agents.filter(a => !a.featured && a.authorId);
    const list = community.map(({ systemPrompt, ...rest }) => rest);
    res.json({ agents: list });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Community agents error');
    res.status(500).json({ error: 'Failed to list community agents' });
  }
});

// GET /agents/mine — list user's own agents
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    const agents = await getUserAgents(req.user!.userId);
    const list = agents.map(({ systemPrompt, ...rest }) => rest);
    res.json({ agents: list });
  } catch (err: any) {
    logger.error({ err: err.message }, 'My agents error');
    res.status(500).json({ error: 'Failed to fetch your agents' });
  }
});

// POST /agents — create a new agent
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, type, category, description, systemPrompt, tools, difficulty, icon, openSource } = req.body;

    if (!name || !description || !systemPrompt) {
      res.status(400).json({ error: 'name, description, and systemPrompt are required' });
      return;
    }
    if (!Array.isArray(tools) || tools.length === 0) {
      res.status(400).json({ error: 'tools must be a non-empty array of tool names' });
      return;
    }
    if (systemPrompt.length > 10000) {
      res.status(400).json({ error: 'systemPrompt too long (max 10000 chars)' });
      return;
    }

    // Generate unique slug
    let id = slugify(name);
    const existing = await getAgent(id);
    if (existing) {
      id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }

    const validTypes = ['operational', 'langgraph', 'strategic'];
    const validDifficulty = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

    const agent = await createAgent({
      id,
      name: name.slice(0, 100),
      type: validTypes.includes(type) ? type : 'operational',
      category: (category || 'General').slice(0, 50),
      description: description.slice(0, 500),
      systemPrompt,
      tools: tools.slice(0, 20),
      difficulty: validDifficulty.includes(difficulty) ? difficulty : 'Beginner',
      icon: (icon || '🤖').slice(0, 4),
      authorId: req.user!.userId,
      openSource: openSource === true,
    });

    const { systemPrompt: _, ...rest } = agent;
    res.status(201).json({ agent: rest, message: 'Agent deployed! It is now live.' });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Agent with this name already exists' });
      return;
    }
    logger.error({ err: err.message }, 'Create agent error');
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /agents/:id — update own agent
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const updated = await updateAgent(req.params.id, req.user!.userId, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Agent not found or not owned by you' });
      return;
    }
    const { systemPrompt, ...rest } = updated;
    res.json({ agent: rest });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Update agent error');
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /agents/:id — delete own agent
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteAgent(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found or not owned by you' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Delete agent error');
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// GET /agents/:id — agent detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    // Show systemPrompt if agent is open-source, otherwise strip it
    if (agent.openSource) {
      res.json({ agent });
    } else {
      const { systemPrompt, ...rest } = agent;
      res.json({ agent: rest });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// GET /agents/:id/prompt — get system prompt (only for author)
router.get('/:id/prompt', requireAuth, async (req: Request, res: Response) => {
  try {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    // Only author can see the full prompt
    if (agent.authorId && agent.authorId !== req.user!.userId) {
      res.status(403).json({ error: 'Not your agent' });
      return;
    }
    res.json({ systemPrompt: agent.systemPrompt });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch prompt' });
  }
});

// POST /agents/run/:id — run an agent (SSE)
// Supports: agent aliases (otd-optimize → otd-deep-analyzer),
//           chain aliases (nightly → nightly-review chain),
//           body passthrough (userMessage, params)
router.post('/run/:id', requireAuth, async (req: Request, res: Response) => {
  if (!checkRateLimit(`agent:${req.user!.userId}`, 3)) {
    res.status(429).json({ error: 'Too many agent runs. Please wait.' });
    return;
  }

  const rawId = req.params.id;
  const tier = req.user!.tier || 'free';

  // Check if this ID should delegate to a chain
  const chainId = CHAIN_ALIASES[rawId];
  if (chainId) {
    const chain = await getChain(chainId);
    if (!chain) {
      res.status(404).json({ error: `Chain '${chainId}' not found` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.flushHeaders();

    await runChain(chain, req.user!.userId, tier, res);
    res.end();
    return;
  }

  // Resolve agent alias
  const agentId = AGENT_ALIASES[rawId] || rawId;
  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  // Extract options from request body
  const body = req.body || {};
  const userMessage = body.userMessage;
  const params = body.params || {};
  const options = (userMessage || Object.keys(params).length > 0)
    ? { userMessage, params }
    : undefined;

  if (agent.type === 'strategic') {
    await runDiscussionAgent(agent, req.user!.userId, tier, res, options);
  } else {
    await runAgent(agent, req.user!.userId, tier, res, options);
  }
  res.end();
});

// GET /agents/:id/runs — run history
router.get('/:id/runs', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, status, result, started_at, finished_at FROM agent_runs
       WHERE user_id = $1 AND agent_id = $2 ORDER BY started_at DESC LIMIT 10`,
      [req.user!.userId, req.params.id]
    );
    res.json({ runs: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

export default router;
