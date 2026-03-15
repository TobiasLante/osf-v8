import { DiagnosedIssue } from './diagnoser';
import { deletePod, deleteJob, rollbackDeployment } from './k8s-client';
import { insertIncident, updateIncidentStatus, Incident, isPodProtected } from './db';
import { broadcast } from './sse';
import { config } from './config';
import { logger } from './logger';

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

export async function remediateIssues(issues: DiagnosedIssue[]): Promise<{ fixed: number; proposed: number; alerted: number }> {
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
    });

    broadcast('issue_detected', incident);

    if (config.remediationMode === 'readonly') {
      alerted++;
      continue;
    }

    // Protected pods: never auto-fix, always require approval
    const podProtected = issue.resourceKind === 'Pod' && issue.namespace
      ? await isPodProtected(issue.namespace, issue.resourceName)
      : false;

    if (podProtected) {
      logger.info({ namespace: issue.namespace, pod: issue.resourceName }, 'Pod is protected — requiring approval');
      proposed++;
      await updateIncidentStatus(incident.id!, 'proposed', undefined);
      broadcast('fix_proposed', { ...incident, fix_status: 'proposed' });
      continue;
    }

    if (issue.severity === 'harmless') {
      const fixKey = `${issue.type}:${issue.namespace}/${issue.resourceName}`;
      if (canAutoFix(fixKey)) {
        const success = await applyFix(issue, incident);
        if (success) {
          fixed++;
          await updateIncidentStatus(incident.id!, 'fixed', new Date());
          broadcast('fix_applied', { ...incident, fix_status: 'fixed' });
        }
      } else {
        logger.info({ fixKey }, 'Auto-fix rate limit reached');
        alerted++;
      }
    } else if (issue.severity === 'medium') {
      if (config.remediationMode === 'auto') {
        const success = await applyFix(issue, incident);
        if (success) {
          fixed++;
          await updateIncidentStatus(incident.id!, 'fixed', new Date());
          broadcast('fix_applied', { ...incident, fix_status: 'fixed' });
        }
      } else {
        proposed++;
        await updateIncidentStatus(incident.id!, 'proposed', undefined);
        broadcast('fix_proposed', { ...incident, fix_status: 'proposed' });
      }
    } else {
      // critical — only alert
      alerted++;
      await updateIncidentStatus(incident.id!, 'alert', undefined);
    }
  }

  return { fixed, proposed, alerted };
}

async function applyFix(issue: DiagnosedIssue, incident: Incident): Promise<boolean> {
  try {
    switch (issue.type) {
      case 'CrashLoopBackOff':
      case 'EvictedPod':
        await deletePod(issue.namespace, issue.resourceName);
        logger.info({ type: issue.type, pod: issue.resourceName }, 'Pod deleted');
        return true;

      case 'FailedJob':
        await deleteJob(issue.namespace, issue.resourceName);
        logger.info({ type: issue.type, job: issue.resourceName }, 'Job deleted');
        return true;

      case 'FailedRollout':
        await rollbackDeployment(issue.namespace, issue.resourceName);
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
  const incident = await (await import('./db')).getIncidentById(id);
  if (!incident || incident.fix_status !== 'proposed') return null;

  // Attempt the fix
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

  const success = await applyFix(diagnosed, incident);
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
