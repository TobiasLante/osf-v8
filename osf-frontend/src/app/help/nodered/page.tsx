import Link from 'next/link';
import { BackgroundOrbs } from '@/components/BackgroundOrbs';

export default function NodeRedHelpPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/docs" className="text-text-muted hover:text-accent text-sm mb-6 inline-block">&larr; Back to Docs</Link>

          <div className="mb-8 p-4 rounded-md border border-accent/30 bg-accent/5">
            <p className="text-sm text-text-muted">
              This guide has moved to the Wiki.{' '}
              <Link href="/docs/wiki/visual-flows" className="text-accent hover:underline font-medium">
                Go to Visual Flows Guide &rarr;
              </Link>
            </p>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Node-RED Visual Flows</h1>
          <p className="text-text-muted mb-10 text-lg">
            Build multi-step AI workflows by connecting agents, MCP tools, LLM prompts, and human approvals in a visual drag-and-drop editor &mdash; plus all native Node-RED nodes.
          </p>

          <div className="space-y-8">
            <Section title="What are Flows?">
              <p>
                Flows let you chain multiple AI operations together in a visual graph editor powered by Node-RED.
                Each node in your flow performs one action &mdash; calling an MCP tool, running TypeScript code, prompting an LLM,
                making a decision, or waiting for human input. Data flows from one node to the next automatically.
              </p>
              <p>
                OpenShopFloor uses a <strong>hybrid execution model</strong>: custom OSF nodes run through our optimized engine
                with SSE streaming, while all native Node-RED nodes (switch, change, function, http-request, etc.) are also
                fully supported. You get the best of both worlds.
              </p>
            </Section>

            <Section title="Getting Started">
              <ol className="list-decimal list-inside space-y-3">
                <li>
                  <strong>Open the Editor</strong> &mdash; Go to{' '}
                  <Link href="/flows" className="text-accent hover:underline">Flows</Link>{' '}
                  and click &quot;Open Editor&quot;. The Node-RED editor opens in a full-screen view.
                </li>
                <li>
                  <strong>Add Nodes</strong> &mdash; Drag nodes from the left palette onto the canvas.
                  Look for the &quot;OpenShopFloor&quot; category for custom OSF nodes, or use any native Node-RED node.
                </li>
                <li>
                  <strong>Connect Nodes</strong> &mdash; Draw wires between node outputs and inputs to define the execution order.
                  Nodes can have multiple inputs and outputs.
                </li>
                <li>
                  <strong>Configure</strong> &mdash; Double-click a node to set its parameters (which tool to call, template text, LLM settings, etc.).
                </li>
                <li>
                  <strong>Save</strong> &mdash; Click the Save button in the top bar. Give your flow a name and description.
                </li>
                <li>
                  <strong>Run</strong> &mdash; Go back to the Flows listing and click Run on your saved flow. Results stream in real time.
                </li>
              </ol>
            </Section>

            <Section title="OSF Custom Nodes">
              <p className="mb-4">These are the custom OpenShopFloor nodes, purpose-built for manufacturing AI workflows.</p>
              <div className="space-y-4">
                <NodeType
                  name="osf-ts"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Run custom TypeScript code in a secure V8 sandbox. Full access to MCP tools, LLM, and storage via the SDK. Supports multi-output: configure 1-5 output ports and return an array to route data to different paths."
                  config="Write TypeScript code. Set the number of outputs (1-5). Return a single value or an array for multi-output."
                />
                <NodeType
                  name="osf-context"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Aggregates data from multiple upstream nodes into a single JSON object. Each input is keyed by the source node's label. Connect multiple nodes into one context to collect data before sending it to an LLM."
                  config="Optional: Override key names for each input source."
                />
                <NodeType
                  name="osf-prompt-tpl"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Template engine for building LLM prompts. Use ${context} and ${input} placeholders to inject data from upstream nodes. Great for crafting structured prompts with dynamic data."
                  config="Write your template text with ${context} and ${input} variables."
                />
                <NodeType
                  name="osf-llm"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Send messages to an LLM with per-node configuration. Accepts two inputs: context (from osf-context, sent as system message) and prompt (from osf-prompt-tpl, sent as user message). Supports JSON mode for structured output."
                  config="Set LLM URL, model, temperature, and toggle JSON mode. Connect osf-context and osf-prompt-tpl as inputs."
                />
                <NodeType
                  name="osf-http"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Make HTTP requests to external APIs. Supports GET, POST, PUT, DELETE with custom headers, authentication, and JSON mode. URL supports template variables."
                  config="Set method, URL, headers, auth token, timeout, and JSON mode."
                />
                <NodeType
                  name="osf-sub-flow"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Call another saved flow as a sub-routine. The sub-flow receives the current node's input and returns its final output. Includes recursion protection (max depth 5)."
                  config="Enter the Flow ID to call and set max recursion depth."
                />
                <NodeType
                  name="osf-output-parser"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Validate and parse JSON output against a schema. If validation fails, automatically retries by asking the LLM to fix the output. Ensures structured, reliable data from LLM responses."
                  config="Define a JSON schema. Set max retry attempts (1-5)."
                />
                <NodeType
                  name="osf-decision"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Conditional branching. Route the flow to different paths based on the previous node's output using configurable conditions."
                  config="Define conditions for each output port (e.g., 'has-errors', 'always', 'never')."
                />
                <NodeType
                  name="osf-agent"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Run an existing AI agent (built-in or community). The agent performs its full analysis with MCP tool calls and returns the result."
                  config="Select the agent by name from the dropdown."
                />
                <NodeType
                  name="osf-prompt"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Send a prompt to the LLM. Supports template variables using {{input}} to inject data from the previous node."
                  config="Write your prompt template. Use {{input}} to reference the output of the previous node."
                />
                <NodeType
                  name="osf-human-input"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Pause the flow and wait for human approval or input. The flow resumes when the user responds."
                  config="Set the prompt text and optional choices."
                />
              </div>

              <h3 className="font-semibold text-sm mt-6 mb-2">MCP Tool Nodes</h3>
              <div className="space-y-4">
                <NodeType
                  name="osf-mcp-erp"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Call a tool from the ERP MCP server. Access production orders, customer data, delivery schedules, and more."
                  config="Select the tool and configure its parameters."
                />
                <NodeType
                  name="osf-mcp-fertigung"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Call a tool from the Manufacturing MCP server. Access machine data, OEE metrics, production status."
                  config="Select the tool and configure its parameters."
                />
                <NodeType
                  name="osf-mcp-qms"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Call a tool from the Quality Management (QMS) MCP server. Access defect reports, quality metrics, audit data."
                  config="Select the tool and configure its parameters."
                />
                <NodeType
                  name="osf-mcp-tms"
                  color="bg-orange-500/10 text-orange-400 border-orange-500/20"
                  description="Call a tool from the Tool Management (TMS) MCP server. Access tool inventory, usage history, maintenance schedules."
                  config="Select the tool and configure its parameters."
                />
              </div>
            </Section>

            <Section title="Native Node-RED Nodes">
              <p className="mb-4">
                All standard Node-RED nodes are available in the editor and fully supported by the execution engine.
                Here are the most commonly used ones for AI workflows:
              </p>
              <div className="space-y-4">
                <NodeType
                  name="switch"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Route messages based on property values. Supports equality, comparison, range, regex, and more. Each rule maps to an output port."
                  config="Set the property to evaluate and define rules for each output."
                />
                <NodeType
                  name="change"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Set, change, delete, or move properties on the message object. Useful for transforming data between nodes."
                  config="Add rules: set a value, change (find/replace), delete, or move a property."
                />
                <NodeType
                  name="template"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Mustache-style template rendering. Use {{payload.field}} syntax to build strings from message data."
                  config="Write a Mustache template. Access message properties with double braces."
                />
                <NodeType
                  name="function"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Run custom JavaScript code. Receives a msg object and can modify or create new messages. Supports multiple outputs."
                  config="Write JavaScript. Return msg to pass it on, or return an array for multiple outputs."
                />
                <NodeType
                  name="http request"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Make HTTP requests to external services. Supports all methods, custom headers, authentication, and response parsing."
                  config="Set URL, method, headers, and payload. Response is available in msg.payload."
                />
                <NodeType
                  name="split / join"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Split arrays or objects into individual messages, or join multiple messages back together. Useful for parallel processing."
                  config="Split: choose array, string, or object mode. Join: set count or timeout."
                />
                <NodeType
                  name="delay"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Delay message delivery by a configurable amount of time (max 60 seconds in the OSF engine)."
                  config="Set delay duration in seconds."
                />
                <NodeType
                  name="debug"
                  color="bg-sky-500/10 text-sky-400 border-sky-500/20"
                  description="Log message data to the Node-RED debug sidebar and the OSF run output. Passes the message through unchanged."
                  config="Choose what to display: full message or specific property."
                />
              </div>
            </Section>

            <Section title="Multi-Output Nodes">
              <p>
                Some nodes support multiple output ports, letting you route data to different downstream paths:
              </p>
              <ul className="list-disc list-inside space-y-2 mt-3">
                <li><strong>osf-ts</strong> &mdash; Configure 1-5 outputs. Return an array where each element goes to the corresponding port.</li>
                <li><strong>osf-decision</strong> &mdash; Each condition maps to a separate output port.</li>
                <li><strong>switch</strong> &mdash; Each rule creates an output port for conditional routing.</li>
                <li><strong>function</strong> &mdash; Return an array of messages for multiple outputs.</li>
                <li><strong>split</strong> &mdash; Splits a single message into multiple messages.</li>
              </ul>
            </Section>

            <Section title="Multi-Input Nodes">
              <p>
                Nodes like <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-context</code> and{' '}
                <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-llm</code> accept multiple inputs.
                The engine waits for <strong>all</strong> upstream nodes to complete before executing a multi-input node.
              </p>
              <ul className="list-disc list-inside space-y-2 mt-3">
                <li><strong>osf-context</strong> &mdash; Merges all upstream outputs into a single JSON object, keyed by source node label.</li>
                <li><strong>osf-llm</strong> &mdash; Expects two inputs: context (system message from osf-context) and prompt (user message from osf-prompt-tpl).</li>
                <li><strong>join</strong> &mdash; Collects multiple messages and combines them into an array or object.</li>
              </ul>
            </Section>

            <Section title="How Execution Works">
              <ol className="list-decimal list-inside space-y-2">
                <li>The flow engine builds a directed acyclic graph (DAG) from your nodes and wires.</li>
                <li>Entry nodes (no incoming connections) execute first.</li>
                <li>Each node receives the output of its predecessor as context. Multi-input nodes receive all upstream outputs.</li>
                <li>Execution proceeds in topological order &mdash; all dependencies must complete before a node runs.</li>
                <li>Multi-output nodes route data to specific downstream paths based on port index.</li>
                <li>If a <code className="text-accent bg-accent/10 px-1 rounded text-xs">human-input</code> node is reached, the flow pauses until the user responds.</li>
                <li>Results are streamed in real time via SSE (Server-Sent Events).</li>
              </ol>
            </Section>

            <Section title="Example: OEE Analysis Pipeline">
              <p className="mb-3">A modular flow that collects data from multiple sources, builds context, and generates an analysis:</p>
              <div className="rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
                <div className="text-text-dim mb-2">{'// Flow: OEE Analysis with Context + LLM'}</div>
                <div><span className="text-orange-400">[osf-mcp-fertigung]</span> Get OEE data &mdash;&mdash;&mdash;&mdash;\</div>
                <div><span className="text-orange-400">[osf-mcp-erp]</span> Get production orders &mdash;\</div>
                <div className="text-text-dim pl-40">|</div>
                <div className="pl-20"><span className="text-orange-400">[osf-context]</span> Merge all data</div>
                <div className="text-text-dim pl-32">|</div>
                <div className="pl-20"><span className="text-orange-400">[osf-llm]</span> Analyze OEE &larr; <span className="text-orange-400">[osf-prompt-tpl]</span></div>
                <div className="text-text-dim pl-32">|</div>
                <div className="pl-20"><span className="text-orange-400">[osf-output-parser]</span> Validate JSON schema</div>
              </div>
            </Section>

            <Section title="Example: Quality Alert Flow">
              <p className="mb-3">A flow that monitors defects and escalates to a human when quality drops:</p>
              <div className="rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
                <div className="text-text-dim mb-2">{'// Flow: Quality Alert Pipeline'}</div>
                <div><span className="text-orange-400">[osf-mcp-qms]</span> Get defect summary</div>
                <div className="text-text-dim pl-6">|</div>
                <div><span className="text-orange-400">[osf-prompt]</span> &quot;Analyze defects: {'{{input}}'}&quot;</div>
                <div className="text-text-dim pl-6">|</div>
                <div><span className="text-orange-400">[osf-decision]</span> Has critical defects?</div>
                <div className="text-text-dim pl-6">|--- Yes ---</div>
                <div className="pl-12"><span className="text-orange-400">[osf-human-input]</span> &quot;Critical defects found. Approve shutdown?&quot;</div>
                <div className="text-text-dim pl-6">|--- No ---</div>
                <div className="pl-12"><span className="text-orange-400">[osf-agent]</span> Run Quality Guard agent</div>
              </div>
            </Section>

            <Section title="Tips & Best Practices">
              <ul className="list-disc list-inside space-y-2">
                <li><strong>Start simple</strong> &mdash; begin with 2-3 nodes and add complexity gradually.</li>
                <li><strong>Use osf-context for multi-source data</strong> &mdash; collect data from multiple MCP/TS nodes before sending to the LLM.</li>
                <li><strong>Use osf-prompt-tpl for structured prompts</strong> &mdash; separate your prompt template from data collection.</li>
                <li><strong>Add human checkpoints</strong> &mdash; use human-input nodes before destructive or high-impact actions.</li>
                <li><strong>Validate LLM output</strong> &mdash; use osf-output-parser after osf-llm to ensure structured JSON responses.</li>
                <li><strong>Use debug nodes</strong> &mdash; attach debug nodes to inspect data at any point in the flow.</li>
                <li><strong>Name your nodes</strong> &mdash; double-click and set a descriptive name. osf-context uses these names as JSON keys.</li>
                <li><strong>Native nodes for data transforms</strong> &mdash; use switch, change, and template nodes for routing and transforming data without writing code.</li>
                <li><strong>One tab per flow</strong> &mdash; each Node-RED tab becomes a separate saveable flow.</li>
              </ul>
            </Section>

            <Section title="Keyboard Shortcuts">
              <table className="w-full text-sm border border-border rounded-md overflow-hidden">
                <thead><tr className="bg-bg-surface-2 text-text-dim"><th className="text-left p-3">Shortcut</th><th className="text-left p-3">Action</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Ctrl + A</td><td className="p-3 text-text-muted">Select all nodes</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Ctrl + C / V</td><td className="p-3 text-text-muted">Copy / paste nodes</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Delete</td><td className="p-3 text-text-muted">Delete selected nodes</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Ctrl + Z</td><td className="p-3 text-text-muted">Undo</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Double-click</td><td className="p-3 text-text-muted">Edit node properties</td></tr>
                  <tr className="border-t border-border"><td className="p-3 font-mono text-xs">Ctrl + Space</td><td className="p-3 text-text-muted">Quick-add node</td></tr>
                </tbody>
              </table>
            </Section>
          </div>
        </div>
      </section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-6 bg-bg-surface">
      <h2 className="text-xl font-bold mb-4">{title}</h2>
      <div className="text-sm text-text-muted leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

function NodeType({ name, color, description, config }: { name: string; color: string; description: string; config: string }) {
  return (
    <div className="border border-border rounded-md p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${color}`}>{name}</span>
      </div>
      <p className="text-text-muted text-sm mb-1">{description}</p>
      <p className="text-text-dim text-xs"><strong>Config:</strong> {config}</p>
    </div>
  );
}
