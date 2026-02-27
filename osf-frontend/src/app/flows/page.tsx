'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Header } from '@/components/Header';
import FlowCard from '@/components/FlowCard';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';

interface Flow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  flow_tab_id: string;
  last_run_status: string | null;
  last_run_at: string | null;
  updated_at: string;
}

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  nodeCount: number;
}

export default function FlowsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installModal, setInstallModal] = useState<FlowTemplate | null>(null);
  const [installName, setInstallName] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ flows: Flow[] }>('/flows/api/mine')
      .then(data => setFlows(data.flows))
      .catch(() => {})
      .finally(() => setLoadingFlows(false));

    apiFetch<{ templates: FlowTemplate[] }>('/flows/api/templates')
      .then(data => setTemplates(data.templates))
      .catch(() => {});
  }, [user]);

  const openInstallModal = (template: FlowTemplate) => {
    setInstallName(template.name);
    setInstallModal(template);
  };

  const installTemplate = async () => {
    if (!installModal) return;
    setInstalling(installModal.id);
    setInstallModal(null);
    try {
      const result = await apiFetch<{ id: string; name: string }>(
        `/flows/api/templates/${installModal.id}/install`,
        { method: 'POST', body: JSON.stringify({ name: installName.trim() || installModal.name }) }
      );
      const data = await apiFetch<{ flows: Flow[] }>('/flows/api/mine');
      setFlows(data.flows);
      router.push(`/flows/${result.id}`);
    } catch (err: any) {
      alert(err.message || 'Failed to install template');
    } finally {
      setInstalling(null);
    }
  };

  if (loading || !user) return null;

  return (
    <>
      <Header />
      <BackgroundOrbs />
      <main className="relative z-10 max-w-5xl mx-auto pt-32 pb-20 px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-text">Flows <span className="text-xs font-mono text-text-dim align-super">v{process.env.NEXT_PUBLIC_FLOWS_VERSION}</span></h1>
            <p className="text-text-muted mt-1">Design and run visual multi-agent workflows with Node-RED</p>
          </div>
          <Link
            href="/flows/editor"
            className="bg-accent text-bg px-5 py-2.5 rounded-sm font-medium hover:bg-accent-hover transition-colors"
          >
            New Flow
          </Link>
        </div>

        {/* Templates section */}
        {templates.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-semibold text-text-muted mb-4">Flow Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {templates.map(t => (
                <div
                  key={t.id}
                  className="p-6 rounded-lg border border-accent/20 bg-bg-surface hover:border-accent/40 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-[14px] bg-accent/10 grid place-items-center text-2xl">
                      {t.icon}
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/20">
                      {t.nodeCount} nodes
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-1 tracking-tight">{t.name}</h3>
                  <p className="text-sm text-text-muted leading-relaxed mb-4">{t.description}</p>
                  <button
                    onClick={() => openInstallModal(t)}
                    disabled={installing === t.id}
                    className="w-full py-2 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {installing === t.id ? 'Installing...' : 'Install Template'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User's flows */}
        <h2 className="text-lg font-semibold text-text-muted mb-4">My Flows</h2>

        {loadingFlows ? (
          <div className="text-text-muted text-center py-20">Loading flows...</div>
        ) : flows.length === 0 ? (
          <div className="border border-border rounded-md p-12 text-center">
            <span className="text-4xl mb-4 block">&#128256;</span>
            <h2 className="text-text font-semibold text-lg mb-2">No flows yet</h2>
            <p className="text-text-muted mb-6">
              Create your first visual workflow by connecting agents, prompts, and tools in the Node-RED editor.
              {templates.length > 0 && ' Or install a template above to get started quickly.'}
            </p>
            <Link
              href="/flows/editor"
              className="inline-block bg-accent text-bg px-6 py-2.5 rounded-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Open Flow Editor
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {flows.map((flow) => (
              <FlowCard
                key={flow.id}
                id={flow.id}
                name={flow.name}
                description={flow.description || undefined}
                icon={flow.icon}
                lastRunStatus={flow.last_run_status}
                lastRunAt={flow.last_run_at}
                updatedAt={flow.updated_at}
              />
            ))}
          </div>
        )}
      </main>

      {/* Install Template Modal */}
      {installModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setInstallModal(null)}>
          <div className="bg-bg-surface border border-border rounded-lg p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[10px] bg-accent/10 grid place-items-center text-xl">{installModal.icon}</div>
              <h3 className="text-lg font-bold text-text">Install Template</h3>
            </div>
            <label className="block text-sm text-text-muted mb-1.5">Flow Name</label>
            <input
              type="text"
              value={installName}
              onChange={e => setInstallName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && installTemplate()}
              autoFocus
              className="w-full px-3 py-2 rounded-sm bg-bg border border-border text-text focus:border-accent focus:outline-none text-sm"
            />
            <p className="text-xs text-text-muted mt-2 mb-5">{installModal.description}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setInstallModal(null)}
                className="px-4 py-2 rounded-sm text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={installTemplate}
                className="px-5 py-2 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Install
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
