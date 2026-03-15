'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';
import { useSSEEvents } from '../context/SSEContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface ExecutionLogEntry {
  step: number;
  type: string;
  params: Record<string, any>;
  success: boolean;
  detail: string;
  timestamp: string;
}

interface Execution {
  id: string;
  runbook_id: string;
  runbook_name?: string;
  incident_id: string;
  cluster_id?: string;
  status: string;
  steps_completed: number;
  steps_total: number;
  log: ExecutionLogEntry[];
  started_at: string;
  finished_at?: string;
}

const statusColors: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
};

export default function RunbookExecutions() {
  const { activeClusterId } = useCluster();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useSSEEvents(['runbook_started', 'runbook_step', 'runbook_completed'], () => fetchExecutions());

  useEffect(() => {
    fetchExecutions();
  }, [activeClusterId]);

  async function fetchExecutions() {
    try {
      const params = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/runbook-executions${params}`);
      setExecutions(await res.json());
    } catch {}
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
        Runbook Executions
        {executions.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs rounded">
            {executions.length}
          </span>
        )}
      </h2>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {executions.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-4">No executions yet</p>
        )}
        {executions.map(ex => (
          <div
            key={ex.id}
            className="bg-gray-50 dark:bg-gray-800 rounded p-3 cursor-pointer"
            onClick={() => toggle(ex.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-xs rounded border ${statusColors[ex.status] || statusColors.failed}`}>
                {ex.status}
              </span>
              <span className="text-sm font-medium">{ex.runbook_name || 'Unknown Runbook'}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {ex.steps_completed}/{ex.steps_total} steps
              </span>
              <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto">
                {new Date(ex.started_at).toLocaleString()}
              </span>
            </div>

            {expanded.has(ex.id) && (
              <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2 space-y-1">
                {(ex.log || []).map((entry, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-6 flex-shrink-0">#{entry.step}</span>
                    <span className={`px-1 py-0.5 text-xs rounded flex-shrink-0 ${entry.success ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}>
                      {entry.type}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400 text-xs">{entry.detail}</span>
                    <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto flex-shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {ex.finished_at && (
                  <p className="text-xs text-gray-300 dark:text-gray-600 pt-1">
                    Finished: {new Date(ex.finished_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
