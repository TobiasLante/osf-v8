import { K8sClient, ClusterSnapshot } from './k8s-client';
import { isPodProtected, getIncidents, ClusterRow, pool } from './db';
import { stopContainer, startContainer, restartContainer, getContainerLogs, execInContainer, dockerStats } from './docker-client';
import { config } from './config';
import { logger } from './logger';
import { broadcast } from './sse';

// --- Types ---

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export type DangerLevel = 'safe' | 'dangerous' | 'critical';

interface ToolMeta {
  name: string;
  dangerLevel: DangerLevel;
  execute: (params: any, ctx: ToolContext) => Promise<any>;
}

export interface ToolContext {
  clusterId?: string;
  cluster?: ClusterRow;
  k8sClient?: K8sClient;
  snapshot?: ClusterSnapshot;
  userId?: string;
}

export interface ToolCallResult {
  name: string;
  result?: any;
  error?: string;
  blocked?: boolean;
  blocked_reason?: string;
  requires_approval?: boolean;
  approval_id?: string;
}

// --- Tool Definitions (OpenAI function calling format) ---

export const TOOL_DEFINITIONS: ToolDef[] = [
  // Safe tools
  {
    type: 'function',
    function: {
      name: 'list_pods',
      description: 'List all pods in the cluster, optionally filtered by namespace',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace (optional)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pod_status',
      description: 'Get detailed status of a specific pod',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Pod namespace' },
          pod_name: { type: 'string', description: 'Pod name' },
        },
        required: ['namespace', 'pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pod_logs',
      description: 'Fetch recent logs from a pod (K8s clusters only)',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Pod namespace' },
          pod_name: { type: 'string', description: 'Pod name' },
          lines: { type: 'string', description: 'Number of log lines to fetch (default 50)' },
        },
        required: ['namespace', 'pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_nodes',
      description: 'List all nodes in the cluster with their status',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_events',
      description: 'List recent Kubernetes events, optionally filtered by namespace',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace (optional)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_incidents',
      description: 'Query incidents from the database, optionally filtered by namespace or severity',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace (optional)' },
          severity: { type: 'string', description: 'Filter by severity: harmless, medium, critical', enum: ['harmless', 'medium', 'critical'] },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cluster_health',
      description: 'Get a summary of cluster health: nodes ready/total, pods healthy/total, recent issues',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // Dangerous tools
  {
    type: 'function',
    function: {
      name: 'restart_pod',
      description: 'Restart a pod by deleting it (the controller will recreate it)',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Pod namespace' },
          pod_name: { type: 'string', description: 'Pod name' },
        },
        required: ['namespace', 'pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_pod',
      description: 'Delete a pod permanently',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Pod namespace' },
          pod_name: { type: 'string', description: 'Pod name' },
        },
        required: ['namespace', 'pod_name'],
      },
    },
  },
  // Docker diagnostics
  {
    type: 'function',
    function: {
      name: 'docker_logs',
      description: 'Fetch recent logs from a Docker container. Use this when asked about container errors, crashes, or what a container is doing.',
      parameters: {
        type: 'object',
        properties: {
          pod_name: { type: 'string', description: 'Container name' },
          lines: { type: 'number', description: 'Number of log lines (default 50)' },
        },
        required: ['pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_stats',
      description: 'Get CPU and memory usage of all running Docker containers. Use when asked about resource usage, performance, or which container uses most resources.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exec_command',
      description: 'Execute a whitelisted command inside a running Docker container. Allowed commands: nvidia-smi, df, free, uptime, ps, top, cat /proc/meminfo, cat /proc/cpuinfo. Use for GPU status, disk space, memory, system diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          pod_name: { type: 'string', description: 'Container to exec into (e.g. "llamacpp-server" for GPU commands)' },
          command: { type: 'string', description: 'Command to run (must be whitelisted)' },
        },
        required: ['pod_name', 'command'],
      },
    },
  },
  // Docker container actions (user-initiated, bypass readonly)
  {
    type: 'function',
    function: {
      name: 'stop_container',
      description: 'Stop a Docker container. Only works on Docker clusters.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Always "docker"' },
          pod_name: { type: 'string', description: 'Container name' },
        },
        required: ['pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_container',
      description: 'Start a stopped Docker container. Only works on Docker clusters.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Always "docker"' },
          pod_name: { type: 'string', description: 'Container name' },
        },
        required: ['pod_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restart_container',
      description: 'Restart a Docker container. Only works on Docker clusters.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Always "docker"' },
          pod_name: { type: 'string', description: 'Container name' },
        },
        required: ['pod_name'],
      },
    },
  },
  // Critical tools
  {
    type: 'function',
    function: {
      name: 'rollback_deployment',
      description: 'Rollback a deployment to its previous version',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Deployment namespace' },
          deployment_name: { type: 'string', description: 'Deployment name' },
        },
        required: ['namespace', 'deployment_name'],
      },
    },
  },
];

// --- Tool Implementations ---

const toolList: ToolMeta[] = [
  // Safe: list_pods
  {
    name: 'list_pods',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.snapshot) return { error: 'No cluster snapshot available' };
      let pods = ctx.snapshot.pods;
      if (params.namespace) {
        pods = pods.filter(p => p.namespace === params.namespace);
      }
      return pods.map(p => ({
        name: p.name,
        namespace: p.namespace,
        phase: p.phase,
        ready: p.ready,
        restartCount: p.restartCount,
        node: p.nodeName,
      }));
    },
  },
  // Safe: get_pod_status
  {
    name: 'get_pod_status',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.snapshot) return { error: 'No cluster snapshot available' };
      const pod = ctx.snapshot.pods.find(
        p => p.name === params.pod_name && p.namespace === params.namespace,
      );
      if (!pod) return { error: `Pod ${params.namespace}/${params.pod_name} not found` };
      return pod;
    },
  },
  // Safe: get_pod_logs
  {
    name: 'get_pod_logs',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.k8sClient) return { error: 'Pod logs not available (no K8s client — Docker clusters not supported)' };
      const lines = parseInt(params.lines) || 50;
      const logs = await ctx.k8sClient.getPodLogs(params.namespace, params.pod_name, lines);
      return { logs };
    },
  },
  // Safe: list_nodes
  {
    name: 'list_nodes',
    dangerLevel: 'safe',
    execute: async (_params, ctx) => {
      if (!ctx.snapshot) return { error: 'No cluster snapshot available' };
      return ctx.snapshot.nodes.map(n => ({
        name: n.name,
        ready: n.ready,
        conditions: n.conditions,
        capacity: n.capacity,
        allocatable: n.allocatable,
      }));
    },
  },
  // Safe: get_events
  {
    name: 'get_events',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.snapshot) return { error: 'No cluster snapshot available' };
      let events = ctx.snapshot.events;
      if (params.namespace) {
        events = events.filter(e => e.namespace === params.namespace);
      }
      return events.slice(0, 30).map(e => ({
        type: e.type,
        reason: e.reason,
        message: e.message,
        namespace: e.namespace,
        object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
        count: e.count,
        lastTimestamp: e.lastTimestamp,
      }));
    },
  },
  // Safe: get_incidents
  {
    name: 'get_incidents',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      const incidents = await getIncidents({
        namespace: params.namespace,
        severity: params.severity,
        cluster_id: ctx.clusterId,
      });
      return incidents.slice(0, 20).map(i => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        namespace: i.namespace,
        resource: `${i.resource_kind}/${i.resource_name}`,
        description: i.description,
        status: i.fix_status,
        created_at: i.created_at,
      }));
    },
  },
  // Safe: cluster_health
  {
    name: 'cluster_health',
    dangerLevel: 'safe',
    execute: async (_params, ctx) => {
      if (!ctx.snapshot) return { error: 'No cluster snapshot available' };
      const s = ctx.snapshot;
      const nodesReady = s.nodes.filter(n => n.ready).length;
      const podsHealthy = s.pods.filter(p => p.ready && p.phase === 'Running').length;
      const recentIssues = await getIncidents({ cluster_id: ctx.clusterId });
      const pendingIssues = recentIssues.filter(i => i.fix_status === 'pending' || i.fix_status === 'proposed');
      return {
        nodes: { total: s.nodes.length, ready: nodesReady },
        pods: { total: s.pods.length, healthy: podsHealthy },
        namespaces: s.namespaces.map(ns => ({ name: ns.name, healthy: ns.podsHealthy, total: ns.podsTotal })),
        recentEvents: s.events.length,
        pendingIssues: pendingIssues.length,
        mode: config.remediationMode,
        snapshotTime: s.timestamp,
      };
    },
  },
  // Dangerous: restart_pod
  {
    name: 'restart_pod',
    dangerLevel: 'dangerous',
    execute: async (params, ctx) => {
      if (!ctx.k8sClient) return { error: 'No K8s client available — cannot restart pods on Docker clusters' };
      await ctx.k8sClient.deletePod(params.namespace, params.pod_name);
      return { success: true, message: `Pod ${params.namespace}/${params.pod_name} deleted for restart` };
    },
  },
  // Dangerous: delete_pod
  {
    name: 'delete_pod',
    dangerLevel: 'dangerous',
    execute: async (params, ctx) => {
      if (!ctx.k8sClient) return { error: 'No K8s client available — cannot delete pods on Docker clusters' };
      await ctx.k8sClient.deletePod(params.namespace, params.pod_name);
      return { success: true, message: `Pod ${params.namespace}/${params.pod_name} deleted` };
    },
  },
  // Docker: docker_logs
  {
    name: 'docker_logs',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      const logs = await getContainerLogs(opts, params.pod_name, params.lines || 50);
      return { container: params.pod_name, logs };
    },
  },
  // Docker: docker_stats
  {
    name: 'docker_stats',
    dangerLevel: 'safe',
    execute: async (_params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      return await dockerStats(opts);
    },
  },
  // Docker: exec_command (whitelisted)
  {
    name: 'exec_command',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const allowed = ['nvidia-smi', 'df -h', 'free -m', 'uptime', 'ps aux', 'top -bn1', 'cat /proc/meminfo', 'cat /proc/cpuinfo'];
      const cmd = (params.command || '').trim();
      if (!allowed.some(a => cmd === a || cmd.startsWith(a + ' '))) {
        return { error: `Command not allowed. Permitted: ${allowed.join(', ')}` };
      }
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      const output = await execInContainer(opts, params.pod_name, ['sh', '-c', cmd]);
      return { container: params.pod_name, command: cmd, output };
    },
  },
  // Docker: stop_container (safe — explicit user action)
  {
    name: 'stop_container',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      await stopContainer(opts, params.pod_name);
      broadcast('container_action', { action: 'stop', container: params.pod_name, clusterId: ctx.clusterId });
      return { success: true, message: `Container ${params.pod_name} stopped` };
    },
  },
  // Docker: start_container (safe — explicit user action)
  {
    name: 'start_container',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      await startContainer(opts, params.pod_name);
      broadcast('container_action', { action: 'start', container: params.pod_name, clusterId: ctx.clusterId });
      return { success: true, message: `Container ${params.pod_name} started` };
    },
  },
  // Docker: restart_container (safe — explicit user action)
  {
    name: 'restart_container',
    dangerLevel: 'safe',
    execute: async (params, ctx) => {
      if (!ctx.cluster || ctx.cluster.type !== 'docker') return { error: 'Only available on Docker clusters' };
      const dockerConf = ctx.cluster.config as any;
      const opts = dockerConf.host ? { host: dockerConf.host, port: dockerConf.port || 2375 } : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      await restartContainer(opts, params.pod_name);
      broadcast('container_action', { action: 'restart', container: params.pod_name, clusterId: ctx.clusterId });
      return { success: true, message: `Container ${params.pod_name} restarted` };
    },
  },
  // Critical: rollback_deployment
  {
    name: 'rollback_deployment',
    dangerLevel: 'critical',
    execute: async (params, ctx) => {
      if (!ctx.k8sClient) return { error: 'No K8s client available — cannot rollback on Docker clusters' };
      await ctx.k8sClient.rollbackDeployment(params.namespace, params.deployment_name);
      return { success: true, message: `Deployment ${params.namespace}/${params.deployment_name} rolled back` };
    },
  },
];

// --- Registry ---

export const TOOL_REGISTRY = new Map<string, ToolMeta>();
for (const tool of toolList) {
  TOOL_REGISTRY.set(tool.name, tool);
}

// --- Governance Gate ---

export async function executeToolCall(
  toolName: string,
  params: any,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const tool = TOOL_REGISTRY.get(toolName);
  if (!tool) {
    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_call',
      tool_name: toolName,
      params,
      status: 'blocked',
      blocked_reason: 'Unknown tool',
      user_id: ctx.userId,
    });
    return { name: toolName, error: `Unknown tool: ${toolName}`, blocked: true, blocked_reason: 'Unknown tool' };
  }

  const mode = config.remediationMode;

  // 1. Readonly mode blocks all non-safe tools
  if (mode === 'readonly' && tool.dangerLevel !== 'safe') {
    const reason = `Blocked: remediation mode is "readonly". Switch to "hitl" or "auto" to enable write operations.`;
    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_call',
      tool_name: toolName,
      params,
      status: 'blocked',
      blocked_reason: reason,
      user_id: ctx.userId,
    });
    logger.info({ tool: toolName, mode, reason }, 'Tool call blocked');
    return { name: toolName, blocked: true, blocked_reason: reason };
  }

  // 2. Check if tool targets a protected pod
  let needsApproval = false;
  let approvalReason = '';

  const targetNamespace = params.namespace;
  const targetPod = params.pod_name;

  if (tool.dangerLevel !== 'safe' && targetNamespace && targetPod) {
    const isProtected = await isPodProtected(targetNamespace, targetPod, ctx.clusterId);
    if (isProtected) {
      needsApproval = true;
      approvalReason = `Pod ${targetNamespace}/${targetPod} is protected`;
    }
  }

  // 3. HITL mode: dangerous/critical tools need approval
  if (mode === 'hitl' && (tool.dangerLevel === 'dangerous' || tool.dangerLevel === 'critical') && !needsApproval) {
    needsApproval = true;
    approvalReason = `Tool "${toolName}" (${tool.dangerLevel}) requires approval in HITL mode`;
  }

  // 4. Auto mode with protected pod still needs approval
  // (needsApproval already set above if pod is protected)

  // 5. If approval needed, create pending tool call
  if (needsApproval) {
    const pending = await insertPendingToolCall({
      cluster_id: ctx.clusterId,
      tool_name: toolName,
      params,
      danger_level: tool.dangerLevel,
      reason: approvalReason,
    });

    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_call',
      tool_name: toolName,
      params,
      status: 'pending',
      blocked_reason: approvalReason,
      user_id: ctx.userId,
    });

    broadcast('tool_approval_required', {
      id: pending.id,
      tool_name: toolName,
      params,
      danger_level: tool.dangerLevel,
      reason: approvalReason,
    });

    logger.info({ tool: toolName, approvalId: pending.id, reason: approvalReason }, 'Tool call pending approval');
    return { name: toolName, requires_approval: true, approval_id: pending.id, blocked_reason: approvalReason };
  }

  // 6. Execute the tool
  try {
    const result = await tool.execute(params, ctx);

    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_call',
      tool_name: toolName,
      params,
      result: JSON.stringify(result).slice(0, 2000),
      status: 'allowed',
      user_id: ctx.userId,
    });

    logger.info({ tool: toolName, dangerLevel: tool.dangerLevel }, 'Tool call executed');
    return { name: toolName, result };
  } catch (err: any) {
    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_call',
      tool_name: toolName,
      params,
      result: err.message,
      status: 'allowed',
      user_id: ctx.userId,
    });

    logger.error({ tool: toolName, err: err.message }, 'Tool execution failed');
    return { name: toolName, error: err.message };
  }
}

// --- Approve / Reject pending tool calls ---

export async function approveToolCall(approvalId: string, ctx: ToolContext): Promise<ToolCallResult> {
  const pending = await getPendingToolCallById(approvalId);
  if (!pending) return { name: 'unknown', error: 'Pending tool call not found' };
  if (pending.status !== 'pending') return { name: pending.tool_name, error: `Tool call already ${pending.status}` };

  await updatePendingToolCall(approvalId, 'approved');

  const tool = TOOL_REGISTRY.get(pending.tool_name);
  if (!tool) return { name: pending.tool_name, error: 'Tool no longer exists' };

  try {
    const result = await tool.execute(pending.params, ctx);

    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_approved',
      tool_name: pending.tool_name,
      params: pending.params,
      result: JSON.stringify(result).slice(0, 2000),
      status: 'approved',
      user_id: ctx.userId,
    });

    broadcast('tool_approved', { id: approvalId, tool_name: pending.tool_name, result });
    logger.info({ tool: pending.tool_name, approvalId }, 'Tool call approved and executed');
    return { name: pending.tool_name, result };
  } catch (err: any) {
    await insertAuditLog({
      cluster_id: ctx.clusterId,
      action: 'tool_approved',
      tool_name: pending.tool_name,
      params: pending.params,
      result: err.message,
      status: 'approved',
      user_id: ctx.userId,
    });

    logger.error({ tool: pending.tool_name, approvalId, err: err.message }, 'Approved tool execution failed');
    return { name: pending.tool_name, error: err.message };
  }
}

export async function rejectToolCall(approvalId: string): Promise<void> {
  const pending = await getPendingToolCallById(approvalId);
  if (!pending) return;

  await updatePendingToolCall(approvalId, 'rejected');

  await insertAuditLog({
    cluster_id: pending.cluster_id,
    action: 'tool_rejected',
    tool_name: pending.tool_name,
    params: pending.params,
    status: 'rejected',
  });

  broadcast('tool_rejected', { id: approvalId, tool_name: pending.tool_name });
  logger.info({ tool: pending.tool_name, approvalId }, 'Tool call rejected');
}

// --- DB helpers (audit_log + pending_tool_calls) ---

export async function insertAuditLog(entry: {
  cluster_id?: string;
  action: string;
  tool_name?: string;
  params?: any;
  result?: string;
  status: string;
  blocked_reason?: string;
  user_id?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (cluster_id, action, tool_name, params, result, status, blocked_reason, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.cluster_id || null,
        entry.action,
        entry.tool_name || null,
        entry.params ? JSON.stringify(entry.params) : null,
        entry.result || null,
        entry.status,
        entry.blocked_reason || null,
        entry.user_id || null,
      ],
    );
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to insert audit log');
  }
}

export async function getAuditLog(clusterId?: string, limit = 50): Promise<any[]> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM audit_log WHERE cluster_id = $1 ORDER BY created_at DESC LIMIT $2',
      [clusterId, limit],
    );
    return result.rows;
  }
  const result = await pool.query(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return result.rows;
}

export async function insertPendingToolCall(call: {
  cluster_id?: string;
  tool_name: string;
  params: any;
  danger_level: string;
  reason?: string;
}): Promise<{ id: string }> {
  const result = await pool.query(
    `INSERT INTO pending_tool_calls (cluster_id, tool_name, params, danger_level, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      call.cluster_id || null,
      call.tool_name,
      JSON.stringify(call.params),
      call.danger_level,
      call.reason || null,
    ],
  );
  return { id: result.rows[0].id };
}

export async function getPendingToolCalls(clusterId?: string): Promise<any[]> {
  if (clusterId) {
    const result = await pool.query(
      `SELECT * FROM pending_tool_calls WHERE cluster_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [clusterId],
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM pending_tool_calls WHERE status = 'pending' ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function updatePendingToolCall(id: string, status: string): Promise<any> {
  const result = await pool.query(
    `UPDATE pending_tool_calls SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id],
  );
  return result.rows[0] || null;
}

export async function getPendingToolCallById(id: string): Promise<any> {
  const result = await pool.query('SELECT * FROM pending_tool_calls WHERE id = $1', [id]);
  return result.rows[0] || null;
}
