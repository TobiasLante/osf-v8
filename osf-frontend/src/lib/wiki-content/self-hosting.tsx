import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

function Code({ filename, children }: { filename: string; children: string }) {
  return (
    <div className="mt-3 mb-3 rounded-md border border-border overflow-hidden">
      <div className="bg-bg-surface-2 px-3 py-1.5 text-xs text-text-dim font-mono border-b border-border">
        {filename}
      </div>
      <pre className="bg-[#0d1117] p-4 text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function SelfHostingContent() {
  return (
    <>
      <WikiSection title="Prerequisites">
        <ul className="list-disc list-inside space-y-2">
          <li>Node.js 18+ and npm</li>
          <li>An OpenAI-compatible LLM endpoint (local or cloud)</li>
          <li>Git</li>
          <li>
            Optional: Docker and Kubernetes for production deployments
          </li>
        </ul>
      </WikiSection>

      <WikiSection title="Quick Start (Development)">
        <p>The fastest way to get OSF running locally:</p>
        <Code filename="Terminal">{`# Clone the repositories
git clone https://github.com/TobiasLante/openshopfloor.git
git clone https://github.com/TobiasLante/openshopfloor-gateway.git

# Frontend
cd openshopfloor
npm install
npm run dev
# → http://localhost:3000

# Gateway (in another terminal)
cd openshopfloor-gateway
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
# → http://localhost:3001`}</Code>
        <WikiCallout type="warning">
          You need to configure at least the LLM endpoint and JWT secret in the{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            .env
          </code>{" "}
          file before the gateway will work correctly.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Environment Variables">
        <p>
          Key environment variables for the gateway (
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            .env
          </code>
          ):
        </p>
        <table className="w-full text-sm border border-border rounded-md overflow-hidden mt-3">
          <thead>
            <tr className="bg-bg-surface-2 text-text-dim">
              <th className="text-left p-3">Variable</th>
              <th className="text-left p-3">Description</th>
              <th className="text-left p-3">Example</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">JWT_SECRET</td>
              <td className="p-3 text-text-muted">Secret for JWT signing</td>
              <td className="p-3 text-text-dim text-xs">a-long-random-string</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">LLM_URL</td>
              <td className="p-3 text-text-muted">
                OpenAI-compatible chat endpoint
              </td>
              <td className="p-3 text-text-dim text-xs">
                http://localhost:5001/v1
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                LLM_SPECIALIST_URL
              </td>
              <td className="p-3 text-text-muted">
                Specialist model endpoint (optional, falls back to LLM_URL)
              </td>
              <td className="p-3 text-text-dim text-xs">
                http://localhost:5002/v1
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                MCP_ERP_URL
              </td>
              <td className="p-3 text-text-muted">ERP MCP server URL</td>
              <td className="p-3 text-text-dim text-xs">
                http://mcp-erp:8021
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                MCP_WMS_URL
              </td>
              <td className="p-3 text-text-muted">WMS MCP server URL</td>
              <td className="p-3 text-text-dim text-xs">
                http://mcp-wms:8022
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                MCP_QMS_URL
              </td>
              <td className="p-3 text-text-muted">QMS MCP server URL</td>
              <td className="p-3 text-text-dim text-xs">
                http://mcp-qms:8023
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                MCP_MFG_URL
              </td>
              <td className="p-3 text-text-muted">
                Manufacturing MCP server URL
              </td>
              <td className="p-3 text-text-dim text-xs">
                http://mcp-fertigung:8024
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">PORT</td>
              <td className="p-3 text-text-muted">Gateway port</td>
              <td className="p-3 text-text-dim text-xs">3001</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                FRONTEND_URL
              </td>
              <td className="p-3 text-text-muted">
                Frontend URL (for CORS)
              </td>
              <td className="p-3 text-text-dim text-xs">
                http://localhost:3000
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                GITHUB_CLIENT_ID
              </td>
              <td className="p-3 text-text-muted">
                GitHub OAuth app client ID (optional)
              </td>
              <td className="p-3 text-text-dim text-xs">&mdash;</td>
            </tr>
            <tr className="border-t border-border">
              <td className="p-3 font-mono text-xs text-accent">
                GITHUB_CLIENT_SECRET
              </td>
              <td className="p-3 text-text-muted">
                GitHub OAuth app secret (optional)
              </td>
              <td className="p-3 text-text-dim text-xs">&mdash;</td>
            </tr>
          </tbody>
        </table>
      </WikiSection>

      <WikiSection title="Docker">
        <Code filename="docker-compose.yml">{`version: "3.8"
services:
  frontend:
    build: ./openshopfloor
    ports:
      - "3000:3000"

  gateway:
    build: ./openshopfloor-gateway
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      - mcp-erp
      - mcp-fertigung
      - mcp-qms
      - mcp-wms

  mcp-erp:
    image: ghcr.io/zeroguess/mcp-erp:latest
    ports:
      - "8021:8021"

  mcp-wms:
    image: ghcr.io/zeroguess/mcp-wms:latest
    ports:
      - "8022:8022"

  mcp-qms:
    image: ghcr.io/zeroguess/mcp-qms:latest
    ports:
      - "8023:8023"

  mcp-fertigung:
    image: ghcr.io/zeroguess/mcp-fertigung:latest
    ports:
      - "8024:8024"`}</Code>
        <WikiCallout type="info">
          You&apos;ll also need an LLM server. Use any OpenAI-compatible endpoint
          (vLLM, text-generation-inference, Ollama, or a cloud API).
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Kubernetes">
        <p>
          For production deployments, OSF runs on Kubernetes. The hosted
          instance uses the following setup:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Gateway</strong> &mdash; Deployment in namespace{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">
              osf
            </code>
            , with liveness probes (failureThreshold=20, periodSeconds=30)
          </li>
          <li>
            <strong>MCP Servers</strong> &mdash; Deployments in namespace{" "}
            <code className="text-accent bg-accent/10 px-1 rounded text-xs">
              demo
            </code>
          </li>
          <li>
            <strong>Memory</strong> &mdash; Gateway needs at least 2Gi memory
            limit (Node-RED + flow engine + V8 sandboxes)
          </li>
          <li>
            <strong>Container Registry</strong> &mdash; Use any registry
            accessible from your cluster
          </li>
        </ul>
        <WikiCallout type="warning">
          The gateway embeds Node-RED, which can consume significant memory. Set
          memory limits to at least 2Gi to avoid OOM kills during flow execution.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="LLM Setup">
        <p>OSF needs an OpenAI-compatible chat completion endpoint. Options:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>vLLM</strong> &mdash; Best performance for local GPU
            deployment
          </li>
          <li>
            <strong>Ollama</strong> &mdash; Easiest setup for local development
          </li>
          <li>
            <strong>text-generation-inference</strong> &mdash; HuggingFace&apos;s
            inference server
          </li>
          <li>
            <strong>OpenAI API</strong> &mdash; Use any cloud provider with
            compatible API
          </li>
        </ul>
        <p className="mt-3">
          Recommended models: qwen2.5-14b or larger for good tool-calling
          performance. Smaller models may struggle with complex MCP tool
          selection.
        </p>
      </WikiSection>
    </>
  );
}
