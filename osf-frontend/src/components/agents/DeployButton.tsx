'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface DeployButtonProps {
  sourceType: 'agent' | 'chain' | 'code_agent' | 'flow';
  sourceId: string;
  allowFork?: boolean;
}

export function DeployButton({ sourceType, sourceId, allowFork = true }: DeployButtonProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [deployed, setDeployed] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    apiFetch<{ deployed: boolean; deployments: Array<{ id: string; deploy_mode: string }> }>(
      `/marketplace/check?sourceType=${sourceType}&sourceId=${sourceId}`
    )
      .then(data => {
        setDeployed(data.deployed);
        if (data.deployments.length > 0) setDeploymentId(data.deployments[0].id);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [user, sourceType, sourceId]);

  if (!user || checking) return null;

  const handleDeploy = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ id: string }>('/marketplace/deploy', {
        method: 'POST',
        body: JSON.stringify({ sourceType, sourceId, mode: 'link' }),
      });
      setDeployed(true);
      setDeploymentId(result.id);
    } catch (err: any) {
      if (err.message?.includes('Already deployed')) {
        setDeployed(true);
      } else {
        alert(err.message || 'Deploy failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFork = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ id: string }>('/marketplace/deploy', {
        method: 'POST',
        body: JSON.stringify({ sourceType, sourceId, mode: 'fork' }),
      });
      // Redirect to edit page for the fork
      if (sourceType === 'agent') {
        router.push(`/agents/${result.id}`);
      } else if (sourceType === 'chain') {
        router.push(`/agents/chains/${result.id}`);
      } else {
        router.push('/agents');
      }
    } catch (err: any) {
      alert(err.message || 'Fork failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!deploymentId || !confirm('Remove this agent from your dashboard?')) return;
    setLoading(true);
    try {
      await apiFetch(`/marketplace/deploy/${deploymentId}`, { method: 'DELETE' });
      setDeployed(false);
      setDeploymentId(null);
    } catch (err: any) {
      alert(err.message || 'Remove failed');
    } finally {
      setLoading(false);
    }
  };

  if (deployed) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Deployed
        </span>
        <button
          onClick={handleRemove}
          disabled={loading}
          className="px-3 py-2.5 rounded-sm border border-border text-text-dim text-sm hover:text-red-400 hover:border-red-400/30 transition-colors disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={handleDeploy}
        disabled={loading}
        className="px-5 py-2.5 rounded-sm border border-accent text-accent text-sm font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
      >
        {loading ? 'Deploying...' : 'Deploy'}
      </button>
      {allowFork && sourceType !== 'code_agent' && (
        <button
          onClick={handleFork}
          disabled={loading}
          className="px-5 py-2.5 rounded-sm border border-border text-text-muted text-sm font-medium hover:border-accent/30 hover:text-accent transition-colors disabled:opacity-50"
        >
          Fork & Edit
        </button>
      )}
    </div>
  );
}
