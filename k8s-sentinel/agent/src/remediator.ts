import { DiagnosedIssue } from './diagnoser';
import { K8sClient } from './k8s-client';
import { removeContainer } from './docker-client';
import { insertIncident, updateIncidentStatus, Incident, isPodProtected, ClusterRow } from './db';
import { broadcast } from './sse';
import { config } from './config';
import { logger } from './logger';
import { notify } from './notifier';

// Track auto-fix counts per hour to respect rate limits
const autoFixCounts = new Map<string, { count: number; resetAt: number }>();

function canAutoFix(key: string, maxPerHour = 3): boolean {
  const now = Date.now();
  const entry = autoFixCounts.get(key);
  if (!entry || now > entry.resetAt) {
    autoFixCounts.set(key, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= maxPerHour) return false;
  entry.count++;
  return true;
}

export async function remediateIssues(
  issues: DiagnosedIssue[],
  clusterId?: string,
  cluster?: ClusterRow,
  k8sClient?: K8sClient,
): Promise<{ fixed: number; proposed: number; alerted: number }> {
  let fixed = 0, proposed = 0, alerted = 0;

  for (const issue of issues) {
    const incident = await insertIncident({
      type: issue.type,
      severity: issue.severity,
      namespace: issue.namespace,
      resource_kind: issue.resourceKind,
      resource_name: issue.resourceName,
      description: issue.description,
      diagnosis: issue.diagnosis,
      proposed_fix: issue.proposedFix,
      fix_status: 'pending',
    }, clusterId);

    broadcast('issue_detected', { ...incident, cluster_id: clusterId, cluster_name: cluster?.name });
    notify('issue_detected', { ...incident, cluster_name: cluster?.name }).catch(() => {});

    if (config.remediationMode === 'readonly') {
      alerted++;
      continue;
    }

    // Protected pods: never auto-fix, always require approval
    const podProtected = issue.resourceKind === 'Pod' && issue.namespace
      ? await isPodProtected(issue.namespace, issue.resourceName, clusterId)
      : false;

    if (podProtected) {
      logger.info({ namespace: issue.namespace, pod: issue.resourceName }, 'Pod is protected — requiring approval');
      proposed++;
      await updateIncidentStatus(incident.id!, 'proposed', undefined);
      broadcast('fix_proposed', { ...incident, fix_status: 'proposed', cluster_id: clusterId });
      notify('fix_proposed', { ...incident, cluster_name: cluster?.name }).catch(() => {});
      continue;
    }

    if (issue.severity === 'harmless') {
      const fixKey = `${clusterId || 'default'}:${issue.type}:${issue.namespace}/${issue.resourceName}`;
      if (canAutoFix(fixKey)) {
        const success = await applyFix(issue, incident, cluster, k8sClient);
        if (success) {
          fixed++;
          await updateIncidentStatus(incident.id!, 'fixed', new Date());
          broadcast('fix_applied', { ...incident, fix_status: 'fixed', cluster_id: clusterId });
          notify('fix_applied', { ...incident, cluster_name: cluster?.name }).catch(() => {});
        }
      } else {
        logger.info({ fixKey }, 'Auto-fix rate limit reached');
        alerted++;
      }
    } else if (issue.severity === 'medium') {
      if (config.remediationMode === 'auto') {
        const success = await applyFix(issue, incident, cluster, k8sClient);
        if (success) {
          fixed++;
          await updateIncidentStatus(incident.id!, 'fixed', new Date());
          broadcast('fix_applied', { ...incident, fix_status: 'fixed', cluster_id: clusterId });
          notify('fix_applied', { ...incident, cluster_name: cluster?.name }).catch(() => {});
        }
      } else {
        proposed++;
        await updateIncidentStatus(incident.id!, 'proposed', undefined);
        broadcast('fix_proposed', { ...incident, fix_status: 'proposed', cluster_id: clusterId });
        notify('fix_proposed', { ...incident, cluster_name: cluster?.name }).catch(() => {});
      }
    } else {
      // critical — only alert
      alerted++;
      await updateIncidentStatus(incident.id!, 'alert', undefined);
      notify('alert', { ...incident, cluster_name: cluster?.name }).catch(() => {});
    }
  }

  return { fixed, proposed, alerted };
}

async function applyFix(issue: DiagnosedIssue, incident: Incident, cluster?: ClusterRow, k8sClient?: K8sClient): Promise<boolean> {
  try {
    if (cluster?.type === 'docker') {
      // Docker remediation
      switch (issue.type) {
        case 'CrashLoopBackOff':
        case 'EvictedPod':
          const socketPath = (cluster.config as any).socketPath || '/var/run/docker.sock';
          await removeContainer(socketPath, issue.resourceName);
          logger.info({ type: issue.type, container: issue.resourceName }, 'Container removed');
          return true;
        default:
          logger.info({ type: issue.type }, 'No Docker fix available');
          return false;
      }
    }

    // K8s remediation
    if (!k8sClient) {
      logger.warn('No K8s client available for fix');
      return false;
    }

    switch (issue.type) {
      case 'CrashLoopBackOff':
      case 'EvictedPod':
        await k8sClient.deletePod(issue.namespace, issue.resourceName);
        logger.info({ type: issue.type, pod: issue.resourceName }, 'Pod deleted');
        return true;

      case 'FailedJob':
        await k8sClient.deleteJob(issue.namespace, issue.resourceName);
        logger.info({ type: issue.type, job: issue.resourceName }, 'Job deleted');
        return true;

      case 'FailedRollout':
        await k8sClient.rollbackDeployment(issue.namespace, issue.resourceName);
        logger.info({ type: issue.type, deployment: issue.resourceName }, 'Deployment rolled back');
        return true;

      default:
        logger.info({ type: issue.type }, 'No automated fix available');
        return false;
    }
  } catch (err: any) {
    logger.error({ err: err.message, type: issue.type, resource: issue.resourceName }, 'Fix failed');
    return false;
  }
}

export async function approveIncident(id: string): Promise<Incident | null> {
  const { getIncidentById, getClusterById } = await import('./db');
  const incident = await getIncidentById(id);
  if (!incident || incident.fix_status !== 'proposed') return null;

  const cluster = (incident as any).cluster_id ? await getClusterById((incident as any).cluster_id) : undefined;
  let k8sClient: K8sClient | undefined;
  if (cluster?.type === 'k8s') {
    const { createK8sClient } = await import('./k8s-client');
    const { kubeconfigPath, context } = cluster.config as any;
    k8sClient = createK8sClient(kubeconfigPath, context);
  }

  const diagnosed: DiagnosedIssue = {
    type: incident.type,
    severity: incident.severity as any,
    namespace: incident.namespace || '',
    resourceKind: incident.resource_kind || '',
    resourceName: incident.resource_name || '',
    description: incident.description || '',
    diagnosis: incident.diagnosis || '',
    proposedFix: incident.proposed_fix || '',
  };

  const success = await applyFix(diagnosed, incident, cluster || undefined, k8sClient);
  if (success) {
    const updated = await updateIncidentStatus(id, 'fixed', new Date());
    broadcast('fix_applied', updated);
    return updated;
  }

  return await updateIncidentStatus(id, 'fix_failed', undefined);
}

export async function rejectIncident(id: string): Promise<Incident | null> {
  const updated = await updateIncidentStatus(id, 'rejected', undefined);
  if (updated) broadcast('fix_rejected', updated);
  return updated;
}
