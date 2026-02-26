'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';

interface Repo {
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  url: string;
  defaultBranch: string;
  updatedAt: string;
  language: string | null;
}

interface GitHubStatus {
  connected: boolean;
  username?: string;
}

export default function NewCodeAgentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [search, setSearch] = useState('');
  const [deploying, setDeploying] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<GitHubStatus>('/code-agents/github/status')
      .then(setGhStatus)
      .catch(() => setGhStatus({ connected: false }));
  }, [user]);

  useEffect(() => {
    if (!ghStatus?.connected) return;
    setLoadingRepos(true);
    apiFetch<{ repos: Repo[] }>('/code-agents/github/repos')
      .then(({ repos }) => setRepos(repos))
      .catch((err) => setError(err?.message || 'Failed to load repositories. Your GitHub connection may have expired.'))
      .finally(() => setLoadingRepos(false));
  }, [ghStatus]);

  const handleDeploy = async (repo: Repo) => {
    setDeploying(repo.fullName);
    setError('');
    try {
      const result = await apiFetch<{ agentId: string }>('/code-agents', {
        method: 'POST',
        body: JSON.stringify({ repoFullName: repo.fullName, repoUrl: repo.url }),
      });
      router.push(`/agents/code/${result.agentId}`);
    } catch (err: any) {
      setError(err.message);
      setDeploying(null);
    }
  };

  if (loading || !user) return null;

  const filtered = repos.filter(r =>
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/agents" className="text-text-muted hover:text-accent text-sm mb-6 inline-block">&larr; Back to Agents</Link>

          <h1 className="text-3xl font-bold mb-2">Deploy Code Agent</h1>
          <p className="text-text-muted mb-8">
            Select a GitHub repository with an <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-agent.yaml</code> manifest.
          </p>

          {/* Not connected */}
          {ghStatus && !ghStatus.connected && (
            <div className="border border-border rounded-md p-8 text-center">
              <p className="text-text-muted mb-4">Connect your GitHub account first.</p>
              <Link href="/settings?github=1" className="bg-accent text-bg px-6 py-3 rounded-sm font-semibold hover:bg-accent-hover transition-colors inline-block">
                Go to Settings
              </Link>
            </div>
          )}

          {/* Connected — show repos */}
          {ghStatus?.connected && (
            <>
              <div className="mb-4">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search repositories..."
                  className="w-full bg-bg-surface border border-border rounded-sm px-4 py-3 text-text text-sm focus:outline-none focus:border-accent"
                />
              </div>

              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

              {loadingRepos ? (
                <div className="text-text-dim text-center py-12">Loading repositories...</div>
              ) : filtered.length === 0 ? (
                <div className="text-text-dim text-center py-12">
                  {search ? 'No matching repositories.' : 'No repositories found.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map(repo => (
                    <div
                      key={repo.fullName}
                      className="flex items-center gap-4 border border-border rounded-md p-4 hover:border-border-hover transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-text font-medium text-sm truncate">{repo.fullName}</p>
                          {repo.private && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                              Private
                            </span>
                          )}
                          {repo.language && (
                            <span className="text-[10px] text-text-dim shrink-0">{repo.language}</span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-text-dim text-xs mt-0.5 truncate">{repo.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeploy(repo)}
                        disabled={deploying !== null}
                        className="shrink-0 bg-accent text-bg px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
                      >
                        {deploying === repo.fullName ? 'Deploying...' : 'Deploy'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
