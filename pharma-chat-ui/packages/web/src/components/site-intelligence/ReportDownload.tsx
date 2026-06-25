"use client";

import React, { useState } from "react";
import type { ProcessStep } from "@p1/shared";
import { ProcessMapBfd } from "../ProcessMapBfd";

interface ReportFile {
  filename: string;
  base64: string;
  size: number;
}

interface Props {
  reportData: { detailed: ReportFile; brief: ReportFile } | null;
  reportBlob: Blob | null; // legacy single-file fallback
  accountName: string;
  steps: ProcessStep[];
  onRestart: () => void;
}

export function ReportDownload({ reportData, reportBlob, accountName, steps, onRestart }: Props) {
  const [showMap, setShowMap] = useState(false);

  const downloadBase64 = (file: ReportFile) => {
    const bytes = atob(file.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLegacyDownload = () => {
    if (!reportBlob) return;
    const url = URL.createObjectURL(reportBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `P1st_${accountName.replace(/\s+/g, "_")}_Intelligence_Report.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasBothReports = reportData?.detailed && reportData?.brief;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <span className="text-3xl text-emerald-400">✓</span>
        </div>
        <h2 className="text-2xl font-bold">
          {hasBothReports ? "2 Reports Generated" : "Report Generated"}
        </h2>
        <p className="text-p1-dim text-sm mt-1">
          {accountName} — {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Download buttons */}
      {hasBothReports ? (
        <div className="space-y-3">
          {/* Detailed Report */}
          <button
            onClick={() => downloadBase64(reportData!.detailed)}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-lg border border-p1-border bg-p1-surface hover:border-cyan-500/40 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-400 text-lg">📄</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-p1-text text-sm">Detailed Intelligence Report</div>
              <div className="text-xs text-p1-dim mt-0.5">
                Full analysis — Site Profile, Equipment Map, Strategy, Competitors, Checklist
              </div>
            </div>
            <div className="text-xs text-p1-dim flex-shrink-0">
              {(reportData!.detailed.size / 1024).toFixed(0)} KB
            </div>
          </button>

          {/* Sales Brief */}
          <button
            onClick={() => downloadBase64(reportData!.brief)}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-lg border border-p1-border bg-p1-surface hover:border-orange-500/40 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
              <span className="text-orange-400 text-lg">📋</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-p1-text text-sm">PreMeeting Sales Brief</div>
              <div className="text-xs text-p1-dim mt-0.5">
                1-page summary — Account Snapshot, Leads, Talking Points, Competitors
              </div>
            </div>
            <div className="text-xs text-p1-dim flex-shrink-0">
              {(reportData!.brief.size / 1024).toFixed(0)} KB
            </div>
          </button>

          {/* Download both */}
          <div className="flex justify-center pt-1">
            <button
              onClick={() => {
                downloadBase64(reportData!.detailed);
                setTimeout(() => downloadBase64(reportData!.brief), 500);
              }}
              className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90"
            >
              Download Both
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleLegacyDownload}
            disabled={!reportBlob}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40"
          >
            Download DOCX
          </button>
        </div>
      )}

      {/* Interactive Treasure Map toggle */}
      <div className="flex justify-center">
        <button
          onClick={() => setShowMap(!showMap)}
          className="px-6 py-2.5 rounded-lg border border-cyan-500/30 text-cyan-400 font-semibold text-sm hover:bg-cyan-500/10"
        >
          {showMap ? "Hide Treasure Map" : "View Interactive Treasure Map"}
        </button>
      </div>

      {showMap && steps.length > 0 && (
        <div className="rounded-lg border border-p1-border bg-p1-surface p-4">
          <ProcessMapBfd
            steps={steps}
            title="Process Treasure Map — Interactive View"
          />
        </div>
      )}

      {/* Start new */}
      <div className="text-center pt-4 border-t border-p1-border">
        <button
          onClick={onRestart}
          className="text-p1-muted hover:text-p1-text text-sm transition-colors"
        >
          Start New Analysis
        </button>
      </div>
    </div>
  );
}
