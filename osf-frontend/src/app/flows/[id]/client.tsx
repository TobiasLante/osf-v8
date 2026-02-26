'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Header } from '@/components/Header';
import FlowRunner from '@/components/FlowRunner';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';

interface Flow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  flow_tab_id: string;
  updated_at: string;
  is_public?: boolean;
  category?: string;
  difficulty?: string;
}

interface FlowRun {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  result: any;
}

export function FlowDetailClient({ id: paramId }: { id: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // In static export the param is always "placeholder", so read the real ID from the URL
  const flowId = typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() || paramId
    : paramId;

  const [flow, setFlow] = useState<Flow | null>(null);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [loadingFlow, setLoadingFlow] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [pubName, setPubName] = useState('');
  const [pubDesc, setPubDesc] = useState('');
  const [pubCategory, setPubCategory] = useState('General');
  const [pubDifficulty, setPubDifficulty] = useState('Beginner');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !flowId) return;

    Promise.all([
      apiFetch<{ flows: Flow[] }>('/flows/api/mine').then(d => {
        const found = d.flows.find(f => f.id === flowId);
        setFlow(found || null);
      }),
      apiFetch<{ runs: (FlowRun & { flow_id?: string })[] }>('/flows/api/runs').then(d => {
        setRuns(d.runs.filter(r => r.flow_id === flowId).slice(0, 10));
      }).catch(() => {}),
    ]).finally(() => setLoadingFlow(false));
  }, [user, flowId]);

  const handleDelete = async () => {
    if (!confirm('Delete this flow?')) return;
    setDeleting(true);
    try {
      await apiFetch(`/flows/api/${flowId}`, { method: 'DELETE' });
      router.push('/flows');
    } catch {
      setDeleting(false);
    }
  };

  const openPublishModal = () => {
    if (flow) {
      setPubName(flow.name);
      setPubDesc(flow.description || '');
      setPubCategory(flow.category || 'General');
      setPubDifficulty(flow.difficulty || 'Beginner');
    }
    setShowPublishModal(true);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await apiFetch(`/flows/api/${flowId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ name: pubName, description: pubDesc, category: pubCategory, difficulty: pubDifficulty }),
      });
      setFlow(prev => prev ? { ...prev, is_public: true } : prev);
      setShowPublishModal(false);
    } catch (err: any) {
      alert(err.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setPublishing(true);
    try {
      await apiFetch(`/flows/api/${flowId}/unpublish`, { method: 'POST' });
      setFlow(prev => prev ? { ...prev, is_public: false } : prev);
    } catch (err: any) {
      alert(err.message || 'Unpublish failed');
    } finally {
      setPublishing(false);
    }
  };

  if (loading || !user) return null;

  return (
    <>
      <Header />
      <BackgroundOrbs />
      <main className="relative z-10 max-w-4xl mx-auto pt-32 pb-20 px-6">
        <button
          onClick={() => router.push('/flows')}
          className="text-text-muted hover:text-text text-sm mb-6 inline-flex items-center gap-1 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Flows
        </button>

        {loadingFlow ? (
          <div className="text-text-muted text-center py-20">Loading...</div>
        ) : !flow ? (
          <div className="text-center py-20">
            <p className="text-text-muted">Flow not found</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-start gap-4">
                <span className="text-4xl">{flow.icon || '🔀'}</span>
                <div>
                  <h1 className="text-2xl font-bold text-text">{flow.name}</h1>
                  {flow.description && (
                    <p className="text-text-muted mt-1">{flow.description}</p>
                  )}
                  <p className="text-text-dim text-xs mt-2">
                    Updated {new Date(flow.updated_at).toLocaleDateString('de-DE')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {flow.is_public ? (
                  <>
                    <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-orange-500/10 text-orange-400 border-orange-500/20">
                      Published
                    </span>
                    <button
                      onClick={handleUnpublish}
                      disabled={publishing}
                      className="border border-border text-text-dim px-3 py-2 rounded-sm text-xs hover:text-text transition-colors disabled:opacity-50"
                    >
                      Unpublish
                    </button>
                  </>
                ) : (
                  <button
                    onClick={openPublishModal}
                    disabled={publishing}
                    className="border border-accent text-accent px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    Publish to Marketplace
                  </button>
                )}
                <a
                  href={`/flows/editor?tab=${flow.flow_tab_id}`}
                  className="border border-border text-text-muted px-4 py-2 rounded-sm text-sm hover:border-border-hover hover:text-text transition-colors"
                >
                  Edit
                </a>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="border border-red-500/30 text-red-400 px-4 py-2 rounded-sm text-sm hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="border border-border rounded-md p-6 mb-8">
              <h2 className="text-text font-semibold mb-4">Execute</h2>
              <FlowRunner flowId={flowId} />
            </div>

            {runs.length > 0 && (
              <div>
                <h2 className="text-text font-semibold mb-4">Run History</h2>
                <div className="space-y-2">
                  {runs.map(run => (
                    <div key={run.id} className="border border-border rounded-md p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${
                          run.status === 'completed' ? 'bg-emerald-400' :
                          run.status === 'failed' ? 'bg-red-400' :
                          run.status === 'paused' ? 'bg-blue-400' :
                          'bg-amber-400 animate-pulse'
                        }`} />
                        <span className="text-text text-sm capitalize">{run.status}</span>
                      </div>
                      <span className="text-text-dim text-xs">
                        {new Date(run.started_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Publish Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowPublishModal(false)}>
          <div className="bg-bg-surface border border-border rounded-lg p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-text mb-4">Publish to Marketplace</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={pubName}
                  onChange={e => setPubName(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm bg-bg border border-border text-text text-sm focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">Description</label>
                <textarea
                  value={pubDesc}
                  onChange={e => setPubDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-sm bg-bg border border-border text-text text-sm focus:border-accent focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-muted mb-1">Category</label>
                  <select
                    value={pubCategory}
                    onChange={e => setPubCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-sm bg-bg border border-border text-text text-sm focus:border-accent focus:outline-none"
                  >
                    {['General', 'Production', 'Supply Chain', 'Quality', 'Planning', 'Delivery', 'Sustainability'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Difficulty</label>
                  <select
                    value={pubDifficulty}
                    onChange={e => setPubDifficulty(e.target.value)}
                    className="w-full px-3 py-2 rounded-sm bg-bg border border-border text-text text-sm focus:border-accent focus:outline-none"
                  >
                    {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-2 rounded-sm text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing || !pubName.trim()}
                className="px-5 py-2 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
