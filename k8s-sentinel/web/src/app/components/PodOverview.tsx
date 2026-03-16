'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';
import { useSSE } from '../context/SSEContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface Pod {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restartCount: number;
  nodeName?: string;
  protected: boolean;
  containerStatuses: { name: string; ready: boolean; state: string; reason?: string }[];
}

interface ProtectionRule {
  namespace: string;
  pod_pattern: string;
  reason: string;
  created_at: string;
}

const phaseColors: Record<string, string> = {
  Running: 'text-emerald-600 dark:text-emerald-400',
  Succeeded: 'text-blue-600 dark:text-blue-400',
  Pending: 'text-yellow-600 dark:text-yellow-400',
  Failed: 'text-red-600 dark:text-red-400',
  Unknown: 'text-gray-500 dark:text-gray-400',
};

const patternPresets = [
  { label: 'All pods (*)', pattern: '*' },
  { label: 'Prefix match (name-*)', pattern: '' },
  { label: 'Exact pod name', pattern: '' },
];

export default function PodOverview() {
  const { activeClusterId, activeCluster } = useCluster();
  const [pods, setPods] = useState<Pod[]>([]);
  const [rules, setRules] = useState<ProtectionRule[]>([]);
  const [nsFilter, setNsFilter] = useState<string>('all');
  const [showProtectModal, setShowProtectModal] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [protectNs, setProtectNs] = useState('');
  const [protectPattern, setProtectPattern] = useState('');
  const [protectReason, setProtectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isDocker = activeCluster?.type === 'docker';
  const entityLabel = isDocker ? 'Containers' : 'Pods';
  const entityLabelSingular = isDocker ? 'Container' : 'Pod';

  useSSE('check_complete', () => fetchPods());

  useEffect(() => {
    fetchPods();
    fetchRules();
  }, [activeClusterId]);

  async function fetchPods() {
    try {
      const query = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/pods${query}`);
      setPods(await res.json());
    } catch {}
  }

  async function fetchRules() {
    try {
      const query = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/protected-pods${query}`);
      setRules(await res.json());
    } catch {}
  }

  async function deleteRule(namespace: string, podPattern: string) {
    await fetch(`${AGENT_URL}/api/protected-pods`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, podPattern }),
    });
    await fetchRules();
    await fetchPods();
  }

  async function toggleProtection(pod: Pod) {
    if (pod.protected) {
      await fetch(`${AGENT_URL}/api/protected-pods`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: pod.namespace, podPattern: pod.name }),
      });
    } else {
      await fetch(`${AGENT_URL}/api/protected-pods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: pod.namespace, podPattern: pod.name, reason: 'Protected via UI' }),
      });
    }
    await fetchRules();
    await fetchPods();
  }

  async function addProtectionRule() {
    if (!protectNs || !protectPattern) return;
    await fetch(`${AGENT_URL}/api/protected-pods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: protectNs, podPattern: protectPattern, reason: protectReason || 'Production workload' }),
    });
    setShowProtectModal(false);
    setProtectNs('');
    setProtectPattern('');
    setProtectReason('');
    await fetchRules();
    await fetchPods();
  }

  async function containerAction(name: string, action: 'stop' | 'start' | 'restart') {
    if (!activeClusterId) return;
    setActionLoading(`${name}:${action}`);
    try {
      await fetch(`${AGENT_URL}/api/containers/${encodeURIComponent(name)}/${action}?cluster_id=${activeClusterId}`, { method: 'POST' });
      setTimeout(fetchPods, 1500);
    } catch {}
    setActionLoading(null);
  }

  async function podAction(namespace: string, name: string, action: 'restart') {
    if (!activeClusterId) return;
    setActionLoading(`${name}:${action}`);
    try {
      await fetch(`${AGENT_URL}/api/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${action}?cluster_id=${activeClusterId}`, { method: 'POST' });
      setTimeout(fetchPods, 2000);
    } catch {}
    setActionLoading(null);
  }

  async function bulkResolveDuplicates() {
    try {
      const query = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      await fetch(`${AGENT_URL}/api/incidents/bulk-resolve-duplicates${query}`, { method: 'POST' });
    } catch {}
  }

  const namespaces = ['all', ...Array.from(new Set(pods.map(p => p.namespace)))];
  // Unique deployment prefixes for pattern dropdown
  const podPrefixes = Array.from(new Set(
    pods
      .filter(p => !protectNs || protectNs === '*' || p.namespace === protectNs)
      .map(p => {
        const parts = p.name.split('-');
        // Typical K8s: name-replicaset-pod -> take first N-2 parts as prefix
        if (parts.length >= 3) return parts.slice(0, -2).join('-') + '-*';
        if (parts.length === 2) return parts[0] + '-*';
        return p.name;
      })
  )).sort();
  const filtered = nsFilter === 'all' ? pods : pods.filter(p => p.namespace === nsFilter);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800 col-span-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">
          All {entityLabel}
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-600">({filtered.length})</span>
        </h2>
        <div className="flex gap-2 items-center">
          <select
            value={nsFilter}
            onChange={e => setNsFilter(e.target.value)}
            className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 rounded px-2 py-1"
          >
            {namespaces.map(ns => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
          <button
            onClick={() => setShowRules(!showRules)}
            className={`px-2 py-1 text-xs border rounded ${showRules ? 'bg-amber-600/50 text-amber-300 border-amber-500/50' : 'bg-amber-600/20 text-amber-500 dark:text-amber-400 border-amber-600/30 hover:bg-amber-600/30'}`}
          >
            Protection Rules ({rules.filter(r => r.pod_pattern === '*').length} NS / {rules.length} total)
          </button>
          <button
            onClick={() => setShowProtectModal(true)}
            className="px-2 py-1 text-xs bg-amber-600/30 hover:bg-amber-600/50 text-amber-500 dark:text-amber-400 border border-amber-600/30 rounded"
          >
            + Rule
          </button>
        </div>
      </div>

      {/* Active protection rules */}
      {showRules && (
        <div className="bg-amber-50 dark:bg-gray-800 rounded p-3 mb-3 border border-amber-200 dark:border-amber-600/20">
          <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2">Active Protection Rules</h3>
          {rules.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-xs">No protection rules configured.</p>
          ) : (
            <div className="space-y-1">
              {rules.filter(r => r.pod_pattern === '*').map(r => (
                <div key={`${r.namespace}/${r.pod_pattern}`} className="flex items-center gap-2 text-sm bg-amber-100 dark:bg-amber-500/10 rounded px-2 py-1.5 border border-amber-200 dark:border-amber-500/20">
                  <span className="text-amber-600 dark:text-amber-400 text-xs font-bold">NS</span>
                  <span className="font-mono text-amber-700 dark:text-amber-300">{r.namespace}</span>
                  <span className="text-gray-400 dark:text-gray-500">/</span>
                  <span className="font-mono text-amber-600 dark:text-amber-200">{r.pod_pattern}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs ml-2">{r.reason}</span>
                  <button
                    onClick={() => deleteRule(r.namespace, r.pod_pattern)}
                    className="ml-auto text-xs text-red-400/60 hover:text-red-500 dark:hover:text-red-400 px-1"
                    title="Remove rule"
                  >
                    x
                  </button>
                </div>
              ))}
              {rules.filter(r => r.pod_pattern !== '*').length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                    + {rules.filter(r => r.pod_pattern !== '*').length} individual {entityLabelSingular.toLowerCase()} rules
                  </summary>
                  <div className="mt-1 space-y-1">
                    {rules.filter(r => r.pod_pattern !== '*').map(r => (
                      <div key={`${r.namespace}/${r.pod_pattern}`} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 px-2 py-1">
                        <span className="font-mono">{r.namespace}/{r.pod_pattern}</span>
                        <span className="text-gray-400 dark:text-gray-600">{r.reason}</span>
                        <button
                          onClick={() => deleteRule(r.namespace, r.pod_pattern)}
                          className="ml-auto text-red-400/60 hover:text-red-500 dark:hover:text-red-400 px-1"
                          title="Remove rule"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Protection rule modal -- with dropdowns */}
      {showProtectModal && (
        <div className="bg-amber-50 dark:bg-gray-800 rounded p-3 mb-3 border border-amber-200 dark:border-amber-600/30">
          <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-2">Add Protection Rule</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Protected {entityLabel.toLowerCase()} will only be remediated with manual approval.</p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {/* Namespace dropdown */}
            <select
              value={protectNs}
              onChange={e => setProtectNs(e.target.value)}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200"
            >
              <option value="">-- Namespace --</option>
              <option value="*">* (all namespaces)</option>
              {Array.from(new Set(pods.map(p => p.namespace))).sort().map(ns => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>

            {/* Pattern dropdown + free text */}
            <div className="relative">
              <input
                value={protectPattern}
                onChange={e => setProtectPattern(e.target.value)}
                list="pattern-suggestions"
                placeholder={`${entityLabelSingular} pattern`}
                className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200"
              />
              <datalist id="pattern-suggestions">
                <option value="*">All {entityLabel.toLowerCase()} in namespace</option>
                {podPrefixes.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </datalist>
            </div>

            {/* Reason */}
            <select
              value={protectReason}
              onChange={e => setProtectReason(e.target.value)}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200"
            >
              <option value="">-- Reason --</option>
              <option value="Production workload">Production workload</option>
              <option value="Live system — no auto-fix">Live system -- no auto-fix</option>
              <option value="Database — handle manually">Database -- handle manually</option>
              <option value="Stateful service">Stateful service</option>
              <option value="External dependency">External dependency</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={addProtectionRule} disabled={!protectNs || !protectPattern} className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50">Add</button>
            <button onClick={() => setShowProtectModal(false)} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Pod table */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 dark:text-gray-500 text-xs uppercase sticky top-0 bg-white dark:bg-gray-900">
            <tr>
              <th className="text-left py-1 px-2">Protected</th>
              <th className="text-left py-1 px-2">{entityLabelSingular}</th>
              <th className="text-left py-1 px-2">Namespace</th>
              <th className="text-left py-1 px-2">Phase</th>
              <th className="text-left py-1 px-2">Ready</th>
              <th className="text-left py-1 px-2">Restarts</th>
              <th className="text-left py-1 px-2">Node</th>
              <th className="text-left py-1 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(pod => (
              <tr key={`${pod.namespace}/${pod.name}`} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-1 px-2">
                  <button
                    onClick={() => toggleProtection(pod)}
                    title={pod.protected ? 'Click to unprotect' : 'Click to protect'}
                    className={`w-5 h-5 rounded flex items-center justify-center text-xs border ${
                      pod.protected
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 dark:text-amber-400'
                        : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 hover:border-amber-500/30'
                    }`}
                  >
                    {pod.protected ? '\u26A0' : ''}
                  </button>
                </td>
                <td className="py-1 px-2 font-mono text-xs truncate max-w-[200px]">{pod.name}</td>
                <td className="py-1 px-2 text-gray-500 dark:text-gray-400">{pod.namespace}</td>
                <td className={`py-1 px-2 ${phaseColors[pod.phase] || 'text-gray-400'}`}>{pod.phase}</td>
                <td className="py-1 px-2">
                  <span className={`w-2 h-2 rounded-full inline-block ${pod.ready ? 'bg-emerald-400' : 'bg-red-400'}`} />
                </td>
                <td className={`py-1 px-2 ${pod.restartCount > 5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {pod.restartCount}
                </td>
                <td className="py-1 px-2 text-gray-400 dark:text-gray-500 text-xs truncate max-w-[120px]">{pod.nodeName || '-'}</td>
                <td className="py-1 px-2">
                  <div className="flex gap-1">
                    {isDocker ? (
                      pod.phase === 'Running' ? (
                        <>
                          <button
                            onClick={() => containerAction(pod.name, 'stop')}
                            disabled={actionLoading === `${pod.name}:stop`}
                            className="px-1.5 py-0.5 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-500 dark:text-red-400 border border-red-500/20 rounded disabled:opacity-50"
                            title="Stop container"
                          >
                            {actionLoading === `${pod.name}:stop` ? '...' : 'Stop'}
                          </button>
                          <button
                            onClick={() => containerAction(pod.name, 'restart')}
                            disabled={actionLoading === `${pod.name}:restart`}
                            className="px-1.5 py-0.5 text-[10px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/20 rounded disabled:opacity-50"
                            title="Restart container"
                          >
                            {actionLoading === `${pod.name}:restart` ? '...' : 'Restart'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => containerAction(pod.name, 'start')}
                          disabled={actionLoading === `${pod.name}:start`}
                          className="px-1.5 py-0.5 text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 rounded disabled:opacity-50"
                          title="Start container"
                        >
                          {actionLoading === `${pod.name}:start` ? '...' : 'Start'}
                        </button>
                      )
                    ) : (
                      pod.phase === 'Running' && (
                        <button
                          onClick={() => podAction(pod.namespace, pod.name, 'restart')}
                          disabled={actionLoading === `${pod.name}:restart`}
                          className="px-1.5 py-0.5 text-[10px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 border border-blue-500/20 rounded disabled:opacity-50"
                          title="Restart pod (delete & recreate)"
                        >
                          {actionLoading === `${pod.name}:restart` ? '...' : 'Restart'}
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
