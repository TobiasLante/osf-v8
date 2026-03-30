"use client";

import { useState, useEffect } from "react";
import { Chat } from "@/components/Chat";
import { ProcessMap } from "@/components/ProcessMap";
import { NewAccountForm } from "@/components/NewAccountForm";
import type { ProcessStep } from "@p1/shared";
import { loadLlmConfig, getAccounts, getVendors, getStats } from "@/lib/api";
import type { Account } from "@/lib/api";

const QUICK_LINKS = [
  { label: "Show hot accounts", icon: "🔥", prompt: "Show me all accounts with warmth rating HOT and their open opportunities" },
  { label: "Compare vendors", icon: "⚖️", prompt: "Compare Sartorius vs Cytiva across all unit operations — where does each dominate?" },
  { label: "mAb process map", icon: "🧬", prompt: "Show me the standard mAb process template with all unit operations and typical vendor products" },
  { label: "Meeting prep: BioNTech", icon: "📋", prompt: "Prepare a sales meeting brief for BioNTech — what do they have, what's open, who's the competition?" },
];

export default function HomePage() {
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [vendorCount, setVendorCount] = useState<number | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);

  useEffect(() => {
    const cfg = loadLlmConfig();
    setHasApiKey(!!cfg.apiKey);

    // Load live stats from i3x REST API
    getAccounts().then(a => { setAccounts(a); setAccountCount(a.length); }).catch(() => {});
    getVendors().then(v => setVendorCount(v.length)).catch(() => {});
    getStats().then(types => {
      if (Array.isArray(types)) {
        const vp = types.find((t: any) => t.displayName === 'VendorProduct');
        setProductCount(vp ? null : types.length); // fallback to type count
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Left: Chat (60%) */}
      <div className="flex-[3] min-w-0 flex flex-col border-r border-p1-border">
        <Chat externalPrompt={chatPrompt} onPromptConsumed={() => setChatPrompt(null)} onProcessMap={setProcessSteps} />
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

        {/* Live stats from i3x REST API */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Accounts", value: accountCount, sub: "pharma companies" },
            { label: "Vendors", value: vendorCount, sub: "equipment suppliers" },
            { label: "Products", value: productCount, sub: "mapped to operations" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-p1-border bg-p1-surface p-4">
              <p className="text-2xl font-bold text-p1-accent">{s.value ?? "--"}</p>
              <p className="text-xs text-p1-muted mt-1">{s.label}</p>
              <p className="text-[10px] text-p1-dim">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Accounts from i3x REST API */}
        {accounts.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-p1-muted uppercase tracking-wider mb-3">Accounts</h3>
            <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
              {accounts.map(a => (
                <button
                  key={a.elementId}
                  onClick={() => setChatPrompt(`Prepare a sales meeting brief for ${a.displayName}`)}
                  className="text-left rounded-lg border border-p1-border bg-p1-surface hover:border-p1-accent/40 transition-all px-3 py-2 flex items-center justify-between"
                >
                  <span className="text-sm text-p1-text truncate">{a.displayName}</span>
                  {a.properties.warmth_rating && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      a.properties.warmth_rating === 'HOT' ? 'bg-red-500/20 text-red-400' :
                      a.properties.warmth_rating === 'WARM' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-slate-600/20 text-slate-400'
                    }`}>
                      {a.properties.warmth_rating}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

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

        {/* Process map — shown when chat returns pharma_process_map data */}
        <ProcessMap steps={processSteps} className="flex-1 min-h-[200px]" />
      </div>
    </div>
  );
}
