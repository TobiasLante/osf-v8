import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface DeployedAgent {
  id: string;
  source_type: string;
  source_id: string;
  deploy_mode: string;
  name: string | null;
  icon: string | null;
  description: string | null;
  created_at: string;
}

interface DeployedAgentsSectionProps {
  deployedAgents: DeployedAgent[];
  onRemoveAgent: (agentId: string) => void;
}

export function DeployedAgentsSection({ deployedAgents, onRemoveAgent }: DeployedAgentsSectionProps) {
  if (deployedAgents.length === 0) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">
          My Deployed Agents ({deployedAgents.length})
        </h2>
        <Link
          href="/agents"
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          Browse more agents
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {deployedAgents.map(agent => {
          const typeBadge: Record<string, { label: string; cls: string }> = {
            agent: { label: "Agent", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
            chain: { label: "Chain", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
            code_agent: { label: "TS", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
            flow: { label: "Flow", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
          };
          const badge = typeBadge[agent.source_type] || typeBadge.agent;
          const runHref = agent.source_type === 'agent' || agent.source_type === 'chain'
            ? `/chat?agent=${agent.source_id}`
            : agent.source_type === 'flow'
            ? `/flows/${agent.source_id}`
            : `/agents/code/${agent.source_id}`;

          return (
            <div
              key={agent.id}
              className="flex items-center gap-3 bg-bg-surface border border-border rounded-sm p-3 hover:border-border-hover transition-colors"
            >
              <span className="text-lg shrink-0">{agent.icon || '\u{1F916}'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{agent.name || 'Unnamed'}</p>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <Link
                href={runHref}
                className="px-3 py-1.5 rounded-sm bg-accent text-bg text-xs font-medium hover:bg-accent-hover transition-colors shrink-0"
              >
                Run
              </Link>
              <button
                onClick={async () => {
                  if (!confirm('Remove from dashboard?')) return;
                  try {
                    await apiFetch(`/marketplace/deploy/${agent.id}`, { method: 'DELETE' });
                    onRemoveAgent(agent.id);
                  } catch {}
                }}
                className="text-text-dim hover:text-red-400 transition-colors shrink-0"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
