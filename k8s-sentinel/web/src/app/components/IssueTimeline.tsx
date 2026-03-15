'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';
import { useSSEEvents } from '../context/SSEContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

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
  created_at: string;
}

const severityColors: Record<string, string> = {
  harmless: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  medium: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  critical: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
};

const statusColors: Record<string, string> = {
  pending: 'text-gray-500 dark:text-gray-400',
  proposed: 'text-yellow-600 dark:text-yellow-400',
  fixed: 'text-emerald-600 dark:text-emerald-400',
  rejected: 'text-gray-400 dark:text-gray-500',
  alert: 'text-red-600 dark:text-red-400',
  fix_failed: 'text-red-600 dark:text-red-400',
};

export default function IssueTimeline() {
  const { activeClusterId } = useCluster();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useSSEEvents(['issue_detected', 'fix_applied', 'fix_proposed', 'fix_rejected'], () => fetchIncidents());

  useEffect(() => {
    fetchIncidents();
  }, [activeClusterId]);

  async function fetchIncidents() {
    try {
      const query = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/incidents${query}`);
      setIncidents(await res.json());
    } catch {}
  }

  const filtered = filter === 'all' ? incidents : incidents.filter(i => i.severity === filter);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Incidents</h2>
        <div className="flex gap-1">
          {['all', 'harmless', 'medium', 'critical'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded ${filter === f ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-4">No incidents</p>
        )}
        {filtered.map(inc => (
          <div key={inc.id} className="bg-gray-50 dark:bg-gray-800 rounded p-3 cursor-pointer" onClick={() => toggle(inc.id)}>
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-xs rounded border ${severityColors[inc.severity]}`}>
                {inc.severity}
              </span>
              <span className="text-sm font-medium">{inc.type}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{inc.resource_kind}/{inc.resource_name}</span>
              <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto">{inc.namespace}</span>
              <span className={`text-xs ${statusColors[inc.fix_status]}`}>{inc.fix_status}</span>
            </div>

            {expanded.has(inc.id) && (
              <div className="mt-2 text-sm space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2">
                <p className="text-gray-700 dark:text-gray-300">{inc.description}</p>
                {inc.diagnosis && (
                  <div>
                    <span className="text-gray-400 dark:text-gray-500 text-xs">Diagnosis:</span>
                    <p className="text-gray-600 dark:text-gray-400">{inc.diagnosis}</p>
                  </div>
                )}
                {inc.proposed_fix && (
                  <div>
                    <span className="text-gray-400 dark:text-gray-500 text-xs">Proposed Fix:</span>
                    <p className="text-blue-600 dark:text-blue-400">{inc.proposed_fix}</p>
                  </div>
                )}
                <p className="text-gray-300 dark:text-gray-600 text-xs">{new Date(inc.created_at).toLocaleString()}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
