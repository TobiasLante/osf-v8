import Link from "next/link";

interface ChallengeProgress {
  progress: Record<string, { bestScore: number; completed: boolean }>;
  totalChallenges: number;
  completedCount: number;
}

interface ChallengeProgressCardProps {
  challengeProgress: ChallengeProgress | null;
}

export function ChallengeProgressCard({ challengeProgress }: ChallengeProgressCardProps) {
  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Challenge Progress</h2>
        <Link href="/challenges" className="text-xs text-accent hover:text-accent-hover transition-colors">
          View all challenges
        </Link>
      </div>
      <div className="bg-bg-surface border border-border rounded-md p-5">
        {challengeProgress === null ? (
          <p className="text-xs text-text-dim">Loading...</p>
        ) : (
          <>
            <div className="flex items-end justify-between mb-2">
              <span className="text-sm text-text-muted">
                {challengeProgress.completedCount} / {challengeProgress.totalChallenges} Challenges completed
              </span>
              <span className="text-xs font-medium text-accent">
                {Math.round((challengeProgress.completedCount / challengeProgress.totalChallenges) * 100)}%
              </span>
            </div>
            <div className="w-full h-2 bg-bg rounded-full overflow-hidden mb-4">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(challengeProgress.completedCount / challengeProgress.totalChallenges) * 100}%` }}
              />
            </div>
            {challengeProgress.completedCount < challengeProgress.totalChallenges && (
              <div className="flex items-center gap-3 p-3 rounded-sm border border-accent/10 bg-accent/5">
                <span className="text-lg">{"\u{1F3AF}"}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">Recommended Next</p>
                  <p className="text-xs text-text-muted">Try the next challenge to keep building your skills</p>
                </div>
                <Link href="/challenges" className="px-3 py-1.5 rounded-sm bg-accent text-bg text-xs font-medium hover:bg-accent-hover transition-colors shrink-0">
                  Start →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
