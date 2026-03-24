import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function ArchitectureContent() {
  return (
    <>
      <WikiSection title="System Overview">
        <p>
          OpenShopFloor consists of four main layers that work together to provide
          a complete manufacturing AI platform:
        </p>
        <div className="mt-4 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// Architecture Overview"}</div>
          <div>
            <span className="text-blue-400">Browser</span> (Next.js SPA)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-green-400">OSF Gateway</span> (Express + Node-RED)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Auth, Chat, Agents, Flows"}</div>
          <div className="text-text-dim">{"    ├── Node-RED Editor (embedded)"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-orange-400">MCP Servers</span> (7 domains)
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├── Factory (port 8020) — ERP, OEE, MRP, Capacity, TMS, SGM, Assembly, Energy"}</div>
          <div className="text-text-dim">{"    ├── UNS     (port 8025) — Live MQTT machine data"}</div>
          <div className="text-text-dim">{"    ├── KG      (port 8035) — Knowledge Graph, semantic search, charts"}</div>
          <div className="text-text-dim">{"    ├── History  (port 8030) — Time-series analytics"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-purple-400">Factory Simulation</span> (PostgreSQL databases)
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Frontend (Next.js)">
        <p>
          The frontend is a statically exported Next.js application hosted on
          Cloudflare Pages. It provides:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>AI Chat</strong> &mdash; Conversational interface with SSE streaming
          </li>
          <li>
            <strong>Agent Hub</strong> &mdash; Browse, run, and manage built-in and community agents
          </li>
          <li>
            <strong>Flow Editor</strong> &mdash; Embedded Node-RED editor (iframe)
          </li>
          <li>
            <strong>Challenges</strong> &mdash; Gamified factory optimization tasks
          </li>
          <li>
            <strong>Documentation</strong> &mdash; This wiki and the MCP tool reference
          </li>
        </ul>
        <WikiCallout type="info">
          Since the frontend uses <code className="text-accent bg-accent/10 px-1 rounded text-xs">output: &quot;export&quot;</code>,
          all routes are statically generated at build time. Dynamic routes use{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">generateStaticParams()</code>.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Gateway (Express)">
        <p>
          The OSF Gateway is the backend API server running as a Kubernetes
          deployment. It handles:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Authentication</strong> &mdash; JWT-based auth with email/password registration
          </li>
          <li>
            <strong>Chat API</strong> &mdash; Streams LLM responses with MCP tool calls via SSE
          </li>
          <li>
            <strong>Agent Runner</strong> &mdash; Executes built-in and code agents in V8 sandboxes
          </li>
          <li>
            <strong>Flow Engine</strong> &mdash; Executes Node-RED flows with the custom OSF engine
          </li>
          <li>
            <strong>MCP Proxy</strong> &mdash; Routes tool calls to the appropriate MCP server
          </li>
          <li>
            <strong>Node-RED</strong> &mdash; Embeds the Node-RED editor for visual flow building
          </li>
          <li>
            <strong>Code Agents</strong> &mdash; GitHub integration, webhook sync, isolated-vm execution
          </li>
        </ul>
        <p>
          The gateway runs as a single Express process with Node-RED embedded at
          the <code className="text-accent bg-accent/10 px-1 rounded text-xs">/flows</code> path.
          Authentication uses JWT tokens via Bearer headers, API keys, or the{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf_editor_token</code> cookie
          for the Node-RED iframe.
        </p>
      </WikiSection>

      <WikiSection title="MCP Servers">
        <p>
          Multiple MCP servers expose factory data via the Model Context Protocol:
        </p>
        <div className="mt-3 space-y-3">
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">factory-sim:8020</code>
            <p className="mt-1">
              Factory Simulator &mdash; ERP, OEE, capacity, MRP, maintenance, energy,
              stock, purchasing, subcontracting, TMS, SGM (injection molding), assembly,
              pre-assembly, and test field. Prefix: <code>factory_</code>, <code>tms_</code>,
              <code>sgm_</code>, <code>montage_</code>
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">mqtt-uns:8025</code>
            <p className="mt-1">
              UNS (Unified Namespace) &mdash; live machine data via MQTT, topic search,
              alerts, cross-machine comparisons. Prefix: <code>uns_</code>
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">kg-server:8035</code>
            <p className="mt-1">
              Knowledge Graph &mdash; Neo4j graph queries, impact analysis, semantic
              search (vector embeddings), chart generation, delivery snapshots.
              Prefix: <code>kg_</code>
            </p>
          </div>
          <div className="p-3 rounded border border-border bg-bg-surface-2">
            <code className="text-accent text-xs font-mono">historian:8030</code>
            <p className="mt-1">
              Time-series analytics &mdash; trends, comparisons, aggregations,
              anomaly detection. Prefix: <code>history_</code>
            </p>
          </div>
        </div>
        <WikiCallout type="tip">
          See the{" "}
          <Link href="/docs#tools" className="text-accent hover:underline">
            MCP Tools Reference
          </Link>{" "}
          for a complete list of all 118 tools with parameters.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Factory Simulation">
        <p>
          The factory simulation provides realistic manufacturing data. It
          simulates:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>CNC Machines</strong> &mdash; 5 CNC turning/milling centers with
            real-time OEE, availability, and performance data
          </li>
          <li>
            <strong>Injection Molding (SGM)</strong> &mdash; 3 injection molding
            machines with cycle times and quality data
          </li>
          <li>
            <strong>Assembly Lines</strong> &mdash; Final assembly with station-level tracking
          </li>
          <li>
            <strong>Pre-Assembly</strong> &mdash; Sub-assembly operations
          </li>
          <li>
            <strong>Test Field</strong> &mdash; End-of-line testing with pass/fail data
          </li>
        </ul>
        <p>
          Data is stored in PostgreSQL databases and updated by simulation routines. The
          simulation runs continuously, generating realistic production events,
          machine states, quality data, and order progress.
        </p>
        <WikiCallout type="info">
          See the{" "}
          <Link href="/docs/wiki/factory-simulation" className="text-accent hover:underline">
            Factory Simulation
          </Link>{" "}
          article for details on the data model and machine types.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="LLM Integration">
        <p>
          OSF uses locally hosted LLMs for all AI operations. Two model servers are
          available:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Port 5001</strong> &mdash; Larger model for moderation, synthesis,
            and debate tasks
          </li>
          <li>
            <strong>Port 5002</strong> &mdash; qwen2.5-14b for specialist tasks
            (agents, flow nodes)
          </li>
        </ul>
        <p>
          The chat API and flow engine route requests to the appropriate model
          based on the task type. All LLM calls include the user&apos;s MCP tool
          results as context.
        </p>
      </WikiSection>

      <WikiSection title="Deployment">
        <p>
          The platform runs on Kubernetes with the following setup:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Frontend</strong> &mdash; Cloudflare Pages (static export)
          </li>
          <li>
            <strong>Gateway</strong> &mdash; K8s Deployment in namespace{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf</code>
          </li>
          <li>
            <strong>MCP Servers</strong> &mdash; K8s Deployments in namespace{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">demo</code>
          </li>
          <li>
            <strong>LLM Servers</strong> &mdash; GPU-attached pods
          </li>
        </ul>
        <WikiCallout type="tip">
          Want to run OSF locally? See the{" "}
          <Link href="/docs/wiki/self-hosting" className="text-accent hover:underline">
            Self-Hosting Guide
          </Link>.
        </WikiCallout>
      </WikiSection>
    </>
  );
}
