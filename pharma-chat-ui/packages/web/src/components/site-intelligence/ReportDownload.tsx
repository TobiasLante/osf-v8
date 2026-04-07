"use client";

import React, { useState } from "react";
import type { ProcessStep } from "@p1/shared";
import { ProcessMap } from "../ProcessMap";

interface Props {
  reportBlob: Blob | null;
  accountName: string;
  steps: ProcessStep[];
  onRestart: () => void;
}

export function ReportDownload({ reportBlob, accountName, steps, onRestart }: Props) {
  const [showMap, setShowMap] = useState(false);

  const handleDownload = () => {
    if (!reportBlob) return;
    const url = URL.createObjectURL(reportBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `P1st_${accountName.replace(/\s+/g, "_")}_Intelligence_Report.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <span className="text-3xl text-emerald-400">✓</span>
        </div>
        <h2 className="text-2xl font-bold">Report Generated</h2>
        <p className="text-p1-dim text-sm mt-1">
          {accountName} — {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Download buttons */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={handleDownload}
          disabled={!reportBlob}
          className="px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40"
        >
          Download DOCX
        </button>
        <button
          onClick={() => setShowMap(!showMap)}
          className="px-6 py-3 rounded-lg border border-cyan-500/30 text-cyan-400 font-semibold text-sm hover:bg-cyan-500/10"
        >
          {showMap ? "Hide Treasure Map" : "View Interactive Treasure Map"}
        </button>
      </div>

      {/* Interactive Treasure Map */}
      {showMap && steps.length > 0 && (
        <div className="rounded-lg border border-p1-border bg-p1-surface p-4">
          <ProcessMap
            steps={steps}
            title="Process Treasure Map — Interactive View"
          />
        </div>
      )}

      {/* Report stats */}
      {reportBlob && (
        <div className="text-center text-xs text-p1-dim">
          Report size: {(reportBlob.size / 1024).toFixed(0)} KB
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
