'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const CHAT_UI_URL = 'https://osf-api.zeroguess.ai/demo-ui';

export default function DemoChatPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'demo' && user.role !== 'admin'))) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="fixed inset-0 bg-bg flex flex-col z-[60]">
      <div className="h-12 bg-bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-text-muted hover:text-text text-sm flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-text font-semibold text-sm">Demo Chat</span>
        </div>
      </div>
      <iframe
        src={`${CHAT_UI_URL}/chat.html?v=${Date.now()}${token ? `&token=${encodeURIComponent(token)}` : ''}`}
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
