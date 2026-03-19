'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Domain } from './DomainSelector';
import { API_URL } from '@/lib/api';

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
  const [reviewing, setReviewing] = useState(false);
  const [reviewResults, setReviewResults] = useState<any>(null);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/kg/runs`);
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(`Failed to load runs: ${e.message}`); setRuns([]); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const loadRun = async (id: string) => {
    setLoading(true);
    setError('');
    setReviewResults(null);
    try {
      const res = await fetch(`${API_URL}/api/kg/runs/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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
      const res = await fetch(`${API_URL}/api/kg/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: selectedRun.id, corrections: [{ type, label }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Pipeline Runs</h2>

      <p className="text-xs text-[var(--text-muted)] mb-4">
        Build via CLI: <code className="bg-[var(--surface-3)] px-1.5 py-0.5 rounded text-emerald-400">npm run build-kg -- --domain {domain}</code>
      </p>

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
