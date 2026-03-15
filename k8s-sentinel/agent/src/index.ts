import express from 'express';
import { config } from './config';
import { logger } from './logger';
import { initSchema, getIncidents, getIncidentById, getCheckRuns, insertCheckRun, insertSnapshot, getLatestSnapshot, getProtectedPods, addProtectedPod, removeProtectedPod } from './db';
import { addClient, broadcast } from './sse';
import { fetchClusterSnapshot, ClusterSnapshot } from './k8s-client';
import { runChecks } from './checker';
import { diagnoseIssues } from './diagnoser';
import { remediateIssues, approveIncident, rejectIncident } from './remediator';
import { llmChat } from './llm-client';

const app = express();
app.use(express.json());

// CORS for web UI
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

let cachedSnapshot: ClusterSnapshot | null = null;
let checkLoopRunning = false;

// --- Routes ---

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: config.remediationMode, uptime: process.uptime() });
});

app.get('/api/status', async (_req, res) => {
  try {
    const snapshot = cachedSnapshot || await getLatestSnapshot();
    res.json(snapshot || { message: 'No snapshot yet — first check cycle pending' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/incidents', async (req, res) => {
  try {
    const incidents = await getIncidents({
      severity: req.query.severity as string,
      fix_status: req.query.status as string,
      namespace: req.query.namespace as string,
    });
    res.json(incidents);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/incidents/:id', async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Not found' });
    res.json(incident);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incidents/:id/approve', async (req, res) => {
  try {
    const updated = await approveIncident(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Not found or not in proposed state' });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incidents/:id/reject', async (req, res) => {
  try {
    const updated = await rejectIncident(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream', (req, res) => {
  addClient(res);
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const snapshot = cachedSnapshot;
    const context = snapshot
      ? `Current cluster state:\n- Nodes: ${snapshot.nodes.length} (${snapshot.nodes.filter(n => n.ready).length} ready)\n- Pods: ${snapshot.pods.length} (${snapshot.pods.filter(p => p.ready).length} healthy)\n- Namespaces: ${snapshot.namespaces.map(n => `${n.name}(${n.podsHealthy}/${n.podsTotal})`).join(', ')}\n- Recent events: ${snapshot.events.slice(0, 10).map(e => `${e.reason}: ${e.involvedObject.kind}/${e.involvedObject.name}`).join(', ')}`
      : 'No cluster data available yet.';

    const answer = await llmChat([
      { role: 'system', content: `You are a Kubernetes cluster assistant. Answer questions about the cluster status concisely.\n\n${context}` },
      { role: 'user', content: message },
    ], 512);

    res.json({ answer });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Protected Pods ---

app.get('/api/protected-pods', async (_req, res) => {
  try {
    res.json(await getProtectedPods());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/protected-pods', async (req, res) => {
  try {
    const { namespace, podPattern, reason } = req.body;
    if (!namespace || !podPattern) return res.status(400).json({ error: 'namespace and podPattern required' });
    const result = await addProtectedPod(namespace, podPattern, reason);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/protected-pods', async (req, res) => {
  try {
    const { namespace, podPattern } = req.body;
    if (!namespace || !podPattern) return res.status(400).json({ error: 'namespace and podPattern required' });
    const ok = await removeProtectedPod(namespace, podPattern);
    res.json({ deleted: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pods List ---

app.get('/api/pods', async (_req, res) => {
  try {
    const snapshot = cachedSnapshot || await getLatestSnapshot();
    if (!snapshot?.pods) return res.json([]);
    const protections = await getProtectedPods();
    const pods = snapshot.pods.map((p: any) => ({
      ...p,
      protected: protections.some((prot: any) => {
        if (prot.namespace !== p.namespace && prot.namespace !== '*') return false;
        if (prot.pod_pattern === '*') return true;
        if (prot.pod_pattern.endsWith('*')) return p.name.startsWith(prot.pod_pattern.slice(0, -1));
        return p.name === prot.pod_pattern;
      }),
    }));
    res.json(pods);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Remediation Mode ---

app.get('/api/mode', (_req, res) => {
  res.json({ mode: config.remediationMode });
});

app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (!['auto', 'hitl', 'readonly'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto, hitl, or readonly' });
  }
  config.remediationMode = mode;
  logger.info({ mode }, 'Remediation mode changed');
  broadcast('mode_changed', { mode });
  res.json({ mode });
});

app.get('/api/checks', async (_req, res) => {
  try {
    const runs = await getCheckRuns();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Check Loop ---

async function checkLoop(): Promise<void> {
  if (checkLoopRunning) return;
  checkLoopRunning = true;

  try {
    logger.info('Check loop started');
    broadcast('check_start', { ts: new Date().toISOString() });

    // 1. Fetch cluster snapshot
    const snapshot = await fetchClusterSnapshot();
    cachedSnapshot = snapshot;
    await insertSnapshot(snapshot);
    broadcast('cluster_status', {
      nodes: snapshot.nodes.length,
      nodesReady: snapshot.nodes.filter(n => n.ready).length,
      pods: snapshot.pods.length,
      podsHealthy: snapshot.pods.filter(p => p.ready && p.phase === 'Running').length,
      namespaces: snapshot.namespaces.length,
      timestamp: snapshot.timestamp,
    });

    // 2. Run checks
    const issues = runChecks(snapshot);

    // 3. Diagnose
    const diagnosed = await diagnoseIssues(issues, snapshot);

    // 4+5. Remediate
    const result = await remediateIssues(diagnosed);

    // 6. Report
    const podsHealthy = snapshot.pods.filter(p => p.ready && p.phase === 'Running').length;
    const nodesReady = snapshot.nodes.filter(n => n.ready).length;

    await insertCheckRun({
      pods_total: snapshot.pods.length,
      pods_healthy: podsHealthy,
      nodes_total: snapshot.nodes.length,
      nodes_ready: nodesReady,
      issues_found: issues.length,
      fixes_applied: result.fixed,
      finished_at: new Date(),
    });

    broadcast('check_complete', {
      pods: snapshot.pods.length,
      podsHealthy,
      nodes: snapshot.nodes.length,
      nodesReady,
      issues: issues.length,
      fixed: result.fixed,
      proposed: result.proposed,
      alerted: result.alerted,
      ts: new Date().toISOString(),
    });

    logger.info({
      pods: snapshot.pods.length,
      podsHealthy,
      nodes: snapshot.nodes.length,
      nodesReady,
      issues: issues.length,
      ...result,
    }, 'Check loop completed');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Check loop error');
  } finally {
    checkLoopRunning = false;
  }
}

// --- Startup ---

async function main(): Promise<void> {
  await initSchema();

  app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, mode: config.remediationMode }, 'k8s-sentinel agent started');
  });

  // Run first check immediately, then on interval
  setTimeout(() => checkLoop(), 3000);
  setInterval(() => checkLoop(), config.checkIntervalMs);
}

main().catch(err => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
