'use client';

import { useState, useEffect } from 'react';
import { apiFetch, API_URL } from '@/lib/api';

interface McpTool {
  name: string;
  description: string;
}

interface HealthData {
  status: string;
  graphAvailable: boolean;
  vectorAvailable: boolean;
  mqtt: { running: boolean };
}

interface ServiceStatus {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'checking';
  tools?: McpTool[];
  detail?: string;
}

export default function ConnectPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAll();
  }, []);

  const checkAll = async () => {
    setLoading(true);

    // KG Server health
    try {
      const h = await apiFetch<HealthData>('/health');
      setHealth(h);
    } catch { setHealth(null); }

    // MCP Tools (from KG Server)
    let kgTools: McpTool[] = [];
    try {
      const res = await fetch(`${API_URL}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const data = await res.json();
      kgTools = data.result?.tools || [];
    } catch {}

    // Build service list from what we know
    const svc: ServiceStatus[] = [
      {
        name: 'KG Server (MCP + REST)',
        url: API_URL,
        status: health?.status === 'ok' ? 'online' : 'offline',
        tools: kgTools.filter(t => t.name.startsWith('kg_')),
        detail: `Neo4j: ${health?.graphAvailable ? 'connected' : 'offline'}, Vector: ${health?.vectorAvailable ? 'ready' : 'offline'}, MQTT: ${health?.mqtt?.running ? 'bridging' : 'off'}`,
      },
    ];

    // Domain tools (non-kg_ prefix)
    const domainTools = kgTools.filter(t => !t.name.startsWith('kg_'));
    if (domainTools.length > 0) {
      svc.push({
        name: 'Domain Tools (from template)',
        url: API_URL,
        status: 'online',
        tools: domainTools,
        detail: `Loaded from active domain template`,
      });
    }

    setServices(svc);
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Services, endpoints, and how to connect your data.
          </p>
        </div>
        <button onClick={checkAll} disabled={loading} className="btn-secondary text-xs">
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {/* Active Services */}
      <Section title="Active Services">
        {services.map((svc, i) => (
          <ServiceCard key={i} service={svc} />
        ))}
        {services.length === 0 && !loading && (
          <div className="card text-center text-[var(--text-dim)] py-6">No services reachable. Is the KG Server running?</div>
        )}
      </Section>

      {/* How to Connect */}
      <Section title="How to Connect Your Data">
        <ConnectGuide
          title="1. MCP Server (SQL Database)"
          description="Expose any PostgreSQL/MySQL database as MCP tools. The KG Builder discovers them automatically."
          steps={[
            'Deploy an MCP server that wraps your DB (e.g. factory-sim-v3 pattern)',
            'Expose tools/list and tools/call via JSON-RPC on /mcp',
            'Set MCP_PROXY_URL to point to your server',
            'Run the KG Builder: npm run build-kg -- --domain discrete',
          ]}
          example={`# Your MCP server must respond to:
POST /mcp
{"jsonrpc":"2.0","id":1,"method":"tools/list"}

# → Returns:
{"result":{"tools":[
  {"name":"get_machines","description":"List all machines","inputSchema":{...}},
  {"name":"get_orders","description":"List production orders","inputSchema":{...}}
]}}`}
          envVars={[
            { key: 'MCP_PROXY_URL', value: 'http://your-mcp-server:8020', desc: 'Primary MCP endpoint for tool discovery' },
          ]}
        />

        <ConnectGuide
          title="2. Historian (MQTT Time Series)"
          description="The Historian subscribes to MQTT, stores time series in TimescaleDB, and exposes history_* MCP tools."
          steps={[
            'Historian auto-subscribes to Factory/# on the MQTT broker',
            'Data lands in TimescaleDB (historian_db, schema: historian)',
            'KG Builder discovers history_get_trend, history_aggregate, etc.',
            'Historical data enriches the Knowledge Graph (OEE trends, anomalies)',
          ]}
          example={`# Historian MCP tools:
history_get_trend    — Time series for a machine variable (last N hours)
history_compare      — Compare a variable between two machines
history_aggregate    — AVG/MIN/MAX per hour/day/week
history_anomalies    — Values > 2 sigma from mean
history_machines     — All machines with data in historian
history_variables    — All variables for a machine`}
          envVars={[
            { key: 'HISTORIAN_URL', value: 'http://historian:8030', desc: 'Historian MCP endpoint' },
            { key: 'MQTT_BROKER_URL', value: 'mqtt://broker:1883', desc: 'MQTT broker for Historian to subscribe' },
          ]}
        />

        <ConnectGuide
          title="3. OPC-UA (Machine Data)"
          description="Import machine structure from MTP/AutomationML files. OPC-UA endpoints are extracted and stored in the KG."
          steps={[
            'Provide MTP files (AutomationML XML) via URL',
            'Set MTP_URLS env var (comma-separated)',
            'KG Builder parses Equipment, Services, Variables, OPC-UA endpoints',
            'Equipment hierarchy appears in the Knowledge Graph',
          ]}
          example={`# MTP parsing extracts:
Equipment: Reaktor_R101 (PEA)
  Services: Heizen (Idle→Running→Completed), Kuehlen
  Variables: TIC01_PV (Float, °C), FIC01_PV (Float, l/h)
  OPC-UA: opc.tcp://192.168.1.101:4840

# Becomes KG nodes:
(:Equipment {id:"Reaktor_R101", opcuaEndpoint:"opc.tcp://..."})
(:Service {id:"Heizen", states:"Idle,Running,Completed"})`}
          envVars={[
            { key: 'MTP_URLS', value: 'http://semodia.local/mtp/reactor.aml', desc: 'Comma-separated MTP file URLs' },
          ]}
        />

        <ConnectGuide
          title="4. Neo4j Knowledge Graph"
          description="The KG Server reads from Neo4j. You can also query it directly."
          steps={[
            'Neo4j Browser: port-forward or NodePort 37474',
            'Bolt protocol: port 7687 (for drivers)',
            'All KG data lives here: nodes, edges, embeddings',
            'Vector search via native Neo4j vector index (768d cosine)',
          ]}
          example={`# Direct Cypher queries:
MATCH (m:Machine) RETURN m.name, m.oee ORDER BY m.oee DESC
MATCH (o:Order)-[:RUNS_ON]->(m:Machine) RETURN m.name, count(o)

# Semantic search (via KG Server API):
POST /api/kg/semantic-search
{"query": "temperature sensors", "limit": 10}`}
          envVars={[
            { key: 'NEO4J_URL', value: 'bolt://osf-neo4j:7687', desc: 'Neo4j Bolt endpoint' },
            { key: 'NEO4J_USER', value: 'neo4j', desc: 'Neo4j username' },
            { key: 'NEO4J_PASSWORD', value: '(from secret)', desc: 'Neo4j password' },
          ]}
        />

        <ConnectGuide
          title="5. Gateway Integration"
          description="The KG Server auto-registers in the Gateway's mcp_servers table. Chat can use KG tools within 60 seconds."
          steps={[
            'Set GATEWAY_DB_URL pointing to the Gateway PostgreSQL',
            'KG Server registers as "kg-v9" on startup',
            'Gateway discovers tools via tools/list',
            'Chat users can ask: "Welche Maschine hat die schlechteste OEE?"',
          ]}
          example={`# Gateway sees these tools automatically:
kg_impact      — Downstream impact analysis
kg_search      — Semantic search via embeddings
kg_schema      — Graph structure inspection
kg_aggregate   — AVG/MIN/MAX across node properties
discrete_order_load   — Orders per machine (domain-specific)
discrete_bom_tree     — Bill of materials for an article`}
          envVars={[
            { key: 'GATEWAY_DB_URL', value: 'postgresql://osf_admin:pw@osf-postgres:5432/osf', desc: 'Gateway DB for auto-registration' },
            { key: 'KG_SERVER_URL', value: 'http://osf-kg-server:8035', desc: 'URL the gateway uses to reach KG Server' },
          ]}
        />
      </Section>

      {/* API Reference */}
      <Section title="API Quick Reference">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4 text-[var(--text-dim)] font-medium">Endpoint</th>
                <th className="text-left py-2 pr-4 text-[var(--text-dim)] font-medium">Method</th>
                <th className="text-left py-2 text-[var(--text-dim)] font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-muted)]">
              {[
                ['POST /mcp', 'JSON-RPC', 'MCP tools/list + tools/call (8 generic + domain tools)'],
                ['GET /health', 'GET', 'Service health: graph, vector store, MQTT bridge'],
                ['POST /api/kg/semantic-search', 'POST', 'Vector search: {query, limit, labelFilter}'],
                ['POST /api/kg/chart', 'POST (SSE)', 'LLM generates Cypher → data → recharts config'],
                ['POST /api/kg/ask', 'POST', 'Natural language → Cypher → results'],
                ['GET /api/kg/runs', 'GET', 'List past KG build runs'],
                ['GET /api/kg/runs/:id', 'GET', 'Full run detail with schema + reports'],
                ['POST /api/kg/review', 'POST', 'Selective re-extraction: {runId, corrections[]}'],
                ['GET /api/kg/embeddings/stats', 'GET', 'Embedding count per node type'],
                ['GET /api/kg/mqtt/status', 'GET', 'MQTT bridge stats'],
              ].map(([endpoint, method, desc], i) => (
                <tr key={i} className="border-b border-[var(--border)]/30">
                  <td className="py-2 pr-4 font-mono text-xs text-emerald-400">{endpoint}</td>
                  <td className="py-2 pr-4 text-xs">{method}</td>
                  <td className="py-2 text-xs">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${service.status === 'online' ? 'bg-emerald-400' : service.status === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
          <div>
            <div className="text-sm font-semibold text-[var(--text)]">{service.name}</div>
            <div className="text-xs text-[var(--text-muted)]">{service.url}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {service.tools && <span className="badge badge-blue">{service.tools.length} tools</span>}
          <span className="text-xs text-[var(--text-dim)]">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>
      {service.detail && <div className="text-xs text-[var(--text-muted)] mt-2">{service.detail}</div>}
      {expanded && service.tools && service.tools.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]/30 space-y-1">
          {service.tools.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <code className="text-xs text-emerald-400 font-mono whitespace-nowrap">{t.name}</code>
              <span className="text-xs text-[var(--text-muted)]">{t.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EnvVar { key: string; value: string; desc: string; }

function ConnectGuide({ title, description, steps, example, envVars }: {
  title: string; description: string; steps: string[]; example: string; envVars: EnvVar[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          <span className="text-xs text-[var(--text-dim)]">{open ? '\u25B2' : '\u25BC'}</span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          {/* Steps */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-dim)] mb-2">Steps</h4>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="text-xs text-[var(--text-muted)] flex gap-2">
                  <span className="text-emerald-400 font-mono flex-shrink-0">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          {/* Env Vars */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-dim)] mb-2">Environment Variables</h4>
            <div className="space-y-1">
              {envVars.map((v, i) => (
                <div key={i} className="flex items-start gap-2 bg-[var(--surface-2)] rounded-md px-3 py-2">
                  <code className="text-xs text-amber-400 font-mono whitespace-nowrap">{v.key}</code>
                  <code className="text-xs text-[var(--text-muted)] font-mono">=</code>
                  <code className="text-xs text-emerald-400 font-mono break-all">{v.value}</code>
                  <span className="text-xs text-[var(--text-dim)] ml-auto flex-shrink-0">{v.desc}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Example */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-dim)] mb-2">Example</h4>
            <pre className="text-xs text-[var(--text-muted)] font-mono bg-[var(--surface-2)] rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{example}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
