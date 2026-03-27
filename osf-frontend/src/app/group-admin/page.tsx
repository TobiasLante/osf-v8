"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

interface GroupInfo {
  id: string;
  name: string;
  description: string | null;
  group_role: string;
  has_shared_key: boolean;
}

interface Member {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  joined_at: string;
}

interface TokenStatus {
  llm_provider: string | null;
  llm_base_url: string | null;
  llm_model: string | null;
  has_key: boolean;
}

interface PoolStats {
  warm: number;
  assigned: number;
  starting: number;
  targetSize: number;
}

export default function GroupAdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Token form
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [heating, setHeating] = useState(false);

  const loadGroup = useCallback(async () => {
    try {
      const data = await apiFetch<{ group: GroupInfo | null }>("/api/me/group");
      if (!data.group && user?.role !== "admin") {
        router.push("/dashboard");
        return;
      }
      setGroup(data.group);
    } catch { router.push("/dashboard"); }
  }, [router, user]);

  const loadMembers = useCallback(async () => {
    if (!group) return;
    try {
      const data = await apiFetch<{ members: Member[] }>(`/admin/groups/${group.id}/members`);
      setMembers(data.members);
    } catch (err: any) { setError(err.message); }
  }, [group]);

  const loadTokenStatus = useCallback(async () => {
    if (!group) return;
    try {
      const data = await apiFetch<TokenStatus>(`/admin/groups/${group.id}/token-status`);
      setTokenStatus(data);
      if (data.llm_provider) setProvider(data.llm_provider);
      if (data.llm_base_url) setBaseUrl(data.llm_base_url);
      if (data.llm_model) setModel(data.llm_model);
    } catch (err: any) { setError(err.message); }
  }, [group]);

  const loadPoolStats = useCallback(async () => {
    try {
      const data = await apiFetch<{ poolStats: PoolStats }>("/admin/nr-pods/stats");
      setPoolStats(data.poolStats);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!loading && user) loadGroup();
  }, [loading, user, loadGroup]);

  useEffect(() => {
    if (group) { loadMembers(); loadTokenStatus(); loadPoolStats(); }
  }, [group, loadMembers, loadTokenStatus, loadPoolStats]);

  const saveToken = async () => {
    if (!group || !apiKey) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/admin/groups/${group.id}/token`, {
        method: "PUT",
        body: JSON.stringify({ llm_provider: provider, llm_api_key: apiKey, llm_base_url: baseUrl || undefined, llm_model: model || undefined }),
      });
      setApiKey("");
      setSuccess("API Token saved");
      setTimeout(() => setSuccess(""), 3000);
      loadTokenStatus();
    } catch (err: any) { setError(err.message); }
    setSaving(false);
  };

  const deleteToken = async () => {
    if (!group || !confirm("Remove the shared API token? Members will fall back to platform LLM.")) return;
    try {
      await apiFetch(`/admin/groups/${group.id}/token`, { method: "DELETE" });
      setSuccess("Token removed");
      setTimeout(() => setSuccess(""), 3000);
      loadTokenStatus();
    } catch (err: any) { setError(err.message); }
  };

  const heatUp = async () => {
    if (!group) return;
    setHeating(true);
    setError("");
    try {
      const data = await apiFetch<{ targetSize: number; memberCount: number; poolStats: PoolStats }>(`/admin/groups/${group.id}/heat-up`, { method: "POST" });
      setPoolStats(data.poolStats);
      setSuccess(`Warming up ${data.targetSize} pods for ${data.memberCount} members`);
      setTimeout(() => setSuccess(""), 5000);
    } catch (err: any) { setError(err.message); }
    setHeating(false);
  };

  if (loading || !user) return null;
  if (!group) return (
    <div className="min-h-screen bg-bg pt-24 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-text-muted">Du bist keiner Lerngruppe zugewiesen.</p>
        {user.role === "admin" && (
          <a href="/admin" className="text-accent hover:underline text-sm">Gruppen im Admin Panel verwalten →</a>
        )}
      </div>
    </div>
  );

  const isGroupAdmin = group.group_role === "group_admin" || user.role === "admin";
  if (!isGroupAdmin) { router.push("/dashboard"); return null; }

  return (
    <div className="min-h-screen bg-bg pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-text">{group.name}</h1>
          {group.description && <p className="text-text-muted text-sm mt-1">{group.description}</p>}
          <span className="inline-block mt-2 text-xs font-mono px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
            {group.group_role === "group_admin" ? "Group Admin" : "Platform Admin"}
          </span>
        </div>

        {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">{error}</div>}
        {success && <div className="p-3 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-sm">{success}</div>}

        {/* Members */}
        <div className="border border-border rounded-lg p-5 bg-bg-surface">
          <h2 className="text-sm font-semibold text-text mb-3">Members ({members.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted border-b border-border">
                <th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Role</th><th className="py-2">Joined</th>
              </tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.user_id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{m.email}</td>
                    <td className="py-2 pr-4 text-text-muted">{m.name || "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${m.role === "group_admin" ? "bg-accent/20 text-accent" : "bg-bg text-text-muted"}`}>
                        {m.role === "group_admin" ? "Group Admin" : "Member"}
                      </span>
                    </td>
                    <td className="py-2 text-text-muted">{new Date(m.joined_at).toLocaleDateString("de-DE")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* API Token */}
        <div className="border border-border rounded-lg p-5 bg-bg-surface">
          <h2 className="text-sm font-semibold text-text mb-3">Shared API Token</h2>
          {tokenStatus?.has_key && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-green-500/10 border border-green-500/20 rounded text-sm">
              <span className="text-green-400">Active:</span>
              <span className="text-text-muted">{tokenStatus.llm_provider}{tokenStatus.llm_model ? ` / ${tokenStatus.llm_model}` : ""}</span>
              <button onClick={deleteToken} className="ml-auto text-red-400 hover:text-red-300 text-xs">Remove</button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} className="w-full bg-bg border border-border rounded px-3 py-2 text-sm">
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="azure">Azure AI Foundry</option>
                <option value="local">Local (llama.cpp)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">Model (optional)</label>
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-20250514" className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">API Key</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider === "azure" ? "your-api-key" : "sk-..."} className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">Base URL {provider === "azure" ? "" : "(optional)"}</label>
              <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={provider === "azure" ? "https://…azure.com/…/openai" : "https://api.anthropic.com"} className="w-full bg-bg border border-border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={saveToken} disabled={!apiKey || saving} className="mt-3 px-4 py-2 bg-accent text-bg rounded text-sm font-medium disabled:opacity-50 hover:bg-accent-hover">
            {saving ? "Saving..." : "Save Token"}
          </button>
        </div>

        {/* Heat-Up */}
        <div className="border border-border rounded-lg p-5 bg-bg-surface">
          <h2 className="text-sm font-semibold text-text mb-3">Session Heat-Up</h2>
          <p className="text-text-muted text-sm mb-3">
            Pre-warm Node-RED pods for all group members so they connect instantly.
          </p>
          {poolStats && (
            <div className="flex gap-4 mb-3 text-sm">
              <div><span className="text-text-muted">Warm:</span> <span className="text-green-400 font-mono">{poolStats.warm}</span></div>
              <div><span className="text-text-muted">Assigned:</span> <span className="text-accent font-mono">{poolStats.assigned}</span></div>
              <div><span className="text-text-muted">Starting:</span> <span className="text-yellow-400 font-mono">{poolStats.starting}</span></div>
              <div><span className="text-text-muted">Target:</span> <span className="font-mono">{poolStats.targetSize}</span></div>
            </div>
          )}
          <button onClick={heatUp} disabled={heating} className="px-4 py-2 bg-accent text-bg rounded text-sm font-medium disabled:opacity-50 hover:bg-accent-hover">
            {heating ? "Warming up..." : `Warm up pods (${members.length} members + 1 admin)`}
          </button>
        </div>
      </div>
    </div>
  );
}
