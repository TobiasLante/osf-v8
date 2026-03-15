'use client';

import { useEffect, useState } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8080';

interface Incident {
  id: string;
  type: string;
  severity: string;
  namespace: string;
  resource_kind: string;
  resource_name: string;
  description: string;
  diagnosis: string;
  proposed_fix: string;
  fix_status: string;
}

export default function FixProposals() {
  const [proposals, setProposals] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchProposals();

    const es = new EventSource(`${AGENT_URL}/api/stream`);
    es.addEventListener('fix_proposed', () => fetchProposals());
    es.addEventListener('fix_applied', () => fetchProposals());
    es.addEventListener('fix_rejected', () => fetchProposals());
    return () => es.close();
  }, []);

  async function fetchProposals() {
    try {
      const res = await fetch(`${AGENT_URL}/api/incidents?status=proposed`);
      setProposals(await res.json());
    } catch {}
  }

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setLoading(prev => new Set(prev).add(id));
    try {
      await fetch(`${AGENT_URL}/api/incidents/${id}/${action}`, { method: 'POST' });
      await fetchProposals();
    } catch {}
    setLoading(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
        Pending Fixes
        {proposals.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs rounded">
            {proposals.length}
          </span>
        )}
      </h2>

      {proposals.length === 0 && (
        <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-4">No pending fixes</p>
      )}

      <div className="space-y-3">
        {proposals.map(p => (
          <div key={p.id} className="bg-gray-50 dark:bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-1.5 py-0.5 text-xs rounded border bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
                {p.severity}
              </span>
              <span className="text-sm font-medium">{p.type}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{p.namespace}/{p.resource_name}</span>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">{p.description}</p>
            {p.diagnosis && <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{p.diagnosis}</p>}
            <p className="text-sm text-blue-600 dark:text-blue-400 mb-3">{p.proposed_fix}</p>

            <div className="flex gap-2">
              <button
                onClick={() => handleAction(p.id, 'approve')}
                disabled={loading.has(p.id)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
              >
                {loading.has(p.id) ? 'Applying...' : 'Approve'}
              </button>
              <button
                onClick={() => handleAction(p.id, 'reject')}
                disabled={loading.has(p.id)}
                className="px-3 py-1 bg-red-600/50 hover:bg-red-500 text-white text-sm rounded disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
