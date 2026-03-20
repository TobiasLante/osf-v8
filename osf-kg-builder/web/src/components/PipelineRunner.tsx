'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Domain } from './DomainSelector';
import { apiFetch, API_URL } from '@/lib/api';

interface Run {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ValidationReport {
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  accuracy: number;
  issues: string[];
}

interface Props {
  domain?: Domain;
  className?: string;
  onRunComplete?: (runId: string) => void;
}

export default function PipelineRunner({ domain = 'manufacturing', className, onRunComplete }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<any>(null);
  const [buildPhase, setBuildPhase] = useState(-1);
  const [buildStep, setBuildStep] = useState('');
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResults, setReviewResults] = useState<any>(null);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    try {
      const data = await apiFetch<Run[]>('/api/kg/runs');
      setRuns(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(`Failed to load runs: ${e.message}`); setRuns([]); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [buildLog]);

  const startBuild = async () => {
    setBuilding(true);
    setError('');
    setBuildResult(null);
    setBuildPhase(-1);
    setBuildStep('Starting...');
    setBuildLog([]);

    try {
      const res = await fetch(`${API_URL}/api/kg/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress') {
                setBuildPhase(ev.phase);
                setBuildStep(ev.step);
                setBuildLog(prev => [...prev, `[Phase ${ev.phase}] ${ev.step}`]);
              } else if (ev.type === 'done') {
                setBuildResult(ev);
                onRunComplete?.(ev.runId);
                await loadRuns();
                if (ev.runId) await loadRun(ev.runId);
              } else if (ev.type === 'error') {
                setError(ev.message);
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  };

  const loadRun = async (id: string) => {
    setLoading(true);
    setError('');
    setReviewResults(null);
    try {
      const data = await apiFetch<any>(`/api/kg/runs/${id}`);
      setSelectedRun(data);
      onRunComplete?.(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const review = async (type: string, label: string) => {
    if (!selectedRun) return;
    setReviewing(true);
    setError('');
    try {
      const data = await apiFetch<any>('/api/kg/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: selectedRun.id, corrections: [{ type, label }] }),
      });
      setReviewResults(data);
      // Reload run with updated validation
      await loadRun(selectedRun.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReviewing(false);
    }
  };

  const vr: ValidationReport | null = selectedRun?.validationReport;

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Build Pipeline</h2>

      <button
        onClick={startBuild}
        disabled={building}
        className="w-full btn-primary py-3 text-base shadow-lg shadow-emerald-500/20 mb-4"
      >
        {building ? 'Building Knowledge Graph...' : `Build Knowledge Graph (${domain})`}
      </button>

      {/* Build Progress */}
      {building && (
        <div className="card mb-4 !border-blue-500/30 !bg-blue-500/5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-sm font-semibold text-blue-400">Phase {buildPhase >= 0 ? buildPhase : '...'}</span>
            <span className="text-xs text-[var(--text-muted)]">{buildStep}</span>
          </div>
          <div className="rounded-lg bg-[var(--surface-2)] max-h-40 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
            {buildLog.map((line, i) => (
              <div key={i} className="text-[var(--text-muted)]">{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {buildResult && !building && (
        <div className={`card mb-4 ${buildResult.status === 'complete' ? '!border-emerald-500/30 !bg-emerald-500/5' : '!border-red-500/30 !bg-red-500/5'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-[var(--text)]">{buildResult.status === 'complete' ? 'Build Complete' : 'Build Failed'}</span>
            {buildResult.accuracy !== undefined && <span className={`badge ${buildResult.accuracy >= 80 ? 'badge-emerald' : 'badge-amber'}`}>{buildResult.accuracy}%</span>}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {buildResult.totalNodes} nodes, {buildResult.totalEdges} edges
            {buildResult.error && <span className="text-red-400 ml-2">{buildResult.error}</span>}
          </div>
        </div>
      )}

      {/* Run List */}
      {runs.length > 0 ? (
        <div className="space-y-1 mb-4">
          {runs.map(r => (
            <button key={r.id} onClick={() => loadRun(r.id)}
              className={`w-full text-left card-interactive !p-2.5 flex items-center justify-between ${selectedRun?.id === r.id ? '!border-emerald-500/50' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`badge ${r.status === 'complete' ? 'badge-emerald' : r.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>{r.status}</span>
                <span className="text-xs text-[var(--text-muted)] font-mono">{r.id.substring(0, 8)}</span>
              </div>
              <span className="text-xs text-[var(--text-dim)]">{new Date(r.created_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card text-center text-[var(--text-dim)] text-sm py-6">No builds yet. Run the CLI builder first.</div>
      )}

      {error && <div className="card !border-red-500/30 text-red-400 text-sm mb-4">{error}</div>}

      {/* Selected Run Detail */}
      {selectedRun && vr && (
        <div className="space-y-4">
          {/* Accuracy */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">Validation Report</h3>
              <span className={`badge text-base px-3 py-1 ${vr.accuracy >= 80 ? 'badge-emerald' : vr.accuracy >= 50 ? 'badge-amber' : 'badge-red'}`}>{vr.accuracy}%</span>
            </div>

            {/* Node Counts */}
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-dim)] mb-1">Nodes</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(vr.nodeCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                  <div key={label} className="flex items-center gap-1.5 bg-[var(--surface-3)] rounded-md px-2 py-1">
                    <span className="text-xs text-[var(--text)]">{label}</span>
                    <span className="badge badge-emerald">{count}</span>
                    <button onClick={() => review('reextract_node', label)} disabled={reviewing}
                      className="text-xs text-amber-400 hover:text-amber-300 ml-1" title="Re-extract">&#x21bb;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Edge Counts */}
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-dim)] mb-1">Edges</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(vr.edgeCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                  <div key={label} className="flex items-center gap-1.5 bg-[var(--surface-3)] rounded-md px-2 py-1">
                    <span className="text-xs text-[var(--text)]">{label}</span>
                    <span className="badge badge-blue">{count}</span>
                    <button onClick={() => review('reextract_edge', label)} disabled={reviewing}
                      className="text-xs text-amber-400 hover:text-amber-300 ml-1" title="Re-build">&#x21bb;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Issues */}
            {vr.issues.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-400 mb-1">Issues ({vr.issues.length})</h4>
                {vr.issues.map((issue, i) => (
                  <div key={i} className="text-xs text-red-400/80 mb-0.5">{issue}</div>
                ))}
              </div>
            )}
          </div>

          {/* Review Results */}
          {reviewResults && (
            <div className="card !border-amber-500/30 !bg-amber-500/5">
              <h4 className="text-sm font-semibold text-amber-400 mb-2">Review Applied</h4>
              {reviewResults.corrections?.map((c: any, i: number) => (
                <div key={i} className="text-xs text-[var(--text-muted)]">{c.correction?.label}: {c.result}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && <div className="text-center text-[var(--text-dim)] py-4">Loading...</div>}
    </div>
  );
}
