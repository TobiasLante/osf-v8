"use client";

import { useState } from "react";
import { streamSSE, type SSEEvent } from "@/lib/api";

interface StepResult {
  step: number;
  agentId: string;
  label?: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  content: string;
  tools: Array<{ name: string; result?: string }>;
  reason?: string;
}

interface ChainRunnerProps {
  chainId: string;
  totalSteps: number;
}

export function ChainRunner({ chainId, totalSteps }: ChainRunnerProps) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  async function handleRun() {
    setRunning(true);
    setError("");
    setComplete(false);
    setSteps(Array.from({ length: totalSteps }, (_, i) => ({
      step: i + 1,
      agentId: "",
      status: "pending",
      content: "",
      tools: [],
    })));

    try {
      for await (const event of streamSSE(`/chains/run/${chainId}`, {})) {
        handleEvent(event);
      }
    } catch (err: any) {
      setError(err.message || "Chain execution failed");
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(event: SSEEvent) {
    switch (event.type) {
      case "step_start":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? { ...s, agentId: event.agentId, label: event.label, status: "running" }
            : s
        ));
        setExpandedStep(event.step - 1);
        break;

      case "step_skipped":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? { ...s, agentId: event.agentId, label: event.label, status: "skipped", reason: event.reason }
            : s
        ));
        break;

      case "tool_start":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? { ...s, tools: [...s.tools, { name: event.name }] }
            : s
        ));
        break;

      case "tool_result":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? {
                ...s,
                tools: s.tools.map((t, j) =>
                  j === s.tools.length - 1 ? { ...t, result: event.result } : t
                ),
              }
            : s
        ));
        break;

      case "step_content":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? { ...s, content: s.content + event.text }
            : s
        ));
        break;

      case "step_done":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1 ? { ...s, status: "done" } : s
        ));
        break;

      case "step_error":
        setSteps(prev => prev.map((s, i) =>
          i === event.step - 1
            ? { ...s, status: "error", reason: event.error }
            : s
        ));
        break;

      case "chain_complete":
        setComplete(true);
        break;

      case "error":
        setError(event.message || "Chain execution failed");
        break;
    }
  }

  const statusIcon = (s: StepResult["status"]) => {
    switch (s) {
      case "pending": return <span className="w-2 h-2 rounded-full bg-text-dim" />;
      case "running": return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />;
      case "done": return <span className="w-2 h-2 rounded-full bg-emerald-400" />;
      case "skipped": return <span className="w-2 h-2 rounded-full bg-text-dim opacity-50" />;
      case "error": return <span className="w-2 h-2 rounded-full bg-red-400" />;
    }
  };

  return (
    <div>
      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running}
        className="w-full py-3 rounded-sm bg-accent-gradient text-bg font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity mb-6"
      >
        {running ? "Running Chain..." : "Run Chain"}
      </button>

      {error && (
        <div className="p-3 mb-4 bg-red-900/30 border border-red-700 rounded-sm text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Step results */}
      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`border rounded-lg overflow-hidden transition-colors ${
                step.status === "running"
                  ? "border-accent/40 bg-accent/5"
                  : step.status === "done"
                  ? "border-emerald-500/20 bg-bg-surface"
                  : step.status === "skipped"
                  ? "border-border bg-bg-surface opacity-60"
                  : step.status === "error"
                  ? "border-red-500/20 bg-red-900/10"
                  : "border-border bg-bg-surface"
              }`}
            >
              {/* Step header */}
              <button
                onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {statusIcon(step.status)}
                <span className="text-sm font-semibold text-text">
                  Step {step.step}: {step.label || step.agentId || `Step ${step.step}`}
                </span>
                {step.status === "skipped" && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-text-dim/10 text-text-dim ml-auto">
                    Skipped — {step.reason}
                  </span>
                )}
                {step.status === "done" && step.tools.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ml-auto">
                    {step.tools.length} tool calls
                  </span>
                )}
                {step.status === "running" && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 ml-auto animate-pulse">
                    Running...
                  </span>
                )}
              </button>

              {/* Expanded content */}
              {expandedStep === i && (step.content || step.tools.length > 0 || step.reason) && (
                <div className="px-4 pb-4 border-t border-border">
                  {/* Tool calls */}
                  {step.tools.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {step.tools.map((tool, j) => (
                        <div key={j} className="flex items-center gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                          <span className="font-mono text-text-dim">{tool.name.replace("factory_", "")}</span>
                          {tool.result && (
                            <span className="text-emerald-400">done</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Content */}
                  {step.content && (
                    <div className="mt-3 text-sm text-text-muted leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {step.content}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completion */}
      {complete && (
        <div className="mt-4 p-4 border border-emerald-500/20 bg-emerald-900/10 rounded-lg text-center">
          <p className="text-emerald-400 font-semibold">Chain Complete</p>
          <p className="text-xs text-text-dim mt-1">
            {steps.filter(s => s.status === "done").length} steps executed,{" "}
            {steps.filter(s => s.status === "skipped").length} skipped
          </p>
        </div>
      )}
    </div>
  );
}
