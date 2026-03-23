"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";

// ── ISA-95 Hierarchy — loaded from Neo4j Knowledge Graph ────────────
// Fallback prefixes used only when KG is unavailable
const FALLBACK_MAP: Record<string, { area: string; workCenter: string; cell: string }> = {
  "CNC-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "CNC" },
  "DRH-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Drehen" },
  "FRS-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Fraesen" },
  "SGF-":     { area: "Fertigung", workCenter: "MechBearbeitung", cell: "Schleifen" },
  "SGM-":     { area: "Fertigung", workCenter: "Spritzguss",      cell: "SGM" },
  "ML-":      { area: "Montage",   workCenter: "Endmontage",      cell: "Linie" },
  "Montage-": { area: "Montage",   workCenter: "Endmontage",      cell: "Linie" },
};

interface HierarchyEntry {
  machine: string;
  labels: string[];
  site: string;
  area: string;
  workCenter: string;
  cell: string;
}

interface MachineContext {
  orders: Array<{
    id: string; name: string; due_date: string;
    quantity: number; status: string;
    materials: Array<{ id: string; name: string; stock: number }>;
  }>;
  customer: { id: string; name: string } | null;
}

const ENTERPRISE = "OSF";

// Categories that belong at Site or Area level (not under equipment)
const SITE_LEVEL_CATEGORIES = new Set(["ERP"]);
const AREA_LEVEL_CATEGORIES = new Set(["QMS", "TMS", "WMS"]);

function getMachineMapping(
  machine: string,
  hierarchy: Record<string, HierarchyEntry> | null,
): { area: string; workCenter: string; cell: string; site: string } {
  // Phase 1: Use KG hierarchy if available
  if (hierarchy && hierarchy[machine]) {
    const h = hierarchy[machine];
    return { site: h.site, area: h.area, workCenter: h.workCenter, cell: h.cell };
  }
  // Fallback: prefix matching
  for (const [prefix, mapping] of Object.entries(FALLBACK_MAP)) {
    if (machine.startsWith(prefix)) return { ...mapping, site: "Werk-Sued" };
  }
  return { area: "Sonstige", workCenter: "Sonstige", cell: "Sonstige", site: "Werk-Sued" };
}

// ── Types ───────────────────────────────────────────────────────────
interface MqttMessage {
  topic: string;
  payload: string;
  ts: number;
}

interface TopicNode {
  name: string;
  fullTopic: string;
  value?: string;
  ts?: number;
  children: Map<string, TopicNode>;
}

// ── Tree Builders ───────────────────────────────────────────────────

/** Flat MQTT tree — topics as-is */
function buildFlatTree(messages: Map<string, MqttMessage>): TopicNode {
  const root: TopicNode = { name: "Factory", fullTopic: "", children: new Map() };
  for (const [topic, msg] of Array.from(messages.entries())) {
    const parts = topic.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          fullTopic: parts.slice(0, i + 1).join("/"),
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
    }
    node.value = msg.payload;
    node.ts = msg.ts;
  }
  return root;
}

/** ISA-95 tree — remap Factory/{Machine}/{Order}/{Tool}/{Category}/{Var}
 *  → Enterprise/Site/Area/WorkCenter/Cell/Machine/Category/Var
 *  Orders and tools become metadata under the equipment node.
 *  Hierarchy from Neo4j KG (schema-driven), context from ERP data. */
function buildIsa95Tree(
  messages: Map<string, MqttMessage>,
  hierarchy: Record<string, HierarchyEntry> | null,
  context: Record<string, MachineContext> | null,
): TopicNode {
  const root: TopicNode = { name: ENTERPRISE, fullTopic: "isa95", children: new Map() };

  function ensureNode(parent: TopicNode, name: string, prefix: string): TopicNode {
    if (!parent.children.has(name)) {
      parent.children.set(name, { name, fullTopic: prefix + "/" + name, children: new Map() });
    }
    return parent.children.get(name)!;
  }

  // Track which machines we've seen (for injecting ERP context later)
  const seenMachines = new Set<string>();

  for (const [topic, msg] of Array.from(messages.entries())) {
    const parts = topic.split("/");
    if (parts.length < 2) continue;

    const machine = parts[1];
    const order = parts[2] && parts[2] !== "---" ? parts[2] : null;
    const tool = parts[3] && parts[3] !== "---" ? parts[3] : null;
    const category = parts[4] || "Data";
    const variable = parts[5] || null;

    const { site, area, workCenter, cell } = getMachineMapping(machine, hierarchy);
    seenMachines.add(machine);

    const p = "isa95";
    const siteNode = ensureNode(root, site, p);

    let targetNode: TopicNode;
    let targetPath: string;

    if (SITE_LEVEL_CATEGORIES.has(category)) {
      const catNode = ensureNode(siteNode, category, p + "/" + site);
      targetNode = catNode;
      targetPath = catNode.fullTopic;
      const machCtx = ensureNode(targetNode, machine, targetPath);
      targetNode = machCtx;
      targetPath = machCtx.fullTopic;
    } else if (AREA_LEVEL_CATEGORIES.has(category)) {
      const areaNode = ensureNode(siteNode, area, p + "/" + site);
      const catNode = ensureNode(areaNode, category, areaNode.fullTopic);
      const machCtx = ensureNode(catNode, machine, catNode.fullTopic);
      targetNode = machCtx;
      targetPath = machCtx.fullTopic;
    } else {
      const areaNode = ensureNode(siteNode, area, p + "/" + site);
      const wcNode = ensureNode(areaNode, workCenter, p + "/" + site + "/" + area);
      const cellNode = ensureNode(wcNode, cell, p + "/" + site + "/" + area + "/" + workCenter);
      const machineNode = ensureNode(cellNode, machine, p + "/" + site + "/" + area + "/" + workCenter + "/" + cell);
      const catNode = ensureNode(machineNode, category, machineNode.fullTopic);
      targetNode = catNode;
      targetPath = catNode.fullTopic;
    }

    if (order) {
      const orderNode = ensureNode(targetNode, order, targetPath);
      if (tool) {
        const toolNode = ensureNode(orderNode, tool, orderNode.fullTopic);
        if (variable) {
          const varNode = ensureNode(toolNode, variable, toolNode.fullTopic);
          varNode.value = msg.payload;
          varNode.ts = msg.ts;
        } else {
          toolNode.value = msg.payload;
          toolNode.ts = msg.ts;
        }
      } else if (variable) {
        const varNode = ensureNode(orderNode, variable, orderNode.fullTopic);
        varNode.value = msg.payload;
        varNode.ts = msg.ts;
      } else {
        orderNode.value = msg.payload;
        orderNode.ts = msg.ts;
      }
    } else if (variable) {
      const varNode = ensureNode(targetNode, variable, targetPath);
      varNode.value = msg.payload;
      varNode.ts = msg.ts;
    } else {
      targetNode.value = msg.payload;
      targetNode.ts = msg.ts;
    }
  }

  // Phase 2: Inject ERP context as virtual topics under each machine
  if (context) {
    for (const machine of Array.from(seenMachines)) {
      const ctx = context[machine];
      if (!ctx) continue;

      const { site, area, workCenter, cell } = getMachineMapping(machine, hierarchy);
      const p = "isa95";
      const siteNode = ensureNode(root, site, p);
      const areaNode = ensureNode(siteNode, area, p + "/" + site);
      const wcNode = ensureNode(areaNode, workCenter, p + "/" + site + "/" + area);
      const cellNode = ensureNode(wcNode, cell, p + "/" + site + "/" + area + "/" + workCenter);
      const machineNode = ensureNode(cellNode, machine, p + "/" + site + "/" + area + "/" + workCenter + "/" + cell);
      const erpNode = ensureNode(machineNode, "ERP-Context", machineNode.fullTopic);

      if (ctx.customer) {
        const custNode = ensureNode(erpNode, "Customer", erpNode.fullTopic);
        custNode.value = JSON.stringify({ Value: ctx.customer.name, Unit: "", Definition: "Current customer" });
        custNode.ts = Date.now();
      }

      for (const order of ctx.orders.slice(0, 3)) {
        const orderNode = ensureNode(erpNode, order.id || order.name, erpNode.fullTopic);
        if (order.due_date) {
          const dueNode = ensureNode(orderNode, "DueDate", orderNode.fullTopic);
          dueNode.value = JSON.stringify({ Value: order.due_date, Unit: "", Definition: "Liefertermin" });
          dueNode.ts = Date.now();
        }
        if (order.quantity) {
          const qtyNode = ensureNode(orderNode, "Quantity", orderNode.fullTopic);
          qtyNode.value = JSON.stringify({ Value: order.quantity, Unit: "pcs", Definition: "Auftragsmenge" });
          qtyNode.ts = Date.now();
        }
        if (order.status) {
          const statusNode = ensureNode(orderNode, "Status", orderNode.fullTopic);
          statusNode.value = JSON.stringify({ Value: order.status, Unit: "", Definition: "Auftragsstatus" });
          statusNode.ts = Date.now();
        }
      }
    }
  }

  return root;
}

function maxDepth(node: TopicNode, d = 0): number {
  if (node.children.size === 0) return d;
  let mx = d;
  for (const child of Array.from(node.children.values())) {
    mx = Math.max(mx, maxDepth(child, d + 1));
  }
  return mx;
}

// ── Payload Parser ──────────────────────────────────────────────────
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
  return null;
}

// ── Tree Node Component ─────────────────────────────────────────────
function TopicTreeNode({
  node,
  depth = 0,
  expandedSet,
  onToggle,
}: {
  node: TopicNode;
  depth?: number;
  expandedSet: Set<string>;
  onToggle: (topic: string) => void;
}) {
  const hasChildren = node.children.size > 0;
  const expanded = expandedSet.has(node.fullTopic);
  const age = node.ts ? Math.floor((Date.now() - node.ts) / 1000) : null;
  const fresh = age !== null && age < 5;
  const parsed = node.value ? parsePayloadValue(node.value) : null;

  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <div
        className={`flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-bg-surface-2 rounded px-1 ${fresh ? "bg-accent/5" : ""}`}
        onClick={() => hasChildren ? onToggle(node.fullTopic) : onToggle(node.fullTopic + "::detail")}
      >
        {hasChildren ? (
          <span className="text-text-dim text-xs w-3 text-center select-none">{expanded ? "\u25BC" : "\u25B6"}</span>
        ) : (
          <span className="w-3 text-center text-text-dim text-xs select-none">&middot;</span>
        )}
        <span className={`text-[11px] font-mono ${!hasChildren ? "text-accent" : "text-text"}`}>
          {node.name}
        </span>
        {parsed && (
          <span className="text-[11px] ml-1 truncate">
            <span className={`font-mono font-semibold ${fresh ? "text-emerald-400" : "text-text-muted"}`}>
              {parsed.display}
            </span>
            {parsed.unit && <span className="text-text-dim ml-1">{parsed.unit}</span>}
          </span>
        )}
        {!parsed && node.value && !hasChildren && (
          <span className="text-[11px] text-text-dim ml-1 truncate max-w-[120px] font-mono">{node.value.slice(0, 60)}</span>
        )}
        {hasChildren && (
          <span className="text-[10px] text-text-dim ml-0.5">({node.children.size})</span>
        )}
        {age !== null && (
          <span className="text-[10px] text-text-dim ml-auto shrink-0">{age}s</span>
        )}
      </div>
      {!hasChildren && node.value && expandedSet.has(node.fullTopic + "::detail") && (
        <pre className="text-[10px] text-text-muted font-mono ml-6 p-2 bg-bg-surface-2 rounded mb-1 max-h-40 overflow-auto whitespace-pre-wrap">
          {(() => { try { return JSON.stringify(JSON.parse(node.value), null, 2); } catch { return node.value; } })()}
        </pre>
      )}
      {expanded &&
        Array.from(node.children.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <TopicTreeNode
              key={child.fullTopic}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              onToggle={onToggle}
            />
          ))}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────
export default function UnsPage() {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [displayMessages, setDisplayMessages] = useState<Map<string, MqttMessage>>(new Map());
  const [msgCount, setMsgCount] = useState(0);
  const [flatExpanded, setFlatExpanded] = useState<Set<string>>(() => new Set(["Factory"]));
  const [isaExpanded, setIsaExpanded] = useState<Set<string>>(() => new Set(["isa95"]));
  const eventSourceRef = useRef<EventSource | null>(null);
  const bufferRef = useRef<Map<string, MqttMessage>>(new Map());
  const msgCountRef = useRef(0);

  // Phase 1+2: Schema-driven hierarchy + ERP context from KG
  const [hierarchy, setHierarchy] = useState<Record<string, HierarchyEntry> | null>(null);
  const [context, setContext] = useState<Record<string, MachineContext> | null>(null);
  const [hierarchySource, setHierarchySource] = useState<"loading" | "neo4j" | "fallback">("loading");

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  // Fetch hierarchy + context from KG on load
  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${API_BASE}/uns/hierarchy`, { headers, signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => {
        setHierarchy(data.machines || {});
        setHierarchySource("neo4j");
      })
      .catch(() => {
        setHierarchySource("fallback");
      });

    fetch(`${API_BASE}/uns/context`, { headers, signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => setContext(data.machines || {}))
      .catch(() => {});
  }, [token]);

  const onToggleFlat = useCallback((topic: string) => {
    setFlatExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) { next.delete(topic); } else { next.add(topic); }
      return next;
    });
  }, []);

  const onToggleIsa = useCallback((topic: string) => {
    setIsaExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) { next.delete(topic); } else { next.add(topic); }
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    setConnected(false);
    bufferRef.current = new Map();
    msgCountRef.current = 0;
    setDisplayMessages(new Map());
    setMsgCount(0);

    const es = new EventSource(
      `${API_BASE}/uns/stream?filter=${encodeURIComponent("Factory/#")}&token=${encodeURIComponent(token!)}`
    );
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "connected") { setConnected(true); return; }
        bufferRef.current.set(data.topic, data);
        msgCountRef.current++;
      } catch {}
    };
    es.onerror = () => setConnected(false);
    return () => { es.close(); };
  }, [token]);

  // Batch UI updates every 2s
  useEffect(() => {
    const iv = setInterval(() => {
      if (bufferRef.current.size > 0) {
        setDisplayMessages(new Map(bufferRef.current));
        setMsgCount(msgCountRef.current);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!loading && token) {
      const cleanup = connect();
      return cleanup;
    }
  }, [loading, token, connect]);

  // Auto-expand first 2 levels on both trees
  useEffect(() => {
    if (displayMessages.size > 0) {
      setFlatExpanded((prev) => {
        const next = new Set(prev);
        for (const topic of Array.from(displayMessages.keys())) {
          const p = topic.split("/");
          if (p.length >= 1) next.add(p[0]);
          if (p.length >= 2) next.add(p.slice(0, 2).join("/"));
        }
        return next;
      });
      setIsaExpanded((prev) => {
        const next = new Set(prev);
        next.add("isa95");
        // Auto-expand all unique sites from hierarchy
        const sites = new Set<string>();
        if (hierarchy) {
          for (const h of Object.values(hierarchy)) sites.add(h.site);
        }
        if (sites.size === 0) sites.add("Werk-Sued"); // fallback
        for (const site of Array.from(sites)) {
          next.add("isa95/" + site);
          next.add("isa95/" + site + "/Fertigung");
          next.add("isa95/" + site + "/Montage");
        }
        return next;
      });
    }
  }, [displayMessages, hierarchy]);

  if (loading || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  const flatTree = buildFlatTree(displayMessages);
  const isaTree = buildIsa95Tree(displayMessages, hierarchy, context);
  const topicCount = displayMessages.size;
  const isaDepth = maxDepth(isaTree);

  return (
    <div className="min-h-screen bg-bg relative">
      <BackgroundOrbs />
      <div className="relative z-10 max-w-[1600px] mx-auto px-4 pt-8 pb-16">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold mb-1">
            OpenShopFloor{" "}
            <span className="bg-accent-gradient bg-clip-text text-transparent">UNS</span>
          </h1>
          <p className="text-sm text-text-muted">
            Same factory, same data, two perspectives. Left: flat MQTT topics as most teams start.
            Right: ISA-95 Unified Namespace (Walker Reynolds) &mdash; the real-world complexity
            of a properly structured industrial data architecture.
          </p>
        </div>

        {/* Status Bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <span className="text-xs text-text-muted">
              {connected ? "Connected to MQTT broker" : "Connecting..."}
            </span>
          </div>
          <span className="text-border">|</span>
          <span className="text-xs text-text-dim">{msgCount} messages received</span>
          <span className="text-xs text-text-dim">{topicCount} active topics</span>
        </div>

        {/* Two-Panel Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Left: Flat MQTT */}
          <div className="rounded-md border border-border bg-bg-surface flex flex-col">
            <div className="px-4 pt-3 pb-2 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-text-dim/20 text-text-muted px-1.5 py-0.5 rounded">simple</span>
                <h2 className="text-sm font-bold text-text">#shared.UNS</h2>
              </div>
              <p className="text-[11px] text-text-dim">
                How most teams start. Simple, fast to implement. No enterprise context.
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-text-dim">
                  <span className="text-emerald-400">Live</span> &middot; {topicCount} Topics
                </span>
              </div>
            </div>
            <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
              {topicCount === 0 ? (
                <div className="flex items-center justify-center h-48 text-text-dim text-sm">
                  {!connected ? "Connecting to MQTT broker..." : "Waiting for messages..."}
                </div>
              ) : (
                Array.from(flatTree.children.values())
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((child) => (
                    <TopicTreeNode key={child.fullTopic} node={child} depth={0} expandedSet={flatExpanded} onToggle={onToggleFlat} />
                  ))
              )}
            </div>
          </div>

          {/* Right: ISA-95 */}
          <div className="rounded-md border border-border bg-bg-surface flex flex-col">
            <div className="px-4 pt-3 pb-2 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-accent/20 text-accent px-1.5 py-0.5 rounded">ISA-95</span>
                <h2 className="text-sm font-bold text-text">Unified Namespace</h2>
                {hierarchySource === "neo4j" && (
                  <span className="text-[9px] font-mono bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded" title="Hierarchy loaded from Neo4j Knowledge Graph (git-driven)">KG-driven</span>
                )}
                {hierarchySource === "fallback" && (
                  <span className="text-[9px] font-mono bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded" title="KG unavailable, using prefix fallback">fallback</span>
                )}
              </div>
              <p className="text-[11px] text-text-dim">
                Walker Reynolds&apos; UNS pattern. Hierarchy from Knowledge Graph — push a schema change to Git, tree updates live.
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-text-dim">
                  <span className="text-emerald-400">Live</span> &middot; {topicCount} Topics
                </span>
                {isaDepth > 0 && (
                  <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">+{isaDepth} levels deep</span>
                )}
              </div>
            </div>
            <div className="p-3 min-h-[400px] max-h-[calc(100vh-380px)] overflow-auto">
              {topicCount === 0 ? (
                <div className="flex items-center justify-center h-48 text-text-dim text-sm">
                  {!connected ? "Connecting to MQTT broker..." : "Waiting for messages..."}
                </div>
              ) : (
                <TopicTreeNode node={isaTree} depth={0} expandedSet={isaExpanded} onToggle={onToggleIsa} />
              )}
            </div>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">Flat MQTT</div>
            <div className="text-[11px] text-text-muted">
              6 levels deep. Machine-centric. Fast to set up, but no
              context about where machines are, which site, which
              production area.
            </div>
          </div>
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">
              <span className="text-accent">ISA-95</span> UNS {hierarchySource === "neo4j" && <span className="text-emerald-400 text-[10px] ml-1">(Git-driven)</span>}
            </div>
            <div className="text-[11px] text-text-muted">
              Walker Reynolds&apos; pattern: Enterprise &rarr; Site &rarr; Area &rarr; WorkCenter &rarr; Cell &rarr; Equipment.
              {hierarchySource === "neo4j"
                ? " Hierarchy loaded from Knowledge Graph. Push a schema change to GitHub — tree restructures automatically."
                : " ERP at site level, QMS/TMS at area level, BDE/Process under equipment."}
            </div>
          </div>
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">Data Placement</div>
            <div className="text-[11px] text-text-muted">
              ERP (orders, BOMs) &rarr; site level. QMS (quality), TMS (tooling), WMS (warehouse) &rarr; area level.
              BDE, ProcessData &rarr; equipment level. Data lives where it&apos;s relevant.
            </div>
          </div>
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">AI + UNS</div>
            <div className="text-[11px] text-text-muted">
              8 MCP tools let AI agents query, subscribe, and act on live
              UNS data. The structured namespace helps agents
              understand factory topology.
            </div>
          </div>
        </div>

        {/* Data Categories Legend */}
        <div className="mt-4 p-4 rounded-md border border-border bg-bg-surface">
          <div className="text-xs font-semibold text-text mb-2">Data Categories in UNS</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <div className="text-[11px] font-mono text-accent">ProcessData</div>
              <div className="text-[10px] text-text-dim">OEE, cycle times, temperatures, pressures, speeds</div>
            </div>
            <div>
              <div className="text-[11px] font-mono text-accent">BDE</div>
              <div className="text-[10px] text-text-dim">Betriebsdaten: quantities, scrap, rework, cycles</div>
            </div>
            <div>
              <div className="text-[11px] font-mono text-accent">ERP</div>
              <div className="text-[10px] text-text-dim">Orders, BOMs, materials, scheduling from SAP/ERP</div>
            </div>
            <div>
              <div className="text-[11px] font-mono text-accent">QMS</div>
              <div className="text-[10px] text-text-dim">Quality inspections, SPC, defect tracking, CAPA</div>
            </div>
            <div>
              <div className="text-[11px] font-mono text-accent">TMS</div>
              <div className="text-[10px] text-text-dim">Tool life, tool changes, wear tracking, inventory</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
