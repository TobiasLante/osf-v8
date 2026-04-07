"use client";

import React, { useRef, useCallback } from "react";
import type { ProcessStep } from "@p1/shared";

/**
 * 2D Block Flow Diagram style Process Map.
 * Layout: Upstream row → Downstream row → Support row
 * Each equipment is a card with icon, status color, and vendor info.
 * Inspired by Sartorius BFD PDFs but vendor-neutral and status-coded.
 */

interface Props {
  steps: ProcessStep[];
  title?: string;
  className?: string;
}

// ── Equipment Icon Mapping ──

const EQUIPMENT_IMAGES: Record<string, string> = {
  "shake flask": "/equipment/Shake_Flasks.png",
  "rocking motion 50": "/equipment/Rocking_Motion_50L.png",
  "rocking motion": "/equipment/Rocking_Motion_20L.png",
  "biostat rm": "/equipment/Rocking_Motion_20L.png",
  "bioreactor 2000": "/equipment/Single_Use_Bioreactor_2000L.png",
  "bioreactor 1000": "/equipment/Single_Use_Bioreactor_1000L.png",
  "bioreactor 500": "/equipment/Single_Use_Bioreactor_500L.png",
  "bioreactor 200": "/equipment/Single_Use_Bioreactor_200L.png",
  "bioreactor 50": "/equipment/Single_Use_Bioreactor_50L.png",
  "media prep": "/equipment/Media_Preparation.png",
  "buffer prep": "/equipment/Buffer_Preparation.png",
  "chromatography": "/equipment/Chromo_Resin_BE1.png",
  "chrom": "/equipment/Chromo_Resin_BE1.png",
  "cimmultus": "/equipment/Chromo_Resin_BE1.png",
  "resolute": "/equipment/Chromo_Resin_BE1.png",
  "dynachrom": "/equipment/Chromo_Resin_BE1.png",
  "virus filter": "/equipment/Virus_Filter_CPV.png",
  "uf/df": "/equipment/UF_DF_1.png",
  "tff": "/equipment/UF_DF_1.png",
  "sartoflow": "/equipment/UF_DF_1.png",
  "diafiltration": "/equipment/2_Stage_DF.png",
  "depth filter": "/equipment/Virus_Filter_HF.png",
  "filter train": "/equipment/Virus_Filter_HF.png",
  "filtration system": "/equipment/Virus_Filter_CPV.png",
  "final filtration": "/equipment/Virus_Filter_CPV.png",
  "sterile filtration": "/equipment/Virus_Filter_CPV.png",
  "freeze": "/equipment/Formulation_Bags.png",
  "celsius": "/equipment/Formulation_Bags.png",
  "cryomed": "/equipment/Formulation_Bags.png",
  "centrifuge": "/equipment/Centrifuge.png",
  "formulation": "/equipment/Formulation_Bags.png",
  "filling": "/equipment/Formulation_Bottles.png",
  "tube sealer": "/equipment/Formulation_Bottles.png",
  "tube welder": "/equipment/Formulation_Bottles.png",
  "integrity": "/equipment/Formulation_Bottles.png",
  "mixing": "/equipment/Buffer_Preparation.png",
  "harvest": "/equipment/Centrifuge.png",
  "lineariz": "/equipment/Shake_Flasks.png",
  "wave": "/equipment/Rocking_Motion_20L.png",
};

const SORTED_KEYS = Object.keys(EQUIPMENT_IMAGES).sort((a, b) => b.length - a.length);

function findImage(equipment: string): string {
  const lower = equipment.toLowerCase();
  for (const key of SORTED_KEYS) {
    if (lower.includes(key)) return EQUIPMENT_IMAGES[key];
  }
  return "/equipment/TBD.png";
}

// ── Status Colors ──

const STATUS_CONFIG: Record<string, { bg: string; border: string; label: string; glow: string }> = {
  WON:        { bg: "bg-emerald-500/15", border: "border-emerald-500/60", label: "Our Product", glow: "shadow-emerald-500/20" },
  OPEN:       { bg: "bg-amber-500/15",   border: "border-amber-500/60",   label: "Open",        glow: "shadow-amber-500/20" },
  COMPETITOR: { bg: "bg-red-500/15",     border: "border-red-500/60",     label: "Competitor",  glow: "shadow-red-500/20" },
  NO_CONTACT: { bg: "bg-slate-700/30",   border: "border-slate-600/40",   label: "Unknown",     glow: "" },
};

// ── Group steps into BFD sections ──

interface BfdSection {
  name: string;
  color: string;
  bgColor: string;
  steps: ProcessStep[];
}

function groupIntoBfdSections(steps: ProcessStep[]): BfdSection[] {
  const upstream: ProcessStep[] = [];
  const downstream: ProcessStep[] = [];
  const finishing: ProcessStep[] = [];
  const support: ProcessStep[] = [];

  for (const step of steps) {
    const op = step.step.toLowerCase();
    const eq = step.equipment.toLowerCase();

    if (op.includes("seed") || op.includes("cultivation") || op.includes("ferment") ||
        op.includes("fed batch") || op.includes("perfusion") || op.includes("harvest") ||
        eq.includes("shake") || eq.includes("rocking") || eq.includes("bioreactor") ||
        eq.includes("centrifuge") || eq.includes("depth filter")) {
      upstream.push(step);
    } else if (op.includes("chrom") || op.includes("uf") || op.includes("df") ||
               op.includes("tff") || op.includes("virus") || op.includes("polish") ||
               op.includes("capture") || op.includes("ivt") || op.includes("lysis") ||
               eq.includes("chrom") || eq.includes("tff") || eq.includes("sartoflow")) {
      downstream.push(step);
    } else if (op.includes("sterile") || op.includes("fill") || op.includes("freeze") ||
               op.includes("thaw") || eq.includes("filtration system") || eq.includes("celsius") ||
               eq.includes("cryomed") || eq.includes("freezer")) {
      finishing.push(step);
    } else {
      support.push(step);
    }
  }

  const sections: BfdSection[] = [];
  if (upstream.length)   sections.push({ name: "Upstream", color: "text-emerald-400", bgColor: "bg-emerald-500/5 border-emerald-500/20", steps: upstream });
  if (downstream.length) sections.push({ name: "Downstream", color: "text-cyan-400",  bgColor: "bg-cyan-500/5 border-cyan-500/20",    steps: downstream });
  if (finishing.length)  sections.push({ name: "Fill & Finish", color: "text-violet-400", bgColor: "bg-violet-500/5 border-violet-500/20", steps: finishing });
  if (support.length)    sections.push({ name: "Support", color: "text-slate-400",  bgColor: "bg-slate-500/5 border-slate-500/20",   steps: support });
  return sections;
}

// ── Equipment Card ──

function EquipmentCard({ step }: { step: ProcessStep }) {
  const status = (step.status || "NO_CONTACT") as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NO_CONTACT;

  return (
    <div className={`relative w-28 rounded-lg border-2 ${cfg.border} ${cfg.bg} p-2 text-center transition-all hover:scale-105 ${cfg.glow ? `shadow-md ${cfg.glow}` : ""}`}>
      <img
        src={findImage(step.equipment)}
        alt={step.equipment}
        className="w-14 h-14 mx-auto object-contain mb-1.5 opacity-80"
        onError={e => { (e.target as HTMLImageElement).src = "/equipment/TBD.png"; }}
      />
      <div className="text-[9px] font-bold text-p1-text leading-tight line-clamp-2" title={step.step}>
        {step.step}
      </div>
      <div className="text-[7px] text-p1-dim mt-0.5 truncate" title={step.equipment}>
        {step.equipment}
      </div>
      {/* Status badge */}
      <div className={`mt-1 text-[7px] font-bold uppercase tracking-wider ${
        status === "WON" ? "text-emerald-400" :
        status === "COMPETITOR" ? "text-red-400" :
        status === "OPEN" ? "text-amber-400" : "text-slate-500"
      }`}>
        {cfg.label}
      </div>
      {step.product && status === "WON" && (
        <div className="text-[7px] text-emerald-400/70 truncate">{step.product}</div>
      )}
    </div>
  );
}

// ── Arrow between cards ──

function Arrow() {
  return (
    <div className="flex items-center px-0.5 text-slate-600 shrink-0">
      <svg width="16" height="12" viewBox="0 0 16 12" className="opacity-40">
        <path d="M0 6h12M10 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

// ── Section Row ──

function SectionRow({ section }: { section: BfdSection }) {
  return (
    <div className={`rounded-lg border p-3 ${section.bgColor}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${section.color}`}>
        {section.name}
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto pb-1 scrollbar-thin">
        {section.steps.sort((a, b) => a.stepOrder - b.stepOrder).map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Arrow />}
            <EquipmentCard step={step} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Down Arrow between sections ──

function SectionArrow() {
  return (
    <div className="flex justify-center py-1">
      <svg width="12" height="20" viewBox="0 0 12 20" className="text-slate-600 opacity-40">
        <path d="M6 0v16M2 14l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

// ── Main Component ──

export function ProcessMapBfd({ steps, title, className = "" }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className={`rounded-lg border border-p1-border bg-p1-surface p-6 text-center ${className}`}>
        <p className="text-p1-dim text-sm">No process data available</p>
      </div>
    );
  }

  const sections = groupIntoBfdSections(steps);
  const modality = steps[0]?.category?.replace("_", " ") || "";

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          {title && <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</div>}
          {modality && <div className="text-[10px] text-p1-dim">Block Flow Diagram — {modality}</div>}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[9px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500/60" /> Our Product</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 border border-red-500/60" /> Competitor</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60" /> Open</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-700/40 border border-slate-600/40" /> Unknown</span>
        </div>
      </div>

      {/* BFD Sections: Upstream → Downstream → Fill & Finish → Support */}
      <div className="space-y-0">
        {sections.map((section, i) => (
          <React.Fragment key={section.name}>
            {i > 0 && <SectionArrow />}
            <SectionRow section={section} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
