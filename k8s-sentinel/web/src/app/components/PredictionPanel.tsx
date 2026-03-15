'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';
import { useSSEEvents } from '../context/SSEContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface Prediction {
  id: string;
  cluster_id: string;
  type: string;
  severity: string;
  namespace: string;
  resource_kind: string;
  resource_name: string;
  description: string;
  trend_data: any;
  predicted_event: string;
  estimated_eta: string;
  acknowledged: boolean;
  created_at: string;
  expires_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  restart_trend: 'Restart Trend',
  memory_pressure: 'Memory Pressure',
  disk_pressure: 'Disk Pressure',
  pod_pending_trend: 'Stuck Pending',
};

export default function PredictionPanel() {
  const { activeClusterId } = useCluster();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState<Set<string>>(new Set());

  useSSEEvents(['prediction', 'prediction_expired'], () => fetchPredictions());

  useEffect(() => {
    fetchPredictions();
  }, [activeClusterId]);

  async function fetchPredictions() {
    try {
      const params = new URLSearchParams();
      if (activeClusterId) params.set('cluster_id', activeClusterId);
      const res = await fetch(`${AGENT_URL}/api/predictions?${params}`);
      setPredictions(await res.json());
    } catch {}
  }

  async function handleAcknowledge(id: string) {
    setLoading(prev => new Set(prev).add(id));
    try {
      await fetch(`${AGENT_URL}/api/predictions/${id}/acknowledge`, { method: 'POST' });
      await fetchPredictions();
    } catch {}
    setLoading(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function severityClasses(severity: string) {
    if (severity === 'critical') {
      return 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30';
    }
    return 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30';
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">
        Predictive Alerts
        {predictions.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs rounded">
            {predictions.length}
          </span>
        )}
      </h2>

      {predictions.length === 0 && (
        <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-4">
          No predictions — cluster is healthy
        </p>
      )}

      <div className="space-y-3">
        {predictions.map(p => (
          <div key={p.id} className="bg-gray-50 dark:bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-1.5 py-0.5 text-xs rounded border ${severityClasses(p.severity)}`}>
                {p.severity}
              </span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {TYPE_LABELS[p.type] || p.type}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {p.namespace ? `${p.namespace}/` : ''}{p.resource_name}
              </span>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">{p.description}</p>

            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
              {p.predicted_event && (
                <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                  {p.predicted_event}
                </span>
              )}
              {p.estimated_eta && (
                <span>ETA: {p.estimated_eta}</span>
              )}
            </div>

            <button
              onClick={() => handleAcknowledge(p.id)}
              disabled={loading.has(p.id)}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded disabled:opacity-50"
            >
              {loading.has(p.id) ? 'Dismissing...' : 'Acknowledge'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
