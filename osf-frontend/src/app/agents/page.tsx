"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { agents as staticAgents, type Agent } from "@/lib/agents-data";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface ApiAgent {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  tools: string[];
  difficulty: string;
  icon: string;
  authorId?: string;
  authorName?: string;
  featured?: boolean;
  openSource?: boolean;
}

interface CodeAgentSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  repoFullName: string;
  repoUrl: string;
  deployStatus: string;
  isPublic: boolean;
  lastSyncedAt: string | null;
}

interface ChainSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  difficulty: string;
  steps: any[];
  author_id?: string;
  open_source?: boolean;
}

interface PublicFlow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  difficulty: string;
  author_name?: string;
}

type AgentSource = "builtin" | "community" | "code" | "chain" | "flow";

interface UnifiedAgent {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  tools: string[];
  difficulty: string;
  icon: string;
  source: AgentSource;
  authorName?: string;
  openSource?: boolean;
  repoFullName?: string;
  repoUrl?: string;
  deployStatus?: string;
  featured?: boolean;
  stepCount?: number;
}

function apiToAgent(a: ApiAgent): UnifiedAgent {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    category: a.category,
    description: a.description,
    tools: a.tools || [],
    difficulty: a.difficulty,
    icon: a.icon || "\u{1F916}",
    source: "community",
    authorName: a.authorName,
    openSource: a.openSource,
    featured: a.featured ?? false,
  };
}

function staticToUnified(a: Agent): UnifiedAgent {
  return {
    ...a,
    source: "builtin" as AgentSource,
  };
}

function codeToUnified(a: CodeAgentSummary): UnifiedAgent {
  return {
    id: a.id,
    name: a.name,
    type: "code",
    category: "Code Agent",
    description: a.description,
    tools: [],
    difficulty: "Intermediate",
    icon: a.icon || "\u{1F4BB}",
    source: "code",
    repoFullName: a.repoFullName,
    repoUrl: a.repoUrl,
    deployStatus: a.deployStatus,
  };
}

function chainToUnified(c: ChainSummary): UnifiedAgent {
  return {
    id: c.id,
    name: c.name,
    type: "chain",
    category: c.category || "General",
    description: c.description,
    tools: [],
    difficulty: c.difficulty || "Intermediate",
    icon: c.icon || "\u{1F517}",
    source: "chain",
    openSource: c.open_source,
    stepCount: Array.isArray(c.steps) ? c.steps.length : 0,
  };
}

function flowToUnified(f: PublicFlow): UnifiedAgent {
  return {
    id: f.id,
    name: f.name,
    type: "flow",
    category: f.category || "General",
    description: f.description || "",
    tools: [],
    difficulty: f.difficulty || "Beginner",
    icon: f.icon || "\u{1F500}",
    source: "flow",
    authorName: f.author_name,
  };
}

const ITEMS_PER_PAGE = 20;

const CATEGORY_ORDER = ["Production", "Supply Chain", "Delivery", "Quality", "Planning", "Sustainability"];

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

const SOURCE_BADGE: Record<AgentSource, { label: string; cls: string }> = {
  builtin: { label: "Built-in", cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  community: { label: "Agent", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  code: { label: "TypeScript", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  chain: { label: "Chain", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  flow: { label: "Flow", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

export default function AgentsPage() {
  const { user } = useAuth();
  const [communityAgents, setCommunityAgents] = useState<UnifiedAgent[]>([]);
  const [codeAgents, setCodeAgents] = useState<UnifiedAgent[]>([]);
  const [chainAgents, setChainAgents] = useState<UnifiedAgent[]>([]);
  const [flowAgents, setFlowAgents] = useState<UnifiedAgent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<AgentSource | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 2) setLoading(false); };

    apiFetch<{ agents: ApiAgent[] }>("/agents")
      .then(({ agents }) => {
        const staticIds = new Set(staticAgents.map(a => a.id));
        const community = agents
          .filter(a => !staticIds.has(a.id) && !a.featured)
          .map(apiToAgent);
        setCommunityAgents(community);
      })
      .catch(() => {})
      .finally(checkDone);

    apiFetch<{ agents: CodeAgentSummary[] }>("/code-agents")
      .then(({ agents }) => setCodeAgents(agents.map(codeToUnified)))
      .catch(() => {})
      .finally(checkDone);

    // Load chains
    apiFetch<{ chains: ChainSummary[] }>("/chains")
      .then(({ chains }) => setChainAgents(chains.map(chainToUnified)))
      .catch(() => {});

    // Load public flows
    apiFetch<{ flows: PublicFlow[] }>("/flows/api/public")
      .then(({ flows }) => setFlowAgents(flows.map(flowToUnified)))
      .catch(() => {});
  }, []);

  const allAgents = useMemo(() => [
    ...staticAgents.map(staticToUnified),
    ...communityAgents,
    ...chainAgents,
    ...codeAgents,
    ...flowAgents,
  ], [communityAgents, codeAgents, chainAgents, flowAgents]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of allAgents) {
      counts[a.category] = (counts[a.category] || 0) + 1;
    }
    return counts;
  }, [allAgents]);

  // Source counts
  const sourceCounts = useMemo(() => {
    const counts: Record<AgentSource, number> = { builtin: 0, community: 0, code: 0, chain: 0, flow: 0 };
    for (const a of allAgents) counts[a.source]++;
    return counts;
  }, [allAgents]);

  const categories = useMemo(() => {
    const cats = Object.keys(categoryCounts);
    return cats.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [categoryCounts]);

  // Filtering
  const filtered = useMemo(() => {
    let result = allAgents;

    if (activeCategory) {
      result = result.filter(a => a.category === activeCategory);
    }

    if (activeSource) {
      result = result.filter(a => a.source === activeSource);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tools.some(t => t.toLowerCase().includes(q))
      );
    }

    return result;
  }, [allAgents, activeCategory, activeSource, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, activeCategory, activeSource]);

  const clearFilters = () => {
    setSearch("");
    setActiveCategory(null);
    setActiveSource(null);
    setPage(1);
  };

  const sourceFilters: { key: AgentSource; label: string }[] = [
    { key: "builtin", label: "Built-in" },
    { key: "community", label: "Community" },
    { key: "chain", label: "Chains" },
    { key: "code", label: "Code Agents" },
    { key: "flow", label: "Flows" },
  ];

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-1">
                  AI Agents
                </h1>
                <p className="text-text-muted text-sm">
                  {allAgents.length} agents available &middot; Agents, chains, flows, and code agents
                </p>
              </div>
              <div className="flex gap-3">
                {user && (
                  <>
                    <Link
                      href="/agents/create"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm bg-accent text-bg font-semibold text-sm hover:bg-accent-hover transition-colors"
                    >
                      <span className="text-lg leading-none">+</span> Create Agent
                    </Link>
                    <Link
                      href="/agents/code/new"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm border border-accent text-accent font-semibold text-sm hover:bg-accent/10 transition-colors"
                    >
                      <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                      Deploy from GitHub
                    </Link>
                  </>
                )}
                <a
                  href="https://github.com/TobiasLante/openshopfloor/discussions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm border border-border text-text-muted font-semibold text-sm hover:border-accent/30 hover:text-accent transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current"><path d="M1.5 2.75a.25.25 0 0 1 .25-.25h8.5a.25.25 0 0 1 .25.25v5.5a.25.25 0 0 1-.25.25h-3.5a.75.75 0 0 0-.53.22L3.5 11.44V9.25a.75.75 0 0 0-.75-.75h-1a.25.25 0 0 1-.25-.25Zm.25-1.75A1.75 1.75 0 0 0 0 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 0 0 2.487 1.03L7.061 10h3.189A1.75 1.75 0 0 0 12 8.25v-5.5A1.75 1.75 0 0 0 10.25 1ZM14.5 4.75a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.457 1.457 0 0 1-2.487 1.03L9.22 12.28a.75.75 0 0 1 1.06-1.06l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z"/></svg>
                  Discuss
                </a>
              </div>
            </div>

            {/* Search bar */}
            <div className="relative max-w-md">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search agents by name, description, or tools..."
                className="w-full pl-10 pr-4 py-2.5 rounded-sm bg-bg-surface border border-border text-text text-sm placeholder:text-text-dim focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-8">
            {/* Sidebar */}
            <aside className="hidden lg:block w-56 flex-shrink-0">
              <div className="sticky top-28 space-y-6">
                {/* Categories */}
                <div>
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Categories</h3>
                  <nav className="space-y-0.5">
                    <button
                      onClick={() => setActiveCategory(null)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm transition-colors ${
                        !activeCategory ? "bg-accent/10 text-accent font-medium" : "text-text-muted hover:text-text hover:bg-bg-surface-2"
                      }`}
                    >
                      <span>All</span>
                      <span className="text-xs text-text-dim">{allAgents.length}</span>
                    </button>
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm transition-colors ${
                          activeCategory === cat ? "bg-accent/10 text-accent font-medium" : "text-text-muted hover:text-text hover:bg-bg-surface-2"
                        }`}
                      >
                        <span>{cat}</span>
                        <span className="text-xs text-text-dim">{categoryCounts[cat] || 0}</span>
                      </button>
                    ))}
                  </nav>
                </div>

                {/* Types */}
                <div>
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">Types</h3>
                  <nav className="space-y-0.5">
                    <button
                      onClick={() => setActiveSource(null)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm transition-colors ${
                        !activeSource ? "bg-accent/10 text-accent font-medium" : "text-text-muted hover:text-text hover:bg-bg-surface-2"
                      }`}
                    >
                      <span>All Types</span>
                    </button>
                    {sourceFilters.map(sf => (
                      <button
                        key={sf.key}
                        onClick={() => setActiveSource(activeSource === sf.key ? null : sf.key)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm transition-colors ${
                          activeSource === sf.key ? "bg-accent/10 text-accent font-medium" : "text-text-muted hover:text-text hover:bg-bg-surface-2"
                        }`}
                      >
                        <span>{sf.label}</span>
                        <span className="text-xs text-text-dim">{sourceCounts[sf.key]}</span>
                      </button>
                    ))}
                  </nav>
                </div>
              </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {/* Mobile filter pills (visible on smaller screens) */}
              <div className="lg:hidden flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => { setActiveCategory(null); setActiveSource(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    !activeCategory && !activeSource
                      ? "bg-accent text-bg"
                      : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
                  }`}
                >
                  All ({allAgents.length})
                </button>
                {sourceFilters.map(sf => (
                  <button
                    key={sf.key}
                    onClick={() => setActiveSource(activeSource === sf.key ? null : sf.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      activeSource === sf.key
                        ? "bg-accent text-bg"
                        : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
                    }`}
                  >
                    {sf.label} ({sourceCounts[sf.key]})
                  </button>
                ))}
              </div>

              {/* Active filters indicator */}
              {(search || activeCategory || activeSource) && (
                <div className="flex items-center gap-2 mb-4 text-sm">
                  <span className="text-text-dim">Showing {filtered.length} of {allAgents.length} agents</span>
                  <button onClick={clearFilters} className="text-accent hover:underline text-xs">Clear filters</button>
                </div>
              )}

              {/* Agent Grid */}
              {paged.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {paged.map(agent => (
                    <UnifiedAgentCard key={`${agent.source}-${agent.id}`} agent={agent} />
                  ))}
                </div>
              ) : loading ? (
                <div className="text-center py-16 text-text-dim">Loading agents...</div>
              ) : (
                <div className="text-center py-16 border border-dashed border-border rounded-lg">
                  <p className="text-text-dim mb-2">No agents found.</p>
                  {(search || activeCategory || activeSource) && (
                    <button onClick={clearFilters} className="text-accent text-sm hover:underline">Clear filters</button>
                  )}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-4 py-2 rounded-sm border border-border text-sm text-text-muted hover:text-text hover:border-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-text-dim">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="px-4 py-2 rounded-sm border border-border text-sm text-text-muted hover:text-text hover:border-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function TypeBadge({ source }: { source: AgentSource }) {
  const badge = SOURCE_BADGE[source];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

function UnifiedAgentCard({ agent }: { agent: UnifiedAgent }) {
  const href = agent.source === "code"
    ? `/agents/code/${agent.id}`
    : agent.source === "chain"
    ? `/chains/${agent.id}`
    : agent.source === "flow"
    ? `/flows/${agent.id}`
    : `/agents/${agent.id}`;

  return (
    <Link
      href={href}
      className="group block p-6 rounded-lg border border-border bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 hover:shadow-lg transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-[14px] bg-bg-surface-2 grid place-items-center text-2xl">
          {agent.icon}
        </div>
        <div className="flex gap-1.5 items-center">
          <TypeBadge source={agent.source} />
          {agent.openSource && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
              Open Source
            </span>
          )}
          {agent.source === "code" && agent.deployStatus && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
              agent.deployStatus === 'deployed'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : agent.deployStatus === 'error'
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              {agent.deployStatus}
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${difficultyColors[agent.difficulty] || difficultyColors.Beginner}`}>
            {agent.difficulty}
          </span>
        </div>
      </div>

      <h3 className="text-base font-bold mb-1 tracking-tight group-hover:text-accent transition-colors">
        {agent.name}
      </h3>
      {agent.source === "code" && agent.repoFullName && (
        <p className="text-xs text-text-dim mb-1.5 font-mono">{agent.repoFullName}</p>
      )}
      {agent.authorName && (
        <p className="text-xs text-text-dim mb-1.5">by {agent.authorName}</p>
      )}
      {agent.source === "chain" && agent.stepCount !== undefined && agent.stepCount > 0 && (
        <p className="text-xs text-text-dim mb-1.5">{agent.stepCount} steps</p>
      )}
      <p className="text-sm text-text-muted leading-relaxed mb-4">
        {agent.description}
      </p>

      {agent.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agent.tools.slice(0, 3).map((tool) => (
            <span
              key={tool}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface-2 border border-border text-text-dim"
            >
              {tool.replace("factory_", "")}
            </span>
          ))}
          {agent.tools.length > 3 && (
            <span className="text-[10px] text-text-dim px-1">
              +{agent.tools.length - 3} more
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
