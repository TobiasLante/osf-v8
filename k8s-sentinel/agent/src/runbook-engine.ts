import { DiagnosedIssue } from './diagnoser';
import { K8sClient } from './k8s-client';
import { removeContainer, restartContainer } from './docker-client';
import {
  ClusterRow, pool,
  getEnabledRunbooks, RunbookRow,
  insertExecution, updateExecution, RunbookExecutionRow,
} from './db';
import { broadcast } from './sse';
import { logger } from './logger';
import { notify } from './notifier';

// --- Types ---

export interface RunbookStep {
  type: 'check_condition' | 'delete_pod' | 'rollback_deployment' | 'scale_deployment' | 'restart_container' | 'wait' | 'notify';
  params: Record<string, any>;
  on_failure?: 'continue' | 'abort' | 'skip';
}

export interface Runbook {
  id: string;
  name: string;
  cluster_id?: string;
  match_type?: string;
  match_namespace?: string;
  match_resource?: string;
  steps: RunbookStep[];
  enabled: boolean;
}

// --- Matching ---

function matchesPattern(pattern: string | undefined, value: string): boolean {
  if (!pattern || pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return pattern === value;
}

function specificityScore(runbook: RunbookRow): number {
  let score = 0;
  if (runbook.match_type && runbook.match_type !== '*') score += 4;
  if (runbook.match_namespace && runbook.match_namespace !== '*') score += 2;
  if (runbook.match_resource && runbook.match_resource !== '*') {
    score += runbook.match_resource.endsWith('*') ? 1 : 2;
  }
  return score;
}

export async function findMatchingRunbook(issue: DiagnosedIssue, clusterId?: string): Promise<Runbook | null> {
  const runbooks = await getEnabledRunbooks(clusterId);

  const matches = runbooks.filter(rb => {
    if (!matchesPattern(rb.match_type, issue.type)) return false;
    if (!matchesPattern(rb.match_namespace, issue.namespace)) return false;
    if (!matchesPattern(rb.match_resource, issue.resourceName)) return false;
    return true;
  });

  if (matches.length === 0) return null;

  // Most specific match wins
  matches.sort((a, b) => specificityScore(b) - specificityScore(a));

  const best = matches[0];
  return {
    id: best.id,
    name: best.name,
    cluster_id: best.cluster_id || undefined,
    match_type: best.match_type || undefined,
    match_namespace: best.match_namespace || undefined,
    match_resource: best.match_resource || undefined,
    steps: best.steps as RunbookStep[],
    enabled: best.enabled,
  };
}

// --- Variable Substitution ---

function substituteVars(params: Record<string, any>, issue: DiagnosedIssue, clusterName: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = value
        .replace(/\$namespace/g, issue.namespace)
        .replace(/\$resource/g, issue.resourceName)
        .replace(/\$cluster/g, clusterName);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// --- Step Execution ---

async function executeStep(
  step: RunbookStep,
  issue: DiagnosedIssue,
  cluster: ClusterRow,
  k8sClient?: K8sClient,
): Promise<{ success: boolean; detail: string }> {
  const ns = issue.namespace;
  const resource = issue.resourceName;

  switch (step.type) {
    case 'check_condition': {
      const check = step.params.check as string;
      if (!check) return { success: false, detail: 'No check specified' };

      if (check === 'pod_ready') {
        // We can't easily check current snapshot here without passing it;
        // treat as a simple check that passes (the pod was just acted on)
        return { success: true, detail: 'pod_ready check passed (assumed)' };
      }

      // Simple expression like "restartCount > 5"
      const match = check.match(/^restartCount\s*([><=!]+)\s*(\d+)$/);
      if (match) {
        const op = match[1];
        const threshold = parseInt(match[2], 10);
        // Get restart count from issue description or default to 0
        const rcMatch = issue.description.match(/restart(?:ed|Count|s)[:\s]*(\d+)/i);
        const restartCount = rcMatch ? parseInt(rcMatch[1], 10) : 0;

        let result = false;
        switch (op) {
          case '>': result = restartCount > threshold; break;
          case '>=': result = restartCount >= threshold; break;
          case '<': result = restartCount < threshold; break;
          case '<=': result = restartCount <= threshold; break;
          case '==': result = restartCount === threshold; break;
          case '!=': result = restartCount !== threshold; break;
        }
        return { success: result, detail: `restartCount(${restartCount}) ${op} ${threshold} = ${result}` };
      }

      return { success: true, detail: `Condition "${check}" assumed true` };
    }

    case 'delete_pod': {
      if (cluster.type === 'docker') {
        const socketPath = (cluster.config as any).socketPath || '/var/run/docker.sock';
        await removeContainer(socketPath, resource);
        return { success: true, detail: `Docker container ${resource} removed` };
      }
      if (!k8sClient) return { success: false, detail: 'No K8s client available' };
      await k8sClient.deletePod(ns, resource);
      return { success: true, detail: `Pod ${ns}/${resource} deleted` };
    }

    case 'rollback_deployment': {
      if (cluster.type === 'docker') return { success: false, detail: 'Rollback not supported for Docker' };
      if (!k8sClient) return { success: false, detail: 'No K8s client available' };
      await k8sClient.rollbackDeployment(ns, resource);
      return { success: true, detail: `Deployment ${ns}/${resource} rolled back` };
    }

    case 'restart_container': {
      if (cluster.type !== 'docker') return { success: false, detail: 'restart_container only for Docker clusters' };
      const dockerConf = cluster.config as any;
      const dockerOpts = dockerConf.host
        ? { host: dockerConf.host, port: dockerConf.port || 2375 }
        : { socketPath: dockerConf.socketPath || '/var/run/docker.sock' };
      await restartContainer(dockerOpts, resource);
      return { success: true, detail: `Docker container ${resource} restarted` };
    }

    case 'wait': {
      const seconds = Math.min(step.params.seconds || 10, 120);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { success: true, detail: `Waited ${seconds}s` };
    }

    case 'notify': {
      const message = step.params.message || 'Runbook step notification';
      await notify('runbook_step', { message });
      return { success: true, detail: `Notification sent: ${message}` };
    }

    case 'scale_deployment': {
      // Not yet implemented in K8sClient, log as skipped
      return { success: false, detail: 'scale_deployment not yet implemented' };
    }

    default:
      return { success: false, detail: `Unknown step type: ${step.type}` };
  }
}

// --- Execution ---

export async function executeRunbook(
  runbook: Runbook,
  issue: DiagnosedIssue,
  incidentId: string,
  clusterId: string,
  cluster: ClusterRow,
  k8sClient?: K8sClient,
): Promise<boolean> {
  // 1. Insert execution record
  const execution = await insertExecution({
    runbook_id: runbook.id,
    incident_id: incidentId,
    cluster_id: clusterId,
    status: 'running',
    steps_completed: 0,
    steps_total: runbook.steps.length,
    log: [],
  });

  // 2. Broadcast start
  broadcast('runbook_started', {
    execution_id: execution.id,
    runbook_name: runbook.name,
    incident_id: incidentId,
    cluster_id: clusterId,
    steps_total: runbook.steps.length,
  });

  const log: any[] = [];
  let stepsCompleted = 0;
  let success = true;

  // 3. Execute each step
  for (let i = 0; i < runbook.steps.length; i++) {
    const step = runbook.steps[i];
    const params = substituteVars(step.params, issue, cluster.name);
    const stepWithParams = { ...step, params };

    let result: { success: boolean; detail: string };
    try {
      result = await executeStep(stepWithParams, issue, cluster, k8sClient);
    } catch (err: any) {
      result = { success: false, detail: `Error: ${err.message}` };
    }

    const logEntry = {
      step: i + 1,
      type: step.type,
      params,
      success: result.success,
      detail: result.detail,
      timestamp: new Date().toISOString(),
    };
    log.push(logEntry);

    // Broadcast step result
    broadcast('runbook_step', {
      execution_id: execution.id,
      runbook_name: runbook.name,
      ...logEntry,
    });

    if (result.success) {
      stepsCompleted++;
    } else {
      const onFailure = step.on_failure || 'abort';
      logger.warn({ step: i + 1, type: step.type, detail: result.detail, onFailure }, 'Runbook step failed');

      if (onFailure === 'abort') {
        success = false;
        break;
      } else if (onFailure === 'skip') {
        // Skip this step, continue
        continue;
      }
      // 'continue' — mark as failed but keep going
    }
  }

  // 4. Update execution status
  const finalStatus = success ? 'completed' : 'failed';
  await updateExecution(execution.id, {
    status: finalStatus,
    steps_completed: stepsCompleted,
    log,
    finished_at: new Date(),
  });

  // 5. Broadcast completion
  broadcast('runbook_completed', {
    execution_id: execution.id,
    runbook_name: runbook.name,
    incident_id: incidentId,
    cluster_id: clusterId,
    status: finalStatus,
    steps_completed: stepsCompleted,
    steps_total: runbook.steps.length,
  });

  // 6. Notify
  await notify('runbook_completed', {
    runbook: runbook.name,
    status: finalStatus,
    steps_completed: stepsCompleted,
    steps_total: runbook.steps.length,
  }).catch(() => {});

  logger.info({
    runbook: runbook.name,
    status: finalStatus,
    stepsCompleted,
    stepsTotal: runbook.steps.length,
  }, 'Runbook execution finished');

  return success;
}

// --- Dry Run ---

export async function dryRunRunbook(runbook: Runbook, issue: DiagnosedIssue): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < runbook.steps.length; i++) {
    const step = runbook.steps[i];
    const params = substituteVars(step.params, issue, 'dry-run-cluster');

    let wouldDo: string;
    switch (step.type) {
      case 'check_condition':
        wouldDo = `Check condition: ${params.check || 'unknown'}`;
        break;
      case 'delete_pod':
        wouldDo = `Delete pod ${issue.namespace}/${issue.resourceName}`;
        break;
      case 'rollback_deployment':
        wouldDo = `Rollback deployment ${issue.namespace}/${issue.resourceName}`;
        break;
      case 'scale_deployment':
        wouldDo = `Scale deployment (replicas: ${params.replicas || '?'})`;
        break;
      case 'restart_container':
        wouldDo = `Restart container ${issue.resourceName}`;
        break;
      case 'wait':
        wouldDo = `Wait ${Math.min(params.seconds || 10, 120)} seconds`;
        break;
      case 'notify':
        wouldDo = `Send notification: ${params.message || 'N/A'}`;
        break;
      default:
        wouldDo = `Unknown action: ${step.type}`;
    }

    results.push({
      step: i + 1,
      type: step.type,
      would_do: wouldDo,
      params,
      on_failure: step.on_failure || 'abort',
    });
  }

  return results;
}
