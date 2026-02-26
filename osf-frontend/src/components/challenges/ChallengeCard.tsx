import Link from "next/link";
import type { Challenge } from "@/lib/challenges-data";

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function ChallengeCard({ challenge }: { challenge: Challenge }) {
  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group block p-6 rounded-lg border border-border bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 hover:shadow-lg transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-[14px] bg-bg-surface-2 grid place-items-center text-2xl">
          {challenge.icon}
        </div>
        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded border ${difficultyColors[challenge.difficulty]}`}>
          {challenge.difficulty}
        </span>
      </div>

      <h3 className="text-base font-bold mb-1.5 tracking-tight group-hover:text-accent transition-colors">
        {challenge.name}
      </h3>
      <p className="text-sm text-text-muted leading-relaxed mb-4">
        {challenge.description}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
            {challenge.kpiGoal}
          </span>
        </div>
        <span className="text-[11px] text-text-dim">
          {challenge.timeLimit}
        </span>
      </div>
    </Link>
  );
}
