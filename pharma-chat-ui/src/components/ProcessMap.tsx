"use client";

/**
 * ProcessMap — placeholder component for future process visualization.
 * Will show unit operations as a flow diagram (e.g., mAb: upstream → downstream → fill/finish).
 */
export function ProcessMap() {
  return (
    <div className="rounded-lg border border-p1-border bg-p1-surface p-6 text-center">
      <div className="flex items-center justify-center gap-2 mb-3">
        <div className="w-8 h-8 rounded bg-p1-accent/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-p1-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-p1-text">Process Map</h3>
      </div>
      <p className="text-p1-dim text-xs">
        Interactive process flow visualization coming soon.
        Ask the chat about a process template to see data here.
      </p>
    </div>
  );
}
