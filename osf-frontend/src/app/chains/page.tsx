"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { apiFetch } from "@/lib/api";

interface ChainStep {
  agentId: string;
  label?: string;
  condition?: string;
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

export default function ChainsPage() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ chains: Chain[] }>("/chains")
      .then(({ chains }) => setChains(chains))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const categories = Array.from(new Set(chains.map(c => c.category))).sort();
  const filtered = activeCategory
    ? chains.filter(c => c.category === activeCategory)
    : chains;
  const featured = filtered.filter(c => c.featured);
  const community = filtered.filter(c => !c.featured);

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              {chains.length} Chains
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Multi-Agent Chains
              <span className="ml-2 text-xs font-mono text-text-dim align-super">v{process.env.NEXT_PUBLIC_CHAINS_VERSION}</span>
            </h1>
            <p className="text-lg text-text-muted max-w-2xl mx-auto">
              Connect multiple agents into automated pipelines.
              Each agent passes its findings to the next — like a factory assembly line for intelligence.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-center mb-8">
            <Link
              href="/chains/create"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-sm bg-accent text-bg font-semibold hover:bg-accent-hover transition-colors"
            >
              <span className="text-lg">+</span> Create Chain
            </Link>
          </div>

          {/* Category filter */}
          {categories.length > 1 && (
            <div className="flex flex-wrap justify-center gap-2 mb-10">
              <button
                onClick={() => setActiveCategory(null)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  !activeCategory
                    ? "bg-accent text-bg"
                    : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
                }`}
              >
                All ({chains.length})
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    cat === activeCategory
                      ? "bg-accent text-bg"
                      : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
                  }`}
                >
                  {cat} ({chains.filter(c => c.category === cat).length})
                </button>
              ))}
            </div>
          )}

          {/* Featured */}
          {featured.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-text-muted mb-4">Featured Chains</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
                {featured.map(chain => (
                  <ChainCard key={chain.id} chain={chain} />
                ))}
              </div>
            </>
          )}

          {/* Community */}
          {community.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-text-muted mb-4">Community Chains</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {community.map(chain => (
                  <ChainCard key={chain.id} chain={chain} />
                ))}
              </div>
            </>
          )}

          {loading && (
            <div className="text-center py-8 text-text-dim">Loading chains...</div>
          )}

          {!loading && community.length === 0 && !activeCategory && (
            <div className="mt-4 text-center py-12 border border-dashed border-border rounded-lg">
              <p className="text-text-dim mb-2">No community chains yet.</p>
              <p className="text-sm text-text-dim">
                Be the first to{" "}
                <Link href="/chains/create" className="text-accent hover:underline">
                  create one
                </Link>
                !
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ChainCard({ chain }: { chain: Chain }) {
  return (
    <Link
      href={`/chains/${chain.id}`}
      className="group block p-6 rounded-lg border border-border bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 hover:shadow-lg transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-[14px] bg-bg-surface-2 grid place-items-center text-2xl">
          {chain.icon}
        </div>
        <div className="flex gap-1.5 items-center">
          {chain.openSource && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
              Open Source
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${difficultyColors[chain.difficulty] || difficultyColors.Intermediate}`}>
            {chain.difficulty}
          </span>
        </div>
      </div>

      <h3 className="text-base font-bold mb-1.5 tracking-tight group-hover:text-accent transition-colors">
        {chain.name}
      </h3>
      {chain.authorName && (
        <p className="text-xs text-text-dim mb-1.5">by {chain.authorName}</p>
      )}
      <p className="text-sm text-text-muted leading-relaxed mb-4">
        {chain.description}
      </p>

      {/* Steps preview */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {chain.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface-2 border border-border text-text-dim">
              {step.label || step.agentId}
            </span>
            {i < chain.steps.length - 1 && (
              <span className="text-text-dim text-xs">→</span>
            )}
          </div>
        ))}
      </div>
    </Link>
  );
}
