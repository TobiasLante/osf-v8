"use client";

import { useState } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";

type Tab = "mcp" | "kg" | "uns";

const tabs: { id: Tab; label: string }[] = [
  { id: "mcp", label: "MCP Servers" },
  { id: "kg", label: "Knowledge Graph" },
  { id: "uns", label: "#shared.UNS" },
];

/* ── MCP Server Data ── */
const mcpServers = [
  {
    name: "ERP",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    tools: 42,
    port: 8021,
    desc: "Orders, customers, capacity planning, material management, purchasing, and KPIs. The core transactional backbone.",
  },
  {
    name: "OEE",
    icon: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z",
    tools: 28,
    port: 8024,
    desc: "Overall Equipment Effectiveness, machine performance, scrap history, injection molding process data, and energy monitoring.",
  },
  {
    name: "QMS",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    tools: 12,
    port: 8023,
    desc: "Quality management: SPC alarms, calibration tracking, Cpk analysis, quality notifications, and test field results.",
  },
  {
    name: "TMS",
    icon: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
    tools: 7,
    port: 8022,
    desc: "Tool management system: tool wear tracking, replacement schedules, article-to-tool mappings, and inventory.",
  },
  {
    name: "#shared.UNS",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    tools: 8,
    port: "MQTT",
    desc: "#shared.UnifiedNameSpace: a multi-tenant MQTT backbone where all users and AI agents share the same live factory data stream.",
  },
  {
    name: "KG",
    icon: "M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l-2-1m2 1L2 8m2-1v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5",
    tools: 6,
    port: "AGE",
    desc: "Knowledge Graph via Apache AGE: impact analysis, dependency tracing, bottleneck detection, and shortest-path queries.",
  },
];

/* ── KG Data ── */
const entityTypes = [
  { name: "Machine", color: "#ff9500" },
  { name: "Article", color: "#3b82f6" },
  { name: "Order", color: "#10b981" },
  { name: "Material", color: "#a855f7" },
  { name: "Supplier", color: "#f43f5e" },
  { name: "Tool", color: "#eab308" },
  { name: "Customer", color: "#06b6d4" },
  { name: "Pool", color: "#6366f1" },
];

const relationships = [
  { name: "PRODUCES", from: "Machine", to: "Article" },
  { name: "WORKS_ON", from: "Machine", to: "Order" },
  { name: "USES_TOOL", from: "Machine", to: "Tool" },
  { name: "MEMBER_OF", from: "Machine", to: "Pool" },
  { name: "HAS_BOM", from: "Article", to: "Material" },
  { name: "NEEDS_POOL", from: "Article", to: "Pool" },
  { name: "SUPPLIED_BY", from: "Material", to: "Supplier" },
  { name: "FOR_CUSTOMER", from: "Order", to: "Customer" },
];

const kgTools = [
  { name: "kg_impact_analysis", desc: "Analyze what happens when a machine or tool goes down. Traces all affected orders, articles, and customers." },
  { name: "kg_trace_order", desc: "Trace an order through the entire supply chain — from customer to materials and suppliers." },
  { name: "kg_find_alternatives", desc: "Find alternative machines, tools, or suppliers that can handle a specific article or material." },
  { name: "kg_dependency_graph", desc: "Visualize the full dependency tree of any entity — upstream and downstream." },
  { name: "kg_bottleneck_analysis", desc: "Identify bottleneck nodes: entities with the most dependencies that create single points of failure." },
  { name: "kg_shortest_path", desc: "Find the shortest connection path between any two entities in the manufacturing graph." },
];

/* ── #shared.UNS Data ── */
const unsTopicLevels = [
  { level: "Factory", example: "Factory", desc: "Root namespace" },
  { level: "Machine", example: "CNC-001", desc: "Physical asset" },
  { level: "Order", example: "FA-2024-0142", desc: "Production order" },
  { level: "Step", example: "OP-10", desc: "Operation step" },
  { level: "Category", example: "OEE", desc: "Data category" },
  { level: "Metric", example: "availability", desc: "Specific value" },
];

const unsTools = [
  { name: "uns_subscribe", desc: "Subscribe to MQTT topics with wildcard support. Receive real-time messages from the shop floor." },
  { name: "uns_publish", desc: "Publish messages to MQTT topics. Send commands or data to shop floor devices." },
  { name: "uns_query_latest", desc: "Query the latest value for a specific topic path without subscribing." },
  { name: "uns_list_topics", desc: "List all active MQTT topics matching a pattern." },
  { name: "uns_history", desc: "Retrieve historical values for a topic within a time range." },
  { name: "uns_aggregate", desc: "Compute aggregations (avg, min, max, sum) over topic history." },
  { name: "uns_schema", desc: "Get the payload schema definition for a topic." },
  { name: "uns_health", desc: "Check connectivity and status of the MQTT broker and SSE bridge." },
];

export default function ExplorePage() {
  const [activeTab, setActiveTab] = useState<Tab>("mcp");

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              Explore the Platform
            </h1>
            <p className="text-text-muted max-w-2xl mx-auto">
              OpenShopFloor connects AI agents to a real factory through MCP
              servers, a Knowledge Graph, and a #shared.UnifiedNameSpace. Explore how
              each layer works.
            </p>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-accent text-bg"
                    : "border border-border text-text-muted hover:border-accent/30 hover:text-accent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "mcp" && <MCPTab />}
          {activeTab === "kg" && <KGTab />}
          {activeTab === "uns" && <UNSTab />}
        </div>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tab 1: MCP Servers                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

function MCPTab() {
  return (
    <div className="space-y-12">
      {/* What is MCP */}
      <div className="rounded-md border border-border bg-bg-surface p-6 max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-2">What is MCP?</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          The <strong className="text-text">Model Context Protocol</strong> is
          an open standard for connecting AI models to external data sources and
          tools. Instead of hardcoding API calls, MCP provides a unified
          JSON-RPC interface that any AI agent can discover and invoke
          dynamically. OpenShopFloor exposes 6 MCP servers with 100+ tools
          covering every domain of a manufacturing operation.
        </p>
      </div>

      {/* Server cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">6 Logical Servers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mcpServers.map((s) => (
            <div
              key={s.name}
              className="rounded-md border border-border bg-bg-surface p-4 flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-accent/10 flex items-center justify-center shrink-0">
                  <svg
                    className="w-5 h-5 text-accent"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d={s.icon}
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold">{s.name}</h3>
                  <span className="text-xs text-text-dim font-mono">
                    {s.tools} tools &middot;{" "}
                    {typeof s.port === "number" ? `:${s.port}` : s.port}
                  </span>
                </div>
              </div>
              <p className="text-sm text-text-muted leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Architecture diagram */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Architecture</h2>
        <div className="rounded-md border border-border bg-bg-surface p-6 overflow-x-auto">
          <div className="flex items-center justify-center gap-3 text-xs font-mono text-text-muted min-w-[600px]">
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">Factory Sim</div>
              <div className="text-[10px]">PostgreSQL + MQTT</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-accent/40 px-3 py-2 text-center bg-accent/5 shrink-0">
              <div className="text-accent font-semibold">MCP Servers</div>
              <div className="text-[10px]">6 servers &middot; JSON-RPC</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">Gateway</div>
              <div className="text-[10px]">Auth + Routing</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">AI Agents</div>
              <div className="text-[10px]">LLM + Flow Engine</div>
            </div>
          </div>
        </div>
      </div>

      {/* Example tool call */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example Tool Call</h2>
        <pre className="rounded-md border border-border bg-bg-surface p-4 text-xs font-mono text-text-muted overflow-x-auto leading-relaxed">
{`// JSON-RPC request to MCP server
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "factory_get_capacity_overview",
    "arguments": {
      "periodType": "week",
      "periodCount": 2
    }
  },
  "id": 1
}`}
        </pre>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Link
          href="/features"
          className="inline-block px-6 py-2.5 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Browse All Tools &rarr;
        </Link>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tab 2: Knowledge Graph                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function KGTab() {
  return (
    <div className="space-y-12">
      {/* What is KG */}
      <div className="rounded-md border border-border bg-bg-surface p-6 max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-2">What is a Knowledge Graph?</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          A <strong className="text-text">Knowledge Graph</strong> models
          entities and their relationships as a network of nodes and edges.
          Unlike relational tables, graphs excel at traversing complex
          connections — answering questions like{" "}
          <em>&ldquo;What happens if machine SGM-004 goes down?&rdquo;</em> in
          milliseconds. OpenShopFloor uses{" "}
          <strong className="text-text">Apache AGE</strong> (a PostgreSQL
          extension) to store the full manufacturing topology.
        </p>
      </div>

      {/* Entity types as colored nodes */}
      <div>
        <h2 className="text-lg font-semibold mb-4">8 Entity Types</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {entityTypes.map((e) => (
            <div
              key={e.name}
              className="rounded-md border border-border bg-bg-surface p-3 flex items-center gap-3"
            >
              <div
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold"
                style={{
                  backgroundColor: e.color + "20",
                  color: e.color,
                  border: `2px solid ${e.color}60`,
                }}
              >
                {e.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-sm font-medium">{e.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Relationships */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Relationships</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {relationships.map((r) => {
            const fromColor =
              entityTypes.find((e) => e.name === r.from)?.color || "#888";
            const toColor =
              entityTypes.find((e) => e.name === r.to)?.color || "#888";
            return (
              <div
                key={r.name}
                className="rounded-md border border-border bg-bg-surface px-4 py-2.5 flex items-center gap-2 text-sm"
              >
                <span className="font-medium" style={{ color: fromColor }}>
                  {r.from}
                </span>
                <span className="text-text-dim font-mono text-xs px-2 py-0.5 rounded bg-bg border border-border">
                  {r.name}
                </span>
                <span className="font-medium" style={{ color: toColor }}>
                  {r.to}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Static graph visualization */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Graph Topology</h2>
        <div className="rounded-md border border-border bg-bg-surface p-6">
          <div className="relative w-full" style={{ height: 320 }}>
            {/* Positioned nodes */}
            {[
              { name: "Machine", x: "50%", y: "10%" },
              { name: "Article", x: "20%", y: "35%" },
              { name: "Order", x: "80%", y: "35%" },
              { name: "Pool", x: "10%", y: "10%" },
              { name: "Tool", x: "90%", y: "10%" },
              { name: "Material", x: "20%", y: "70%" },
              { name: "Customer", x: "80%", y: "70%" },
              { name: "Supplier", x: "50%", y: "90%" },
            ].map((node) => {
              const e = entityTypes.find((t) => t.name === node.name)!;
              return (
                <div
                  key={node.name}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
                  style={{ left: node.x, top: node.y }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
                    style={{
                      backgroundColor: e.color + "25",
                      color: e.color,
                      border: `2px solid ${e.color}`,
                    }}
                  >
                    {e.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[10px] text-text-dim font-mono">
                    {node.name}
                  </span>
                </div>
              );
            })}
            {/* SVG edges */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {[
                { x1: 50, y1: 10, x2: 20, y2: 35 },  // Machine → Article
                { x1: 50, y1: 10, x2: 80, y2: 35 },  // Machine → Order
                { x1: 50, y1: 10, x2: 90, y2: 10 },  // Machine → Tool
                { x1: 50, y1: 10, x2: 10, y2: 10 },  // Machine → Pool
                { x1: 20, y1: 35, x2: 20, y2: 70 },  // Article → Material
                { x1: 20, y1: 35, x2: 10, y2: 10 },  // Article → Pool
                { x1: 20, y1: 70, x2: 50, y2: 90 },  // Material → Supplier
                { x1: 80, y1: 35, x2: 80, y2: 70 },  // Order → Customer
              ].map((line, i) => (
                <line
                  key={i}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="rgba(255,149,0,0.2)"
                  strokeWidth="0.3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* KG Tools */}
      <div>
        <h2 className="text-lg font-semibold mb-4">6 Knowledge Graph Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kgTools.map((t) => (
            <div
              key={t.name}
              className="rounded-md border border-border bg-bg-surface p-4"
            >
              <h3 className="font-mono text-sm text-accent mb-1">{t.name}</h3>
              <p className="text-xs text-text-muted leading-relaxed">
                {t.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Use case */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Use Case: &ldquo;What if SGM-004 fails?&rdquo;
        </h2>
        <div className="rounded-md border border-border bg-bg-surface p-6 space-y-4">
          <p className="text-sm text-text-muted">
            An AI agent calls <code className="text-accent">kg_impact_analysis</code>{" "}
            with <code className="text-accent">machine: &quot;SGM-004&quot;</code>. The
            Knowledge Graph traverses all edges:
          </p>
          <pre className="rounded border border-border bg-bg p-4 text-xs font-mono text-text-muted overflow-x-auto leading-relaxed">
{`SGM-004 (Machine)
├─ PRODUCES → Article ART-112, ART-089
│  ├─ ART-112 → Order FA-2024-0142 → Customer "Bosch AG"
│  └─ ART-089 → Order FA-2024-0198 → Customer "Siemens"
├─ USES_TOOL → Tool WKZ-044 (wear: 78%)
├─ MEMBER_OF → Pool MECH_SCHLEIF
│  └─ Alternative: SGM-001, SGM-007 (same pool)
└─ Impact: 2 articles, 2 orders, 2 customers affected
   Mitigation: Reroute to SGM-001 (load: 62%)`}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tab 3: #shared.UNS                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

function UNSTab() {
  return (
    <div className="space-y-12">
      {/* What is #shared.UNS */}
      <div className="rounded-md border border-border bg-bg-surface p-6 max-w-3xl mx-auto space-y-4">
        <h2 className="text-lg font-semibold">
          What is <span className="text-accent">#shared.UNS</span>?
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Traditional factory IT follows the{" "}
          <strong className="text-text">ISA-95 pyramid</strong>: sensors talk to
          PLCs, PLCs talk to SCADA, SCADA talks to MES, MES talks to ERP — each
          layer a silo with its own protocols, databases, and access controls.
          Integrating two systems means building a point-to-point bridge. With 10
          systems you need 45 bridges. With 50 systems, 1&thinsp;225. It doesn&apos;t
          scale.
        </p>
        <p className="text-sm text-text-muted leading-relaxed">
          A <strong className="text-text">#shared.UnifiedNameSpace (#shared.UNS)</strong>{" "}
          replaces the pyramid with a single, event-driven data hub. Every sensor
          reading, machine state, order update, and quality event is published to
          a hierarchical MQTT topic tree. Any system — human dashboard, MES, ERP,
          or AI agent — subscribes to the topics it cares about and receives
          updates in real time. No polling, no point-to-point bridges, no ETL
          pipelines. One integration per system, not one per pair.
        </p>
        <p className="text-sm text-text-muted leading-relaxed">
          OpenShopFloor goes further with{" "}
          <strong className="text-accent">#shared.UNS</strong>: a shared,
          multi-tenant namespace that distributes data across three specialized
          layers — an architecture that ARC Advisory and CESMII call the future
          of smart manufacturing:
        </p>
      </div>

      {/* 3-Layer Architecture */}
      <div>
        <h2 className="text-lg font-semibold mb-4">3-Layer Data Architecture</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-sm bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xs font-bold">S</div>
              <h3 className="font-semibold text-sm">Streaming Data</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Real-time sensor values, machine states, and alerts via MQTT.
              Sub-second latency for immediate process control and live
              dashboards. This is the heartbeat of the factory.
            </p>
          </div>
          <div className="rounded-md border border-accent/30 bg-accent/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-sm bg-accent/10 flex items-center justify-center text-accent text-xs font-bold">R</div>
              <h3 className="font-semibold text-sm">Relational Data</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Structured data in PostgreSQL for KPI calculations, OEE history,
              order tracking, and complex queries. The 111 MCP tools query this
              layer for analytics and decision support.
            </p>
          </div>
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-sm bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs font-bold">G</div>
              <h3 className="font-semibold text-sm">Graph Data</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Apache AGE Knowledge Graph for dependency analysis, impact
              tracing, and bottleneck detection. Unstructured relationships that
              relational tables can&apos;t express efficiently.
            </p>
          </div>
        </div>
      </div>

      {/* Key advantages */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Why #shared.UNS?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-md border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-semibold mb-1">Single Source of Truth per Asset</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              Every machine, order, and material has exactly one canonical
              representation in the namespace. CNC-001&apos;s OEE, current order,
              tool wear, and alert state all live under{" "}
              <code className="text-accent">Factory/CNC-001/...</code> — no
              duplicates across departments, no conflicting spreadsheets.
              When something changes, every consumer sees it instantly.
            </p>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-semibold mb-1">Dramatically Reduced Complexity</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              Traditional integration: N systems need N&times;(N&minus;1)/2
              point-to-point bridges. 10 systems = 45 bridges. 50 = 1&thinsp;225.
              With #shared.UNS: each system publishes and subscribes to one bus.
              10 systems = 10 integrations. 50 = 50. Complexity grows linearly,
              not quadratically. Adding a new MES, sensor, or AI agent is a
              single MQTT connection — not a project.
            </p>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-semibold mb-1">AI-Native Architecture</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              AI agents are first-class citizens on the same bus as human
              operators. They subscribe to live MQTT topics, query historical
              data through MCP tools, traverse the Knowledge Graph for impact
              analysis, and publish decisions back — all without custom API
              integrations. The #shared.UNS <em>is</em> the agent&apos;s context window
              into the factory.
            </p>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-4">
            <h3 className="text-sm font-semibold mb-1">#shared.UNS Data Model</h3>
            <p className="text-xs text-text-muted leading-relaxed">
              The topic hierarchy follows ISA-95 levels:{" "}
              <code className="text-accent text-[11px]">Factory/&#123;Machine&#125;/&#123;Order&#125;/&#123;Step&#125;/&#123;Category&#125;/&#123;Metric&#125;</code>.
              Every asset is self-describing — payloads carry Value, Unit, and
              Definition. #shared.UNS makes this model multi-tenant: all
              platform users share the same namespace, the same live data, the
              same topology. No per-user data pipelines, no configuration —
              connect and go.
            </p>
          </div>
        </div>
      </div>

      {/* Topic hierarchy */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Topic Hierarchy</h2>
        <div className="rounded-md border border-border bg-bg-surface p-6">
          <div className="font-mono text-sm space-y-1 overflow-x-auto">
            <div className="text-text-dim mb-3">
              Factory / &#123;Machine&#125; / &#123;Order&#125; /
              &#123;Step&#125; / &#123;Category&#125; / &#123;Metric&#125;
            </div>
            {unsTopicLevels.map((l, i) => (
              <div key={l.level} className="flex items-center gap-2">
                <span className="text-text-dim select-none w-4 text-right">
                  {i > 0 ? "/" : " "}
                </span>
                <span className="text-accent">{l.example}</span>
                <span className="text-text-dim text-xs">
                  &larr; {l.level}: {l.desc}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-text-dim font-mono">
              Example: Factory/CNC-001/FA-2024-0142/OP-10/OEE/availability
              &rarr; 0.94
            </p>
          </div>
        </div>
      </div>

      {/* UNS Tools */}
      <div>
        <h2 className="text-lg font-semibold mb-4">8 #shared.UNS MCP Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {unsTools.map((t) => (
            <div
              key={t.name}
              className="rounded-md border border-border bg-bg-surface p-4"
            >
              <h3 className="font-mono text-sm text-accent mb-1">{t.name}</h3>
              <p className="text-xs text-text-muted leading-relaxed">
                {t.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Architecture */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Architecture</h2>
        <div className="rounded-md border border-border bg-bg-surface p-6 overflow-x-auto">
          <div className="flex items-center justify-center gap-3 text-xs font-mono text-text-muted min-w-[600px]">
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">Shop Floor</div>
              <div className="text-[10px]">PLCs + Sensors</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-accent/40 px-3 py-2 text-center bg-accent/5 shrink-0">
              <div className="text-accent font-semibold">Mosquitto</div>
              <div className="text-[10px]">MQTT Broker</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">SSE Bridge</div>
              <div className="text-[10px]">Server-Sent Events</div>
            </div>
            <svg className="w-8 h-4 text-text-dim shrink-0" viewBox="0 0 32 16">
              <path d="M0 8h28M24 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="rounded border border-border px-3 py-2 text-center bg-bg shrink-0">
              <div className="text-accent font-semibold">Browser</div>
              <div className="text-[10px]">Live Dashboard</div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center rounded-md border border-border bg-bg-surface p-6">
        <p className="text-sm text-text-muted mb-4">
          Explore the live #shared.UNS topic tree, subscribe to topics, and see
          real-time data flowing from the factory.
        </p>
        <Link
          href="/uns"
          className="inline-block px-6 py-2.5 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Explore Live #shared.UNS &rarr;
        </Link>
        <p className="text-xs text-text-dim mt-2">Login required</p>
      </div>
    </div>
  );
}
