"use client";

import { useEffect, useState } from "react";
import { loadLlmConfig, saveLlmConfig, Provider } from "@/lib/api";

const PROVIDERS: { value: Provider; label: string; desc: string }[] = [
  { value: "anthropic", label: "Anthropic", desc: "Claude Sonnet, Opus, Haiku" },
  { value: "openai", label: "OpenAI", desc: "GPT-4o, o1, or other models" },
  { value: "custom", label: "Built-in (qwen2.5)", desc: "Self-hosted LLM — no API key needed" },
];

const MODELS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250514", "claude-3-5-sonnet-20241022"],
  openai: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
  custom: [],
};

export function LlmSettings() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    const cfg = loadLlmConfig();
    setProvider(cfg.provider);
    setApiKey(cfg.apiKey);
    setModel(cfg.model);
    setCustomBaseUrl(cfg.customBaseUrl || "");
  }, []);

  useEffect(() => {
    const models = MODELS[provider];
    if (models.length > 0 && !models.includes(model)) {
      setModel(models[0]);
    }
  }, [provider]);

  const handleSave = () => {
    saveLlmConfig({ provider, apiKey, model, customBaseUrl: customBaseUrl || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 10 }),
        });
        if (res.ok) setTestResult({ ok: true, msg: "Connection successful!" });
        else setTestResult({ ok: false, msg: `Error ${res.status}: ${await res.text()}` });
      } else {
        const baseUrl = customBaseUrl || "https://api.openai.com";
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 10 }),
        });
        if (res.ok) setTestResult({ ok: true, msg: "Connection successful!" });
        else setTestResult({ ok: false, msg: `Error ${res.status}: ${await res.text()}` });
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message });
    }
    setTesting(false);
  };

  const models = MODELS[provider];

  return (
    <div className="space-y-6">
      {/* Provider selection */}
      <div>
        <label className="text-sm font-medium text-p1-text block mb-3">LLM Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PROVIDERS.map(p => (
            <button
              key={p.value}
              onClick={() => setProvider(p.value)}
              className={`text-left border rounded-lg p-4 transition-all ${
                provider === p.value
                  ? "border-p1-accent bg-p1-accent/5"
                  : "border-p1-border hover:border-p1-accent/30"
              }`}
            >
              <span className="text-p1-text font-medium text-sm">{p.label}</span>
              <p className="text-p1-dim text-xs mt-1">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="text-sm font-medium text-p1-text block mb-1.5">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
          className="w-full bg-p1-surface border border-p1-border rounded-lg px-3 py-2.5 text-p1-text text-sm focus:outline-none focus:border-p1-accent"
        />
        <p className="text-p1-dim text-xs mt-1">Stored in your browser&apos;s localStorage only.</p>
      </div>

      {/* Model */}
      <div>
        <label className="text-sm font-medium text-p1-text block mb-1.5">Model</label>
        {models.length > 0 ? (
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-p1-surface border border-p1-border rounded-lg px-3 py-2.5 text-p1-text text-sm focus:outline-none focus:border-p1-accent"
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="e.g. llama3, mistral"
            className="w-full bg-p1-surface border border-p1-border rounded-lg px-3 py-2.5 text-p1-text text-sm focus:outline-none focus:border-p1-accent"
          />
        )}
      </div>

      {/* Custom base URL — hidden for built-in, gateway handles routing */}
      {provider === "custom" && customBaseUrl && (
        <div>
          <label className="text-sm font-medium text-p1-text block mb-1.5">Base URL (optional override)</label>
          <input
            type="url"
            value={customBaseUrl}
            onChange={e => setCustomBaseUrl(e.target.value)}
            placeholder="Leave empty to use built-in server"
            className="w-full bg-p1-surface border border-p1-border rounded-lg px-3 py-2.5 text-p1-text text-sm focus:outline-none focus:border-p1-accent"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={provider !== "custom" && !apiKey}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {saved ? "Saved!" : "Save"}
        </button>
        <button
          onClick={handleTest}
          disabled={(provider !== "custom" && !apiKey) || testing}
          className="border border-p1-border text-p1-text px-5 py-2.5 rounded-lg text-sm hover:border-p1-accent/40 disabled:opacity-40 transition-colors"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
            {testResult.msg}
          </span>
        )}
      </div>
    </div>
  );
}
