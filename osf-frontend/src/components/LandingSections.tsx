"use client";

import { ScrollReveal } from "./ScrollReveal";
import { DeepAnalysisTeaser } from "./DeepAnalysisTeaser";

const STATS = [
  { value: "111", label: "MCP Tools", sub: "ERP, OEE, QMS, TMS, Live Data, KG" },
  { value: "6", label: "MCP Servers", sub: "Live production data" },
  { value: "24/7", label: "Simulation", sub: "Always running" },
];

const FEATURES = [
  {
    icon: "\u{1F3ED}",
    title: "Real Factory, Real Data",
    desc: "A live manufacturing simulation with CNC machines, injection molding, quality control, and tool management \u2014 not a toy dataset.",
  },
  {
    icon: "\u{1F517}",
    title: "111 MCP Tools",
    desc: "Access ERP orders, machine status, OEE metrics, quality reports, tool inventory, live #shared.UNS data, and knowledge graphs through the Model Context Protocol.",
  },
  {
    icon: "\u{1F310}",
    title: "Connected Data Layer",
    desc: "All factory data flows through a unified data layer. Six AI servers organize machines, orders, quality, and inventory into 111 tools your agents can query.",
  },
  {
    icon: "\u{1F916}",
    title: "Build & Experiment",
    desc: "Design your own AI agents \u2014 analyze production, predict failures, optimize workflows. Your ideas, your logic, instant feedback.",
  },
  {
    icon: "\u{1F3A8}",
    title: "Visual Flow Editor",
    desc: "Wire agents, MCP tools, LLMs, and decision nodes together in a Node-RED drag-and-drop editor. No coding required.",
  },
  {
    icon: "\u{1F4BB}",
    title: "TypeScript Agent SDK",
    desc: "Write agents in TypeScript, push to GitHub, auto-deploy. Full SDK with MCP access, LLM, and persistent storage.",
  },
  {
    icon: "\u{1F9E0}",
    title: "Bring Your Own LLM",
    desc: "Use our platform LLM or connect your own \u2014 OpenAI, Anthropic, local models, any OpenAI-compatible endpoint.",
  },
  {
    icon: "\u{1F513}",
    title: "100% Free",
    desc: "No credit card, no trial limits on features. A free playground for manufacturing AI \u2014 use it, learn from it, build on it.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Explore the Factory",
    desc: "Watch real-time production on the live dashboard. Understand the machines, orders, and quality flows your agents will work with.",
  },
  {
    num: "02",
    title: "Try an Agent",
    desc: "Run a built-in deep analysis agent or use the chat interface to query factory data with natural language.",
  },
  {
    num: "03",
    title: "Build Your Own",
    desc: "Create your own agent \u2014 visually in the flow editor or as TypeScript code on GitHub. Connect MCP tools, add LLM logic, wire it up.",
  },
  {
    num: "04",
    title: "Experiment & Iterate",
    desc: "Test with live data, inspect every node\u2019s output, tweak your prompts, add decision logic. The sandbox is yours.",
  },
  {
    num: "05",
    title: "Share & Discuss",
    desc: "Share your agents with the community, suggest features, report issues, and help shape the future of manufacturing AI.",
  },
];

export function LandingSections() {
  return (
    <>
      {/* Factory Live Section */}
      <section id="factory" className="relative py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                A Real Factory,{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Running Live</span>
              </h2>
              <p className="text-text-muted max-w-xl mx-auto">
                This isn&apos;t a demo dataset. A full manufacturing simulation runs 24/7 with
                CNC&nbsp;machines, injection molding, quality control, and tool management.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <div className="relative rounded-md overflow-hidden border border-border bg-bg-surface shadow-[0_0_80px_rgba(255,149,0,0.06)]">
              <div className="aspect-video">
                <iframe
                  src={process.env.NEXT_PUBLIC_FACTORY_URL || "https://osf-factory.zeroguess.ai"}
                  className="w-full h-full"
                  title="OpenShopFloor Factory Simulation"
                  loading="lazy"
                />
              </div>
              <div className="absolute inset-0 pointer-events-none rounded-md ring-1 ring-inset ring-white/5" />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Node-RED Flow Editor Showcase */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Build AI Agents{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Your Way</span>
              </h2>
              <p className="text-text-muted max-w-xl mx-auto">
                Drag-and-drop in the visual flow editor, or write TypeScript code agents.
                Wire MCP tools, LLMs, and decision logic together — your choice.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <div className="relative rounded-md overflow-hidden border border-border bg-bg-surface shadow-[0_0_80px_rgba(255,149,0,0.06)]">
              <img
                src="/images/flow-editor.png"
                alt="Node-RED Flow Editor with AI agent nodes"
                className="w-full"
                loading="lazy"
              />
              <div className="absolute inset-0 pointer-events-none rounded-md ring-1 ring-inset ring-white/5" />
            </div>
          </ScrollReveal>
          <ScrollReveal delay={250}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
              <div className="p-5 rounded-md border border-border bg-bg-surface text-center">
                <div className="text-sm font-semibold text-text mb-1">Drag &amp; Drop</div>
                <div className="text-xs text-text-muted">Connect agents, prompts, and MCP tools visually</div>
              </div>
              <div className="p-5 rounded-md border border-border bg-bg-surface text-center">
                <div className="text-sm font-semibold text-text mb-1">Live Execution</div>
                <div className="text-xs text-text-muted">Run flows against real factory data, inspect every step</div>
              </div>
              <div className="p-5 rounded-md border border-border bg-bg-surface text-center">
                <div className="text-sm font-semibold text-text mb-1">No Code Required</div>
                <div className="text-xs text-text-muted">Built on Node-RED — the tool manufacturing already knows</div>
              </div>
            </div>
          </ScrollReveal>

          {/* Code Agents Block */}
          <ScrollReveal delay={350}>
            <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div>
                <h3 className="text-xl font-bold text-text mb-3">
                  Prefer code? Write TypeScript agents.
                </h3>
                <p className="text-text-muted text-sm leading-relaxed mb-4">
                  Full access to 111 MCP tools and LLM calls from TypeScript.
                  Deploy from GitHub with one click — no Node-RED required.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded border border-border bg-bg-surface text-text-muted">ctx.mcp.call()</span>
                  <span className="text-xs px-2 py-1 rounded border border-border bg-bg-surface text-text-muted">ctx.llm.chat()</span>
                  <span className="text-xs px-2 py-1 rounded border border-border bg-bg-surface text-text-muted">ctx.storage</span>
                  <span className="text-xs px-2 py-1 rounded border border-border bg-bg-surface text-text-muted">GitHub Deploy</span>
                </div>
              </div>
              <div className="rounded-md border border-border bg-[#0d1117] p-5 font-mono text-sm leading-relaxed overflow-x-auto">
                <div className="text-text-dim mb-1">{"// agent.ts"}</div>
                <div>
                  <span className="text-purple-400">export default async function</span>{" "}
                  <span className="text-blue-400">main</span>
                  <span className="text-text-muted">(ctx) {"{"}</span>
                </div>
                <div className="pl-4">
                  <span className="text-purple-400">const</span>{" "}
                  <span className="text-text">oee</span>{" "}
                  <span className="text-text-muted">= await</span>{" "}
                  <span className="text-blue-400">ctx.mcp.call</span>
                  <span className="text-text-muted">(</span>
                  <span className="text-green-400">&apos;factory_get_latest_oee&apos;</span>
                  <span className="text-text-muted">);</span>
                </div>
                <div className="pl-4">
                  <span className="text-purple-400">const</span>{" "}
                  <span className="text-text">analysis</span>{" "}
                  <span className="text-text-muted">= await</span>{" "}
                  <span className="text-blue-400">ctx.llm.chat</span>
                  <span className="text-text-muted">(</span>
                  <span className="text-green-400">`Analyze: ${"{"}</span>
                  <span className="text-text">oee</span>
                  <span className="text-green-400">{"}"}`</span>
                  <span className="text-text-muted">);</span>
                </div>
                <div className="pl-4">
                  <span className="text-purple-400">return</span>{" "}
                  <span className="text-text-muted">{"{"}</span>{" "}
                  <span className="text-text">analysis</span>{" "}
                  <span className="text-text-muted">{"}"};</span>
                </div>
                <div><span className="text-text-muted">{"}"}</span></div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Deep Analysis Agents */}
      <DeepAnalysisTeaser />

      {/* UNS Architecture Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                How the{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Data Flows</span>
              </h2>
              <p className="text-text-muted max-w-2xl mx-auto">
                Every machine, sensor, and order generates live data. Six specialized AI servers
                organize it into 111 queryable tools. Your agents tap into this data and make
                decisions in real time.
              </p>
            </div>
          </ScrollReveal>

          {/* Architecture Diagram */}
          <ScrollReveal delay={150}>
            <div className="relative rounded-md border border-border bg-bg-surface p-8 overflow-hidden">
              {/* 3-Layer UNS Diagram */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Layer 1: Shop Floor */}
                <div className="p-5 rounded-md border border-border bg-bg-surface-2">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-sm bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-sm font-bold">L1</div>
                    <div>
                      <div className="text-sm font-semibold">Shop Floor</div>
                      <div className="text-xs text-text-dim">Machines &amp; Sensors</div>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-text-muted">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> CNC Machines (9001&ndash;9018)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Injection Molding (SGM-001&ndash;005)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Assembly &amp; Quality Inspection</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Temperature, Pressure, Cycle Times</div>
                  </div>
                </div>

                {/* Layer 2: MCP + UNS */}
                <div className="p-5 rounded-md border border-accent/30 bg-accent/5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-sm bg-accent/10 flex items-center justify-center text-accent text-sm font-bold">L2</div>
                    <div>
                      <div className="text-sm font-semibold">Data Layer</div>
                      <div className="text-xs text-text-dim">6 Servers &rarr; 111 AI Tools</div>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-text-muted">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> ERP: Orders, Materials, Scheduling</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> OEE: Availability, Performance, Quality</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> Live Data: Real-time machine streams</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> KG: Dependency &amp; Impact Analysis</div>
                  </div>
                </div>

                {/* Layer 3: AI Agents */}
                <div className="p-5 rounded-md border border-border bg-bg-surface-2">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-sm bg-blue-500/10 flex items-center justify-center text-blue-400 text-sm font-bold">L3</div>
                    <div>
                      <div className="text-sm font-semibold">AI Agents</div>
                      <div className="text-xs text-text-dim">Reason, Decide, Act</div>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-text-muted">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> OEE Monitor &amp; Diagnostics</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Material &amp; Capacity Planning</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Delivery Risk &amp; Quality Guard</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Your Custom Agents</div>
                  </div>
                </div>
              </div>

              {/* Flow arrows */}
              <div className="hidden lg:flex justify-center items-center mt-6 gap-2 text-xs text-text-dim">
                <span>Machines</span>
                <span className="text-accent">&rarr;</span>
                <span>Live Data</span>
                <span className="text-accent">&rarr;</span>
                <span>AI Tools</span>
                <span className="text-accent">&rarr;</span>
                <span>Your Agents</span>
                <span className="text-accent">&rarr;</span>
                <span>Insights</span>
              </div>
            </div>
          </ScrollReveal>

          {/* UNS Live Link */}
          <ScrollReveal delay={250}>
            <div className="mt-8 text-center">
              <a
                href="/uns"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-md border border-accent/30 bg-accent/5 text-sm text-accent hover:bg-accent/10 hover:-translate-y-0.5 transition-all"
              >
                <span>Explore the Live Data</span>
                <span>&rarr;</span>
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATS.map((s, i) => (
            <ScrollReveal key={s.label} delay={i * 100}>
              <div className="text-center p-8 rounded-md border border-border bg-bg-surface hover:border-accent/20 transition-colors">
                <div className="text-4xl font-black bg-accent-gradient bg-clip-text text-transparent mb-2">
                  {s.value}
                </div>
                <div className="text-sm font-semibold text-text mb-1">{s.label}</div>
                <div className="text-xs text-text-dim">{s.sub}</div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Divider */}
      <ScrollReveal>
        <div className="max-w-xs mx-auto border-t border-border" />
      </ScrollReveal>

      {/* Features Grid */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Your{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">AI Playground</span>
                {" "}for Manufacturing
              </h2>
              <p className="text-text-muted max-w-lg mx-auto">
                Everything you need to explore, experiment, and build manufacturing AI agents — from first idea to working prototype.
              </p>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <ScrollReveal key={f.title} delay={i * 80}>
                <div className="group p-6 rounded-md border border-border bg-bg-surface hover:border-accent/20 hover:-translate-y-0.5 transition-all h-full">
                  <div className="w-10 h-10 rounded-sm bg-bg-surface-2 flex items-center justify-center text-lg mb-4 group-hover:bg-accent/10 transition-colors">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-text-muted leading-relaxed">{f.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <ScrollReveal>
        <div className="max-w-xs mx-auto border-t border-border" />
      </ScrollReveal>

      {/* How It Works */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                How It{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Works</span>
              </h2>
            </div>
          </ScrollReveal>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-border hidden sm:block" />
            <div className="space-y-12">
              {STEPS.map((step, i) => (
                <ScrollReveal key={step.num} delay={i * 120}>
                  <div className="flex gap-6 items-start">
                    <div className="relative z-10 w-10 h-10 rounded-full border-2 border-accent/40 bg-bg-surface flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold bg-accent-gradient bg-clip-text text-transparent">
                        {step.num}
                      </span>
                    </div>
                    <div className="pt-1.5">
                      <h3 className="font-semibold mb-1">{step.title}</h3>
                      <p className="text-sm text-text-muted leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why I Built This */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Why I{" "}
                <span className="bg-accent-gradient bg-clip-text text-transparent">Built This</span>
              </h2>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <div className="p-8 rounded-md border border-border bg-bg-surface">
              <p className="text-text-muted leading-relaxed mb-4">
                I spent years in manufacturing consulting. Every project started the same way:
                weeks of NDAs, months of waiting for IT to provision access, and by the time you
                could actually touch real data, the budget was half gone. I was tired of it.
              </p>
              <p className="text-text-muted leading-relaxed mb-4">
                So I built what I wished existed &mdash; a real factory simulation that anyone can
                use to learn manufacturing AI. No NDAs, no waiting for IT. Just open your browser
                and start building.
              </p>
              <p className="text-text-muted leading-relaxed mb-6">
                The code is public on GitHub. Fork it, learn from it, contribute. But more
                importantly &mdash; just use the playground and start building.
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm">TL</div>
                <div>
                  <div className="text-sm font-semibold">Tobias Lante</div>
                  <a
                    href="https://www.linkedin.com/in/tobiaslante/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    Follow on LinkedIn &rarr;
                  </a>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <ScrollReveal>
            <div className="max-w-xs mx-auto border-t border-border mb-16" />
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Ready to{" "}
              <span className="bg-accent-gradient bg-clip-text text-transparent">Explore?</span>
            </h2>
            <p className="text-text-muted mb-8">
              Jump in, try the agents, build your own, and see what manufacturing AI can do.
              Free to use — no credit card, no strings attached.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/register"
                className="px-8 py-4 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all"
              >
                Get Started
              </a>
              <a
                href={process.env.NEXT_PUBLIC_FACTORY_URL || "https://osf-factory.zeroguess.ai"}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-md border border-border bg-bg-surface text-text-muted text-sm hover:border-accent/25 hover:text-text hover:-translate-y-0.5 transition-all"
              >
                Watch the Factory Live &rarr;
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}
