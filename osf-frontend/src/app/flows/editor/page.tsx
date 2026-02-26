'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://osf-api.zeroguess.ai';

interface Tab {
  id: string;
  label: string;
}

export default function FlowEditorPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [podStatus, setPodStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowDesc, setFlowDesc] = useState('');
  const [loadingTabs, setLoadingTabs] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Read ?tab= query param to open a specific flow tab in Node-RED
  const rawTab = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('tab')
    : null;
  // Validate: only allow hex, dots, dashes (Node-RED tab IDs)
  const tabParam = rawTab && /^[a-f0-9\-.]{1,50}$/i.test(rawTab) ? rawTab : null;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  // Set cookie for Node-RED editor auth, then ensure tab exists
  useEffect(() => {
    if (loading || !token) return;

    (async () => {
      try {
        // Step 1: authenticate with editor (set cookie)
        const authRes = await fetch(`${API_URL}/flows/auth/session`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!authRes.ok) throw new Error('Auth failed');

        // Step 2: check pod status (wait for NR pod to be ready)
        setPodStatus('Preparing editor environment...');
        let podReady = false;
        for (let i = 0; i < 30; i++) { // max 60s wait
          try {
            const statusRes = await fetch(`${API_URL}/flows/editor/pod-status`, {
              headers: { Authorization: `Bearer ${token}` },
              credentials: 'include',
            });
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              if (statusData.status === 'ready') {
                podReady = true;
                break;
              }
              setPodStatus(statusData.message || 'Starting editor...');
            }
          } catch {}
          await new Promise(r => setTimeout(r, 2000));
        }

        if (!podReady) {
          // Try anyway — the pod might be ready by the time iframe loads
        }
        setPodStatus(null);

        // Step 3: if ?tab= is set, ensure the tab exists (restore from snapshot if needed)
        if (tabParam) {
          await apiFetch('/flows/api/ensure-tab', {
            method: 'POST',
            body: JSON.stringify({ flowTabId: tabParam }),
          }).catch(() => {}); // best-effort, editor still opens
        }

        setError(null);
        setReady(true);
      } catch {
        setError('Failed to authenticate with the flow editor');
      }
    })();
  }, [loading, token, tabParam]);

  const openSaveModal = async () => {
    setLoadingTabs(true);
    setShowSaveModal(true);
    try {
      const data = await apiFetch<{ tabs: Tab[] }>('/flows/api/tabs');
      setTabs(data.tabs);
      if (data.tabs.length === 1) {
        setSelectedTab(data.tabs[0].id);
        setFlowName(data.tabs[0].label);
      } else if (data.tabs.length > 0) {
        setSelectedTab(data.tabs[0].id);
      }
    } catch {
      setTabs([]);
    } finally {
      setLoadingTabs(false);
    }
  };

  const handleSave = async () => {
    if (!flowName.trim() || !selectedTab) return;

    setSaving(true);
    setSaveMsg(null);
    setShowSaveModal(false);

    try {
      await apiFetch('/flows/api/save', {
        method: 'POST',
        body: JSON.stringify({
          name: flowName.trim(),
          description: flowDesc.trim() || null,
          flowTabId: selectedTab,
        }),
      });
      setSaveMsg('Flow saved!');
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (err: any) {
      setSaveMsg(err.message || 'Save failed');
      setTimeout(() => setSaveMsg(null), 5000);
    } finally {
      setSaving(false);
      setFlowName('');
      setFlowDesc('');
      setSelectedTab('');
    }
  };

  if (loading || !user) return null;

  return (
    <div className="fixed inset-0 bg-bg flex flex-col">
      {/* Top bar */}
      <div className="h-12 bg-bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/flows')}
            className="text-text-muted hover:text-text text-sm flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-text font-semibold text-sm">OSF Flow Editor</span>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`text-xs ${saveMsg === 'Flow saved!' ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveMsg}
            </span>
          )}
          <button
            onClick={openSaveModal}
            disabled={saving || !ready}
            className="bg-accent text-bg px-4 py-1.5 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save as Flow'}
          </button>
        </div>
      </div>

      {/* Editor iframe */}
      {error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-red-400">{error}</p>
        </div>
      ) : !ready ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">{podStatus || 'Loading editor...'}</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={`${API_URL}/flows/editor/${tabParam ? `#flow/${tabParam}` : ''}`}
          className="flex-1 w-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border rounded-md w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-text mb-1">Save Flow</h2>
            <p className="text-sm text-text-dim mb-5">
              Save your flow to run it from the Flows page.
            </p>

            {loadingTabs ? (
              <p className="text-text-muted text-sm py-4">Loading tabs...</p>
            ) : tabs.length === 0 ? (
              <p className="text-red-400 text-sm py-4">
                No tabs found. Please click &quot;Deploy&quot; in the editor first.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Tab selection */}
                {tabs.length > 1 && (
                  <div>
                    <label className="block text-sm text-text-muted mb-1.5">Flow Tab</label>
                    <select
                      value={selectedTab}
                      onChange={e => {
                        setSelectedTab(e.target.value);
                        const tab = tabs.find(t => t.id === e.target.value);
                        if (tab && !flowName) setFlowName(tab.label);
                      }}
                      className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/50"
                    >
                      {tabs.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="block text-sm text-text-muted mb-1.5">Name</label>
                  <input
                    type="text"
                    value={flowName}
                    onChange={e => setFlowName(e.target.value)}
                    placeholder="e.g. Production Check"
                    className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent/50"
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm text-text-muted mb-1.5">Description (optional)</label>
                  <input
                    type="text"
                    value={flowDesc}
                    onChange={e => setFlowDesc(e.target.value)}
                    placeholder="What does this flow do?"
                    className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent/50"
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!flowName.trim() || !selectedTab || loadingTabs}
                className="bg-accent text-bg px-5 py-2 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
