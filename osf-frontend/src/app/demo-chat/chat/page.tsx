'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
import { ChatWindow } from '@/components/chat/ChatWindow';

interface Session {
  id: string;
  title: string;
  created_at: string;
}

export default function DemoChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'demo' && user.role !== 'admin'))) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      apiFetch<{ sessions: Session[] }>('/chat/sessions')
        .then(({ sessions }) => setSessions(sessions))
        .catch(() => {});
    }
  }, [user]);

  const handleNewChat = () => setActiveSessionId(null);

  const handleSelectSession = (id: string) => setActiveSessionId(id);

  const handleDeleteSession = async (id: string) => {
    try {
      await apiFetch(`/chat/sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) setActiveSessionId(null);
    } catch { /* ignore */ }
  };

  const handleSessionCreated = (id: string) => {
    setActiveSessionId(id);
    apiFetch<{ sessions: Session[] }>('/chat/sessions')
      .then(({ sessions }) => setSessions(sessions))
      .catch(() => {});
  };

  if (loading || !user) return null;

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      {/* Header bar */}
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
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden w-8 h-8 rounded-sm bg-bg-surface border border-border grid place-items-center text-text-muted hover:text-text"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Chat content */}
      <div className="flex-1 flex min-h-0">
        <div className={`${sidebarOpen ? 'block' : 'hidden'} md:block`}>
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewChat}
            onDelete={handleDeleteSession}
          />
        </div>
        <div className="flex-1 min-w-0">
          <ChatWindow
            sessionId={activeSessionId}
            onSessionCreated={handleSessionCreated}
          />
        </div>
      </div>
    </div>
  );
}
