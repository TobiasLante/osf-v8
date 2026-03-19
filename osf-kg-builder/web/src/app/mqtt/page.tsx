'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

interface BridgeStats {
  received: number;
  validated: number;
  rejected: number;
  kgUpdated: number;
  errors: number;
  running: boolean;
  bufferSize: number;
}

export default function MqttPage() {
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [error, setError] = useState('');

  const refresh = () => {
    apiFetch<BridgeStats>('/api/kg/mqtt/status')
      .then(d => { setStats(d); setError(''); })
      .catch(e => setError(e.message));
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MQTT Bridge</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Unified MQTT bridge: Raw broker &rarr; Validate &rarr; Enrich &rarr; Neo4j KG.
          </p>
        </div>
        <button onClick={refresh} className="btn-secondary text-xs">Refresh</button>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Architecture Diagram */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-4">Data Flow</h2>
        <div className="flex items-center justify-between gap-2 text-center">
          <FlowBox label="Raw Broker" detail="MQTT" status="ok" />
          <Arrow />
          <FlowBox label="Validate" detail={stats ? `${stats.validated} validated` : 'Loading...'} status={stats?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Enrich" detail={stats ? `${stats.rejected} rejected` : ''} status={stats?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Neo4j KG" detail={stats ? `${stats.kgUpdated} nodes` : 'Loading...'} status={stats?.running ? 'ok' : 'off'} />
        </div>
      </div>

      {/* Stats */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">Bridge Stats</h2>
          <span className={`badge ${stats?.running ? 'badge-emerald' : 'badge-red'}`}>
            {stats?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="Received" value={stats.received} />
            <Stat label="Validated" value={stats.validated} color="emerald" />
            <Stat label="Rejected" value={stats.rejected} color="amber" />
            <Stat label="KG Updated" value={stats.kgUpdated} color="blue" />
            <Stat label="Buffer Size" value={stats.bufferSize} />
            <Stat label="Errors" value={stats.errors} color={stats.errors > 0 ? 'red' : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

function FlowBox({ label, detail, status }: { label: string; detail: string; status: 'ok' | 'off' }) {
  return (
    <div className={`rounded-md border px-3 py-2 flex-1 ${status === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}>
      <div className="text-xs font-semibold text-[var(--text)]">{label}</div>
      <div className="text-xs text-[var(--text-dim)] mt-0.5">{detail}</div>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="w-4 h-4 text-[var(--text-dim)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

const statColorMap: Record<string, string> = {
  emerald: 'text-emerald-400',
  blue:    'text-blue-400',
  amber:   'text-amber-400',
  red:     'text-red-400',
};

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  const textColor = color ? (statColorMap[color] ?? 'text-[var(--text)]') : 'text-[var(--text)]';
  return (
    <div>
      <div className="text-xs text-[var(--text-dim)]">{label}</div>
      <div className={`text-xl font-bold ${textColor}`}>{value.toLocaleString()}</div>
    </div>
  );
}
