"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { ChainBuilder } from "@/components/chains/ChainBuilder";
import type { ChainStepData } from "@/components/chains/StepCard";
import type { Agent } from "@/lib/agents-data";

interface ApiAgent {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  tools: string[];
  difficulty: string;
  icon: string;
}

const TEMPLATES: Record<string, { name: string; description: string; steps: ChainStepData[]; category: string; difficulty: string; icon: string }> = {
  blank: { name: "", description: "", steps: [], category: "General", difficulty: "Intermediate", icon: "🔗" },
  health: {
    name: "Factory Health Check",
    description: "Complete factory health check: OEE, quality, and capacity.",
    steps: [
      { agentId: "oee-monitor", label: "Check OEE", condition: "always", passContext: true },
      { agentId: "quality-guard", label: "Quality Check", condition: "previous_found_issues", passContext: true },
      { agentId: "capacity-agent", label: "Optimize Capacity", condition: "always", passContext: true },
    ],
    category: "Production",
    difficulty: "Beginner",
    icon: "🏭",
  },
  delivery: {
    name: "Delivery Risk Pipeline",
    description: "Detect and resolve delivery risks end-to-end.",
    steps: [
      { agentId: "deadline-agent", label: "Check Deadlines", condition: "always", passContext: true },
      { agentId: "material-agent", label: "Verify Materials", condition: "orders_at_risk", passContext: true },
      { agentId: "capacity-agent", label: "Capacity Fix", condition: "previous_found_issues", passContext: true },
    ],
    category: "Delivery",
    difficulty: "Intermediate",
    icon: "🚚",
  },
};

export default function CreateChainPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<ChainStepData[]>([]);
  const [category, setCategory] = useState("General");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [icon, setIcon] = useState("🔗");
  const [openSource, setOpenSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    apiFetch<{ agents: ApiAgent[] }>("/agents")
      .then(({ agents }) => {
        setAgents(agents.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type as Agent["type"],
          category: a.category,
          description: a.description,
          longDescription: a.description,
          tools: a.tools || [],
          difficulty: a.difficulty as Agent["difficulty"],
          icon: a.icon || "🤖",
          featured: false,
        })));
      })
      .catch(() => {});
  }, []);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-text-dim">Loading...</div>;
  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-text-dim">Log in to create chains</p>
      <a href="/login" className="px-6 py-2 bg-accent text-bg rounded-sm font-medium hover:bg-accent-hover">Login</a>
    </div>
  );

  function applyTemplate(key: string) {
    const t = TEMPLATES[key];
    if (t) {
      setName(t.name);
      setDescription(t.description);
      setSteps(t.steps);
      setCategory(t.category);
      setDifficulty(t.difficulty);
      setIcon(t.icon);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!name.trim()) { setError("Name is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    if (steps.length < 2) { setError("Add at least 2 steps"); return; }
    if (steps.some(s => !s.agentId)) { setError("All steps must have an agent selected"); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ chain: any; message: string }>("/chains", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          steps,
          icon,
          category,
          difficulty,
          openSource,
        }),
      });
      setSuccess(`${res.message} Redirecting...`);
      setTimeout(() => router.push(`/chains/${res.chain.id}`), 1500);
    } catch (err: any) {
      setError(err.message || "Failed to create chain");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 py-12 pt-28">
        <h1 className="text-3xl font-bold mb-2">Create Chain</h1>
        <p className="text-text-muted mb-8">
          Connect multiple agents into an automated pipeline. Each agent passes context to the next.
        </p>

        {/* Templates */}
        <div className="mb-8">
          <p className="text-sm text-text-dim mb-3">Start from a template:</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "blank", label: "Blank" },
              { key: "health", label: "🏭 Health Check" },
              { key: "delivery", label: "🚚 Delivery Risk" },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t.key)}
                className="px-4 py-2 rounded-sm bg-bg-surface-2 hover:bg-bg-surface-3 text-sm border border-border hover:border-accent/30 transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name + Icon */}
          <div className="grid grid-cols-[1fr_80px] gap-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Chain Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Factory Health Check"
                maxLength={100}
                className="w-full px-4 py-3 bg-bg-surface border border-border rounded-sm text-text placeholder-text-dim focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Icon</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="w-full px-4 py-3 bg-bg-surface border border-border rounded-sm text-text text-center text-2xl focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this chain do?"
              maxLength={500}
              className="w-full px-4 py-3 bg-bg-surface border border-border rounded-sm text-text placeholder-text-dim focus:border-accent focus:outline-none"
            />
          </div>

          {/* Category + Difficulty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-3 bg-bg-surface border border-border rounded-sm text-text focus:border-accent focus:outline-none"
              >
                {["General", "Production", "Quality", "Delivery", "Supply Chain", "Sustainability", "Planning", "Maintenance"].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full px-4 py-3 bg-bg-surface border border-border rounded-sm text-text focus:border-accent focus:outline-none"
              >
                {["Beginner", "Intermediate", "Advanced", "Expert"].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Open Source Toggle */}
          <div className="flex items-center justify-between p-4 bg-bg-surface border border-border rounded-sm">
            <div>
              <p className="text-sm font-medium text-text-muted">Open Source</p>
              <p className="text-xs text-text-dim mt-0.5">Make your chain steps and configuration visible to everyone.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpenSource(!openSource)}
              className={`relative w-11 h-6 rounded-full transition-colors ${openSource ? "bg-accent" : "bg-bg-surface-3"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${openSource ? "translate-x-5" : ""}`} />
            </button>
          </div>

          {/* Chain Builder */}
          <ChainBuilder steps={steps} setSteps={setSteps} agents={agents} />

          {/* Error / Success */}
          {error && <div className="p-3 bg-red-900/30 border border-red-700 rounded-sm text-red-300 text-sm">{error}</div>}
          {success && <div className="p-3 bg-emerald-900/30 border border-emerald-700 rounded-sm text-emerald-300 text-sm">{success}</div>}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-accent hover:bg-accent-hover disabled:bg-bg-surface-3 disabled:text-text-dim text-bg font-semibold rounded-sm text-lg transition-colors"
          >
            {submitting ? "Deploying..." : "Deploy Chain"}
          </button>
        </form>
      </div>
    </div>
  );
}
