'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { ScrollReveal } from './ScrollReveal';
import { LS_ANALYSIS_COOLDOWN } from '@/lib/constants';
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

const AGENTS = [
  {
    id: 'otd-optimize',
    label: 'OTD Deep',
    description: 'On-Time Delivery optimization — 4 specialists + moderator discussion + synthesis',
    duration: '~2-3 min',
    color: 'orange',
  },
  {
    id: 'oee-diagnose',
    label: 'OEE Fast',
    description: 'Root-cause analysis for low OEE across machines',
    duration: '~30-60s',
    color: 'blue',
  },
  {
    id: 'goodmorning',
    label: 'Shopfloor Fast',
    description: 'Morning meeting report — OEE, KPIs, stock levels, open orders',
    duration: '~30-60s',
    color: 'emerald',
  },
];

function getCooldownRemaining(): number {
  try {
    const ts = localStorage.getItem(LS_ANALYSIS_COOLDOWN);
    if (!ts) return 0;
    const remaining = parseInt(ts, 10) + COOLDOWN_MS - Date.now();
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function setCooldown() {
  try {
    localStorage.setItem(LS_ANALYSIS_COOLDOWN, Date.now().toString());
  } catch {}
}

export function DeepAnalysisTeaser() {
  const [showChat, setShowChat] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [showCooldown, setShowCooldown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  // Update cooldown timer every second
  useEffect(() => {
    const update = () => setCooldownLeft(getCooldownRemaining());
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const launchAnalysis = async () => {
    // Check cooldown
    const remaining = getCooldownRemaining();
    if (remaining > 0) {
      setCooldownLeft(remaining);
      setShowCooldown(true);
      return;
    }

    setChecking(true);
    try {
      const { llmOnline } = await apiFetch<{ llmOnline: boolean }>('/v7/llm-status');
      if (llmOnline) {
        setCooldown();
        setCooldownLeft(COOLDOWN_MS);
        setShowChat(true);
      } else {
        setShowOffline(true);
      }
    } catch {
      setShowOffline(true);
    } finally {
      setChecking(false);
    }
  };

  const cooldownMinutes = Math.ceil(cooldownLeft / 60000);
  const onCooldown = cooldownLeft > 0;

  return (
    <>
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <div className="relative rounded-md border border-accent/20 bg-bg-surface p-8 sm:p-12 overflow-hidden">
              <div className="absolute -top-20 -right-20 w-60 h-60 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="relative">
                <div className="text-center mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold mb-3">
                    Deep Analysis{' '}
                    <span className="bg-accent-gradient bg-clip-text text-transparent">Agents</span>
                  </h2>
                  <p className="text-text-muted max-w-lg mx-auto text-sm">
                    Multi-agent systems that analyze your factory in real-time &mdash; powered by
                    4 MCP servers with 111 factory tools and local LLM inference.
                  </p>
                </div>

                {/* Agent Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                  {AGENTS.map((agent) => (
                    <div
                      key={agent.id}
                      className="rounded-md border border-border bg-bg-surface-2 p-4 text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${
                          agent.color === 'orange' ? 'bg-amber-400' :
                          agent.color === 'blue' ? 'bg-blue-400' : 'bg-emerald-400'
                        }`} />
                        <span className="font-semibold text-sm text-text">{agent.label}</span>
                        <span className="ml-auto text-[10px] text-text-dim font-mono">{agent.duration}</span>
                      </div>
                      <p className="text-xs text-text-dim leading-relaxed">{agent.description}</p>
                    </div>
                  ))}
                </div>

                {/* Launch Button */}
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={launchAnalysis}
                    disabled={checking || onCooldown}
                    className="px-8 py-4 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_4px_24px_rgba(255,149,0,0.35)]"
                  >
                    {checking
                      ? 'Connecting...'
                      : onCooldown
                      ? `Available in ${cooldownMinutes} min`
                      : 'Open Analysis Console'}
                  </button>
                  {onCooldown && (
                    <p className="text-[11px] text-text-dim">
                      Rate limited to one session every 10 minutes
                    </p>
                  )}
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Server offline modal */}
      {showOffline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative max-w-md w-full rounded-md border border-border bg-bg-surface p-8 shadow-2xl">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-2">Server Currently Offline</h3>
              <p className="text-sm text-text-muted mb-4">
                OpenShopFloor is a private research project. The LLM inference server and factory simulation
                are not running 24/7. The backend is currently unavailable.
              </p>
              <p className="text-xs text-text-dim mb-6">
                Check back later or reach out on{' '}
                <a href="https://github.com/TobiasLante/openshopfloor/discussions" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  GitHub Discussions
                </a>{' '}
                to request a live demo session.
              </p>
              <button
                onClick={() => setShowOffline(false)}
                className="px-6 py-2.5 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent-hover transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cooldown modal */}
      {showCooldown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative max-w-md w-full rounded-md border border-border bg-bg-surface p-8 shadow-2xl">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-blue-500/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-2">Please Wait</h3>
              <p className="text-sm text-text-muted mb-4">
                To keep server load low, analyses are limited to one session every 10 minutes.
                Try again in <strong>{cooldownMinutes} minute{cooldownMinutes !== 1 ? 's' : ''}</strong>.
              </p>
              <button
                onClick={() => setShowCooldown(false)}
                className="px-6 py-2.5 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent-hover transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen V7 Chat UI overlay */}
      {showChat && (
        <div className="fixed inset-0 z-50 bg-black">
          <button
            onClick={() => setShowChat(false)}
            className="absolute top-4 left-4 z-[60] flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors backdrop-blur-sm border border-white/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to OSF
          </button>
          <iframe
            src="/deep-analysis.html"
            className="w-full h-full border-0"
            allow="clipboard-write"
          />
        </div>
      )}
    </>
  );
}
