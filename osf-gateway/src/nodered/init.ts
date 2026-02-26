import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { verifyToken } from '../auth/jwt';
import { flowStore } from './async-context';
import storagePlugin from './storage-plugin';
import { SEED_FLOW } from './seed-flow';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { callLlm, getLlmConfig } from '../chat/llm-client';
import { callMcpTool, getMcpTools } from '../chat/tool-executor';
import { executeSandbox } from '../code-agents/sandbox';
// executeFlow no longer needed here — inject runs natively in NR runtime

let RED: any;

export async function initNodeRed(app: express.Application, server: http.Server): Promise<void> {
  if (process.env.NODE_RED_ENABLED === 'false') {
    logger.info('Node-RED disabled via NODE_RED_ENABLED=false');
    return;
  }

  try {
    RED = require('node-red');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'node-red not installed — skipping Node-RED init');
    return;
  }

  // Ensure userDir exists with package.json (Node-RED requires it)
  const userDir = '/tmp/nodered';
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(path.join(userDir, 'package.json'))) {
    fs.writeFileSync(path.join(userDir, 'package.json'), JSON.stringify({ name: 'osf-nodered-userdir', version: '1.0.0' }));
  }

  const settings = {
    httpAdminRoot: '/flows/editor',
    httpNodeRoot: '/flows/editor', // Runtime endpoints (inject, etc.) under same path
    userDir,
    storageModule: storagePlugin,
    nodesDir: [path.join(__dirname, '../../nodered-nodes')],
    editorTheme: {
      page: { title: 'OSF Flow Editor' },
      header: { title: 'OSF Flow Editor' },
      tours: false,                // Disable welcome tour
      palette: {
        editable: false,           // Don't allow installing nodes from editor
      },
    },
    logging: {
      console: { level: 'warn' },
    },
    functionGlobalContext: {},
    credentialSecret: process.env.NODE_RED_SECRET || 'osf-nodered-secret',
    adminAuth: null, // We handle auth ourselves via middleware
  };

  RED.init(server, settings);

  // Initialize gateway bridge so OSF nodes can access gateway services at runtime
  try {
    const bridge = require('../../nodered-nodes/node-red-contrib-osf/lib/gateway-bridge');
    bridge.init({ callLlm, getLlmConfig, callMcpTool, getMcpTools, executeSandbox, pool, logger });
    logger.info('Gateway bridge initialized for Node-RED runtime');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to initialize gateway bridge');
  }

  // Auth + AsyncLocalStorage middleware wrapping all Node-RED admin requests
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Try cookie first (set by /flows/auth/session), then Bearer header
    const token = req.cookies?.osf_editor_token
      || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const payload = verifyToken(token);
      flowStore.run({ userId: payload.userId }, () => {
        next();
      });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // Cookie-based session endpoint for the editor iframe
  app.get('/flows/auth/session', (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }
    const token = header.slice(7);
    try {
      verifyToken(token); // validate
      res.cookie('osf_editor_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'none',
        maxAge: 15 * 60 * 1000, // 15 min
        path: '/flows',
      });
      res.json({ ok: true });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  // Helper: extract userId from cookie or Bearer token
  function getUserIdFromReq(req: express.Request): string | null {
    const tok = req.cookies?.osf_editor_token
      || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!tok) return null;
    try { return verifyToken(tok).userId; } catch { return null; }
  }

  // Override GET /flows/editor/flows — read from DB per-user (Node-RED cache is not per-user)
  app.get('/flows/editor/flows', async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    const result = await pool.query('SELECT flow_json, revision FROM nodered_flows WHERE user_id = $1', [userId]);
    let flowJson: any[];
    let revision: string;

    if (result.rows.length > 0) {
      flowJson = result.rows[0].flow_json;
      revision = result.rows[0].revision;
    } else {
      // Seed example flow for new user
      revision = Date.now().toString();
      await pool.query(
        `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
         VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
        [userId, JSON.stringify(SEED_FLOW), revision]
      );
      logger.info({ userId }, 'Seeded example flow for new user');
      flowJson = SEED_FLOW;
    }

    // Store userId in bridge so NR nodes can access it (real UUID, not 'anonymous')
    try {
      const bridge = require('../../nodered-nodes/node-red-contrib-osf/lib/gateway-bridge');
      bridge.setEditorUserId(userId);
    } catch {}

    // Deploy flows into NR runtime so inject/debug work immediately
    try {
      await RED.runtime.flows.setFlows({
        user: { username: userId, permissions: '*' },
        flows: { flows: flowJson },
        deploymentType: 'full',
      });
      logger.info({ userId, nodeCount: flowJson.length }, 'Auto-deployed flows to NR runtime');
    } catch (deployErr: any) {
      logger.warn({ err: deployErr.message }, 'Auto-deploy to NR runtime failed (non-fatal)');
    }

    res.set('Node-RED-API-Version', 'v2');
    res.json({ rev: revision, flows: flowJson });
  });

  // Override POST /flows/editor/flows — save per-user + deploy to runtime
  app.post('/flows/editor/flows', express.json({ limit: '5mb' }), async (req, res) => {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: 'Auth required' }); return; }

    // Node-RED v2 API sends { rev, flows } or just an array
    const flows = Array.isArray(req.body) ? req.body : (req.body.flows || req.body);
    const revision = Date.now().toString();
    await pool.query(
      `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET flow_json = $2, revision = $3, updated_at = NOW()`,
      [userId, JSON.stringify(flows), revision]
    );

    // Also deploy to NR runtime
    try {
      await RED.runtime.flows.setFlows({
        user: { username: userId, permissions: '*' },
        flows: { flows },
        deploymentType: 'full',
      });
    } catch (deployErr: any) {
      logger.warn({ err: deployErr.message }, 'Deploy to NR runtime failed');
    }

    res.json({ rev: revision });
  });

  // Inject runs natively in Node-RED runtime (all OSF nodes have on('input') handlers).
  // No intercept needed — clicking inject in editor triggers NR runtime execution,
  // debug messages appear in the editor debug sidebar.

  // Mount Node-RED editor (admin UI) + runtime HTTP endpoints with auth wrapper
  app.use('/flows/editor', authMiddleware, RED.httpAdmin);
  app.use('/flows/editor', authMiddleware, RED.httpNode);

  await RED.start();
  logger.info('Node-RED editor started at /flows/editor');
}
