"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { getChallenge } from "@/lib/challenges-data";
import { useAuth } from "@/lib/auth-context";

const difficultyColors: Record<string, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Intermediate: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Advanced: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Expert: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function ChallengeDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const challenge = getChallenge(id);

  if (!challenge) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Challenge not found</h1>
        <Link href="/challenges" className="text-accent">
          Back to Challenges
        </Link>
      </section>
    );
  }

  const handleStart = () => {
    if (!user) {
      router.push("/login");
      return;
    }
    router.push(`/chat?challenge=${challenge.id}`);
  };

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-sm text-text-dim mb-8">
            <Link href="/challenges" className="hover:text-accent transition-colors">
              Challenges
            </Link>
            <span>/</span>
            <span className="text-text-muted">{challenge.name}</span>
          </div>

          <div className="flex items-start gap-5 mb-8">
            <div className="w-16 h-16 rounded-[18px] bg-bg-surface-2 grid place-items-center text-3xl border border-border">
              {challenge.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-extrabold tracking-tight">{challenge.name}</h1>
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded border ${difficultyColors[challenge.difficulty]}`}>
                  {challenge.difficulty}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-text-dim">
                <span>Target: <span className="text-accent font-mono">{challenge.kpiGoal}</span></span>
                <span>Time: {challenge.timeLimit}</span>
              </div>
            </div>
          </div>

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <p className="text-text-muted leading-relaxed">
              {challenge.longDescription}
            </p>
          </div>

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <h2 className="text-sm font-semibold text-text-muted mb-4">Rules</h2>
            <ul className="space-y-2.5">
              {challenge.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-bg-surface-2 border border-border grid place-items-center text-[10px] text-text-dim flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-text-muted">{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <h2 className="text-sm font-semibold text-text-muted mb-4">
              Available Tools ({challenge.tools.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {challenge.tools.map((tool) => (
                <span
                  key={tool}
                  className="text-xs font-mono px-3 py-1.5 rounded-sm bg-bg-surface-2 border border-border text-text-dim"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-bg-surface border border-border rounded-md p-6 mb-6">
            <h2 className="text-sm font-semibold text-text-muted mb-4">Leaderboard</h2>
            <div className="text-center py-8">
              <p className="text-text-dim text-sm mb-2">No submissions yet</p>
              <p className="text-xs text-text-dim">Be the first to complete this challenge!</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              className="flex-1 py-3.5 rounded-sm bg-accent text-bg font-semibold text-base hover:bg-accent-hover transition-colors"
            >
              Start Challenge
            </button>
            <Link
              href="/challenges"
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
