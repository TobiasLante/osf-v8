import { BackgroundOrbs } from "@/components/BackgroundOrbs";

export default function AboutPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              About{" "}
              <span className="bg-accent-gradient bg-clip-text text-transparent">
                OpenShopFloor
              </span>
            </h1>
            <p className="text-text-muted text-lg">
              A personal, non-commercial open source project.
            </p>
          </div>

          <div className="space-y-8">
            {/* What is this */}
            <Card title="What is OpenShopFloor?">
              <p>
                OpenShopFloor is an open source sandbox for manufacturing AI. It provides
                a live factory simulation with 111 MCP tools, a visual Node-RED flow editor,
                a TypeScript agent SDK, and pre-built multi-agent analysis systems.
              </p>
              <p className="mt-3">
                The goal is simple: give anyone a real factory environment to explore,
                experiment, and build AI agents for manufacturing &mdash; without needing
                access to a physical production facility.
              </p>
            </Card>

            {/* Why */}
            <Card title="Why does this exist?">
              <p>
                Manufacturing generates enormous amounts of data &mdash; OEE metrics,
                quality measurements, material flows, energy consumption, maintenance logs.
                AI has the potential to transform how factories operate. But there is a problem:
              </p>
              <p className="mt-3 font-medium text-text">
                You can&apos;t experiment with factory AI if you don&apos;t have a factory.
              </p>
              <p className="mt-3">
                OpenShopFloor solves this by providing a realistic, always-running manufacturing
                simulation with the same data structures, complexity, and edge cases you would
                find in a real production environment. CNC machines, injection molding, assembly
                lines, quality control, tool management, ERP &mdash; all accessible through
                standardized MCP (Model Context Protocol) tools.
              </p>
            </Card>

            {/* Open Source */}
            <div className="p-6 rounded-md border border-accent/20 bg-accent/5">
              <h2 className="text-xl font-bold mb-3">Open Source &mdash; AGPL-3.0</h2>
              <div className="text-sm text-text-muted leading-relaxed space-y-3">
                <p>
                  OpenShopFloor is a <strong className="text-text">personal project</strong>, not a commercial product.
                  There is no company behind it, no venture funding, no paid tier, no hidden monetization.
                </p>
                <p>
                  The platform is licensed under the{" "}
                  <a
                    href="https://www.gnu.org/licenses/agpl-3.0.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline font-medium"
                  >
                    GNU Affero General Public License v3.0 (AGPL-3.0)
                  </a>
                  . This means you are free to use, modify, and distribute the code &mdash; but if you run a
                  modified version as a service, you must publish your changes under the same license.
                </p>

                <div className="mt-2 p-4 rounded border border-border bg-bg-surface">
                  <p className="text-xs font-semibold text-text mb-2">What is open source (AGPL-3.0):</p>
                  <ul className="text-xs text-text-dim space-y-1 list-disc list-inside">
                    <li>Frontend (Next.js web application)</li>
                    <li>Gateway (API server, Node-RED integration)</li>
                    <li>Flow engine (BFS execution, multi-input/output)</li>
                    <li>Agent sandbox (isolated-vm TypeScript runtime)</li>
                    <li>All custom Node-RED nodes</li>
                  </ul>
                  <p className="text-xs font-semibold text-text mt-3 mb-2">What is NOT open source:</p>
                  <ul className="text-xs text-text-dim space-y-1 list-disc list-inside">
                    <li>Factory simulation (proprietary, hosted as a free service)</li>
                    <li>MCP server data layer (proprietary)</li>
                  </ul>
                </div>

                <p>
                  The factory simulation is provided free of charge for experimentation.
                  It took significant domain expertise to build and is not part of the open source release.
                  You can connect your own data sources via MCP instead.
                </p>
                <p>
                  I built this because I believe manufacturing AI should be accessible to everyone &mdash;
                  not just companies that can afford six-figure platform licenses.
                </p>
              </div>
            </div>

            {/* The Factory */}
            <Card title="The Simulated Factory">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FactoryItem
                  title="CNC Machines"
                  desc="Milling and turning centers with realistic cycle times, tool wear, and OEE data."
                />
                <FactoryItem
                  title="Injection Molding"
                  desc="SGM machines with 97 process parameters, cavity balance, and SPC monitoring."
                />
                <FactoryItem
                  title="Assembly Lines"
                  desc="Multi-station assembly with pre-assembly cells, buffer management, and test field."
                />
                <FactoryItem
                  title="Full ERP System"
                  desc="Work orders, BOM, stock, purchases, customer orders, and MRP planning."
                />
                <FactoryItem
                  title="Quality Management"
                  desc="Defect tracking, SPC, audits, corrective actions, and customer complaints."
                />
                <FactoryItem
                  title="Tool &amp; Warehouse Management"
                  desc="Tool inventory, calibration, maintenance schedules, stock movements."
                />
              </div>
            </Card>

            {/* What you can do */}
            <Card title="What You Can Do">
              <ul className="space-y-2">
                <li className="flex gap-3">
                  <span className="text-accent font-bold shrink-0">01</span>
                  <span><strong className="text-text">Explore</strong> &mdash; Browse the live factory dashboard, query data through the chat, inspect all 111 MCP tools.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-accent font-bold shrink-0">02</span>
                  <span><strong className="text-text">Run built-in agents</strong> &mdash; Try multi-agent deep analysis systems for OEE, quality, delivery, and revenue optimization.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-accent font-bold shrink-0">03</span>
                  <span><strong className="text-text">Build visual flows</strong> &mdash; Design AI workflows in the Node-RED editor with custom nodes for MCP, LLM, context aggregation, and more.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-accent font-bold shrink-0">04</span>
                  <span><strong className="text-text">Write code agents</strong> &mdash; Deploy TypeScript agents from GitHub with full SDK access to MCP tools, LLM, and storage.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-accent font-bold shrink-0">05</span>
                  <span><strong className="text-text">Experiment freely</strong> &mdash; Break things, try wild ideas, test hypotheses. It&apos;s a sandbox &mdash; that&apos;s what it&apos;s for.</span>
                </li>
              </ul>
            </Card>

            {/* Tech Stack */}
            <Card title="Technology">
              <div className="flex flex-wrap gap-2">
                {[
                  "TypeScript",
                  "Node.js",
                  "Next.js",
                  "Node-RED",
                  "PostgreSQL",
                  "MCP (Model Context Protocol)",
                  "isolated-vm (V8 Sandbox)",
                  "Kubernetes",
                  "Docker",
                  "Cloudflare Pages",
                  "Self-hosted LLM",
                ].map((tech) => (
                  <span
                    key={tech}
                    className="text-xs px-3 py-1.5 rounded-sm border border-border bg-bg-surface-2 text-text-muted"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </Card>

            {/* Built by */}
            <Card title="Built by">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-md bg-accent-gradient flex items-center justify-center text-bg font-bold text-xl shrink-0">
                  TL
                </div>
                <div>
                  <h3 className="font-semibold text-text">Tobias Lante</h3>
                  <p className="text-sm text-text-muted mt-1 leading-relaxed">
                    Manufacturing AI engineer working at the intersection of factory operations
                    and artificial intelligence. This is a personal passion project &mdash; built
                    in my free time because I think the manufacturing industry deserves better
                    tools for exploring AI.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <a
                      href="https://www.linkedin.com/in/tobiaslante"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-sm border border-border bg-bg-surface-2 text-text-muted hover:text-accent hover:border-accent/25 transition-colors"
                    >
                      LinkedIn
                    </a>
                    <a
                      href="https://github.com/TobiasLante/openshopfloor"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-sm border border-border bg-bg-surface-2 text-text-muted hover:text-accent hover:border-accent/25 transition-colors"
                    >
                      GitHub
                    </a>
                    <a
                      href="https://www.linkedin.com/in/tobias-lante/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-sm border border-border bg-bg-surface-2 text-text-muted hover:text-accent hover:border-accent/25 transition-colors"
                    >
                      LinkedIn
                    </a>
                  </div>
                </div>
              </div>
            </Card>

          </div>
        </div>
      </section>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 rounded-md border border-border bg-bg-surface">
      <h2 className="text-xl font-bold mb-3">{title}</h2>
      <div className="text-sm text-text-muted leading-relaxed">{children}</div>
    </div>
  );
}

function FactoryItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="font-medium text-text text-sm mb-1">{title}</h3>
      <p className="text-xs text-text-dim">{desc}</p>
    </div>
  );
}
