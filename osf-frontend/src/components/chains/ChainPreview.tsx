"use client";

import type { ChainStepData } from "./StepCard";
import type { Agent } from "@/lib/agents-data";

interface ChainPreviewProps {
  steps: ChainStepData[];
  agents: Agent[];
}

export function ChainPreview({ steps, agents }: ChainPreviewProps) {
  if (steps.length === 0) {
    return (
      <div className="p-8 border border-dashed border-border rounded-lg text-center text-text-dim text-sm">
        Add steps to see a preview of your chain
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-0">
      {steps.map((step, i) => {
        const agent = agents.find(a => a.id === step.agentId);
        const label = step.label || agent?.name || step.agentId;
        const isConditional = step.condition && step.condition !== "always";

        return (
          <div key={i} className="flex flex-col items-center">
            {/* Arrow from previous */}
            {i > 0 && (
              <div className="flex flex-col items-center">
                <div className="w-px h-4 bg-border" />
                {isConditional && (
                  <span className="text-[10px] px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 mb-1">
                    if {step.condition?.replace(/_/g, " ")}
                  </span>
                )}
                <svg className="w-3 h-3 text-text-dim" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M6 9L2 5h8L6 9z" />
                </svg>
              </div>
            )}

            {/* Step box */}
            <div className="flex items-center gap-3 px-5 py-3 rounded-lg border border-border bg-bg-surface-2 min-w-[200px]">
              <span className="text-xl">{agent?.icon || "🔗"}</span>
              <div>
                <p className="text-sm font-semibold text-text">{label}</p>
                <p className="text-[10px] text-text-dim">{agent?.type || "agent"}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
