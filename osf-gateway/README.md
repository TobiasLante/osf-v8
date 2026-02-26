# OSF Gateway

API Gateway for OpenShopFloor -- Auth, Chat, Agent Runner, Flow Engine, MCP Proxy, Marketplace, NR Pod Manager, and more.

## Architecture

```
Client (Frontend)
    │
    ▼
OSF Gateway (Express)
    ├── /auth           JWT authentication (register, login, GitHub OAuth)
    ├── /chat           AI chat with SSE streaming + MCP tool calls
    ├── /agents         Built-in agent runner
    ├── /code-agents    GitHub code agent deployment + isolated-vm execution
    ├── /chains         Multi-step agent pipelines
    ├── /flows          Flow engine (Node-RED-based, custom OSF engine)
    ├── /flows/editor   Embedded Node-RED editor (iframe, per-user pods)
    ├── /marketplace    Deploy (link) or Fork agents/chains/flows
    ├── /news           Platform news feed
    ├── /mcp            MCP proxy (routes to 4 domain servers)
    ├── /admin          Admin routes (users, NR pods, stats)
    └── /internal       Internal API for NR pods (pod secret auth)
         │
         ▼
    NR Pod Manager (K8s)
    ├── 1 Node-RED pod per user (editor + runtime)
    ├── Warm pool (pre-started pods for fast assignment)
    └── Idle timeout → reclaim unused pods
         │
         ▼
    MCP Servers (4 domains)
    ├── mcp-erp:8021        ERP (orders, customers, materials)
    ├── mcp-wms:8022        WMS (inventory, stock, locations)
    ├── mcp-qms:8023        QMS (defects, quality, audits)
    └── mcp-fertigung:8024  Manufacturing (machines, OEE, tools)
```

## Key Features

- **JWT Auth** -- Email/password registration, login, API keys
- **AI Chat** -- SSE-streamed LLM responses with automatic MCP tool calling
- **Agent Runner** -- Execute built-in and community agents with live output
- **Code Agents** -- Deploy TypeScript agents from GitHub, run in V8 sandboxes (isolated-vm)
- **Chains** -- Multi-step agent pipelines with sequential/parallel execution
- **Flow Engine** -- Custom execution engine for Node-RED flows with DB-backed run tracking
- **Marketplace** -- Deploy (link) or Fork agents, chains, code agents, and flows
- **BYOK** -- Bring Your Own LLM Key (tier-gated, encrypted storage)
- **NR Pod Manager** -- Per-user Node-RED pods with K8s warm pool, idle timeout, kill protection
- **News** -- Platform announcements and news feed
- **MCP Proxy** -- Routes tool calls to the correct MCP server by prefix
- **Node-RED** -- Embedded editor at `/flows` for visual flow building
- **GitHub Integration** -- OAuth, webhook auto-sync, encrypted token storage

## Custom Node-RED Nodes

16 custom nodes in `nodered-nodes/node-red-contrib-osf/`:

| Node | Purpose |
|------|---------|
| `osf-ts` | TypeScript code execution (V8 sandbox, 1-5 outputs) |
| `osf-prompt` | LLM prompt with {{input}} templating |
| `osf-prompt-tpl` | Template engine with ${context}/${input} |
| `osf-llm` | LLM call with per-node config (2 inputs: context + prompt) |
| `osf-context` | Aggregate multiple upstream outputs into JSON |
| `osf-decision` | Conditional branching |
| `osf-output-parser` | JSON schema validation with LLM retry |
| `osf-http` | HTTP requests to external APIs |
| `osf-sub-flow` | Call another flow as subroutine (max depth 5) |
| `osf-agent` | Run an existing agent within a flow |
| `osf-human-input` | Pause for human approval/input |
| `osf-mcp-erp` | Call ERP MCP tools |
| `osf-mcp-fertigung` | Call Manufacturing MCP tools |
| `osf-mcp-qms` | Call QMS MCP tools |
| `osf-mcp-tms` | Call TMS MCP tools |
| `mcp-tool` | Generic MCP tool caller |

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your settings (see below)

# Run development server
npm run dev
# → http://localhost:8080

# Build for production
npm run build

# Run production
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | Gateway port |
| `JWT_SECRET` | Yes | -- | Secret for JWT token signing |
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `APP_VERSION` | No | `1.0.0` | Reported in `/health` endpoint |
| `MCP_URL` | Yes | -- | MCP server base URL |
| `LLM_URL_FREE` | Yes | -- | Free-tier LLM endpoint (e.g. qwen2.5-14b) |
| `LLM_URL_PREMIUM` | Yes | -- | Premium-tier LLM endpoint (e.g. qwen2.5-32b) |
| `LLM_MODEL_FREE` | No | `qwen2.5-14b-instruct` | Free-tier model name |
| `LLM_MODEL_PREMIUM` | No | `qwen2.5-32b-instruct` | Premium-tier model name |
| `LLM_MAX_CONCURRENCY` | No | `2` | Max concurrent LLM requests |
| `LLM_MAX_QUEUE_DEPTH` | No | `10` | Max queued LLM requests |
| `LLM_ENCRYPTION_KEY` | No | -- | 64-char hex key for API key encryption (derives from JWT_SECRET if empty) |
| `NR_POD_IMAGE` | No | -- | Node-RED pod container image |
| `NR_POD_SECRET` | No | -- | Shared secret for NR pod <-> gateway auth |
| `NR_WARM_POOL_SIZE` | No | `3` | Number of pre-warmed NR pods |
| `NR_IDLE_TIMEOUT_MINUTES` | No | `20` | Idle timeout before pod reclaim |
| `GITHUB_CLIENT_ID` | No | -- | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | -- | GitHub OAuth app secret |
| `GITHUB_WEBHOOK_SECRET` | No | -- | GitHub webhook HMAC secret |
| `FRONTEND_URL` | No | `https://openshopfloor.zeroguess.ai` | Frontend URL for CORS |

## Source Structure

```
src/
├── index.ts              # Main entry: Express app, middleware, route mounting
├── auth/                 # JWT auth, GitHub OAuth, API keys, BYOK LLM settings
├── chat/                 # LLM chat with SSE streaming + MCP tool calls
│   └── llm-client.ts    # LLM client with queue, concurrency, status
├── agents/               # Built-in agent execution
├── code-agents/          # GitHub deploy, isolated-vm runner, webhook sync
├── chains/               # Multi-step agent pipelines
├── flows/                # Flow engine, SSE execution, Node-RED save/load
├── marketplace/          # Deploy/fork marketplace logic
├── news/                 # News feed CRUD
├── mcp/                  # MCP proxy (routes by tool name prefix)
├── nodered/              # Node-RED embedding config
│   ├── pod-manager.ts   # K8s pod lifecycle (warm pool, assignment, cleanup)
│   ├── proxy.ts         # Reverse proxy to per-user NR pods
│   └── internal-api.ts  # Internal API for NR pod <-> gateway communication
├── challenges/           # Challenge/gamification logic
├── admin/                # Admin routes (users, NR pods, system stats)
├── db/                   # Database layer (PostgreSQL)
├── email/                # Email service
├── logger.ts             # Structured logging (pino)
└── rate-limit.ts         # Rate limiting middleware
```

## Deployment

### Kubernetes (Production)

The gateway runs as a K8s Deployment:

- **Namespace:** `osf`
- **Registry:** `192.168.178.150:32000/osf-gateway`
- **Memory limit:** >= 2Gi (Node-RED + V8 sandboxes)
- **Liveness probes:** `failureThreshold=20`, `periodSeconds=30`, `timeoutSeconds=5`
- **NR Pod image:** `192.168.178.150:32000/osf-nodered`

### Docker

```bash
docker build -t osf-gateway .
docker run -p 8080:8080 --env-file .env osf-gateway
```

## Related

- [OSF Frontend](https://github.com/zeroguess/openshopfloor) -- Next.js frontend
- [Live Platform](https://openshopfloor.zeroguess.ai) -- Hosted instance

## License

MIT
