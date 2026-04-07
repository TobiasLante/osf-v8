"use client";

import React, { useState, useEffect } from "react";
import type { SiteIntelligenceInput, Vendor } from "@p1/shared";
import { getSavedAccounts } from "../../lib/api";

const VENDORS: Vendor[] = [
  "Sartorius",
  "Thermo Fisher",
  "Cytiva",
  "MilliporeSigma",
  "Repligen",
];

interface Props {
  onSubmit: (input: SiteIntelligenceInput) => void;
  isLoading: boolean;
}

export function IntakeForm({ onSubmit, isLoading }: Props) {
  const [accountName, setAccountName] = useState("");
  const [location, setLocation] = useState("");
  const [vendor, setVendor] = useState<Vendor>("Sartorius");
  const [salesGoal, setSalesGoal] = useState("");
  const [recentAccounts, setRecentAccounts] = useState<Array<{ companyName: string; location: string; modality: string; lastEnriched: string }>>([]);

  useEffect(() => {
    getSavedAccounts().then(a => setRecentAccounts(a.slice(0, 5))).catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim()) return;
    onSubmit({ accountName: accountName.trim(), location: location.trim() || undefined, vendor, salesGoal: salesGoal.trim() || undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-5">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold">Site Intelligence</h2>
        <p className="text-p1-dim text-sm mt-1">Enter a facility to generate an Account Intelligence Report</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-p1-muted uppercase tracking-wider mb-1.5">
          Account Name *
        </label>
        <input
          type="text"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="e.g. Matica Biotechnology"
          className="w-full px-3 py-2.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text placeholder:text-p1-dim focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          required
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-p1-muted uppercase tracking-wider mb-1.5">
          Site Location
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. College Station, TX"
          className="w-full px-3 py-2.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text placeholder:text-p1-dim focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-p1-muted uppercase tracking-wider mb-1.5">
          Your Vendor *
        </label>
        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value as Vendor)}
          className="w-full px-3 py-2.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          disabled={isLoading}
        >
          {VENDORS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-p1-muted uppercase tracking-wider mb-1.5">
          Sales Goal
        </label>
        <textarea
          value={salesGoal}
          onChange={(e) => setSalesGoal(e.target.value)}
          placeholder="e.g. Downstream equipment — depth filtration, chromatography, TFF"
          rows={2}
          className="w-full px-3 py-2.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text placeholder:text-p1-dim focus:outline-none focus:ring-2 focus:ring-cyan-500/40 resize-none"
          disabled={isLoading}
        />
      </div>

      {/* Recent accounts */}
      {recentAccounts.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-p1-muted uppercase tracking-wider mb-1.5">
            Recent Accounts
          </label>
          <div className="flex flex-wrap gap-2">
            {recentAccounts.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setAccountName(a.companyName); setLocation(a.location); }}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text hover:border-cyan-500/40 transition-colors"
                disabled={isLoading}
              >
                {a.companyName} <span className="text-p1-dim">({a.modality})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!accountName.trim() || isLoading}
        className="w-full py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Searching public databases...
          </span>
        ) : (
          "Search & Enrich"
        )}
      </button>
    </form>
  );
}
