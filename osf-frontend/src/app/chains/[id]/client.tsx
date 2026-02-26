"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { ChainRunner } from "@/components/chains/ChainRunner";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface ChainStep {
  agentId: string;
  label?: string;
  condition?: string;
  passContext?: boolean;
}

interface Chain {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
  icon: string;
  category: string;
  difficulty: string;
  authorId?: string;
  authorName?: string;
  openSource?: boolean;
  featured?: boolean;
}

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function ChainDetailClient({ id: paramId }: { id: string }) {
  const { user } = useAuth();

  // In static export the param may be "placeholder", so read the real ID from the URL
  const id = typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() || paramId
    : paramId;

  const [chain, setChain] = useState<Chain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ chain: Chain }>(`/chains/${id}`)
      .then(({ chain }) => setChain(chain))
      .catch((err) => setError(err.message || "Chain not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <p className="text-text-dim">Loading chain...</p>
      </section>
    );
  }

  if (error || !chain) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Chain not found</h1>
        <Link href="/chains" className="text-accent">
          Back to Chains
        </Link>
      </section>
    );
  }

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-4xl">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-text-dim mb-6">
            <Link href="/chains" className="hover:text-accent transition-colors">
              Chains
            </Link>
            <span>/</span>
            <span className="text-text-muted">{chain.name}</span>
          </div>

          {/* Header */}
          <div className="flex items-start gap-5 mb-8">
            <div className="w-16 h-16 rounded-[18px] bg-bg-surface-2 grid place-items-center text-3xl shrink-0">
              {chain.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-3xl font-bold tracking-tight">{chain.name}</h1>
                {chain.featured && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">
                    Featured
                  </span>
                )}
                {chain.openSource && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                    Open Source
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${difficultyColors[chain.difficulty] || difficultyColors.Intermediate}`}>
                  {chain.difficulty}
                </span>
                <span className="text-xs text-text-dim">{chain.category}</span>
                <span className="text-xs text-text-dim">{chain.steps.length} steps</span>
                {chain.authorName && (
                  <span className="text-xs text-text-dim">by {chain.authorName}</span>
                )}
              </div>
              <p className="text-text-muted leading-relaxed">{chain.description}</p>
            </div>
          </div>

          {/* Chain flow visualization */}
          <div className="mb-8 p-6 border border-border rounded-lg bg-bg-surface">
            <h2 className="text-sm font-semibold text-text-muted mb-4">Chain Flow</h2>
            <div className="flex items-center gap-0 overflow-x-auto pb-2">
              {chain.steps.map((step, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <div className="flex flex-col items-center gap-1">
                    {step.condition && step.condition !== "always" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
                        if {step.condition.replace(/_/g, " ")}
                      </span>
                    )}
                    <div className="px-4 py-3 rounded-lg border border-border bg-bg-surface-2 text-center min-w-[140px]">
                      <p className="text-xs text-text-dim mb-0.5">Step {i + 1}</p>
                      <p className="text-sm font-semibold text-text">
                        {step.label || step.agentId}
                      </p>
                      <p className="text-[10px] text-text-dim font-mono mt-0.5">
                        {step.agentId}
                      </p>
                    </div>
                  </div>
                  {i < chain.steps.length - 1 && (
                    <div className="px-2">
                      <svg className="w-6 h-6 text-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Runner */}
          {user ? (
            <div className="border border-border rounded-lg bg-bg-surface p-6">
              <h2 className="text-sm font-semibold text-text-muted mb-4">Execute Chain</h2>
              <ChainRunner chainId={chain.id} totalSteps={chain.steps.length} />
            </div>
          ) : (
            <div className="border border-border rounded-lg bg-bg-surface p-8 text-center">
              <p className="text-text-muted mb-3">Log in to run this chain</p>
              <Link
                href="/login"
                className="inline-block px-6 py-2 bg-accent text-bg rounded-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Login
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
