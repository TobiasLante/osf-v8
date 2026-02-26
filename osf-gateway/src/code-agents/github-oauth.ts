import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { pool } from '../db/pool';
import { encryptApiKey, decryptApiKey } from '../auth/crypto';
import { logger } from '../logger';
import crypto from 'crypto';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://openshopfloor.zeroguess.ai';
const API_URL = process.env.API_URL || 'https://osf-api.zeroguess.ai';

// Cleanup expired OAuth states every 5 minutes
setInterval(() => {
  pool.query("DELETE FROM oauth_states WHERE expires_at < NOW()").catch(() => {});
}, 5 * 60 * 1000);

// GET /code-agents/github/connect — redirect to GitHub OAuth
router.get('/connect', requireAuth, async (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(503).json({ error: 'GitHub integration not configured' });
    return;
  }

  const state = crypto.randomBytes(20).toString('hex');
  await pool.query(
    "INSERT INTO oauth_states (state, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
    [state, req.user!.userId]
  );

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${API_URL}/code-agents/github/callback`,
    scope: 'repo read:user',
    state,
  });

  res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});

// GET /code-agents/github/callback — OAuth token exchange
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    res.redirect(`${FRONTEND_URL}/settings?github=error&reason=missing_params`);
    return;
  }

  // Atomically fetch and delete the state (prevents replay)
  const stateResult = await pool.query(
    "DELETE FROM oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING user_id",
    [state]
  );
  if (stateResult.rows.length === 0) {
    res.redirect(`${FRONTEND_URL}/settings?github=error&reason=invalid_state`);
    return;
  }
  const stateData = { userId: stateResult.rows[0].user_id };

  try {
    // Exchange code for token
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData: any = await tokenResp.json();
    if (tokenData.error || !tokenData.access_token) {
      logger.warn({ error: tokenData.error }, 'GitHub OAuth token exchange failed');
      res.redirect(`${FRONTEND_URL}/settings?github=error&reason=token_exchange`);
      return;
    }

    // Get GitHub user info
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userResp.ok) {
      res.redirect(`${FRONTEND_URL}/settings?github=error&reason=user_fetch`);
      return;
    }

    const ghUser: any = await userResp.json();

    // Store encrypted token
    const encryptedToken = encryptApiKey(tokenData.access_token);

    await pool.query(
      `INSERT INTO github_connections (user_id, github_username, github_id, access_token_encrypted, scopes, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         github_username = $2, github_id = $3, access_token_encrypted = $4, scopes = $5, updated_at = NOW()`,
      [stateData.userId, ghUser.login, ghUser.id, encryptedToken, tokenData.scope || '']
    );

    logger.info({ userId: stateData.userId, github: ghUser.login }, 'GitHub connected');
    res.redirect(`${FRONTEND_URL}/settings?github=connected&username=${encodeURIComponent(ghUser.login)}`);
  } catch (err: any) {
    logger.error({ err: err.message }, 'GitHub OAuth callback error');
    res.redirect(`${FRONTEND_URL}/settings?github=error&reason=server_error`);
  }
});

// GET /code-agents/github/status — connection status
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT github_username, github_id, scopes, created_at FROM github_connections WHERE user_id = $1',
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      res.json({ connected: false });
      return;
    }

    res.json({
      connected: true,
      username: result.rows[0].github_username,
      githubId: result.rows[0].github_id,
      scopes: result.rows[0].scopes,
      connectedAt: result.rows[0].created_at,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'GitHub status error');
    res.status(500).json({ error: 'Failed to check GitHub status' });
  }
});

// DELETE /code-agents/github/disconnect — remove GitHub connection
router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM github_connections WHERE user_id = $1', [req.user!.userId]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'GitHub disconnect error');
    res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

// GET /code-agents/github/repos — list user's repos
router.get('/repos', requireAuth, async (req: Request, res: Response) => {
  try {
    const conn = await pool.query(
      'SELECT access_token_encrypted FROM github_connections WHERE user_id = $1',
      [req.user!.userId]
    );

    if (conn.rows.length === 0) {
      res.status(400).json({ error: 'GitHub not connected' });
      return;
    }

    const token = decryptApiKey(conn.rows[0].access_token_encrypted);
    const page = parseInt(req.query.page as string) || 1;

    const reposResp = await fetch(
      `https://api.github.com/user/repos?sort=updated&per_page=30&page=${page}&type=all`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!reposResp.ok) {
      const text = await reposResp.text();
      logger.warn({ status: reposResp.status, body: text.slice(0, 200) }, 'GitHub repos fetch failed');
      res.status(502).json({ error: 'Failed to fetch repos from GitHub' });
      return;
    }

    const repos: any[] = await reposResp.json() as any[];
    const mapped = repos.map((r: any) => ({
      fullName: r.full_name,
      name: r.name,
      description: r.description,
      private: r.private,
      url: r.html_url,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
      language: r.language,
    }));

    res.json({ repos: mapped });
  } catch (err: any) {
    logger.error({ err: err.message }, 'GitHub repos error');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

/** Get decrypted GitHub token for a user (used by repo-sync) */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const result = await pool.query(
    'SELECT access_token_encrypted FROM github_connections WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  return decryptApiKey(result.rows[0].access_token_encrypted);
}

export default router;
