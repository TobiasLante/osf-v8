'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';

interface SearchResult {
  node_id: string;
  node_label: string;
  text_content: string;
  similarity: number;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(10);
  const [labelFilter, setLabelFilter] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/kg-builder/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, minSimilarity: 0.3, labelFilter: labelFilter || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Semantic Search</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Find Knowledge Graph nodes by meaning. Powered by vector embeddings.
        </p>
      </div>

      {/* Search Form */}
      <div className="card space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. &quot;temperature sensors&quot;, &quot;downstream purification&quot;, &quot;TFF systems&quot;..."
            className="input flex-1"
          />
          <button onClick={search} disabled={loading || !query.trim()} className="btn-primary">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-dim)]">Label filter:</label>
            <input type="text" value={labelFilter} onChange={e => setLabelFilter(e.target.value)} placeholder="e.g. Machine" className="input !w-40 !py-1" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-dim)]">Limit:</label>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="input !w-20 !py-1">
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {/* Quick Suggestions */}
        <div className="flex flex-wrap gap-2">
          {['Temperature sensors', 'Bioreactor equipment', 'Production orders', 'Quality metrics', 'Downstream filtration'].map(s => (
            <button key={s} onClick={() => { setQuery(s); }} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--text-muted)] hover:border-emerald-500/40 hover:text-emerald-400 transition-colors">
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </h2>
          {results.map((r, i) => (
            <div key={i} className="card flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="badge badge-purple">{r.node_label}</span>
                  <span className="text-sm font-semibold text-[var(--text)]">{r.node_id}</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] truncate">{r.text_content}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className={`text-lg font-bold ${r.similarity >= 0.7 ? 'text-emerald-400' : r.similarity >= 0.5 ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>
                  {(r.similarity * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--text-dim)]">match</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !loading && !error && query && (
        <div className="text-center text-[var(--text-dim)] py-12">No results found. Try a different query or build the graph first.</div>
      )}
    </div>
  );
}
