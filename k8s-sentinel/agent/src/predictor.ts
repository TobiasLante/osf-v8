import { logger } from './logger';
import { broadcast } from './sse';
import { llmChat } from './llm-client';
import {
  getRecentSnapshots, insertPrediction, hasActivePrediction, expireOldPredictions,
} from './db';
import { ClusterSnapshot, PodInfo, NodeInfo } from './k8s-client';

interface TrendResult {
  type: string;
  severity: 'warning' | 'critical';
  namespace?: string;
  resource_kind: string;
  resource_name: string;
  trend_data: any;
  predicted_event: string;
  estimated_eta?: string;
}

export async function runPredictions(clusterId: string, currentSnapshot: ClusterSnapshot): Promise<void> {
  // Clean up expired predictions first
  const expired = await expireOldPredictions();
  if (expired > 0) {
    logger.info({ expired }, 'Expired old predictions');
  }

  // Get recent snapshots (newest first)
  const rows = await getRecentSnapshots(clusterId, 5);
  if (rows.length < 3) {
    logger.debug({ snapshots: rows.length }, 'Not enough snapshots for predictions');
    return;
  }

  // Extract snapshot data (newest first)
  const snapshots: ClusterSnapshot[] = rows.map(r => r.snapshot);

  const trends: TrendResult[] = [];

  // 1. Pod restart trends
  for (const pod of currentSnapshot.pods) {
    const restartHistory = getRestartHistory(pod, snapshots);
    if (restartHistory.length >= 3) {
      const isIncreasing = restartHistory.every((val, i) =>
        i === 0 || val > restartHistory[i - 1]
      );
      if (isIncreasing) {
        const velocity = restartHistory.length >= 2
          ? (restartHistory[restartHistory.length - 1] - restartHistory[0]) / (restartHistory.length - 1)
          : 0;
        const currentRestarts = pod.restartCount;
        const restartsToThreshold = Math.max(0, 10 - currentRestarts);
        const cyclesUntilCrashLoop = velocity > 0 ? Math.ceil(restartsToThreshold / velocity) : Infinity;
        const etaMinutes = isFinite(cyclesUntilCrashLoop) ? cyclesUntilCrashLoop * 2 : null; // ~2min per check cycle

        trends.push({
          type: 'restart_trend',
          severity: currentRestarts >= 7 ? 'critical' : 'warning',
          namespace: pod.namespace,
          resource_kind: 'Pod',
          resource_name: pod.name,
          trend_data: {
            restartHistory,
            velocity: Math.round(velocity * 100) / 100,
            currentRestarts,
          },
          predicted_event: 'CrashLoopBackOff',
          estimated_eta: etaMinutes !== null ? `~${etaMinutes} minutes` : undefined,
        });
      }
    }
  }

  // 2. Node condition trends
  for (const node of currentSnapshot.nodes) {
    // Memory pressure
    if (hasConditionInLastN(node.name, 'MemoryPressure', 'True', snapshots, 2)) {
      trends.push({
        type: 'memory_pressure',
        severity: 'critical',
        resource_kind: 'Node',
        resource_name: node.name,
        trend_data: { condition: 'MemoryPressure', consecutiveSnapshots: 2 },
        predicted_event: 'OOMKill',
        estimated_eta: 'Imminent — node under sustained memory pressure',
      });
    }

    // Disk pressure
    if (hasConditionInLastN(node.name, 'DiskPressure', 'True', snapshots, 2)) {
      trends.push({
        type: 'disk_pressure',
        severity: 'critical',
        resource_kind: 'Node',
        resource_name: node.name,
        trend_data: { condition: 'DiskPressure', consecutiveSnapshots: 2 },
        predicted_event: 'Eviction',
        estimated_eta: 'Imminent — node under sustained disk pressure',
      });
    }
  }

  // 3. Pod pending trends
  for (const pod of currentSnapshot.pods) {
    if (pod.phase !== 'Pending') continue;
    const pendingCount = countPendingInSnapshots(pod, snapshots);
    if (pendingCount >= 3) {
      trends.push({
        type: 'pod_pending_trend',
        severity: 'warning',
        namespace: pod.namespace,
        resource_kind: 'Pod',
        resource_name: pod.name,
        trend_data: { pendingSnapshots: pendingCount },
        predicted_event: 'SchedulingFailure',
        estimated_eta: `Pending for ${pendingCount}+ check cycles`,
      });
    }
  }

  // Process each detected trend
  for (const trend of trends) {
    try {
      // Check for existing active prediction (avoid duplicates)
      const exists = await hasActivePrediction(clusterId, trend.type, trend.resource_name);
      if (exists) continue;

      // Get LLM description
      const description = await generateDescription(trend);

      const prediction = await insertPrediction({
        cluster_id: clusterId,
        type: trend.type,
        severity: trend.severity,
        namespace: trend.namespace,
        resource_kind: trend.resource_kind,
        resource_name: trend.resource_name,
        description,
        trend_data: trend.trend_data,
        predicted_event: trend.predicted_event,
        estimated_eta: trend.estimated_eta,
        expires_at: new Date(Date.now() + 3600_000), // 1 hour TTL
      });

      broadcast('prediction', prediction);
      logger.info({
        type: trend.type,
        resource: trend.resource_name,
        severity: trend.severity,
      }, 'New prediction created');
    } catch (err: any) {
      logger.error({ err: err.message, trend: trend.type }, 'Failed to create prediction');
    }
  }

  if (trends.length > 0) {
    logger.info({ trends: trends.length }, 'Prediction analysis complete');
  }
}

function getRestartHistory(pod: PodInfo, snapshots: ClusterSnapshot[]): number[] {
  // snapshots are newest-first, reverse to get chronological order
  const history: number[] = [];
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const match = snapshots[i].pods.find(
      p => p.name === pod.name && p.namespace === pod.namespace
    );
    if (match) {
      history.push(match.restartCount);
    }
  }
  return history;
}

function hasConditionInLastN(
  nodeName: string,
  conditionType: string,
  conditionStatus: string,
  snapshots: ClusterSnapshot[],
  n: number,
): boolean {
  // Check the first n snapshots (newest first)
  for (let i = 0; i < Math.min(n, snapshots.length); i++) {
    const node = snapshots[i].nodes.find(nd => nd.name === nodeName);
    if (!node) return false;
    const cond = node.conditions.find(c => c.type === conditionType);
    if (!cond || cond.status !== conditionStatus) return false;
  }
  return true;
}

function countPendingInSnapshots(pod: PodInfo, snapshots: ClusterSnapshot[]): number {
  let count = 0;
  for (const snap of snapshots) {
    const match = snap.pods.find(p => p.name === pod.name && p.namespace === pod.namespace);
    if (match && match.phase === 'Pending') count++;
  }
  return count;
}

async function generateDescription(trend: TrendResult): Promise<string> {
  const prompt = buildPrompt(trend);
  try {
    const description = await llmChat([
      { role: 'system', content: 'You are a Kubernetes cluster monitoring assistant. Write a concise 1-2 sentence prediction alert. Be specific about the resource and what is likely to happen.' },
      { role: 'user', content: prompt },
    ], 128);
    return description;
  } catch {
    return buildFallbackDescription(trend);
  }
}

function buildPrompt(trend: TrendResult): string {
  switch (trend.type) {
    case 'restart_trend':
      return `Pod "${trend.resource_name}" in namespace "${trend.namespace}" shows an increasing restart trend: ${JSON.stringify(trend.trend_data.restartHistory)}. Velocity: ${trend.trend_data.velocity} restarts/cycle. Predict what will happen.`;
    case 'memory_pressure':
      return `Node "${trend.resource_name}" has MemoryPressure=True for ${trend.trend_data.consecutiveSnapshots} consecutive snapshots. Predict the impact.`;
    case 'disk_pressure':
      return `Node "${trend.resource_name}" has DiskPressure=True for ${trend.trend_data.consecutiveSnapshots} consecutive snapshots. Predict the impact.`;
    case 'pod_pending_trend':
      return `Pod "${trend.resource_name}" in namespace "${trend.namespace}" has been in Pending state for ${trend.trend_data.pendingSnapshots} consecutive snapshots. Predict why and what will happen.`;
    default:
      return `Resource "${trend.resource_name}" shows trend type "${trend.type}" with data: ${JSON.stringify(trend.trend_data)}`;
  }
}

function buildFallbackDescription(trend: TrendResult): string {
  switch (trend.type) {
    case 'restart_trend':
      return `Pod ${trend.resource_name} restarts are increasing (${trend.trend_data.velocity}/cycle). Likely heading towards CrashLoopBackOff.`;
    case 'memory_pressure':
      return `Node ${trend.resource_name} under sustained memory pressure. OOMKill events likely.`;
    case 'disk_pressure':
      return `Node ${trend.resource_name} under sustained disk pressure. Pod evictions likely.`;
    case 'pod_pending_trend':
      return `Pod ${trend.resource_name} stuck in Pending for ${trend.trend_data.pendingSnapshots}+ cycles. Possible scheduling issue.`;
    default:
      return `${trend.type} detected on ${trend.resource_name}.`;
  }
}
