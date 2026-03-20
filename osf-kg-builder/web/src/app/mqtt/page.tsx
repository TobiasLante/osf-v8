"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, API_URL } from "@/lib/api";

// ── ISA-95 Mapping ──────────────────────────────────────────────
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

// ── Types ───────────────────────────────────────────────────────
interface ApiMsg { ts: string; topic: string; value: any; }
interface Stats { received: number; validated: number; rejected: number; kgUpdated: number; errors: number; running: boolean; bufferSize: number; }

interface MqttMessage { topic: string; payload: string; ts: number; }
interface TopicNode { name: string; fullTopic: string; value?: string; unit?: string; def?: string; ts?: number; children: Map<string, TopicNode>; }

// ── Payload Parser ──────────────────────────────────────────────
function parsePayloadValue(raw: string): { display: string; unit: string; label: string } | null {
  try {
    const obj = JSON.parse(raw);
    if (obj.Value !== undefined) {
      const val = typeof obj.Value === "number"
        ? (Number.isInteger(obj.Value) ? String(obj.Value) : obj.Value.toFixed(2))
        : String(obj.Value);
      return { display: val, unit: obj.Unit || "", label: obj.Definition || "" };
    }
  } catch {}
  // Plain value
  if (raw && raw !== "undefined") return { display: raw.substring(0, 30), unit: "", label: "" };
  return null;
}

// ── ISA-95 Tree Builder ─────────────────────────────────────────
function buildIsa95Tree(messages: Map<string, MqttMessage>): TopicNode {
  const root: TopicNode = { name: ENTERPRISE, fullTopic: "isa95", children: new Map() };

  function ensure(parent: TopicNode, name: string, prefix: string): TopicNode {
    if (!parent.children.has(name)) {
      parent.children.set(name, { name, fullTopic: prefix + "/" + name, children: new Map() });
    }
    return parent.children.get(name)!;
  }

  for (const [topic, msg] of Array.from(messages.entries())) {
    const parts = topic.split("/");
    if (parts.length < 2) continue;
    const machine = parts[1];
    const order = parts[2] && parts[2] !== "---" ? parts[2] : null;
    const tool = parts[3] && parts[3] !== "---" ? parts[3] : null;
    const category = parts[4] || "Data";
    const variable = parts[5] || null;
    const { area, workCenter, cell } = getMachineMapping(machine);
    const p = "isa95";
    const siteNode = ensure(root, SITE, p);

    let targetNode: TopicNode;
    let targetPath: string;

    if (SITE_LEVEL.has(category)) {
      const catNode = ensure(siteNode, category, p + "/" + SITE);
      targetNode = ensure(catNode, machine, catNode.fullTopic);
      targetPath = targetNode.fullTopic;
    } else if (AREA_LEVEL.has(category)) {
      const areaNode = ensure(siteNode, area, p + "/" + SITE);
      const catNode = ensure(areaNode, category, areaNode.fullTopic);
      targetNode = ensure(catNode, machine, catNode.fullTopic);
      targetPath = targetNode.fullTopic;
    } else {
      const areaNode = ensure(siteNode, area, p + "/" + SITE);
      const wcNode = ensure(areaNode, workCenter, p + "/" + SITE + "/" + area);
      const cellNode = ensure(wcNode, cell, p + "/" + SITE + "/" + area + "/" + workCenter);
      const machineNode = ensure(cellNode, machine, p + "/" + SITE + "/" + area + "/" + workCenter + "/" + cell);
      const catNode = ensure(machineNode, category, machineNode.fullTopic);
      targetNode = catNode;
      targetPath = catNode.fullTopic;
    }

    if (order) {
      const orderNode = ensure(targetNode, order, targetPath);
      if (tool) {
        const toolNode = ensure(orderNode, tool, orderNode.fullTopic);
        if (variable) { const vn = ensure(toolNode, variable, toolNode.fullTopic); vn.value = msg.payload; vn.ts = msg.ts; }
        else { toolNode.value = msg.payload; toolNode.ts = msg.ts; }
      } else if (variable) { const vn = ensure(orderNode, variable, orderNode.fullTopic); vn.value = msg.payload; vn.ts = msg.ts; }
      else { orderNode.value = msg.payload; orderNode.ts = msg.ts; }
    } else if (variable) { const vn = ensure(targetNode, variable, targetPath); vn.value = msg.payload; vn.ts = msg.ts; }
    else { targetNode.value = msg.payload; targetNode.ts = msg.ts; }
  }
  return root;
}

function maxDepth(node: TopicNode, d = 0): number {
  if (node.children.size === 0) return d;
  let mx = d;
  for (const ch of Array.from(node.children.values())) mx = Math.max(mx, maxDepth(ch, d + 1));
  return mx;
}

// ── Tree Node Component (identical to openshopfloor /uns) ───────
function TopicTreeNode({ node, depth = 0, expandedSet, onToggle }: {
  node: TopicNode; depth?: number; expandedSet: Set<string>; onToggle: (t: string) => void;
}) {
  const hasChildren = node.children.size > 0;
  const expanded = expandedSet.has(node.fullTopic);
  const age = node.ts ? Math.floor((Date.now() - node.ts) / 1000) : null;
  const fresh = age !== null && age < 5;
  const parsed = node.value ? parsePayloadValue(node.value) : null;

  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <div
        className={`flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-[var(--surface-3)] rounded px-1 ${fresh ? "bg-emerald-500/5" : ""}`}
        onClick={() => hasChildren ? onToggle(node.fullTopic) : onToggle(node.fullTopic + "::detail")}
      >
        {hasChildren ? (
          <span className="text-[var(--text-dim)] text-xs w-3 text-center select-none">{expanded ? "\u25BC" : "\u25B6"}</span>
        ) : (
          <span className="w-3 text-center text-[var(--text-dim)] text-xs select-none">&middot;</span>
        )}
        <span className={`text-[11px] font-mono ${!hasChildren ? "text-[#ff9500]" : "text-[var(--text)]"}`}>{node.name}</span>
        {parsed && (
          <span className="text-[11px] ml-1 truncate">
            <span className={`font-mono font-semibold ${fresh ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>{parsed.display}</span>
            {parsed.unit && <span className="text-[var(--text-dim)] ml-1">{parsed.unit}</span>}
          </span>
        )}
        {!parsed && node.value && !hasChildren && (
          <span className="text-[11px] text-[var(--text-dim)] ml-1 truncate max-w-[120px] font-mono">{node.value.slice(0, 60)}</span>
        )}
        {hasChildren && <span className="text-[10px] text-[var(--text-dim)] ml-0.5">({node.children.size})</span>}
        {age !== null && <span className="text-[10px] text-[var(--text-dim)] ml-auto shrink-0">{age}s</span>}
      </div>
      {!hasChildren && node.value && expandedSet.has(node.fullTopic + "::detail") && (
        <pre className="text-[10px] text-[var(--text-muted)] font-mono ml-6 p-2 bg-[var(--surface-2)] rounded mb-1 max-h-40 overflow-auto whitespace-pre-wrap">
          {(() => { try { return JSON.stringify(JSON.parse(node.value!), null, 2); } catch { return node.value; } })()}
        </pre>
      )}
      {expanded && Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
        <TopicTreeNode key={child.fullTopic} node={child} depth={depth + 1} expandedSet={expandedSet} onToggle={onToggle} />
      ))}
    </div>
  );
}

// ── Convert API messages to Map ─────────────────────────────────
function toMap(msgs: ApiMsg[]): Map<string, MqttMessage> {
  const map = new Map<string, MqttMessage>();
  for (const m of msgs) {
    const payload = typeof m.value === "object" ? JSON.stringify(m.value) : String(m.value);
    map.set(m.topic, { topic: m.topic, payload, ts: new Date(m.ts).getTime() });
  }
  return map;
}

// ── Main Page ───────────────────────────────────────────────────
export default function MqttPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rawMap, setRawMap] = useState<Map<string, MqttMessage>>(new Map());
  const [enrichedMap, setEnrichedMap] = useState<Map<string, MqttMessage>>(new Map());
  const [error, setError] = useState("");
  const [rawExp, setRawExp] = useState<Set<string>>(() => new Set(["isa95"]));
  const [enrExp, setEnrExp] = useState<Set<string>>(() => new Set(["isa95"]));

  // Poll every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const [s, m] = await Promise.all([
          apiFetch<Stats>("/api/kg/mqtt/status"),
          apiFetch<{ raw: ApiMsg[]; enriched: ApiMsg[] }>("/api/kg/mqtt/messages"),
        ]);
        setStats(s);
        setRawMap(toMap(m.raw));
        setEnrichedMap(toMap(m.enriched));
        setError("");
      } catch (e: any) { setError(e.message); }
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, []);

  // Auto-expand
  useEffect(() => {
    const autoExpand = (prev: Set<string>) => {
      const n = new Set(prev); n.add("isa95"); n.add("isa95/" + SITE);
      n.add("isa95/" + SITE + "/Fertigung"); n.add("isa95/" + SITE + "/Montage");
      return n;
    };
    if (rawMap.size > 0) setRawExp(autoExpand);
    if (enrichedMap.size > 0) setEnrExp(autoExpand);
  }, [rawMap.size, enrichedMap.size]);

  const toggleRaw = useCallback((t: string) => { setRawExp(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; }); }, []);
  const toggleEnr = useCallback((t: string) => { setEnrExp(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; }); }, []);

  const rawTree = buildIsa95Tree(rawMap);
  const enrTree = buildIsa95Tree(enrichedMap);
  const rawTopics = rawMap.size;
  const enrTopics = enrichedMap.size;
  const enrDepth = maxDepth(enrTree);

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-1">
          MQTT Bridge{" "}
          <span className="bg-gradient-to-r from-[#ff9500] to-[#ff5722] bg-clip-text text-transparent">UNS</span>
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Raw MQTT from broker &rarr; Validate &rarr; Enrich &rarr; Neo4j KG. Both sides in ISA-95 Unified Namespace.
        </p>
      </div>

      {/* Status + Flow */}
      <div className="flex items-center gap-3 mb-4">
        <span className={`w-2 h-2 rounded-full ${stats?.running ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
        <span className="text-xs text-[var(--text-muted)]">{stats?.running ? "Connected" : "Disconnected"}</span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.received?.toLocaleString() ?? 0} received</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.validated?.toLocaleString() ?? 0} validated</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.rejected?.toLocaleString() ?? 0} rejected</span>
        <span className="text-xs text-[var(--text-dim)]">{stats?.kgUpdated?.toLocaleString() ?? 0} KG writes</span>
      </div>

      {/* Flow Diagram */}
      <div className="flex items-center justify-between gap-2 text-center mb-4">
        <FlowBox label="Raw Broker" detail={`${stats?.received?.toLocaleString() ?? "..."}`} status={stats?.running ? "ok" : "off"} />
        <Arrow />
        <FlowBox label="Validate" detail={`${stats?.validated?.toLocaleString() ?? "..."} ok`} status={stats?.running ? "ok" : "off"} />
        <Arrow />
        <FlowBox label="Enrich" detail={`${stats?.rejected?.toLocaleString() ?? "..."} rej`} status={stats?.running ? "ok" : "off"} />
        <Arrow />
        <FlowBox label="Neo4j KG" detail={`${stats?.kgUpdated?.toLocaleString() ?? "..."} nodes`} status={(stats?.kgUpdated ?? 0) > 0 ? "ok" : "off"} />
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
              Raw MQTT from Factory/# before validation. ISA-95 hierarchy: Enterprise &rarr; Site &rarr; Area &rarr; WorkCenter &rarr; Cell &rarr; Equipment.
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-[var(--text-dim)]"><span className="text-emerald-400">Live</span> &middot; {rawTopics} Topics</span>
            </div>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
            {rawTopics === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">{stats?.running ? "Waiting for messages..." : "Connecting..."}</div>
            ) : (
              <TopicTreeNode node={rawTree} depth={0} expandedSet={rawExp} onToggle={toggleRaw} />
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
              Validated &amp; enriched. Written to Neo4j KG via MERGE. Same ISA-95 structure, same data after processing.
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-[var(--text-dim)]"><span className="text-blue-400">KG</span> &middot; {enrTopics} Topics</span>
              {enrDepth > 0 && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">+{enrDepth} levels deep</span>}
            </div>
          </div>
          <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
            {enrTopics === 0 ? (
              <div className="flex items-center justify-center h-48 text-[var(--text-dim)] text-sm">No enriched data yet — appears after validation.</div>
            ) : (
              <TopicTreeNode node={enrTree} depth={0} expandedSet={enrExp} onToggle={toggleEnr} />
            )}
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Raw MQTT</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Messages direct from Factory/# topic. Unvalidated, unfiltered. This is what the broker sees.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1"><span className="text-[#ff9500]">ISA-95</span> UNS</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Walker Reynolds&apos; pattern: Enterprise &rarr; Site &rarr; Area &rarr; WorkCenter &rarr; Cell &rarr; Equipment.
            ERP at site level, QMS/TMS at area level, BDE/Process under equipment.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Enrichment</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Bridge validates fields, adds timestamps, derives KG label from topic. Invalid rejected. Valid → Neo4j MERGE.
          </div>
        </div>
        <div className="p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="text-xs font-semibold text-[var(--text)] mb-1">Neo4j KG</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Each message → MERGE by machine ID, SET properties + last_mqtt_update. Batched every 2s.
          </div>
        </div>
      </div>

      {/* Data Categories */}
      <div className="mt-4 p-4 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="text-xs font-semibold text-[var(--text)] mb-2">Data Categories in UNS</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div><div className="text-[11px] font-mono text-[#ff9500]">ProcessData</div><div className="text-[10px] text-[var(--text-dim)]">OEE, cycle times, temperatures, pressures, speeds</div></div>
          <div><div className="text-[11px] font-mono text-[#ff9500]">BDE</div><div className="text-[10px] text-[var(--text-dim)]">Betriebsdaten: quantities, scrap, rework, cycles</div></div>
          <div><div className="text-[11px] font-mono text-[#ff9500]">ERP</div><div className="text-[10px] text-[var(--text-dim)]">Orders, BOMs, materials, scheduling</div></div>
          <div><div className="text-[11px] font-mono text-[#ff9500]">QMS</div><div className="text-[10px] text-[var(--text-dim)]">Quality inspections, SPC, defect tracking</div></div>
          <div><div className="text-[11px] font-mono text-[#ff9500]">TMS</div><div className="text-[10px] text-[var(--text-dim)]">Tool life, tool changes, wear tracking</div></div>
        </div>
      </div>
    </div>
  );
}

function FlowBox({ label, detail, status }: { label: string; detail: string; status: "ok" | "off" }) {
  return (
    <div className={`rounded-md border px-3 py-2 flex-1 ${status === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
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
