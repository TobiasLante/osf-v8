"use client";

import { useEffect, useState, FormEvent, ReactNode } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";
const LS_KEY = "sim_v5_api_key";
const LS_TAB = "sim_v5_active_tab";

interface Machine {
  machineId: string;
  type: string;
  endpoint: string;
  hostPort: number;
  companions: string[];
}

interface PingInfo {
  who: string | null;
  tier: string | null;
  backend: string;
}

interface ExpiredInfo {
  expired_at: string;
  contact: string;
  message: string;
}

const REST_SERVICES = [
  { id: "erp",       name: "api-erp",       desc: "Orders, Customers, Materials, Confirmations, BDE, Reservations" },
  { id: "qms",       name: "api-qms",       desc: "Quality Lots, Inspections, Non-Conformities, Tool Lifecycle" },
  { id: "wms",       name: "api-wms",       desc: "Warehouse Bins, Movements, Inventory, Stock Levels" },
  { id: "windchill", name: "api-windchill", desc: "PLM, Part Master, BOM, Drawings, Revisions, Mould-Crib" },
  { id: "gateway",   name: "api-gateway",   desc: "Aggregator, Cross-Service Queries, Factory-State Snapshot" },
];

function CopyButton({ value, label = "Kopieren" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2 py-1 rounded-sm border border-border bg-bg-surface-2 hover:bg-bg-surface-3 text-text-muted hover:text-text transition-colors"
    >
      {copied ? "✓ kopiert" : label}
    </button>
  );
}

function CodeBlock({ code, copyValue }: { code: string; copyValue?: string }) {
  return (
    <div className="relative">
      <pre className="bg-bg-surface-2 border border-border text-text rounded-sm p-4 overflow-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all">
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={copyValue ?? code} />
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="bg-bg-surface border border-border rounded-sm p-4">{children}</div>;
}

function MachineRow({ m, apiKey }: { m: Machine; apiKey: string }) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = `${API_BASE}/api/sim-v5/opcua/${m.machineId}/browse`;
  const curl = `curl -H 'X-API-Key: ${apiKey}' '${url}'`;

  const toggle = async () => {
    if (data !== null || err !== null) {
      setData(null);
      setErr(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(url, { headers: { "X-API-Key": apiKey } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-3 py-2 font-mono">{m.machineId}</td>
        <td className="px-3 py-2 font-mono text-xs text-text-muted">{m.endpoint}</td>
        <td className="px-3 py-2 text-xs text-text-muted">{m.companions.join(", ")}</td>
        <td className="px-3 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggle}
              disabled={loading}
              className="text-xs px-2 py-1 rounded-sm border border-border bg-bg-surface-2 hover:bg-bg-surface-3 text-text-muted hover:text-text disabled:opacity-50"
            >
              {loading ? "..." : (data !== null || err !== null) ? "schließen" : "browse"}
            </button>
            <CopyButton value={curl} label="curl" />
          </div>
        </td>
      </tr>
      {(data !== null || err !== null) && (
        <tr>
          <td colSpan={4} className="px-3 py-3 bg-bg-surface-2">
            {err && <div className="text-red-300 text-sm">Fehler: {err}</div>}
            {data !== null && (
              <pre className="text-xs overflow-auto whitespace-pre-wrap break-all font-mono leading-relaxed text-text">
                {JSON.stringify(data, null, 2)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function HackathonPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [info, setInfo] = useState<PingInfo | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<ExpiredInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"opcua" | "rest">("opcua");

  // Hydrate from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = localStorage.getItem(LS_KEY);
    if (k) setApiKey(k);
    const t = localStorage.getItem(LS_TAB);
    if (t === "rest" || t === "opcua") setTab(t);
  }, []);

  // Persist tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_TAB, tab);
  }, [tab]);

  // Load on key change
  useEffect(() => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    const headers = { "X-API-Key": apiKey };
    Promise.all([
      fetch(`${API_BASE}/api/sim-v5/ping`, { headers }),
      fetch(`${API_BASE}/api/sim-v5/opcua/machines`, { headers }),
    ])
      .then(async ([pingRes, machRes]) => {
        if (pingRes.status === 401 || machRes.status === 401) {
          const errRes = pingRes.status === 401 ? pingRes : machRes;
          const errBody = await errRes.json().catch(() => ({}));
          if (errBody && errBody.code === "API_KEY_EXPIRED") {
            throw Object.assign(new Error("EXPIRED"), { expiredInfo: errBody });
          }
          throw new Error("401");
        }
        if (!pingRes.ok) throw new Error(`ping HTTP ${pingRes.status}`);
        if (!machRes.ok) throw new Error(`catalog HTTP ${machRes.status}`);
        const ping = await pingRes.json();
        const cat = await machRes.json();
        setInfo({ who: ping.who, tier: ping.tier, backend: ping.backend });
        setMachines(cat.machines || []);
      })
      .catch((e: Error & { expiredInfo?: ExpiredInfo }) => {
        if (e.message === "EXPIRED" && e.expiredInfo) {
          setExpired(e.expiredInfo);
          localStorage.removeItem(LS_KEY);
          setApiKey(null);
          setInfo(null);
          setMachines([]);
        } else if (e.message === "401") {
          setError("API-Key ungültig oder abgelaufen. Bitte erneut eingeben.");
          localStorage.removeItem(LS_KEY);
          setApiKey(null);
          setInfo(null);
          setMachines([]);
        } else {
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, [apiKey]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const k = keyInput.trim();
    if (!k) return;
    localStorage.setItem(LS_KEY, k);
    setApiKey(k);
    setKeyInput("");
    setExpired(null);
    setError(null);
  };

  const handleClear = () => {
    localStorage.removeItem(LS_KEY);
    setApiKey(null);
    setInfo(null);
    setMachines([]);
    setError(null);
    setExpired(null);
  };

  const filtered = filter
    ? machines.filter((m) => m.machineId.includes(filter) || m.type.includes(filter))
    : machines;

  const byType = filtered.reduce<Record<string, Machine[]>>((acc, m) => {
    (acc[m.type] = acc[m.type] || []).push(m);
    return acc;
  }, {});

  const sampleMachine = machines[0]?.machineId || "cnc-01";
  const k = apiKey || "<dein-api-key>";

  const claudeCodePrompt = `Du hast vollen lesenden Zugriff auf die sim-v5 Hackathon-API (Smart Factory in Echtbetrieb).

Base URL:     https://osf-api.zeroguess.ai/api/sim-v5
API-Key:      ${k}
Auth:         HTTP-Header \`X-API-Key: ${k}\` bei jedem Request
OpenAPI Spec: https://osf-api.zeroguess.ai/api/sim-v5/openapi.json   (131 Endpoints, ohne Auth abrufbar)

Verfügbar:
- 5 REST APIs (read-only, proxied):
    /erp        Orders, Customers, Materials, Confirmations, BDE
    /qms        Quality Lots, Inspections, NCs, Tool-Lifecycle
    /wms        Warehouse Bins, Movements, Inventory
    /windchill  PLM, Part Master, BOM, Drawings, Mould-Crib
    /gateway    Cross-Service Aggregator, Factory-State Snapshot
- OPC-UA-Shim für 211 Maschinen:
    /opcua/machines                Catalog
    /opcua/{machineId}/browse      Browse Address-Space
    /opcua/{machineId}/read        Read Node-Values
    /opcua/{machineId}/stream      SSE-Stream von Node-Updates

Constraints:
- GET-only (POST/PUT/DELETE liefern 405)
- Rate-Limit: 60 Requests/Minute pro Key
- SSE-Streams idle-closen nach 5 min Inaktivität

Aufgabe (Bitte zuerst ausführen):
1. Hole die OpenAPI-Spec via GET https://osf-api.zeroguess.ai/api/sim-v5/openapi.json
2. Liste mir gruppiert pro Service (erp/qms/wms/windchill/gateway/opcua) die 5 wichtigsten GET-Endpoints
3. Schlag mir 3 Hackathon-Ideen vor, die ich mit diesen Endpoints in wenigen Stunden umsetzen kann

Danach warte auf meine Wahl und baue das gewählte Projekt schrittweise.`;

  const curlPing       = `curl -H 'X-API-Key: ${k}' https://osf-api.zeroguess.ai/api/sim-v5/ping`;
  const curlMachines   = `curl -H 'X-API-Key: ${k}' https://osf-api.zeroguess.ai/api/sim-v5/opcua/machines`;
  const curlBrowse     = `curl -H 'X-API-Key: ${k}' 'https://osf-api.zeroguess.ai/api/sim-v5/opcua/${sampleMachine}/browse?nodeId=ObjectsFolder'`;
  const curlErpOrders  = `curl -H 'X-API-Key: ${k}' https://osf-api.zeroguess.ai/api/sim-v5/erp/api/orders/active`;
  const curlSSE        = `curl -N -H 'X-API-Key: ${k}' 'https://osf-api.zeroguess.ai/api/sim-v5/opcua/${sampleMachine}/stream?nodeIds=ns%3D1%3Bs%3DState&intervalMs=1000'`;

  // ─────────────────────────────────────────────────────────────
  // NO KEY → Input form
  // ─────────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-12 text-text">
        <h1 className="text-3xl font-bold mb-2">sim-v5 Hackathon API</h1>
        <p className="text-text-muted mb-8">
          Read-only Zugriff auf die sim-v5 Factory (live PROD) — REST für ERP/QMS/WMS/Windchill und OPC-UA-Shim für 211 Maschinen.
        </p>

        {expired && (
          <div className="bg-amber-950/30 border border-amber-800 text-amber-100 px-4 py-4 rounded-sm mb-4 space-y-2">
            <div className="font-semibold text-amber-50">API-Key abgelaufen</div>
            <div className="text-sm">
              Dein Key ist am{" "}
              <span className="font-mono">{new Date(expired.expired_at).toISOString().slice(0, 10)}</span>
              {" "}abgelaufen.
            </div>
            <div className="text-sm">
              Bitte melde dich bei{" "}
              <a href={`mailto:${expired.contact}?subject=Neuer Hackathon API-Key bitte`} className="text-accent hover:text-accent-hover underline">
                {expired.contact}
              </a>
              {" "}für einen neuen Key.
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-900 text-red-200 px-4 py-3 rounded-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-bg-surface border border-border rounded-sm p-6">
          <label htmlFor="apikey" className="block font-semibold mb-2">
            Dein API-Key
          </label>
          <input
            id="apikey"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="osf_hk_..."
            className="w-full px-3 py-2.5 font-mono text-sm bg-bg-surface-2 border border-border rounded-sm text-text placeholder:text-text-dim mb-3 focus:border-accent/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!keyInput.trim()}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-bg rounded-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Verbinden
          </button>
          <p className="mt-4 text-text-muted text-sm">
            Du bekommst den Key per Mail vom Veranstalter. Er wird lokal in deinem Browser gespeichert (kein Server-Login).
          </p>
        </form>

        <div className="mt-6 text-text-muted text-sm">
          Doku auch ohne Key:{" "}
          <Link href={`${API_BASE}/api/sim-v5/docs`} className="text-accent hover:text-accent-hover">OpenAPI / Swagger</Link>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // KEY OK → Dashboard
  // ─────────────────────────────────────────────────────────────
  return (
    <main className="max-w-5xl mx-auto px-4 py-8 text-text">
      <h1 className="text-3xl font-bold mb-2">sim-v5 Hackathon API</h1>
      <p className="text-text-muted mb-6">
        Read-only Zugriff auf die sim-v5 Factory (live PROD) — REST für ERP/QMS/WMS/Windchill und OPC-UA-Shim für 211 Maschinen.
      </p>

      {error && (
        <div className="bg-red-950/30 border border-red-900 text-red-200 px-4 py-3 rounded-sm mb-4">
          {error}
        </div>
      )}

      {/* ── Dein Zugang ── */}
      <Card>
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div className="space-y-1 text-sm">
            <h2 className="text-lg font-semibold mb-2">Dein Zugang</h2>
            {info ? (
              <>
                <div><span className="text-text-muted">Email:</span> {info.who || "—"}</div>
                <div><span className="text-text-muted">Tier:</span> {info.tier || "—"}</div>
                <div><span className="text-text-muted">Backend:</span> <code className="text-text">{info.backend}</code></div>
                <div className="pt-2 flex items-center gap-2">
                  <span className="text-text-muted">API-Key:</span>
                  <code className="font-mono text-xs bg-bg-surface-2 border border-border px-2 py-1 rounded-sm">{apiKey}</code>
                  <CopyButton value={apiKey} />
                </div>
              </>
            ) : (
              <div className="text-text-muted">{loading ? "Verbinde..." : "—"}</div>
            )}
          </div>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm border border-border bg-bg-surface-2 hover:bg-bg-surface-3 rounded-sm text-text-muted hover:text-text"
          >
            Key wechseln
          </button>
        </div>
      </Card>

      {/* ── Claude Code Setup ── */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Claude Code Setup</h2>
        <p className="text-text-muted text-sm mb-3">
          Kopier den Block und kleb ihn in deinen ersten Chat in <strong className="text-text">Claude Code für Windows</strong> ein. Claude bekommt damit alle Infos um die API selbst abzufragen (OpenAPI + Key + Constraints) und schlägt dir Hackathon-Ideen vor.
        </p>
        <CodeBlock code={claudeCodePrompt} />
      </section>

      {/* ── curl Quickstart ── */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">curl Quickstart</h2>
        <p className="text-text-muted text-sm mb-3">
          Für Terminal-Nutzer. Alle Snippets enthalten deinen Key — direkt kopieren und ausführen.
        </p>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-text-muted mb-1">1. Health / Wer-bin-ich</div>
            <CodeBlock code={curlPing} />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">2. Machine Catalog (211)</div>
            <CodeBlock code={curlMachines} />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">3. OPC-UA Browse (root of {sampleMachine})</div>
            <CodeBlock code={curlBrowse} />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">4. ERP — Active Orders</div>
            <CodeBlock code={curlErpOrders} />
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">5. OPC-UA SSE Stream</div>
            <CodeBlock code={curlSSE} />
          </div>
        </div>
        <div className="mt-4 flex gap-4 text-sm">
          <Link href={`${API_BASE}/api/sim-v5/docs`} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover">OpenAPI Docs (Swagger) →</Link>
          <Link href={`${API_BASE}/api/sim-v5/openapi.json`} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover">openapi.json →</Link>
        </div>
      </section>

      {/* ── Tabs: OPC-UA / REST ── */}
      <section className="mt-10">
        <div className="flex gap-1 border-b border-border mb-4">
          <button
            onClick={() => setTab("opcua")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "opcua"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            OPC-UA Maschinen ({machines.length})
          </button>
          <button
            onClick={() => setTab("rest")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "rest"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            REST APIs ({REST_SERVICES.length})
          </button>
        </div>

        {tab === "opcua" && (
          <div>
            <input
              type="search"
              placeholder="Filter machineId or type..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm text-text placeholder:text-text-dim mb-4 focus:border-accent/40 focus:outline-none"
            />
            {loading && <div className="text-text-muted">Lade...</div>}
            {!loading && Object.keys(byType).sort().map((type) => (
              <details key={type} open className="mb-3 border border-border rounded-sm overflow-hidden">
                <summary className="cursor-pointer font-semibold bg-bg-surface px-3 py-2 hover:bg-bg-surface-2">
                  {type} ({byType[type].length})
                </summary>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-surface-2 text-text-muted text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">machineId</th>
                        <th className="text-left px-3 py-2 font-medium">OPC-UA Endpoint</th>
                        <th className="text-left px-3 py-2 font-medium">Companions</th>
                        <th className="text-left px-3 py-2 font-medium">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byType[type].map((m) => (
                        <MachineRow key={m.machineId} m={m} apiKey={apiKey} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}

        {tab === "rest" && (
          <div className="grid sm:grid-cols-2 gap-3">
            {REST_SERVICES.map((s) => (
              <div key={s.id} className="bg-bg-surface border border-border rounded-sm p-4 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-mono font-semibold">{s.name}</h3>
                  <code className="text-xs text-text-muted">/api/sim-v5/{s.id}/{"*"}</code>
                </div>
                <p className="text-sm text-text-muted leading-snug">{s.desc}</p>
                <div className="mt-auto pt-2">
                  <Link
                    href={`${API_BASE}/api/sim-v5/docs`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-hover text-sm"
                  >
                    in Swagger öffnen →
                  </Link>
                </div>
              </div>
            ))}
            <div className="bg-bg-surface border border-border rounded-sm p-4 col-span-full text-sm text-text-muted">
              Endpoint-Details und Schemas siehe{" "}
              <Link href={`${API_BASE}/api/sim-v5/docs`} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover">Swagger UI</Link>
              {" "}— 131 Endpoints, gefiltert nach Tag. Authorize-Dialog: deinen API-Key einkleben, dann &quot;Try it out&quot;.
            </div>
          </div>
        )}
      </section>

      {/* ── Hinweise ── */}
      <section className="mt-10 text-text-muted text-sm">
        <h3 className="text-base font-semibold text-text mb-2">Hinweise</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Alle Endpoints sind <strong className="text-text">GET-only</strong> und gegen 60 req/min/key rate-limited</li>
          <li>OPC-UA ist <strong className="text-text">read-only</strong> via REST-Shim (Write-Service nicht freigegeben)</li>
          <li>SSE-Streams idle-closen nach 5 min Inaktivität</li>
          <li>Fragen / Support: <a href="mailto:tobias.lante74@gmail.com" className="text-accent hover:text-accent-hover">tobias.lante74@gmail.com</a></li>
        </ul>
      </section>
    </main>
  );
}
