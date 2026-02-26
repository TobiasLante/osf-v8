import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

function Endpoint({
  method,
  path,
  description,
  auth,
  body,
  response,
}: {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description: string;
  auth?: boolean;
  body?: string;
  response?: string;
}) {
  const methodColors: Record<string, string> = {
    GET: "text-green-400 bg-green-500/10",
    POST: "text-blue-400 bg-blue-500/10",
    PUT: "text-yellow-400 bg-yellow-500/10",
    DELETE: "text-red-400 bg-red-500/10",
    PATCH: "text-purple-400 bg-purple-500/10",
  };
  return (
    <div className="border border-border rounded-md p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded ${methodColors[method]}`}
        >
          {method}
        </span>
        <code className="text-sm font-mono text-accent">{path}</code>
        {auth !== false && (
          <span className="text-[10px] text-text-dim border border-border px-1.5 py-0.5 rounded ml-auto">
            Auth
          </span>
        )}
      </div>
      <p className="text-text-muted text-sm">{description}</p>
      {body && (
        <pre className="mt-2 bg-[#0d1117] p-3 rounded text-xs font-mono text-gray-300 overflow-x-auto">
          {body}
        </pre>
      )}
      {response && (
        <div className="mt-2">
          <span className="text-[10px] text-text-dim uppercase tracking-wider">
            Response
          </span>
          <pre className="mt-1 bg-[#0d1117] p-3 rounded text-xs font-mono text-gray-300 overflow-x-auto">
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ApiReferenceContent() {
  return (
    <>
      <WikiSection title="Base URL">
        <p>
          All API requests go to the OSF Gateway:
        </p>
        <pre className="mt-2 bg-[#0d1117] p-3 rounded text-xs font-mono text-gray-300">
          https://api.openshopfloor.zeroguess.ai
        </pre>
        <WikiCallout type="info">
          Authentication uses JWT Bearer tokens. Include the token in the{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            Authorization
          </code>{" "}
          header:{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            Bearer &lt;token&gt;
          </code>
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Authentication">
        <div className="space-y-4">
          <Endpoint
            method="POST"
            path="/auth/register"
            description="Create a new account"
            auth={false}
            body={`{ "email": "user@example.com", "password": "..." , "name": "..." }`}
            response={`{ "token": "eyJ...", "user": { "id": "...", "email": "...", "name": "..." } }`}
          />
          <Endpoint
            method="POST"
            path="/auth/login"
            description="Sign in and get a JWT token"
            auth={false}
            body={`{ "email": "user@example.com", "password": "..." }`}
            response={`{ "token": "eyJ...", "user": { "id": "...", "email": "...", "name": "..." } }`}
          />
          <Endpoint
            method="GET"
            path="/auth/me"
            description="Get current user profile"
            response={`{ "id": "...", "email": "...", "name": "...", "role": "user" }`}
          />
        </div>
      </WikiSection>

      <WikiSection title="Chat">
        <div className="space-y-4">
          <Endpoint
            method="POST"
            path="/chat"
            description="Send a message to the AI assistant. Response is streamed via SSE. The assistant can call MCP tools to answer factory-related questions."
            body={`{ "message": "What's the current OEE?", "conversationId": "optional-id" }`}
            response={`SSE stream: data: { "type": "text|tool_call|tool_result", ... }`}
          />
          <Endpoint
            method="GET"
            path="/chat/conversations"
            description="List all conversations for the current user"
            response={`[{ "id": "...", "title": "...", "updatedAt": "..." }]`}
          />
          <Endpoint
            method="GET"
            path="/chat/conversations/:id"
            description="Get a specific conversation with message history"
          />
          <Endpoint
            method="DELETE"
            path="/chat/conversations/:id"
            description="Delete a conversation"
          />
        </div>
      </WikiSection>

      <WikiSection title="Agents">
        <div className="space-y-4">
          <Endpoint
            method="GET"
            path="/agents"
            description="List all available agents (built-in + community)"
            response={`[{ "id": "...", "name": "...", "description": "...", "icon": "...", "type": "builtin|community" }]`}
          />
          <Endpoint
            method="POST"
            path="/agents/:id/run"
            description="Execute an agent. Response is streamed via SSE."
            response={`SSE stream: data: { "type": "log|result|error", ... }`}
          />
          <Endpoint
            method="GET"
            path="/agents/:id/runs"
            description="List past runs for an agent"
          />
        </div>
      </WikiSection>

      <WikiSection title="Code Agents">
        <div className="space-y-4">
          <Endpoint
            method="POST"
            path="/code-agents"
            description="Deploy a new code agent from a GitHub repository"
            body={`{ "repoFullName": "user/repo", "branch": "main" }`}
          />
          <Endpoint
            method="GET"
            path="/code-agents"
            description="List all deployed code agents for the current user"
          />
          <Endpoint
            method="POST"
            path="/code-agents/:id/sync"
            description="Manually trigger a re-sync from the GitHub repository"
          />
          <Endpoint
            method="DELETE"
            path="/code-agents/:id"
            description="Remove a deployed code agent"
          />
        </div>
      </WikiSection>

      <WikiSection title="Flows">
        <div className="space-y-4">
          <Endpoint
            method="GET"
            path="/flows"
            description="List all saved flows for the current user"
            response={`[{ "id": "...", "name": "...", "description": "...", "nodeCount": 5 }]`}
          />
          <Endpoint
            method="POST"
            path="/flows"
            description="Save a new flow from the Node-RED editor"
            body={`{ "name": "...", "description": "...", "nodes": [...], "wires": [...] }`}
          />
          <Endpoint
            method="POST"
            path="/flows/:id/run"
            description="Execute a saved flow. Response is streamed via SSE."
            response={`SSE stream: data: { "nodeId": "...", "type": "start|result|error", ... }`}
          />
          <Endpoint
            method="DELETE"
            path="/flows/:id"
            description="Delete a saved flow"
          />
        </div>
      </WikiSection>

      <WikiSection title="MCP Proxy">
        <div className="space-y-4">
          <Endpoint
            method="POST"
            path="/mcp"
            description="Call any MCP tool through the gateway proxy. The gateway routes to the correct MCP server based on the tool name prefix."
            body={`{ "tool": "factory_get_latest_oee", "args": {} }`}
            response={`{ "result": { ... } }`}
          />
          <Endpoint
            method="GET"
            path="/mcp/tools"
            description="List all available MCP tools across all 4 servers"
            response={`[{ "name": "...", "description": "...", "parameters": {...} }]`}
          />
        </div>
        <WikiCallout type="tip">
          The MCP proxy handles routing automatically: tools starting with{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            factory_
          </code>{" "}
          go to Manufacturing,{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            quality_
          </code>{" "}
          to QMS,{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            warehouse_
          </code>{" "}
          to WMS, and{" "}
          <code className="text-accent bg-accent/10 px-1 rounded text-xs">
            erp_
          </code>{" "}
          to ERP.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="GitHub Integration">
        <div className="space-y-4">
          <Endpoint
            method="GET"
            path="/auth/github"
            description="Start GitHub OAuth flow for connecting a GitHub account"
            auth={false}
          />
          <Endpoint
            method="GET"
            path="/auth/github/repos"
            description="List repositories for the connected GitHub account"
          />
          <Endpoint
            method="POST"
            path="/auth/github/webhook"
            description="Webhook endpoint for GitHub push events (auto-sync)"
            auth={false}
          />
        </div>
      </WikiSection>
    </>
  );
}
