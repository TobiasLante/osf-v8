"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// react-force-graph-3d uses WebGL — must be client-only
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface I3xObjectType {
  elementId: string;
  displayName: string;
  parentTypeId?: string;
  namespaceUri?: string;
}

interface I3xObject {
  elementId: string;
  displayName: string;
  typeId?: string;
  properties?: Record<string, any>;
}

interface KPI {
  kpiId: string;
  name: string;
  value: number;
  unit: string;
  category?: string;
  target?: number;
  warning?: number;
  critical?: number;
  status?: "good" | "warning" | "critical";
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  color: string;
  val: number;
  oee?: number;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Color mapping for node types                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

const TYPE_COLORS: Record<string, string> = {
  InjectionMoldingMachine: "#ff9500",
  CNC_Machine: "#3b82f6",
  Lathe: "#3b82f6",
  MillingMachine: "#3b82f6",
  GrindingMachine: "#3b82f6",
  FiveAxisMillingMachine: "#3b82f6",
  FFS_Cell: "#8b5cf6",
  AssemblyLine: "#06b6d4",
  Machine: "#ff9500",
  Article: "#10b981",
  ProductionOrder: "#eab308",
  CustomerOrder: "#f59e0b",
  Customer: "#ec4899",
  Supplier: "#14b8a6",
  Site: "#6366f1",
  Area: "#8b5cf6",
  ProductionLine: "#a855f7",
  KPI: "#ef4444",
  Sensor: "#64748b",
};

function getColor(type: string): string {
  return TYPE_COLORS[type] || "#64748b";
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  API helpers                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/i3x${path}`, { credentials: "include" });
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
  const graphRef = useRef<any>(null);

  // Load object types on mount
  useEffect(() => {
    apiFetch<I3xObjectType[]>("/objecttypes")
      .then(setTypes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load objects when type selected
  useEffect(() => {
    if (!selectedType) return;
    setObjects([]);
    setSelectedObject(null);
    setKpis([]);
    apiFetch<I3xObject[]>(`/objects?typeId=${encodeURIComponent(selectedType)}&limit=100`)
      .then(setObjects)
      .catch(() => {});
  }, [selectedType]);

  // Load KPIs when object selected
  useEffect(() => {
    if (!selectedObject) { setKpis([]); return; }
    apiFetch<KPI[]>(`/objects/${encodeURIComponent(selectedObject.elementId)}/kpis`)
      .then(setKpis)
      .catch(() => setKpis([]));
  }, [selectedObject]);

  // Build graph from objects + related
  const buildGraph = useCallback(async () => {
    if (objects.length === 0) return;

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const seen = new Set<string>();

    // Add current objects as nodes
    for (const obj of objects.slice(0, 50)) {
      if (seen.has(obj.elementId)) continue;
      seen.add(obj.elementId);
      const type = obj.typeId?.replace("type:", "") || "Unknown";
      nodes.push({
        id: obj.elementId,
        name: obj.displayName || obj.elementId,
        type,
        color: getColor(type),
        val: type.includes("Machine") || type.includes("Molding") ? 8 : 4,
        oee: obj.properties?.OEE,
      });
    }

    // Fetch related for first 10 objects
    const topIds = objects.slice(0, 10).map((o) => o.elementId);
    try {
      const related = await fetch(`${API}/i3x/objects/related`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ elementIds: topIds }),
      });
      if (related.ok) {
        const data: any[] = await related.json();
        for (const rel of data) {
          const targetId = rel.object?.elementId;
          if (!targetId) continue;

          if (!seen.has(targetId)) {
            seen.add(targetId);
            const type = rel.object?.typeId?.replace("type:", "") || "Unknown";
            nodes.push({
              id: targetId,
              name: rel.object?.displayName || targetId,
              type,
              color: getColor(type),
              val: 3,
            });
          }

          if (rel.sourceElementId && targetId) {
            links.push({
              source: rel.sourceElementId,
              target: targetId,
              label: rel.relationshipType || "",
            });
          }
        }
      }
    } catch {}

    setGraphData({ nodes, links });
  }, [objects]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

  // Stats
  const stats = useMemo(() => ({
    types: types.length,
    machines: types.filter((t) => TYPE_COLORS[t.elementId.replace("type:", "")] === "#ff9500" || t.parentTypeId === "type:Machine").length,
    objects: objects.length,
    kpiCount: kpis.length,
  }), [types, objects, kpis]);

  return (
    <div className="min-h-screen bg-[var(--bg)] pt-20">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/" className="text-text-dim hover:text-accent text-sm">&larr; Back</Link>
        </div>
        <h1 className="text-3xl font-bold mb-2">
          i3X Knowledge Graph{" "}
          <span className="text-accent">Explorer</span>
        </h1>
        <p className="text-text-muted text-sm max-w-2xl mb-6">
          Live data from the OSF Knowledge Graph via the i3X API. {stats.types} types, {stats.objects} objects loaded.
          Powered by CESMII SM Profiles with schema-driven inheritance.
        </p>

        {/* Stats bar */}
        <div className="flex gap-4 mb-6 flex-wrap">
          {[
            { label: "Types", value: stats.types, color: "text-accent" },
            { label: "Objects", value: stats.objects, color: "text-blue-400" },
            { label: "KPIs", value: stats.kpiCount, color: "text-emerald-400" },
          ].map((s) => (
            <div key={s.label} className="px-4 py-2 rounded-md border border-border bg-bg-surface">
              <span className={`text-lg font-bold ${s.color}`}>{s.value}</span>
              <span className="text-xs text-text-dim ml-2">{s.label}</span>
            </div>
          ))}
          <a
            href={`${API}/i3x/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-md border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-colors flex items-center gap-2"
          >
            Swagger UI &rarr;
          </a>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
            {error} — make sure you are logged in.
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

          {/* Left: Type selector + object list */}
          <div className="lg:col-span-1 space-y-3">
            {/* Type chips */}
            <div className="rounded-md border border-border bg-bg-surface p-3">
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Object Types</h3>
              <div className="flex flex-wrap gap-1.5 max-h-[300px] overflow-y-auto">
                {types.map((t) => {
                  const name = t.elementId.replace("type:", "");
                  const active = selectedType === t.elementId;
                  return (
                    <button
                      key={t.elementId}
                      onClick={() => setSelectedType(active ? null : t.elementId)}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                        active
                          ? "border-accent bg-accent/20 text-accent font-semibold"
                          : "border-border bg-bg-surface-2 text-text-dim hover:text-text hover:border-accent/30"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ backgroundColor: getColor(name) }} />
                      {t.displayName}
                      {t.parentTypeId && <span className="text-text-dim ml-1 opacity-50">&larr; {t.parentTypeId.replace("type:", "")}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Object list */}
            {objects.length > 0 && (
              <div className="rounded-md border border-border bg-bg-surface p-3">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
                  {selectedType?.replace("type:", "")} ({objects.length})
                </h3>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {objects.map((obj) => (
                    <button
                      key={obj.elementId}
                      onClick={() => setSelectedObject(obj)}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                        selectedObject?.elementId === obj.elementId
                          ? "bg-accent/20 text-accent border border-accent/30"
                          : "hover:bg-bg-surface-2 text-text-muted border border-transparent"
                      }`}
                    >
                      <span className="font-mono">{obj.elementId}</span>
                      {obj.displayName !== obj.elementId && (
                        <span className="text-text-dim ml-1">— {obj.displayName}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* KPI panel */}
            {kpis.length > 0 && selectedObject && (
              <div className="rounded-md border border-border bg-bg-surface p-3">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">
                  KPIs: {selectedObject.elementId}
                </h3>
                <div className="space-y-2">
                  {kpis.map((kpi) => (
                    <div key={kpi.kpiId} className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">{kpi.name}</span>
                      <span className={`font-bold ${
                        kpi.status === "good" ? "text-emerald-400" :
                        kpi.status === "warning" ? "text-amber-400" : "text-red-400"
                      }`}>
                        {typeof kpi.value === "number" ? kpi.value.toFixed(1) : kpi.value}{kpi.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: 3D Graph */}
          <div className="lg:col-span-3">
            <div className="rounded-md border border-border bg-[#050507] overflow-hidden" style={{ height: 600 }}>
              {graphData.nodes.length > 0 ? (
                <ForceGraph3D
                  ref={graphRef}
                  graphData={graphData}
                  nodeLabel={(node: any) => `${node.name} (${node.type})`}
                  nodeColor={(node: any) => node.color}
                  nodeVal={(node: any) => node.val}
                  nodeOpacity={0.9}
                  linkLabel={(link: any) => link.label}
                  linkColor={() => "rgba(255,255,255,0.1)"}
                  linkWidth={0.5}
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={0.9}
                  backgroundColor="#050507"
                  width={undefined}
                  height={600}
                  onNodeClick={(node: any) => {
                    const obj = objects.find((o) => o.elementId === node.id);
                    if (obj) setSelectedObject(obj);
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-text-dim text-sm">
                  {loading ? "Loading..." : selectedType ? "No objects found" : "Select a type to explore the Knowledge Graph"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
