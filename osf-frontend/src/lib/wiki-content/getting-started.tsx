import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function GettingStartedContent() {
  return (
    <>
      <WikiSection title="What is OpenShopFloor?">
        <p>
          OpenShopFloor (OSF) is an open-source factory AI sandbox. It provides a
          complete manufacturing simulation with real-time machine data, production
          orders, quality metrics, and tool management &mdash; all accessible through
          111 MCP (Model Context Protocol) tools. You can build AI agents that
          monitor, analyze, and optimize factory operations.
        </p>
      </WikiSection>

      <WikiSection title="1. Create an Account">
        <p>
          Go to{" "}
          <Link href="/register" className="text-accent hover:underline">
            openshopfloor.zeroguess.ai/register
          </Link>{" "}
          and create a free account. You&apos;ll need an email address and password.
          After registration you&apos;re automatically logged in and can start
          exploring.
        </p>
        <WikiCallout type="info">
          OSF is free to use. No credit card required. Your account gives you
          access to all features including the chat, agents, flows, and the full
          MCP tool suite.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="2. Explore the Chat">
        <p>
          The quickest way to interact with the factory is through the{" "}
          <Link href="/chat" className="text-accent hover:underline">
            AI Chat
          </Link>
          . The chat assistant has access to all 111 MCP tools and can answer
          questions about your factory in real time:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>&quot;What&apos;s the current OEE across all machines?&quot;</li>
          <li>&quot;Show me all open production orders&quot;</li>
          <li>&quot;Are there any quality issues today?&quot;</li>
          <li>&quot;Which machines are idle right now?&quot;</li>
        </ul>
        <p>
          The assistant will call the appropriate MCP tools, retrieve live data from
          the factory simulation, and present the results with analysis.
        </p>
      </WikiSection>

      <WikiSection title="3. Run Your First Agent">
        <p>
          Agents are pre-built AI routines that perform specific factory tasks. Go
          to{" "}
          <Link href="/agents" className="text-accent hover:underline">
            Agents
          </Link>{" "}
          and try one of the built-in agents:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>OEE Optimizer</strong> &mdash; Analyzes OEE data and suggests
            improvements
          </li>
          <li>
            <strong>Quality Guard</strong> &mdash; Monitors defect rates and
            identifies quality issues
          </li>
          <li>
            <strong>Delivery Tracker</strong> &mdash; Checks at-risk orders and
            suggests corrective actions
          </li>
        </ul>
        <p>
          Click &quot;Run&quot; on any agent to see it execute. The output streams in
          real time as the agent calls MCP tools and analyzes data.
        </p>
      </WikiSection>

      <WikiSection title="4. Build Your First Flow">
        <p>
          Flows let you chain multiple AI operations in a visual editor. Go to{" "}
          <Link href="/flows" className="text-accent hover:underline">
            Flows
          </Link>{" "}
          and click &quot;Open Editor&quot; to launch the Node-RED-based flow editor.
        </p>
        <ol className="list-decimal list-inside space-y-2 mt-2">
          <li>Drag an <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-mcp-fertigung</code> node onto the canvas</li>
          <li>Configure it to call <code className="text-accent bg-accent/10 px-1 rounded text-xs">factory_get_latest_oee</code></li>
          <li>Add an <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-prompt</code> node and connect it</li>
          <li>Set the prompt to: &quot;Analyze this OEE data: {"{{input}}"}&quot;</li>
          <li>Save and run &mdash; watch the LLM analyze your factory data</li>
        </ol>
        <WikiCallout type="tip">
          Check the{" "}
          <Link href="/docs/wiki/visual-flows" className="text-accent hover:underline">
            Visual Flows Guide
          </Link>{" "}
          for a complete walkthrough of all node types and patterns.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="5. Deploy a Code Agent">
        <p>
          For more complex logic, write a TypeScript agent and deploy it from
          GitHub:
        </p>
        <ol className="list-decimal list-inside space-y-2 mt-2">
          <li>
            Connect your GitHub account in{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>
          </li>
          <li>
            Create a repo with <code className="text-accent bg-accent/10 px-1 rounded text-xs">osf-agent.yaml</code> and{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">src/main.ts</code>
          </li>
          <li>Deploy from Agents &rarr; Deploy from GitHub</li>
        </ol>
        <WikiCallout type="tip">
          See the{" "}
          <Link href="/docs/wiki/code-agents" className="text-accent hover:underline">
            Code Agents Guide
          </Link>{" "}
          for the full SDK reference and examples.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Next Steps">
        <ul className="list-disc list-inside space-y-2">
          <li>
            <Link href="/docs/wiki/architecture" className="text-accent hover:underline">
              Architecture Overview
            </Link>{" "}
            &mdash; Understand how the system works
          </li>
          <li>
            <Link href="/docs/wiki/node-reference" className="text-accent hover:underline">
              Node Reference
            </Link>{" "}
            &mdash; All 16 custom Node-RED nodes
          </li>
          <li>
            <Link href="/docs/wiki/api-reference" className="text-accent hover:underline">
              API Reference
            </Link>{" "}
            &mdash; REST API endpoints
          </li>
          <li>
            <Link href="/docs/wiki/factory-simulation" className="text-accent hover:underline">
              Factory Simulation
            </Link>{" "}
            &mdash; What the simulated factory looks like
          </li>
          <li>
            <Link href="/challenges" className="text-accent hover:underline">
              Challenges
            </Link>{" "}
            &mdash; Test your skills with factory optimization challenges
          </li>
        </ul>
      </WikiSection>
    </>
  );
}
