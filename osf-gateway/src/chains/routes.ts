import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { getAllChains, getChain, getUserChains, createChain, updateChain, deleteChain } from './registry';
import { runChain } from './runner';
import { AVAILABLE_CONDITIONS } from './conditions';
import { checkRateLimit } from '../rate-limit';
import { logger } from '../logger';

const router = Router();

// ─── Validation schemas ────────────────────────────────────────────────────
const chainStepSchema = z.object({
  agentId: z.string().min(1),
  label: z.string().max(100).optional(),
  condition: z.string().max(50).default('always'),
  passContext: z.boolean().default(true),
});

const createChainSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  steps: z.array(chainStepSchema).min(2).max(10),
  icon: z.string().max(4).default('🔗'),
  category: z.string().max(50).default('General'),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).default('Intermediate'),
  openSource: z.boolean().default(false),
});

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// GET /chains — list all chains
router.get('/', async (_req: Request, res: Response) => {
  try {
    const chains = await getAllChains();
    res.json({ chains });
  } catch (err: any) {
    logger.error({ err: err.message }, 'List chains error');
    res.status(500).json({ error: 'Failed to list chains' });
  }
});

// GET /chains/conditions — list available conditions
router.get('/conditions', (_req: Request, res: Response) => {
  res.json({ conditions: AVAILABLE_CONDITIONS });
});

// GET /chains/mine — list user's own chains
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    const chains = await getUserChains(req.user!.userId);
    res.json({ chains });
  } catch (err: any) {
    logger.error({ err: err.message }, 'My chains error');
    res.status(500).json({ error: 'Failed to fetch your chains' });
  }
});

// POST /chains — create a new chain
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createChainSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { name, description, steps, icon, category, difficulty, openSource } = parsed.data;

    // Generate unique slug
    let id = slugify(name);
    const existing = await getChain(id);
    if (existing) {
      id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }

    const chain = await createChain({
      id,
      name,
      description,
      steps: steps.map(s => ({
        agentId: s.agentId,
        label: s.label,
        condition: s.condition,
        passContext: s.passContext,
      })),
      icon,
      category,
      difficulty,
      authorId: req.user!.userId,
      openSource,
    });

    res.status(201).json({ chain, message: 'Chain deployed! It is now live.' });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Chain with this name already exists' });
      return;
    }
    logger.error({ err: err.message }, 'Create chain error');
    res.status(500).json({ error: 'Failed to create chain' });
  }
});

// PUT /chains/:id — update own chain
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const updated = await updateChain(req.params.id, req.user!.userId, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Chain not found or not owned by you' });
      return;
    }
    res.json({ chain: updated });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Update chain error');
    res.status(500).json({ error: 'Failed to update chain' });
  }
});

// DELETE /chains/:id — delete own chain
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteChain(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Chain not found or not owned by you' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Delete chain error');
    res.status(500).json({ error: 'Failed to delete chain' });
  }
});

// GET /chains/:id — chain detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const chain = await getChain(req.params.id);
    if (!chain) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ chain });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch chain' });
  }
});

// POST /chains/run/:id — run a chain (SSE)
router.post('/run/:id', requireAuth, async (req: Request, res: Response) => {
  if (!checkRateLimit(`chain:${req.user!.userId}`, 3)) {
    res.status(429).json({ error: 'Too many chain runs. Please wait.' });
    return;
  }

  const chain = await getChain(req.params.id);
  if (!chain) {
    res.status(404).json({ error: 'Chain not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  const tier = req.user!.tier || 'free';
  await runChain(chain, req.user!.userId, tier, res);
  res.end();
});

export default router;
