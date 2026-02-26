"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { getAgent, type Agent } from "@/lib/agents-data";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { DeployButton } from "@/components/agents/DeployButton";

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

const typeLabels: Record<string, string> = {
  operational: "Operational Agent",
  langgraph: "LangGraph Multi-Agent",
  strategic: "Strategic Pipeline",
};

interface ApiAgent {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  systemPrompt?: string;
  tools: string[];
  difficulty: string;
  icon: string;
  authorId?: string;
  authorName?: string;
  openSource?: boolean;
}

export function AgentDetailClient({ id: paramId }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();

  // In static export the param may be "placeholder", so read the real ID from the URL
  const id = typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() || paramId
    : paramId;

  const staticAgent = getAgent(id);
  const [apiAgent, setApiAgent] = useState<ApiAgent | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!staticAgent);

  useEffect(() => {
    if (!staticAgent) {
      apiFetch<{ agent: ApiAgent }>(`/agents/${id}`)
        .then(({ agent }) => setApiAgent(agent))
        .catch((err) => setApiError(err?.message || 'Failed to load agent'))
        .finally(() => setLoading(false));
    }
  }, [id, staticAgent]);

  const agent = staticAgent || (apiAgent ? {
    id: apiAgent.id,
    name: apiAgent.name,
    type: apiAgent.type as Agent["type"],
    category: apiAgent.category,
    description: apiAgent.description,
    longDescription: apiAgent.description,
    tools: apiAgent.tools || [],
    difficulty: apiAgent.difficulty as Agent["difficulty"],
    icon: apiAgent.icon || "\u{1F916}",
    featured: false,
  } : null);

  if (loading) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <p className="text-text-dim">Loading agent...</p>
      </section>
    );
  }

  if (!agent) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Agent not found</h1>
        {apiError && <p className="text-red-400 mb-4">{apiError}</p>}
        <Link href="/agents" className="text-accent">
          Back to Agents
        </Link>
      </section>
    );
  }

  const handleRun = () => {
    if (!user) {
      router.push("/login");
      return;
    }
    router.push(`/chat?agent=${agent.id}`);
  };

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-sm text-text-dim mb-8">
            <Link href="/agents" className="hover:text-accent transition-colors">
              Agents
            </Link>
            <span>/</span>
            <span className="text-text-muted">{agent.name}</span>
          </div>

          <div className="flex items-start gap-5 mb-8">
            <div className="w-16 h-16 rounded-[18px] bg-bg-surface-2 grid place-items-center text-3xl border border-border">
              {agent.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-extrabold tracking-tight">{agent.name}</h1>
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded border ${difficultyColors[agent.difficulty]}`}>
                  {agent.difficulty}
                </span>
                {apiAgent?.openSource && (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                    Open Source
                  </span>
                )}
              </div>
              <p className="text-sm text-text-dim">
                {typeLabels[agent.type]} &middot; {agent.category} &middot; {agent.tools.length} tools
                {apiAgent?.authorName && <> &middot; by {apiAgent.authorName}</>}
              </p>
            </div>
          </div>

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <p className="text-text-muted leading-relaxed">
              {agent.longDescription}
            </p>
          </div>

          {/* System Prompt — only for open-source agents */}
          {apiAgent?.openSource && apiAgent.systemPrompt && (
            <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
              <h2 className="text-sm font-semibold text-text-muted mb-3">
                System Prompt
              </h2>
              <pre className="text-sm text-text-muted font-mono whitespace-pre-wrap bg-bg-surface-2 rounded p-4 border border-border overflow-x-auto">
                {apiAgent.systemPrompt}
              </pre>
            </div>
          )}

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <h2 className="text-sm font-semibold text-text-muted mb-4">
              MCP Tools Used ({agent.tools.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <Link
                  key={tool}
                  href={`/docs#${tool}`}
                  className="text-xs font-mono px-3 py-1.5 rounded-sm bg-bg-surface-2 border border-border text-text-dim hover:text-accent hover:border-accent/30 transition-colors"
                >
                  {tool}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <button
              onClick={handleRun}
              className="flex-1 py-3.5 rounded-sm bg-accent text-bg font-semibold text-base hover:bg-accent-hover transition-colors"
            >
              Run Agent
            </button>
            <DeployButton sourceType="agent" sourceId={id} />
            <Link
              href="/agents"
              className="px-6 py-3.5 rounded-sm border border-border text-text-muted hover:text-text hover:border-border-hover transition-colors text-center"
            >
              Back
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
