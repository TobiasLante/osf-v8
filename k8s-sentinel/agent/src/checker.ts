import { ClusterSnapshot, PodInfo } from './k8s-client';
import { logger } from './logger';

export interface DetectedIssue {
  type: string;
  severity: 'harmless' | 'medium' | 'critical';
  namespace: string;
  resourceKind: string;
  resourceName: string;
  description: string;
  pod?: PodInfo;
}

export function runChecks(snapshot: ClusterSnapshot): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  for (const pod of snapshot.pods) {
    // 1. CrashLoopBackOff
    for (const cs of pod.containerStatuses) {
      if (cs.reason === 'CrashLoopBackOff') {
        issues.push({
          type: 'CrashLoopBackOff',
          severity: 'harmless',
          namespace: pod.namespace,
          resourceKind: 'Pod',
          resourceName: pod.name,
          description: `Container ${cs.name} in CrashLoopBackOff (${cs.restartCount} restarts)`,
          pod,
        });
      }
    }

    // 2. OOMKilled
    for (const cs of pod.containerStatuses) {
      if (cs.lastTerminationReason === 'OOMKilled' || cs.reason === 'OOMKilled') {
        issues.push({
          type: 'OOMKilled',
          severity: 'medium',
          namespace: pod.namespace,
          resourceKind: 'Pod',
          resourceName: pod.name,
          description: `Container ${cs.name} was OOMKilled (${cs.restartCount} restarts)`,
          pod,
        });
      }
    }

    // 3. ImagePullBackOff
    for (const cs of pod.containerStatuses) {
      if (cs.reason === 'ImagePullBackOff' || cs.reason === 'ErrImagePull') {
        issues.push({
          type: 'ImagePullBackOff',
          severity: 'medium',
          namespace: pod.namespace,
          resourceKind: 'Pod',
          resourceName: pod.name,
          description: `Container ${cs.name} cannot pull image: ${cs.reason}`,
          pod,
        });
      }
    }

    // 5. Pending Pod (>5min)
    if (pod.phase === 'Pending') {
      const age = Date.now() - new Date(pod.createdAt).getTime();
      if (age > 5 * 60 * 1000) {
        issues.push({
          type: 'PendingPod',
          severity: 'medium',
          namespace: pod.namespace,
          resourceKind: 'Pod',
          resourceName: pod.name,
          description: `Pod pending for ${Math.round(age / 60000)}min`,
          pod,
        });
      }
    }

    // 6. High Restarts (>10)
    if (pod.restartCount > 10) {
      const alreadyHasCrashLoop = issues.some(
        i => i.resourceName === pod.name && i.type === 'CrashLoopBackOff'
      );
      if (!alreadyHasCrashLoop) {
        issues.push({
          type: 'HighRestarts',
          severity: 'medium',
          namespace: pod.namespace,
          resourceKind: 'Pod',
          resourceName: pod.name,
          description: `Pod has ${pod.restartCount} restarts`,
          pod,
        });
      }
    }

    // 9. Evicted Pod
    if (pod.phase === 'Failed' && pod.containerStatuses.some(cs => cs.reason === 'Evicted')) {
      issues.push({
        type: 'EvictedPod',
        severity: 'harmless',
        namespace: pod.namespace,
        resourceKind: 'Pod',
        resourceName: pod.name,
        description: 'Pod was evicted',
        pod,
      });
    }
  }

  // 4. Node NotReady
  for (const node of snapshot.nodes) {
    if (!node.ready) {
      issues.push({
        type: 'NodeNotReady',
        severity: 'critical',
        namespace: '',
        resourceKind: 'Node',
        resourceName: node.name,
        description: `Node ${node.name} is NotReady`,
      });
    }
  }

  // 7 & 8. Failed/Stale Jobs — check via events
  for (const event of snapshot.events) {
    if (event.involvedObject.kind === 'Job') {
      if (event.reason === 'BackoffLimitExceeded') {
        issues.push({
          type: 'FailedJob',
          severity: 'harmless',
          namespace: event.namespace,
          resourceKind: 'Job',
          resourceName: event.involvedObject.name,
          description: `Job failed: ${event.message}`,
        });
      }
    }
  }

  // 10. PVC Pending — check events for FailedBinding
  for (const event of snapshot.events) {
    if (event.involvedObject.kind === 'PersistentVolumeClaim' && event.reason === 'FailedBinding') {
      issues.push({
        type: 'PVCPending',
        severity: 'critical',
        namespace: event.namespace,
        resourceKind: 'PVC',
        resourceName: event.involvedObject.name,
        description: `PVC pending: ${event.message}`,
      });
    }
  }

  // 11. Failed Rollout — check events for FailedCreate or ProgressDeadlineExceeded
  for (const event of snapshot.events) {
    if (event.involvedObject.kind === 'Deployment' && event.reason === 'ProgressDeadlineExceeded') {
      issues.push({
        type: 'FailedRollout',
        severity: 'medium',
        namespace: event.namespace,
        resourceKind: 'Deployment',
        resourceName: event.involvedObject.name,
        description: `Deployment rollout failed: ${event.message}`,
      });
    }
  }

  logger.info({ issueCount: issues.length }, 'Checks completed');
  return issues;
}
