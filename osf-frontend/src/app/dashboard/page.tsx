"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { ChallengeProgressCard } from "./ChallengeProgressCard";
import { LlmStatusCard } from "./LlmStatusCard";
import { TokenQuotaCard } from "./TokenQuotaCard";
import { DeployedAgentsSection } from "./DeployedAgentsSection";
import { RecentFlowsSection } from "./RecentFlowsSection";
import { RecentChatsSection } from "./RecentChatsSection";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://osf-api.zeroguess.ai';

interface Session {
  id: string;
  title: string;
  created_at: string;
}

interface Flow {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  last_run_status: string | null;
  last_run_at: string | null;
  updated_at: string;
}

interface DeployedAgent {
  id: string;
  source_type: string;
  source_id: string;
  deploy_mode: string;
  name: string | null;
  icon: string | null;
  description: string | null;
  created_at: string;
}

interface ChallengeProgress {
  progress: Record<string, { bestScore: number; completed: boolean }>;
  totalChallenges: number;
  completedCount: number;
}

interface LlmStatus {
  online: boolean;
  servers?: Array<{ name: string; active: number; queued: number }>;
  message?: string;
}

interface TokenUsage {
  tokensUsed: number;
  tokenQuota: number;
  quotaResetAt: string;
  percentUsed: number;
}

const ACTION_CARDS = [
  {
    href: "/chat",
    icon: "\u{1F4AC}",
    title: "Chat",
    subtitle: "Start talking",
    color: "from-blue-500/20 to-blue-600/5",
    borderColor: "hover:border-blue-500/30",
  },
  {
    href: "/flows",
    icon: "\u{1F500}",
    title: "Flows",
    subtitle: "Design workflows",
    color: "from-orange-500/20 to-orange-600/5",
    borderColor: "hover:border-accent/30",
  },
  {
    href: "/agents",
    icon: "\u{1F916}",
    title: "Agents",
    subtitle: "Browse & create",
    color: "from-purple-500/20 to-purple-600/5",
    borderColor: "hover:border-purple-500/30",
  },
  {
    href: "/challenges",
    icon: "\u{1F3AF}",
    title: "Challenges",
    subtitle: "Test your skills",
    color: "from-emerald-500/20 to-emerald-600/5",
    borderColor: "hover:border-emerald-500/30",
  },
];

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [deployedAgents, setDeployedAgents] = useState<DeployedAgent[]>([]);
  const [challengeProgress, setChallengeProgress] = useState<ChallengeProgress | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) {
      apiFetch<{ sessions: Session[] }>("/chat/sessions")
        .then(({ sessions }) => setSessions(sessions.slice(0, 5)))
        .catch(() => {});
      apiFetch<{ flows: Flow[] }>("/flows/api/mine")
        .then(({ flows }) => setFlows(flows.slice(0, 5)))
        .catch(() => {});
      // LLM status (public, no auth)
      fetch(`${API_BASE}/llm/status`)
        .then(r => r.json())
        .then(data => setLlmStatus(data))
        .catch(() => setLlmStatus({ online: false, message: 'Status unavailable' }));
      // Token usage
      apiFetch<TokenUsage>("/auth/usage")
        .then(data => setTokenUsage(data))
        .catch(() => {});
      // Deployed agents
      apiFetch<{ deployed: DeployedAgent[] }>("/marketplace/deployed")
        .then(data => setDeployedAgents(data.deployed))
        .catch(() => {});
      // Challenge progress
      apiFetch<ChallengeProgress>("/challenges/my-progress")
        .then(data => setChallengeProgress(data))
        .catch(() => {});
    }
  }, [user]);

  if (authLoading || !user) {
    return (
      <section className="pt-32 pb-20 px-6 text-center">
        <p className="text-text-muted">Loading...</p>
      </section>
    );
  }

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-5xl">
          {/* Welcome */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold">
              Welcome back, {user.name || user.email.split("@")[0]}
            </h1>
            <p className="text-text-muted mt-1">
              What would you like to do today?{" "}
              <Link href="/onboarding" className="text-accent hover:text-accent-hover text-sm">
                Take the tour →
              </Link>
            </p>
          </div>

          {/* Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
            {ACTION_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className={`group bg-gradient-to-br ${card.color} border border-border ${card.borderColor} rounded-md p-6 transition-all hover:scale-[1.02]`}
              >
                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-lg font-semibold">{card.title}</h3>
                <p className="text-sm text-text-muted">{card.subtitle}</p>
              </Link>
            ))}
          </div>

          {/* Challenge Progress */}
          <ChallengeProgressCard challengeProgress={challengeProgress} />

          {/* LLM Status + Token Usage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            <LlmStatusCard llmStatus={llmStatus} />
            <TokenQuotaCard tokenUsage={tokenUsage} />
          </div>

          {/* Deployed Agents */}
          <DeployedAgentsSection
            deployedAgents={deployedAgents}
            onRemoveAgent={(agentId) => setDeployedAgents(prev => prev.filter(a => a.id !== agentId))}
          />

          {/* Recent Flows + Recent Chats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            <RecentFlowsSection flows={flows} />
            <RecentChatsSection sessions={sessions} />
          </div>

          {/* Account Info */}
          <div className="bg-bg-surface border border-border rounded-md p-6">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <span className="text-xs text-text-dim">Email</span>
                <p className="text-sm">{user.email}</p>
              </div>
              <div>
                <span className="text-xs text-text-dim">Account</span>
                <p className="text-sm inline-block px-2 py-0.5 rounded border text-text-muted border-border">
                  {user.tier === 'own-key' ? 'Own API Key' : 'Open Source'}
                </p>
              </div>
              <div>
                <span className="text-xs text-text-dim">API Key</span>
                <code className="block text-xs font-mono text-text-muted truncate max-w-[200px]">
                  {user.api_key_masked || '—'}
                </code>
              </div>
              <Link
                href="/settings"
                className="ml-auto text-sm text-accent hover:text-accent-hover transition-colors"
              >
                Settings
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
