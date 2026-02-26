import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function VisualFlowsContent() {
  return (
    <>
      <WikiSection title="What are Flows?">
        <p>
          Flows let you chain multiple AI operations together in a visual graph
          editor powered by Node-RED. Each node in your flow performs one action
          &mdash; calling an MCP tool, running TypeScript code, prompting an LLM,
          making a decision, or waiting for human input. Data flows from one node
          to the next automatically.
        </p>
        <p>
          OpenShopFloor uses a <strong>hybrid execution model</strong>: custom OSF
          nodes run through the optimized OSF engine with SSE streaming, while all
          native Node-RED nodes (switch, change, function, http-request, etc.) are
          fully supported.
        </p>
      </WikiSection>

      <WikiSection title="Getting Started">
        <ol className="list-decimal list-inside space-y-3">
          <li>
            <strong>Open the Editor</strong> &mdash; Go to{" "}
            <Link href="/flows" className="text-accent hover:underline">
              Flows
            </Link>{" "}
            and click &quot;Open Editor&quot;. The Node-RED editor opens in a
            full-screen view.
          </li>
          <li>
            <strong>Add Nodes</strong> &mdash; Drag nodes from the left palette
            onto the canvas. Look for the &quot;OpenShopFloor&quot; category for
            custom OSF nodes.
          </li>
          <li>
            <strong>Connect Nodes</strong> &mdash; Draw wires between node outputs
            and inputs to define the execution order.
          </li>
          <li>
            <strong>Configure</strong> &mdash; Double-click a node to set its
            parameters (which tool to call, template text, LLM settings, etc.).
          </li>
          <li>
            <strong>Save</strong> &mdash; Click the Save button in the top bar.
            Give your flow a name and description.
          </li>
          <li>
            <strong>Run</strong> &mdash; Go back to the Flows listing and click Run
            on your saved flow. Results stream in real time.
          </li>
        </ol>
      </WikiSection>

      <WikiSection title="Multi-Output Nodes">
        <p>
          Some nodes support multiple output ports, letting you route data to
          different downstream paths:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-3">
          <li>
            <strong>osf-ts</strong> &mdash; Configure 1-5 outputs. Return an array
            where each element goes to the corresponding port.
          </li>
          <li>
            <strong>osf-decision</strong> &mdash; Each condition maps to a separate
            output port.
          </li>
          <li>
            <strong>switch</strong> &mdash; Each rule creates an output port for
            conditional routing.
          </li>
          <li>
            <strong>function</strong> &mdash; Return an array of messages for
            multiple outputs.
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="Multi-Input Nodes">
        <p>
          Nodes like{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            osf-context
          </code>{" "}
          and{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            osf-llm
          </code>{" "}
          accept multiple inputs. The engine waits for <strong>all</strong> upstream
          nodes to complete before executing a multi-input node.
        </p>
        <ul className="list-disc list-inside space-y-2 mt-3">
          <li>
            <strong>osf-context</strong> &mdash; Merges all upstream outputs into a
            single JSON object, keyed by source node label.
          </li>
          <li>
            <strong>osf-llm</strong> &mdash; Expects two inputs: context (system
            message from osf-context) and prompt (user message from osf-prompt-tpl).
          </li>
          <li>
            <strong>join</strong> &mdash; Collects multiple messages and combines
            them into an array or object.
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="Execution Model">
        <ol className="list-decimal list-inside space-y-2">
          <li>
            The flow engine builds a directed acyclic graph (DAG) from your nodes
            and wires.
          </li>
          <li>Entry nodes (no incoming connections) execute first.</li>
          <li>
            Each node receives the output of its predecessor as context. Multi-input
            nodes receive all upstream outputs.
          </li>
          <li>
            Execution proceeds in topological order &mdash; all dependencies must
            complete before a node runs.
          </li>
          <li>
            Multi-output nodes route data to specific downstream paths based on port
            index.
          </li>
          <li>
            If a{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">
              human-input
            </code>{" "}
            node is reached, the flow pauses until the user responds.
          </li>
          <li>Results are streamed in real time via SSE (Server-Sent Events).</li>
        </ol>
      </WikiSection>

      <WikiSection title="Example: OEE Analysis Pipeline">
        <p className="mb-3">
          A modular flow that collects data from multiple sources, builds context,
          and generates an analysis:
        </p>
        <div className="rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">
            {"// Flow: OEE Analysis with Context + LLM"}
          </div>
          <div>
            <span className="text-orange-400">[osf-mcp-fertigung]</span> Get OEE
            data &mdash;&mdash;&mdash;&mdash;\
          </div>
          <div>
            <span className="text-orange-400">[osf-mcp-erp]</span> Get production
            orders &mdash;\
          </div>
          <div className="text-text-dim pl-40">|</div>
          <div className="pl-20">
            <span className="text-orange-400">[osf-context]</span> Merge all data
          </div>
          <div className="text-text-dim pl-32">|</div>
          <div className="pl-20">
            <span className="text-orange-400">[osf-llm]</span> Analyze OEE &larr;{" "}
            <span className="text-orange-400">[osf-prompt-tpl]</span>
          </div>
          <div className="text-text-dim pl-32">|</div>
          <div className="pl-20">
            <span className="text-orange-400">[osf-output-parser]</span> Validate
            JSON schema
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Example: Quality Alert Flow">
        <p className="mb-3">
          A flow that monitors defects and escalates to a human when quality drops:
        </p>
        <div className="rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">
            {"// Flow: Quality Alert Pipeline"}
          </div>
          <div>
            <span className="text-orange-400">[osf-mcp-qms]</span> Get defect
            summary
          </div>
          <div className="text-text-dim pl-6">|</div>
          <div>
            <span className="text-orange-400">[osf-prompt]</span> &quot;Analyze
            defects: {"{{input}}"}&quot;
          </div>
          <div className="text-text-dim pl-6">|</div>
          <div>
            <span className="text-orange-400">[osf-decision]</span> Has critical
            defects?
          </div>
          <div className="text-text-dim pl-6">|--- Yes ---</div>
          <div className="pl-12">
            <span className="text-orange-400">[osf-human-input]</span> &quot;Critical
            defects found. Approve shutdown?&quot;
          </div>
          <div className="text-text-dim pl-6">|--- No ---</div>
          <div className="pl-12">
            <span className="text-orange-400">[osf-agent]</span> Run Quality Guard
            agent
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Tips & Best Practices">
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Start simple</strong> &mdash; begin with 2-3 nodes and add
            complexity gradually.
          </li>
          <li>
            <strong>Use osf-context for multi-source data</strong> &mdash; collect
            data from multiple MCP/TS nodes before sending to the LLM.
          </li>
          <li>
            <strong>Use osf-prompt-tpl for structured prompts</strong> &mdash;
            separate your prompt template from data collection.
          </li>
          <li>
            <strong>Add human checkpoints</strong> &mdash; use human-input nodes
            before destructive or high-impact actions.
          </li>
          <li>
            <strong>Validate LLM output</strong> &mdash; use osf-output-parser after
            osf-llm to ensure structured JSON responses.
          </li>
          <li>
            <strong>Use debug nodes</strong> &mdash; attach debug nodes to inspect
            data at any point in the flow.
          </li>
          <li>
            <strong>Name your nodes</strong> &mdash; double-click and set a
            descriptive name. osf-context uses these names as JSON keys.
          </li>
          <li>
            <strong>One tab per flow</strong> &mdash; each Node-RED tab becomes a
            separate saveable flow.
          </li>
        </ul>
        <WikiCallout type="tip">
          For a complete reference of all node types, see the{" "}
          <Link
            href="/docs/wiki/node-reference"
            className="text-accent hover:underline"
          >
            Node Reference
          </Link>
          .
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Keyboard Shortcuts">
        <table className="w-full text-sm border border-border rounded-md overflow-hidden">
          <thead>
            <tr className="bg-bg-surface-2 text-text-dim">
              <th className="text-left p-3">Shortcut</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Ctrl + A</td>
              <td className="p-3 text-text-muted">Select all nodes</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Ctrl + C / V</td>
              <td className="p-3 text-text-muted">Copy / paste nodes</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Delete</td>
              <td className="p-3 text-text-muted">Delete selected nodes</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Ctrl + Z</td>
              <td className="p-3 text-text-muted">Undo</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Double-click</td>
              <td className="p-3 text-text-muted">Edit node properties</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs">Ctrl + Space</td>
              <td className="p-3 text-text-muted">Quick-add node</td>
            </tr>
          </tbody>
        </table>
      </WikiSection>
    </>
  );
}
