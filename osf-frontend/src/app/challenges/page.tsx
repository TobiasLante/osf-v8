"use client";

import { useState } from "react";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { ChallengeCard } from "@/components/challenges/ChallengeCard";
import { challenges } from "@/lib/challenges-data";

const difficulties = ["Beginner", "Intermediate", "Advanced", "Expert"];

export default function ChallengesPage() {
  const [activeDifficulty, setActiveDifficulty] = useState<string | null>(null);

  const filtered = activeDifficulty
    ? challenges.filter((c) => c.difficulty === activeDifficulty)
    : challenges;

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              6 Challenges
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Challenges
            </h1>
            <p className="text-lg text-text-muted max-w-2xl mx-auto">
              Test your manufacturing AI skills against real KPI targets.
              From beginner OEE monitoring to expert full-auto factory management.
            </p>
          </div>

          {/* Difficulty filter */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            <button
              onClick={() => setActiveDifficulty(null)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                !activeDifficulty
                  ? "bg-accent text-bg"
                  : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
              }`}
            >
              All ({challenges.length})
            </button>
            {difficulties.map((d) => {
              const count = challenges.filter((c) => c.difficulty === d).length;
              if (count === 0) return null;
              return (
                <button
                  key={d}
                  onClick={() => setActiveDifficulty(d === activeDifficulty ? null : d)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    d === activeDifficulty
                      ? "bg-accent text-bg"
                      : "border border-border text-text-muted hover:text-accent hover:border-accent/30"
                  }`}
                >
                  {d} ({count})
                </button>
              );
            })}
          </div>

          {/* Challenge grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((challenge) => (
              <ChallengeCard key={challenge.id} challenge={challenge} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
