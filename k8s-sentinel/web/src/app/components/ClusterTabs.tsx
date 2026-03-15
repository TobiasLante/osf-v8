'use client';

import { useState } from 'react';
import { useCluster, Cluster } from '../context/ClusterContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

export default function ClusterTabs() {
  const { clusters, activeClusterId, setActiveClusterId, refreshClusters } = useCluster();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'k8s' | 'docker'>('k8s');
  const [kubeconfigPath, setKubeconfigPath] = useState('');
  const [kubeContext, setKubeContext] = useState('');
  const [socketPath, setSocketPath] = useState('/var/run/docker.sock');
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const config = newType === 'k8s'
        ? { kubeconfigPath, context: kubeContext }
        : { socketPath };

      await fetch(`${AGENT_URL}/api/clusters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type: newType, config }),
      });
      refreshClusters();
      setShowAddModal(false);
      setNewName('');
      setNewType('k8s');
      setKubeconfigPath('');
      setKubeContext('');
      setSocketPath('/var/run/docker.sock');
    } catch {}
    setAdding(false);
  }

  return (
    <>
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-6 flex items-center gap-1 overflow-x-auto">
        {clusters.map(cluster => (
          <button
            key={cluster.id}
            onClick={() => setActiveClusterId(cluster.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeClusterId === cluster.id
                ? 'border-emerald-500 text-gray-900 dark:text-white'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <span
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                cluster.type === 'k8s'
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                  : 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
              }`}
            >
              {cluster.type === 'k8s' ? 'K8s' : 'Docker'}
            </span>
            <span>{cluster.name}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                cluster.enabled ? 'bg-emerald-400' : 'bg-gray-400'
              }`}
            />
          </button>
        ))}

        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          title="Add cluster"
        >
          +
        </button>
      </div>

      {/* Add Cluster Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-md border border-gray-200 dark:border-gray-800 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add Cluster</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="my-cluster"
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as 'k8s' | 'docker')}
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200"
                >
                  <option value="k8s">Kubernetes</option>
                  <option value="docker">Docker</option>
                </select>
              </div>

              {newType === 'k8s' ? (
                <>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Kubeconfig Path</label>
                    <input
                      value={kubeconfigPath}
                      onChange={e => setKubeconfigPath(e.target.value)}
                      placeholder="~/.kube/config"
                      className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Context</label>
                    <input
                      value={kubeContext}
                      onChange={e => setKubeContext(e.target.value)}
                      placeholder="default"
                      className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Socket Path</label>
                  <input
                    value={socketPath}
                    onChange={e => setSocketPath(e.target.value)}
                    placeholder="/var/run/docker.sock"
                    className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || adding}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add Cluster'}
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 text-sm rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
