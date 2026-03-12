"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { ScrollReveal } from "@/components/ScrollReveal";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Animated Counter                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const steps = 30;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setDisplay(Math.round(start + (diff * step) / steps));
      if (step >= steps) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <span ref={ref} className="tabular-nums">
      {display.toLocaleString()}{suffix}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Live Pulse — simulated realistic factory metrics                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function useLivePulse() {
  const [data, setData] = useState({
    machines: 18,
    machinesTotal: 18,
    topics: 42,
    orders: 512,
    kgVertices: 86432,
    tools: 103,
  });

  useEffect(() => {
    const iv = setInterval(() => {
      setData((prev) => ({
        ...prev,
        topics: prev.topics + Math.floor(Math.random() * 3) - 1,
        orders: prev.orders + (Math.random() > 0.7 ? 1 : 0),
        kgVertices: prev.kgVertices + Math.floor(Math.random() * 8),
      }));
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Mini UNS Feed — simulated MQTT values                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

const UNS_TOPICS = [
  { topic: "OSF/Werk-Sued/Fertigung/Spritzguss/SGM/SGM-004/ProcessData/Act_Temp_Barrel", unit: "°C", base: 214, range: 3 },
  { topic: "OSF/Werk-Sued/Fertigung/MechBearbeitung/CNC/CNC-01/BDE/Act_Qty_Good", unit: "pcs", base: 847, range: 0, increment: true },
  { topic: "OSF/Werk-Sued/Fertigung/MechBearbeitung/Drehen/DRH-02/ProcessData/Act_OEE", unit: "%", base: 87.2, range: 2.5 },
  { topic: "OSF/Werk-Sued/Fertigung/MechBearbeitung/Schleifen/SGF-01/ProcessData/Act_CycleTime", unit: "s", base: 34.8, range: 1.5 },
  { topic: "OSF/Werk-Sued/Fertigung/Spritzguss/SGM/SGM-004/ProcessData/Act_Pressure_Injection_Max", unit: "bar", base: 1420, range: 30 },
];

function useUnsFeed() {
  const [values, setValues] = useState<{ topic: string; value: string; unit: string; age: number }[]>([]);

  useEffect(() => {
    function tick() {
      setValues(
        UNS_TOPICS.map((t) => {
          const v = t.increment
            ? t.base + Math.floor(Math.random() * 3)
            : t.base + (Math.random() - 0.5) * t.range * 2;
          return {
            topic: t.topic,
            value: Number.isInteger(t.base) ? String(Math.round(v)) : v.toFixed(1),
            unit: t.unit,
            age: Math.floor(Math.random() * 4) + 1,
          };
        })
      );
    }
    tick();
    const iv = setInterval(tick, 2500);
    return () => clearInterval(iv);
  }, []);

  return values;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  KG Cascade Animation — SGM-004 Impact                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface CascadeNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  color: string;
  delay: number;
}

interface CascadeEdge {
  from: string;
  to: string;
  label: string;
  delay: number;
  dashed?: boolean;
}

const CASCADE_NODES: CascadeNode[] = [
  // Center
  { id: "sgm004", label: "SGM-004", type: "Machine", x: 400, y: 60, color: "#ff9500", delay: 0 },
  // Articles
  { id: "art089", label: "ART-089", type: "Article", x: 220, y: 170, color: "#3b82f6", delay: 400 },
  { id: "art112", label: "ART-112", type: "Article", x: 580, y: 170, color: "#3b82f6", delay: 500 },
  // Orders
  { id: "fa198", label: "FA-2024-0198", type: "Order", x: 120, y: 280, color: "#10b981", delay: 800 },
  { id: "fa211", label: "FA-2024-0211", type: "Order", x: 320, y: 280, color: "#10b981", delay: 900 },
  { id: "fa225", label: "FA-2024-0225", type: "Order", x: 580, y: 280, color: "#10b981", delay: 1000 },
  // Customers
  { id: "siemens", label: "Siemens", type: "Customer", x: 120, y: 390, color: "#06b6d4", delay: 1300 },
  { id: "bosch", label: "Bosch AG", type: "Customer", x: 320, y: 390, color: "#06b6d4", delay: 1400 },
  { id: "zf", label: "ZF Group", type: "Customer", x: 580, y: 390, color: "#06b6d4", delay: 1500 },
  // Tool
  { id: "wkz044", label: "WKZ-044 (78%)", type: "Tool", x: 680, y: 100, color: "#eab308", delay: 600 },
  // Alternative
  { id: "sgm001", label: "SGM-001 (62%)", type: "Alternative", x: 180, y: 60, color: "#22c55e", delay: 1800 },
];

const CASCADE_EDGES: CascadeEdge[] = [
  { from: "sgm004", to: "art089", label: "PRODUCES", delay: 300 },
  { from: "sgm004", to: "art112", label: "PRODUCES", delay: 400 },
  { from: "sgm004", to: "wkz044", label: "USES_TOOL", delay: 500 },
  { from: "art089", to: "fa198", label: "FULFILLS", delay: 700 },
  { from: "art089", to: "fa211", label: "FULFILLS", delay: 800 },
  { from: "art112", to: "fa225", label: "FULFILLS", delay: 900 },
  { from: "fa198", to: "siemens", label: "FOR_CUSTOMER", delay: 1200 },
  { from: "fa211", to: "bosch", label: "FOR_CUSTOMER", delay: 1300 },
  { from: "fa225", to: "zf", label: "FOR_CUSTOMER", delay: 1400 },
  { from: "sgm001", to: "sgm004", label: "ALTERNATIVE", delay: 1700, dashed: true },
];

function KGCascade() {
  const [time, setTime] = useState(-1); // -1 = not started
  const [running, setRunning] = useState(false);
  const animRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const start = useCallback(() => {
    setRunning(true);
    setTime(0);
    startRef.current = performance.now();
    function tick() {
      const elapsed = performance.now() - startRef.current;
      setTime(elapsed);
      if (elapsed < 3000) {
        animRef.current = requestAnimationFrame(tick);
      }
    }
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  const getNodePos = (id: string) => {
    const n = CASCADE_NODES.find((n) => n.id === id);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  };

  return (
    <div className="relative">
      {/* Trigger */}
      {!running && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg-surface/80 backdrop-blur-sm rounded-md">
          <button
            onClick={start}
            className="group flex flex-col items-center gap-3 cursor-pointer"
          >
            <div className="w-16 h-16 rounded-full bg-accent/10 border-2 border-accent/40 flex items-center justify-center group-hover:bg-accent/20 group-hover:border-accent/60 transition-all group-hover:scale-110">
              <svg className="w-7 h-7 text-accent ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="text-sm font-medium text-text-muted group-hover:text-accent transition-colors">
              What happens if SGM-004 goes down?
            </span>
            <span className="text-xs text-text-dim">Click to run impact analysis</span>
          </button>
        </div>
      )}

      {/* Graph Canvas */}
      <div className="rounded-md border border-border bg-[var(--bg-surface)] overflow-hidden" style={{ minHeight: 480 }}>
        <svg viewBox="0 0 800 460" className="w-full h-auto">
          {/* Edges */}
          {CASCADE_EDGES.map((edge) => {
            const from = getNodePos(edge.from);
            const to = getNodePos(edge.to);
            const visible = time >= edge.delay;
            const progress = Math.min(1, Math.max(0, (time - edge.delay) / 300));
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;

            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={from.x + (to.x - from.x) * progress}
                  y2={from.y + (to.y - from.y) * progress}
                  stroke={edge.dashed ? "#22c55e" : "var(--text-dim)"}
                  strokeWidth={1.5}
                  strokeDasharray={edge.dashed ? "6 4" : "none"}
                  opacity={visible ? 0.6 : 0}
                  className="transition-opacity duration-200"
                />
                {progress >= 1 && (
                  <text
                    x={midX}
                    y={midY - 6}
                    textAnchor="middle"
                    className="text-[8px] fill-[var(--text-dim)]"
                    opacity={0.5}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {CASCADE_NODES.map((node) => {
            const visible = time >= node.delay;
            const scale = visible ? Math.min(1, (time - node.delay) / 200) : 0;
            const isAlt = node.type === "Alternative";

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y}) scale(${scale})`}
                className="transition-transform"
                style={{ transformOrigin: `${node.x}px ${node.y}px` }}
              >
                {/* Glow */}
                {visible && node.id === "sgm004" && (
                  <circle r={38} fill={node.color} opacity={0.1}>
                    <animate attributeName="r" values="38;44;38" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.1;0.2;0.1" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Circle */}
                <circle
                  r={node.id === "sgm004" ? 32 : 26}
                  fill={`${node.color}20`}
                  stroke={node.color}
                  strokeWidth={isAlt ? 1.5 : 2}
                  strokeDasharray={isAlt ? "4 3" : "none"}
                />
                {/* Label */}
                <text
                  textAnchor="middle"
                  dy={-4}
                  className="text-[10px] font-semibold"
                  fill={node.color}
                >
                  {node.label}
                </text>
                <text
                  textAnchor="middle"
                  dy={10}
                  className="text-[8px]"
                  fill="var(--text-dim)"
                >
                  {node.type}
                </text>
              </g>
            );
          })}

          {/* Risk Score */}
          {time >= 2200 && (
            <g transform="translate(680, 380)">
              <rect x={-50} y={-22} width={100} height={44} rx={6} fill="#ef444420" stroke="#ef4444" strokeWidth={1.5} />
              <text textAnchor="middle" dy={-4} className="text-[18px] font-bold" fill="#ef4444">78/100</text>
              <text textAnchor="middle" dy={12} className="text-[8px]" fill="var(--text-dim)">Risk Score</text>
            </g>
          )}

          {/* Summary */}
          {time >= 2500 && (
            <g transform="translate(400, 445)">
              <text textAnchor="middle" className="text-[10px]" fill="var(--text-muted)">
                3 customers affected &bull; 3 orders at risk &bull; 1 alternative available (SGM-001, load 62%) &bull; 200ms
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Caption */}
      {time >= 2500 && (
        <div className="mt-3 text-center">
          <p className="text-xs text-text-dim">
            One tool call. Five-hop graph traversal. Full supply chain impact in 200ms.
            This is what i3X graph queries look like in production.
          </p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Alignment Data                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

const BRIDGE_ROWS = [
  { i3x: "Standardized API", osf: "103 MCP Tools", detail: "JSON-RPC, AI-native" },
  { i3x: "SM Profiles", osf: "KG Type System", detail: "21 entity types + KPI targets" },
  { i3x: "Graph Traversal", osf: "24 Cypher Tools", detail: "Impact, risk, traceability" },
  { i3x: "Equipment Hierarchy", osf: "ISA-95 UNS", detail: "Enterprise → Site → Cell" },
  { i3x: "Lot Traceability", osf: "Material Genealogy", detail: "Raw → Lot → Order → Customer" },
  { i3x: "Cross-Platform", osf: "Open MCP Protocol", detail: "Any AI, any model, any client" },
];

const DOMAIN_TOOLS: { domain: string; color: string; count: number; highlight: string }[] = [
  { domain: "ERP", color: "#ff9500", count: 20, highlight: "CM01, VA05, MD04" },
  { domain: "OEE & Process", color: "#10b981", count: 15, highlight: "97 SGM params" },
  { domain: "QMS", color: "#3b82f6", count: 8, highlight: "SPC, Cpk, CAPA" },
  { domain: "TMS", color: "#a855f7", count: 16, highlight: "Wear, replace, history" },
  { domain: "Knowledge Graph", color: "#f43f5e", count: 24, highlight: "Impact, risk, trace" },
  { domain: "Live UNS", color: "#06b6d4", count: 8, highlight: "MQTT, ISA-95" },
  { domain: "Assembly", color: "#eab308", count: 12, highlight: "Pre-assembly, test field" },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main Page                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function I3xPage() {
  const pulse = useLivePulse();
  const unsFeed = useUnsFeed();

  return (
    <>
      <BackgroundOrbs />

      {/* ── HERO + LIVE PULSE ─────────────────────────────────────── */}
      <section className="pt-28 pb-8 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <ScrollReveal delay={100}>
            <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
              From i3X Vision to{" "}
              <span className="bg-accent-gradient bg-clip-text text-transparent">Working Reality</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <p className="text-lg text-text-muted max-w-3xl mx-auto leading-relaxed">
              CESMII&apos;s i3X defines how industrial data should be accessible.
              OpenShopFloor implements that vision &mdash; 103 MCP tools, a knowledge graph
              with 86k+ vertices, ISA-95 hierarchy, and real-time UNS.
              All queryable by AI agents through an open protocol.
            </p>
          </ScrollReveal>

          {/* Live Pulse Strip */}
          <ScrollReveal delay={350}>
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Machines", value: pulse.machines, suffix: `/${pulse.machinesTotal}`, color: "#10b981" },
                { label: "MQTT Topics", value: pulse.topics, suffix: " streaming", color: "#06b6d4" },
                { label: "Active Orders", value: pulse.orders, suffix: "", color: "#3b82f6" },
                { label: "KG Vertices", value: pulse.kgVertices, suffix: "", color: "#a855f7" },
                { label: "AI Tools", value: pulse.tools, suffix: " callable", color: "#ff9500" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3 rounded-md border border-border bg-bg-surface hover:border-[var(--accent)]/20 transition-colors"
                >
                  <div className="text-xl sm:text-2xl font-bold tabular-nums" style={{ color: item.color }}>
                    <AnimatedNumber value={item.value} />
                    {item.suffix && <span className="text-xs font-normal text-text-dim">{item.suffix}</span>}
                  </div>
                  <div className="text-[10px] text-text-dim mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── CONCEPT BRIDGE ────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <ScrollReveal>
            <div className="rounded-md border border-border bg-bg-surface overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-bg-surface-2">
                <div className="col-span-4 text-xs font-semibold text-text-dim uppercase tracking-wider">i3X Defines</div>
                <div className="col-span-1 flex items-center justify-center">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </div>
                <div className="col-span-4 text-xs font-semibold text-text-dim uppercase tracking-wider">OSF Runs</div>
                <div className="col-span-3 text-xs font-semibold text-text-dim uppercase tracking-wider">Detail</div>
              </div>
              {/* Rows */}
              {BRIDGE_ROWS.map((row, i) => (
                <div
                  key={row.i3x}
                  className={`grid grid-cols-12 gap-4 px-6 py-3 items-center ${i < BRIDGE_ROWS.length - 1 ? "border-b border-border/40" : ""} hover:bg-bg-surface-2/50 transition-colors`}
                >
                  <div className="col-span-4 text-sm text-text-muted">{row.i3x}</div>
                  <div className="col-span-1 flex justify-center">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </span>
                  </div>
                  <div className="col-span-4 text-sm font-medium text-text">{row.osf}</div>
                  <div className="col-span-3 text-xs text-text-dim">{row.detail}</div>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── SEE IT LIVE — KG CASCADE ──────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">
                See It{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Live</span>
              </h2>
              <p className="text-text-muted max-w-xl mx-auto">
                One tool call. The knowledge graph traverses 5 hops
                and returns the full impact cascade in 200ms.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <KGCascade />
          </ScrollReveal>
        </div>
      </section>

      {/* ── LIVE UNS FEED ─────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h3 className="text-sm font-semibold text-text">Live Factory Data — ISA-95 Unified Namespace</h3>
              <span className="text-[10px] text-text-dim">Walker Reynolds pattern</span>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <div className="rounded-md border border-border bg-bg-surface overflow-hidden">
              {unsFeed.map((item, i) => {
                const parts = item.topic.split("/");
                const machine = parts[5] || "";
                const metric = parts[parts.length - 1] || "";
                return (
                  <div
                    key={item.topic}
                    className={`flex items-center gap-3 px-4 py-2.5 ${i < unsFeed.length - 1 ? "border-b border-border/30" : ""} hover:bg-bg-surface-2/50 transition-colors`}
                  >
                    <span className="text-[10px] text-text-dim font-mono truncate flex-1 hidden sm:block">{item.topic}</span>
                    <span className="text-[10px] text-text-dim font-mono sm:hidden">{machine}/{metric}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-mono font-semibold text-emerald-400 tabular-nums w-20 text-right">{item.value}</span>
                      <span className="text-[10px] text-text-dim w-8">{item.unit}</span>
                      <span className="text-[10px] text-text-dim w-8 text-right">{item.age}s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <p className="mt-3 text-xs text-text-dim text-center">
              Real-time MQTT data flowing through the ISA-95 topic hierarchy.
              Every value self-describing: timestamp, unit, definition, quality qualifier.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {/* ── THREE LAYERS ──────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">
                Three-Layer{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Architecture</span>
              </h2>
              <p className="text-text-muted max-w-xl mx-auto">
                Streaming, relational, and graph — unified through one protocol.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[
              {
                tag: "REAL-TIME", tagColor: "#10b981", title: "Streaming", subtitle: "MQTT + ISA-95 UNS",
                desc: "Every sensor value, machine state, and alert flows through one MQTT broker. ISA-95 topic hierarchy. Sub-second latency.",
                icon: "M13 10V3L4 14h7v7l9-11h-7z",
              },
              {
                tag: "103 TOOLS", tagColor: "#ff9500", title: "Relational", subtitle: "PostgreSQL + MCP",
                desc: "Domain-specific schemas for ERP, OEE, QMS, TMS. 103 MCP tools expose everything through a unified JSON-RPC API.",
                icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3zm0 5h16",
              },
              {
                tag: "86K VERTICES", tagColor: "#3b82f6", title: "Graph", subtitle: "Apache AGE + Cypher",
                desc: "21 entity types, 31+ edge types. Multi-hop queries for impact analysis, supply chain risk, and lot traceability.",
                icon: "M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l-2-1m2 1L2 8m2-1v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5",
              },
            ].map((layer, i) => (
              <ScrollReveal key={layer.title} delay={i * 120}>
                <div className="relative p-6 rounded-md border border-border bg-bg-surface hover:border-accent/20 transition-colors h-full">
                  <div className="absolute top-4 right-4 text-[9px] font-bold px-2 py-0.5 rounded" style={{ color: layer.tagColor, backgroundColor: layer.tagColor + "15" }}>
                    {layer.tag}
                  </div>
                  <div className="w-11 h-11 rounded-md flex items-center justify-center mb-4" style={{ backgroundColor: layer.tagColor + "12" }}>
                    <svg className="w-5 h-5" style={{ color: layer.tagColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={layer.icon} />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold mb-0.5">{layer.title}</h3>
                  <div className="text-xs text-text-dim mb-3">{layer.subtitle}</div>
                  <p className="text-sm text-text-muted leading-relaxed">{layer.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>

          {/* MCP unifying bar */}
          <ScrollReveal delay={400}>
            <div className="mt-5 p-4 rounded-md border border-accent/20 bg-accent/5 text-center">
              <span className="text-xs text-text-dim uppercase tracking-wider">Unified Access Layer: </span>
              <span className="text-sm font-semibold text-accent">Model Context Protocol (MCP)</span>
              <span className="text-xs text-text-muted"> &mdash; open standard, any AI agent, zero vendor lock-in</span>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── TOOL COVERAGE ─────────────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">
                <span className="bg-accent-gradient bg-clip-text text-transparent">103 Tools</span>
                {" "}Across 7 Domains
              </h2>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {DOMAIN_TOOLS.map((d) => (
                <div key={d.domain} className="p-3 rounded-md border border-border bg-bg-surface text-center hover:border-accent/20 transition-colors">
                  <div className="text-2xl font-bold tabular-nums" style={{ color: d.color }}>{d.count}</div>
                  <div className="text-xs font-medium text-text mt-0.5">{d.domain}</div>
                  <div className="text-[10px] text-text-dim mt-1">{d.highlight}</div>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── WHY MCP = i3X FOR AI ──────────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">
                Complementary,{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Not Competing</span>
              </h2>
              <p className="text-text-muted max-w-2xl mx-auto">
                i3X defines the data model. MCP defines the AI access layer.
                The ideal stack uses both.
              </p>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { title: "i3X standardizes the model", desc: "SM Profiles describe what equipment looks like — attributes, relationships, KPI targets. The semantic layer every platform needs." },
              { title: "MCP standardizes the access", desc: "AI agents discover and invoke tools dynamically. No hardcoded API calls. Swap your AI provider without rewriting integrations." },
              { title: "OSF proves it works", desc: "103 tools, 86k-vertex knowledge graph, ISA-95 UNS — running live. The implementation CESMII envisions, built with pragmatic tools." },
              { title: "Together: the full stack", desc: "SM Profiles for semantics + MCP for AI access + a live factory to prove it. Define once, query from anywhere, with any agent." },
            ].map((item, i) => (
              <ScrollReveal key={item.title} delay={i * 100}>
                <div className="p-5 rounded-md border border-border bg-bg-surface hover:border-accent/20 transition-colors h-full">
                  <h3 className="font-semibold text-sm mb-2">{item.title}</h3>
                  <p className="text-xs text-text-muted leading-relaxed">{item.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <div className="p-8 rounded-md border border-accent/30 bg-gradient-to-b from-accent/5 to-transparent text-center">
              <h2 className="text-2xl font-bold mb-3">
                Let&apos;s Build the Bridge
              </h2>
              <p className="text-text-muted max-w-xl mx-auto mb-6 leading-relaxed text-sm">
                CESMII defines the interoperability standard. OpenShopFloor provides the live
                manufacturing sandbox where it runs. SM Profiles as the semantic model,
                MCP as the AI access layer, a real factory to prove it works.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
                <Link
                  href="/explore"
                  className="px-7 py-3 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all"
                >
                  Explore the Platform
                </Link>
                <Link
                  href="/uns"
                  className="px-7 py-3 rounded-md border border-border bg-bg-surface text-text-muted text-sm hover:border-accent/25 hover:text-text hover:-translate-y-0.5 transition-all"
                >
                  See Live UNS Data
                </Link>
              </div>
              <div className="flex items-center justify-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-xs">TL</div>
                <div className="text-left">
                  <div className="text-xs font-semibold">Tobias Lante</div>
                  <a
                    href="https://www.linkedin.com/in/tobiaslante/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-accent hover:text-accent/80 transition-colors"
                  >
                    Connect on LinkedIn &rarr;
                  </a>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}
