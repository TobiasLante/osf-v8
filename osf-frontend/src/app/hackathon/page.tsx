"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";

interface Machine {
  machineId: string;
  type: string;
  endpoint: string;
  hostPort: number;
  companions: string[];
}

interface UserInfo {
  email?: string;
  apiKey?: string;
  tier?: string;
}

export default function HackathonPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
        if (meRes.ok) {
          const me = await meRes.json();
          const u = me.user || me;
          setUser({ email: u.email, apiKey: u.api_key_masked, tier: u.tier });
        }
        const mRes = await fetch(`${API_BASE}/api/sim-v5/opcua/machines`, { credentials: "include" });
        if (mRes.ok) {
          const data = await mRes.json();
          setMachines(data.machines || []);
        } else if (mRes.status === 401) {
          setError("Bitte zuerst einloggen.");
        } else {
          setError(`Catalog HTTP ${mRes.status}`);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = filter
    ? machines.filter((m) => m.machineId.includes(filter) || m.type.includes(filter))
    : machines;

  const byType = filtered.reduce<Record<string, Machine[]>>((acc, m) => {
    (acc[m.type] = acc[m.type] || []).push(m);
    return acc;
  }, {});

  const apiKey = user?.apiKey || "<dein-api-key>";
  const sampleMachine = machines[0]?.machineId || "cnc-01";

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>sim-v5 Hackathon API</h1>
      <p style={{ color: "#666" }}>
        Read-only Zugriff auf die sim-v5 Factory (PROD, live) — REST für ERP/QMS/WMS/Windchill und OPC-UA-Shim für 200+ Maschinen.
      </p>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: 12, borderRadius: 6, margin: "16px 0" }}>
          {error} {error.includes("einloggen") && <Link href="/login" style={{ marginLeft: 8, color: "#1d4ed8" }}>Login</Link>}
        </div>
      )}

      <section style={{ background: "#f9fafb", padding: 16, borderRadius: 8, margin: "24px 0" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Dein Zugang</h2>
        {user ? (
          <>
            <div><strong>Email:</strong> {user.email}</div>
            <div><strong>Tier:</strong> {user.tier || "—"}</div>
            <div style={{ marginTop: 8 }}>
              <strong>API-Key:</strong>{" "}
              {user.apiKey ? (
                <code style={{ background: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 13 }}>{user.apiKey}</code>
              ) : (
                <span style={{ color: "#92400e" }}>noch nicht erstellt — bitte beim Admin anfordern</span>
              )}
            </div>
          </>
        ) : (
          <Link href="/login" style={{ color: "#1d4ed8" }}>Login →</Link>
        )}
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
          style={{ width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4, marginBottom: 16 }}
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
