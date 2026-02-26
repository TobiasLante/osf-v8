/**
 * Internal API — endpoints for NR pods to call back to the gateway.
 * Authenticated via X-NR-Pod-Secret header (shared secret).
 *
 * These endpoints provide LLM, MCP, and DB access to Node-RED pods
 * running in separate containers.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { callLlm, getLlmConfig } from '../chat/llm-client';
import { callMcpTool, getMcpTools } from '../chat/tool-executor';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { checkRateLimit } from '../rate-limit';

const router = Router();

// Auth middleware: require pod secret (timing-safe comparison)
function requirePodSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-nr-pod-secret'] as string;
  const expected = process.env.NR_POD_SECRET;
  if (!secret || !expected || secret.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
    res.status(403).json({ error: 'Invalid pod secret' });
    return;
  }
  next();
}

router.use(requirePodSecret);

// Rate-limit: 100 req/min per pod IP to prevent a compromised pod from flooding LLM/MCP
router.use((req: Request, res: Response, next: NextFunction) => {
  const podIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`internal:${podIp}`, 100)) {
    logger.warn({ podIp, path: req.path }, '[Internal API] Rate limit exceeded');
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
});

// POST /internal/llm — Proxy LLM call
router.post('/llm', verifyPodOwnership, async (req: Request, res: Response) => {
  try {
    const { messages, tools, config, userId } = req.body;
    const llmConfig = config || await getLlmConfig(userId, 'free');
    const result = await callLlm(messages, tools, llmConfig);
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, '[Internal API] LLM call failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /internal/llm-config — Get LLM config for user+tier
router.get('/llm-config', verifyPodOwnership, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const tier = req.query.tier as string || 'free';
    const config = await getLlmConfig(userId, tier);
    res.json(config);
  } catch (err: any) {
    logger.error({ err: err.message }, '[Internal API] getLlmConfig failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /internal/mcp-tool — Execute MCP tool
router.post('/mcp-tool', async (req: Request, res: Response) => {
  try {
    const { name, args } = req.body;
    const result = await callMcpTool(name, args);
    res.json({ result });
  } catch (err: any) {
    logger.error({ err: err.message, tool: req.body?.name }, '[Internal API] MCP tool call failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /internal/mcp-tools — List all available MCP tools
router.get('/mcp-tools', async (_req: Request, res: Response) => {
  try {
    const tools = await getMcpTools();
    res.json({ tools });
  } catch (err: any) {
    logger.error({ err: err.message }, '[Internal API] getMcpTools failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /internal/agents/:id — Fetch agent by ID
router.get('/agents/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM agents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json(null);
      return;
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    logger.error({ err: err.message }, '[Internal API] agents query failed');
    res.status(500).json({ error: err.message });
  }
});

// --- Cross-user access prevention ---
// Verify that the pod (identified by source IP) is assigned to the userId in the request.
// Prevents a compromised pod from accessing another user's data.
async function verifyPodOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.body?.userId || req.query?.userId as string;
  if (!userId) {
    next(); // No userId in request — nothing to verify
    return;
  }

  const podIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  try {
    const result = await pool.query(
      `SELECT assigned_user_id FROM nodered_pods WHERE pod_ip = $1 AND status = 'assigned'`,
      [podIp]
    );
    if (result.rows.length > 0 && result.rows[0].assigned_user_id !== userId) {
      logger.warn({ podIp, requestedUserId: userId, actualUserId: result.rows[0].assigned_user_id },
        '[Internal API] Cross-user access blocked');
      res.status(403).json({ error: 'Access denied: pod not assigned to this user' });
      return;
    }
  } catch (err: any) {
    logger.error({ err: err.message }, '[Internal API] Pod ownership check failed');
    res.status(503).json({ error: 'Pod ownership verification unavailable' });
    return;
  }
  next();
}

// --- Code Agent Storage (for osf-ts sandbox) ---

// GET /internal/storage?agentId=X&userId=Y&key=Z
router.get('/storage', verifyPodOwnership, async (req: Request, res: Response) => {
  try {
    const { agentId, userId, key } = req.query as Record<string, string>;
    const result = await pool.query(
      'SELECT value FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
      [agentId, userId, key]
    );
    res.json({ value: result.rows.length > 0 ? result.rows[0].value : null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /internal/storage — upsert
router.post('/storage', verifyPodOwnership, async (req: Request, res: Response) => {
  try {
    const { agentId, userId, key, value } = req.body;
    await pool.query(
      `INSERT INTO code_agent_storage (agent_id, user_id, key, value, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (agent_id, user_id, key) DO UPDATE SET value = $4::jsonb, updated_at = NOW()`,
      [agentId, userId, key, value]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /internal/storage?agentId=X&userId=Y&key=Z
router.delete('/storage', verifyPodOwnership, async (req: Request, res: Response) => {
  try {
    const { agentId, userId, key } = req.query as Record<string, string>;
    await pool.query(
      'DELETE FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
      [agentId, userId, key]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
