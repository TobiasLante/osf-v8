"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tier: string;
  email_verified: boolean;
  locked_until: string | null;
  created_at: string;
}

interface Stats {
  users: { total: number; verified: number; activeLastWeek: number };
  system: { flowRuns: number; agentRuns: number; chatSessions: number };
  registrationsPerWeek: { week: string; count: number }[];
}

interface NewsItem {
  id: string;
  title: string;
  content: string;
  author_name: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

interface BannerState {
  message: string;
  type: "maintenance" | "news";
  active: boolean;
}

type Tab = "health" | "users" | "stats" | "activity" | "news" | "banner" | "infra" | "nrpods" | "agents" | "roles" | "categories" | "mcp" | "classifications" | "audit" | "dashboard" | "profiles";

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("health");

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  if (loading || !user || user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <main className="pt-24 pb-16 px-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text">Admin Panel</h1>
        <a
          href={process.env.NEXT_PUBLIC_UMAMI_URL || "https://osf-api.zeroguess.ai/umami"}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-xs font-medium rounded-md border border-border bg-bg-surface text-text-muted hover:text-text hover:border-accent/25 transition-colors"
        >
          Umami Analytics &rarr;
        </a>
      </div>

      <div className="flex gap-2 mb-6 border-b border-border">
        {(["health", "users", "stats", "activity", "news", "banner", "infra", "nrpods", "agents", "roles", "categories", "mcp", "classifications", "audit", "dashboard", "profiles"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {{ health: "Health", users: "Users", stats: "Stats", activity: "Activity", news: "News", banner: "Banner", infra: "Infrastructure", nrpods: "NR Pods", agents: "Agents", roles: "Roles", categories: "Categories", mcp: "MCP Servers", classifications: "Classifications", audit: "Audit", dashboard: "Dashboard", profiles: "Profiles" }[t]}
          </button>
        ))}
      </div>

      {tab === "health" && <ErrorBoundary name="health"><HealthTab onNavigate={setTab} /></ErrorBoundary>}
      {tab === "users" && <ErrorBoundary name="users"><UsersTab /></ErrorBoundary>}
      {tab === "stats" && <ErrorBoundary name="stats"><StatsTab /></ErrorBoundary>}
      {tab === "activity" && <ErrorBoundary name="activity"><ActivityTab /></ErrorBoundary>}
      {tab === "news" && <ErrorBoundary name="news"><NewsTab /></ErrorBoundary>}
      {tab === "banner" && <ErrorBoundary name="banner"><BannerTab /></ErrorBoundary>}
      {tab === "infra" && <ErrorBoundary name="infra"><InfraTab /></ErrorBoundary>}
      {tab === "nrpods" && <ErrorBoundary name="nrpods"><NrPodsTab /></ErrorBoundary>}
      {tab === "roles" && <ErrorBoundary name="roles"><RolesTab /></ErrorBoundary>}
      {tab === "categories" && <ErrorBoundary name="categories"><CategoriesTab /></ErrorBoundary>}
      {tab === "mcp" && <ErrorBoundary name="mcp"><McpServersTab /></ErrorBoundary>}
      {tab === "audit" && <ErrorBoundary name="audit"><AuditTab /></ErrorBoundary>}
      {tab === "agents" && <ErrorBoundary name="agents"><AgentsTab /></ErrorBoundary>}
      {tab === "classifications" && <ErrorBoundary name="classifications"><ClassificationsTab /></ErrorBoundary>}
      {tab === "dashboard" && <ErrorBoundary name="dashboard"><DashboardTab /></ErrorBoundary>}
      {tab === "profiles" && <ErrorBoundary name="profiles"><TopicProfilesTab /></ErrorBoundary>}
    </main>
  );
}

// ─── Health Tab ─────────────────────────────────────────────────────────────

interface HealthComponent {
  status: "healthy" | "degraded" | "critical";
  [key: string]: any;
}

interface HealthData {
  overall: "healthy" | "degraded" | "critical";
  components: {
    gateway: HealthComponent;
    database: HealthComponent;
    llm: HealthComponent;
    nodered: HealthComponent;
    mcp: HealthComponent & { services: { name: string; ok: boolean; latencyMs: number }[] };
    factory: HealthComponent & { services: any[] };
    databases: HealthComponent & { checks: any[] };
    mqtt: HealthComponent;
    cloudflare: HealthComponent;
  };
  alerts: { severity: "warning" | "critical"; component: string; message: string }[];
  checkedAt: string;
}

const STATUS_CONFIG = {
  healthy: { dot: "bg-green-400", bg: "bg-green-500/10", text: "text-green-400", label: "All Systems Operational" },
  degraded: { dot: "bg-yellow-400", bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Degraded Performance" },
  critical: { dot: "bg-red-400", bg: "bg-red-500/10", text: "text-red-400", label: "System Issues" },
} as const;

function HealthTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const d = await apiFetch<HealthData>("/admin/health");
      setData(d);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    intervalRef.current = setInterval(fetchHealth, 10000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchHealth]);

  if (error && !data) return <div className="text-red-400 text-sm">{error}</div>;
  if (!data) return <div className="text-text-muted text-sm">Loading health data...</div>;

  const overall = STATUS_CONFIG[data.overall];

  interface ServiceDetail { name: string; ok: boolean; latencyMs?: number; error?: string; badge?: string }
  type HealthTile = { key: string; label: string; status: "healthy" | "degraded" | "critical"; metrics: string; services?: ServiceDetail[]; navigateTo?: Tab };

  const nr = data.components.nodered;
  const llm = data.components.llm;
  const mcp = data.components.mcp;
  const factory = data.components.factory;
  const dbs = data.components.databases;

  const components: HealthTile[] = [
    {
      key: "gateway", label: "Gateway", status: data.components.gateway.status,
      metrics: `${formatUptime(data.components.gateway.uptimeSeconds)} uptime, ${data.components.gateway.memoryMb} MB RAM`,
      navigateTo: "infra",
    },
    {
      key: "database", label: "OSF Database", status: data.components.database.status,
      metrics: `${data.components.database.connectionsUsed}/${data.components.database.connectionsMax} conns, ${data.components.database.latencyMs}ms`,
      navigateTo: "infra",
    },
    {
      key: "llm", label: "LLM Servers", status: llm.status,
      metrics: llm.online
        ? `Online, ${llm.activeRequests} active, ${llm.queuedRequests} queued`
        : "Offline",
      services: [
        { name: "Premium (5001)", ok: llm.online, badge: llm.online ? "online" : "offline" },
        { name: "Free (5002)", ok: llm.online, badge: llm.online ? "online" : "offline" },
      ],
      navigateTo: "infra",
    },
    {
      key: "nodered", label: "Node-RED Pool", status: nr.status,
      metrics: `${nr.warm} warm, ${nr.assigned} assigned, ${nr.starting} starting`,
      services: [
        { name: "Warm Pods", ok: nr.warm >= nr.targetSize, badge: `${nr.warm}/${nr.targetSize}` },
        { name: "Assigned Pods", ok: true, badge: `${nr.assigned}` },
        { name: "Starting Pods", ok: true, badge: `${nr.starting}` },
        { name: "Pool Healthy", ok: nr.poolHealthy, badge: nr.poolHealthy ? "yes" : "no" },
      ],
      navigateTo: "nrpods",
    },
    {
      key: "mcp", label: "MCP Services", status: mcp.status,
      metrics: `${mcp.services.filter((s: any) => s.ok).length}/${mcp.services.length} online`,
      services: mcp.services.map((s: any) => ({ name: s.name, ok: s.ok, latencyMs: s.latencyMs })),
      navigateTo: "infra",
    },
    {
      key: "factory", label: "Factory Simulator", status: factory.status,
      metrics: `${factory.services.filter((s: any) => s.ok).length}/${factory.services.length} services online`,
      services: factory.services.map((s: any) => ({
        name: s.name,
        ok: s.ok,
        latencyMs: s.latencyMs,
        badge: s.ok ? (s.leader ? "leader" : s.ready === false ? "backup" : "ok") : "down",
      })),
      navigateTo: "infra",
    },
    {
      key: "databases", label: "Databases", status: dbs?.status || "healthy",
      metrics: dbs?.checks ? `${dbs.checks.filter((c: any) => c.ok).length}/${dbs.checks.length} healthy` : "OK",
      services: dbs?.checks?.map((c: any) => ({ name: c.name, ok: c.ok, latencyMs: c.latencyMs, error: c.error })),
      navigateTo: "infra",
    },
    {
      key: "mqtt", label: "MQTT Broker", status: data.components.mqtt?.status || "healthy",
      metrics: data.components.mqtt?.reachable ? "Connected" : "Disconnected",
      services: [{ name: "EMQX (31883)", ok: !!data.components.mqtt?.reachable }],
    },
    {
      key: "email", label: "Email (Resend)", status: (data.components as any).email?.status || "critical",
      metrics: (data.components as any).email?.configured
        ? ((data.components as any).email?.reachable ? "Configured & Reachable" : "Configured, API unreachable")
        : "Not configured",
      services: [
        { name: "API Key", ok: !!(data.components as any).email?.configured, badge: (data.components as any).email?.configured ? "set" : "missing" },
        { name: "Resend API", ok: !!(data.components as any).email?.reachable, badge: (data.components as any).email?.reachable ? "online" : "offline" },
      ],
    },
    {
      key: "cloudflare", label: "Cloudflare", status: data.components.cloudflare.status,
      metrics: data.components.cloudflare.reachable ? "Reachable" : "Unreachable",
      services: [{ name: "CF Tunnel", ok: !!data.components.cloudflare.reachable }],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Overall Status Banner */}
      <div className={`rounded-lg border border-border p-6 ${overall.bg}`}>
        <div className="flex items-center gap-3">
          <span className={`w-4 h-4 rounded-full ${overall.dot} ${data.overall !== "healthy" ? "animate-pulse" : ""}`} />
          <div>
            <h2 className={`text-xl font-bold ${overall.text}`}>{overall.label}</h2>
            <p className="text-xs text-text-muted mt-1">
              Last checked: {new Date(data.checkedAt).toLocaleTimeString()} (auto-refresh 10s)
            </p>
          </div>
        </div>
      </div>

      {/* Component Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {components.map((c) => {
          const cfg = STATUS_CONFIG[c.status];
          return (
            <button
              key={c.key}
              onClick={() => c.navigateTo && onNavigate(c.navigateTo)}
              className={`text-left rounded-lg border border-border/50 bg-bg-surface p-4 transition-colors ${
                c.navigateTo ? "hover:border-accent/25 cursor-pointer" : "cursor-default"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-sm font-medium text-text">{c.label}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                  {c.status}
                </span>
              </div>
              <p className="text-xs text-text-muted font-mono">{c.metrics}</p>
              {c.services && c.services.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
                  {c.services.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? "bg-green-400" : "bg-red-400"}`} />
                      <span className={s.ok ? "text-text-muted" : "text-red-400 font-medium"}>{s.name}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {s.badge && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            s.badge === "leader" ? "bg-blue-500/20 text-blue-400" :
                            s.badge === "backup" ? "bg-yellow-500/20 text-yellow-400" :
                            s.badge === "down" ? "bg-red-500/20 text-red-400" :
                            s.badge === "online" ? "bg-green-500/20 text-green-400" :
                            s.badge === "offline" ? "bg-red-500/20 text-red-400" :
                            "bg-white/5 text-text-muted"
                          }`}>{s.badge}</span>
                        )}
                        {s.latencyMs != null && (
                          <span className="text-text-muted font-mono">{s.latencyMs}ms</span>
                        )}
                        {s.error && !s.latencyMs && (
                          <span className="text-red-400 truncate max-w-[120px]" title={s.error}>{s.error}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text">Active Alerts</h3>
          {data.alerts.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${
                a.severity === "critical"
                  ? "border-red-500/30 bg-red-500/5 text-red-400"
                  : "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
              }`}
            >
              <span className="font-medium capitalize">{a.component}</span>
              <span className="text-text-muted">—</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {data.alerts.length === 0 && (
        <p className="text-sm text-text-muted">No active alerts.</p>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch<{ users: AdminUser[]; total: number; limit: number; offset: number }>(
        `/admin/users?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      );
      setUsers(data.users);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    }
  }, [page]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const updateUser = async (id: string, updates: Record<string, any>) => {
    try {
      await apiFetch(`/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteUser = async (id: string, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
      loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <span className="text-text-muted text-sm">{total} users</span>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-accent text-bg text-sm rounded hover:bg-accent-hover transition-colors"
        >
          Create User
        </button>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadUsers();
          }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Tier</th>
              <th className="py-2 pr-4">Verified</th>
              <th className="py-2 pr-4">Locked</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="py-2 pr-4 text-text">{u.email}</td>
                <td className="py-2 pr-4 text-text-muted">{u.name || "—"}</td>
                <td className="py-2 pr-4">
                  <select
                    value={u.role || "user"}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    className="bg-bg border border-border rounded px-2 py-0.5 text-text text-xs [&>option]:text-gray-900 [&>option]:bg-white"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="py-2 pr-4 text-text-muted">
                  <select
                    value={u.tier}
                    onChange={(e) => updateUser(u.id, { tier: e.target.value })}
                    className="bg-bg border border-border rounded px-2 py-0.5 text-text text-xs [&>option]:text-gray-900 [&>option]:bg-white"
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="team">team</option>
                  </select>
                </td>
                <td className="py-2 pr-4">
                  <button
                    onClick={() => updateUser(u.id, { email_verified: !u.email_verified })}
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      u.email_verified
                        ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                        : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    } transition-colors`}
                  >
                    {u.email_verified ? "Verified" : "Unverified"}
                  </button>
                </td>
                <td className="py-2 pr-4">
                  {u.locked_until && new Date(u.locked_until) > new Date() ? (
                    <button
                      onClick={() => updateUser(u.id, { locked_until: null })}
                      className="text-xs font-medium px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      title={`Locked until ${new Date(u.locked_until).toLocaleString()}`}
                    >
                      Locked
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const hours = prompt("Lock for how many hours?", "24");
                        if (!hours) return;
                        const until = new Date(Date.now() + Number(hours) * 3600000).toISOString();
                        updateUser(u.id, { locked_until: until });
                      }}
                      className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                    >
                      Open
                    </button>
                  )}
                </td>
                <td className="py-2 pr-4 text-text-muted text-xs">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteUser(u.id, u.email)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-text-muted text-xs">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-xs border border-border rounded text-text-muted hover:text-text disabled:opacity-30 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-xs border border-border rounded text-text-muted hover:text-text disabled:opacity-30 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create User Modal ─────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, name: name || undefined, role }),
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-text mb-4">Create User</h3>
        {error && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm [&>option]:text-gray-900 [&>option]:bg-white"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-accent text-bg text-sm rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Activity Tab ───────────────────────────────────────────────────────────

interface ActivityRow {
  user_id: string;
  user_email: string;
  user_name: string | null;
  period: string;
  session_count: number;
  total_minutes: number;
}

interface ActivityTotal {
  period: string;
  total_minutes: number;
  active_users: number;
}

function ActivityTab() {
  const [data, setData] = useState<ActivityRow[]>([]);
  const [totals, setTotals] = useState<ActivityTotal[]>([]);
  const [granularity, setGranularity] = useState("daily");
  const [error, setError] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchActivity = useCallback(async () => {
    try {
      const d = await apiFetch<{ granularity: string; data: ActivityRow[]; totals: ActivityTotal[] }>(`/admin/activity?from=${from}&to=${to}`);
      setData(d.data);
      setTotals(d.totals);
      setGranularity(d.granularity);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [from, to]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <label className="text-xs text-text-muted">From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="bg-bg-surface border border-border rounded px-2 py-1 text-sm text-text" />
        <label className="text-xs text-text-muted">To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="bg-bg-surface border border-border rounded px-2 py-1 text-sm text-text" />
        <span className="text-xs text-text-dim">Granularity: {granularity}</span>
      </div>

      {/* Totals */}
      {totals.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-bg-surface text-text-muted text-xs">
              <th className="text-left px-4 py-2">Period</th>
              <th className="text-right px-4 py-2">Active Users</th>
              <th className="text-right px-4 py-2">Total Minutes</th>
            </tr></thead>
            <tbody>
              {totals.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 text-text">{t.period}</td>
                  <td className="px-4 py-2 text-right text-text">{t.active_users}</td>
                  <td className="px-4 py-2 text-right text-text">{t.total_minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-user detail */}
      {data.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-bg-surface text-text-muted text-xs">
              <th className="text-left px-4 py-2">User</th>
              <th className="text-left px-4 py-2">Period</th>
              <th className="text-right px-4 py-2">Events</th>
              <th className="text-right px-4 py-2">Minutes</th>
            </tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="text-text text-xs">{r.user_name || r.user_email}</div>
                    <div className="text-text-dim text-[10px]">{r.user_email}</div>
                  </td>
                  <td className="px-4 py-2 text-text-muted text-xs">{r.period}</td>
                  <td className="px-4 py-2 text-right text-text">{r.session_count}</td>
                  <td className="px-4 py-2 text-right text-text">{r.total_minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.length === 0 && !error && (
        <div className="text-text-muted text-sm text-center py-8">No activity data for this period.</div>
      )}
    </div>
  );
}

// ─── Stats Tab ──────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Stats>("/admin/stats")
      .then(setStats)
      .catch((err: any) => setError(err.message));
  }, []);

  if (error) return <div className="text-red-400">{error}</div>;
  if (!stats) return <div className="text-text-muted">Loading stats...</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Users" value={stats.users.total} />
        <StatCard label="Verified Users" value={stats.users.verified} />
        <StatCard label="Active (7d)" value={stats.users.activeLastWeek} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Flow Runs" value={stats.system.flowRuns} />
        <StatCard label="Agent Runs" value={stats.system.agentRuns} />
        <StatCard label="Chat Sessions" value={stats.system.chatSessions} />
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-muted mb-3">
          Registrations per Week
        </h3>
        <div className="space-y-1">
          {stats.registrationsPerWeek.map((r, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-text-muted">
                {new Date(r.week).toLocaleDateString()}
              </span>
              <span className="text-text">{r.count}</span>
            </div>
          ))}
          {stats.registrationsPerWeek.length === 0 && (
            <span className="text-text-dim text-sm">No data</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-2xl font-bold text-text">{value}</div>
      <div className="text-sm text-text-muted">{label}</div>
    </div>
  );
}

// ─── News Tab ───────────────────────────────────────────────────────────────

function NewsTab() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [creating, setCreating] = useState(false);

  const loadNews = async () => {
    try {
      const data = await apiFetch<{ news: NewsItem[] }>("/admin/news");
      setNews(data.news);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadNews();
  }, []);

  const deleteNews = async (id: string) => {
    if (!confirm("Delete this news post?")) return;
    try {
      await apiFetch(`/admin/news/${id}`, { method: "DELETE" });
      loadNews();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const togglePublished = async (item: NewsItem) => {
    try {
      await apiFetch(`/admin/news/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ published: !item.published }),
      });
      loadNews();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <span className="text-text-muted text-sm">{news.length} posts</span>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-accent text-bg text-sm rounded hover:bg-accent-hover transition-colors"
        >
          Create News
        </button>
      </div>

      {(creating || editing) && (
        <NewsForm
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            loadNews();
          }}
        />
      )}

      <div className="space-y-3">
        {news.map((item) => (
          <div
            key={item.id}
            className="bg-surface border border-border rounded-lg p-4"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-text font-medium">{item.title}</h3>
                <div className="text-xs text-text-muted">
                  {new Date(item.created_at).toLocaleDateString()} — {item.author_name}
                  {!item.published && (
                    <span className="ml-2 text-yellow-400">(Draft)</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => togglePublished(item)}
                  className="text-xs text-accent hover:underline"
                >
                  {item.published ? "Unpublish" : "Publish"}
                </button>
                <button
                  onClick={() => setEditing(item)}
                  className="text-xs text-accent hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteNews(item.id)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="text-sm text-text-muted line-clamp-2">
              {item.content.slice(0, 200)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsForm({
  item,
  onClose,
  onSaved,
}: {
  item: NewsItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title || "");
  const [content, setContent] = useState(item?.content || "");
  const [published, setPublished] = useState(item?.published ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (item) {
        await apiFetch(`/admin/news/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({ title, content, published }),
        });
      } else {
        await apiFetch("/admin/news", {
          method: "POST",
          body: JSON.stringify({ title, content, published }),
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 bg-surface border border-border rounded-lg p-4">
      <h3 className="text-sm font-medium text-text mb-3">
        {item ? "Edit News" : "Create News"}
      </h3>
      {error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm"
        />
        <textarea
          placeholder="Content (Markdown supported)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={8}
          className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm font-mono"
        />
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          Published
        </label>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-accent text-bg text-sm rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Banner Tab ──────────────────────────────────────────────────────────────

function BannerTab() {
  const [banner, setBanner] = useState<BannerState>({
    message: "",
    type: "news",
    active: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    apiFetch<{ banner: BannerState | null }>("/admin/banner")
      .then((data) => {
        if (data.banner) {
          setBanner({
            message: data.banner.message,
            type: data.banner.type,
            active: data.banner.active,
          });
        }
      })
      .catch((err: any) => setError(err.message));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch("/admin/banner", {
        method: "PUT",
        body: JSON.stringify(banner),
      });
      setSuccess("Banner saved");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Live Preview */}
      {banner.message && (
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-2">Preview</h3>
          <div
            className={`w-full h-8 flex items-center overflow-hidden text-white text-sm font-medium rounded ${
              banner.type === "maintenance" ? "bg-red-600" : "bg-amber-600"
            } ${!banner.active ? "opacity-50" : ""}`}
          >
            <div className="whitespace-nowrap flex items-center gap-2 px-4">
              <span>{banner.type === "maintenance" ? "\u{1F527}" : "\u{1F4E2}"}</span>
              <span>{banner.message}</span>
            </div>
          </div>
          {!banner.active && (
            <p className="text-xs text-text-dim mt-1">Banner is inactive — not visible to users</p>
          )}
        </div>
      )}

      {/* Form */}
      <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-sm text-text-muted mb-1">Message</label>
          <input
            type="text"
            value={banner.message}
            onChange={(e) => setBanner({ ...banner, message: e.target.value })}
            placeholder="e.g. Scheduled maintenance on March 1st, 10:00-12:00 UTC"
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-text-muted mb-1">Type</label>
          <select
            value={banner.type}
            onChange={(e) =>
              setBanner({ ...banner, type: e.target.value as "maintenance" | "news" })
            }
            className="w-full px-3 py-2 bg-bg border border-border rounded text-text text-sm [&>option]:text-gray-900 [&>option]:bg-white"
          >
            <option value="news">News (orange)</option>
            <option value="maintenance">Maintenance (red)</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={banner.active}
              onChange={(e) => setBanner({ ...banner, active: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
          <span className="text-sm text-text-muted">
            {banner.active ? "Active — visible to all users" : "Inactive — hidden"}
          </span>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !banner.message}
          className="px-4 py-2 bg-accent text-bg text-sm rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Banner"}
        </button>
      </div>
    </div>
  );
}

// ─── Infrastructure Tab ─────────────────────────────────────────────────────

interface HostMetrics {
  hostname: string;
  online: boolean;
  has_gpu?: boolean;
  uptime_seconds?: number;
  cpu_info?: { model: string };
  current?: {
    cpu: number | null;
    temperature: number | null;
    memory?: { used_gb: string; total_gb: string; percent: number };
    sockets?: { cpu: number | null; temp: number | null; mhz: number | null }[];
    gpus?: {
      index: number;
      name: string;
      utilization: number;
      temperature: number;
      memory_used_mb: number;
      memory_total_mb: number;
    }[];
  };
  llm_processes?: { backend: string; model: string; size: string; detail: string }[];
}

interface DbInfo {
  name: string;
  port: number;
  online: boolean;
  size_mb?: number;
  tps?: number;
  cache_hit_ratio?: number;
  active_connections?: number;
  max_connections?: number;
}

interface ConnCheck {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

function InfraTab() {
  const [hosts, setHosts] = useState<HostMetrics[]>([]);
  const [dbs, setDbs] = useState<DbInfo[]>([]);
  const [connChecks, setConnChecks] = useState<ConnCheck[]>([]);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [metricsRes, dbRes, connRes] = await Promise.all([
        apiFetch<{ hosts: HostMetrics[] }>("/admin/infrastructure/metrics?minutes=5"),
        apiFetch<{ databases: DbInfo[] }>("/admin/infrastructure/db-health?minutes=5"),
        apiFetch<{ checks: ConnCheck[] }>("/admin/connectivity").catch(() => ({ checks: [] })),
      ]);
      setHosts(metricsRes.hosts || []);
      setDbs(dbRes.databases || []);
      setConnChecks(connRes.checks || []);
      setLastUpdate(new Date());
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const llmHost = hosts.find((h) => h.hostname === "llm-server" || h.has_gpu);
  const clusterHosts = hosts.filter((h) => h !== llmHost);

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <span className="text-text-muted text-xs">
          {lastUpdate ? `Updated: ${lastUpdate.toLocaleTimeString()}` : "Loading..."}
        </span>
        <span className="text-text-muted text-xs">Auto-refresh: 5s</span>
      </div>

      {/* LLM Server */}
      {llmHost && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-text">LLM Server</h3>
            <StatusBadge online={llmHost.online} />
            {llmHost.cpu_info?.model && (
              <span className="text-xs text-text-dim">{llmHost.cpu_info.model}</span>
            )}
            {llmHost.uptime_seconds && (
              <span className="text-xs text-text-dim">
                Uptime: {Math.floor(llmHost.uptime_seconds / 86400)}d{" "}
                {Math.floor((llmHost.uptime_seconds % 86400) / 3600)}h
              </span>
            )}
          </div>

          {llmHost.online && llmHost.current && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {llmHost.current.sockets && llmHost.current.sockets.length >= 2 ? (
                  <>
                    <MetricCard
                      label="CPU 0"
                      value={llmHost.current.sockets[0].cpu?.toFixed(1) || "--"}
                      unit="%"
                      sub={llmHost.current.sockets[0].temp ? `${llmHost.current.sockets[0].temp}°C` : undefined}
                      warn={70}
                      danger={90}
                      current={llmHost.current.sockets[0].cpu}
                    />
                    <MetricCard
                      label="CPU 1"
                      value={llmHost.current.sockets[1].cpu?.toFixed(1) || "--"}
                      unit="%"
                      sub={llmHost.current.sockets[1].temp ? `${llmHost.current.sockets[1].temp}°C` : undefined}
                      warn={70}
                      danger={90}
                      current={llmHost.current.sockets[1].cpu}
                    />
                  </>
                ) : (
                  <>
                    <MetricCard
                      label="CPU"
                      value={llmHost.current.cpu?.toFixed(1) || "--"}
                      unit="%"
                      warn={70}
                      danger={90}
                      current={llmHost.current.cpu}
                    />
                    <MetricCard
                      label="Temperature"
                      value={llmHost.current.temperature?.toString() || "--"}
                      unit="°C"
                      warn={70}
                      danger={85}
                      current={llmHost.current.temperature}
                    />
                  </>
                )}
                <MetricCard
                  label="RAM"
                  value={llmHost.current.memory?.percent.toFixed(1) || "--"}
                  unit="%"
                  sub={llmHost.current.memory ? `${llmHost.current.memory.used_gb}/${llmHost.current.memory.total_gb} GB` : undefined}
                  warn={75}
                  danger={90}
                  current={llmHost.current.memory?.percent}
                />
              </div>

              {/* GPUs */}
              {llmHost.current.gpus && llmHost.current.gpus.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                  {llmHost.current.gpus.map((gpu) => (
                    <div key={gpu.index} className="bg-bg border border-border/50 rounded p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-medium text-text">GPU {gpu.index}</span>
                        <span className={`text-xs font-mono ${valueColor(gpu.temperature, 75, 85)}`}>
                          {gpu.temperature}°C
                        </span>
                      </div>
                      <div className="text-xs text-text-dim mb-2">{gpu.name}</div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-muted">Utilization</span>
                        <span className="text-text">{gpu.utilization}%</span>
                      </div>
                      <ProgressBar value={gpu.utilization} />
                      <div className="flex justify-between text-xs mb-1 mt-2">
                        <span className="text-text-muted">VRAM</span>
                        <span className="text-text">
                          {(gpu.memory_used_mb / 1024).toFixed(1)}/{(gpu.memory_total_mb / 1024).toFixed(1)} GB
                        </span>
                      </div>
                      <ProgressBar
                        value={gpu.memory_total_mb > 0 ? (gpu.memory_used_mb / gpu.memory_total_mb) * 100 : 0}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Loaded Models */}
              {llmHost.llm_processes && llmHost.llm_processes.length > 0 && (
                <div>
                  <span className="text-xs text-text-muted">Loaded Models: </span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {llmHost.llm_processes.map((p, i) => (
                      <span
                        key={i}
                        className="text-xs bg-bg border border-border/50 rounded px-2 py-1 text-text"
                      >
                        {p.backend}: {p.model}
                        {p.size && <span className="text-text-dim ml-1">({p.size})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Cluster Nodes */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-text">Kubernetes Cluster</h3>
          <span className="text-xs text-text-muted">
            {clusterHosts.filter((h) => h.online).length}/{clusterHosts.length} online
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs">
                <th className="py-2 pr-4">Node</th>
                <th className="py-2 pr-4">CPU</th>
                <th className="py-2 pr-4">RAM</th>
                <th className="py-2 pr-4">Temp</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {clusterHosts.map((h) => (
                <tr key={h.hostname} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text font-medium text-xs">{h.hostname}</td>
                  {h.online && h.current ? (
                    <>
                      <td className={`py-2 pr-4 font-mono text-xs ${valueColor(h.current.cpu, 70, 90)}`}>
                        {h.current.cpu?.toFixed(1) ?? "--"}%
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-muted">
                        {h.current.memory
                          ? `${h.current.memory.used_gb}/${h.current.memory.total_gb} GB`
                          : "--"}
                      </td>
                      <td className={`py-2 pr-4 font-mono text-xs ${valueColor(h.current.temperature, 70, 85)}`}>
                        {h.current.temperature ?? "--"}°C
                      </td>
                      <td className="py-2">
                        <StatusBadge online={true} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2">
                        <StatusBadge online={false} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {clusterHosts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-text-dim text-xs">
                    No cluster nodes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Database Health */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-text">Database Health</h3>
          <span className="text-xs text-text-muted">
            {dbs.filter((d) => d.online).length}/{dbs.length} online
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs">
                <th className="py-2 pr-4">Database</th>
                <th className="py-2 pr-4">Port</th>
                <th className="py-2 pr-4">Size</th>
                <th className="py-2 pr-4">TPS</th>
                <th className="py-2 pr-4">Connections</th>
                <th className="py-2 pr-4">Cache Hit</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {dbs.map((db) => (
                <tr key={db.name} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text font-medium text-xs">{db.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-text-muted">{db.port}</td>
                  {db.online ? (
                    <>
                      <td className="py-2 pr-4 font-mono text-xs text-text-muted">
                        {db.size_mb && db.size_mb >= 1024
                          ? `${(db.size_mb / 1024).toFixed(1)} GB`
                          : `${db.size_mb} MB`}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-muted">{db.tps}/s</td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-muted">
                        {db.active_connections}/{db.max_connections}
                      </td>
                      <td className={`py-2 pr-4 font-mono text-xs ${valueColor(100 - (db.cache_hit_ratio || 100), 5, 10)}`}>
                        {db.cache_hit_ratio}%
                      </td>
                      <td className="py-2">
                        <StatusBadge online={true} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2 pr-4 text-text-dim text-xs">--</td>
                      <td className="py-2">
                        <StatusBadge online={false} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {dbs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-text-dim text-xs">
                    No databases
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Service Connectivity */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-text">Service Connectivity</h3>
          {connChecks.length > 0 && (
            <span className="text-xs text-text-muted">
              {connChecks.filter((c) => c.ok).length}/{connChecks.length} reachable
            </span>
          )}
          {connChecks.some((c) => !c.ok) && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Issues detected
            </span>
          )}
        </div>
        {connChecks.length === 0 ? (
          <p className="text-text-dim text-sm">Loading connectivity checks...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {connChecks.map((c) => (
              <div
                key={c.name}
                className={`flex items-center gap-3 px-3 py-2 rounded border ${
                  c.ok
                    ? "border-border/50 bg-bg"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    c.ok ? "bg-green-400" : "bg-red-400 animate-pulse"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${c.ok ? "text-text" : "text-red-400"}`}>
                      {c.name}
                    </span>
                    <span className={`text-xs font-mono ${
                      c.latencyMs > 2000 ? "text-red-400" : c.latencyMs > 500 ? "text-yellow-400" : "text-text-dim"
                    }`}>
                      {c.latencyMs}ms
                    </span>
                  </div>
                  {c.error && (
                    <div className="text-xs text-red-400/80 truncate mt-0.5" title={c.error}>
                      {c.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NR Pods Tab ─────────────────────────────────────────────────────────────

interface NrPod {
  podName: string;
  podIp: string;
  status: string;
  userId: string | null;
  userEmail: string | null;
  assignedAt: string | null;
  lastActivity: string | null;
  idleMinutes: number | null;
  flowsRunning: number;
  uptimeMinutes: number;
  memoryMb: number | null;
  cpuMillicores: number | null;
  nrReady: boolean;
}

interface NrPoolStats {
  warm: number;
  assigned: number;
  starting: number;
  draining: number;
  targetSize: number;
}

interface NrPodEvent {
  pod_name: string;
  event_type: string;
  user_id: string | null;
  user_email: string | null;
  details: any;
  created_at: string;
}

interface NrStats24h {
  totalAssignments24h: number;
  avgSessionMinutes: number;
  peakConcurrent24h: number;
  poolHealthy: boolean;
  warmPodsAvailable: number;
  idleKills24h: number;
}

function NrPodsTab() {
  const [pods, setPods] = useState<NrPod[]>([]);
  const [poolStats, setPoolStats] = useState<NrPoolStats | null>(null);
  const [stats24h, setStats24h] = useState<NrStats24h | null>(null);
  const [events, setEvents] = useState<NrPodEvent[]>([]);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [scaling, setScaling] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [draining, setDraining] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [podsRes, statsRes, eventsRes] = await Promise.all([
        apiFetch<{ pods: NrPod[]; pool: NrPoolStats }>("/admin/nr-pods"),
        apiFetch<NrStats24h>("/admin/nr-pods/stats"),
        apiFetch<{ events: NrPodEvent[] }>("/admin/nr-pods/events?limit=30"),
      ]);
      setPods(podsRes.pods || []);
      setPoolStats(podsRes.pool || null);
      setStats24h(statsRes);
      setEvents(eventsRes.events || []);
      setLastUpdate(new Date());
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const handleRelease = async (podName: string) => {
    const pod = pods.find(p => p.podName === podName);
    if (pod && pod.flowsRunning > 0) {
      if (!confirm(`Pod ${podName} has ${pod.flowsRunning} running flow(s). Release anyway?`)) return;
    }
    setReleasing(podName);
    try {
      await apiFetch(`/admin/nr-pods/${podName}/release`, { method: "POST" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReleasing(null);
    }
  };

  const handleScale = async (delta: number) => {
    if (!poolStats) return;
    const newSize = Math.max(0, Math.min(20, poolStats.targetSize + delta));
    setScaling(true);
    try {
      await apiFetch("/admin/nr-pods/pool/scale", {
        method: "POST",
        body: JSON.stringify({ size: newSize }),
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScaling(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      await apiFetch("/admin/nr-pods/cleanup", { method: "POST" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCleaning(false);
    }
  };

  const handleDrainAll = async () => {
    if (!confirm("This will release ALL active pods and kill all warm pods. New warm pods will be created. Continue?")) return;
    setDraining(true);
    try {
      const result = await apiFetch<{ released: number; deleted: number }>("/admin/nr-pods/drain-all", { method: "POST" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDraining(false);
    }
  };

  const idleColor = (minutes: number | null) => {
    if (minutes === null) return "text-text-muted";
    if (minutes > 15) return "text-red-400";
    if (minutes > 5) return "text-yellow-400";
    return "text-green-400";
  };

  const eventTypeLabel: Record<string, { label: string; color: string }> = {
    created: { label: "Created", color: "text-blue-400" },
    assigned: { label: "Assigned", color: "text-emerald-400" },
    released: { label: "Released", color: "text-text-muted" },
    idle_killed: { label: "Idle Kill", color: "text-yellow-400" },
    admin_released: { label: "Admin Release", color: "text-orange-400" },
    admin_drain_all: { label: "Drain All", color: "text-orange-400" },
    health_fail: { label: "Health Fail", color: "text-red-400" },
    error: { label: "Error", color: "text-red-400" },
    watch_deleted: { label: "K8s Deleted", color: "text-red-400" },
    watch_terminated: { label: "K8s Terminated", color: "text-red-400" },
  };

  const activePods = pods.filter(p => p.status === "assigned");
  const warmPods = pods.filter(p => p.status === "warm" || p.status === "starting");

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <span className="text-text-muted text-xs">
          {lastUpdate ? `Updated: ${lastUpdate.toLocaleTimeString()}` : "Loading..."}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            className="text-xs px-3 py-1 rounded border border-border text-text-muted hover:text-text hover:border-accent/50 transition-colors disabled:opacity-50"
          >
            {cleaning ? "Cleaning..." : "Cleanup Dead"}
          </button>
          <button
            onClick={handleDrainAll}
            disabled={draining}
            className="text-xs px-3 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {draining ? "Draining..." : "Drain All"}
          </button>
          <span className="text-text-dim text-xs ml-2">Auto-refresh: 5s</span>
        </div>
      </div>

      {/* Pool Health Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-bg border border-border/50 rounded p-3">
          <div className="text-xs text-text-muted mb-1">Pool Status</div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${stats24h?.poolHealthy ? "bg-green-400" : "bg-red-400"}`} />
            <span className={`text-lg font-bold font-mono ${stats24h?.poolHealthy ? "text-green-400" : "text-red-400"}`}>
              {poolStats?.warm ?? "?"}/{poolStats?.targetSize ?? "?"}
            </span>
            <span className="text-xs text-text-muted">warm</span>
          </div>
        </div>
        <div className="bg-bg border border-border/50 rounded p-3">
          <div className="text-xs text-text-muted mb-1">Active Users</div>
          <div className="text-lg font-bold font-mono text-blue-400">
            {poolStats?.assigned ?? 0}
          </div>
        </div>
        <div className="bg-bg border border-border/50 rounded p-3">
          <div className="text-xs text-text-muted mb-1">Avg Session</div>
          <div className="text-lg font-bold font-mono text-text">
            {stats24h?.avgSessionMinutes ?? 0}<span className="text-xs text-text-muted ml-1">min</span>
          </div>
        </div>
        <div className="bg-bg border border-border/50 rounded p-3">
          <div className="text-xs text-text-muted mb-1">24h Assignments</div>
          <div className="text-lg font-bold font-mono text-text">
            {stats24h?.totalAssignments24h ?? 0}
          </div>
          <div className="text-xs text-text-dim">
            Peak: {stats24h?.peakConcurrent24h ?? 0} concurrent
          </div>
        </div>
      </div>

      {/* Active Pods */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-3">Active Pods ({activePods.length})</h3>
        {activePods.length === 0 ? (
          <p className="text-text-dim text-sm">No active editor sessions</p>
        ) : (
          <div className="bg-bg border border-border/50 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-text-muted text-xs">
                  <th className="text-left p-2 font-medium">Pod</th>
                  <th className="text-left p-2 font-medium">User</th>
                  <th className="text-left p-2 font-medium">Idle</th>
                  <th className="text-left p-2 font-medium">CPU</th>
                  <th className="text-left p-2 font-medium">RAM</th>
                  <th className="text-left p-2 font-medium">Flows</th>
                  <th className="text-right p-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {activePods.map((pod) => (
                  <tr key={pod.podName} className="border-b border-border/30 last:border-0">
                    <td className="p-2 font-mono text-xs text-text">{pod.podName}</td>
                    <td className="p-2 text-text-muted">{pod.userEmail || "unknown"}</td>
                    <td className={`p-2 font-mono ${idleColor(pod.idleMinutes)}`}>
                      {pod.idleMinutes !== null ? `${pod.idleMinutes}min` : "-"}
                    </td>
                    <td className="p-2 font-mono text-text-muted">
                      {pod.cpuMillicores !== null ? `${pod.cpuMillicores}m` : "-"}
                      {pod.cpuMillicores !== null && (
                        <div className="mt-0.5"><ProgressBar value={(pod.cpuMillicores / 500) * 100} /></div>
                      )}
                    </td>
                    <td className="p-2 font-mono text-text-muted">
                      {pod.memoryMb !== null ? `${pod.memoryMb}MB` : "-"}
                      {pod.memoryMb !== null && (
                        <div className="mt-0.5"><ProgressBar value={(pod.memoryMb / 512) * 100} /></div>
                      )}
                    </td>
                    <td className="p-2">
                      {pod.flowsRunning > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                          {pod.flowsRunning} running
                        </span>
                      ) : (
                        <span className="text-text-dim text-xs">idle</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => handleRelease(pod.podName)}
                        disabled={releasing === pod.podName}
                        className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-red-400 hover:border-red-400/50 transition-colors disabled:opacity-50"
                      >
                        {releasing === pod.podName ? "..." : "Release"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Warm Pool */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text">Warm Pool ({warmPods.length})</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Size: {poolStats?.targetSize ?? 3}</span>
            <button
              onClick={() => handleScale(-1)}
              disabled={scaling || !poolStats || poolStats.targetSize <= 0}
              className="w-6 h-6 rounded border border-border text-text-muted hover:text-text hover:border-accent/50 text-sm disabled:opacity-30 transition-colors"
            >
              -
            </button>
            <button
              onClick={() => handleScale(1)}
              disabled={scaling || !poolStats || poolStats.targetSize >= 20}
              className="w-6 h-6 rounded border border-border text-text-muted hover:text-text hover:border-accent/50 text-sm disabled:opacity-30 transition-colors"
            >
              +
            </button>
          </div>
        </div>
        {warmPods.length === 0 ? (
          <p className="text-text-dim text-sm">No warm pods available</p>
        ) : (
          <div className="space-y-1.5">
            {warmPods.map((pod) => (
              <div key={pod.podName} className="bg-bg border border-border/50 rounded px-3 py-2 flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full ${pod.status === "warm" ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} />
                <span className="font-mono text-xs text-text">{pod.podName}</span>
                <span className="text-text-dim text-xs">
                  {pod.status === "starting" ? "Starting..." : `Ready, uptime ${pod.uptimeMinutes}min`}
                </span>
                <span className="text-text-muted text-xs font-mono ml-auto">
                  {pod.cpuMillicores !== null ? `${pod.cpuMillicores}m` : ""}
                  {pod.cpuMillicores !== null && pod.memoryMb !== null ? " / " : ""}
                  {pod.memoryMb !== null ? `${pod.memoryMb}MB` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Events */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-3">Recent Events</h3>
        {events.length === 0 ? (
          <p className="text-text-dim text-sm">No events yet</p>
        ) : (
          <div className="bg-bg border border-border/50 rounded overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {events.map((evt, i) => {
                  const info = eventTypeLabel[evt.event_type] || { label: evt.event_type, color: "text-text-muted" };
                  return (
                    <tr key={i} className="border-b border-border/20 last:border-0">
                      <td className="p-2 text-text-dim font-mono whitespace-nowrap">
                        {new Date(evt.created_at).toLocaleTimeString()}
                      </td>
                      <td className="p-2 font-mono text-text-muted">{evt.pod_name}</td>
                      <td className={`p-2 font-medium ${info.color}`}>{info.label}</td>
                      <td className="p-2 text-text-dim">{evt.user_email || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared Utility Components ───────────────────────────────────────────────

function StatusBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        online
          ? "bg-green-500/10 text-green-400"
          : "bg-red-500/10 text-red-400"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${online ? "bg-green-400" : "bg-red-400"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function MetricCard({
  label,
  value,
  unit,
  sub,
  warn,
  danger,
  current,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  warn: number;
  danger: number;
  current?: number | null;
}) {
  return (
    <div className="bg-bg border border-border/50 rounded p-3">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${valueColor(current ?? null, warn, danger)}`}>
        {value}
        <span className="text-xs text-text-muted ml-1">{unit}</span>
      </div>
      {sub && <div className="text-xs text-text-dim mt-0.5">{sub}</div>}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const color =
    value >= 90 ? "bg-red-400" : value >= 70 ? "bg-yellow-400" : "bg-green-400";
  return (
    <div className="w-full h-1.5 bg-border/50 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

function valueColor(value: number | null | undefined, warn: number, danger: number): string {
  if (value === null || value === undefined) return "text-text-muted";
  if (value >= danger) return "text-red-400";
  if (value >= warn) return "text-yellow-400";
  return "text-green-400";
}

// ─── v9: Factory Roles Tab ──────────────────────────────────────────────────

interface FactoryRole {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  user_count: string;
  categories: string[];
  created_at: string;
}

function RolesTab() {
  const [roles, setRoles] = useState<FactoryRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCats, setEditCats] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ roles: FactoryRole[] }>("/admin/roles"),
      apiFetch<{ categories: { id: string; name: string }[] }>("/admin/tool-categories"),
    ])
      .then(([r, c]) => {
        setRoles(r.roles);
        setAllCategories(c.categories);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const savePermissions = async (roleId: string) => {
    try {
      await apiFetch(`/admin/roles/${roleId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ categories: editCats }),
      });
      setRoles((prev) =>
        prev.map((r) => (r.id === roleId ? { ...r, categories: editCats } : r))
      );
      setEditId(null);
    } catch (err: any) {
      alert(err.message || "Failed to save");
    }
  };

  if (loading) return <div className="text-text-muted py-8 text-center">Loading roles...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">Factory Roles ({roles.length})</h2>
      </div>
      <div className="grid gap-3">
        {roles.map((role) => (
          <div key={role.id} className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold text-text">{role.name}</h3>
                <p className="text-xs text-text-muted">{role.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">{role.user_count} users</span>
                {role.is_system && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">system</span>
                )}
              </div>
            </div>
            {editId === role.id ? (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-text-muted mb-1">Allowed Categories:</div>
                <div className="flex flex-wrap gap-1.5">
                  {allCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() =>
                        setEditCats((prev) =>
                          prev.includes(cat.id)
                            ? prev.filter((c) => c !== cat.id)
                            : [...prev, cat.id]
                        )
                      }
                      className={`px-2 py-1 rounded text-xs transition-all ${
                        editCats.includes(cat.id)
                          ? "bg-accent text-bg"
                          : "border border-border text-text-dim hover:border-accent/30"
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => savePermissions(role.id)}
                    className="px-3 py-1.5 rounded text-xs bg-accent text-bg font-medium hover:bg-accent-hover"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-1.5 rounded text-xs text-text-muted hover:text-text"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex flex-wrap gap-1">
                  {role.categories.map((cat) => (
                    <span
                      key={cat}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg-surface-2 text-text-muted"
                    >
                      {cat}
                    </span>
                  ))}
                  {role.categories.length === 0 && (
                    <span className="text-[10px] text-text-dim">No categories assigned</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setEditId(role.id);
                    setEditCats(role.categories);
                  }}
                  className="ml-auto text-xs text-accent hover:text-accent-hover"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── v9: Tool Categories Tab ────────────────────────────────────────────────

interface ToolCategory {
  id: string;
  name: string;
  description: string;
  sensitivity: string;
  tool_count: string;
  created_at: string;
}

function CategoriesTab() {
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifications, setClassifications] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ categories: ToolCategory[] }>("/admin/tool-categories"),
      apiFetch<{ classifications: any[] }>("/admin/tool-classifications").catch(() => ({ classifications: [] })),
    ])
      .then(([c, cl]) => {
        setCategories(c.categories);
        setClassifications(cl.classifications || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-text-muted py-8 text-center">Loading categories...</div>;

  const sensColor: Record<string, string> = {
    critical: "text-red-400 bg-red-400/10 border-red-400/20",
    high: "text-orange-400 bg-orange-400/10 border-orange-400/20",
    medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    low: "text-green-400 bg-green-400/10 border-green-400/20",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-text">Tool Categories ({categories.length})</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {categories.map((cat) => {
          const catTools = classifications.filter((c: any) => c.category_id === cat.id);
          return (
            <div key={cat.id} className="p-4 rounded-md border border-border bg-bg-surface">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-text text-sm">{cat.name}</h3>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    sensColor[cat.sensitivity] || "text-text-dim"
                  }`}
                >
                  {cat.sensitivity}
                </span>
              </div>
              <p className="text-xs text-text-muted mb-3">{cat.description}</p>
              <div className="flex items-center justify-between text-xs text-text-dim">
                <span>{cat.tool_count} tools classified</span>
                {catTools.length > 0 && (
                  <span>{catTools.filter((t: any) => t.status === "approved").length} approved</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── v9: MCP Servers Tab ────────────────────────────────────────────────────

interface McpServer {
  id: string;
  name: string;
  url: string;
  auth_type: string;
  status: string;
  tool_count: number;
  categories: string[];
  health_check_at: string | null;
  error_message: string | null;
  created_at: string;
}

function McpServersTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [tools, setTools] = useState<any[]>([]);

  const loadServers = useCallback(() => {
    apiFetch<{ servers: McpServer[] }>("/admin/mcp-servers")
      .then((d) => setServers(d.servers))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadServers(); }, [loadServers]);

  const discover = async (id: string) => {
    setDiscovering(id);
    try {
      await apiFetch(`/admin/mcp-servers/${id}/discover`, { method: "POST" });
      // Poll for completion
      setTimeout(() => {
        loadServers();
        setDiscovering(null);
      }, 3000);
    } catch {
      setDiscovering(null);
    }
  };

  const loadTools = async (id: string) => {
    if (selectedServer === id) {
      setSelectedServer(null);
      return;
    }
    setSelectedServer(id);
    try {
      const data = await apiFetch<any>(`/admin/mcp-servers/${id}`);
      setTools(data.tools || []);
    } catch {
      setTools([]);
    }
  };

  if (loading) return <div className="text-text-muted py-8 text-center">Loading MCP servers...</div>;

  const statusColor: Record<string, string> = {
    online: "bg-emerald-400",
    pending: "bg-yellow-400",
    error: "bg-red-400",
    offline: "bg-red-400",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">MCP Servers ({servers.length})</h2>
      <div className="space-y-3">
        {servers.map((srv) => (
          <div key={srv.id} className="rounded-md border border-border bg-bg-surface overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor[srv.status] || "bg-gray-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text">{srv.name}</h3>
                    <span className="text-[10px] text-text-dim font-mono truncate">{srv.url}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                    <span>{srv.tool_count} tools</span>
                    <span>Status: {srv.status}</span>
                    {srv.health_check_at && (
                      <span>Last check: {new Date(srv.health_check_at).toLocaleTimeString()}</span>
                    )}
                    {srv.error_message && (
                      <span className="text-red-400">{srv.error_message}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => discover(srv.id)}
                    disabled={discovering === srv.id}
                    className="px-3 py-1.5 rounded text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 disabled:opacity-50"
                  >
                    {discovering === srv.id ? "Discovering..." : "Discover"}
                  </button>
                  <button
                    onClick={() => loadTools(srv.id)}
                    className="px-3 py-1.5 rounded text-xs border border-border text-text-muted hover:text-text hover:border-accent/30"
                  >
                    {selectedServer === srv.id ? "Hide Tools" : "Show Tools"}
                  </button>
                </div>
              </div>
              {srv.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {srv.categories.map((cat) => (
                    <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg-surface-2 text-text-muted">
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {selectedServer === srv.id && (
              <div className="border-t border-border bg-bg-surface-2 p-4">
                <div className="text-xs font-semibold text-text-muted mb-2">
                  Discovered Tools ({tools.length})
                </div>
                {tools.length === 0 ? (
                  <div className="text-xs text-text-dim">No tools discovered yet. Click Discover.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {tools.map((tool: any, i: number) => {
                      const fn = tool.function || tool;
                      return (
                        <div key={i} className="p-2 rounded border border-border bg-bg-surface text-xs">
                          <div className="font-mono font-semibold text-accent">{fn.name || "?"}</div>
                          <div className="text-text-muted mt-0.5 line-clamp-2">{fn.description || ""}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {servers.length === 0 && (
          <div className="text-text-dim text-center py-8">No MCP servers registered</div>
        )}
      </div>
    </div>
  );
}

// ─── v9: Audit Export Tab ───────────────────────────────────────────────────

function AuditTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);

  const loadAudit = useCallback(() => {
    setLoading(true);
    apiFetch<{ entries: any[]; total: number }>(`/admin/audit?from=${fromDate}&to=${toDate}&limit=50`)
      .then((d) => {
        setEntries(d.entries || []);
        setTotal(d.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  const downloadExport = (format: "csv" | "json") => {
    const url = `${process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai"}/admin/audit/export?from=${fromDate}&to=${toDate}&format=${format}`;
    const token = localStorage.getItem("token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `audit-export-${fromDate}_${toDate}.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => alert("Export failed"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-text">Audit Log</h2>
        <div className="flex-1" />
        <label className="text-xs text-text-muted">From</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="px-2 py-1 rounded text-xs border border-border bg-bg-surface text-text"
        />
        <label className="text-xs text-text-muted">To</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="px-2 py-1 rounded text-xs border border-border bg-bg-surface text-text"
        />
        <button
          onClick={() => downloadExport("csv")}
          className="px-3 py-1.5 rounded text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
        >
          Export CSV
        </button>
        <button
          onClick={() => downloadExport("json")}
          className="px-3 py-1.5 rounded text-xs border border-border text-text-muted hover:text-text hover:border-accent/30"
        >
          Export JSON
        </button>
      </div>

      <div className="text-xs text-text-dim">{total} total entries</div>

      {loading ? (
        <div className="text-text-muted py-8 text-center">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-text-dim text-center py-8 border border-border rounded-md">
          No audit entries in this date range
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">User</th>
                <th className="text-left py-2 px-2">Action</th>
                <th className="text-left py-2 px-2">Tool</th>
                <th className="text-left py-2 px-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any, i: number) => (
                <tr key={i} className="border-b border-border/50 hover:bg-bg-surface-2">
                  <td className="py-1.5 px-2 text-text-dim whitespace-nowrap">
                    {new Date(e.created_at || e.timestamp).toLocaleString()}
                  </td>
                  <td className="py-1.5 px-2 text-text-muted">{e.user_email || e.email || "-"}</td>
                  <td className="py-1.5 px-2">
                    <span className="px-1.5 py-0.5 rounded bg-bg-surface-2 text-text font-mono">
                      {e.action}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-accent font-mono">{e.tool_name || "-"}</td>
                  <td className="py-1.5 px-2 text-text-dim max-w-xs truncate">{e.detail || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Agents Tab ──────────────────────────────────────────────────────────────

function AgentsTab() {
  const [agents, setAgents] = useState<any[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/admin/agents/status")
      .then((r) => r.json())
      .then((d) => { setAgents(d.agents || []); setCheckedAt(d.checkedAt || ""); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (agents.length === 0 && !checkedAt) return <div className="text-text-muted text-sm">Loading agents...</div>;

  const statusColor = (s: string) =>
    ["running", "ok", "online", "healthy"].includes(s) ? "bg-green-500"
    : ["error", "offline", "critical"].includes(s) ? "bg-red-500"
    : "bg-yellow-500";

  const buildDetails = (a: any): { label: string; value: string }[] => {
    const d: { label: string; value: string }[] = [];
    if (a.type) d.push({ label: "Type", value: a.type });
    if (a.machines !== undefined) d.push({ label: "Machines", value: String(a.machines) });
    if (a.sensors !== undefined) d.push({ label: "Sensors", value: String(a.sensors) });
    if (a.discovered !== undefined) d.push({ label: "Discovered", value: a.discovered.toLocaleString() });
    if (a.updates !== undefined) d.push({ label: "Updates", value: a.updates.toLocaleString() });
    if (a.mqtt) {
      d.push({ label: "MQTT Connected", value: a.mqtt.connected ? "Yes" : "No" });
      if (a.mqtt.received) d.push({ label: "Messages Received", value: a.mqtt.received.toLocaleString() });
    }
    if (a.flush) {
      d.push({ label: "Rows Inserted", value: a.flush.inserted?.toLocaleString() || "-" });
      if (a.flush.msgPerSec) d.push({ label: "Rate", value: `${a.flush.msgPerSec} msg/s` });
    }
    if (a.toolCount !== undefined) d.push({ label: "Tools", value: String(a.toolCount) });
    if (a.url) d.push({ label: "URL", value: a.url });
    if (a.version) d.push({ label: "Version", value: a.version });
    return d;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">Agent Status</h2>
        {checkedAt && <span className="text-xs text-text-dim">Checked: {new Date(checkedAt).toLocaleString()}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent: any) => (
          <div key={agent.name} className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${statusColor(agent.status)}`} />
              <span className="font-medium text-text">{agent.name}</span>
              <span className="text-xs text-text-dim ml-auto">{agent.status}</span>
            </div>
            {agent.description && <p className="text-xs text-text-muted mb-3">{agent.description}</p>}
            <div className="space-y-1">
              {buildDetails(agent).map((d) => (
                <div key={d.label} className="flex justify-between text-sm">
                  <span className="text-text-muted">{d.label}</span>
                  <span className="text-text font-mono text-right max-w-[60%] truncate">{d.value}</span>
                </div>
              ))}
            </div>
            {agent.perTable && agent.perTable.length > 0 && (
              <div className="mt-3 pt-2 border-t border-border/50">
                <span className="text-xs text-text-dim font-medium">Per-Table Stats</span>
                {agent.perTable.map((t: any) => (
                  <div key={t.table} className="flex justify-between text-xs mt-1">
                    <span className="text-text-muted font-mono">{t.table}</span>
                    <span className="text-text">{t.inserted?.toLocaleString()} rows, {t.flushes} flushes</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {agents.length === 0 && (
        <p className="text-text-dim text-sm">No agents registered.</p>
      )}
    </div>
  );
}

// ─── Classifications Tab ─────────────────────────────────────────────────────

function ClassificationsTab() {
  const [classifications, setClassifications] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/admin/tool-classifications")
      .then((r) => r.json())
      .then((d) => setClassifications(d.classifications || d || []))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  const statusColor = (s: string) =>
    s === "approved" ? "text-green-400" : s === "denied" ? "text-red-400" : "text-yellow-400";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">Tool Classifications</h2>
      {classifications.length === 0 ? (
        <p className="text-text-dim text-sm">No classifications found.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-surface text-text-muted text-xs">
                <th className="text-left px-4 py-2">Tool</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {classifications.map((c: any, i: number) => (
                <tr key={i} className="border-t border-border/50 hover:bg-bg-surface-2">
                  <td className="px-4 py-2 text-text font-mono">{c.tool_name}</td>
                  <td className="px-4 py-2 text-text-muted">{c.category_id || c.category || "-"}</td>
                  <td className={`px-4 py-2 font-medium ${statusColor(c.status)}`}>{c.status}</td>
                  <td className="px-4 py-2 text-text-dim">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Tab ───────────────────────────────────────────────────────────

function DashboardTab() {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      apiFetch("/admin/dashboard/snapshot")
        .then((r) => r.json())
        .then(setSnapshot)
        .catch((e) => setError(e.message));
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!snapshot) return <div className="text-text-muted text-sm">Loading dashboard...</div>;

  const mem = snapshot.memory || {};
  const formatBytes = (b: number) => b ? `${(b / 1024 / 1024).toFixed(1)} MB` : "-";
  const formatUptime = (s: number) => {
    if (!s) return "-";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">Real-Time Dashboard</h2>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Uptime", val: formatUptime(snapshot.uptime) },
          { label: "RSS Memory", val: formatBytes(mem.rss) },
          { label: "Heap Used", val: formatBytes(mem.heapUsed) },
          { label: "Event Loop Lag", val: snapshot.eventLoopLag ? `${snapshot.eventLoopLag.toFixed(1)} ms` : "-" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-bg-surface p-3">
            <div className="text-xs text-text-muted mb-1">{m.label}</div>
            <div className="text-lg font-mono text-text">{m.val}</div>
          </div>
        ))}
      </div>

      {/* DB Connections */}
      {snapshot.db && (
        <div className="rounded-lg border border-border bg-bg-surface p-4">
          <h3 className="text-sm font-medium text-text-muted mb-2">Database</h3>
          <div className="flex gap-6 text-sm">
            <span className="text-text">Total: <span className="font-mono">{snapshot.db.totalCount ?? "-"}</span></span>
            <span className="text-text">Idle: <span className="font-mono">{snapshot.db.idleCount ?? "-"}</span></span>
            <span className="text-text">Waiting: <span className="font-mono">{snapshot.db.waitingCount ?? "-"}</span></span>
          </div>
        </div>
      )}

      {/* Request Rate */}
      {snapshot.requests && (
        <div className="rounded-lg border border-border bg-bg-surface p-4">
          <h3 className="text-sm font-medium text-text-muted mb-2">Requests / Minute</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-mono text-accent">{snapshot.requests.perMin}</span>
            <span className="text-sm text-text-dim">Error rate: {(snapshot.requests.errorRate * 100).toFixed(1)}%</span>
          </div>
          {snapshot.requests.history && snapshot.requests.history.length > 0 && (
            <div className="flex items-end gap-1 h-12 mt-2">
              {snapshot.requests.history.map((h: any, i: number) => {
                const vals = snapshot.requests.history.map((x: any) => x.requests);
                const max = Math.max(...vals, 1);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-accent/30 rounded-t"
                    style={{ height: `${(h.requests / max) * 100}%` }}
                    title={`${h.requests} requests`}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-text-dim">Auto-refreshes every 10 seconds</p>
    </div>
  );
}

// ─── v9: Topic Profiles Tab ─────────────────────────────────────────────────

interface TopicProfileData {
  id: number;
  name: string;
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  is_builtin: boolean;
  enabled: boolean;
  priority: number;
  example_topic: string | null;
  created_at: string;
  updated_at: string;
}

interface DiscoverySuggestion {
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  confidence: number;
  reasoning: string;
  sample_topics: string[];
  segment_stats: { index: number; unique_count: number; samples: string[] }[];
}

function TopicProfilesTab() {
  const [profiles, setProfiles] = useState<TopicProfileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  // Discovery state
  const [discovering, setDiscovering] = useState(false);
  const [discoverDuration, setDiscoverDuration] = useState(30);
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [discoverErrors, setDiscoverErrors] = useState<string[]>([]);
  const [discoverInfo, setDiscoverInfo] = useState<string | null>(null);

  // Live preview
  const [previewTopic, setPreviewTopic] = useState("");
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  // Form state for create/edit
  const [form, setForm] = useState({
    name: "", prefix: "", subscription: "",
    seg_machine: "", seg_work_order: "", seg_tool_id: "",
    seg_category: "", seg_variable_start: "5",
    null_marker: "---", priority: "0", example_topic: "",
  });

  const loadProfiles = useCallback(async () => {
    try {
      const data = await apiFetch<{ profiles: TopicProfileData[] }>("/admin/historian/profiles");
      setProfiles(data.profiles || []);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const resetForm = () => setForm({
    name: "", prefix: "", subscription: "",
    seg_machine: "", seg_work_order: "", seg_tool_id: "",
    seg_category: "", seg_variable_start: "5",
    null_marker: "---", priority: "0", example_topic: "",
  });

  const handleCreate = async () => {
    try {
      await apiFetch("/admin/historian/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          prefix: form.prefix,
          subscription: form.subscription || `${form.prefix}/#`,
          seg_machine: form.seg_machine ? parseInt(form.seg_machine) : null,
          seg_work_order: form.seg_work_order ? parseInt(form.seg_work_order) : null,
          seg_tool_id: form.seg_tool_id ? parseInt(form.seg_tool_id) : null,
          seg_category: form.seg_category ? parseInt(form.seg_category) : null,
          seg_variable_start: parseInt(form.seg_variable_start) || 5,
          null_marker: form.null_marker || "---",
          priority: parseInt(form.priority) || 0,
          example_topic: form.example_topic || null,
        }),
      });
      setShowCreate(false);
      resetForm();
      loadProfiles();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdate = async (id: number) => {
    try {
      await apiFetch(`/admin/historian/profiles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          prefix: form.prefix,
          subscription: form.subscription || `${form.prefix}/#`,
          seg_machine: form.seg_machine ? parseInt(form.seg_machine) : null,
          seg_work_order: form.seg_work_order ? parseInt(form.seg_work_order) : null,
          seg_tool_id: form.seg_tool_id ? parseInt(form.seg_tool_id) : null,
          seg_category: form.seg_category ? parseInt(form.seg_category) : null,
          seg_variable_start: parseInt(form.seg_variable_start) || 5,
          null_marker: form.null_marker || "---",
          priority: parseInt(form.priority) || 0,
          example_topic: form.example_topic || null,
        }),
      });
      setEditId(null);
      resetForm();
      loadProfiles();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this profile?")) return;
    try {
      await apiFetch(`/admin/historian/profiles/${id}`, { method: "DELETE" });
      loadProfiles();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggle = async (profile: TopicProfileData) => {
    try {
      await apiFetch(`/admin/historian/profiles/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !profile.enabled }),
      });
      loadProfiles();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startEdit = (p: TopicProfileData) => {
    setEditId(p.id);
    setShowCreate(false);
    setForm({
      name: p.name,
      prefix: p.prefix,
      subscription: p.subscription,
      seg_machine: p.seg_machine !== null ? String(p.seg_machine) : "",
      seg_work_order: p.seg_work_order !== null ? String(p.seg_work_order) : "",
      seg_tool_id: p.seg_tool_id !== null ? String(p.seg_tool_id) : "",
      seg_category: p.seg_category !== null ? String(p.seg_category) : "",
      seg_variable_start: String(p.seg_variable_start),
      null_marker: p.null_marker || "---",
      priority: String(p.priority),
      example_topic: p.example_topic || "",
    });
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setSuggestions([]);
    setDiscoverErrors([]);
    setDiscoverInfo(`Sampling MQTT topics for ${discoverDuration}s...`);
    try {
      const data = await apiFetch<{
        duration_s: number;
        total_topics: number;
        suggestions: DiscoverySuggestion[];
        errors: string[];
      }>("/admin/historian/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_s: discoverDuration }),
      });
      setSuggestions(data.suggestions || []);
      setDiscoverErrors(data.errors || []);
      setDiscoverInfo(`Found ${data.total_topics} topics in ${data.duration_s.toFixed(1)}s`);
    } catch (err: any) {
      setDiscoverErrors([err.message]);
      setDiscoverInfo(null);
    } finally {
      setDiscovering(false);
    }
  };

  const adoptSuggestion = async (s: DiscoverySuggestion) => {
    try {
      await apiFetch("/admin/historian/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${s.prefix} (discovered)`,
          prefix: s.prefix,
          subscription: s.subscription,
          seg_machine: s.seg_machine,
          seg_work_order: s.seg_work_order,
          seg_tool_id: s.seg_tool_id,
          seg_category: s.seg_category,
          seg_variable_start: s.seg_variable_start,
          null_marker: s.null_marker || "---",
          priority: 10,
          example_topic: s.sample_topics[0] || null,
        }),
      });
      setSuggestions((prev) => prev.filter((x) => x.prefix !== s.prefix));
      loadProfiles();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Live preview — parse a topic against current profiles
  useEffect(() => {
    if (!previewTopic.trim()) { setPreviewResult(null); return; }
    const parts = previewTopic.split("/");
    let matched = false;
    for (const p of profiles) {
      if (!p.enabled || parts[0] !== p.prefix) continue;
      if (parts.length <= p.seg_variable_start) continue;
      const nullM = p.null_marker || "---";
      const machine = p.seg_machine !== null && p.seg_machine < parts.length ? parts[p.seg_machine] : "?";
      const wo = p.seg_work_order !== null && p.seg_work_order < parts.length ? parts[p.seg_work_order] : null;
      const tool = p.seg_tool_id !== null && p.seg_tool_id < parts.length ? parts[p.seg_tool_id] : null;
      const cat = p.seg_category !== null && p.seg_category < parts.length ? parts[p.seg_category] : "?";
      const variable = parts.slice(p.seg_variable_start).join("/");
      setPreviewResult(
        `Profile: ${p.name}\nMachine: ${machine}\nWork Order: ${wo === nullM ? "(null)" : wo || "(none)"}\nTool: ${tool === nullM ? "(null)" : tool || "(none)"}\nCategory: ${cat}\nVariable: ${variable}`
      );
      matched = true;
      break;
    }
    if (!matched) setPreviewResult("No matching profile");
  }, [previewTopic, profiles]);

  if (loading) return <div className="text-text-muted py-8 text-center">Loading profiles...</div>;

  const formFields = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs text-text-muted">Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Prefix</label>
        <input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value, subscription: `${e.target.value}/#` })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Subscription</label>
        <input value={form.subscription} onChange={(e) => setForm({ ...form, subscription: e.target.value })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Priority</label>
        <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Seg: Machine</label>
        <input type="number" value={form.seg_machine} onChange={(e) => setForm({ ...form, seg_machine: e.target.value })} placeholder="e.g. 1" className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Seg: Work Order</label>
        <input type="number" value={form.seg_work_order} onChange={(e) => setForm({ ...form, seg_work_order: e.target.value })} placeholder="e.g. 2" className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Seg: Tool ID</label>
        <input type="number" value={form.seg_tool_id} onChange={(e) => setForm({ ...form, seg_tool_id: e.target.value })} placeholder="e.g. 3" className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Seg: Category</label>
        <input type="number" value={form.seg_category} onChange={(e) => setForm({ ...form, seg_category: e.target.value })} placeholder="e.g. 4" className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Seg: Variable Start</label>
        <input type="number" value={form.seg_variable_start} onChange={(e) => setForm({ ...form, seg_variable_start: e.target.value })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div>
        <label className="text-xs text-text-muted">Null Marker</label>
        <input value={form.null_marker} onChange={(e) => setForm({ ...form, null_marker: e.target.value })} className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
      <div className="col-span-2">
        <label className="text-xs text-text-muted">Example Topic</label>
        <input value={form.example_topic} onChange={(e) => setForm({ ...form, example_topic: e.target.value })} placeholder="Factory/BZ-1/FA-001/T01/BDE/Spindle_RPM" className="w-full px-2 py-1.5 rounded border border-border bg-bg text-text text-sm" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text">Topic Profiles</h2>
          <p className="text-xs text-text-dim mt-1">Configure how MQTT topics are parsed into machine, category, and variable fields</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowCreate(!showCreate); setEditId(null); resetForm(); }}
            className="px-3 py-1.5 rounded text-xs font-medium bg-accent text-bg hover:bg-accent-hover"
          >
            {showCreate ? "Cancel" : "+ New Profile"}
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-lg border border-accent/30 bg-bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium text-text">Create New Profile</h3>
          {formFields}
          <button onClick={handleCreate} className="px-4 py-1.5 rounded text-xs font-medium bg-accent text-bg hover:bg-accent-hover">
            Create Profile
          </button>
        </div>
      )}

      {/* Profile List */}
      <div className="space-y-3">
        {profiles.map((p) => (
          <div key={p.id} className={`rounded-lg border bg-bg-surface p-4 ${p.enabled ? "border-border" : "border-border opacity-60"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text">{p.name}</span>
                {p.is_builtin && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">built-in</span>
                )}
                <span className="text-xs text-text-dim font-mono">{p.subscription}</span>
                <span className="text-xs text-text-dim">Priority: {p.priority}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(p)}
                  className={`text-xs px-2 py-1 rounded ${p.enabled ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}
                >
                  {p.enabled ? "Enabled" : "Disabled"}
                </button>
                <button onClick={() => startEdit(p)} className="text-xs text-accent hover:text-accent-hover">Edit</button>
                {!p.is_builtin && (
                  <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-text-dim">
              <span>Machine: seg[{p.seg_machine ?? "-"}]</span>
              <span>Order: seg[{p.seg_work_order ?? "-"}]</span>
              <span>Tool: seg[{p.seg_tool_id ?? "-"}]</span>
              <span>Category: seg[{p.seg_category ?? "-"}]</span>
              <span>Variable: seg[{p.seg_variable_start}+]</span>
              <span>Null: &quot;{p.null_marker}&quot;</span>
            </div>
            {p.example_topic && (
              <div className="mt-1 text-xs font-mono text-text-dim">Example: {p.example_topic}</div>
            )}

            {/* Inline Edit */}
            {editId === p.id && (
              <div className="mt-3 pt-3 border-t border-border space-y-3">
                {formFields}
                <div className="flex gap-2">
                  <button onClick={() => handleUpdate(p.id)} className="px-3 py-1.5 rounded text-xs font-medium bg-accent text-bg hover:bg-accent-hover">Save</button>
                  <button onClick={() => { setEditId(null); resetForm(); }} className="px-3 py-1.5 rounded text-xs text-text-muted hover:text-text">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="text-center py-8 text-text-dim text-sm">No profiles configured. Built-in defaults will be used.</div>
        )}
      </div>

      {/* Live Preview */}
      <div className="rounded-lg border border-border bg-bg-surface p-4">
        <h3 className="text-sm font-medium text-text mb-2">Live Preview</h3>
        <input
          value={previewTopic}
          onChange={(e) => setPreviewTopic(e.target.value)}
          placeholder="Enter a topic to preview parsing, e.g. Factory/BZ-1/FA-001/T01/BDE/Spindle_RPM"
          className="w-full px-3 py-2 rounded border border-border bg-bg text-text text-sm font-mono"
        />
        {previewResult && (
          <pre className="mt-2 text-xs text-text-muted font-mono whitespace-pre-wrap bg-bg p-2 rounded">{previewResult}</pre>
        )}
      </div>

      {/* Auto-Discovery */}
      <div className="rounded-lg border border-border bg-bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text">Auto-Discovery</h3>
            <p className="text-xs text-text-dim mt-0.5">Sample MQTT broker and use local LLM to analyze topic structure</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-muted">Duration:</label>
            <input
              type="range" min={10} max={120} value={discoverDuration}
              onChange={(e) => setDiscoverDuration(parseInt(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-text font-mono w-8">{discoverDuration}s</span>
            <button
              onClick={handleDiscover}
              disabled={discovering}
              className="px-4 py-1.5 rounded text-xs font-medium bg-accent text-bg hover:bg-accent-hover disabled:opacity-50"
            >
              {discovering ? "Sampling..." : "Discover"}
            </button>
          </div>
        </div>

        {discoverInfo && <p className="text-xs text-text-muted">{discoverInfo}</p>}
        {discoverErrors.length > 0 && (
          <div className="text-xs text-red-400 space-y-1">
            {discoverErrors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={i} className="rounded border border-border bg-bg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-text">{s.prefix}/#</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      s.confidence >= 0.7 ? "bg-green-500/10 text-green-400" :
                      s.confidence >= 0.4 ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-red-500/10 text-red-400"
                    }`}>
                      {(s.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                  <button
                    onClick={() => adoptSuggestion(s)}
                    className="px-3 py-1 rounded text-xs font-medium bg-accent text-bg hover:bg-accent-hover"
                  >
                    Adopt
                  </button>
                </div>
                <p className="text-xs text-text-dim mt-1">{s.reasoning}</p>
                <div className="mt-2 flex gap-3 text-xs text-text-dim">
                  <span>Machine: seg[{s.seg_machine ?? "-"}]</span>
                  <span>Category: seg[{s.seg_category ?? "-"}]</span>
                  <span>Variable: seg[{s.seg_variable_start}+]</span>
                </div>
                <div className="mt-1 text-xs font-mono text-text-dim truncate">
                  Samples: {s.sample_topics.slice(0, 3).join(", ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

