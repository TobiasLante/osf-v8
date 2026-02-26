import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function McpToolsContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          OpenShopFloor exposes <strong>111 MCP tools</strong> across 4 domain
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
            <span className="text-green-400">mcp-fertigung:8024</span>
          </div>
          <div className="text-text-dim">{"  ▼"}</div>
          <div>MCP server queries SQLite, returns JSON</div>
          <div className="text-text-dim">{"  ▼"}</div>
          <div>LLM analyzes result, responds to user</div>
        </div>
      </WikiSection>

      <WikiSection title="MCP Domains">
        <div className="mt-3 space-y-4">
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Manufacturing (mcp-fertigung)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">factory_</code> &mdash; ~30
              tools
            </p>
            <p>
              Machine status, OEE data, production history, capacity overview,
              shift schedules, maintenance plans, tool management.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">ERP (mcp-erp)</h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">erp_</code> &mdash; ~25 tools
            </p>
            <p>
              Production orders, customer data, delivery schedules, material
              management, BOM (Bill of Materials), at-risk orders, on-time
              delivery.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Quality Management (mcp-qms)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">quality_</code> &mdash; ~20
              tools
            </p>
            <p>
              Defect reports, quality metrics, audit data, inspection results,
              SPC charts, CAPA management.
            </p>
          </div>
          <div className="p-4 rounded border border-border bg-bg-surface-2">
            <h4 className="font-semibold text-sm mb-2">
              Warehouse Management (mcp-wms)
            </h4>
            <p className="text-text-dim text-xs mb-2">
              Prefix: <code className="text-accent">warehouse_</code> &mdash; ~16
              tools
            </p>
            <p>
              Inventory levels, stock movements, storage locations, material
              reservations, reorder points.
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
          with all 111 tools, descriptions, and parameters.
        </WikiCallout>
      </WikiSection>
    </>
  );
}
