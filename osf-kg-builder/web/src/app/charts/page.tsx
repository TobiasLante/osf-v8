'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';
import ChartRenderer, { type ChartConfig } from '@/components/ChartRenderer';

export default function ChartsPage() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [chart, setChart] = useState<ChartConfig | null>(null);
  const [cypher, setCypher] = useState('');
  const [context, setContext] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const generate = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    setChart(null);
    setCypher('');
    setContext([]);
    setStatus('Generating...');

    try {
      const res = await fetch(`${API_URL}/api/kg/chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) {
        // Non-SSE error
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
              if (ev.type === 'chart_status') setStatus(ev.message);
              if (ev.type === 'chart_data') {
                setChart(ev.chart);
                setCypher(ev.cypher);
                setContext(ev.semanticContext || []);
              }
              if (ev.type === 'error') throw new Error(ev.message);
            } catch (e: any) {
              if (e.message && !e.message.includes('JSON')) throw e;
            }
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chart Engine</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Ask a question in natural language. The AI generates a Cypher query, fetches data, and renders a chart.
        </p>
      </div>

      {/* Input */}
      <div className="card space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generate()}
            placeholder='e.g. "OEE of all machines as bar chart", "Production volume trend"...'
            className="input flex-1"
          />
          <button onClick={generate} disabled={loading || !question.trim()} className="btn-primary">
            {loading ? status || 'Generating...' : 'Generate Chart'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {['OEE of all machines as bar chart', 'Production orders by status', 'Equipment count by type', 'Process steps as a flow'].map(s => (
            <button key={s} onClick={() => setQuestion(s)} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--text-muted)] hover:border-purple-500/40 hover:text-purple-400 transition-colors">
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Chart Output */}
      {chart && (
        <div className="space-y-4">
          <div className="card">
            <ChartRenderer config={chart} height={400} />
          </div>

          {/* Cypher Query */}
          <div className="card">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">Generated Cypher</h3>
            <pre className="text-xs text-emerald-400 font-mono bg-[var(--surface-2)] rounded-md p-3 overflow-x-auto">{cypher}</pre>
          </div>

          {/* Semantic Context */}
          {context.length > 0 && (
            <div className="card">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">Semantic Context</h3>
              <div className="flex flex-wrap gap-2">
                {context.map((c, i) => (
                  <span key={i} className="badge badge-blue">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Raw Data */}
          <details className="card">
            <summary className="text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)] cursor-pointer">Raw Chart Config</summary>
            <pre className="text-xs text-[var(--text-muted)] font-mono mt-2 max-h-48 overflow-y-auto">{JSON.stringify(chart, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
