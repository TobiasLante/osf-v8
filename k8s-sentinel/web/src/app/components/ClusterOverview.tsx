'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface NodeInfo {
  name: string;
  ready: boolean;
  capacity: { cpu?: string; memory?: string };
}

interface NamespaceInfo {
  name: string;
  podsTotal: number;
  podsHealthy: number;
}

interface ClusterStatus {
  nodes?: NodeInfo[];
  namespaces?: NamespaceInfo[];
  pods?: any[];
  timestamp?: string;
}

export default function ClusterOverview() {
  const { activeClusterId, activeCluster } = useCluster();
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();

    const es = new EventSource(`${AGENT_URL}/api/stream`);
    es.addEventListener('cluster_status', () => fetchStatus());
    es.addEventListener('check_complete', () => fetchStatus());
    return () => es.close();
  }, [activeClusterId]);

  async function fetchStatus() {
    try {
      const query = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/status${query}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const totalPods = status?.pods?.length || 0;
  const healthyPods = status?.pods?.filter((p: any) => p.ready && p.phase === 'Running').length || 0;
  const totalNodes = status?.nodes?.length || 0;
  const readyNodes = status?.nodes?.filter((n: any) => n.ready).length || 0;

  const clusterTypeLabel = activeCluster?.type === 'docker' ? 'Docker' : 'K8s';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Cluster Overview</h2>
        {activeCluster && (
          <span
            className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
              activeCluster.type === 'k8s'
                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                : 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
            }`}
          >
            {clusterTypeLabel}
          </span>
        )}
      </div>

      {error && <p className="text-red-500 dark:text-red-400 text-sm mb-2">Agent unavailable: {error}</p>}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="Nodes" value={readyNodes} total={totalNodes} color="blue" />
        <StatCard label="Pods" value={healthyPods} total={totalPods} color="emerald" />
        <StatCard label="Namespaces" value={status?.namespaces?.length || 0} color="purple" />
        <StatCard label="Last Check" value={status?.timestamp ? timeAgo(status.timestamp) : '--'} color="gray" />
      </div>

      {/* Nodes */}
      <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Nodes</h3>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
        {(status?.nodes || []).map(node => (
          <div key={node.name} className="bg-gray-100 dark:bg-gray-800 rounded p-2 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${node.ready ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-sm truncate">{node.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{node.capacity?.cpu} CPU</span>
          </div>
        ))}
      </div>

      {/* Namespaces */}
      <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Namespaces</h3>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {(status?.namespaces || []).map(ns => (
          <div key={ns.name} className="flex items-center gap-2 text-sm">
            <span className="w-32 truncate">{ns.name}</span>
            <div className="flex-1 bg-gray-200 dark:bg-gray-800 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{ width: `${ns.podsTotal ? (ns.podsHealthy / ns.podsTotal) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 w-12 text-right">{ns.podsHealthy}/{ns.podsTotal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, total, color }: { label: string; value: any; total?: number; color: string }) {
  return (
    <div className="bg-gray-100 dark:bg-gray-800 rounded p-3 text-center">
      <div className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400`}>
        {value}{total !== undefined && <span className="text-gray-400 dark:text-gray-500 text-sm">/{total}</span>}
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
    </div>
  );
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3600_000)}h ago`;
}
