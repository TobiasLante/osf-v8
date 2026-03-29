"use client";

import React from "react";

export interface ProcessStep {
  step: string;
  equipment: string;
  stepOrder: number;
  status?: "WON" | "OPEN" | "COMPETITOR" | "NO_CONTACT";
  vendor?: string;
  product?: string;
}

interface Props {
  steps: ProcessStep[];
  title?: string;
  className?: string;
}

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
  "biostat str 2000": "/equipment/Single_Use_Bioreactor_2000L.png",
  "biostat str 1000": "/equipment/Single_Use_Bioreactor_1000L.png",
  "biostat str 500": "/equipment/Single_Use_Bioreactor_500L.png",
  "biostat str 200": "/equipment/Single_Use_Bioreactor_200L.png",
  "biostat str 50": "/equipment/Single_Use_Bioreactor_50L.png",
  "biostat str": "/equipment/Single_Use_Bioreactor_200L.png",
  "media prep": "/equipment/Media_Preparation.png",
  "buffer prep": "/equipment/Buffer_Preparation.png",
  "chromatography": "/equipment/Chromo_Resin_BE1.png",
  "resolute": "/equipment/Chromo_Resin_BE1.png",
  "virus filter": "/equipment/Virus_Filter_CPV.png",
  "virus filtration": "/equipment/Virus_Filter_HF.png",
  "uf/df": "/equipment/UF_DF_1.png",
  "tff": "/equipment/UF_DF_1.png",
  "sartoflow": "/equipment/UF_DF_1.png",
  "diafiltration": "/equipment/2_Stage_DF.png",
  "centrifuge": "/equipment/Centrifuge.png",
  "formulation": "/equipment/Formulation_Bags.png",
  "filling": "/equipment/Formulation_Bottles.png",
  "viral inactivation": "/equipment/VI_OneTank.png",
  "low ph": "/equipment/VI_OneTank.png",
  "neutralization": "/equipment/VI_OneTank.png",
  "freeze": "/equipment/Formulation_Bags.png",
  "celsius": "/equipment/Formulation_Bags.png",
  "depth filter": "/equipment/Virus_Filter_HF.png",
  "sartopore": "/equipment/Virus_Filter_HF.png",
  "filter train": "/equipment/Virus_Filter_HF.png",
  "filtration system": "/equipment/Virus_Filter_CPV.png",
  "final filtration": "/equipment/Virus_Filter_CPV.png",
  "sterile filtration": "/equipment/Virus_Filter_CPV.png",
  "biosealer": "/equipment/Formulation_Bottles.png",
  "simca": "/equipment/Formulation_Bottles.png",
  "lineariz": "/equipment/Shake_Flasks.png",
  "plasmid": "/equipment/Shake_Flasks.png",
  "microbial bioreactor": "/equipment/Single_Use_Bioreactor_50L.png",
};

function findEquipmentImage(equipment: string): string {
  const lower = equipment.toLowerCase();
  const sortedKeys = Object.keys(EQUIPMENT_IMAGES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) return EQUIPMENT_IMAGES[key];
  }
  return "/equipment/TBD.png";
}

function statusBorderColor(status?: string): string {
  switch (status) {
    case "WON":
      return "border-emerald-500/40 bg-emerald-500/5";
    case "OPEN":
      return "border-amber-500/40 bg-amber-500/5";
    case "COMPETITOR":
      return "border-red-500/40 bg-red-500/5";
    case "NO_CONTACT":
      return "border-slate-600/40";
    default:
      return "border-slate-700/40";
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    WON: "bg-emerald-500/20 text-emerald-400",
    OPEN: "bg-amber-500/20 text-amber-400",
    COMPETITOR: "bg-red-500/20 text-red-400",
    NO_CONTACT: "bg-slate-600/20 text-slate-400",
  };
  return (
    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-[6px] font-semibold uppercase tracking-wide ${colors[status] ?? "bg-slate-700 text-slate-400"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function ProcessMap({ steps, title, className = "" }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className={`rounded-lg border border-p1-border bg-p1-surface p-6 text-center ${className}`}>
        <p className="text-p1-dim text-sm mb-1">Process Map</p>
        <p className="text-p1-dim text-xs">Ask the chat about a process template to see the visualization here.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {title && <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</div>}
      <div className="flex items-start gap-1 overflow-x-auto pb-3 scrollbar-thin">
        {[...steps].sort((a, b) => a.stepOrder - b.stepOrder).map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="flex items-center px-1 pt-6 text-slate-600 text-lg shrink-0">&rarr;</div>}
            <div className={`shrink-0 w-28 rounded-lg border p-2 text-center transition-all ${statusBorderColor(step.status)}`}>
              <img
                src={findEquipmentImage(step.equipment)}
                alt={step.equipment}
                className="w-16 h-16 mx-auto object-contain mb-1.5 opacity-80"
              />
              <div className="text-[10px] font-semibold text-slate-200 leading-tight truncate" title={step.step}>
                {step.step}
              </div>
              <div className="text-[8px] text-slate-500 truncate mt-0.5" title={step.equipment}>
                {step.equipment}
              </div>
              {step.status && <StatusBadge status={step.status} />}
              {step.vendor && <div className="text-[7px] text-cyan-400/60 mt-0.5 truncate">{step.vendor}</div>}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
