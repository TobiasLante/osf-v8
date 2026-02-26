"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

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

type Tab = "health" | "users" | "stats" | "news" | "banner" | "infra" | "nrpods";

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
          href="http://192.168.178.150:3000"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-xs font-medium rounded-md border border-border bg-bg-surface text-text-muted hover:text-text hover:border-accent/25 transition-colors"
        >
          Umami Analytics &rarr;
        </a>
      </div>

      <div className="flex gap-2 mb-6 border-b border-border">
        {(["health", "users", "stats", "news", "banner", "infra", "nrpods"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {t === "health" ? "Health" : t === "users" ? "Users" : t === "stats" ? "Stats" : t === "news" ? "News" : t === "banner" ? "Banner" : t === "infra" ? "Infrastructure" : "NR Pods"}
          </button>
        ))}
      </div>

      {tab === "health" && <HealthTab onNavigate={setTab} />}
      {tab === "users" && <UsersTab />}
      {tab === "stats" && <StatsTab />}
      {tab === "news" && <NewsTab />}
      {tab === "banner" && <BannerTab />}
      {tab === "infra" && <InfraTab />}
      {tab === "nrpods" && <NrPodsTab />}
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
    factorySim: HealthComponent;
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

  const components: { key: string; label: string; status: "healthy" | "degraded" | "critical"; metrics: string; navigateTo?: Tab }[] = [
    {
      key: "gateway", label: "Gateway", status: data.components.gateway.status,
      metrics: `${formatUptime(data.components.gateway.uptimeSeconds)} uptime, ${data.components.gateway.memoryMb} MB RAM`,
      navigateTo: "infra",
    },
    {
      key: "database", label: "Database", status: data.components.database.status,
      metrics: `${data.components.database.connectionsUsed}/${data.components.database.connectionsMax} conns, ${data.components.database.latencyMs}ms`,
      navigateTo: "infra",
    },
    {
      key: "llm", label: "LLM", status: data.components.llm.status,
      metrics: data.components.llm.online
        ? `Online, ${data.components.llm.activeRequests} active, ${data.components.llm.queuedRequests} queued`
        : "Offline",
      navigateTo: "infra",
    },
    {
      key: "nodered", label: "Node-RED Pods", status: data.components.nodered.status,
      metrics: `${data.components.nodered.warm} warm, ${data.components.nodered.assigned} assigned, target ${data.components.nodered.targetSize}`,
      navigateTo: "nrpods",
    },
    {
      key: "mcp", label: "MCP Services", status: data.components.mcp.status,
      metrics: `${data.components.mcp.services.filter((s: any) => s.ok).length}/${data.components.mcp.services.length} online`,
      navigateTo: "infra",
    },
    {
      key: "factorySim", label: "Factory Simulator", status: data.components.factorySim.status,
      metrics: data.components.factorySim.reachable ? `${data.components.factorySim.latencyMs}ms latency` : "Unreachable",
      navigateTo: "infra",
    },
    {
      key: "cloudflare", label: "Cloudflare", status: data.components.cloudflare.status,
      metrics: data.components.cloudflare.reachable ? "Reachable" : "Unreachable",
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
