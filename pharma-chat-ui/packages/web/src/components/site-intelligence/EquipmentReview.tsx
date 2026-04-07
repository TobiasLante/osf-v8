"use client";

import React from "react";
import type { ProcessStep, EquipmentStatusValue } from "@p1/shared";
import { ProcessMap } from "../ProcessMap";

interface Props {
  steps: ProcessStep[];
  vendorMapTab: string;
  vendor: string;
  onStatusChange: (stepIndex: number, status: EquipmentStatusValue) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

const STATUS_OPTIONS: { value: EquipmentStatusValue; label: string; color: string }[] = [
  { value: "WON", label: "WON", color: "text-emerald-400" },
  { value: "OPEN", label: "OPEN", color: "text-amber-400" },
  { value: "COMPETITOR", label: "COMPETITOR", color: "text-red-400" },
  { value: "NO_CONTACT", label: "NO CONTACT", color: "text-slate-400" },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    WON: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    OPEN: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    COMPETITOR: "bg-red-500/20 text-red-400 border-red-500/30",
    NO_CONTACT: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${colors[status] || colors.NO_CONTACT}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function EquipmentReview({ steps, vendorMapTab, vendor, onStatusChange, onGenerate, isLoading }: Props) {
  // Count statuses
  const counts: Record<EquipmentStatusValue, number> = { WON: 0, OPEN: 0, COMPETITOR: 0, NO_CONTACT: 0 };
  for (const s of steps) counts[(s.status || "NO_CONTACT") as EquipmentStatusValue]++;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold">Equipment Review</h2>
        <p className="text-p1-dim text-sm mt-1">
          {vendorMapTab} — {vendor} perspective — {steps.length} unit operations
        </p>
      </div>

      {/* Status summary bar */}
      <div className="flex items-center gap-4 justify-center text-xs font-semibold">
        <span className="text-emerald-400">WON: {counts.WON}</span>
        <span className="text-amber-400">OPEN: {counts.OPEN}</span>
        <span className="text-red-400">COMPETITOR: {counts.COMPETITOR}</span>
        <span className="text-slate-400">NO CONTACT: {counts.NO_CONTACT}</span>
      </div>

      {/* Process Treasure Map (live preview) */}
      <div className="rounded-lg border border-p1-border bg-p1-surface p-4">
        <ProcessMap
          steps={steps}
          title="Process Treasure Map — Live Preview"
        />
      </div>

      {/* Equipment table */}
      <div className="rounded-lg border border-p1-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-p1-surface">
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">#</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">Unit Operation</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">Equipment</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">Our Product</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-p1-muted uppercase tracking-wider">Competitors</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => (
              <tr key={i} className="border-t border-p1-border/50 hover:bg-p1-surface/50">
                <td className="px-3 py-2 text-p1-dim text-xs">{step.stepOrder}</td>
                <td className="px-3 py-2 font-medium">{step.step}</td>
                <td className="px-3 py-2 text-p1-dim text-xs">{step.equipment}</td>
                <td className="px-3 py-2 text-xs">{step.product || "—"}</td>
                <td className="px-3 py-2">
                  <select
                    value={step.status || "NO_CONTACT"}
                    onChange={(e) => onStatusChange(i, e.target.value as EquipmentStatusValue)}
                    className="text-xs px-2 py-1 rounded border border-p1-border bg-p1-bg text-p1-text focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-p1-dim text-xs max-w-[200px] truncate" title={step.vendor}>
                  {step.vendor || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate button */}
      <div className="text-center">
        <button
          onClick={onGenerate}
          disabled={isLoading}
          className="px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating Report...
            </span>
          ) : (
            "Generate Report"
          )}
        </button>
      </div>
    </div>
  );
}
