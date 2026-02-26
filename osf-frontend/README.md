<p align="center">
  <img src="https://openshopfloor.zeroguess.ai/logo-full.png" alt="OpenShopFloor" width="400" />
</p>

<h3 align="center">The open-source AI platform for factory operations</h3>

<p align="center">
  Build, test, and deploy manufacturing AI agents with real MCP data.
</p>

<p align="center">
  <a href="https://openshopfloor.zeroguess.ai">Live Demo</a> &middot;
  <a href="https://openshopfloor.zeroguess.ai/docs">Docs</a> &middot;
  <a href="https://github.com/BavarianAnalyst/openshopfloor/discussions">Community</a>
</p>

<p align="center">
  <a href="https://github.com/BavarianAnalyst/openshopfloor/stargazers"><img src="https://img.shields.io/github/stars/BavarianAnalyst/openshopfloor?style=flat" alt="Stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/BavarianAnalyst/openshopfloor" alt="License" /></a>
  <a href="https://openshopfloor.zeroguess.ai"><img src="https://img.shields.io/badge/demo-live-brightgreen" alt="Live Demo" /></a>
</p>

---

<!-- TODO: Replace with actual screenshot -->
<!-- ![OpenShopFloor Dashboard](docs/screenshots/dashboard.png) -->

## What is OpenShopFloor?

OpenShopFloor is a complete manufacturing simulation with **91 MCP tools** (Model Context Protocol). Connect AI agents to a running factory — with real ERP, OEE, QMS, WMS, and capacity planning data.

No API keys needed. Sign up, build an agent, run it against live factory data.

### Build AI agents in 4 ways

| | Method | Description |
|---|---|---|
| **Chat** | Conversational | Talk to the factory through 91 MCP tools |
| **Flows** | Visual | Drag-and-drop Node-RED workflow editor |
| **Chains** | Pipeline | Multi-step agent pipelines with visual builder |
| **Code** | TypeScript | Deploy agents from GitHub repositories |

### What's included

- **Factory Simulator** — 30 machines (CNC, injection molding, assembly), realistic production schedules, shift models, breakdowns
- **91 MCP Tools** — ERP queries, OEE monitoring, capacity planning (CM01/CM21), quality management, warehouse management, tool management
- **Marketplace** — Deploy and fork community agents, chains, and flows
- **BYOK** — Bring your own LLM key (OpenAI, Anthropic, or any OpenAI-compatible API)
- **Per-user Node-RED pods** — Isolated runtime environments via Kubernetes warm pool

## Quick Start

```bash
git clone https://github.com/BavarianAnalyst/openshopfloor.git
cd openshopfloor
npm install
npm run dev
# → http://localhost:3000
```

Or just use the hosted version: **[openshopfloor.zeroguess.ai](https://openshopfloor.zeroguess.ai)**

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, PostgreSQL |
| AI Runtime | Node-RED (per-user K8s pods), LangGraph |
| Hosting | Cloudflare Pages (frontend), Kubernetes (backend) |
| Protocol | MCP (Model Context Protocol) for tool integration |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│         Next.js · Cloudflare Pages               │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│                  OSF Gateway                     │
│    Auth · Flows · Chains · Marketplace · LLM     │
│         Node-RED Pod Manager (K8s)               │
└──────┬───────────┬───────────┬──────────────────┘
       │           │           │
  ┌────┴───┐  ┌────┴───┐  ┌───┴────┐
  │  MCP   │  │  MCP   │  │  MCP   │  ...
  │  ERP   │  │  OEE   │  │  QMS   │
  │ :8021  │  │ :8024  │  │ :8023  │
  └────┬───┘  └────┬───┘  └───┬────┘
       │           │           │
  ┌────┴───────────┴───────────┴────┐
  │     Factory Simulator v3        │
  │  30 machines · real-time sim    │
  └─────────────────────────────────┘
```

## Self-Hosting

See the [Self-Hosting Guide](https://openshopfloor.zeroguess.ai/docs/wiki/self-hosting) for full instructions.

```bash
# Clone both repos
git clone https://github.com/BavarianAnalyst/openshopfloor.git
git clone https://github.com/BavarianAnalyst/openshopfloor-gateway.git

# Gateway
cd openshopfloor-gateway
cp .env.example .env    # Edit with your config
npm install && npm run build && npm start

# Frontend
cd ../openshopfloor
cp .env.example .env    # Set NEXT_PUBLIC_API_URL
npm install && npm run build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `https://osf-api.zeroguess.ai` | Gateway API URL |
| `NEXT_PUBLIC_APP_VERSION` | `1.0.0` | Displayed version |

## Project Structure

```
src/
├── app/                  # Pages
│   ├── chat/             # AI chat with MCP tools
│   ├── flows/editor/     # Node-RED visual editor
│   ├── chains/           # Multi-step pipelines
│   ├── agents/           # Agent hub + code agents
│   ├── marketplace/      # Community marketplace
│   ├── dashboard/        # User dashboard
│   ├── admin/            # System admin panel
│   ├── settings/         # Profile, LLM, GitHub
│   └── docs/wiki/        # Documentation
├── components/           # Reusable components
└── lib/                  # API client, auth, data
```

## Related Repositories

| Repo | Description |
|------|-------------|
| [openshopfloor-gateway](https://github.com/BavarianAnalyst/openshopfloor-gateway) | Backend API, auth, pod manager |
| [node-red-contrib-mcp](https://github.com/BavarianAnalyst/node-red-contrib-mcp) | MCP nodes for Node-RED — use OSF's 91 tools in standalone Node-RED ([npm](https://www.npmjs.com/package/node-red-contrib-mcp)) |
| [osf-oee-optimize](https://github.com/BavarianAnalyst/osf-oee-optimize) | Multi-agent OEE deep analysis |
| [osf-otd-agent](https://github.com/BavarianAnalyst/osf-otd-agent) | Multi-agent OTD optimization |
| [osf-agent-oee-check](https://github.com/BavarianAnalyst/osf-agent-oee-check) | OEE quick check agent |

## Contributing

We welcome contributions! Open an issue or discussion to get started.

## License

[AGPL-3.0](LICENSE)
