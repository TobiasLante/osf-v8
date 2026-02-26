'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface GitHubStatus {
  connected: boolean;
  username?: string;
  githubId?: number;
  scopes?: string;
  connectedAt?: string;
}

function Msg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm mt-3 ${msg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>;
}

export function GitHubTab() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const searchParams = useSearchParams();

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<GitHubStatus>('/code-agents/github/status');
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const gh = searchParams.get('github');
    if (gh === 'connected') {
      const username = searchParams.get('username');
      setMsg({ type: 'success', text: `Connected to GitHub${username ? ` as ${username}` : ''}!` });
    } else if (gh === 'error') {
      const reason = searchParams.get('reason') || 'unknown';
      setMsg({ type: 'error', text: `GitHub connection failed: ${reason}` });
    }
  }, [searchParams]);

  const handleConnect = async () => {
    try {
      const data = await apiFetch<{ url: string }>('/code-agents/github/connect');
      window.location.href = data.url;
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch('/code-agents/github/disconnect', { method: 'DELETE' });
      setStatus({ connected: false });
      setMsg({ type: 'success', text: 'GitHub disconnected' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setDisconnecting(false);
    }
  };

  if (loadingStatus) return <div className="text-text-muted text-center py-20">Loading...</div>;

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-md p-6">
        <h2 className="text-text font-semibold mb-2">GitHub Connection</h2>
        <p className="text-text-dim text-sm mb-6">
          Connect your GitHub account to deploy Code Agents from your repositories.
        </p>

        {status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 bg-bg-surface border border-border rounded-md p-4">
              <div className="w-10 h-10 rounded-full bg-[#24292e] flex items-center justify-center">
                <svg viewBox="0 0 16 16" className="w-5 h-5 fill-white">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-text font-medium">{status.username}</p>
                <p className="text-text-dim text-xs">
                  Connected {status.connectedAt ? new Date(status.connectedAt).toLocaleDateString('de-DE') : ''}
                </p>
              </div>
              <span className="text-emerald-400 text-xs font-medium bg-emerald-400/10 px-2 py-1 rounded">Connected</span>
            </div>

            <button onClick={handleDisconnect} disabled={disconnecting}
              className="text-red-400 text-sm hover:text-red-300 transition-colors disabled:opacity-50">
              {disconnecting ? 'Disconnecting...' : 'Disconnect GitHub'}
            </button>
          </div>
        ) : (
          <button onClick={handleConnect}
            className="flex items-center gap-3 bg-[#24292e] hover:bg-[#2f363d] text-white px-5 py-3 rounded-md text-sm font-medium transition-colors">
            <svg viewBox="0 0 16 16" className="w-5 h-5 fill-current">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Connect GitHub
          </button>
        )}

        <Msg msg={msg} />
      </section>

      <section className="border border-border rounded-md p-6">
        <h2 className="text-text font-semibold mb-2">How it works</h2>
        <ol className="text-text-dim text-sm space-y-2 list-decimal list-inside">
          <li>Connect your GitHub account above</li>
          <li>Create a repo with <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-agent.yaml</code> and <code className="text-accent bg-accent/10 px-1 rounded text-xs">src/main.ts</code></li>
          <li>Deploy the agent from the <a href="/agents" className="text-accent hover:underline">Agents page</a></li>
          <li>Push changes to GitHub &mdash; auto-syncs via webhook</li>
        </ol>
      </section>
    </div>
  );
}
