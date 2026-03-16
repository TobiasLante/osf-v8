import express from 'express';
import { config } from './config';
import { logger } from './logger';
import {
  initSchema, getIncidents, getIncidentById, getCheckRuns, insertCheckRun,
  insertSnapshot, getLatestSnapshot, getProtectedPods, addProtectedPod,
  removeProtectedPod, getClusters, getClusterById, insertCluster,
  updateCluster, deleteCluster, getNotificationConfigs, insertNotificationConfig,
  deleteNotificationConfig, getActivePredictions, acknowledgePrediction, ClusterRow,
  getRunbooks, getRunbookById, insertRunbook, updateRunbook, deleteRunbook,
  getExecutions, getExecutionById, seedRunbookTemplates, pool,
} from './db';
import { dryRunRunbook } from './runbook-engine';
import { runPredictions } from './predictor';
import { addClient, broadcast } from './sse';
import { ClusterSnapshot, createK8sClient, K8sClient } from './k8s-client';
import { fetchDockerSnapshot, removeContainer, restartContainer, stopContainer, startContainer } from './docker-client';
import { runChecks } from './checker';
import { diagnoseIssues } from './diagnoser';
import { remediateIssues, approveIncident, rejectIncident } from './remediator';
import { llmChat, llmChatWithTools } from './llm-client';
import { TOOL_DEFINITIONS, executeToolCall, approveToolCall, rejectToolCall, getPendingToolCalls, getAuditLog } from './chat-tools';
import { startClusterLoop, stopClusterLoop, stopAllLoops, getActiveLoops } from './cluster-manager';
import { notify } from './notifier';

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// Per-cluster cached snapshots
const cachedSnapshots = new Map<string, ClusterSnapshot>();
// Per-cluster K8s clients
const k8sClients = new Map<string, K8sClient>();
// Track running loops to prevent concurrent runs per cluster
const loopRunning = new Set<string>();

// --- Health ---

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: config.remediationMode, uptime: process.uptime(), loops: getActiveLoops().length });
});

// --- Cluster Status ---

app.get('/api/status', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    const snapshot = (clusterId ? cachedSnapshots.get(clusterId) : null) || await getLatestSnapshot(clusterId);
    res.json(snapshot || { message: 'No snapshot yet — first check cycle pending' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Incidents ---

app.get('/api/incidents', async (req, res) => {
  try {
    const incidents = await getIncidents({
      severity: req.query.severity as string,
      fix_status: req.query.status as string,
      namespace: req.query.namespace as string,
      cluster_id: req.query.cluster_id as string,
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

// --- Bulk Resolve Duplicate Incidents ---

app.post('/api/incidents/bulk-resolve-duplicates', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    // Keep only the newest incident per type+resource_name, resolve the rest
    const result = await pool.query(`
      UPDATE incidents SET fix_status = 'resolved', resolved_at = NOW()
      WHERE fix_status IN ('pending', 'proposed', 'alert')
        AND ($1::uuid IS NULL OR cluster_id = $1)
        AND id NOT IN (
          SELECT DISTINCT ON (type, resource_name) id
          FROM incidents
          WHERE fix_status IN ('pending', 'proposed', 'alert')
            AND ($1::uuid IS NULL OR cluster_id = $1)
          ORDER BY type, resource_name, created_at DESC
        )
    `, [clusterId || null]);
    broadcast('incidents_updated', { resolved: result.rowCount });
    res.json({ resolved: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/incidents/bulk-resolve-all', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    const result = await pool.query(`
      UPDATE incidents SET fix_status = 'resolved', resolved_at = NOW()
      WHERE fix_status IN ('pending', 'proposed', 'alert')
        AND ($1::uuid IS NULL OR cluster_id = $1)
    `, [clusterId || null]);
    broadcast('incidents_updated', { resolved: result.rowCount });
    res.json({ resolved: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- SSE ---

app.get('/api/stream', (req, res) => {
  addClient(res);
});

// --- Chat ---

app.post('/api/chat', async (req, res) => {
  try {
    const { message, cluster_id } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const clusterId = cluster_id;
    const snapshot = clusterId ? cachedSnapshots.get(clusterId) : cachedSnapshots.values().next().value;
    const cluster = clusterId ? await getClusterById(clusterId) : null;
    const k8sClient = clusterId ? k8sClients.get(clusterId) : undefined;
    const clusterInfo = cluster ? `Cluster: ${cluster.name} (${cluster.type})` : '';
    const modeInfo = `Current mode: ${config.remediationMode}`;

    const context = snapshot
      ? `${clusterInfo}\n${modeInfo}\nState: ${snapshot.nodes.length} nodes (${snapshot.nodes.filter(n => n.ready).length} ready), ${snapshot.pods.length} pods (${snapshot.pods.filter(p => p.ready).length} healthy)`
      : 'No cluster data available yet.';

    const systemPrompt = `You are a Kubernetes/Docker cluster operations assistant with access to monitoring and management tools.

IMPORTANT RULES:
- You can use tools to query cluster state (always safe)
- For write operations (restart, delete, rollback): the governance system will check permissions automatically
- In readonly mode, write tools are blocked — inform the user they need to switch to hitl or auto mode
- For protected pods, write tools require approval — inform the user approval is pending
- NEVER suggest running kubectl commands directly — always use the provided tools
- Be concise and helpful

${context}`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    // First LLM call — may return tool calls
    const llmResponse = await llmChatWithTools(messages, TOOL_DEFINITIONS);

    if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
      // Execute each tool call through governance
      const toolResults: any[] = [];
      for (const tc of llmResponse.tool_calls) {
        const result = await executeToolCall(tc.function.name, JSON.parse(tc.function.arguments || '{}'), {
          clusterId: clusterId || undefined,
          cluster: cluster || undefined,
          k8sClient,
          snapshot: snapshot || undefined,
        });
        toolResults.push({ tool_call_id: tc.id, name: tc.function.name, result });
      }

      // Second LLM call with tool results to generate final answer
      messages.push({ role: 'assistant', content: null, tool_calls: llmResponse.tool_calls });
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: JSON.stringify(tr.result),
        });
      }

      const finalResponse = await llmChat(messages, 512);
      res.json({ answer: finalResponse, tool_calls: toolResults });
    } else {
      // No tool calls — just return the text answer
      res.json({ answer: llmResponse.content || llmResponse });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat error');
    res.status(500).json({ error: err.message });
  }
});

// --- Tool Approval Endpoints ---

app.get('/api/tool-calls/pending', async (req, res) => {
  try { res.json(await getPendingToolCalls(req.query.cluster_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tool-calls/:id/approve', async (req, res) => {
  try {
    const clusterId = req.body.cluster_id;
    const k8sClient = clusterId ? k8sClients.get(clusterId) : undefined;
    const cluster = clusterId ? await getClusterById(clusterId) : null;
    const snapshot = clusterId ? cachedSnapshots.get(clusterId) : undefined;
    const result = await approveToolCall(req.params.id, { clusterId, cluster: cluster || undefined, k8sClient, snapshot });
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tool-calls/:id/reject', async (req, res) => {
  try { await rejectToolCall(req.params.id); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/audit-log', async (req, res) => {
  try { res.json(await getAuditLog(req.query.cluster_id as string, parseInt(req.query.limit as string) || 50)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// --- Protected Pods ---

app.get('/api/protected-pods', async (req, res) => {
  try {
    res.json(await getProtectedPods(req.query.cluster_id as string));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/protected-pods', async (req, res) => {
  try {
    const { namespace, podPattern, reason, cluster_id } = req.body;
    if (!namespace || !podPattern) return res.status(400).json({ error: 'namespace and podPattern required' });
    const result = await addProtectedPod(namespace, podPattern, reason, cluster_id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/protected-pods', async (req, res) => {
  try {
    const { namespace, podPattern, cluster_id } = req.body;
    if (!namespace || !podPattern) return res.status(400).json({ error: 'namespace and podPattern required' });
    const ok = await removeProtectedPod(namespace, podPattern, cluster_id);
    res.json({ deleted: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pods List ---

app.get('/api/pods', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    const snapshot = (clusterId ? cachedSnapshots.get(clusterId) : null) || await getLatestSnapshot(clusterId);
    if (!snapshot?.pods) return res.json([]);
    const protections = await getProtectedPods(clusterId);
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

// --- K8s Pod Actions ---

app.post('/api/pods/:namespace/:name/restart', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    if (!clusterId) return res.status(400).json({ error: 'cluster_id required' });
    const cluster = await getClusterById(clusterId);
    if (!cluster || cluster.type !== 'k8s') return res.status(400).json({ error: 'Not a K8s cluster' });
    const client = k8sClients.get(clusterId);
    if (!client) return res.status(500).json({ error: 'No K8s client for this cluster' });
    await client.deletePod(req.params.namespace, req.params.name);
    broadcast('pod_action', { action: 'restart', pod: req.params.name, namespace: req.params.namespace, clusterId });
    res.json({ ok: true, action: 'restart', pod: `${req.params.namespace}/${req.params.name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Docker Container Actions ---

app.post('/api/containers/:name/stop', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    if (!clusterId) return res.status(400).json({ error: 'cluster_id required' });
    const cluster = await getClusterById(clusterId);
    if (!cluster || cluster.type !== 'docker') return res.status(400).json({ error: 'Not a Docker cluster' });
    const dockerConf = cluster.config as any;
    const dockerOpts = dockerConf.host
      ? { host: dockerConf.host, port: dockerConf.port || 2375 }
      : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
    await stopContainer(dockerOpts, req.params.name);
    broadcast('container_action', { action: 'stop', container: req.params.name, clusterId });
    res.json({ ok: true, action: 'stop', container: req.params.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/containers/:name/start', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    if (!clusterId) return res.status(400).json({ error: 'cluster_id required' });
    const cluster = await getClusterById(clusterId);
    if (!cluster || cluster.type !== 'docker') return res.status(400).json({ error: 'Not a Docker cluster' });
    const dockerConf = cluster.config as any;
    const dockerOpts = dockerConf.host
      ? { host: dockerConf.host, port: dockerConf.port || 2375 }
      : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
    await startContainer(dockerOpts, req.params.name);
    broadcast('container_action', { action: 'start', container: req.params.name, clusterId });
    res.json({ ok: true, action: 'start', container: req.params.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/containers/:name/restart', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    if (!clusterId) return res.status(400).json({ error: 'cluster_id required' });
    const cluster = await getClusterById(clusterId);
    if (!cluster || cluster.type !== 'docker') return res.status(400).json({ error: 'Not a Docker cluster' });
    const dockerConf = cluster.config as any;
    const dockerOpts = dockerConf.host
      ? { host: dockerConf.host, port: dockerConf.port || 2375 }
      : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
    await restartContainer(dockerOpts, req.params.name);
    broadcast('container_action', { action: 'restart', container: req.params.name, clusterId });
    res.json({ ok: true, action: 'restart', container: req.params.name });
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

app.get('/api/checks', async (req, res) => {
  try {
    const runs = await getCheckRuns(20, req.query.cluster_id as string);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Clusters CRUD ---

app.get('/api/clusters', async (_req, res) => {
  try {
    res.json(await getClusters());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clusters', async (req, res) => {
  try {
    const { name, type, config: clusterConfig } = req.body;
    if (!name || !type || !clusterConfig) return res.status(400).json({ error: 'name, type, config required' });
    const cluster = await insertCluster(name, type, clusterConfig);
    // Start check loop for new cluster
    initClusterClient(cluster);
    startClusterLoop(cluster, checkLoopForCluster, config.checkIntervalMs);
    broadcast('cluster_added', { id: cluster.id, name: cluster.name, type: cluster.type });
    res.json(cluster);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clusters/:id', async (req, res) => {
  try {
    const updated = await updateCluster(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    // Restart loop if config changed
    stopClusterLoop(updated.id);
    if (updated.enabled) {
      initClusterClient(updated);
      startClusterLoop(updated, checkLoopForCluster, config.checkIntervalMs);
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clusters/:id', async (req, res) => {
  try {
    stopClusterLoop(req.params.id);
    k8sClients.delete(req.params.id);
    const ok = await deleteCluster(req.params.id);
    if (ok) broadcast('cluster_removed', { id: req.params.id });
    res.json({ deleted: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Notifications ---

app.get('/api/notifications/config', async (_req, res) => {
  try {
    res.json(await getNotificationConfigs());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/config', async (req, res) => {
  try {
    const { type, url, events } = req.body;
    if (!type || !url) return res.status(400).json({ error: 'type and url required' });
    const nc = await insertNotificationConfig(type, url, events || []);
    res.json(nc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/config/:id', async (req, res) => {
  try {
    const ok = await deleteNotificationConfig(req.params.id);
    res.json({ deleted: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/test', async (_req, res) => {
  try {
    await notify('test', { description: 'Test notification from k8s-sentinel', severity: 'harmless' });
    res.json({ sent: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Predictions ---

app.get('/api/predictions', async (req, res) => {
  try {
    const clusterId = req.query.cluster_id as string;
    const predictions = await getActivePredictions(clusterId || undefined);
    res.json(predictions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/predictions/:id/acknowledge', async (req, res) => {
  try {
    const prediction = await acknowledgePrediction(req.params.id);
    if (!prediction) return res.status(404).json({ error: 'Not found' });
    broadcast('prediction_acknowledged', { id: prediction.id });
    res.json(prediction);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Runbooks ---

app.get('/api/runbooks', async (req, res) => {
  try { res.json(await getRunbooks(req.query.cluster_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/runbooks/:id', async (req, res) => {
  try {
    const rb = await getRunbookById(req.params.id);
    if (!rb) return res.status(404).json({ error: 'Not found' });
    res.json(rb);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/runbooks', async (req, res) => {
  try { res.json(await insertRunbook(req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/runbooks/:id', async (req, res) => {
  try {
    const updated = await updateRunbook(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/runbooks/:id', async (req, res) => {
  try { res.json({ deleted: await deleteRunbook(req.params.id) }); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/runbooks/:id/test', async (req, res) => {
  try {
    const rb = await getRunbookById(req.params.id);
    if (!rb) return res.status(404).json({ error: 'Not found' });
    const mockIssue = { type: rb.match_type || '', severity: 'medium' as const, namespace: 'test', resourceKind: 'Pod', resourceName: 'test-pod', description: 'Dry run test', diagnosis: '', proposedFix: '' };
    const result = await dryRunRunbook(rb as any, mockIssue);
    res.json({ steps: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// --- Runbook Executions ---

app.get('/api/runbook-executions', async (req, res) => {
  try { res.json(await getExecutions(req.query.cluster_id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/runbook-executions/:id', async (req, res) => {
  try {
    const ex = await getExecutionById(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Not found' });
    res.json(ex);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// --- Check Loop ---

function initClusterClient(cluster: ClusterRow): void {
  if (cluster.type === 'k8s') {
    const { kubeconfigPath, context } = cluster.config as { kubeconfigPath: string; context: string };
    k8sClients.set(cluster.id, createK8sClient(kubeconfigPath, context));
  }
  // Docker clusters don't need a persistent client
}

async function checkLoopForCluster(clusterId: string, cluster: any): Promise<void> {
  if (loopRunning.has(clusterId)) return;
  loopRunning.add(clusterId);

  try {
    const clusterRow = cluster as ClusterRow;
    logger.info({ cluster: clusterRow.name, type: clusterRow.type }, 'Check loop started');
    broadcast('check_start', { cluster_id: clusterId, cluster_name: clusterRow.name, ts: new Date().toISOString() });

    // 1. Fetch snapshot based on cluster type
    let snapshot: ClusterSnapshot;
    if (clusterRow.type === 'docker') {
      const dockerConf = clusterRow.config as any;
      const dockerOpts = dockerConf.host
        ? { host: dockerConf.host, port: dockerConf.port || 2375 }
        : { socketPath: dockerConf.socketPath || config.docker.socketPath };
      snapshot = await fetchDockerSnapshot(dockerOpts);
    } else {
      const client = k8sClients.get(clusterId);
      if (!client) throw new Error(`No K8s client for cluster ${clusterRow.name}`);
      snapshot = await client.fetchClusterSnapshot();
    }

    cachedSnapshots.set(clusterId, snapshot);
    await insertSnapshot(snapshot, clusterId);
    broadcast('cluster_status', {
      cluster_id: clusterId,
      cluster_name: clusterRow.name,
      nodes: snapshot.nodes.length,
      nodesReady: snapshot.nodes.filter(n => n.ready).length,
      pods: snapshot.pods.length,
      podsHealthy: snapshot.pods.filter(p => p.ready && p.phase === 'Running').length,
      namespaces: snapshot.namespaces.length,
      timestamp: snapshot.timestamp,
    });

    // 2. Run checks
    const issues = runChecks(snapshot);

    // 3. Diagnose (uses LLM for medium/critical)
    const diagnosed = await diagnoseIssues(issues, snapshot);

    // 4+5. Remediate
    const k8sClient = k8sClients.get(clusterId);
    const result = await remediateIssues(diagnosed, clusterId, clusterRow, k8sClient);

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
    }, clusterId);

    broadcast('check_complete', {
      cluster_id: clusterId,
      cluster_name: clusterRow.name,
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

    // Run predictive analysis asynchronously
    setImmediate(() => runPredictions(clusterId, snapshot).catch(err => logger.error({ err: err.message }, 'Prediction error')));

    logger.info({
      cluster: clusterRow.name,
      pods: snapshot.pods.length,
      podsHealthy,
      nodes: snapshot.nodes.length,
      nodesReady,
      issues: issues.length,
      ...result,
    }, 'Check loop completed');
  } catch (err: any) {
    logger.error({ err: err.message, clusterId }, 'Check loop error');
  } finally {
    loopRunning.delete(clusterId);
  }
}

// --- Startup ---

async function seedDefaultCluster(): Promise<void> {
  const clusters = await getClusters();
  if (clusters.length > 0) return;

  logger.info('No clusters found — seeding default K8s cluster from env');
  await insertCluster('microk8s', 'k8s', {
    kubeconfigPath: config.k8s.kubeconfigPath,
    context: config.k8s.context,
  });
}

async function main(): Promise<void> {
  await initSchema();
  await seedDefaultCluster();
  await seedRunbookTemplates();

  // Load all clusters and start loops
  const clusters = await getClusters();
  for (const cluster of clusters) {
    if (!cluster.enabled) continue;
    initClusterClient(cluster);
    startClusterLoop(cluster, checkLoopForCluster, config.checkIntervalMs);
  }

  app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, mode: config.remediationMode, clusters: clusters.length }, 'k8s-sentinel agent started');
  });
}

main().catch(err => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
