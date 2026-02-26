/**
 * Node-RED Reverse Proxy — Routes editor requests to per-user NR pods.
 *
 * Replaces the old init.ts (embedded NR). The gateway no longer runs
 * Node-RED itself; instead it proxies requests to assigned NR pods.
 */

import http from 'http';
import express from 'express';
import httpProxy from 'http-proxy';
import { verifyToken } from '../auth/jwt';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { NrPodManager } from './pod-manager';
import { SEED_FLOW } from './seed-flow';

let podManager: NrPodManager;

/**
 * Extract userId from cookie or Bearer token.
 */
function getUserIdFromReq(req: express.Request | http.IncomingMessage): string | null {
  // Cookie
  let token: string | null = null;

  if ('cookies' in req && (req as any).cookies?.osf_editor_token) {
    token = (req as any).cookies.osf_editor_token;
  }

  // Bearer header fallback
  if (!token) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  // Parse cookie header directly (for WebSocket upgrade where cookie-parser didn't run)
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/osf_editor_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) return null;
  try {
    return verifyToken(token).userId;
  } catch {
    return null;
  }
}

export async function initNodeRedProxy(
  app: express.Application,
  server: http.Server,
  manager: NrPodManager
): Promise<void> {
  podManager = manager;

  // Create proxy server for HTTP + WebSocket
  const proxy = httpProxy.createProxyServer({
    ws: true,
    changeOrigin: true,
    // Don't buffer proxy responses (streaming support)
    selfHandleResponse: false,
  });

  proxy.on('error', (err: any, req: any, res: any) => {
    logger.error({ err: err.message, url: (req as any).url }, '[NR Proxy] Proxy error');
    if (res && 'writeHead' in res) {
      (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'application/json' });
      (res as http.ServerResponse).end(JSON.stringify({ error: 'Editor pod unavailable' }));
    }
  });

  // --- Cookie-based session endpoint (same as before) ---
  app.get('/flows/auth/session', (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }
    const token = header.slice(7);
    try {
      verifyToken(token);
      res.cookie('osf_editor_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        maxAge: 15 * 60 * 1000,
        path: '/flows',
      });
      res.json({ ok: true });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  // --- Pod status endpoint (for frontend loading state) ---
  app.get('/flows/editor/pod-status', async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    try {
      const podIp = await podManager.getPodForUser(userId);
      if (podIp) {
        res.json({ status: 'ready', podIp });
      } else {
        // Check if there are warm pods available
        const stats = await podManager.getPoolStats();
        if (stats.warm > 0) {
          res.json({ status: 'ready', message: 'Warm pod available' });
        } else {
          res.json({ status: 'provisioning', message: 'Starting editor environment...' });
        }
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Override GET /flows/editor/flows — load from DB + ensure pod assigned ---
  app.get('/flows/editor/flows', async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    try {
      // Ensure pod is assigned (this also loads flows into the pod)
      await podManager.assignPod(userId);

      // Return flows from DB (same as before)
      const result = await pool.query(
        'SELECT flow_json, revision FROM nodered_flows WHERE user_id = $1',
        [userId]
      );

      let flowJson: any[];
      let revision: string;

      if (result.rows.length > 0) {
        flowJson = result.rows[0].flow_json;
        revision = result.rows[0].revision;
      } else {
        revision = Date.now().toString();
        await pool.query(
          `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
           VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
          [userId, JSON.stringify(SEED_FLOW), revision]
        );
        flowJson = SEED_FLOW;
      }

      res.set('Node-RED-API-Version', 'v2');
      res.json({ rev: revision, flows: flowJson });
    } catch (err: any) {
      logger.error({ err: err.message, userId }, '[NR Proxy] Failed to load flows');
      res.status(500).json({ error: err.message });
    }
  });

  // --- Override POST /flows/editor/flows — save to DB + proxy deploy to pod ---
  app.post('/flows/editor/flows', express.json({ limit: '5mb' }), async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    try {
      const flows = Array.isArray(req.body) ? req.body : (req.body.flows || req.body);
      const revision = Date.now().toString();

      // Save to PostgreSQL (source of truth)
      await pool.query(
        `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET flow_json = $2, revision = $3, updated_at = NOW()`,
        [userId, JSON.stringify(flows), revision]
      );

      // Forward deploy to NR pod
      const podIp = await podManager.getPodForUser(userId);
      if (podIp) {
        try {
          await fetch(`http://${podIp}:1880/flows/editor/flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
            signal: AbortSignal.timeout(10000),
          });
        } catch (proxyErr: any) {
          logger.warn({ err: proxyErr.message }, '[NR Proxy] Deploy to pod failed (flows saved to DB)');
        }
      }

      res.json({ rev: revision });
    } catch (err: any) {
      logger.error({ err: err.message }, '[NR Proxy] Save flows failed');
      res.status(500).json({ error: err.message });
    }
  });

  // --- Catch-all proxy for editor UI + API ---
  app.use('/flows/editor', async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    try {
      const podIp = await podManager.assignPod(userId);
      // Express strips the mount path from req.url; restore it for the proxy
      req.url = req.originalUrl;
      proxy.web(req, res, {
        target: `http://${podIp}:1880`,
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[NR Proxy] Failed to proxy to NR pod');
      res.status(503).json({ error: 'Editor temporarily unavailable. Please try again.' });
    }
  });

  // --- WebSocket proxy for /flows/editor/comms ---
  server.on('upgrade', async (req, socket, head) => {
    logger.info({ url: req.url }, '[NR Proxy] WebSocket upgrade request');

    if (!req.url?.startsWith('/flows/editor/comms')) return;

    const userId = getUserIdFromReq(req);
    if (!userId) {
      logger.warn('[NR Proxy] WebSocket upgrade: no auth');
      socket.destroy();
      return;
    }

    try {
      // Use assignPod (not getPodForUser) to ensure a pod exists
      const podIp = await podManager.assignPod(userId);

      logger.info({ userId, podIp }, '[NR Proxy] Proxying WebSocket to NR pod');
      proxy.ws(req, socket, head, {
        target: `http://${podIp}:1880`,
      });
    } catch (err: any) {
      logger.error({ err: err.message }, '[NR Proxy] WebSocket proxy error');
      socket.destroy();
    }
  });

  logger.info('[NR Proxy] Node-RED reverse proxy configured');
}
