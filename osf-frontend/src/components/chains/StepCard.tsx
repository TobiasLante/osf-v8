"use client";

import type { Agent } from "@/lib/agents-data";

export interface ChainStepData {
  agentId: string;
  label: string;
  condition: string;
  passContext: boolean;
}

const CONDITIONS = [
  { value: "always", label: "Always run", description: "This step always executes" },
  { value: "oee_below_85", label: "OEE < 85%", description: "Only if any machine OEE is below 85%" },
  { value: "has_alarms", label: "Has SPC Alarms", description: "Only if active SPC alarms exist" },
  { value: "orders_at_risk", label: "Orders at Risk", description: "Only if delivery deadlines are threatened" },
  { value: "low_stock", label: "Low Stock", description: "Only if material shortages detected" },
  { value: "previous_found_issues", label: "Previous Found Issues", description: "Only if the previous agent reported problems" },
];

export { CONDITIONS };

interface StepCardProps {
  step: ChainStepData;
  index: number;
  agents: Agent[];
  onChange: (index: number, step: ChainStepData) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

export function StepCard({ step, index, agents, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }: StepCardProps) {
  const selectedAgent = agents.find(a => a.id === step.agentId);

  return (
    <div className="relative p-4 rounded-lg border border-border bg-bg-surface-2 group">
      {/* Step number */}
      <div className="absolute -left-3 top-4 w-6 h-6 rounded-full bg-accent text-bg text-xs font-bold grid place-items-center">
        {index + 1}
      </div>

      <div className="ml-4 space-y-3">
        {/* Agent selector + label */}
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <div>
            <label className="block text-xs text-text-dim mb-1">Agent</label>
            <select
              value={step.agentId}
              onChange={(e) => {
                const agent = agents.find(a => a.id === e.target.value);
                onChange(index, {
                  ...step,
                  agentId: e.target.value,
                  label: step.label || agent?.name || "",
                });
              }}
              className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="">Select agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Label</label>
            <input
              type="text"
              value={step.label}
              onChange={(e) => onChange(index, { ...step, label: e.target.value })}
              placeholder={selectedAgent?.name || "Step label"}
              maxLength={100}
              className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm text-sm text-text placeholder-text-dim focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Condition */}
        <div>
          <label className="block text-xs text-text-dim mb-1">Condition</label>
          <select
            value={step.condition}
            onChange={(e) => onChange(index, { ...step, condition: e.target.value })}
            className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm text-sm text-text focus:border-accent focus:outline-none"
          >
            {CONDITIONS.map(c => (
              <option key={c.value} value={c.value}>
                {c.label} — {c.description}
              </option>
            ))}
          </select>
        </div>

        {/* Agent info */}
        {selectedAgent && (
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <span className="text-lg">{selectedAgent.icon}</span>
            <span>{selectedAgent.description}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onMoveUp(index)}
              disabled={isFirst}
              className="px-2 py-1 text-xs text-text-dim hover:text-accent disabled:opacity-30 transition-colors"
            >
              ↑ Up
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(index)}
              disabled={isLast}
              className="px-2 py-1 text-xs text-text-dim hover:text-accent disabled:opacity-30 transition-colors"
            >
              ↓ Down
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
