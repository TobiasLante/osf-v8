'use client';

import { useState, useEffect } from 'react';
import { API_URL } from '@/lib/api';

interface EmbeddingStats { total: number; byLabel: Record<string, number>; }

export default function ExplorePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<EmbeddingStats | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/kg/embeddings/stats`).then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/kg/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 20 }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const labels = stats ? Object.entries(stats.byLabel).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Graph Explorer</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Browse and search the Knowledge Graph. Click a node type to filter, or use semantic search.
        </p>
      </div>

      {/* Node Type Overview */}
      {labels.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Node Types ({stats?.total} total embeddings)</h2>
          <div className="flex flex-wrap gap-2">
            {labels.map(([label, count]) => (
              <button
                key={label}
                onClick={() => { setQuery(label); search(label); }}
                className="card-interactive flex items-center gap-2 !p-2.5"
              >
                <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                <span className="badge badge-emerald">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="card">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            placeholder="Semantic search across all nodes..."
            className="input flex-1"
          />
          <button onClick={() => search(query)} disabled={loading} className="btn-primary">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r: any, i: number) => (
            <div key={i} className="card flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="badge badge-purple">{r.node_label}</span>
                  <span className="text-sm font-semibold text-[var(--text)]">{r.node_id}</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] truncate">{r.text_content}</p>
              </div>
              <div className={`text-sm font-bold ${r.similarity >= 0.7 ? 'text-emerald-400' : r.similarity >= 0.5 ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>
                {(r.similarity * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {labels.length === 0 && !loading && (
        <div className="text-center text-[var(--text-dim)] py-16">
          <p className="text-lg mb-2">No graph data yet</p>
          <p className="text-sm">Run the Build Pipeline first to populate the Knowledge Graph.</p>
        </div>
      )}
    </div>
  );
}
