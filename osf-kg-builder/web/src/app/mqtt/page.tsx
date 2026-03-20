'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

// ── ISA-95 Mapping (identical to openshopfloor /uns) ─────────────
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

function getMachineMapping(m: string) {
  for (const [p, v] of Object.entries(ISA95_MAP)) { if (m.startsWith(p)) return v; }
  return { area: "Sonstige", workCenter: "Sonstige", cell: "Sonstige" };
}

// ── Types ────────────────────────────────────────────────────────
interface Msg { ts: string; topic: string; value: any; }
interface Stats { received: number; validated: number; rejected: number; kgUpdated: number; errors: number; running: boolean; bufferSize: number; }
interface TNode { name: string; fp: string; value?: string; unit?: string; def?: string; ts?: number; children: Map<string, TNode>; }

// ── ISA-95 Tree Builder ─────────────────────────────────────────
function buildTree(messages: Msg[], rootName: string): TNode {
  const root: TNode = { name: rootName, fp: rootName, children: new Map() };
  function ensure(parent: TNode, name: string): TNode {
    if (!parent.children.has(name)) {
      parent.children.set(name, { name, fp: parent.fp + "/" + name, children: new Map() });
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

    const siteNode = ensure(root, SITE);
    let target: TNode;

    if (SITE_LEVEL.has(category)) {
      target = ensure(ensure(siteNode, category), machine);
    } else if (AREA_LEVEL.has(category)) {
      target = ensure(ensure(ensure(siteNode, area), category), machine);
    } else {
      const areaNode = ensure(siteNode, area);
      const wcNode = ensure(areaNode, workCenter);
      const cellNode = ensure(wcNode, cell);
      const machNode = ensure(cellNode, machine);
      target = ensure(machNode, category);
    }

    if (variable) {
      const vn = ensure(target, variable);
      // Parse UNS payload
      let val = msg.value;
      if (typeof val === 'object' && val !== null) {
        vn.value = val.Value !== undefined ? String(typeof val.Value === 'number' ? (Number.isInteger(val.Value) ? val.Value : val.Value.toFixed(2)) : val.Value) : JSON.stringify(val).substring(0, 40);
        vn.unit = val.Unit || '';
        vn.def = val.Definition || '';
      } else {
        vn.value = String(val);
      }
      vn.ts = new Date(msg.ts).getTime();
    }
  }
  return root;
}

function countTopics(node: TNode): number {
  if (node.children.size === 0) return node.value ? 1 : 0;
  let c = 0;
  for (const ch of node.children.values()) c += countTopics(ch);
  return c;
}

function maxDepth(node: TNode, d = 0): number {
  if (node.children.size === 0) return d;
  let mx = d;
  for (const ch of node.children.values()) mx = Math.max(mx, maxDepth(ch, d + 1));
  return mx;
}

// ── Tree Node (identical style to openshopfloor /uns) ───────────
function TreeNode({ node, depth = 0, exp, toggle }: { node: TNode; depth?: number; exp: Set<string>; toggle: (t: string) => void; }) {
  const has = node.children.size > 0;
  const open = exp.has(node.fp);
  const age = node.ts ? Math.floor((Date.now() - node.ts) / 1000) : null;
  const fresh = age !== null && age < 5;

  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <div
        className={`flex items-center gap-1.5 py-[3px] cursor-pointer hover:bg-[var(--surface-3)] rounded px-1 ${fresh ? 'bg-emerald-500/5' : ''}`}
        onClick={() => has ? toggle(node.fp) : toggle(node.fp + "::d")}
      >
        {has ? (
          <span className="text-[var(--text-dim)] text-xs w-3 text-center select-none">{open ? '\u25BC' : '\u25B6'}</span>
        ) : (
          <span className="w-3 text-center text-[var(--text-dim)] text-xs select-none">&middot;</span>
        )}
        <span className={`text-[11px] font-mono ${!has ? 'text-[#ff9500]' : 'text-[var(--text)]'}`}>{node.name}</span>
        {node.value && (
          <span className={`text-[11px] ml-1 truncate`}>
            <span className={`font-mono font-semibold ${fresh ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>{node.value}</span>
            {node.unit && <span className="text-[var(--text-dim)] ml-1">{node.unit}</span>}
          </span>
        )}
        {has && <span className="text-[10px] text-[var(--text-dim)] ml-0.5">({node.children.size})</span>}
        {age !== null && <span className="text-[10px] text-[var(--text-dim)] ml-auto shrink-0">{age}s</span>}
      </div>
      {/* Expanded detail for leaf nodes */}
      {!has && node.value && exp.has(node.fp + "::d") && (
        <pre className="text-[10px] text-[var(--text-muted)] font-mono ml-6 p-2 bg-[var(--surface-2)] rounded mb-1 max-h-40 overflow-auto whitespace-pre-wrap">
          {node.def ? `${node.def}\nValue: ${node.value} ${node.unit || ''}` : node.value}
        </pre>
      )}
      {open && Array.from(node.children.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(ch => <TreeNode key={ch.fp} node={ch} depth={depth + 1} exp={exp} toggle={toggle} />)}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function MqttPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [raw, setRaw] = useState<Msg[]>([]);
  const [enriched, setEnriched] = useState<Msg[]>([]);
  const [error, setError] = useState('');
  const [rawExp, setRawExp] = useState<Set<string>>(() => new Set([ENTERPRISE]));
  const [enrExp, setEnrExp] = useState<Set<string>>(() => new Set([ENTERPRISE]));

  const refresh = async () => {
    try {
      const [s, m] = await Promise.all([
        apiFetch<Stats>('/api/kg/mqtt/status'),
        apiFetch<{ raw: Msg[]; enriched: Msg[] }>('/api/kg/mqtt/messages'),
      ]);
      setStats(s); setRaw(m.raw); setEnriched(m.enriched); setError('');
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => { refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t); }, []);

  // Auto-expand first levels
  useEffect(() => {
    const autoExpand = (prev: Set<string>) => {
      const n = new Set(prev);
      n.add(ENTERPRISE); n.add(ENTERPRISE + "/" + SITE);
      n.add(ENTERPRISE + "/" + SITE + "/Fertigung");
      n.add(ENTERPRISE + "/" + SITE + "/Montage");
      return n;
    };
    if (raw.length > 0) setRawExp(autoExpand);
    if (enriched.length > 0) setEnrExp(autoExpand);
  }, [raw.length, enriched.length]);

  const tRaw = useCallback((t: string) => { setRawExp(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; }); }, []);
  const tEnr = useCallback((t: string) => { setEnrExp(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; }); }, []);

  const rawTree = buildTree(raw, ENTERPRISE);
  const enrTree = buildTree(enriched, ENTERPRISE);
  const rawTopics = countTopics(rawTree);
  const enrTopics = countTopics(enrTree);
  const enrDepth = maxDepth(enrTree);

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-1">
          MQTT Bridge{' '}
          <span className="bg-gradient-to-r from-[#ff9500] to-[#ff5722] bg-clip-text text-transparent">UNS</span>
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Same factory data, two stages. Left: raw MQTT from broker (before processing).
          Right: validated &amp; enriched data written to Neo4j Knowledge Graph.
          Both mapped to ISA-95 Unified Namespace.
        </p>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${stats?.running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-[var(--text-muted)]">{stats?.running ? 'Connected to MQTT broker' : 'Disconnected'}</span>
        </div>
        <span className="text-[var(--border)]">|</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.received.toLocaleString() ?? 0} messages received</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.validated.toLocaleString() ?? 0} validated</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.kgUpdated.toLocaleString() ?? 0} KG writes</span>
        <button onClick={refresh} className="ml-auto text-xs text-[var(--text-dim)] hover:text-[#ff9500]">Refresh</button>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-400">{error}</div>}

      {/* Two ISA-95 Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Left: Raw UNS */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] flex flex-col">
          <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">RAW</span>
              <h2 className="text-sm font-bold text-[var(--text)]">Unified Namespace</h2>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">
              Raw MQTT messages from Factory/# mapped to ISA-95 hierarchy. Before validation.
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-[var(--text-dim)]"><span className="text-emerald-400">Live</span> &middot; {rawTopics} Topics</span>
            </div>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
            {rawTopics === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">
                {stats?.running ? 'Waiting for messages...' : 'Connecting to MQTT broker...'}
              </div>
            ) : (
              <TreeNode node={rawTree} depth={0} exp={rawExp} toggle={tRaw} />
            )}
          </div>
        </div>

        {/* Right: Enriched UNS → KG */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] flex flex-col">
          <div className="px-4 pt-3 pb-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">ENRICHED</span>
              <h2 className="text-sm font-bold text-[var(--text)]">Unified Namespace</h2>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">
              Validated &amp; enriched data. Written to Neo4j KG via MERGE. Same ISA-95 structure.
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-[var(--text-dim)]"><span className="text-blue-400">KG</span> &middot; {enrTopics} Topics</span>
              {enrDepth > 0 && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{enrDepth} levels deep</span>}
            </div>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
            {enrTopics === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">
                {stats?.kgUpdated ? 'Loading...' : 'No KG writes yet — data appears after validation.'}
              </div>
            ) : (
              <TreeNode node={enrTree} depth={0} exp={enrExp} toggle={tEnr} />
            )}
          </div>
        </div>
      </div>

      {/* Info Cards (identical layout to openshopfloor /uns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Raw MQTT</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Messages direct from Factory/# topic. Unvalidated, unfiltered. This is what the broker sees.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">
            <span className="text-[#ff9500]">ISA-95</span> UNS
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Walker Reynolds&apos; pattern: Enterprise &rarr; Site &rarr; Area &rarr; WorkCenter &rarr; Cell &rarr; Equipment.
            ERP at site level, QMS/TMS at area level, BDE/Process under equipment.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Enrichment</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Bridge validates required fields, adds timestamps, derives KG node label from topic.
            Invalid messages are rejected. Valid ones get MERGE&apos;d into Neo4j.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Neo4j KG</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Each validated message becomes a node update: MERGE by machine ID, SET properties + last_mqtt_update.
            Batched every 2s for performance.
          </div>
        </div>
      </div>
    </div>
  );
}
