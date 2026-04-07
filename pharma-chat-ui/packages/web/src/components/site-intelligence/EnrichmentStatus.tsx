"use client";

import React from "react";
import type { EnrichmentData, ModalityResolution } from "@p1/shared";

interface Props {
  enrichment: EnrichmentData | null;
  resolution: ModalityResolution | null;
  isResolving: boolean;
  sourceStatus: Record<string, 'pending' | 'running' | 'done' | 'error'>;
  sourcePreviews: Record<string, string>;
  onConfirm: () => void;
  onOverrideModality: (modality: string, scale: string) => void;
}

const MODALITY_OPTIONS = [
  { label: "mAb 1000L (Dynamic Perfusion)", modality: "mAb", scale: "1000L" },
  { label: "mAb 2000L (Fed Batch)", modality: "mAb", scale: "2000L" },
  { label: "AAV 500L", modality: "AAV", scale: "500L" },
  { label: "Lentivirus 50L", modality: "Lentivirus", scale: "50L" },
  { label: "ADC (Platform Scale)", modality: "ADC", scale: "Platform" },
  { label: "mRNA IVT 50L", modality: "mRNA", scale: "50L" },
  { label: "pDNA 40L", modality: "pDNA", scale: "40L" },
];

const SOURCE_LABELS: Record<string, { name: string; icon: string }> = {
  clinicalTrials: { name: "ClinicalTrials.gov", icon: "🔬" },
  openFda:        { name: "openFDA", icon: "💊" },
  decrs:          { name: "FDA DECRS", icon: "🏭" },
  hcters:         { name: "CBER / HCTERS", icon: "🧬" },
  edgar:          { name: "SEC EDGAR", icon: "📄" },
  website:        { name: "Company Website", icon: "🌐" },
  news:           { name: "Press Releases", icon: "📰" },
};

function SourceCard({ id, status, preview }: {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  preview?: string;
}) {
  const label = SOURCE_LABELS[id] || { name: id, icon: "📡" };

  return (
    <div className={`rounded-lg border p-3 transition-all duration-300 ${
      status === 'done' ? "border-emerald-500/30 bg-emerald-500/5" :
      status === 'running' ? "border-cyan-500/30 bg-cyan-500/5 animate-pulse" :
      status === 'error' ? "border-red-500/20 bg-red-500/5" :
      "border-p1-border bg-p1-surface opacity-50"
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{label.icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-p1-muted">{label.name}</span>
        <span className="ml-auto">
          {status === 'running' && <span className="w-3 h-3 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin inline-block" />}
          {status === 'done' && <span className="text-emerald-400 text-sm">✓</span>}
          {status === 'error' && <span className="text-red-400 text-sm">✕</span>}
          {status === 'pending' && <span className="text-slate-600 text-sm">○</span>}
        </span>
      </div>
      <p className="text-xs text-p1-dim leading-relaxed min-h-[16px]">
        {status === 'running' ? 'Searching...' :
         status === 'done' ? (preview || 'Complete') :
         status === 'error' ? 'Failed' :
         'Waiting...'}
      </p>
    </div>
  );
}

export function EnrichmentStatus({
  enrichment, resolution, isResolving, sourceStatus, sourcePreviews,
  onConfirm, onOverrideModality,
}: Props) {
  const allDone = Object.values(sourceStatus).every(s => s === 'done' || s === 'error');
  const doneCount = Object.values(sourceStatus).filter(s => s === 'done').length;
  const totalCount = Object.keys(sourceStatus).length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold">Searching Public Databases</h2>
        <p className="text-p1-dim text-sm mt-1">
          {allDone ? `${doneCount} of ${totalCount} sources returned data` : `Querying ${totalCount} sources...`}
        </p>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-p1-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / Math.max(totalCount, 1)) * 100}%` }}
        />
      </div>

      {/* Source cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(sourceStatus).map(([id, status]) => (
          <SourceCard key={id} id={id} status={status} preview={sourcePreviews[id]} />
        ))}
      </div>

      {/* Resolution result */}
      {allDone && !resolution && isResolving && (
        <div className="text-center py-4">
          <span className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin inline-block" />
          <p className="text-p1-dim text-sm mt-2">Analyzing modality...</p>
        </div>
      )}

      {resolution && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-400">Detected Modality</h3>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              resolution.confidence > 0.5 ? "bg-emerald-500/20 text-emerald-400" :
              resolution.confidence > 0.2 ? "bg-amber-500/20 text-amber-400" :
              "bg-red-500/20 text-red-400"
            }`}>
              {Math.round(resolution.confidence * 100)}% confidence
            </span>
          </div>
          <div className="text-2xl font-bold mb-1">
            {resolution.modality} {resolution.scale}
          </div>
          <div className="text-sm text-p1-dim mb-3">
            {resolution.phase} | {resolution.accountType === "cdmo" ? "CDMO" : resolution.accountType === "innovator" ? "Innovator" : "Unknown"} | Tab: {resolution.vendorMapTab}
          </div>

          <details className="text-xs text-p1-dim">
            <summary className="cursor-pointer hover:text-p1-text">View {resolution.signals.length} signals</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {resolution.signals.map((s, i) => <li key={i} className="list-disc">{s}</li>)}
            </ul>
          </details>

          <div className="flex gap-3 mt-5">
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90"
            >
              Confirm & Continue
            </button>
            <select
              onChange={(e) => {
                const opt = MODALITY_OPTIONS.find(o => o.label === e.target.value);
                if (opt) onOverrideModality(opt.modality, opt.scale);
              }}
              defaultValue=""
              className="px-3 py-2.5 rounded-lg border border-p1-border bg-p1-surface text-p1-text text-sm"
            >
              <option value="" disabled>Correct modality...</option>
              {MODALITY_OPTIONS.map((o) => (
                <option key={o.label} value={o.label}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
