'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

// ── ISA-95 Mapping (from openshopfloor UNS page) ────────────────
const ISA95_MAP: Record<string, { area: string; workCenter: string; cell: string }> = {
  "CNC-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "CNC" },
  "DRH-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Drehen" },
  "FRS-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Fraesen" },
  "SGF-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Schleifen" },
  "SGM-":     { area: "Fertigung", workCenter: "Spritzguss",      cell: "SGM" },
  "ML-":      { area: "Montage",   workCenter: "Endmontage",      cell: "Linie" },
  "BZ-":      { area: "Fertigung", workCenter: "FFS",             cell: "Zelle" },
};
const ENTERPRISE = "OSF";
const SITE = "Werk-Sued";
const SITE_LEVEL = new Set(["ERP"]);
const AREA_LEVEL = new Set(["QMS", "TMS", "WMS"]);

function getMachineMapping(machine: string) {
  for (const [prefix, mapping] of Object.entries(ISA95_MAP)) {
    if (machine.startsWith(prefix)) return mapping;
  }
  return { area: "Sonstige", workCenter: "Sonstige", cell: "Sonstige" };
}

// ── Types ────────────────────────────────────────────────────────
interface MqttMessage { ts: string; topic: string; value: any; }
interface BridgeStats { received: number; validated: number; rejected: number; kgUpdated: number; errors: number; running: boolean; bufferSize: number; }

interface TopicNode {
  name: string;
  fullTopic: string;
  value?: string;
  ts?: number;
  children: Map<string, TopicNode>;
}

// ── ISA-95 Tree Builder ─────────────────────────────────────────
function buildIsa95Tree(messages: MqttMessage[], label: string): TopicNode {
  const root: TopicNode = { name: label, fullTopic: `${label}`, children: new Map() };

  function ensure(parent: TopicNode, name: string, prefix: string): TopicNode {
    if (!parent.children.has(name)) {
      parent.children.set(name, { name, fullTopic: prefix + "/" + name, children: new Map() });
    }
    return parent.children.get(name)!;
  }

  for (const msg of messages) {
    const parts = msg.topic.split("/");
    if (parts.length < 2) continue;

    const machine = parts[1];
    const category = parts[4] || "Data";
    const variable = parts[5] || null;
    const { area, workCenter, cell } = getMachineMapping(machine);
    const p = label;

    const siteNode = ensure(root, SITE, p);
    let targetNode: TopicNode;

    if (SITE_LEVEL.has(category)) {
      const catNode = ensure(siteNode, category, siteNode.fullTopic);
      targetNode = ensure(catNode, machine, catNode.fullTopic);
    } else if (AREA_LEVEL.has(category)) {
      const areaNode = ensure(siteNode, area, siteNode.fullTopic);
      const catNode = ensure(areaNode, category, areaNode.fullTopic);
      targetNode = ensure(catNode, machine, catNode.fullTopic);
    } else {
      const areaNode = ensure(siteNode, area, siteNode.fullTopic);
      const wcNode = ensure(areaNode, workCenter, areaNode.fullTopic);
      const cellNode = ensure(wcNode, cell, wcNode.fullTopic);
      const machNode = ensure(cellNode, machine, machNode?.fullTopic || cellNode.fullTopic);
      const catNode = ensure(machNode, category, machNode.fullTopic);
      targetNode = catNode;
    }

    if (variable) {
      const varNode = ensure(targetNode, variable, targetNode.fullTopic);
      const val = typeof msg.value === 'object' ? msg.value?.Value ?? msg.value : msg.value;
      varNode.value = String(val);
      varNode.ts = new Date(msg.ts).getTime();
    }
  }
  return root;
}

// ── Tree Node Component ─────────────────────────────────────────
function TreeNode({ node, depth = 0, expanded, onToggle }: {
  node: TopicNode; depth?: number; expanded: Set<string>; onToggle: (t: string) => void;
}) {
  const hasChildren = node.children.size > 0;
  const isOpen = expanded.has(node.fullTopic);
  const age = node.ts ? Math.floor((Date.now() - node.ts) / 1000) : null;
  const fresh = age !== null && age < 10;

  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <div
        className={`flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-[var(--surface-3)] rounded px-1 ${fresh ? 'bg-emerald-500/5' : ''}`}
        onClick={() => onToggle(node.fullTopic)}
      >
        {hasChildren ? (
          <span className="text-[var(--text-dim)] text-xs w-3 text-center select-none">{isOpen ? '\u25BC' : '\u25B6'}</span>
        ) : (
          <span className="w-3 text-center text-[var(--text-dim)] text-xs select-none">&middot;</span>
        )}
        <span className={`text-[11px] font-mono ${!hasChildren ? 'text-emerald-400' : 'text-[var(--text)]'}`}>
          {node.name}
        </span>
        {node.value && (
          <span className={`text-[11px] font-mono font-semibold ml-1 ${fresh ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
            {node.value.length > 30 ? node.value.substring(0, 30) + '...' : node.value}
          </span>
        )}
        {hasChildren && (
          <span className="text-[10px] text-[var(--text-dim)] ml-0.5">({node.children.size})</span>
        )}
        {age !== null && (
          <span className="text-[10px] text-[var(--text-dim)] ml-auto shrink-0">{age}s</span>
        )}
      </div>
      {isOpen && Array.from(node.children.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(child => (
          <TreeNode key={child.fullTopic} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
        ))}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function MqttPage() {
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [raw, setRaw] = useState<MqttMessage[]>([]);
  const [enriched, setEnriched] = useState<MqttMessage[]>([]);
  const [error, setError] = useState('');
  const [rawExpanded, setRawExpanded] = useState<Set<string>>(() => new Set([ENTERPRISE]));
  const [enrichedExpanded, setEnrichedExpanded] = useState<Set<string>>(() => new Set([ENTERPRISE]));

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
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  // Auto-expand first levels
  useEffect(() => {
    if (raw.length > 0) {
      setRawExpanded(prev => {
        const next = new Set(prev);
        next.add(ENTERPRISE); next.add(`${ENTERPRISE}/${SITE}`);
        next.add(`${ENTERPRISE}/${SITE}/Fertigung`); next.add(`${ENTERPRISE}/${SITE}/Montage`);
        return next;
      });
    }
    if (enriched.length > 0) {
      setEnrichedExpanded(prev => {
        const next = new Set(prev);
        next.add(ENTERPRISE); next.add(`${ENTERPRISE}/${SITE}`);
        next.add(`${ENTERPRISE}/${SITE}/Fertigung`); next.add(`${ENTERPRISE}/${SITE}/Montage`);
        return next;
      });
    }
  }, [raw, enriched]);

  const toggleRaw = useCallback((t: string) => {
    setRawExpanded(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }, []);
  const toggleEnriched = useCallback((t: string) => {
    setEnrichedExpanded(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }, []);

  const rawTree = buildIsa95Tree(raw, ENTERPRISE);
  const enrichedTree = buildIsa95Tree(enriched, ENTERPRISE);

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MQTT Bridge — <span className="text-emerald-400">UNS</span></h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Same data, two stages. Left: Raw UNS from MQTT broker. Right: Enriched UNS written to Neo4j KG. Both in ISA-95 hierarchy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${stats?.running ? 'badge-emerald' : 'badge-red'}`}>{stats?.running ? 'Live' : 'Stopped'}</span>
          <span className="text-xs text-[var(--text-dim)]">{stats?.received.toLocaleString() ?? '0'} msgs</span>
          <button onClick={refresh} className="btn-secondary text-xs">Refresh</button>
        </div>
      </div>

      {error && <div className="card !border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* Flow */}
      <div className="flex items-center justify-between gap-2 text-center">
        <FlowBox label="Raw Broker" detail={`${stats?.received.toLocaleString() ?? '...'}`} status={stats?.running ? 'ok' : 'off'} />
        <Arrow />
        <FlowBox label="Validate" detail={`${stats?.validated.toLocaleString() ?? '...'} ok`} status={stats?.running ? 'ok' : 'off'} />
        <Arrow />
        <FlowBox label="Enrich" detail={`${stats?.rejected.toLocaleString() ?? '...'} rej`} status={stats?.running ? 'ok' : 'off'} />
        <Arrow />
        <FlowBox label="Neo4j KG" detail={`${stats?.kgUpdated.toLocaleString() ?? '...'} nodes`} status={stats?.kgUpdated ? 'ok' : 'off'} />
      </div>

      {/* Two ISA-95 Trees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Raw UNS */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] flex flex-col">
          <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">RAW</span>
              <h2 className="text-sm font-bold text-[var(--text)]">UNS — ISA-95</h2>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">Raw MQTT messages from Factory/# mapped to ISA-95 hierarchy.</p>
            <span className="text-[10px] text-[var(--text-dim)]"><span className="text-emerald-400">Live</span> &middot; {raw.length} messages</span>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-320px)] overflow-auto">
            {raw.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">Waiting for MQTT messages...</div>
            ) : (
              <TreeNode node={rawTree} depth={0} expanded={rawExpanded} onToggle={toggleRaw} />
            )}
          </div>
        </div>

        {/* Right: Enriched UNS → KG */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] flex flex-col">
          <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">ENRICHED</span>
              <h2 className="text-sm font-bold text-[var(--text)]">UNS → Neo4j KG</h2>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">Validated + enriched data written to Knowledge Graph. Same ISA-95 structure.</p>
            <span className="text-[10px] text-[var(--text-dim)]"><span className="text-blue-400">KG</span> &middot; {enriched.length} nodes</span>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-320px)] overflow-auto">
            {enriched.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">No KG writes yet — build KG first, then enriched data appears here.</div>
            ) : (
              <TreeNode node={enrichedTree} depth={0} expanded={enrichedExpanded} onToggle={toggleEnriched} />
            )}
          </div>
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
