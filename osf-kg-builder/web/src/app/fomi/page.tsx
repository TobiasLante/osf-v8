'use client';

export default function FomiPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="badge badge-amber">FoMI 2026</span>
          <span className="text-xs text-[var(--text-dim)]">18. March 2026</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          AI-Powered Impact Analysis for Smart Manufacturing
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-2 max-w-2xl">
          Live presentation at FoMI 2026 (Forum for Manufacturing Intelligence) by Tobias Lante.
          Demonstrating how an AI agent answers the question: <em>&quot;What happens if machine SGM-004 goes down right now?&quot;</em> — using real factory data, Knowledge Graphs, and multi-agent discussion in under 10 seconds.
        </p>
      </div>

      {/* Video */}
      <div className="card !p-0 overflow-hidden">
        <video
          controls
          preload="metadata"
          className="w-full aspect-video bg-black"
          poster=""
        >
          <source src="/fomi-2026.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Context */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-2">What you see</h3>
          <ul className="space-y-2 text-xs text-[var(--text-muted)]">
            <li className="flex gap-2">
              <span className="text-emerald-400 flex-shrink-0">1.</span>
              A natural language question about a machine failure scenario
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400 flex-shrink-0">2.</span>
              The AI agent queries 5+ data sources via MCP tools (ERP, BDE, OEE, QMS, UNS)
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400 flex-shrink-0">3.</span>
              A Knowledge Graph is traversed to find downstream impact (orders, customers, costs)
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400 flex-shrink-0">4.</span>
              4 specialist agents discuss the situation from different perspectives
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-400 flex-shrink-0">5.</span>
              A final recommendation with action plan is synthesized
            </li>
          </ul>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Tech Stack</h3>
          <ul className="space-y-2 text-xs text-[var(--text-muted)]">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              <strong className="text-[var(--text)]">LLM:</strong> Qwen 2.5 32B (local, llama.cpp)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              <strong className="text-[var(--text)]">Data:</strong> Factory Simulator v3 (PostgreSQL, 7 databases)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
              <strong className="text-[var(--text)]">Knowledge Graph:</strong> Neo4j + 768d vector embeddings
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <strong className="text-[var(--text)]">Protocol:</strong> MCP (Model Context Protocol) for tool calling
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
              <strong className="text-[var(--text)]">Infrastructure:</strong> Kubernetes, on-premise (no cloud)
            </li>
          </ul>
        </div>
      </div>

      {/* About */}
      <div className="card !border-[var(--border)]/50">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-2">About FoMI</h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          FoMI (Forum for Manufacturing Intelligence) is an international platform for industrial AI and smart manufacturing, organized by DigitalFlowz. The 2026 edition focused on practical applications of AI in production environments — no slides, live demos only. This session demonstrated how CESMII i3X principles (Interoperability, Integration, Intelligence) can be implemented with open-source tools and local LLMs.
        </p>
      </div>
    </div>
  );
}
