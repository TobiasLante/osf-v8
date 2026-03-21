"use client";

export default function FomiPage() {
  return (
    <div className="min-h-screen bg-bg pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6 space-y-8">
        <div>
          <span className="inline-block text-xs font-mono text-accent bg-accent/10 border border-accent/20 rounded px-2 py-1 mb-3">
            FoMI 2026 — 18. March 2026
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-text">
            AI-Powered Impact Analysis for Smart Manufacturing
          </h1>
          <p className="text-text-muted text-sm mt-3 max-w-2xl leading-relaxed">
            Live presentation at FoMI 2026 (Forum for Manufacturing Intelligence) by Tobias Lante.
            An AI agent answers: &quot;What happens if machine SGM-004 goes down right now?&quot; — using real factory data, Knowledge Graphs, and multi-agent discussion in under 10 seconds.
          </p>
        </div>

        <div className="rounded-lg overflow-hidden border border-border bg-black">
          <video
            controls
            preload="metadata"
            className="w-full aspect-video"
          >
            <source src="/fomi-2026.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg p-5 bg-bg-surface">
            <h3 className="text-sm font-semibold text-text mb-3">What you see</h3>
            <ol className="space-y-2 text-sm text-text-muted">
              <li>1. A natural language question about a machine failure</li>
              <li>2. AI queries 5+ data sources via MCP tools (ERP, BDE, OEE, QMS, UNS)</li>
              <li>3. Knowledge Graph traversal finds downstream impact</li>
              <li>4. 4 specialist agents discuss from different perspectives</li>
              <li>5. Final recommendation with prioritized action plan</li>
            </ol>
          </div>

          <div className="border border-border rounded-lg p-5 bg-bg-surface">
            <h3 className="text-sm font-semibold text-text mb-3">Tech Stack</h3>
            <ul className="space-y-2 text-sm text-text-muted">
              <li><strong className="text-text">LLM:</strong> Qwen 2.5 32B — local, llama.cpp, no cloud</li>
              <li><strong className="text-text">Data:</strong> Factory Simulator v3 — 7 PostgreSQL databases</li>
              <li><strong className="text-text">Knowledge Graph:</strong> Neo4j + 768d vector embeddings</li>
              <li><strong className="text-text">Protocol:</strong> MCP (Model Context Protocol) for tool calling</li>
              <li><strong className="text-text">Infra:</strong> Kubernetes, on-premise, 35 OPC-UA servers</li>
            </ul>
          </div>
        </div>

        <div className="border border-border rounded-lg p-5 bg-bg-surface">
          <h3 className="text-sm font-semibold text-text mb-2">About FoMI</h3>
          <p className="text-sm text-text-muted leading-relaxed">
            FoMI (Forum for Manufacturing Intelligence) is an international platform for industrial AI and smart manufacturing, organized by DigitalFlowz. The 2026 edition focused on practical applications of AI in production — no slides, live demos only. This session demonstrated how CESMII i3X principles (Interoperability, Integration, Intelligence) work with open-source tools and local LLMs.
          </p>
        </div>
      </div>
    </div>
  );
}
