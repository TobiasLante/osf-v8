'use client';

import { useState, useCallback } from 'react';
import { API_URL } from '@/lib/api';

const SUGGESTIONS = ['Show all node types', 'Show all relationships', 'What equipment exists?', 'Show machines with OEE > 90%'];

interface Props {
  runId?: string;
  className?: string;
}

interface Answer { question: string; answer: string; }

export default function GraphExplorer({ runId, className }: Props) {
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setQuery('');
    try {
      const res = await fetch(`${API_URL}/api/kg-builder/message/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnswers(p => [...p, { question: q, answer: data.answer || data.message || JSON.stringify(data) }]);
    } catch (e: any) {
      setAnswers(p => [...p, { question: q, answer: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Graph Explorer</h2>
      <div className="card space-y-4">
        <div className="flex gap-2">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(query)} placeholder="Ask about the graph..." disabled={loading} className="input flex-1" />
          <button onClick={() => ask(query)} disabled={loading || !query.trim()} className="btn-primary">{loading ? 'Asking...' : 'Ask'}</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => ask(s)} disabled={loading} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--text-muted)] hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>

        {answers.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {answers.map((a, i) => (
              <div key={i} className="space-y-1">
                <div className="text-xs font-medium text-emerald-400">Q: {a.question}</div>
                <div className="rounded-md bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)] whitespace-pre-wrap">{a.answer}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
