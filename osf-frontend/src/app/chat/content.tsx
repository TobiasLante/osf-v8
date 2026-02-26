"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";

interface Session {
  id: string;
  title: string;
  created_at: string;
}

export function ChatPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    searchParams.get("session")
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) {
      apiFetch<{ sessions: Session[] }>("/chat/sessions")
        .then(({ sessions }) => setSessions(sessions))
        .catch(() => {});
    }
  }, [user]);

  const handleNewChat = () => {
    setActiveSessionId(null);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await apiFetch(`/chat/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    } catch { /* ignore */ }
  };

  const handleSessionCreated = (id: string) => {
    setActiveSessionId(id);
    apiFetch<{ sessions: Session[] }>("/chat/sessions")
      .then(({ sessions }) => setSessions(sessions))
      .catch(() => {});
  };

  if (authLoading || !user) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex pt-[65px]">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed top-[72px] left-4 z-30 w-8 h-8 rounded-sm bg-bg-surface border border-border grid place-items-center text-text-muted hover:text-text"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className={`${sidebarOpen ? "block" : "hidden"} md:block`}>
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
  );
}
