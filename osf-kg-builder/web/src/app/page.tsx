'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';
import Link from 'next/link';

interface HealthData {
  graphAvailable: boolean;
  vectorAvailable: boolean;
  mqtt: { transform: boolean; bridge: boolean };
}

interface EmbeddingStats {
  total: number;
  byLabel: Record<string, number>;
}

export default function OverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [embeddings, setEmbeddings] = useState<EmbeddingStats | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [healthRes, embRes, runsRes] = await Promise.allSettled([
          fetch(`${API_URL}/health`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
          fetch(`${API_URL}/api/kg/embeddings/stats`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
          fetch(`${API_URL}/api/kg/runs`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        ]);

        if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
        if (embRes.status === 'fulfilled') setEmbeddings(embRes.value);
        if (runsRes.status === 'fulfilled') setRuns(Array.isArray(runsRes.value) ? runsRes.value.slice(0, 5) : []);

        if (healthRes.status === 'rejected') setError('Backend not reachable');
      } catch (e: any) {
        setError(e.message);
      }
    };
    load();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          AI-powered Knowledge Graph Platform for industry.
        </p>
      </div>

      {error && (
        <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          title="Graph Engine"
          value={health?.graphAvailable ? 'Online' : 'Offline'}
          status={health?.graphAvailable ? 'ok' : 'error'}
          detail="Apache AGE"
        />
        <StatusCard
          title="Vector Store"
          value={health?.vectorAvailable ? 'Online' : 'Offline'}
          status={health?.vectorAvailable ? 'ok' : 'warn'}
          detail={`${embeddings?.total ?? 0} embeddings`}
        />
        <StatusCard
          title="MQTT Transform"
          value={health?.mqtt?.transform ? 'Running' : 'Stopped'}
          status={health?.mqtt?.transform ? 'ok' : 'off'}
          detail="Raw → Curated"
        />
        <StatusCard
          title="KG Bridge"
          value={health?.mqtt?.bridge ? 'Running' : 'Stopped'}
          status={health?.mqtt?.bridge ? 'ok' : 'off'}
          detail="MQTT → Graph"
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickAction href="/build" title="Build Pipeline" desc="Build a Knowledge Graph from scratch" color="emerald" />
          <QuickAction href="/search" title="Semantic Search" desc="Find nodes by meaning, not keywords" color="blue" />
          <QuickAction href="/charts" title="Chart Engine" desc="Generate charts from natural language" color="purple" />
          <QuickAction href="/explore" title="Graph Explorer" desc="Query and explore the Knowledge Graph" color="amber" />
        </div>
      </div>

      {/* Embedding Stats */}
      {embeddings && embeddings.total > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Embedding Coverage</h2>
          <div className="card">
            <div className="flex flex-wrap gap-3">
              {Object.entries(embeddings.byLabel).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                <div key={label} className="flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-3 py-1.5">
                  <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                  <span className="badge badge-emerald">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Runs */}
      {runs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Recent Runs</h2>
          <div className="card space-y-2">
            {runs.map((run: any) => (
              <div key={run.id} className="flex items-center justify-between rounded-md bg-[var(--surface-2)] px-4 py-2.5">
                <span className="font-mono text-xs text-[var(--text-muted)]">{run.id?.slice(0, 8)}</span>
                <span className={`badge ${run.status === 'complete' ? 'badge-emerald' : run.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>
                  {run.status}
                </span>
                <span className="text-xs text-[var(--text-dim)]">
                  {run.created_at ? new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ title, value, status, detail }: { title: string; value: string; status: 'ok' | 'warn' | 'error' | 'off'; detail: string }) {
  const dotColor = { ok: 'bg-emerald-400', warn: 'bg-amber-400', error: 'bg-red-400', off: 'bg-zinc-500' }[status];
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-dim)]">{title}</span>
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      </div>
      <div className="text-lg font-semibold text-[var(--text)]">{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{detail}</div>
    </div>
  );
}

const colorMap: Record<string, { text: string; hover: string }> = {
  emerald: { text: 'text-emerald-400', hover: 'group-hover:text-emerald-300' },
  blue:    { text: 'text-blue-400',    hover: 'group-hover:text-blue-300' },
  purple:  { text: 'text-purple-400',  hover: 'group-hover:text-purple-300' },
  amber:   { text: 'text-amber-400',   hover: 'group-hover:text-amber-300' },
};

function QuickAction({ href, title, desc, color }: { href: string; title: string; desc: string; color: string }) {
  const c = colorMap[color] ?? colorMap.emerald;
  return (
    <Link href={href} className={`card-interactive group`}>
      <div className={`text-sm font-semibold ${c.text} ${c.hover} transition-colors`}>{title}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{desc}</div>
    </Link>
  );
}
