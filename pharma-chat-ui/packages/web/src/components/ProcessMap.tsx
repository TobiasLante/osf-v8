"use client";

import React, { useRef, useCallback } from "react";
import type { ProcessStep } from "@p1/shared";

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
  "wave": "/equipment/Rocking_Motion_20L.png",
  "stirred tank": "/equipment/Single_Use_Bioreactor_200L.png",
  "harvest": "/equipment/Centrifuge.png",
  "tangential flow": "/equipment/UF_DF_1.png",
  "affinity": "/equipment/Chromo_Resin_BE1.png",
  "ion exchange": "/equipment/Chromo_Resin_BE1.png",
  "mixed mode": "/equipment/Chromo_Resin_BE1.png",
  "hydrophobic interaction": "/equipment/Chromo_Resin_BE1.png",
  "size exclusion": "/equipment/Chromo_Resin_BE1.png",
  "nanofiltration": "/equipment/Virus_Filter_CPV.png",
  "cell lysis": "/equipment/Centrifuge.png",
  "homogenizer": "/equipment/Centrifuge.png",
  "lyophilization": "/equipment/Formulation_Bags.png",
  "freeze thaw": "/equipment/Formulation_Bags.png",
  "bag": "/equipment/Formulation_Bags.png",
  "mixing": "/equipment/Buffer_Preparation.png",
  "incubation": "/equipment/Shake_Flasks.png",
  "transfection": "/equipment/Shake_Flasks.png",
  "chrom system": "/equipment/Chromo_Resin_BE1.png",
  "chrom": "/equipment/Chromo_Resin_BE1.png",
  "cimmultus": "/equipment/Chromo_Resin_BE1.png",
  "sartobind": "/equipment/Chromo_Resin_BE1.png",
  "tube sealer": "/equipment/Formulation_Bottles.png",
  "tube welder": "/equipment/Formulation_Bottles.png",
  "biowelder": "/equipment/Formulation_Bottles.png",
  "clarification filter": "/equipment/Virus_Filter_HF.png",
  "sartopure": "/equipment/Virus_Filter_HF.png",
};

const SORTED_EQUIPMENT_KEYS = Object.keys(EQUIPMENT_IMAGES).sort((a, b) => b.length - a.length);

function findEquipmentImage(equipment: string): string {
  const lower = equipment.toLowerCase();
  for (const key of SORTED_EQUIPMENT_KEYS) {
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

  const mapRef = useRef<HTMLDivElement>(null);
  const modality = steps[0]?.category || "";
  const bfdUrl = modality ? `/bfd/${modality}.pdf` : null;
  const processName = steps[0]?.process || modality.replace(/_/g, " ");

  const handleExportPdf = useCallback(async () => {
    const { toPng } = await import("html-to-image");
    const { default: jsPDF } = await import("jspdf");

    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);

    // Build a temporary light-themed, multi-row render element
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:0;background:#fff;padding:24px;width:1100px;font-family:system-ui,sans-serif;";

    // Header
    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:22px;font-weight:700;color:#0891b2;">Process1st</div>
        <div style="font-size:14px;color:#334155;margin-top:2px;">${processName} — Process Map</div>
      </div>
    `;

    // Steps in a wrapping grid (4-5 per row for readability)
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;";

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      const imgSrc = findEquipmentImage(step.equipment);

      // Arrow between steps (not before first, not at row start)
      if (i > 0) {
        const arrow = document.createElement("div");
        arrow.style.cssText = "display:flex;align-items:center;padding-top:32px;color:#94a3b8;font-size:20px;";
        arrow.textContent = "\u2192";
        grid.appendChild(arrow);
      }

      const statusColors: Record<string, string> = {
        WON: "#10b981", OPEN: "#f59e0b", COMPETITOR: "#ef4444", NO_CONTACT: "#94a3b8",
      };
      const borderColor = statusColors[step.status || ""] || "#e2e8f0";

      const card = document.createElement("div");
      card.style.cssText = `flex-shrink:0;width:130px;border:2px solid ${borderColor};border-radius:8px;padding:10px;text-align:center;background:#f8fafc;`;
      card.innerHTML = `
        <img src="${imgSrc}" style="width:64px;height:64px;margin:0 auto 6px;display:block;object-fit:contain;" onerror="this.src='/equipment/TBD.png'" />
        <div style="font-size:10px;font-weight:600;color:#1e293b;line-height:1.3;min-height:26px;">${step.step}</div>
        <div style="font-size:8px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${step.equipment}</div>
        ${step.status ? `<div style="margin-top:4px;font-size:8px;font-weight:600;color:${borderColor};text-transform:uppercase;">${step.status.replace("_", " ")}</div>` : ""}
        ${step.vendor ? `<div style="font-size:7px;color:#0891b2;margin-top:2px;">${step.vendor}</div>` : ""}
      `;
      grid.appendChild(card);
    }
    container.appendChild(grid);

    // Status legend
    const stats: Record<string, number> = {};
    for (const s of steps) { if (s.status) stats[s.status] = (stats[s.status] || 0) + 1; }
    if (Object.keys(stats).length > 0) {
      const legend = document.createElement("div");
      legend.style.cssText = "margin-top:16px;font-size:9px;color:#64748b;";
      legend.textContent = Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join("    ");
      container.appendChild(legend);
    }

    // Footer
    const footer = document.createElement("div");
    footer.style.cssText = "margin-top:20px;font-size:8px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px;";
    footer.textContent = `Generated ${new Date().toLocaleDateString()} — Process1st Sales Intelligence — CONFIDENTIAL`;
    container.appendChild(footer);

    document.body.appendChild(container);

    // Wait for images to load
    const imgs = container.querySelectorAll("img");
    await Promise.all(Array.from(imgs).map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ));

    const dataUrl = await toPng(container, { backgroundColor: "#ffffff", pixelRatio: 2 });
    document.body.removeChild(container);

    const img = new Image();
    img.src = dataUrl;
    await new Promise(r => { img.onload = r; });

    // Landscape A4, scale to fit width, multi-page if needed
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const availW = pageW - margin * 2;

    const scale = availW / img.width;
    const imgW = availW;
    const imgH = img.height * scale;

    if (imgH <= pageH - margin * 2) {
      // Fits on one page
      pdf.addImage(dataUrl, "PNG", margin, margin, imgW, imgH);
    } else {
      // Multi-page: slice the image
      const pageContentH = pageH - margin * 2;
      const srcSliceH = pageContentH / scale;
      let yOffset = 0;
      let page = 0;
      while (yOffset < img.height) {
        if (page > 0) pdf.addPage();
        const canvas = document.createElement("canvas");
        const sliceH = Math.min(srcSliceH, img.height - yOffset);
        canvas.width = img.width;
        canvas.height = sliceH;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, yOffset, img.width, sliceH, 0, 0, img.width, sliceH);
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, imgW, sliceH * scale);
        yOffset += sliceH;
        page++;
      }
    }

    pdf.save(`Process1st_${modality || "ProcessMap"}.pdf`);
  }, [steps, modality, processName]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        {title && <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</div>}
        <div className="flex items-center gap-2">
          {bfdUrl && (
            <a href={bfdUrl} target="_blank" rel="noopener noreferrer"
               className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 rounded px-2 py-1 hover:border-cyan-400/50 transition-colors">
              Reference BFD
            </a>
          )}
          <button onClick={handleExportPdf}
                  className="text-[10px] font-medium text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded px-2 py-1 hover:border-emerald-400/50 transition-colors">
            Export PDF
          </button>
        </div>
      </div>
      <div ref={mapRef} className="flex items-start gap-1.5 overflow-x-auto pb-3 scrollbar-thin">
        {[...steps].sort((a, b) => a.stepOrder - b.stepOrder).map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="flex items-center px-1 pt-8 text-slate-600 text-lg shrink-0">&rarr;</div>}
            <div className={`shrink-0 w-36 rounded-lg border p-2.5 text-center transition-all ${statusBorderColor(step.status)}`}>
              <img
                src={findEquipmentImage(step.equipment)}
                alt={`${step.step} — ${step.equipment}`}
                className="w-20 h-20 mx-auto object-contain mb-2 opacity-80"
                onError={e => { (e.target as HTMLImageElement).src = '/equipment/TBD.png'; }}
              />
              <div className="text-[11px] font-semibold text-slate-200 leading-tight line-clamp-2" title={step.step}>
                {step.step}
              </div>
              <div className="text-[9px] text-slate-500 truncate mt-0.5" title={step.equipment}>
                {step.equipment}
              </div>
              {step.status && <StatusBadge status={step.status} />}
              {step.vendor && <div className="text-[8px] text-cyan-400/60 mt-0.5 truncate">{step.vendor}</div>}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
