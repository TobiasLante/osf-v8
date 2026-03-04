'use client';

import { useState, useCallback } from 'react';
import { apiFetch, pollFlowEvents } from '@/lib/api';
import { StreamOutput, type StreamEvent } from './StreamOutput';
import LlmStatusBanner from './LlmStatusBanner';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://osf-api.zeroguess.ai';

interface FlowRunnerProps {
  flowId: string;
}

interface PendingInput {
  runId: string;
  nodeId: string;
  prompt: string;
  options: string[];
}

interface LlmStatus {
  online: boolean;
  servers?: Array<{ name: string; active: number; queued: number }>;
  message?: string;
}

export default function FlowRunner({ flowId }: FlowRunnerProps) {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [completed, setCompleted] = useState(false);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const [humanResponse, setHumanResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [quotaPercent, setQuotaPercent] = useState<number | undefined>(undefined);

  const processStream = useCallback(async (stream: AsyncGenerator<any>) => {
    try {
      for await (const event of stream) {
        setEvents(prev => [...prev, event as StreamEvent]);

        if (event.type === 'flow_paused') {
          setPendingInput({ runId: event.runId, nodeId: event.nodeId, prompt: '', options: [] });
        }
        if (event.type === 'flow_complete') {
          setCompleted(true);
        }
        if (event.type === 'error') {
          setError(event.message);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Flow execution failed');
      setEvents(prev => [...prev, { type: 'error', message: err.message || 'Flow execution failed' }]);
    } finally {
      setRunning(false);
    }
  }, []);

  const runFlow = useCallback(async () => {
    setError(null);
    setLlmStatus(null);
    setQuotaPercent(undefined);

    // Pre-flight checks: LLM status + quota
    try {
      const [statusRes, usageRes] = await Promise.allSettled([
        fetch(`${API_BASE}/llm/status`).then(r => r.json()) as Promise<LlmStatus>,
        apiFetch<{ percentUsed: number }>('/auth/usage'),
      ]);

      if (statusRes.status === 'fulfilled' && !statusRes.value.online) {
        setLlmStatus(statusRes.value);
        return;
      }
      if (statusRes.status === 'fulfilled') {
        setLlmStatus(statusRes.value);
      }

      if (usageRes.status === 'fulfilled') {
        const pct = usageRes.value.percentUsed;
        setQuotaPercent(pct);
        if (pct >= 100) return; // Don't start flow if quota exhausted
      }
    } catch {
      // Pre-flight failed — proceed anyway, backend will enforce limits
    }

    setRunning(true);
    setEvents([]);
    setCompleted(false);
    setPendingInput(null);
    const { runId } = await apiFetch<{ runId: string }>(`/flows/api/run/${flowId}`, { method: 'POST' });
    await processStream(pollFlowEvents(runId));
  }, [flowId, processStream]);

  const submitHumanInput = useCallback(async () => {
    if (!pendingInput || !humanResponse.trim()) return;
    setPendingInput(null);
    setRunning(true);
    await apiFetch(`/flows/api/runs/${pendingInput.runId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ response: humanResponse }),
    });
    await processStream(pollFlowEvents(pendingInput.runId));
  }, [pendingInput, humanResponse, processStream]);

  const hasEvents = events.length > 0;

  return (
    <div className="space-y-4">
      <LlmStatusBanner status={llmStatus} quotaPercent={quotaPercent} />

      {!running && !completed && !pendingInput && (
        <button
          onClick={runFlow}
          disabled={llmStatus?.online === false || (quotaPercent !== undefined && quotaPercent >= 100)}
          className="bg-accent text-bg px-6 py-2.5 rounded-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Run Flow
        </button>
      )}

      {hasEvents && (
        <StreamOutput events={events} running={running} maxHeight="500px" />
      )}

      {pendingInput && (
        <div className="border border-blue-500/30 rounded-md p-4 bg-blue-500/5">
          <p className="text-text font-medium mb-3">Human Input Required</p>
          <textarea
            value={humanResponse}
            onChange={(e) => setHumanResponse(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-sm p-3 text-text text-sm min-h-[80px] focus:outline-none focus:border-accent"
            placeholder="Enter your response..."
          />
          <button
            onClick={submitHumanInput}
            disabled={!humanResponse.trim()}
            className="mt-2 bg-accent text-bg px-5 py-2 rounded-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}

      {completed && !running && (
        <div className="text-center mt-2">
          <button
            onClick={runFlow}
            className="text-text-muted text-sm hover:text-text transition-colors"
          >
            Run again
          </button>
        </div>
      )}

      {error && !running && events.length === 0 && (
        <div className="border border-red-500/30 rounded-md p-4 bg-red-500/5">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
