"use client";

import { useState } from "react";

interface ToolCallCardProps {
  name: string;
  arguments?: Record<string, any>;
  result?: string;
  status: "running" | "done" | "error";
}

function formatToolName(name: string): string {
  return (name || "")
    .replace(/^factory_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolCallCard({ name, arguments: args, result, status }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  let parsedResult: any = null;
  if (result) {
    try { parsedResult = JSON.parse(result); } catch { parsedResult = result; }
  }

  const statusColors = {
    running: "bg-yellow-400/20 text-yellow-400",
    done: "bg-emerald-400/20 text-emerald-400",
    error: "bg-red-400/20 text-red-400",
  };

  const dotColors = {
    running: "bg-yellow-400 animate-pulse",
    done: "bg-emerald-400",
    error: "bg-red-400",
  };

  return (
    <div className="border border-border rounded-sm overflow-hidden bg-bg-surface-2">
      <button
        onClick={() => result && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-surface-3 transition-colors"
      >
        <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${dotColors[status]}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusColors[status]}`}>
          {status === "running" ? "Running" : status === "error" ? "Error" : "Done"}
        </span>
        <code className="text-xs font-mono text-accent truncate">{formatToolName(name)}</code>
        {args && Object.keys(args).length > 0 && (
          <span className="text-[11px] text-text-dim truncate">
            ({Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(", ")})
          </span>
        )}
        {result && (
          <svg
            className={`w-3 h-3 ml-auto text-text-dim transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {expanded && result && (
        <div className="border-t border-border bg-bg max-h-[300px] overflow-auto">
          <pre className="p-2.5 text-[11px] text-text-dim font-mono whitespace-pre-wrap break-words leading-relaxed">
            {typeof parsedResult === "object"
              ? JSON.stringify(parsedResult, null, 2)
              : String(parsedResult)}
          </pre>
        </div>
      )}
    </div>
  );
}
