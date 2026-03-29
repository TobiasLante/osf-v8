"use client";

import { useState, useEffect } from "react";
import { Chat } from "@/components/Chat";
import { NewAccountForm } from "@/components/NewAccountForm";
import { loadLlmConfig } from "@/lib/api";

const QUICK_LINKS = [
  { label: "Show hot accounts", icon: "🔥", prompt: "Show me all accounts with warmth rating HOT and their open opportunities" },
  { label: "Compare vendors", icon: "⚖️", prompt: "Compare Sartorius vs Cytiva across all unit operations — where does each dominate?" },
  { label: "mAb process map", icon: "🧬", prompt: "Show me the standard mAb process template with all unit operations and typical vendor products" },
  { label: "Meeting prep: BioNTech", icon: "📋", prompt: "Prepare a sales meeting brief for BioNTech — what do they have, what's open, who's the competition?" },
];

export default function HomePage() {
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    const cfg = loadLlmConfig();
    setHasApiKey(!!cfg.apiKey);
  }, []);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Left: Chat (60%) */}
      <div className="flex-[3] min-w-0 flex flex-col border-r border-p1-border">
        <Chat externalPrompt={chatPrompt} onPromptConsumed={() => setChatPrompt(null)} />
      </div>

      {/* Right: Dashboard (40%) */}
      <div className="flex-[2] min-w-0 hidden lg:flex flex-col overflow-y-auto p-5 gap-4">
        {!hasApiKey && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-amber-400 text-sm font-medium mb-1">API Key Required</p>
            <p className="text-p1-muted text-xs">
              Go to <a href="/settings" className="text-p1-accent hover:underline">Settings</a> to add your Claude or OpenAI API key.
            </p>
          </div>
        )}

        {/* Stats placeholder */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Accounts", value: "--", sub: "pharma companies" },
            { label: "Vendors", value: "--", sub: "equipment suppliers" },
            { label: "Products", value: "--", sub: "mapped to operations" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-p1-border bg-p1-surface p-4">
              <p className="text-2xl font-bold text-p1-accent">{s.value}</p>
              <p className="text-xs text-p1-muted mt-1">{s.label}</p>
              <p className="text-[10px] text-p1-dim">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* New Account Form */}
        <NewAccountForm onAnalyze={(prompt) => setChatPrompt(prompt)} />

        {/* Quick links */}
        <div>
          <h3 className="text-xs font-semibold text-p1-muted uppercase tracking-wider mb-3">Quick Actions</h3>
          <div className="flex flex-col gap-2">
            {QUICK_LINKS.map(q => (
              <button
                key={q.label}
                onClick={() => setChatPrompt(q.prompt)}
                className="text-left rounded-lg border border-p1-border bg-p1-surface hover:border-p1-accent/40 hover:bg-p1-surface2 transition-all p-3 flex items-center gap-3"
              >
                <span className="text-lg">{q.icon}</span>
                <div>
                  <p className="text-sm font-medium text-p1-text">{q.label}</p>
                  <p className="text-xs text-p1-dim truncate max-w-[220px]">{q.prompt}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Process map placeholder */}
        <div className="flex-1 rounded-lg border border-p1-border bg-p1-surface p-4 flex items-center justify-center min-h-[200px]">
          <div className="text-center">
            <p className="text-p1-dim text-sm mb-1">Process Map</p>
            <p className="text-p1-dim text-xs">Visualization will appear here when data is loaded</p>
          </div>
        </div>
      </div>
    </div>
  );
}
