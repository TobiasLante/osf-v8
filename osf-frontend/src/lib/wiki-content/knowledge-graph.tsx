import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function KnowledgeGraphContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          The Knowledge Graph (KG) is a schema-driven graph built automatically
          from PostgreSQL sources via the 3-schema system. It provides semantic
          search, impact analysis, and natural language chart generation for
          manufacturing data.
        </p>
        <p>
          Unlike traditional ETL approaches, the KG builder reads domain
          configuration templates and autonomously discovers, maps, and
          synchronizes data into a Neo4j graph database &mdash; with vector
          embeddings for semantic retrieval.
        </p>
      </WikiSection>

      <WikiSection title="Architecture">
        <div className="mt-4 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// KG Architecture"}</div>
          <div>
            <span className="text-blue-400">PostgreSQL Sources</span> (ERP, BDE, MES)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── PG LISTEN/NOTIFY (real-time sync)"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-green-400">KG Builder</span> (3-Schema System)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Pass 1: Build Nodes"}</div>
          <div className="text-text-dim">{"    ├── Pass 2: Build Edges"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-orange-400">Neo4j</span> (Graph Database)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Vector Embeddings (LLM)"}</div>
          <div className="text-text-dim">{"    ├── Cypher Queries"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-purple-400">MCP Tools</span> (8 KG + 2 Discovery)
          </div>
        </div>
        <p>
          The two-pass build ensures all nodes exist before edges are created,
          avoiding dangling references. PG LISTEN/NOTIFY provides real-time
          synchronization when source data changes.
        </p>
      </WikiSection>

      <WikiSection title="Node Types">
        <p>
          Node types are configurable via domain templates. A typical discrete
          manufacturing setup includes:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Machine</strong> &mdash; CNC centers, assembly stations, test fields
          </li>
          <li>
            <strong>Article</strong> &mdash; Finished products, semi-finished goods
          </li>
          <li>
            <strong>Order</strong> &mdash; Production orders, customer orders
          </li>
          <li>
            <strong>Material</strong> &mdash; Raw materials, purchased parts
          </li>
          <li>
            <strong>Supplier</strong> &mdash; Material and component suppliers
          </li>
          <li>
            <strong>Tool</strong> &mdash; Cutting tools, fixtures, gauges
          </li>
          <li>
            <strong>Sensor</strong> &mdash; OPC-UA tags, MQTT variables
          </li>
          <li>
            <strong>CNC Program</strong> &mdash; NC programs linked to operations
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="Relationships">
        <p>
          Edges encode manufacturing semantics and supply chain dependencies:
        </p>
        <div className="mt-3 space-y-2">
          {[
            ["PRODUCES", "Machine → Article"],
            ["WORKS_ON", "Machine → Order"],
            ["USES_TOOL", "Machine → Tool"],
            ["HAS_BOM", "Article → Material"],
            ["SUPPLIED_BY", "Material → Supplier"],
            ["REQUIRES_PROGRAM", "Machine → CNC Program"],
            ["HAS_SENSOR", "Machine → Sensor"],
            ["DEPENDS_ON", "Order → Order"],
          ].map(([rel, desc]) => (
            <div key={rel} className="flex items-center gap-3 text-sm">
              <code className="text-accent bg-accent/10 px-2 py-0.5 rounded text-xs font-mono min-w-[10rem]">
                {rel}
              </code>
              <span className="text-text-dim">{desc}</span>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection title="MCP Tools (8 KG Tools)">
        <p>
          The Knowledge Graph exposes 8 tools via MCP for LLM-driven queries:
        </p>
        <div className="mt-3 space-y-3">
          {[
            ["kg_search", "Semantic search across all node types using vector embeddings"],
            ["kg_get_node", "Retrieve a specific node by ID with all properties and edges"],
            ["kg_get_neighbors", "Get all neighbors of a node, optionally filtered by type or relationship"],
            ["kg_shortest_path", "Find the shortest path between two nodes in the graph"],
            ["kg_impact_analysis", "Trace upstream/downstream impact of a node change (e.g., supplier delay)"],
            ["kg_cypher_query", "Execute arbitrary Cypher queries for advanced analysis"],
            ["kg_statistics", "Get node/edge counts, type distributions, graph health metrics"],
            ["kg_chart", "Natural language → Cypher → interactive chart (bar, line, pie, scatter)"],
          ].map(([tool, desc]) => (
            <div key={tool} className="p-3 rounded border border-border bg-bg-surface-2">
              <code className="text-accent text-xs font-mono">{tool}</code>
              <p className="mt-1 text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection title="Discovery Tools">
        <p>
          Two additional tools support machine and sensor discovery:
        </p>
        <div className="mt-3 space-y-3">
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">kg_discovered_machines</code>
            <p className="mt-1 text-sm">
              List all machines discovered from OPC-UA, MQTT, and database sources
              with their connection status and metadata.
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">kg_machine_sensors</code>
            <p className="mt-1 text-sm">
              List all sensors and variables attached to a specific machine, including
              data types, units, and current values.
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Domain Templates">
        <p>
          The KG builder ships with configurable domain templates for different
          industries:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Discrete Manufacturing</strong> &mdash; CNC, assembly, BOM, OEE
          </li>
          <li>
            <strong>Pharma</strong> &mdash; Batch records, GMP compliance, equipment qualification
          </li>
          <li>
            <strong>Chemical</strong> &mdash; Process units, recipes, SIL levels, material flows
          </li>
          <li>
            <strong>Medical Devices</strong> &mdash; UDI tracking, DHR, CAPA, sterilization
          </li>
        </ul>
        <WikiCallout type="info">
          Templates define which node types, relationships, and source tables to
          use. Switch templates to adapt the KG to your industry without code
          changes.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Vector Search">
        <p>
          Every node in the graph is enriched with a vector embedding generated by
          the local LLM. This enables semantic search using natural language:
        </p>
        <div className="mt-3 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim">{"// Example: natural language query"}</div>
          <div>{'"Which machines had quality issues with aluminum parts last week?"'}</div>
          <div className="text-text-dim mt-2">{"// → Embedding → cosine similarity → top-k nodes"}</div>
          <div className="text-text-dim">{"// → Traverse edges → full context for LLM"}</div>
        </div>
        <p>
          Vector search is used by the{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">kg_search</code>{" "}
          tool and automatically falls back to keyword search when embeddings are
          unavailable.
        </p>
      </WikiSection>

      <WikiSection title="Chart Engine">
        <p>
          The{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">kg_chart</code>{" "}
          tool converts natural language questions into Cypher queries, executes them
          against Neo4j, and returns interactive chart configurations:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Bar charts</strong> &mdash; OEE by machine, defects by type
          </li>
          <li>
            <strong>Line charts</strong> &mdash; Production trends, sensor data over time
          </li>
          <li>
            <strong>Pie charts</strong> &mdash; Material distribution, order status breakdown
          </li>
          <li>
            <strong>Scatter plots</strong> &mdash; Correlation analysis (cycle time vs. quality)
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="OPC-UA & MTP Integration">
        <p>
          The KG integrates with OPC-UA and MTP (VDI 2658) to automatically
          extract equipment models from AutomationML files and CESMII Smart
          Manufacturing Profiles. Parsed modules, services, and variables are
          merged into the graph schema with full ISA-95 hierarchy.
        </p>
        <WikiCallout type="tip">
          See the dedicated{" "}
          <Link href="/docs/wiki/opcua-mtp" className="text-accent hover:underline">
            OPC-UA &amp; MTP Integration
          </Link>{" "}
          article for the full architecture, parser details, domain templates,
          and MQTT UNS bridge.
        </WikiCallout>
      </WikiSection>
    </>
  );
}
