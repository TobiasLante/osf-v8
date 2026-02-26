/**
 * OSF Node-RED Pod Server
 *
 * Standalone Node-RED instance for per-user pod architecture.
 * Each pod runs one NR editor+runtime, assigned to a single user at a time.
 *
 * Management endpoints:
 *   GET  /health         — K8s probes + pool readiness
 *   POST /nr/load-flows  — Load user flows + init HTTP bridge
 *   POST /nr/unload-flows — Clear flows before pod release
 *   GET  /nr/activity    — Last activity + running flow count
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = parseInt(process.env.PORT || '1880', 10);
const POD_NAME = process.env.POD_NAME || 'unknown';

// --- State ---
let lastActivity = Date.now();
let currentUserId = null;
let nrReady = false;
let RED;

// Track running flows by ID (not a simple counter)
const runningFlows = new Set();

// --- Activity tracking middleware ---
app.use((req, res, next) => {
  if (req.path.startsWith('/flows/editor')) {
    lastActivity = Date.now();
  }
  next();
});

// --- Management Endpoints ---

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    nrReady,
    userId: currentUserId,
    uptime: process.uptime(),
    podName: POD_NAME,
  });
});

app.get('/nr/activity', (req, res) => {
  res.json({
    lastActivity,
    userId: currentUserId,
    flowsRunning: runningFlows.size,
    idleMs: Date.now() - lastActivity,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

app.post('/nr/load-flows', express.json({ limit: '10mb' }), async (req, res) => {
  const { userId, flows, gatewayUrl, podSecret } = req.body;

  if (podSecret !== process.env.NR_POD_SECRET) {
    return res.status(403).json({ error: 'Invalid pod secret' });
  }

  if (!userId || !gatewayUrl) {
    return res.status(400).json({ error: 'userId and gatewayUrl required' });
  }

  try {
    // Clear previous state if pod is being reused
    if (currentUserId && currentUserId !== userId) {
      console.log(`[NR-Pod] Pod reuse: clearing state for ${currentUserId} before loading ${userId}`);
      runningFlows.clear();
    }

    currentUserId = userId;
    lastActivity = Date.now();

    // Initialize HTTP bridge — validate it works
    const bridge = require('./nodered-nodes/node-red-contrib-osf/lib/gateway-bridge');
    try {
      bridge.initHttp(gatewayUrl, userId, podSecret);
    } catch (bridgeErr) {
      console.error('[NR-Pod] Bridge init failed:', bridgeErr.message);
      return res.status(500).json({ error: 'Bridge initialization failed: ' + bridgeErr.message });
    }

    // Deploy flows to NR runtime
    const flowData = flows || [];
    await RED.runtime.flows.setFlows({
      user: { username: userId, permissions: '*' },
      flows: { flows: flowData },
      deploymentType: 'full',
    });

    console.log(`[NR-Pod] Loaded ${flowData.length} nodes for user ${userId}`);
    res.json({ ok: true, nodeCount: flowData.length });
  } catch (err) {
    console.error('[NR-Pod] load-flows error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/nr/unload-flows', express.json(), async (req, res) => {
  const { podSecret } = req.body || {};
  if (podSecret !== process.env.NR_POD_SECRET) {
    return res.status(403).json({ error: 'Invalid pod secret' });
  }

  try {
    const prevUser = currentUserId;
    currentUserId = null;
    runningFlows.clear();

    await RED.runtime.flows.setFlows({
      user: { username: '__system__', permissions: '*' },
      flows: { flows: [] },
      deploymentType: 'full',
    });

    console.log(`[NR-Pod] Unloaded flows (was user ${prevUser})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[NR-Pod] unload-flows error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- In-Memory Storage Module ---

let _memFlows = [];
let _memCredentials = {};
let _memSettings = {};

const inMemoryStorage = {
  init: () => Promise.resolve(),

  getFlows: () => Promise.resolve(_memFlows),

  saveFlows: (flows) => {
    if (Array.isArray(flows)) {
      _memFlows = flows;
    } else if (flows && flows.flows) {
      _memFlows = flows.flows;
    }
    return Promise.resolve();
  },

  getCredentials: () => Promise.resolve(_memCredentials),
  saveCredentials: (creds) => { _memCredentials = creds; return Promise.resolve(); },

  getSettings: () => Promise.resolve(_memSettings),
  saveSettings: (settings) => { _memSettings = settings; return Promise.resolve(); },

  getLibraryEntry: (type, name) => Promise.resolve(null),
  saveLibraryEntry: (type, name, meta, body) => Promise.resolve(),
};

// --- Track running flows by ID ---
function setupFlowTracking() {
  try {
    const events = require('@node-red/util').events;
    events.on('flows:started', (info) => {
      const id = info?.config?.id || `flow-${Date.now()}`;
      runningFlows.add(id);
    });
    events.on('flows:stopped', (info) => {
      const id = info?.config?.id || null;
      if (id) {
        runningFlows.delete(id);
      } else {
        // Fallback: if no ID, clear one entry
        const first = runningFlows.values().next().value;
        if (first) runningFlows.delete(first);
      }
    });
  } catch {
    // If events not available, flowsRunning stays 0
  }
}

// --- Node-RED Init ---

async function startNodeRed() {
  RED = require('node-red');

  // Per-pod unique userDir to avoid race conditions between concurrent pods
  const userDir = `/tmp/nodered-${POD_NAME}`;
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(path.join(userDir, 'package.json'))) {
    fs.writeFileSync(
      path.join(userDir, 'package.json'),
      JSON.stringify({ name: 'osf-nodered-pod-userdir', version: '1.0.0' })
    );
  }

  const settings = {
    httpAdminRoot: '/flows/editor',
    httpNodeRoot: '/flows/editor',
    userDir,
    storageModule: inMemoryStorage,
    nodesDir: [path.join(__dirname, 'nodered-nodes')],
    editorTheme: {
      page: { title: 'OSF Flow Editor' },
      header: { title: 'OSF Flow Editor' },
      tours: false,
      palette: { editable: false },
    },
    logging: {
      console: { level: 'warn' },
    },
    functionGlobalContext: {},
    credentialSecret: process.env.NODE_RED_SECRET || 'osf-nodered-secret',
    adminAuth: null,
  };

  const server = http.createServer(app);

  RED.init(server, settings);

  app.use('/flows/editor', RED.httpAdmin);
  app.use('/flows/editor', RED.httpNode);

  await RED.start();
  nrReady = true;

  setupFlowTracking();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[NR-Pod] Node-RED pod ready on port ${PORT}`);
  });
}

// --- Graceful Shutdown ---
process.on('SIGTERM', () => {
  console.log('[NR-Pod] SIGTERM received, shutting down...');
  if (RED) {
    RED.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    process.exit(0);
  }
});

// Start
startNodeRed().catch((err) => {
  console.error('[NR-Pod] Fatal startup error:', err);
  process.exit(1);
});
