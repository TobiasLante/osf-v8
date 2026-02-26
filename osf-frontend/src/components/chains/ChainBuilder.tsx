"use client";

import { StepCard, type ChainStepData } from "./StepCard";
import { ChainPreview } from "./ChainPreview";
import type { Agent } from "@/lib/agents-data";

interface ChainBuilderProps {
  steps: ChainStepData[];
  setSteps: (steps: ChainStepData[]) => void;
  agents: Agent[];
}

export function ChainBuilder({ steps, setSteps, agents }: ChainBuilderProps) {
  function addStep() {
    setSteps([
      ...steps,
      { agentId: "", label: "", condition: "always", passContext: true },
    ]);
  }

  function updateStep(index: number, step: ChainStepData) {
    const next = [...steps];
    next[index] = step;
    setSteps(next);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...steps];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setSteps(next);
  }

  function moveDown(index: number) {
    if (index === steps.length - 1) return;
    const next = [...steps];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setSteps(next);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
      {/* Steps editor */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-muted">
            Steps ({steps.length})
          </h3>
          <button
            type="button"
            onClick={addStep}
            className="px-4 py-2 text-sm font-medium rounded-sm border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
          >
            + Add Step
          </button>
        </div>

        {steps.length === 0 && (
          <div className="p-8 border border-dashed border-border rounded-lg text-center">
            <p className="text-text-dim mb-2">No steps yet</p>
            <p className="text-xs text-text-dim">Add at least 2 agents to create a chain</p>
          </div>
        )}

        <div className="space-y-3 pl-3">
          {steps.map((step, i) => (
            <StepCard
              key={i}
              step={step}
              index={i}
              agents={agents}
              onChange={updateStep}
              onRemove={removeStep}
              onMoveUp={moveUp}
              onMoveDown={moveDown}
              isFirst={i === 0}
              isLast={i === steps.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-24">
        <h3 className="text-sm font-semibold text-text-muted mb-3">Preview</h3>
        <ChainPreview steps={steps} agents={agents} />
      </div>
    </div>
  );
}
