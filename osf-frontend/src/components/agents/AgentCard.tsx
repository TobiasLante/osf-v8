import Link from "next/link";
import type { Agent } from "@/lib/agents-data";

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

const typeColors: Record<string, string> = {
  operational: "bg-accent/10 text-accent",
  langgraph: "bg-purple-500/10 text-purple-400",
  strategic: "bg-blue-500/10 text-blue-400",
};

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="group block p-6 rounded-lg border border-border bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 hover:shadow-lg transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-[14px] bg-bg-surface-2 grid place-items-center text-2xl">
          {agent.icon}
        </div>
        <div className="flex gap-1.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${typeColors[agent.type]}`}>
            {agent.type}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${difficultyColors[agent.difficulty]}`}>
            {agent.difficulty}
          </span>
        </div>
      </div>

      <h3 className="text-base font-bold mb-1.5 tracking-tight group-hover:text-accent transition-colors">
        {agent.name}
      </h3>
      <p className="text-sm text-text-muted leading-relaxed mb-4">
        {agent.description}
      </p>

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
    </Link>
  );
}
