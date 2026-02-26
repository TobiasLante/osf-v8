'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Header } from '@/components/Header';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';
import { ProfileTab } from './ProfileTab';
import { LlmTab } from './LlmTab';
import { GitHubTab } from './GitHubTab';

// ── Tabs ────────────────────────────────────────────────────────────────────
type Tab = 'profile' | 'llm' | 'github';

function SettingsContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('profile');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  // Auto-switch to GitHub tab after OAuth callback
  useEffect(() => {
    if (searchParams.get('github')) setTab('github');
  }, [searchParams]);

  if (loading || !user) return null;

  return (
    <>
      <Header />
      <BackgroundOrbs />
      <main className="relative z-10 max-w-2xl mx-auto pt-32 pb-20 px-6">
        <h1 className="text-3xl font-bold text-text mb-8">Settings</h1>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border mb-8">
          {[
            { id: 'profile' as Tab, label: 'Profile' },
            { id: 'llm' as Tab, label: 'LLM Provider' },
            { id: 'github' as Tab, label: 'GitHub' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile' && <ProfileTab user={user} />}
        {tab === 'llm' && <LlmTab />}
        {tab === 'github' && <GitHubTab />}

        {/* Version Info */}
        <div className="mt-12 border border-border rounded-md p-5">
          <h3 className="text-text font-semibold text-sm mb-3">About</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-text-dim block text-xs">App Version</span>
              <span className="text-text font-mono">{process.env.NEXT_PUBLIC_APP_VERSION}</span>
            </div>
            <div>
              <span className="text-text-dim block text-xs">Chains Version</span>
              <span className="text-text font-mono">{process.env.NEXT_PUBLIC_CHAINS_VERSION}</span>
            </div>
            <div>
              <span className="text-text-dim block text-xs">Flows Version</span>
              <span className="text-text font-mono">{process.env.NEXT_PUBLIC_FLOWS_VERSION}</span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
