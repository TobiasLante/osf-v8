'use client';

import { useState, useEffect } from 'react';
import { API_URL } from '@/lib/api';

interface TransformStats { received: number; validated: number; rejected: number; published: number; errors: number; running: boolean; }
interface BridgeStats { received: number; nodesUpdated: number; errors: number; running: boolean; bufferSize: number; }

export default function MqttPage() {
  const [transform, setTransform] = useState<TransformStats | null>(null);
  const [bridge, setBridge] = useState<BridgeStats | null>(null);
  const [error, setError] = useState('');

  const refresh = () => {
    fetch(`${API_URL}/api/kg-builder/mqtt/status`)
      .then(r => r.json())
      .then(d => { setTransform(d.transform); setBridge(d.bridge); setError(''); })
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
          <h1 className="text-2xl font-bold tracking-tight">MQTT Status</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Dual-broker architecture: Raw (31883) \u2192 Transform \u2192 Curated (31884) \u2192 KG Bridge.
          </p>
        </div>
        <button onClick={refresh} className="btn-secondary text-xs">Refresh</button>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Architecture Diagram */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-4">Data Flow</h2>
        <div className="flex items-center justify-between gap-2 text-center">
          <FlowBox label="Raw Broker" detail="Port 31883" status="ok" />
          <Arrow />
          <FlowBox label="Transform" detail={transform ? `${transform.validated} validated` : 'Loading...'} status={transform?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Curated Broker" detail="Port 31884" status={transform?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="KG Bridge" detail={bridge ? `${bridge.nodesUpdated} nodes` : 'Loading...'} status={bridge?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Knowledge Graph" detail="Apache AGE" status="ok" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Transform Stats */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">Transform Service</h2>
            <span className={`badge ${transform?.running ? 'badge-emerald' : 'badge-red'}`}>
              {transform?.running ? 'Running' : 'Stopped'}
            </span>
          </div>
          {transform && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Received" value={transform.received} />
              <Stat label="Validated" value={transform.validated} color="emerald" />
              <Stat label="Rejected" value={transform.rejected} color="amber" />
              <Stat label="Published" value={transform.published} color="blue" />
              <Stat label="Errors" value={transform.errors} color={transform.errors > 0 ? 'red' : undefined} />
            </div>
          )}
        </div>

        {/* Bridge Stats */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)]">KG Bridge</h2>
            <span className={`badge ${bridge?.running ? 'badge-emerald' : 'badge-red'}`}>
              {bridge?.running ? 'Running' : 'Stopped'}
            </span>
          </div>
          {bridge && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Received" value={bridge.received} />
              <Stat label="Nodes Updated" value={bridge.nodesUpdated} color="emerald" />
              <Stat label="Buffer Size" value={bridge.bufferSize} color="blue" />
              <Stat label="Errors" value={bridge.errors} color={bridge.errors > 0 ? 'red' : undefined} />
            </div>
          )}
        </div>
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

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  const textColor = color ? `text-${color}-400` : 'text-[var(--text)]';
  return (
    <div>
      <div className="text-xs text-[var(--text-dim)]">{label}</div>
      <div className={`text-xl font-bold ${textColor}`}>{value.toLocaleString()}</div>
    </div>
  );
}
