'use client';

import Link from 'next/link';

interface FlowCardProps {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  updatedAt?: string;
}

const statusColors: Record<string, string> = {
  completed: 'text-emerald-400',
  running: 'text-amber-400',
  paused: 'text-blue-400',
  failed: 'text-red-400',
};

const statusLabels: Record<string, string> = {
  completed: 'Completed',
  running: 'Running',
  paused: 'Paused',
  failed: 'Failed',
};

export default function FlowCard({ id, name, description, icon, lastRunStatus, lastRunAt, updatedAt }: FlowCardProps) {
  return (
    <Link
      href={`/flows/${id}`}
      className="block border border-border rounded-md p-5 bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon || '🔀'}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-text font-semibold truncate">{name}</h3>
          {description && (
            <p className="text-text-muted text-sm mt-1 line-clamp-2">{description}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-xs text-text-dim">
            {lastRunStatus && (
              <span className={`flex items-center gap-1 ${statusColors[lastRunStatus] || 'text-text-dim'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {statusLabels[lastRunStatus] || lastRunStatus}
              </span>
            )}
            {lastRunAt && (
              <span>{new Date(lastRunAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
