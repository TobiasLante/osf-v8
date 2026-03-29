"use client";

import { LlmSettings } from "@/components/LlmSettings";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-p1-muted text-sm">Configure your LLM provider and API key for Process1st.</p>
      </div>
      <div className="bg-p1-surface border border-p1-border rounded-lg p-6">
        <LlmSettings />
      </div>
      <div className="mt-6 rounded-lg border border-p1-border bg-p1-surface p-5">
        <h3 className="text-sm font-semibold text-p1-text mb-2">How it works</h3>
        <ul className="text-p1-muted text-xs space-y-1.5">
          <li>Your API key is stored only in this browser&apos;s localStorage.</li>
          <li>LLM calls go directly from your browser to the provider (Anthropic/OpenAI).</li>
          <li>Tool calls go to the Process1st MCP server for knowledge graph data.</li>
          <li>No data passes through any intermediate backend.</li>
        </ul>
      </div>
    </div>
  );
}
