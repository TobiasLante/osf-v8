"use client";

import React from "react";
import type { EnrichmentData, ModalityResolution } from "@p1/shared";

interface Props {
  enrichment: EnrichmentData;
  resolution: ModalityResolution | null;
  isResolving: boolean;
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

function SourceCard({ name, found, detail }: { name: string; found: boolean; detail: string }) {
  return (
    <div className={`rounded-lg border p-3 ${found ? "border-emerald-500/30 bg-emerald-500/5" : "border-p1-border bg-p1-surface"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm ${found ? "text-emerald-400" : "text-p1-dim"}`}>
          {found ? "✓" : "—"}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-p1-muted">{name}</span>
      </div>
      <p className="text-xs text-p1-dim leading-relaxed">{detail}</p>
    </div>
  );
}

export function EnrichmentStatus({ enrichment, resolution, isResolving, onConfirm, onOverrideModality }: Props) {
  const e = enrichment;
  const ctCount = e.clinicalTrials?.studies?.length || 0;
  const fdaCount = e.openFda?.approvals?.length || 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold">Enrichment Results</h2>
        <p className="text-p1-dim text-sm mt-1">Data collected from 6 public sources</p>
      </div>

      {/* Source cards */}
      <div className="grid grid-cols-2 gap-3">
        <SourceCard
          name="ClinicalTrials.gov"
          found={ctCount > 0}
          detail={ctCount > 0 ? `${ctCount} studies found` : "No studies (typical for CDMOs)"}
        />
        <SourceCard
          name="openFDA"
          found={fdaCount > 0}
          detail={fdaCount > 0 ? `${fdaCount} approved products` : "No approved products found"}
        />
        <SourceCard
          name="FDA DECRS"
          found={!!e.decrs}
          detail={e.decrs ? `FEI: ${e.decrs.feiNumber} — ${e.decrs.businessOperations.join(", ")}` : "Not found in establishment registry"}
        />
        <SourceCard
          name="CBER/HCTERS"
          found={!!e.hcters?.hasRegistration}
          detail={e.hcters?.hasRegistration ? "HCT/P registration found — cell/gene therapy signal" : "No HCT/P registration"}
        />
        <SourceCard
          name="SEC EDGAR"
          found={(e.edgar?.totalMentions || 0) > 0}
          detail={e.edgar?.totalMentions
            ? `${e.edgar.totalMentions} filing(s): ${e.edgar.filings.slice(0, 2).map(f => f.filer).join(", ")}`
            : "No SEC filing mentions"}
        />
        <SourceCard
          name="Company Website"
          found={!!e.website && e.website.modalities.length > 0}
          detail={e.website?.modalities.length
            ? `Modalities: ${e.website.modalities.join(", ")}${e.website.cgmpStatus ? ` | ${e.website.cgmpStatus}` : ""}`
            : "Website not accessible or no data extracted"}
        />
      </div>

      {/* Resolution result */}
      {isResolving ? (
        <div className="text-center py-6">
          <span className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin inline-block" />
          <p className="text-p1-dim text-sm mt-2">Resolving modality...</p>
        </div>
      ) : resolution ? (
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

          {/* Signals */}
          <details className="text-xs text-p1-dim">
            <summary className="cursor-pointer hover:text-p1-text">View {resolution.signals.length} signals</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {resolution.signals.map((s, i) => <li key={i} className="list-disc">{s}</li>)}
            </ul>
          </details>

          {/* Actions */}
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
      ) : null}
    </div>
  );
}
