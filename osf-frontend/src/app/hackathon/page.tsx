"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";
const LS_KEY = "sim_v5_api_key";

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

export default function HackathonPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [info, setInfo] = useState<PingInfo | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Hydrate key from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = localStorage.getItem(LS_KEY);
    if (k) setApiKey(k);
  }, []);

  // Load ping + catalog whenever the key changes
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
          throw new Error("401");
        }
        if (!pingRes.ok) throw new Error(`ping HTTP ${pingRes.status}`);
        if (!machRes.ok) throw new Error(`catalog HTTP ${machRes.status}`);
        const ping = await pingRes.json();
        const cat = await machRes.json();
        setInfo({ who: ping.who, tier: ping.tier, backend: ping.backend });
        setMachines(cat.machines || []);
      })
      .catch((e: Error) => {
        if (e.message === "401") {
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
  };

  const handleClear = () => {
    localStorage.removeItem(LS_KEY);
    setApiKey(null);
    setInfo(null);
    setMachines([]);
    setError(null);
  };

  const filtered = filter
    ? machines.filter((m) => m.machineId.includes(filter) || m.type.includes(filter))
    : machines;

  const byType = filtered.reduce<Record<string, Machine[]>>((acc, m) => {
    (acc[m.type] = acc[m.type] || []).push(m);
    return acc;
  }, {});

  const sampleMachine = machines[0]?.machineId || "cnc-01";

  // ─────────────────────────────────────────────────────────────
  // NO KEY → Input form
  // ─────────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>sim-v5 Hackathon API</h1>
        <p style={{ color: "#666", marginBottom: 32 }}>
          Read-only Zugriff auf die sim-v5 Factory (PROD, live) — REST für ERP/QMS/WMS/Windchill und OPC-UA-Shim für 200+ Maschinen.
        </p>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: 12, borderRadius: 6, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ background: "#f9fafb", padding: 24, borderRadius: 8, border: "1px solid #e5e7eb" }}>
          <label htmlFor="apikey" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
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
            style={{ width: "100%", padding: "10px 12px", fontFamily: "monospace", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 4, marginBottom: 12, boxSizing: "border-box" }}
          />
          <button
            type="submit"
            disabled={!keyInput.trim()}
            style={{ padding: "10px 20px", background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 4, fontWeight: 600, cursor: "pointer", opacity: keyInput.trim() ? 1 : 0.5 }}
          >
            Verbinden
          </button>
          <p style={{ marginTop: 16, color: "#666", fontSize: 13 }}>
            Du bekommst den Key per Mail vom Veranstalter. Er wird lokal in deinem Browser gespeichert (kein Server-Login).
          </p>
        </form>

        <div style={{ marginTop: 24, color: "#666", fontSize: 13 }}>
          Doku auch ohne Key:{" "}
          <Link href={`${API_BASE}/api/sim-v5/docs`} style={{ color: "#1d4ed8" }}>OpenAPI / Swagger</Link>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // KEY OK → Dashboard
  // ─────────────────────────────────────────────────────────────
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>sim-v5 Hackathon API</h1>
      <p style={{ color: "#666" }}>
        Read-only Zugriff auf die sim-v5 Factory (PROD, live) — REST für ERP/QMS/WMS/Windchill und OPC-UA-Shim für 200+ Maschinen.
      </p>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: 12, borderRadius: 6, margin: "16px 0" }}>
          {error}
        </div>
      )}

      <section style={{ background: "#f9fafb", padding: 16, borderRadius: 8, margin: "24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Dein Zugang</h2>
          {info ? (
            <>
              <div><strong>Email:</strong> {info.who || "—"}</div>
              <div><strong>Tier:</strong> {info.tier || "—"}</div>
              <div><strong>Backend:</strong> <code style={{ fontSize: 13 }}>{info.backend}</code></div>
            </>
          ) : (
            <div style={{ color: "#666" }}>{loading ? "Verbinde..." : "—"}</div>
          )}
        </div>
        <button
          onClick={handleClear}
          style={{ padding: "6px 12px", background: "#fff", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
        >
          Key wechseln
        </button>
      </section>

      <section style={{ margin: "32px 0" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Quickstart</h2>
        <pre style={{ background: "#1f2937", color: "#e5e7eb", padding: 16, borderRadius: 6, overflow: "auto", fontFamily: "monospace", fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>
{`# 1. Machine-Catalog
curl -H 'X-API-Key: ${apiKey}' \\
  https://osf-api.zeroguess.ai/api/sim-v5/opcua/machines

# 2. OPC-UA Browse (root of ${sampleMachine})
curl -H 'X-API-Key: ${apiKey}' \\
  'https://osf-api.zeroguess.ai/api/sim-v5/opcua/${sampleMachine}/browse?nodeId=ObjectsFolder'

# 3. ERP — Active Orders
curl -H 'X-API-Key: ${apiKey}' \\
  https://osf-api.zeroguess.ai/api/sim-v5/erp/api/orders/active

# 4. OPC-UA SSE Stream (Server-Sent Events)
curl -N -H 'X-API-Key: ${apiKey}' \\
  'https://osf-api.zeroguess.ai/api/sim-v5/opcua/${sampleMachine}/stream?nodeIds=ns%3D1%3Bs%3DState&intervalMs=1000'`}
        </pre>
        <div style={{ marginTop: 12 }}>
          <Link href={`${API_BASE}/api/sim-v5/docs`} style={{ color: "#1d4ed8", marginRight: 16 }}>OpenAPI Docs (Swagger)</Link>
          <Link href={`${API_BASE}/api/sim-v5/openapi.json`} style={{ color: "#1d4ed8" }}>openapi.json</Link>
        </div>
      </section>

      <section style={{ margin: "32px 0" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Machine Catalog ({machines.length})</h2>
        <input
          type="search"
          placeholder="Filter machineId or type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4, marginBottom: 16, boxSizing: "border-box" }}
        />
        {loading && <div>Lade...</div>}
        {!loading && Object.keys(byType).sort().map((type) => (
          <details key={type} open style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, padding: "6px 0" }}>
              {type} ({byType[type].length})
            </summary>
            <table style={{ width: "100%", marginTop: 8, fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: 6, textAlign: "left", border: "1px solid #e5e7eb" }}>machineId</th>
                  <th style={{ padding: 6, textAlign: "left", border: "1px solid #e5e7eb" }}>OPC-UA Endpoint</th>
                  <th style={{ padding: 6, textAlign: "left", border: "1px solid #e5e7eb" }}>Companions</th>
                  <th style={{ padding: 6, textAlign: "left", border: "1px solid #e5e7eb" }}>REST</th>
                </tr>
              </thead>
              <tbody>
                {byType[type].map((m) => (
                  <tr key={m.machineId}>
                    <td style={{ padding: 6, border: "1px solid #e5e7eb", fontFamily: "monospace" }}>{m.machineId}</td>
                    <td style={{ padding: 6, border: "1px solid #e5e7eb", fontFamily: "monospace", fontSize: 12 }}>{m.endpoint}</td>
                    <td style={{ padding: 6, border: "1px solid #e5e7eb", fontSize: 12 }}>{m.companions.join(", ")}</td>
                    <td style={{ padding: 6, border: "1px solid #e5e7eb" }}>
                      <a href={`${API_BASE}/api/sim-v5/opcua/${m.machineId}/browse`} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8", fontSize: 12 }}>browse</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>

      <section style={{ margin: "32px 0", color: "#666", fontSize: 13 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#000" }}>Hinweise</h3>
        <ul style={{ paddingLeft: 20 }}>
          <li>Alle Endpoints sind <strong>GET-only</strong> und gegen 60 req/min/key rate-limited</li>
          <li>OPC-UA ist <strong>read-only</strong> via REST-Shim (Write-Service nicht freigegeben)</li>
          <li>SSE-Streams idle-closen nach 5min Inaktivität</li>
          <li>Fragen / Support: <a href="mailto:tobias.lante74@gmail.com" style={{ color: "#1d4ed8" }}>tobias.lante74@gmail.com</a></li>
        </ul>
      </section>
    </main>
  );
}
