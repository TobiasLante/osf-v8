import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { syncRepo } from './repo-sync';
import { logger } from '../logger';

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

/**
 * Handle GitHub webhook push events.
 * Verifies HMAC-SHA256 signature and triggers re-sync.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'] as string;
  const deliveryId = req.headers['x-github-delivery'];

  if (event !== 'push') {
    res.json({ ok: true, skipped: true, reason: 'not a push event' });
    return;
  }

  const body = req.body;
  const repoFullName = body?.repository?.full_name;

  if (!repoFullName) {
    res.status(400).json({ error: 'Missing repository info' });
    return;
  }

  // Find matching agent(s) for this repo
  const result = await pool.query(
    "SELECT id, user_id, webhook_secret FROM code_agents WHERE repo_full_name = $1 AND deploy_status != 'deleted'",
    [repoFullName]
  );

  if (result.rows.length === 0) {
    res.json({ ok: true, skipped: true, reason: 'no matching agent' });
    return;
  }

  // Verify signature if webhook_secret is set on the agent
  for (const agent of result.rows) {
    const secret = agent.webhook_secret || GITHUB_WEBHOOK_SECRET;
    if (secret && signature) {
      const rawBody = JSON.stringify(body);
      const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        logger.warn({ agentId: agent.id, deliveryId }, 'Webhook signature mismatch');
        continue; // Skip this agent, don't fail the whole request
      }
    }

    // Trigger re-sync in background
    logger.info({ agentId: agent.id, repo: repoFullName, deliveryId }, 'Webhook push → re-syncing');
    syncRepo(agent.id, agent.user_id).catch(err => {
      logger.error({ err: err.message, agentId: agent.id }, 'Webhook re-sync failed');
    });
  }

  res.json({ ok: true, agents: result.rows.length });
}
