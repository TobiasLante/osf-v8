import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function McpToolsContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          OpenShopFloor exposes <strong>118 MCP tools</strong> across 7 domain
          servers. These tools provide real-time access to the factory simulation
          data via the Model Context Protocol.
        </p>
        <p>
          The complete tool reference with parameters is available on the{" "}
          <Link href="/docs#tools" className="text-accent hover:underline">
            Docs Hub &rarr; Tool Reference
          </Link>{" "}
          page.
        </p>
      </WikiSection>

      <WikiSection title="How MCP Works">
        <p>
          The Model Context Protocol (MCP) is an open protocol that lets AI
          agents call structured tools. When you send a message in the OSF chat
          or run an agent, the LLM decides which MCP tools to call based on your
          query. The results are returned as structured JSON and fed back into
          the conversation.
        </p>
        <div className="mt-4 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// MCP request flow"}</div>
          <div>User: &quot;What&apos;s the current OEE?&quot;</div>
          <div className="text-text-dim mt-1">{"  ▼"}</div>
          <div>
            LLM decides: call{" "}
            <span className="text-orange-400">factory_get_latest_oee</span>
          </div>
          <div className="text-text-dim">{"  ▼"}</div>
          <div>
            Gateway proxies to{" "}
            <span className="text-green-400">factory-sim:8020</span>
          </div>
          <div className="text-text-dim">{"  ▼"}</div>
          <div>MCP server queries PostgreSQL, returns JSON</div>
          <div className="text-text-dim">{"  ▼"}</div>
          <div>LLM analyzes result, responds to user</div>
        </div>
      </WikiSection>

      <WikiSection title="MCP Domains">
        <div className="mt-3 space-y-4">
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Factory &amp; ERP (mcp-fertigung / mcp-erp)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">factory_</code> &mdash; 60+ tools
            </p>
            <p>
              Machine status, OEE, capacity (CM01/CM21), shift schedules,
              customer orders (VA05), MRP (MD04/MD07), maintenance, energy
              management, stock, purchasing, and subcontracting. Both servers
              route to the same Factory Simulator backend.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Tool Management (mcp-tms)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">tms_</code> &mdash; 9 tools
            </p>
            <p>
              Tool status, wear tracking, critical tools, replacements, tool
              availability per article, tool changes for changeovers.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Injection Molding (SGM) &amp; Assembly
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">sgm_</code> / <code className="text-accent">montage_</code> &mdash; 23 tools
            </p>
            <p>
              SGM: process data (~97 params), cavity balance, trends. Assembly:
              station OEE, BDE, process data, maintenance, pre-assembly cells,
              test field (function/leak/burn-in).
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              UNS / MQTT (mcp-uns)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">uns_</code> &mdash; 8 tools
            </p>
            <p>
              Live machine data via MQTT: list machines, get status/values per
              category, search topics, alerts, history, and cross-machine
              comparisons.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Knowledge Graph (mcp-kg)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">kg_</code> &mdash; 12 tools
            </p>
            <p>
              Impact analysis, shortest paths, neighbors, subgraphs, semantic
              search (vector embeddings), Cypher queries, schema inspection,
              delivery snapshots, and chart generation.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Historian (time-series)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">history_</code> &mdash; 6 tools
            </p>
            <p>
              Time-series trends, machine comparisons, aggregations (AVG/MIN/MAX),
              anomaly detection (N-sigma), machine listing, and variable discovery.
            </p>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Using MCP Tools">
        <p>You can call MCP tools in three ways:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Chat</strong> &mdash; Ask a question and the LLM automatically
            calls the right tools
          </li>
          <li>
            <strong>Code Agents</strong> &mdash; Use{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">
              ctx.mcp.call(&apos;tool_name&apos;, args)
            </code>{" "}
            in TypeScript
          </li>
          <li>
            <strong>Visual Flows</strong> &mdash; Use the osf-mcp-* nodes to call
            tools visually
          </li>
          <li>
            <strong>REST API</strong> &mdash;{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">
              POST /mcp
            </code>{" "}
            with tool name and arguments
          </li>
        </ul>
        <WikiCallout type="tip">
          <Link href="/docs#tools" className="text-accent hover:underline">
            View the complete Tool Reference
          </Link>{" "}
          with all 118 tools, descriptions, and parameters.
        </WikiCallout>
      </WikiSection>
    </>
  );
}
