import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyToken, JwtPayload } from './jwt';
import { pool } from '../db/pool';
import { logSecurity, logger } from '../logger';
import { checkRateLimit } from '../rate-limit';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      requestId?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;

  // Try Bearer JWT token first
  if (header?.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      req.user = verifyToken(token);
      next();
      return;
    } catch {
      logSecurity('auth.token.invalid', { ip: req.ip, path: req.path });
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  }

  // Try API key (X-API-Key header)
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey?.startsWith('osf_')) {
    // Rate-limit: 10 attempts/min per IP to prevent brute-force
    if (!checkRateLimit(`apikey-auth:${req.ip}`, 10)) {
      logSecurity('auth.apikey.ratelimit', { ip: req.ip, path: req.path });
      res.status(429).json({ error: 'Too many authentication attempts. Try again later.' });
      return;
    }

    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const result = await pool.query(
        'SELECT id, email, tier, role FROM users WHERE api_key_hash = $1',
        [apiKeyHash]
      );
      if (result.rows.length === 0) {
        logSecurity('auth.apikey.invalid', { ip: req.ip, path: req.path });
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      const user = result.rows[0];
      req.user = { userId: user.id, email: user.email, tier: user.tier, role: user.role || 'user' };
      next();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'API key auth DB query failed');
      res.status(500).json({ error: 'Authentication failed' });
    }
    return;
  }

  // Try editor cookie (set by /flows/auth/session for iframe use)
  const editorToken = req.cookies?.osf_editor_token;
  if (editorToken) {
    try {
      req.user = verifyToken(editorToken);
      next();
      return;
    } catch {
      logSecurity('auth.cookie.invalid', { ip: req.ip, path: req.path });
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
  }

  res.status(401).json({ error: 'Missing Authorization header or API key' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
