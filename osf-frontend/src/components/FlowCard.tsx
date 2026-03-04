'use client';

import { useState } from 'react';
import Link from 'next/link';

interface FlowCardProps {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  flowTabId?: string;
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

export default function FlowCard({ id, name, description, icon, flowTabId, lastRunStatus, lastRunAt, updatedAt }: FlowCardProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="block w-full text-left border border-border rounded-md p-5 bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 transition-all"
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
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-bg-surface border border-border rounded-lg p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-4 mb-4">
              <span className="text-4xl">{icon || '🔀'}</span>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-text">{name}</h3>
                {description && (
                  <p className="text-text-muted text-sm mt-2">{description}</p>
                )}
              </div>
            </div>

            <div className="space-y-2 text-sm mb-6">
              {lastRunStatus && (
                <div className="flex justify-between">
                  <span className="text-text-dim">Last run</span>
                  <span className={`flex items-center gap-1.5 ${statusColors[lastRunStatus] || 'text-text-dim'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {statusLabels[lastRunStatus] || lastRunStatus}
                  </span>
                </div>
              )}
              {lastRunAt && (
                <div className="flex justify-between">
                  <span className="text-text-dim">Run at</span>
                  <span className="text-text-muted">{new Date(lastRunAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {updatedAt && (
                <div className="flex justify-between">
                  <span className="text-text-dim">Updated</span>
                  <span className="text-text-muted">{new Date(updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Link
                href={`/flows/${id}`}
                className="flex-1 py-2.5 rounded-sm border border-border text-text-muted text-sm text-center hover:text-text hover:border-border-hover transition-colors"
              >
                Details
              </Link>
              <Link
                href={flowTabId ? `/flows/editor?tab=${flowTabId}` : `/flows/${id}`}
                className="flex-1 py-2.5 rounded-sm bg-accent text-bg text-sm font-medium text-center hover:bg-accent-hover transition-colors"
              >
                Open in Editor
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
