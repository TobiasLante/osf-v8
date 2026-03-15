import { DetectedIssue } from './checker';
import { getPodLogs, ClusterSnapshot, EventInfo } from './k8s-client';
import { llmChat } from './llm-client';
import { logger } from './logger';

export interface DiagnosedIssue extends DetectedIssue {
  diagnosis: string;
  proposedFix: string;
}

export async function diagnoseIssues(
  issues: DetectedIssue[],
  snapshot: ClusterSnapshot,
): Promise<DiagnosedIssue[]> {
  const diagnosed: DiagnosedIssue[] = [];

  for (const issue of issues) {
    if (issue.severity === 'harmless') {
      // No LLM needed for harmless issues
      diagnosed.push({
        ...issue,
        diagnosis: getDefaultDiagnosis(issue),
        proposedFix: getDefaultFix(issue),
      });
      continue;
    }

    // For medium/critical: gather context and ask LLM
    try {
      let logs = '';
      if (issue.resourceKind === 'Pod' && issue.namespace) {
        logs = await getPodLogs(issue.namespace, issue.resourceName, 50);
      }

      const relevantEvents = snapshot.events
        .filter(e => e.involvedObject.name === issue.resourceName)
        .map(e => `${e.reason}: ${e.message}`)
        .join('\n');

      const prompt = buildDiagnosisPrompt(issue, logs, relevantEvents);
      const response = await llmChat([
        { role: 'system', content: 'You are a Kubernetes diagnostics expert. Analyze the issue and provide a concise root cause diagnosis and a specific remediation step. Respond in JSON format: {"diagnosis": "...", "proposedFix": "..."}' },
        { role: 'user', content: prompt },
      ]);

      let parsed: { diagnosis: string; proposedFix: string };
      try {
        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || '{}');
      } catch {
        parsed = { diagnosis: response, proposedFix: getDefaultFix(issue) };
      }

      diagnosed.push({
        ...issue,
        diagnosis: parsed.diagnosis || response,
        proposedFix: parsed.proposedFix || getDefaultFix(issue),
      });
    } catch (err: any) {
      logger.warn({ err: err.message, issue: issue.type }, 'Diagnosis failed, using defaults');
      diagnosed.push({
        ...issue,
        diagnosis: getDefaultDiagnosis(issue),
        proposedFix: getDefaultFix(issue),
      });
    }
  }

  return diagnosed;
}

function buildDiagnosisPrompt(issue: DetectedIssue, logs: string, events: string): string {
  return `Kubernetes Issue Detected:
Type: ${issue.type}
Severity: ${issue.severity}
Resource: ${issue.resourceKind}/${issue.resourceName} in namespace ${issue.namespace}
Description: ${issue.description}

${logs ? `Recent Pod Logs:\n${logs.slice(0, 2000)}\n` : ''}
${events ? `Related Events:\n${events.slice(0, 1000)}\n` : ''}

Provide root cause analysis and a specific fix.`;
}

function getDefaultDiagnosis(issue: DetectedIssue): string {
  const defaults: Record<string, string> = {
    CrashLoopBackOff: 'Container is repeatedly crashing. Likely application error or missing config.',
    EvictedPod: 'Pod was evicted due to resource pressure on the node.',
    FailedJob: 'Job exceeded its backoff limit.',
    OOMKilled: 'Container exceeded its memory limit and was killed by the OOM killer.',
    ImagePullBackOff: 'Container image cannot be pulled. Check image name, tag, and registry access.',
    NodeNotReady: 'Node is not responding to the API server. May be network or kubelet issue.',
    PendingPod: 'Pod cannot be scheduled. Possible resource constraints or node affinity issues.',
    HighRestarts: 'Container has restarted many times, indicating instability.',
    PVCPending: 'Persistent Volume Claim cannot be bound. No matching PV or storage provisioner issue.',
    FailedRollout: 'Deployment rollout is stuck. New pods are not becoming ready.',
  };
  return defaults[issue.type] || 'Unknown issue type.';
}

function getDefaultFix(issue: DetectedIssue): string {
  const defaults: Record<string, string> = {
    CrashLoopBackOff: `Delete pod ${issue.resourceName} to trigger fresh restart`,
    EvictedPod: `Delete evicted pod ${issue.resourceName}`,
    FailedJob: `Delete failed job ${issue.resourceName}`,
    OOMKilled: `Increase memory limit for pod ${issue.resourceName}`,
    ImagePullBackOff: `Check and fix image reference for ${issue.resourceName}`,
    NodeNotReady: `Investigate node ${issue.resourceName} — check kubelet and network`,
    PendingPod: `Check resource availability and scheduling constraints for ${issue.resourceName}`,
    HighRestarts: `Investigate why ${issue.resourceName} keeps restarting`,
    PVCPending: `Check storage provisioner and PV availability for ${issue.resourceName}`,
    FailedRollout: `Rollback deployment ${issue.resourceName} to previous revision`,
  };
  return defaults[issue.type] || 'Manual investigation required.';
}
