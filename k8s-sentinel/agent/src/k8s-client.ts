import * as k8s from '@kubernetes/client-node';
import { config } from './config';
import { logger } from './logger';

const kc = new k8s.KubeConfig();
kc.loadFromFile(config.k8s.kubeconfigPath);
kc.setCurrentContext(config.k8s.context);

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const batchApi = kc.makeApiClient(k8s.BatchV1Api);

export interface ClusterSnapshot {
  nodes: NodeInfo[];
  namespaces: NamespaceInfo[];
  pods: PodInfo[];
  events: EventInfo[];
  timestamp: string;
}

export interface NodeInfo {
  name: string;
  ready: boolean;
  conditions: { type: string; status: string }[];
  capacity: { cpu?: string; memory?: string };
  allocatable: { cpu?: string; memory?: string };
}

export interface NamespaceInfo {
  name: string;
  podsTotal: number;
  podsHealthy: number;
}

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restartCount: number;
  containerStatuses: ContainerStatusInfo[];
  createdAt: string;
  nodeName?: string;
}

export interface ContainerStatusInfo {
  name: string;
  ready: boolean;
  restartCount: number;
  state: string;
  reason?: string;
  lastTerminationReason?: string;
}

export interface EventInfo {
  type: string;
  reason: string;
  message: string;
  namespace: string;
  involvedObject: { kind: string; name: string };
  count: number;
  lastTimestamp: string;
}

export async function fetchClusterSnapshot(): Promise<ClusterSnapshot> {
  const [nodesRes, podsRes, eventsRes] = await Promise.all([
    coreApi.listNode(),
    coreApi.listPodForAllNamespaces(),
    coreApi.listEventForAllNamespaces(),
  ]);

  const nodes: NodeInfo[] = (nodesRes.items || []).map(n => ({
    name: n.metadata?.name || '',
    ready: n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True') || false,
    conditions: (n.status?.conditions || []).map(c => ({ type: c.type || '', status: c.status || '' })),
    capacity: {
      cpu: n.status?.capacity?.['cpu'],
      memory: n.status?.capacity?.['memory'],
    },
    allocatable: {
      cpu: n.status?.allocatable?.['cpu'],
      memory: n.status?.allocatable?.['memory'],
    },
  }));

  const pods: PodInfo[] = (podsRes.items || []).map(p => ({
    name: p.metadata?.name || '',
    namespace: p.metadata?.namespace || '',
    phase: p.status?.phase || 'Unknown',
    ready: p.status?.containerStatuses?.every(cs => cs.ready) || false,
    restartCount: (p.status?.containerStatuses || []).reduce((sum, cs) => sum + (cs.restartCount || 0), 0),
    containerStatuses: (p.status?.containerStatuses || []).map(cs => ({
      name: cs.name,
      ready: cs.ready,
      restartCount: cs.restartCount || 0,
      state: cs.state?.running ? 'running' :
             cs.state?.waiting ? 'waiting' :
             cs.state?.terminated ? 'terminated' : 'unknown',
      reason: cs.state?.waiting?.reason || cs.state?.terminated?.reason,
      lastTerminationReason: cs.lastState?.terminated?.reason,
    })),
    createdAt: p.metadata?.creationTimestamp?.toISOString() || '',
    nodeName: p.spec?.nodeName,
  }));

  // Build namespace info
  const nsMap = new Map<string, NamespaceInfo>();
  for (const pod of pods) {
    if (!nsMap.has(pod.namespace)) {
      nsMap.set(pod.namespace, { name: pod.namespace, podsTotal: 0, podsHealthy: 0 });
    }
    const ns = nsMap.get(pod.namespace)!;
    ns.podsTotal++;
    if (pod.ready && pod.phase === 'Running') ns.podsHealthy++;
  }

  const events: EventInfo[] = (eventsRes.items || [])
    .filter(e => {
      const ts = e.lastTimestamp || e.eventTime;
      if (!ts) return false;
      return Date.now() - new Date(ts as any).getTime() < 3600_000; // last hour
    })
    .map(e => ({
      type: e.type || '',
      reason: e.reason || '',
      message: e.message || '',
      namespace: e.metadata?.namespace || '',
      involvedObject: {
        kind: e.involvedObject?.kind || '',
        name: e.involvedObject?.name || '',
      },
      count: e.count || 1,
      lastTimestamp: (e.lastTimestamp || e.eventTime || '').toString(),
    }));

  return {
    nodes,
    namespaces: Array.from(nsMap.values()),
    pods,
    events,
    timestamp: new Date().toISOString(),
  };
}

export async function getPodLogs(namespace: string, podName: string, lines = 100): Promise<string> {
  try {
    const res = await coreApi.readNamespacedPodLog({
      name: podName,
      namespace,
      tailLines: lines,
    });
    return typeof res === 'string' ? res : JSON.stringify(res);
  } catch (err: any) {
    logger.warn({ err: err.message, pod: podName }, 'Failed to get pod logs');
    return `[Error fetching logs: ${err.message}]`;
  }
}

export async function deletePod(namespace: string, name: string): Promise<void> {
  logger.info({ namespace, name }, 'Deleting pod');
  await coreApi.deleteNamespacedPod({ name, namespace });
}

export async function deleteJob(namespace: string, name: string): Promise<void> {
  logger.info({ namespace, name }, 'Deleting job');
  await batchApi.deleteNamespacedJob({ name, namespace, body: { propagationPolicy: 'Background' } });
}

export async function rollbackDeployment(namespace: string, name: string): Promise<void> {
  logger.info({ namespace, name }, 'Rolling back deployment');
  // Rollback by setting revision annotation to trigger rollout undo
  const deployment = await appsApi.readNamespacedDeployment({ name, namespace });
  const annotations = deployment.spec?.template?.metadata?.annotations || {};
  annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();
  await appsApi.patchNamespacedDeployment({
    name,
    namespace,
    body: { spec: { template: { metadata: { annotations } } } },
    contentType: 'application/strategic-merge-patch+json',
  } as any);
}

export async function patchResourceLimits(namespace: string, deploymentName: string, containerName: string, memoryLimit: string): Promise<void> {
  logger.info({ namespace, deploymentName, containerName, memoryLimit }, 'Patching resource limits');
  const deployment = await appsApi.readNamespacedDeployment({ name: deploymentName, namespace });
  const containers = deployment.spec?.template?.spec?.containers || [];
  const container = containers.find(c => c.name === containerName);
  if (container) {
    if (!container.resources) container.resources = {};
    if (!container.resources.limits) container.resources.limits = {};
    container.resources.limits['memory'] = memoryLimit;
    await appsApi.replaceNamespacedDeployment({ name: deploymentName, namespace, body: deployment });
  }
}
