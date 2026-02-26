"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { tools } from "@/lib/tools-data";
import { useRouter } from "next/navigation";

const TOOL_CATEGORIES = Array.from(new Set(tools.map((t) => t.category))).sort();

const TEMPLATES: Record<string, { name: string; prompt: string; tools: string[]; category: string; difficulty: string }> = {
  blank: { name: "", prompt: "", tools: [], category: "General", difficulty: "Beginner" },
  oee: {
    name: "My OEE Agent",
    prompt: `You are an OEE monitoring agent. Your job:
1. Get current OEE for all machines
2. Find machines below 85% target
3. Analyze root causes (availability, performance, quality)
4. Recommend corrective actions

Be specific: name the machine, the metric, and the action.`,
    tools: ["factory_get_latest_oee", "factory_get_machine_oee", "factory_get_production_history"],
    category: "Production",
    difficulty: "Beginner",
  },
  quality: {
    name: "My Quality Agent",
    prompt: `You are a quality monitoring agent. Your tasks:
1. Check for SPC alarms
2. Review Cpk values — flag below 1.33
3. Check calibration due dates
4. Recommend preventive actions

Always include the machine, characteristic, and trend direction.`,
    tools: ["factory_get_spc_alarms", "factory_get_cpk_overview", "factory_get_calibration_due"],
    category: "Quality",
    difficulty: "Intermediate",
  },
  delivery: {
    name: "My Delivery Agent",
    prompt: `You are a delivery risk agent. Your focus:
1. Find orders at risk of late delivery
2. Check material readiness for critical orders
3. Identify bottleneck machines
4. Suggest rescheduling or expediting

Prioritize by customer tier and revenue impact.`,
    tools: ["factory_get_orders_at_risk", "factory_get_customer_otd", "factory_check_material_readiness", "factory_get_va05_summary"],
    category: "Delivery",
    difficulty: "Intermediate",
  },
};

export default function CreateAgentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [category, setCategory] = useState("General");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [type, setType] = useState("operational");
  const [icon, setIcon] = useState("\u{1F916}");
  const [toolFilter, setToolFilter] = useState("");
  const [toolCatFilter, setToolCatFilter] = useState("All");
  const [openSource, setOpenSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-gray-400">Log in to create agents</p>
      <a href="/login" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Login</a>
    </div>
  );

  function applyTemplate(key: string) {
    const t = TEMPLATES[key];
    if (t) {
      setName(t.name);
      setSystemPrompt(t.prompt);
      setSelectedTools(t.tools);
      setCategory(t.category);
      setDifficulty(t.difficulty);
    }
  }

  function toggleTool(toolName: string) {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  }

  const filteredTools = tools.filter((t) => {
    if (toolCatFilter !== "All" && t.category !== toolCatFilter) return false;
    if (toolFilter && !t.name.toLowerCase().includes(toolFilter.toLowerCase()) && !t.description.toLowerCase().includes(toolFilter.toLowerCase())) return false;
    return true;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!name.trim()) { setError("Name is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    if (!systemPrompt.trim()) { setError("System prompt is required"); return; }
    if (selectedTools.length === 0) { setError("Select at least one tool"); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ agent: any; message: string }>("/agents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          systemPrompt: systemPrompt.trim(),
          tools: selectedTools,
          category,
          difficulty,
          type,
          icon,
          openSource,
        }),
      });
      setSuccess(`${res.message} Redirecting...`);
      setTimeout(() => router.push(`/agents/${res.agent.id}`), 1500);
    } catch (err: any) {
      setError(err.message || "Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Create Agent</h1>
        <p className="text-gray-400 mb-8">Build your own AI agent. Pick tools, write a prompt, deploy instantly.</p>

        {/* Templates */}
        <div className="mb-8">
          <p className="text-sm text-gray-400 mb-3">Start from a template:</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "blank", label: "Blank" },
              { key: "oee", label: "OEE Monitor" },
              { key: "quality", label: "Quality Guard" },
              { key: "delivery", label: "Delivery Risk" },
            ].map((t) => (
              <button key={t.key} onClick={() => applyTemplate(t.key)}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm border border-gray-700 transition">
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name + Icon */}
          <div className="grid grid-cols-[1fr_80px] gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Agent Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Scrap Analyzer" maxLength={100}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Icon</label>
              <input type="text" value={icon} onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white text-center text-2xl focus:border-blue-500 focus:outline-none" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Description <span className="text-gray-500">(shown on agent card)</span></label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="One sentence about what this agent does" maxLength={500}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
          </div>

          {/* Category + Difficulty + Type */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-blue-500 focus:outline-none">
                {["General", "Production", "Quality", "Delivery", "Supply Chain", "Sustainability", "Planning", "Maintenance"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Difficulty</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-blue-500 focus:outline-none">
                {["Beginner", "Intermediate", "Advanced", "Expert"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-blue-500 focus:outline-none">
                <option value="operational">Operational</option>
                <option value="langgraph">LangGraph</option>
                <option value="strategic">Strategic</option>
              </select>
            </div>
          </div>

          {/* Open Source Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-900 border border-gray-700 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-300">Open Source</p>
              <p className="text-xs text-gray-500 mt-0.5">Make your system prompt visible to everyone. Others can learn from and fork your agent.</p>
            </div>
            <button type="button" onClick={() => setOpenSource(!openSource)}
              className={`relative w-11 h-6 rounded-full transition-colors ${openSource ? 'bg-blue-600' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${openSource ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              System Prompt <span className="text-gray-500">({systemPrompt.length}/10000)</span>
            </label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10} maxLength={10000}
              placeholder="Tell the agent what to do, step by step..."
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 font-mono text-sm focus:border-blue-500 focus:outline-none resize-y" />
          </div>

          {/* Tool Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              MCP Tools <span className="text-gray-500">({selectedTools.length} selected)</span>
            </label>

            {/* Selected tools preview */}
            {selectedTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selectedTools.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTool(t)}
                    className="px-2.5 py-1 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-300 text-xs hover:bg-red-600/20 hover:border-red-500/40 hover:text-red-300 transition">
                    {t.replace("factory_", "")} &times;
                  </button>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="flex gap-2 mb-2">
              <input type="text" value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}
                placeholder="Search tools..."
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none" />
              <select value={toolCatFilter} onChange={(e) => setToolCatFilter(e.target.value)}
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none">
                <option value="All">All categories</option>
                {TOOL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Tool grid */}
            <div className="max-h-64 overflow-y-auto border border-gray-700 rounded-lg bg-gray-900/50 p-2 space-y-1">
              {filteredTools.map((t) => {
                const selected = selectedTools.includes(t.name);
                return (
                  <button key={t.name} type="button" onClick={() => toggleTool(t.name)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
                      selected
                        ? "bg-blue-600/20 border border-blue-500/40 text-blue-200"
                        : "hover:bg-gray-800 text-gray-400 border border-transparent"
                    }`}>
                    <span className="font-mono text-xs">{t.name.replace("factory_", "")}</span>
                    <span className="text-gray-500 ml-2 text-xs">{t.category}</span>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{t.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error / Success */}
          {error && <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>}
          {success && <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-sm">{success}</div>}

          {/* Submit */}
          <button type="submit" disabled={submitting}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg text-lg transition">
            {submitting ? "Deploying..." : "Deploy Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
