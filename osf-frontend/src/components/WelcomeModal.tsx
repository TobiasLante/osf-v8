'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { LS_WELCOME_SEEN } from '@/lib/constants';

export function WelcomeModal() {
  const { user, loading } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    const seen = localStorage.getItem(LS_WELCOME_SEEN);
    if (seen !== 'true') {
      setVisible(true);
    }
  }, [user, loading]);

  const dismiss = () => {
    localStorage.setItem(LS_WELCOME_SEEN, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-bg-surface border border-border rounded-md max-w-lg w-full p-8 shadow-2xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to OpenShopFloor"
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">&#127981;</div>
          <h2 className="text-2xl font-bold mb-2">Welcome to OpenShopFloor</h2>
          <p className="text-text-muted text-sm">
            OpenShopFloor is a 100% open-source platform for smart manufacturing.
          </p>
        </div>

        {/* Three pillars */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-bg-surface-2 border border-border rounded-md p-4 text-center">
            <div className="text-2xl mb-2">&#128275;</div>
            <h3 className="text-sm font-bold mb-1">Open Source</h3>
            <p className="text-xs text-text-dim leading-relaxed">
              All code on GitHub. Transparent and auditable.
            </p>
          </div>
          <div className="bg-bg-surface-2 border border-border rounded-md p-4 text-center">
            <div className="text-2xl mb-2">&#129309;</div>
            <h3 className="text-sm font-bold mb-1">Community Driven</h3>
            <p className="text-xs text-text-dim leading-relaxed">
              Agents, flows &amp; ideas from the community.
            </p>
          </div>
          <div className="bg-bg-surface-2 border border-border rounded-md p-4 text-center">
            <div className="text-2xl mb-2">&#128640;</div>
            <h3 className="text-sm font-bold mb-1">Build &amp; Share</h3>
            <p className="text-xs text-text-dim leading-relaxed">
              Create agents and publish to the store.
            </p>
          </div>
        </div>

        {/* Philosophy */}
        <p className="text-text-muted text-sm text-center mb-6 leading-relaxed">
          Our philosophy: Manufacturing AI should be transparent, accessible, and owned by the community &mdash; not locked behind vendor walls.
        </p>

        {/* Secondary links */}
        <div className="flex justify-center gap-3 mb-5">
          <a
            href="https://github.com/TobiasLante/openshopfloor"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-border text-text-muted text-sm hover:text-text hover:border-accent/30 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            GitHub
          </a>
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-border text-text-muted text-sm hover:text-text hover:border-accent/30 transition-colors"
          >
            Explore Agents
          </Link>
        </div>

        {/* CTA */}
        <button
          onClick={dismiss}
          className="w-full py-3 rounded-sm bg-accent text-bg font-semibold text-sm hover:bg-accent-hover transition-colors"
        >
          Got it, let&apos;s go!
        </button>
      </div>
    </div>
  );
}
