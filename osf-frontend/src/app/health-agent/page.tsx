"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { StatusDot } from "@/components/ui/StatusDot";

interface HealthReport {
  id: number;
  status: "ok" | "alert" | "error";
  report: string;
  tool_calls: number;
  duration_ms: number;
  created_at: string;
}

const statusMap: Record<string, "online" | "error" | "warning"> = {
  ok: "online",
  alert: "error",
  error: "warning",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HealthAgentPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [reports, setReports] = useState<HealthReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      const data = await apiFetch<{ reports: HealthReport[]; total: number }>(
        "/health-agent/reports?limit=20"
      );
      setReports(data.reports);
      setTotal(data.total);
      setError(null);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setError("Admin access required");
      } else {
        setError(err.message || "Failed to load reports");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== "admin")) {
      router.push("/login");
      return;
    }
    if (user?.role === "admin") {
      fetchReports();
      const interval = setInterval(fetchReports, 60_000);
      return () => clearInterval(interval);
    }
  }, [user, authLoading, router, fetchReports]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <BackgroundOrbs />
        <p className="text-text-dim animate-pulse">Loading...</p>
      </div>
    );
  }

  const latest = reports[0];
  const overallStatus = latest?.status || "unknown";

  return (
    <div className="min-h-screen bg-bg-base relative">
      <BackgroundOrbs />
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <h1 className="text-2xl font-bold text-text-primary">
            Health Agent
          </h1>
          <button
            onClick={() => {
              setLoading(true);
              fetchReports();
            }}
            className="text-xs text-text-dim hover:text-text-primary transition-colors px-3 py-1 border border-border rounded-md"
          >
            Refresh
          </button>
        </div>

        {/* Status Ampel */}
        <div className="bg-bg-surface border border-border rounded-lg p-6 mb-6">
          <div className="flex items-center gap-4">
            <div
              className={`w-8 h-8 rounded-full ${
                overallStatus === "ok"
                  ? "bg-green-400"
                  : overallStatus === "alert"
                  ? "bg-red-400 animate-pulse"
                  : overallStatus === "error"
                  ? "bg-amber-400"
                  : "bg-gray-500"
              }`}
            />
            <div>
              <p className="text-lg font-semibold text-text-primary">
                {overallStatus === "ok"
                  ? "All Systems Operational"
                  : overallStatus === "alert"
                  ? "Alert — Issues Detected"
                  : overallStatus === "error"
                  ? "Agent Error"
                  : "No Data"}
              </p>
              {latest && (
                <p className="text-sm text-text-dim">
                  Last check: {timeAgo(latest.created_at)} &middot;{" "}
                  {formatDuration(latest.duration_ms)} &middot;{" "}
                  {latest.tool_calls} tool calls
                </p>
              )}
              {!latest && (
                <p className="text-sm text-text-dim">
                  No health checks recorded yet. The agent runs every 2 hours.
                </p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Report List */}
        {reports.length > 0 && (
          <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">
                Recent Checks ({total} total)
              </h2>
            </div>
            <div className="divide-y divide-border">
              {reports.map((r) => (
                <div key={r.id}>
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === r.id ? null : r.id)
                    }
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-base/50 transition-colors text-left"
                  >
                    <StatusDot
                      status={statusMap[r.status] || "offline"}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">
                        {r.report.split("\n")[0].slice(0, 120)}
                      </p>
                      <p className="text-xs text-text-dim">
                        {new Date(r.created_at).toLocaleString("de-DE")} &middot;{" "}
                        {formatDuration(r.duration_ms)} &middot;{" "}
                        {r.tool_calls} tools
                      </p>
                    </div>
                    <span className="text-text-dim text-xs">
                      {expandedId === r.id ? "▲" : "▼"}
                    </span>
                  </button>
                  {expandedId === r.id && (
                    <div className="px-4 pb-4">
                      <pre className="bg-bg-base rounded-md p-4 text-xs text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-[500px] overflow-y-auto border border-border">
                        {r.report}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {reports.length === 0 && !error && (
          <div className="text-center py-12 text-text-dim">
            <p className="text-lg mb-2">No health checks yet</p>
            <p className="text-sm">
              Deploy the health-agent CronJob and it will start checking every 2 hours.
            </p>
            <code className="block mt-4 text-xs bg-bg-surface rounded-md px-4 py-2 inline-block">
              kubectl create job health-test --from=cronjob/health-agent -n osf
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
