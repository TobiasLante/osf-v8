"use client";

import React from "react";
import type { ProcessStep, EquipmentStatusValue } from "@p1/shared";
import { ProcessMapBfd } from "../ProcessMapBfd";

interface Props {
  steps: ProcessStep[];
  vendorMapTab: string;
  vendor: string;
  onStatusChange: (stepIndex: number, status: EquipmentStatusValue) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

const STATUS_OPTIONS: { value: EquipmentStatusValue; label: string; icon: string }[] = [
  { value: "WON", label: "Our Product", icon: "✓" },
  { value: "OPEN", label: "Open Opportunity", icon: "●" },
  { value: "COMPETITOR", label: "Competitor", icon: "✕" },
  { value: "NO_CONTACT", label: "Unknown", icon: "◆" },
];

const STATUS_STYLES: Record<EquipmentStatusValue, { bg: string; text: string; border: string }> = {
  WON:        { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-l-emerald-500" },
  OPEN:       { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-l-amber-500" },
  COMPETITOR: { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-l-red-500" },
  NO_CONTACT: { bg: "bg-slate-500/5",    text: "text-slate-500",   border: "border-l-slate-600" },
};

export function EquipmentReview({ steps, vendorMapTab, vendor, onStatusChange, onGenerate, isLoading }: Props) {
  const counts: Record<EquipmentStatusValue, number> = { WON: 0, OPEN: 0, COMPETITOR: 0, NO_CONTACT: 0 };
  for (const s of steps) counts[(s.status || "NO_CONTACT") as EquipmentStatusValue]++;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-xl font-bold">Process Equipment — {vendorMapTab}</h2>
        <p className="text-p1-dim text-sm mt-1">{vendor} perspective</p>
      </div>

      {/* Summary bar — Justin style */}
      <div className="flex items-center justify-center gap-6 py-3 rounded-lg bg-p1-surface border border-p1-border">
        <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-400">
          <span className="text-base">✓</span> Our Product: {counts.WON}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-bold text-red-400">
          <span className="text-base">✕</span> Competitor: {counts.COMPETITOR}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-bold text-amber-400">
          <span className="text-base">●</span> Open: {counts.OPEN}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-400">
          <span className="text-base">◆</span> Unknown: {counts.NO_CONTACT}
        </span>
      </div>

      {/* 2D Process Map — BFD style */}
      <div className="rounded-lg border border-p1-border bg-p1-surface p-4">
        <ProcessMapBfd steps={steps} title="Process Treasure Map" />
      </div>

      {/* Equipment table — 3 columns, Justin style */}
      <div className="rounded-lg border border-p1-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cyan-500/10">
              <th className="text-left px-4 py-2.5 text-xs font-bold text-cyan-400 uppercase tracking-wider w-[35%]">Unit Operation</th>
              <th className="text-left px-4 py-2.5 text-xs font-bold text-cyan-400 uppercase tracking-wider w-[30%]">Our Product ({vendor})</th>
              <th className="text-left px-4 py-2.5 text-xs font-bold text-cyan-400 uppercase tracking-wider w-[35%]">Status / Competitor</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => {
              const status = (step.status || "NO_CONTACT") as EquipmentStatusValue;
              const style = STATUS_STYLES[status];
              const statusOpt = STATUS_OPTIONS.find(o => o.value === status);

              return (
                <tr key={i} className={`border-t border-p1-border/30 border-l-4 ${style.border} ${style.bg}`}>
                  {/* Column 1: Unit Operation + Equipment */}
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-p1-text">{step.step}</div>
                    <div className="text-xs text-p1-dim mt-0.5">{step.equipment}</div>
                  </td>

                  {/* Column 2: Our Product */}
                  <td className="px-4 py-2.5">
                    <span className={`text-sm ${status === "WON" ? "font-bold text-emerald-400" : "text-p1-text"}`}>
                      {step.product || "—"}
                    </span>
                  </td>

                  {/* Column 3: Status dropdown + Competitor name */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <select
                        value={status}
                        onChange={(e) => onStatusChange(i, e.target.value as EquipmentStatusValue)}
                        className={`text-xs font-semibold px-2 py-1 rounded border border-p1-border bg-p1-bg ${style.text} focus:outline-none focus:ring-1 focus:ring-cyan-500/40`}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                        ))}
                      </select>
                    </div>
                    {step.vendor && step.vendor !== "—" && (
                      <div className="text-xs text-p1-dim mt-1 truncate" title={step.vendor}>
                        {step.vendor}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
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
