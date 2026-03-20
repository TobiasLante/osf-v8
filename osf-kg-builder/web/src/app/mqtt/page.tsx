'use client';

import { useState, useEffect, useRef } from 'react';
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

interface MqttMessage {
  ts: string;
  topic: string;
  value: any;
}

export default function MqttPage() {
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [raw, setRaw] = useState<MqttMessage[]>([]);
  const [enriched, setEnriched] = useState<MqttMessage[]>([]);
  const [error, setError] = useState('');
  const rawEndRef = useRef<HTMLDivElement>(null);
  const enrichedEndRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const [s, m] = await Promise.all([
        apiFetch<BridgeStats>('/api/kg/mqtt/status'),
        apiFetch<{ raw: MqttMessage[]; enriched: MqttMessage[] }>('/api/kg/mqtt/messages'),
      ]);
      setStats(s);
      setRaw(m.raw);
      setEnriched(m.enriched);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { rawEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [raw]);
  useEffect(() => { enrichedEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [enriched]);

  const parseTopic = (topic: string) => {
    const parts = topic.split('/');
    return { machine: parts[1] || '?', category: parts[4] || '?', variable: parts[5] || '?' };
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MQTT Bridge</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Raw UNS &rarr; Validate &rarr; Enrich &rarr; Neo4j. Topic: Factory/&#123;Machine&#125;/&#123;WO&#125;/&#123;Tool&#125;/&#123;Category&#125;/&#123;Variable&#125;
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${stats?.running ? 'badge-emerald' : 'badge-red'}`}>{stats?.running ? 'Running' : 'Stopped'}</span>
          <button onClick={refresh} className="btn-secondary text-xs">Refresh</button>
        </div>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Flow */}
      <div className="card">
        <div className="flex items-center justify-between gap-2 text-center">
          <FlowBox label="Raw Broker" detail={`${stats?.received.toLocaleString() ?? '...'} msgs`} status={stats?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Validate" detail={`${stats?.validated.toLocaleString() ?? '...'} passed`} status={stats?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Enrich" detail={`${stats?.rejected.toLocaleString() ?? '...'} rejected`} status={stats?.running ? 'ok' : 'off'} />
          <Arrow />
          <FlowBox label="Neo4j KG" detail={`${stats?.kgUpdated.toLocaleString() ?? '...'} nodes`} status={stats?.kgUpdated ? 'ok' : 'off'} />
        </div>
      </div>

      {/* Two Panels: Raw UNS | Enriched → KG */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Raw UNS Stream */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-amber-400">Raw UNS Stream</h2>
            <span className="text-xs text-[var(--text-dim)]">{raw.length} / 50</span>
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mb-2 font-mono">Factory / Machine / WO / Tool / Category / Variable = Value</div>
          <div className="rounded-lg bg-[var(--surface-2)] max-h-72 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
            {raw.length === 0 && <div className="text-[var(--text-dim)] text-center py-8">Waiting for MQTT messages...</div>}
            {raw.map((m, i) => {
              const t = parseTopic(m.topic);
              return (
                <div key={i} className="flex gap-1 py-0.5 border-b border-[var(--border)]/10 leading-tight">
                  <span className="text-[var(--text-dim)] w-14 flex-shrink-0">{new Date(m.ts).toLocaleTimeString()}</span>
                  <span className="text-blue-400 w-12 flex-shrink-0">{t.machine}</span>
                  <span className="text-purple-400 w-16 flex-shrink-0">{t.category}/{t.variable}</span>
                  <span className="text-emerald-400 ml-auto">{typeof m.value === 'object' ? JSON.stringify(m.value).substring(0, 30) : String(m.value)}</span>
                </div>
              );
            })}
            <div ref={rawEndRef} />
          </div>
        </div>

        {/* Enriched → KG */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-blue-400">Enriched &rarr; Neo4j</h2>
            <span className="text-xs text-[var(--text-dim)]">{enriched.length} / 50</span>
          </div>
          <div className="text-[10px] text-[var(--text-dim)] mb-2 font-mono">Label : ID | enriched properties → MERGE into Neo4j</div>
          <div className="rounded-lg bg-[var(--surface-2)] max-h-72 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
            {enriched.length === 0 && <div className="text-[var(--text-dim)] text-center py-8">No KG writes yet...</div>}
            {enriched.map((m, i) => (
              <div key={i} className="flex gap-1 py-0.5 border-b border-[var(--border)]/10 leading-tight">
                <span className="text-[var(--text-dim)] w-14 flex-shrink-0">{new Date(m.ts).toLocaleTimeString()}</span>
                <span className="text-amber-400 w-16 flex-shrink-0">{m.value?.label || '?'}</span>
                <span className="text-blue-400 w-14 flex-shrink-0">{m.value?.id || '?'}</span>
                <span className="text-[var(--text-muted)] truncate">
                  {Object.entries(m.value || {}).filter(([k]) => !['label','id','last_mqtt_update'].includes(k)).slice(0, 3).map(([k,v]) => `${k}=${v}`).join(' ')}
                </span>
              </div>
            ))}
            <div ref={enrichedEndRef} />
          </div>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <StatBox label="Received" value={stats.received} />
          <StatBox label="Validated" value={stats.validated} color="emerald" />
          <StatBox label="Rejected" value={stats.rejected} color="amber" />
          <StatBox label="KG Updated" value={stats.kgUpdated} color="blue" />
          <StatBox label="Buffer" value={stats.bufferSize} />
          <StatBox label="Errors" value={stats.errors} color={stats.errors > 0 ? 'red' : undefined} />
        </div>
      )}
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

const colors: Record<string, string> = { emerald: 'text-emerald-400', blue: 'text-blue-400', amber: 'text-amber-400', red: 'text-red-400' };

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card !p-3 text-center">
      <div className="text-xs text-[var(--text-dim)]">{label}</div>
      <div className={`text-lg font-bold ${color ? colors[color] || 'text-[var(--text)]' : 'text-[var(--text)]'}`}>{value.toLocaleString()}</div>
    </div>
  );
}
