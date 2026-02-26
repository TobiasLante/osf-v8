'use client';

import { V7Event } from './types';

export function PlanStepper({ plan }: { plan: V7Event['plan'] }) {
  if (!plan) return null;
  return (
    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
        {'\u{1F4CB}'} {plan.title}
      </p>
      <div className="space-y-1.5">
        {plan.steps.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            {s.status === 'completed' && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
            {s.status === 'active' && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />}
            {s.status === 'pending' && <span className="w-2 h-2 rounded-full bg-text-dim/30 flex-shrink-0" />}
            {s.status === 'error' && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
            <span className={s.status === 'completed' ? 'text-text-dim line-through' : s.status === 'active' ? 'text-text' : 'text-text-dim'}>
              {s.title}
            </span>
            {s.duration != null && (
              <span className="text-xs text-text-dim ml-auto">{(s.duration / 1000).toFixed(1)}s</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
