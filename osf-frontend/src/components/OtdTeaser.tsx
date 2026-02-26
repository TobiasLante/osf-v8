'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { streamSSE, apiFetch } from '@/lib/api';
import { ScrollReveal } from './ScrollReveal';
import { StreamOutput, type StreamEvent } from './StreamOutput';

export function OtdTeaser() {
  const { user, loading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [completed, setCompleted] = useState(false);
  const [mode, setMode] = useState<'idle' | 'live' | 'replay'>('idle');
  const [replayEvents, setReplayEvents] = useState<StreamEvent[] | null>(null);
  const replayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Find the OTD agent on mount
  useEffect(() => {
    if (loading) return;
    apiFetch<{ agents: Array<{ id: string; name: string }> }>('/code-agents')
      .then(({ agents }) => {
        const otd = agents.find(a => a.name.toLowerCase().includes('otd'));
        if (otd) setAgentId(otd.id);
      })
      .catch(() => {});
  }, [loading]);

  // Load pre-recorded analysis
  useEffect(() => {
    fetch('/demos/otd-deep-analysis.json')
      .then(r => r.json())
      .then(data => setReplayEvents(data))
      .catch(() => {});
  }, []);

  // Cleanup replay timer
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    };
  }, []);

  // Replay pre-recorded analysis with realistic timing
  const startReplay = useCallback(() => {
    if (!replayEvents || replayEvents.length === 0) return;
    setMode('replay');
    setRunning(true);
    setEvents([]);
    setCompleted(false);

    let idx = 0;
    const play = () => {
      if (idx >= replayEvents.length) {
        setRunning(false);
        setCompleted(true);
        return;
      }

      const evt = replayEvents[idx];
      setEvents(prev => [...prev, evt]);
      idx++;

      // Realistic delays based on event type
      let delay = 80;
      switch (evt.type) {
        case 'run_start': delay = 300; break;
        case 'log': delay = 120; break;
        case 'tool_start': delay = 200; break;
        case 'tool_result': delay = 400; break;
        case 'llm_start': delay = 300; break;
        case 'llm_result': delay = 500; break;
        case 'result': delay = 200; break;
        case 'done': delay = 100; break;
      }

      if (evt.type === 'done') {
        setRunning(false);
        setCompleted(true);
      } else {
        replayTimerRef.current = setTimeout(play, delay);
      }
    };

    play();
  }, [replayEvents]);

  // Run live analysis
  const runLive = useCallback(async () => {
    if (!agentId) return;
    setMode('live');
    setRunning(true);
    setEvents([]);
    setCompleted(false);

    try {
      for await (const event of streamSSE(`/code-agents/${agentId}/run`, {})) {
        setEvents(prev => [...prev, event as StreamEvent]);
        if (event.type === 'done') setCompleted(true);
      }
    } catch (err: any) {
      setEvents(prev => [...prev, { type: 'error', message: err.message || 'Analysis failed' }]);
    } finally {
      setRunning(false);
    }
  }, [agentId]);

  const showOutput = events.length > 0;

  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <ScrollReveal>
          <div className="relative rounded-md border border-accent/20 bg-bg-surface p-8 sm:p-12 overflow-hidden">
            {/* Glow effect */}
            <div className="absolute -top-20 -right-20 w-60 h-60 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-accent/3 rounded-full blur-3xl pointer-events-none" />

            <div className="relative">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold mb-3">
                  See AI Analyze{' '}
                  <span className="bg-accent-gradient bg-clip-text text-transparent">This Factory</span>
                </h2>
                <p className="text-text-muted max-w-lg mx-auto text-sm mb-4">
                  Watch our multi-agent system analyze OTD, quality, capacity and material &mdash; live, with real factory data.
                  4 specialists, a moderator discussion, and optimist/realist synthesis.
                </p>

                {/* Model badges */}
                <div className="flex justify-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20">
                    Qwen 32B
                  </span>
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">
                    Qwen 14B
                  </span>
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    4 MCP Servers
                  </span>
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">
                    111 Factory Tools
                  </span>
                </div>
              </div>

              {/* CTA Buttons */}
              {!showOutput && (
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                  {/* Replay button - always available */}
                  {replayEvents && replayEvents.length > 0 && (
                    <button
                      onClick={startReplay}
                      className="px-8 py-4 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all"
                    >
                      Watch Live Analysis
                    </button>
                  )}

                  {/* Live run button - only for logged-in users with agent */}
                  {!loading && user && agentId && (
                    <button
                      onClick={runLive}
                      className="px-8 py-4 rounded-md border border-accent text-accent font-semibold text-sm hover:bg-accent/10 transition-all"
                    >
                      Run Live Now
                    </button>
                  )}

                  {!loading && !user && !replayEvents && (
                    <a
                      href="/login"
                      className="inline-block px-8 py-4 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all"
                    >
                      Login to Try
                    </a>
                  )}

                  {loading && <div className="h-12" />}
                </div>
              )}

              {/* Live/Replay indicator */}
              {showOutput && (
                <div className="flex items-center gap-3 mb-4">
                  {running && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border bg-red-500/10 text-red-400 border-red-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      {mode === 'live' ? 'LIVE' : 'RECORDED RUN'}
                    </span>
                  )}
                  {!running && completed && (
                    <span className="text-xs text-text-dim">
                      {mode === 'live' ? 'Live analysis complete' : 'Recorded analysis from factory at 192.168.178.150'}
                    </span>
                  )}
                </div>
              )}

              {/* Stream Output */}
              {showOutput && (
                <div className="mt-2">
                  <StreamOutput events={events} running={running} maxHeight="500px" />

                  {/* Actions after completion */}
                  {completed && !running && (
                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                      <a
                        href="/demos/otd-deep-analysis.json"
                        download="otd-deep-analysis.json"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-border text-text-muted text-sm hover:text-text hover:border-accent/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Analysis (JSON)
                      </a>
                      <a
                        href="https://github.com/TobiasLante/osf-otd-agent"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-border text-text-muted text-sm hover:text-text hover:border-accent/30 transition-colors"
                      >
                        <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        View Agent on GitHub
                      </a>
                      {user && agentId && mode === 'replay' && (
                        <button
                          onClick={runLive}
                          className="px-4 py-2 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors"
                        >
                          Run Live Now
                        </button>
                      )}
                      {mode === 'live' && (
                        <button
                          onClick={runLive}
                          className="text-text-muted text-sm hover:text-text transition-colors"
                        >
                          Run again &rarr;
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Endpoints info */}
              {showOutput && !running && completed && (
                <div className="mt-6 pt-6 border-t border-border">
                  <p className="text-xs text-text-dim mb-3 font-semibold uppercase tracking-wider">MCP Endpoints Used</p>
                  <div className="flex flex-wrap gap-2">
                    {['mcp-erp:8021', 'mcp-fertigung:8024', 'mcp-qms:8023', 'mcp-wms:8022'].map(ep => (
                      <span key={ep} className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface-2 border border-border text-text-dim">
                        {ep}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Array.from(new Set(events.filter(e => e.type === 'tool_start').map(e => e.name))).map(tool => (
                      <span key={tool} className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/5 border border-accent/10 text-accent">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
