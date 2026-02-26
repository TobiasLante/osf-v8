'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch, streamSSE } from '@/lib/api';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';
import { StreamOutput, type StreamEvent } from '@/components/StreamOutput';
import { DeployButton } from '@/components/agents/DeployButton';

interface CodeAgent {
  id: string;
  userId: string;
  repoFullName: string;
  repoUrl: string;
  name: string;
  description: string;
  icon: string;
  entry: string;
  timeoutSeconds: number;
  manifest: any;
  deployStatus: string;
  deployError: string | null;
  isPublic: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function CodeAgentDetailClient({ id: paramId }: { id: string }) {
  const { user, loading, token } = useAuth();
  const router = useRouter();

  // In static export the param is always "placeholder", so read the real ID from the URL
  const id = typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() || paramId
    : paramId;
  const [agent, setAgent] = useState<CodeAgent | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isOwner = agent && user && agent.userId === user.id;

  const fetchAgent = useCallback(async () => {
    try {
      const { agent } = await apiFetch<{ agent: CodeAgent }>(`/code-agents/${id}`);
      setAgent(agent);
    } catch {
      setAgent(null);
    } finally {
      setLoadingAgent(false);
    }
  }, [id]);

  useEffect(() => {
    if (!loading && id !== 'placeholder') fetchAgent();
  }, [loading, id, fetchAgent]);

  const handleSync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      await apiFetch(`/code-agents/${id}/sync`, { method: 'POST' });
      setMsg({ type: 'success', text: 'Sync started. Refresh in a few seconds.' });
      setTimeout(fetchAgent, 3000);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this code agent?')) return;
    setDeleting(true);
    try {
      await apiFetch(`/code-agents/${id}`, { method: 'DELETE' });
      router.push('/agents');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
      setDeleting(false);
    }
  };

  const handleRun = async () => {
    if (!token) return;
    setRunning(true);
    setEvents([]);
    setMsg(null);

    try {
      for await (const event of streamSSE(`/code-agents/${id}/run`, {})) {
        setEvents(prev => [...prev, event as StreamEvent]);
        if (event.type === 'done' || event.type === 'error') {
          setRunning(false);
        }
      }
    } catch (err: any) {
      setEvents(prev => [...prev, { type: 'error', message: err.message }]);
      setRunning(false);
    }
  };

  if (loading || loadingAgent) {
    return (
      <>
        <BackgroundOrbs />
        <section className="pt-32 pb-20 px-6">
          <div className="mx-auto max-w-3xl text-center text-text-dim py-20">Loading...</div>
        </section>
      </>
    );
  }

  if (!agent) {
    return (
      <>
        <BackgroundOrbs />
        <section className="pt-32 pb-20 px-6">
          <div className="mx-auto max-w-3xl text-center py-20">
            <p className="text-text-muted mb-4">Code agent not found.</p>
            <Link href="/agents" className="text-accent hover:underline">Back to Agents</Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/agents" className="text-text-muted hover:text-accent text-sm mb-6 inline-block">&larr; Back to Agents</Link>

          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-[14px] bg-bg-surface-2 grid place-items-center text-3xl shrink-0">
              {agent.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">{agent.name}</h1>
              <a
                href={agent.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text-dim hover:text-accent font-mono"
              >
                {agent.repoFullName}
              </a>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded border shrink-0 ${
              agent.deployStatus === 'deployed'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : agent.deployStatus === 'error'
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : agent.deployStatus === 'syncing'
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              {agent.deployStatus}
            </span>
          </div>

          {/* Description */}
          {agent.description && (
            <p className="text-text-muted mb-6">{agent.description}</p>
          )}

          {/* Deploy error */}
          {agent.deployError && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-md p-4 mb-6">
              <p className="text-red-400 text-sm font-medium mb-1">Deploy Error</p>
              <p className="text-red-300 text-sm font-mono">{agent.deployError}</p>
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap gap-4 text-xs text-text-dim mb-6">
            <span>Entry: <code className="text-accent">{agent.entry}</code></span>
            <span>Timeout: {agent.timeoutSeconds}s</span>
            {agent.lastSyncedAt && (
              <span>Last synced: {new Date(agent.lastSyncedAt).toLocaleString('de-DE')}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-8 items-center">
            {agent.deployStatus === 'deployed' && user && (
              <button
                onClick={handleRun}
                disabled={running}
                className="bg-accent text-bg px-6 py-2.5 rounded-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {running ? 'Running...' : 'Run Agent'}
              </button>
            )}
            {user && <DeployButton sourceType="code_agent" sourceId={id} allowFork={false} />}
            {isOwner && (
              <>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="border border-border text-text px-4 py-2.5 rounded-sm text-sm font-medium hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                >
                  {syncing ? 'Syncing...' : 'Re-sync'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="border border-red-500/30 text-red-400 px-4 py-2.5 rounded-sm text-sm font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </>
            )}
          </div>

          {msg && (
            <p className={`text-sm mb-4 ${msg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
          )}

          {/* Stream Output */}
          {events.length > 0 && (
            <StreamOutput events={events} running={running} maxHeight="500px" />
          )}
        </div>
      </section>
    </>
  );
}
