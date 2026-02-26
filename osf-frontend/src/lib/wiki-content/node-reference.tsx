import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

function NodeCard({
  name,
  variant,
  description,
  config,
}: {
  name: string;
  variant: "osf" | "mcp" | "native";
  description: string;
  config: string;
}) {
  const colors = {
    osf: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    mcp: "bg-green-500/10 text-green-400 border-green-500/20",
    native: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  };
  return (
    <div className="border border-border rounded-md p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded border ${colors[variant]}`}
        >
          {name}
        </span>
      </div>
      <p className="text-text-muted text-sm mb-1">{description}</p>
      <p className="text-text-dim text-xs">
        <strong>Config:</strong> {config}
      </p>
    </div>
  );
}

export function NodeReferenceContent() {
  return (
    <>
      <WikiSection title="Core Processing Nodes">
        <div className="space-y-4">
          <NodeCard
            name="osf-ts"
            variant="osf"
            description="Run custom TypeScript code in a secure V8 sandbox. Full access to MCP tools, LLM, and storage via the SDK. Supports multi-output: configure 1-5 output ports and return an array to route data to different paths."
            config="Write TypeScript code. Set the number of outputs (1-5). Return a single value or an array for multi-output."
          />
          <NodeCard
            name="osf-prompt"
            variant="osf"
            description="Send a prompt to the LLM. Supports template variables using {{input}} to inject data from the previous node."
            config="Write your prompt template. Use {{input}} to reference the output of the previous node."
          />
          <NodeCard
            name="osf-prompt-tpl"
            variant="osf"
            description="Template engine for building LLM prompts. Use ${context} and ${input} placeholders to inject data from upstream nodes. Great for crafting structured prompts with dynamic data."
            config="Write your template text with ${context} and ${input} variables."
          />
          <NodeCard
            name="osf-llm"
            variant="osf"
            description="Send messages to an LLM with per-node configuration. Accepts two inputs: context (from osf-context, sent as system message) and prompt (from osf-prompt-tpl, sent as user message). Supports JSON mode for structured output."
            config="Set LLM URL, model, temperature, and toggle JSON mode. Connect osf-context and osf-prompt-tpl as inputs."
          />
          <NodeCard
            name="osf-output-parser"
            variant="osf"
            description="Validate and parse JSON output against a schema. If validation fails, automatically retries by asking the LLM to fix the output. Ensures structured, reliable data from LLM responses."
            config="Define a JSON schema. Set max retry attempts (1-5)."
          />
        </div>
      </WikiSection>

      <WikiSection title="Data & Context Nodes">
        <div className="space-y-4">
          <NodeCard
            name="osf-context"
            variant="osf"
            description="Aggregates data from multiple upstream nodes into a single JSON object. Each input is keyed by the source node's label. Connect multiple nodes into one context to collect data before sending it to an LLM."
            config="Optional: Override key names for each input source."
          />
          <NodeCard
            name="osf-http"
            variant="osf"
            description="Make HTTP requests to external APIs. Supports GET, POST, PUT, DELETE with custom headers, authentication, and JSON mode. URL supports template variables."
            config="Set method, URL, headers, auth token, timeout, and JSON mode."
          />
        </div>
      </WikiSection>

      <WikiSection title="Flow Control Nodes">
        <div className="space-y-4">
          <NodeCard
            name="osf-decision"
            variant="osf"
            description="Conditional branching. Route the flow to different paths based on the previous node's output using configurable conditions."
            config="Define conditions for each output port (e.g., 'has-errors', 'always', 'never')."
          />
          <NodeCard
            name="osf-sub-flow"
            variant="osf"
            description="Call another saved flow as a sub-routine. The sub-flow receives the current node's input and returns its final output. Includes recursion protection (max depth 5)."
            config="Enter the Flow ID to call and set max recursion depth."
          />
          <NodeCard
            name="osf-human-input"
            variant="osf"
            description="Pause the flow and wait for human approval or input. The flow resumes when the user responds."
            config="Set the prompt text and optional choices."
          />
        </div>
      </WikiSection>

      <WikiSection title="Agent Node">
        <div className="space-y-4">
          <NodeCard
            name="osf-agent"
            variant="osf"
            description="Run an existing AI agent (built-in or community). The agent performs its full analysis with MCP tool calls and returns the result."
            config="Select the agent by name from the dropdown."
          />
        </div>
      </WikiSection>

      <WikiSection title="MCP Tool Nodes">
        <WikiCallout type="info">
          MCP nodes connect directly to the factory simulation&apos;s MCP servers.
          Each node provides a dropdown to select a specific tool and configure its
          parameters.
        </WikiCallout>
        <div className="space-y-4 mt-4">
          <NodeCard
            name="osf-mcp-erp"
            variant="mcp"
            description="Call a tool from the ERP MCP server. Access production orders, customer data, delivery schedules, and more."
            config="Select the tool and configure its parameters."
          />
          <NodeCard
            name="osf-mcp-fertigung"
            variant="mcp"
            description="Call a tool from the Manufacturing MCP server. Access machine data, OEE metrics, production status."
            config="Select the tool and configure its parameters."
          />
          <NodeCard
            name="osf-mcp-qms"
            variant="mcp"
            description="Call a tool from the Quality Management (QMS) MCP server. Access defect reports, quality metrics, audit data."
            config="Select the tool and configure its parameters."
          />
          <NodeCard
            name="osf-mcp-tms"
            variant="mcp"
            description="Call a tool from the Tool Management (TMS) MCP server. Access tool inventory, usage history, maintenance schedules."
            config="Select the tool and configure its parameters."
          />
        </div>
      </WikiSection>

      <WikiSection title="Native Node-RED Nodes">
        <p className="mb-4">
          All standard Node-RED nodes are available in the editor. Here are the most
          commonly used ones for AI workflows:
        </p>
        <div className="space-y-4">
          <NodeCard
            name="switch"
            variant="native"
            description="Route messages based on property values. Supports equality, comparison, range, regex, and more. Each rule maps to an output port."
            config="Set the property to evaluate and define rules for each output."
          />
          <NodeCard
            name="change"
            variant="native"
            description="Set, change, delete, or move properties on the message object. Useful for transforming data between nodes."
            config="Add rules: set a value, change (find/replace), delete, or move a property."
          />
          <NodeCard
            name="template"
            variant="native"
            description="Mustache-style template rendering. Use {{payload.field}} syntax to build strings from message data."
            config="Write a Mustache template. Access message properties with double braces."
          />
          <NodeCard
            name="function"
            variant="native"
            description="Run custom JavaScript code. Receives a msg object and can modify or create new messages. Supports multiple outputs."
            config="Write JavaScript. Return msg to pass it on, or return an array for multiple outputs."
          />
          <NodeCard
            name="http request"
            variant="native"
            description="Make HTTP requests to external services. Supports all methods, custom headers, authentication, and response parsing."
            config="Set URL, method, headers, and payload. Response is available in msg.payload."
          />
          <NodeCard
            name="split / join"
            variant="native"
            description="Split arrays or objects into individual messages, or join multiple messages back together. Useful for parallel processing."
            config="Split: choose array, string, or object mode. Join: set count or timeout."
          />
          <NodeCard
            name="delay"
            variant="native"
            description="Delay message delivery by a configurable amount of time (max 60 seconds in the OSF engine)."
            config="Set delay duration in seconds."
          />
          <NodeCard
            name="debug"
            variant="native"
            description="Log message data to the Node-RED debug sidebar and the OSF run output. Passes the message through unchanged."
            config="Choose what to display: full message or specific property."
          />
        </div>
      </WikiSection>
    </>
  );
}
