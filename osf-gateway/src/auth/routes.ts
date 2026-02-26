import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { pool } from '../db/pool';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt';
import { requireAuth } from './middleware';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';
import { sendVerificationEmail, sendPasswordResetEmail } from '../email/sender';
import { encryptApiKey } from './crypto';
import { callLlm } from '../chat/llm-client';

const router = Router();

const IS_PROD = process.env.NODE_ENV === 'production';

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('osf_access_token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 min (matches JWT expiry)
    path: '/',
  });
  res.cookie('osf_refresh_token', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/auth/refresh',
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('osf_access_token', { path: '/' });
  res.clearCookie('osf_refresh_token', { path: '/auth/refresh' });
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Strip HTML tags to prevent stored XSS
function sanitize(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

function generateToken(): string {
  return crypto.randomUUID();
}

const registerSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().max(100).optional(),
  marketingConsent: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password required').max(128),
});

// ─── Register ───────────────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`register:${ip}`, 3)) {
      logSecurity('rate_limit.exceeded', { ip, endpoint: '/auth/register' });
      res.status(429).json({ error: 'Too many registration attempts. Try again later.' });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { email, password, name, marketingConsent } = parsed.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = `osf_${uuid().replace(/-/g, '')}`;
    const apiKeyHash = hashApiKey(apiKey);

    // Transaction: user + seed flow + verification token must succeed together
    const client = await pool.connect();
    let user: any;
    let token: string;
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO users (email, password_hash, name, api_key, api_key_hash, email_verified, marketing_consent, marketing_consent_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
         RETURNING id, email, name`,
        [email, passwordHash, name ? sanitize(name) : null, apiKey, apiKeyHash, !!marketingConsent, marketingConsent ? new Date() : null]
      );
      user = result.rows[0];

      // Seed example flow for new user
      const { SEED_FLOW } = require('../nodered/seed-flow');
      await client.query(
        `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
         VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
        [user.id, JSON.stringify(SEED_FLOW), Date.now().toString()]
      );

      // Create verification token (24h expiry)
      token = generateToken();
      await client.query(
        `INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, 'verify', NOW() + INTERVAL '24 hours')`,
        [user.id, token]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Send verification email
    await sendVerificationEmail(email, user.name, token);

    logSecurity('auth.register.success', { userId: user.id, email, ip });
    res.status(201).json({ message: 'Check your email to verify your account.' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Register error');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Login ──────────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`login:${ip}`, 10)) {
      logSecurity('rate_limit.exceeded', { ip, endpoint: '/auth/login' });
      res.status(429).json({ error: 'Too many login attempts. Try again later.' });
      return;
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { email, password } = parsed.data;

    if (!checkRateLimit(`login:email:${email}`, 5)) {
      logSecurity('rate_limit.exceeded', { email, endpoint: '/auth/login' });
      res.status(429).json({ error: 'Too many attempts for this account. Try again later.' });
      return;
    }

    const result = await pool.query(
      'SELECT id, email, name, tier, role, api_key, password_hash, locked_until, failed_login_count, email_verified, created_at FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Constant-time: always run bcrypt to prevent timing-based user enumeration
      await bcrypt.compare(password, '$2a$12$000000000000000000000uGSBZDeGRDKMfhOBCuVwJyBLXqeHh.W');
      logSecurity('auth.login.failed', { email, ip, reason: 'unknown_email' });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];

    // Account lockout check
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMs = new Date(user.locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      logSecurity('auth.lockout', { email, ip, remainingMin });
      res.status(423).json({ error: `Account locked. Try again in ${remainingMin} minute(s).` });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const newCount = (user.failed_login_count || 0) + 1;
      if (newCount >= LOCKOUT_THRESHOLD) {
        // Lock account
        await pool.query(
          'UPDATE users SET failed_login_count = $1, locked_until = NOW() + INTERVAL \'15 minutes\' WHERE id = $2',
          [newCount, user.id]
        );
        logSecurity('auth.lockout', { email, ip, attempts: newCount });
        res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
      } else {
        await pool.query('UPDATE users SET failed_login_count = $1 WHERE id = $2', [newCount, user.id]);
        logSecurity('auth.login.failed', { email, ip, reason: 'wrong_password', attempts: newCount });
        res.status(401).json({ error: 'Invalid credentials' });
      }
      return;
    }

    // Check email verification
    if (!user.email_verified) {
      logSecurity('auth.login.failed', { email, ip, reason: 'email_not_verified' });
      res.status(403).json({ error: 'Please verify your email first.', needsVerification: true, email });
      return;
    }

    // Reset failed login count on success
    await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);

    const accessToken = signAccessToken({ userId: user.id, email: user.email, tier: user.tier, role: user.role || 'user' });
    const { token: refreshToken, tokenId } = signRefreshToken(user.id);

    // Store refresh token
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokenId]
    );

    const { password_hash: _, locked_until: _l, failed_login_count: _f, email_verified: _v, api_key: _ak, ...safeUser } = user;
    setAuthCookies(res, accessToken, refreshToken);
    logSecurity('auth.login.success', { userId: user.id, email, ip });
    res.json({ token: accessToken, refreshToken, user: safeUser });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Verify Email ───────────────────────────────────────────────────────────
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: 'Token required' });
      return;
    }

    const result = await pool.query(
      `SELECT et.id, et.user_id, et.used, et.expires_at, u.email, u.name, u.tier, u.role, u.api_key, u.email_verified, u.created_at
       FROM email_tokens et JOIN users u ON u.id = et.user_id
       WHERE et.token = $1 AND et.type = 'verify'`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid verification link.' });
      return;
    }

    const row = result.rows[0];

    if (row.used) {
      res.status(400).json({ error: 'This link has already been used.' });
      return;
    }

    if (new Date(row.expires_at) < new Date()) {
      res.status(400).json({ error: 'This link has expired. Please request a new one.' });
      return;
    }

    // Mark token as used and verify user
    await pool.query('UPDATE email_tokens SET used = TRUE WHERE id = $1', [row.id]);
    await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [row.user_id]);

    // Auto-login: issue tokens
    const accessToken = signAccessToken({ userId: row.user_id, email: row.email, tier: row.tier, role: row.role || 'user' });
    const { token: refreshToken, tokenId } = signRefreshToken(row.user_id);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [row.user_id, tokenId]
    );

    setAuthCookies(res, accessToken, refreshToken);
    logSecurity('auth.email.verified', { userId: row.user_id, email: row.email });
    res.json({
      token: accessToken,
      refreshToken,
      user: { id: row.user_id, email: row.email, name: row.name, tier: row.tier, role: row.role || 'user', created_at: row.created_at },
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Verify email error');
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── Resend Verification ────────────────────────────────────────────────────
router.post('/resend-verification', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`resend:${email}`, 1)) {
      res.status(429).json({ error: 'Please wait a minute before requesting another email.' });
      return;
    }

    const result = await pool.query(
      'SELECT id, name, email_verified FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0 || result.rows[0].email_verified) {
      // Don't leak whether account exists — always return success
      res.json({ message: 'If your account exists and is unverified, a new email has been sent.' });
      return;
    }

    const user = result.rows[0];
    const token = generateToken();
    await pool.query(
      `INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, 'verify', NOW() + INTERVAL '24 hours')`,
      [user.id, token]
    );

    await sendVerificationEmail(email, user.name, token);

    logSecurity('auth.verification.resent', { userId: user.id, email, ip });
    res.json({ message: 'If your account exists and is unverified, a new email has been sent.' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Resend verification error');
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// ─── Forgot Password ────────────────────────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`forgot:${ip}`, 3)) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    // Always return same message to prevent info leak
    const successMsg = 'If an account with that email exists, we sent a password reset link.';

    const result = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      res.json({ message: successMsg });
      return;
    }

    const user = result.rows[0];
    const token = generateToken();
    await pool.query(
      `INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, 'reset', NOW() + INTERVAL '1 hour')`,
      [user.id, token]
    );

    await sendPasswordResetEmail(email, user.name, token);

    logSecurity('auth.password.reset_requested', { userId: user.id, email, ip });
    res.json({ message: successMsg });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Forgot password error');
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── Reset Password ─────────────────────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: 'Token and password required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const result = await pool.query(
      `SELECT id, user_id, used, expires_at FROM email_tokens WHERE token = $1 AND type = 'reset'`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid reset link.' });
      return;
    }

    const row = result.rows[0];

    if (row.used) {
      res.status(400).json({ error: 'This link has already been used.' });
      return;
    }

    if (new Date(row.expires_at) < new Date()) {
      res.status(400).json({ error: 'This link has expired. Please request a new one.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Update password, mark token used, revoke all refresh tokens
    await pool.query('UPDATE email_tokens SET used = TRUE WHERE id = $1', [row.id]);
    await pool.query('UPDATE users SET password_hash = $1, email_verified = TRUE WHERE id = $2', [passwordHash, row.user_id]);
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [row.user_id]);

    logSecurity('auth.password.reset_completed', { userId: row.user_id });
    res.json({ message: 'Password has been reset. You can now sign in.' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Reset password error');
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── Refresh Token ──────────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.osf_refresh_token;
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);

    // Atomic check+revoke+rotate in SERIALIZABLE transaction to prevent race condition
    const client = await pool.connect();
    let user: any;
    let accessToken: string;
    let newRefreshToken: string;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Check if token exists and is not revoked
      const result = await client.query(
        'SELECT id FROM refresh_tokens WHERE token_id = $1 AND revoked = FALSE AND expires_at > NOW()',
        [payload.tokenId]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        logSecurity('auth.token.invalid', { userId: payload.userId, reason: 'revoked_or_expired' });
        res.status(401).json({ error: 'Refresh token revoked or expired' });
        return;
      }

      // Revoke old refresh token (rotation)
      await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_id = $1', [payload.tokenId]);

      // Get current user data
      const userResult = await client.query(
        'SELECT id, email, tier, role FROM users WHERE id = $1',
        [payload.userId]
      );
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'User not found' });
        return;
      }
      user = userResult.rows[0];

      // Issue new tokens
      accessToken = signAccessToken({ userId: user.id, email: user.email, tier: user.tier, role: user.role || 'user' });
      const refreshResult = signRefreshToken(user.id);
      newRefreshToken = refreshResult.token;

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, refreshResult.tokenId]
      );

      await client.query('COMMIT');
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    setAuthCookies(res, accessToken, newRefreshToken);
    logSecurity('auth.token.refresh', { userId: user.id });
    res.json({ token: accessToken, refreshToken: newRefreshToken });
  } catch (err: any) {
    logSecurity('auth.token.invalid', { reason: 'invalid_refresh_token' });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ─── Logout ─────────────────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [req.user!.userId]);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── Me ─────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, tier, role, avatar, created_at,
              CASE WHEN api_key IS NOT NULL THEN 'osf_' || repeat('•', 24) || RIGHT(api_key, 4) ELSE NULL END AS api_key_masked
       FROM users WHERE id = $1`,
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Me error');
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ─── LLM Settings ──────────────────────────────────────────────────────────
const VALID_PROVIDERS = ['platform', 'openai', 'anthropic', 'custom'];

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: string[] }> = {
  openai: { baseUrl: 'https://api.openai.com', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'] },
  anthropic: { baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'] },
};

router.get('/llm-settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT llm_provider, llm_base_url, llm_model FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { llm_provider, llm_base_url, llm_model } = result.rows[0];
    res.json({
      provider: llm_provider || 'platform',
      baseUrl: llm_base_url || null,
      model: llm_model || null,
      hasApiKey: !!(await pool.query('SELECT llm_api_key_encrypted FROM users WHERE id = $1 AND llm_api_key_encrypted IS NOT NULL', [req.user!.userId])).rows.length,
      providerDefaults: PROVIDER_DEFAULTS,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Get LLM settings error');
    res.status(500).json({ error: 'Failed to fetch LLM settings' });
  }
});

router.put('/llm-settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const { provider, baseUrl, model, apiKey } = req.body;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
      return;
    }

    // Platform = reset to defaults
    if (provider === 'platform') {
      await pool.query(
        `UPDATE users SET llm_provider = 'platform', llm_base_url = NULL, llm_model = NULL, llm_api_key_encrypted = NULL WHERE id = $1`,
        [req.user!.userId]
      );
      res.json({ ok: true, provider: 'platform' });
      return;
    }

    // Validate URL format + block SSRF to internal services
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
          return;
        }
        // Resolve hostname to IP and check if it's private
        const { isPrivateUrl } = await import('../util/ssrf-guard');
        if (await isPrivateUrl(parsed)) {
          res.status(400).json({ error: 'Private/internal URLs not allowed' });
          return;
        }
      } catch (urlErr: any) {
        if (urlErr?.message === 'SSRF_BLOCKED') {
          res.status(400).json({ error: 'Private/internal URLs not allowed' });
          return;
        }
        res.status(400).json({ error: 'Invalid base URL format' });
        return;
      }
    }

    const resolvedUrl = baseUrl || PROVIDER_DEFAULTS[provider]?.baseUrl;
    if (!resolvedUrl) {
      res.status(400).json({ error: 'Base URL required for custom provider' });
      return;
    }

    if (!model) {
      res.status(400).json({ error: 'Model name required' });
      return;
    }

    // Test the connection
    try {
      await callLlm(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        { baseUrl: resolvedUrl, model, apiKey }
      );
    } catch (err: any) {
      res.status(422).json({ error: `Connection test failed: ${err.message.slice(0, 200)}` });
      return;
    }

    // Encrypt and save
    const encryptedKey = apiKey ? encryptApiKey(apiKey) : null;
    await pool.query(
      `UPDATE users SET llm_provider = $1, llm_base_url = $2, llm_model = $3, llm_api_key_encrypted = COALESCE($4, llm_api_key_encrypted) WHERE id = $5`,
      [provider, resolvedUrl, model, encryptedKey, req.user!.userId]
    );

    res.json({ ok: true, provider, baseUrl: resolvedUrl, model });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Update LLM settings error');
    res.status(500).json({ error: 'Failed to update LLM settings' });
  }
});

// ─── Profile: Change Password ─────────────────────────────────────────────
router.put('/profile/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password required' }); return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' }); return;
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.userId]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) { res.status(403).json({ error: 'Current password is incorrect' }); return; }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user!.userId]);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Change password error');
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── Profile: Change Email ────────────────────────────────────────────────
router.put('/profile/email', requireAuth, async (req: Request, res: Response) => {
  try {
    const { newEmail, password } = req.body;
    if (!newEmail || !password) {
      res.status(400).json({ error: 'New email and password required' }); return;
    }

    // Verify password
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.userId]);
    if (result.rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) { res.status(403).json({ error: 'Password is incorrect' }); return; }

    // Check if email is taken
    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1 AND id != $2', [newEmail.toLowerCase(), req.user!.userId]);
    if (existing.rows.length > 0) { res.status(409).json({ error: 'Email already in use' }); return; }

    // Update email, mark as unverified, send verification
    await pool.query(
      'UPDATE users SET email = $1, email_verified = false WHERE id = $2',
      [newEmail.toLowerCase(), req.user!.userId]
    );

    const token = generateToken();
    await pool.query(
      `INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, 'verify', NOW() + INTERVAL '24 hours')`,
      [req.user!.userId, token]
    );
    await sendVerificationEmail(newEmail, null, token);

    res.json({ ok: true, message: 'Email updated. Please verify your new email.' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Change email error');
    res.status(500).json({ error: 'Failed to change email' });
  }
});

// ─── Token Usage ──────────────────────────────────────────────────────────
router.get('/usage', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT token_quota, tokens_used, quota_reset_at FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { token_quota, tokens_used, quota_reset_at } = result.rows[0];
    const quota = token_quota ?? 100000;
    const used = tokens_used ?? 0;
    res.json({
      tokensUsed: used,
      tokenQuota: quota,
      quotaResetAt: quota_reset_at,
      percentUsed: quota > 0 ? Math.round((used / quota) * 100) : 0,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Usage endpoint error');
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// ─── Profile: Update Name & Avatar ────────────────────────────────────────
router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, avatar } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name ? sanitize(name) : null);
    }
    if (avatar !== undefined) {
      // Avatar is stored as a string: color hex + initials, or an emoji
      updates.push(`avatar = $${idx++}`);
      values.push(avatar ? avatar.slice(0, 100) : null);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Nothing to update' }); return;
    }

    values.push(req.user!.userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Update profile error');
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
