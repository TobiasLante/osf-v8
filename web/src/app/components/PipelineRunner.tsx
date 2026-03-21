'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Domain } from './DomainSelector';
import type { DataSourcesConfig } from './DataSources';
import { API_URL, apiFetch } from '../lib/api';

type PipelineState = 'idle' | 'running' | 'done' | 'error';

interface RunInfo {
  id: string;
  status: string;
  created_at: string;
}

interface LogEntry {
  timestamp: Date;
  type: string;
  text: string;
}

const PHASE_LABELS = ['Import', 'Discover', 'Extract', 'Build', 'Validate', 'Correct'];

interface PipelineRunnerProps {
  domain?: Domain;
  dataSources?: DataSourcesConfig;
  className?: string;
  onRunComplete?: (runId: string) => void;
}

/** Parse SSE text into parsed objects. Server sends `data: {json}\n\n`. */
function parseSSE(chunk: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const blocks = chunk.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let data = '';
    for (const line of lines) {
      if (line.startsWith('data: ')) data += line.slice(6);
      else if (line.startsWith('data:')) data += line.slice(5);
    }
    if (data) {
      try { results.push(JSON.parse(data)); } catch { /* skip malformed */ }
    }
  }
  return results;
}

export default function PipelineRunner({
  domain = 'manufacturing',
  dataSources,
  className,
  onRunComplete,
}: PipelineRunnerProps) {
  const [state, setState] = useState<PipelineState>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [doneSummary, setDoneSummary] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((type: string, text: string) => {
    setLogs((prev) => [...prev, { timestamp: new Date(), type, text }]);
  }, []);

  // Fetch recent runs on mount
  useEffect(() => {
    apiFetch<RunInfo[]>('/api/kg/runs')
      .then((data) => {
        const runs: RunInfo[] = Array.isArray(data) ? data : [];
        setRecentRuns(runs.slice(0, 5));
      })
      .catch(() => {});
  }, []);

  // Auto-scroll log panel
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const startBuild = useCallback(async () => {
    setState('running');
    setLogs([]);
    setCurrentPhase(-1);
    setDoneSummary('');
    setErrorMessage('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body: Record<string, unknown> = { domain };
      if (dataSources?.smProfileUrl) body.smProfileUrl = dataSources.smProfileUrl;
      if (dataSources?.mtpUrls?.length) body.mtpUrls = dataSources.mtpUrls;
      if (dataSources?.i3xEndpoints?.length) body.i3xEndpoints = dataSources.i3xEndpoints;

      addLog('system', `Starting KG build for domain: ${domain}`);

      const response = await fetch(`${API_URL}/api/kg/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on double newlines for SSE blocks
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const events = parseSSE(part + '\n\n');
          for (const parsed of events) {
            const type = parsed.type as string;
            if (type === 'heartbeat') continue;

            switch (type) {
              case 'progress': {
                const phase = parsed.phase as number;
                const step = parsed.step as string;
                setCurrentPhase(phase);
                addLog('phase', `Phase ${phase}: ${step}`);
                break;
              }

              case 'done': {
                const summary = `${parsed.totalNodes} nodes, ${parsed.totalEdges} edges, ${parsed.accuracy}% accuracy`;
                setRunId(parsed.runId as string);
                setDoneSummary(summary);
                addLog('done', `Build complete: ${summary}`);
                setState('done');
                onRunComplete?.(parsed.runId as string);
                break;
              }

              case 'error':
                setErrorMessage(parsed.message as string);
                addLog('error', parsed.message as string);
                setState('error');
                break;

              default:
                addLog('event', `${type}: ${JSON.stringify(parsed)}`);
            }
          }
        }
      }

      // If stream ends without a done/error event, mark as done
      setState((prev) => (prev === 'running' ? 'done' : prev));
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      addLog('error', msg);
      setState('error');
    }
  }, [domain, dataSources, addLog, onRunComplete]);

  const handleRetry = () => {
    startBuild();
  };

  /* ------------------------------------------------------------------ */
  /*  Sub-renderers                                                      */
  /* ------------------------------------------------------------------ */

  const renderPhases = () => (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
      {PHASE_LABELS.map((label, i) => {
        const isActive = i === currentPhase;
        const isCompleted = i < currentPhase;
        return (
          <div key={i} className="flex items-center">
            {i > 0 && (
              <div
                className={`w-6 h-0.5 ${
                  isCompleted ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'
                }`}
              />
            )}
            <div
              className={`
                flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap
                ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/50'
                    : isCompleted
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-[var(--muted)]'
                }
              `}
            >
              <span className="text-xs">{isCompleted ? '\u2713' : i}</span>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderLogs = () => (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 max-h-64 overflow-y-auto p-3 font-mono text-xs space-y-1">
      {logs.map((entry, i) => {
        const colorMap: Record<string, string> = {
          system: 'text-blue-400',
          phase: 'text-emerald-400',
          progress: 'text-[var(--muted)]',
          error: 'text-red-400',
          user: 'text-yellow-400',
          schema: 'text-purple-400',
          validation: 'text-cyan-400',
          correction: 'text-orange-400',
          done: 'text-emerald-500 font-bold',
          input: 'text-yellow-300',
          answer: 'text-blue-300',
          event: 'text-[var(--muted)]',
        };
        return (
          <div key={i} className={colorMap[entry.type] || 'text-[var(--text)]'}>
            <span className="text-[var(--muted)] mr-2">
              {entry.timestamp.toLocaleTimeString()}
            </span>
            <span className="whitespace-pre-wrap">{entry.text}</span>
          </div>
        );
      })}
      <div ref={logEndRef} />
    </div>
  );


  /* ------------------------------------------------------------------ */
  /*  Main render                                                        */
  /* ------------------------------------------------------------------ */

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        Pipeline
      </h2>

      {/* ---- Idle ---- */}
      {state === 'idle' && (
        <div className="space-y-4">
          <button
            onClick={startBuild}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold py-3 px-6 text-sm transition-colors shadow-lg shadow-emerald-500/20"
          >
            Build Knowledge Graph
          </button>

          {recentRuns.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-[var(--muted)] mb-2">Recent Runs</h3>
              <div className="space-y-1">
                {recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-[var(--muted)] truncate mr-2">
                      {run.id.slice(0, 8)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === 'done'
                          ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400'
                          : run.status === 'error'
                          ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400'
                          : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400'
                      }`}
                    >
                      {run.status}
                    </span>
                    <span className="text-[var(--muted)] ml-2">
                      {new Date(run.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Running ---- */}
      {state === 'running' && (
        <div className="space-y-3">
          {renderPhases()}
          {renderLogs()}
        </div>
      )}

      {/* ---- Done ---- */}
      {state === 'done' && (
        <div className="space-y-3">
          {renderPhases()}
          <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
              Build Complete
            </h4>
            <p className="text-sm text-[var(--text)]">
              {doneSummary || 'Knowledge graph built successfully.'}
            </p>
          </div>
          {renderLogs()}
          <button
            onClick={() => {
              setState('idle');
              setRunId(null);
            }}
            className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-[var(--text)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            New Build
          </button>
        </div>
      )}

      {/* ---- Error ---- */}
      {state === 'error' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
            <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">
              Build Failed
            </h4>
            <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          </div>
          {logs.length > 0 && renderLogs()}
          <button
            onClick={handleRetry}
            className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm text-white font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
