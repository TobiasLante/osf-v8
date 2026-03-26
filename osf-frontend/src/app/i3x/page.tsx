"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface I3xObjectType { elementId: string; displayName: string; parentTypeId?: string; }
interface I3xObject { elementId: string; displayName: string; typeId?: string; properties?: Record<string, any>; }
interface KPI { kpiId: string; name: string; value: number; unit: string; status?: string; target?: number; warning?: number; critical?: number; }
interface GraphNode { id: string; name: string; type: string; color: string; val: number; }
interface GraphLink { source: string; target: string; label: string; }

const TYPE_COLORS: Record<string, string> = {
  InjectionMoldingMachine: "#ff9500", CNC_Machine: "#3b82f6", Lathe: "#3b82f6",
  MillingMachine: "#3b82f6", GrindingMachine: "#3b82f6", FiveAxisMillingMachine: "#3b82f6",
  FFS_Cell: "#8b5cf6", AssemblyLine: "#06b6d4", Machine: "#ff9500",
  Article: "#10b981", ProductionOrder: "#eab308", CustomerOrder: "#f59e0b",
  Customer: "#ec4899", Supplier: "#14b8a6", Site: "#6366f1", Area: "#8b5cf6",
  ProductionLine: "#a855f7", KPI: "#ef4444", Sensor: "#64748b",
  MaintenanceOrder: "#f97316", Mould: "#d946ef", CNCProgram: "#84cc16",
};
function getColor(type: string) { return TYPE_COLORS[type] || "#64748b"; }

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/i3x${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Page                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function I3xPage() {
  const [types, setTypes] = useState<I3xObjectType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [objects, setObjects] = useState<I3xObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<I3xObject | null>(null);
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "graph" | "api">("overview");
  const [liveMachines, setLiveMachines] = useState<I3xObject[]>([]);
  const graphRef = useRef<any>(null);

  // Poll live machine data every 10s for the Architecture tab ticker
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const machines = await apiFetch<I3xObject[]>("/objects?typeId=type:InjectionMoldingMachine&limit=6");
        if (active) setLiveMachines(machines);
      } catch {}
    }
    poll();
    const iv = setInterval(poll, 10000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  // Load types + build overview graph on mount
  useEffect(() => {
    apiFetch<I3xObjectType[]>("/objecttypes")
      .then(t => {
        setTypes(t);
        buildOverviewGraph(t);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Overview graph: each type = node, relationship types = edges
  async function buildOverviewGraph(typeList: I3xObjectType[]) {
    const nodes: GraphNode[] = typeList.map(t => {
      const name = t.elementId.replace("type:", "");
      return { id: name, name: t.displayName, type: name, color: getColor(name), val: t.parentTypeId ? 4 : 8 };
    });
    // Add parent→child links from type hierarchy
    const links: GraphLink[] = [];
    for (const t of typeList) {
      if (t.parentTypeId) {
        const parent = t.parentTypeId.replace("type:", "");
        const child = t.elementId.replace("type:", "");
        links.push({ source: parent, target: child, label: "PARENT_OF" });
      }
    }
    // Fetch relationship types and add as edges between type nodes
    try {
      const rels = await apiFetch<any[]>("/relationshiptypes");
      // We don't know which types are connected — skip for now, hierarchy is enough
    } catch {}
    setGraphData({ nodes, links });
    setTimeout(() => { graphRef.current?.zoomToFit(400, 60); }, 500);
  }

  useEffect(() => {
    if (!selectedType) return;
    setObjects([]); setSelectedObject(null); setKpis([]);
    apiFetch<I3xObject[]>(`/objects?typeId=${encodeURIComponent(selectedType)}&limit=100`).then(setObjects).catch(() => {});
  }, [selectedType]);

  useEffect(() => {
    if (!selectedObject) { setKpis([]); return; }
    apiFetch<KPI[]>(`/objects/${encodeURIComponent(selectedObject.elementId)}/kpis`).then(setKpis).catch(() => setKpis([]));
  }, [selectedObject]);

  const buildGraph = useCallback(async () => {
    if (objects.length === 0) {
      // No type selected — show overview if we have types
      if (types.length > 0 && !selectedType) buildOverviewGraph(types);
      return;
    }
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const seen = new Set<string>();

    for (const obj of objects.slice(0, 50)) {
      if (seen.has(obj.elementId)) continue;
      seen.add(obj.elementId);
      const type = obj.typeId?.replace("type:", "") || "Unknown";
      nodes.push({ id: obj.elementId, name: obj.displayName || obj.elementId, type, color: getColor(type), val: type.includes("Machine") ? 8 : 4 });
    }

    try {
      const res = await fetch(`${API}/i3x/objects/related`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elementIds: objects.slice(0, 10).map(o => o.elementId) }),
      });
      if (res.ok) {
        const data: any[] = await res.json();
        for (const rel of data) {
          const tid = rel.object?.elementId;
          if (!tid) continue;
          if (!seen.has(tid)) {
            seen.add(tid);
            const type = rel.object?.typeId?.replace("type:", "") || "Unknown";
            nodes.push({ id: tid, name: rel.object?.displayName || tid, type, color: getColor(type), val: 3 });
          }
          if (rel.sourceElementId && tid) links.push({ source: rel.sourceElementId, target: tid, label: rel.relationshipType || "" });
        }
      }
    } catch {}
    setGraphData({ nodes, links });

    // Auto-zoom to fit after graph loads
    setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.zoomToFit(400, 60);
      }
    }, 500);
  }, [objects]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

  return (
    <div className="min-h-screen bg-[var(--bg)] pt-20">
      {/* ═══════════════════════════════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-12">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-text-dim hover:text-accent text-sm">&larr; OpenShopFloor</Link>
        </div>

        <div className="text-center mb-12">
          <div className="flex justify-center gap-3 mb-4">
            <span className="text-[10px] font-bold px-3 py-1 rounded border bg-[#d03a8c]/10 text-[#d03a8c] border-[#d03a8c]/30 tracking-wider">CESMII</span>
            <span className="text-[10px] font-bold px-3 py-1 rounded border bg-accent/10 text-accent border-accent/30 tracking-wider">i3X COMPATIBLE</span>
            <span className="text-[10px] font-bold px-3 py-1 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 tracking-wider">OPEN SOURCE</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            Schema-Driven{" "}
            <span className="bg-gradient-to-r from-[#d03a8c] to-accent bg-clip-text text-transparent">Knowledge Graph</span>
          </h1>
          <p className="text-text-muted max-w-2xl mx-auto text-lg leading-relaxed">
            45 SM Profiles on GitHub. Push JSON, the graph builds itself.
            No LLM, no manual configuration. Live data from MQTT, PostgreSQL, OPC-UA fused into one graph.
          </p>
          <div className="flex justify-center gap-3 mt-6 flex-wrap">
            <a href="https://github.com/TobiasLante/osf-schemas" target="_blank" rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-md bg-accent-gradient text-bg font-semibold text-sm hover:opacity-90 transition-opacity">
              View Schemas on GitHub
            </a>
            <a href={`${API}/i3x/docs`} target="_blank" rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-md border border-accent text-accent font-semibold text-sm hover:bg-accent/10 transition-colors">
              Swagger API Docs
            </a>
          </div>
        </div>

        {/* ── Tab Navigation ─────────────────────────────────────────── */}
        <div className="flex gap-1 mb-8 justify-center">
          {(["overview", "graph", "api"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${tab === t ? "bg-accent/20 text-accent border border-accent/30" : "text-text-dim hover:text-text border border-transparent"}`}>
              {t === "overview" ? "Architecture" : t === "graph" ? "3D Knowledge Graph" : "API Explorer"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-sm text-center">
            API Error: {error}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: ARCHITECTURE OVERVIEW
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="max-w-6xl mx-auto px-6 pb-20">

          {/* 3-Schema System */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
            {[
              { num: "1", title: "WHAT exists", sub: "SM Profiles", desc: "45 type definitions with inheritance. Machine \u2192 CNC, IMM, Lathe. Attributes, relationships, KPIs.", color: "#d03a8c", count: "45 Profiles" },
              { num: "2", title: "WHERE from", sub: "Source Bindings", desc: "65 data source mappings. PostgreSQL tables, OPC-UA endpoints, MCP tools. Column \u2192 attribute mapping.", color: "#3b82f6", count: "65 Sources" },
              { num: "3", title: "HOW it flows", sub: "Sync Configs", desc: "MQTT, Polling, Kafka, Webhook, Manual. Real-time UNS subscriptions. Schema-driven, not code-driven.", color: "#10b981", count: "10 Syncs" },
            ].map(s => (
              <div key={s.num} className="rounded-md border border-border bg-bg-surface p-6 relative overflow-hidden">
                <div className="absolute top-3 right-3 text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface-2 border border-border text-text-dim">{s.count}</div>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mb-3" style={{ backgroundColor: s.color + "20", color: s.color }}>
                  {s.num}
                </div>
                <h3 className="font-bold text-lg mb-1">{s.title}</h3>
                <p className="text-text-dim text-xs font-mono mb-2">{s.sub}</p>
                <p className="text-text-muted text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Live Machine Data Ticker */}
          {liveMachines.length > 0 && (
            <div className="rounded-md border border-accent/20 bg-bg-surface p-5 mb-12">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h3 className="text-sm font-semibold">Live Machine Data</h3>
                <span className="text-[10px] text-text-dim ml-auto">via i3X API &middot; refreshed every 10s</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {liveMachines.map(m => {
                  const p = m.properties || {};
                  const status = p.Machine_Status === 1 ? "Production" : p.Machine_Status === 2 ? "Idle" : p.Machine_Status === 3 ? "Setup" : p.Machine_Status === 4 ? "Maintenance" : p.Machine_Status === 5 ? "Fault" : "Unknown";
                  const statusColor = p.Machine_Status === 1 ? "text-emerald-400" : p.Machine_Status === 5 ? "text-red-400" : "text-amber-400";
                  return (
                    <div key={m.elementId} className="rounded border border-border bg-bg-surface-2 p-3">
                      <div className="text-xs font-mono font-bold text-accent mb-1">{m.elementId}</div>
                      <div className={`text-[10px] font-semibold ${statusColor} mb-2`}>{status}</div>
                      <div className="space-y-1 text-[10px]">
                        {p.Good_Parts != null && <div className="flex justify-between"><span className="text-text-dim">Good Parts</span><span className="text-text font-mono">{Number(p.Good_Parts).toLocaleString()}</span></div>}
                        {p.OEE != null && <div className="flex justify-between"><span className="text-text-dim">OEE</span><span className="text-text font-mono">{(p.OEE * 100).toFixed(1)}%</span></div>}
                        {p.Temp_Melting != null && <div className="flex justify-between"><span className="text-text-dim">Temp</span><span className="text-text font-mono">{Number(p.Temp_Melting).toFixed(1)}&deg;C</span></div>}
                        {p.Energy_kWh != null && <div className="flex justify-between"><span className="text-text-dim">Energy</span><span className="text-text font-mono">{Number(p.Energy_kWh).toFixed(0)} kWh</span></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* OSF vs CESMII */}
          <div className="rounded-md border border-border bg-bg-surface p-6 mb-12">
            <h2 className="text-xl font-bold mb-4">OSF vs. CESMII SMIP</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="py-2 pr-4 text-text-dim font-normal">Capability</th>
                    <th className="py-2 pr-4 font-semibold text-[#d03a8c]">CESMII SMIP</th>
                    <th className="py-2 font-semibold text-accent">OSF i3X</th>
                  </tr>
                </thead>
                <tbody className="text-text-muted">
                  {[
                    ["Type System", "SM Profiles (flat)", "SM Profiles + inheritance + KPI refs"],
                    ["Data Model", "Instance model", "Knowledge Graph (nodes + edges + embeddings)"],
                    ["Data Sources", "Platform-specific connectors", "Schema-driven: PG, OPC-UA, MQTT, Kafka, MCP, REST"],
                    ["Live Sync", "Platform polling", "MQTT UNS + DB Polling + pg-notify + Kafka"],
                    ["Multi-Source Fusion", "One profile = one source", "One profile, N sources (polymorphic edge resolution)"],
                    ["Impact Analysis", "Not available", "Graph traversal: cascade effects, critical paths, alternatives"],
                    ["KPI Calculation", "Manual / external", "Schema-defined, auto-calculated in KG Builder Phase 7"],
                    ["Configuration", "UI-based", "JSON on GitHub \u2014 versioned, reviewable, CI/CD ready"],
                    ["API", "REST on SMIP", "i3X REST on KG + Swagger UI + OpenAPI 3.0"],
                    ["Visualization", "Platform dashboards", "3D Force Graph + KPI overlay"],
                  ].map(([cap, cesmii, osf], i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2.5 pr-4 font-medium text-text">{cap}</td>
                      <td className="py-2.5 pr-4">{cesmii}</td>
                      <td className="py-2.5 text-accent">{osf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Key Differentiators */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            {[
              { icon: "\uD83D\uDD17", title: "Polymorphic Edge Resolution", desc: "targetIdProp: \"machine_id\" resolves to all 8 machine types automatically. Add a new type \u2014 all existing edges find it. Zero source schema changes." },
              { icon: "\uD83E\uDDEC", title: "Schema-Driven Inheritance", desc: "Machine parent defines 18 BDE attributes + 6 KPIs. All children inherit. InjectionMoldingMachine adds 90 process parameters. 112 redundant definitions eliminated." },
              { icon: "\uD83D\uDCC8", title: "KPI as First-Class Citizens", desc: "KPIs defined in JSON schemas with Cypher formulas, thresholds, categories. Auto-calculated by the KG Builder. 140 KPI nodes across 20+ machines, live." },
              { icon: "\uD83C\uDF10", title: "Source-Agnostic Graph", desc: "Data from SAP, CSV, OPC-UA, MQTT, Kafka \u2014 doesn't matter. The graph fuses everything. The i3X API queries the graph, never a source directly." },
            ].map(d => (
              <div key={d.title} className="rounded-md border border-border bg-bg-surface p-5">
                <div className="text-2xl mb-2">{d.icon}</div>
                <h3 className="font-bold mb-1">{d.title}</h3>
                <p className="text-text-muted text-sm leading-relaxed">{d.desc}</p>
              </div>
            ))}
          </div>

          {/* Build Pipeline */}
          <div className="rounded-md border border-border bg-bg-surface p-6 mb-12">
            <h2 className="text-xl font-bold mb-4">KG Build Pipeline</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { phase: "1", label: "Type System", detail: "Indexes + inheritance", color: "#d03a8c" },
                { phase: "2", label: "Instance Data", detail: "PG + OPC-UA + MCP nodes", color: "#3b82f6" },
                { phase: "3", label: "Live Sync", detail: "MQTT + Polling + Kafka", color: "#10b981" },
                { phase: "4", label: "Tombstone", detail: "Remove stale nodes", color: "#f59e0b" },
                { phase: "5", label: "Embeddings", detail: "Vector search", color: "#8b5cf6" },
                { phase: "6", label: "Sensors", detail: "Auto-discover from MQTT", color: "#06b6d4" },
                { phase: "7", label: "KPIs", detail: "Calculate from properties", color: "#ef4444" },
                { phase: "\u2193", label: "Result", detail: "794K nodes, 1.4M edges", color: "#ff9500" },
              ].map(p => (
                <div key={p.phase} className="rounded border border-border bg-bg-surface-2 p-3 text-center">
                  <div className="text-lg font-bold mb-1" style={{ color: p.color }}>{p.phase}</div>
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="text-[10px] text-text-dim">{p.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 justify-center">
            <a href="https://github.com/TobiasLante/osf-schemas" target="_blank" className="text-sm text-accent hover:underline">GitHub: osf-schemas</a>
            <span className="text-text-dim">|</span>
            <a href="https://github.com/TobiasLante/osf-v8" target="_blank" className="text-sm text-accent hover:underline">GitHub: osf-v8 (KG Builder)</a>
            <span className="text-text-dim">|</span>
            <a href={`${API}/i3x/openapi.json`} target="_blank" className="text-sm text-accent hover:underline">OpenAPI Spec (JSON)</a>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: 3D KNOWLEDGE GRAPH
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === "graph" && (
        <div className="max-w-7xl mx-auto px-6 pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Left panel */}
            <div className="lg:col-span-1 space-y-3">
              <div className="rounded-md border border-border bg-bg-surface p-3">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Object Types ({types.length})</h3>
                <div className="flex flex-wrap gap-1.5 max-h-[300px] overflow-y-auto">
                  {types.map(t => {
                    const name = t.elementId.replace("type:", "");
                    const active = selectedType === t.elementId;
                    return (
                      <button key={t.elementId} onClick={() => setSelectedType(active ? null : t.elementId)}
                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${active ? "border-accent bg-accent/20 text-accent font-semibold" : "border-border bg-bg-surface-2 text-text-dim hover:text-text"}`}>
                        <span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ backgroundColor: getColor(name) }} />
                        {t.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {objects.length > 0 && (
                <div className="rounded-md border border-border bg-bg-surface p-3">
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">{selectedType?.replace("type:", "")} ({objects.length})</h3>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {objects.map(obj => (
                      <button key={obj.elementId} onClick={() => setSelectedObject(obj)}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${selectedObject?.elementId === obj.elementId ? "bg-accent/20 text-accent border border-accent/30" : "hover:bg-bg-surface-2 text-text-muted border border-transparent"}`}>
                        <span className="font-mono">{obj.elementId}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {kpis.length > 0 && selectedObject && (
                <div className="rounded-md border border-border bg-bg-surface p-3">
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">KPIs: {selectedObject.elementId}</h3>
                  <div className="space-y-2">
                    {kpis.map(kpi => (
                      <div key={kpi.kpiId} className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">{kpi.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold ${kpi.status === "good" ? "text-emerald-400" : kpi.status === "warning" ? "text-amber-400" : "text-red-400"}`}>
                            {typeof kpi.value === "number" ? kpi.value.toFixed(1) : kpi.value}{kpi.unit}
                          </span>
                          {kpi.target && <span className="text-text-dim">/ {kpi.target}{kpi.unit}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3D Graph */}
            <div className="lg:col-span-3">
              <div className="rounded-md border border-border bg-[#050507] overflow-hidden" style={{ height: 600 }}>
                {graphData.nodes.length > 0 ? (
                  <ForceGraph3D ref={graphRef} graphData={graphData}
                    nodeLabel={(n: any) => `${n.name} (${n.type})`}
                    nodeColor={(n: any) => n.color} nodeVal={(n: any) => n.val} nodeOpacity={0.9}
                    linkLabel={(l: any) => l.label} linkColor={() => "rgba(255,255,255,0.15)"} linkWidth={0.5}
                    linkDirectionalArrowLength={3} linkDirectionalArrowRelPos={0.9}
                    backgroundColor="#050507" height={600}
                    cooldownTicks={100}
                    onEngineStop={() => graphRef.current?.zoomToFit(400, 80)}
                    onNodeClick={(n: any) => { const obj = objects.find(o => o.elementId === n.id); if (obj) setSelectedObject(obj); }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-text-dim text-sm">
                    {loading ? "Loading types..." : selectedType ? "Loading objects..." : "Loading type overview..."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: API EXPLORER (Swagger embed)
          ═══════════════════════════════════════════════════════════════════ */}
      {tab === "api" && (
        <div className="max-w-7xl mx-auto px-6 pb-12">
          <div className="rounded-md border border-border overflow-hidden" style={{ height: "calc(100vh - 280px)", minHeight: 500 }}>
            <iframe src={`${API}/i3x/docs`} className="w-full h-full border-0" title="OSF i3X Swagger UI" />
          </div>
        </div>
      )}
    </div>
  );
}
