'use client';

import { useEffect, useState } from 'react';
import { useCluster } from '../context/ClusterContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

const ISSUE_TYPES = ['*', 'CrashLoopBackOff', 'OOMKilled', 'EvictedPod', 'FailedJob', 'ImagePullBackOff', 'NodeNotReady', 'PendingPod', 'HighRestarts', 'PVCPending', 'FailedRollout'];
const STEP_TYPES = ['check_condition', 'delete_pod', 'rollback_deployment', 'wait', 'notify', 'restart_container'];
const ON_FAILURE_OPTIONS = ['abort', 'continue', 'skip'];

interface RunbookStep {
  type: string;
  params: Record<string, any>;
  on_failure?: string;
}

interface Runbook {
  id: string;
  name: string;
  cluster_id?: string;
  match_type?: string;
  match_namespace?: string;
  match_resource?: string;
  steps: RunbookStep[];
  enabled: boolean;
  is_template: boolean;
}

interface DryRunResult {
  step: number;
  type: string;
  would_do: string;
  params: Record<string, any>;
  on_failure: string;
}

const emptyStep: RunbookStep = { type: 'delete_pod', params: {}, on_failure: 'abort' };

export default function RunbookEditor() {
  const { activeClusterId } = useCluster();
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [editing, setEditing] = useState<Partial<Runbook> | null>(null);
  const [dryRunResults, setDryRunResults] = useState<DryRunResult[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRunbooks();
  }, [activeClusterId]);

  async function fetchRunbooks() {
    try {
      const params = activeClusterId ? `?cluster_id=${activeClusterId}` : '';
      const res = await fetch(`${AGENT_URL}/api/runbooks${params}`);
      setRunbooks(await res.json());
    } catch {}
  }

  function startCreate() {
    setEditing({
      name: '',
      match_type: '*',
      match_namespace: '*',
      match_resource: '*',
      steps: [{ ...emptyStep }],
      enabled: true,
      is_template: false,
      cluster_id: activeClusterId || undefined,
    });
    setDryRunResults(null);
  }

  function startEdit(rb: Runbook) {
    if (rb.is_template) {
      // Clone template
      setEditing({
        name: `${rb.name} (copy)`,
        match_type: rb.match_type,
        match_namespace: rb.match_namespace,
        match_resource: rb.match_resource,
        steps: JSON.parse(JSON.stringify(rb.steps)),
        enabled: true,
        is_template: false,
        cluster_id: activeClusterId || undefined,
      });
    } else {
      setEditing({ ...rb, steps: JSON.parse(JSON.stringify(rb.steps)) });
    }
    setDryRunResults(null);
  }

  async function handleSave() {
    if (!editing?.name || !editing?.steps?.length) return;
    setSaving(true);
    try {
      if (editing.id) {
        await fetch(`${AGENT_URL}/api/runbooks/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        });
      } else {
        await fetch(`${AGENT_URL}/api/runbooks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editing),
        });
      }
      setEditing(null);
      await fetchRunbooks();
    } catch {}
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`${AGENT_URL}/api/runbooks/${id}`, { method: 'DELETE' });
      await fetchRunbooks();
    } catch {}
  }

  async function handleToggle(rb: Runbook) {
    try {
      await fetch(`${AGENT_URL}/api/runbooks/${rb.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rb.enabled }),
      });
      await fetchRunbooks();
    } catch {}
  }

  async function handleTest(id: string) {
    try {
      const res = await fetch(`${AGENT_URL}/api/runbooks/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setDryRunResults(data.steps);
    } catch {}
  }

  function updateStep(idx: number, field: string, value: any) {
    if (!editing) return;
    const steps = [...editing.steps!];
    if (field === 'type') {
      steps[idx] = { type: value, params: {}, on_failure: steps[idx].on_failure };
    } else if (field === 'on_failure') {
      steps[idx] = { ...steps[idx], on_failure: value };
    } else {
      steps[idx] = { ...steps[idx], params: { ...steps[idx].params, [field]: value } };
    }
    setEditing({ ...editing, steps });
  }

  function addStep() {
    if (!editing) return;
    setEditing({ ...editing, steps: [...(editing.steps || []), { ...emptyStep }] });
  }

  function removeStep(idx: number) {
    if (!editing) return;
    const steps = editing.steps!.filter((_, i) => i !== idx);
    setEditing({ ...editing, steps });
  }

  function renderStepParams(step: RunbookStep, idx: number) {
    switch (step.type) {
      case 'check_condition':
        return (
          <input
            value={step.params.check || ''}
            onChange={e => updateStep(idx, 'check', e.target.value)}
            placeholder="e.g. restartCount > 5 or pod_ready"
            className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded"
          />
        );
      case 'wait':
        return (
          <input
            type="number"
            value={step.params.seconds || ''}
            onChange={e => updateStep(idx, 'seconds', parseInt(e.target.value) || 0)}
            placeholder="seconds (max 120)"
            className="w-32 px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded"
          />
        );
      case 'notify':
        return (
          <input
            value={step.params.message || ''}
            onChange={e => updateStep(idx, 'message', e.target.value)}
            placeholder="Notification message ($namespace, $resource, $cluster)"
            className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded"
          />
        );
      default:
        return <span className="text-xs text-gray-400 dark:text-gray-500">No parameters needed</span>;
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800 col-span-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">
          Runbooks
          {runbooks.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs rounded">
              {runbooks.length}
            </span>
          )}
        </h2>
        <button
          onClick={startCreate}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded"
        >
          + New Runbook
        </button>
      </div>

      {/* Runbook list */}
      {!editing && (
        <div className="space-y-2">
          {runbooks.length === 0 && (
            <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-4">No runbooks configured</p>
          )}
          {runbooks.map(rb => (
            <div key={rb.id} className="bg-gray-50 dark:bg-gray-800 rounded p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{rb.name}</span>
                {rb.is_template && (
                  <span className="px-1.5 py-0.5 text-xs rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30">
                    template
                  </span>
                )}
                <span className={`px-1.5 py-0.5 text-xs rounded border ${rb.enabled ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-gray-500/20 text-gray-500 border-gray-500/30'}`}>
                  {rb.enabled ? 'enabled' : 'disabled'}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {rb.match_type || '*'} / {rb.match_namespace || '*'} / {rb.match_resource || '*'}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                  {rb.steps.length} step{rb.steps.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => startEdit(rb)}
                  className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                >
                  {rb.is_template ? 'Clone' : 'Edit'}
                </button>
                <button
                  onClick={() => handleTest(rb.id)}
                  className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 rounded"
                >
                  Test
                </button>
                {!rb.is_template && (
                  <>
                    <button
                      onClick={() => handleToggle(rb)}
                      className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                    >
                      {rb.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(rb.id)}
                      className="px-2 py-1 text-xs bg-red-600/50 hover:bg-red-500 text-white rounded"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Dry run results */}
          {dryRunResults && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-3 border border-yellow-500/30">
              <h3 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-2">Dry Run Results</h3>
              <div className="space-y-1">
                {dryRunResults.map(r => (
                  <div key={r.step} className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-6">#{r.step}</span>
                    <span className="px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700">{r.type}</span>
                    <span className="text-gray-700 dark:text-gray-300">{r.would_do}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">on fail: {r.on_failure}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDryRunResults(null)}
                className="mt-2 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Edit / Create form */}
      {editing && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
              <input
                value={editing.name || ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
                placeholder="Runbook name"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Match Type</label>
              <select
                value={editing.match_type || '*'}
                onChange={e => setEditing({ ...editing, match_type: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
              >
                {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Namespace</label>
                <input
                  value={editing.match_namespace || '*'}
                  onChange={e => setEditing({ ...editing, match_namespace: e.target.value })}
                  className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
                  placeholder="* for any"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Resource</label>
                <input
                  value={editing.match_resource || '*'}
                  onChange={e => setEditing({ ...editing, match_resource: e.target.value })}
                  className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
                  placeholder="* or prefix*"
                />
              </div>
            </div>
          </div>

          {/* Steps builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase">Steps</label>
              <button
                onClick={addStep}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
              >
                + Add Step
              </button>
            </div>
            <div className="space-y-2">
              {(editing.steps || []).map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded p-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-6">#{idx + 1}</span>
                  <select
                    value={step.type}
                    onChange={e => updateStep(idx, 'type', e.target.value)}
                    className="px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded"
                  >
                    {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {renderStepParams(step, idx)}
                  <select
                    value={step.on_failure || 'abort'}
                    onChange={e => updateStep(idx, 'on_failure', e.target.value)}
                    className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded w-20"
                    title="On failure"
                  >
                    {ON_FAILURE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button
                    onClick={() => removeStep(idx)}
                    className="px-2 py-1 text-xs bg-red-600/50 hover:bg-red-500 text-white rounded"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !editing.name}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
            >
              {saving ? 'Saving...' : editing.id ? 'Update' : 'Create'}
            </button>
            <button
              onClick={() => { setEditing(null); setDryRunResults(null); }}
              className="px-4 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
