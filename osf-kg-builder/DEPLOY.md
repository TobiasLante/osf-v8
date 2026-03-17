# v9 KG Platform — Deploy Plan

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│  K8s Cluster (192.168.178.150)                                  │
│                                                                 │
│  ┌─────────────── osf namespace ──────────────────────────────┐ │
│  │                                                             │ │
│  │  ┌──────────┐   ┌──────────┐   ┌───────────┐              │ │
│  │  │ Gateway  │──→│ Chat UI  │   │ Frontend  │              │ │
│  │  │ (v8)     │   │ (v8)     │   │ (v8)      │              │ │
│  │  │ :8012    │   │ nginx    │   │ nginx     │              │ │
│  │  └────┬─────┘   └──────────┘   └───────────┘              │ │
│  │       │                                                     │ │
│  │       │ MCP Discovery (mcp_servers Tabelle)                 │ │
│  │       │                                                     │ │
│  │       ├──────────────────┐                                  │ │
│  │       ▼                  ▼                                  │ │
│  │  ┌──────────┐   ┌──────────────┐   ┌──────────┐           │ │
│  │  │ Sim v3   │   │ KG Server    │   │ Neo4j    │           │ │
│  │  │ (MCP)    │   │ (v9)         │──→│ (v9)     │           │ │
│  │  │ :8020    │   │ :8035        │   │ :7687    │           │ │
│  │  └──────────┘   │ MCP+REST+MQTT│   └──────────┘           │ │
│  │                  └──────┬───────┘                           │ │
│  │                         │ on-demand                         │ │
│  │                  ┌──────┴───────┐                           │ │
│  │                  │ KG Builder   │                           │ │
│  │                  │ (v9, Job)    │                           │ │
│  │                  └──────────────┘                           │ │
│  │                                                             │ │
│  │  ┌──────────┐   ┌──────────┐                               │ │
│  │  │ PG       │   │ Redis    │                               │ │
│  │  │ (Gateway)│   │ (Gateway)│                               │ │
│  │  │ :5432    │   │ :6379    │                               │ │
│  │  └──────────┘   └──────────┘                               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌── factory namespace ──┐   ┌── Extern ──────────────────────┐ │
│  │  Factory Sim v3       │   │  LLM Server (192.168.178.120) │ │
│  │  Fertigung :8020      │   │  :5001 Qwen 32B (Chat)        │ │
│  │  WMS :8022            │   │  :5003 nomic-embed (768d)     │ │
│  │  Montage :8023        │   └────────────────────────────────┘ │
│  │  Chef :8024           │                                      │
│  └───────────────────────┘   ┌── Extern ──────────────────────┐ │
│                              │  MQTT Broker (.150:31883)      │ │
│  ┌── Extern ─────────────┐   │  PG Factory (.150:30432)       │ │
│  │  Cloudflare Pages     │   └────────────────────────────────┘ │
│  │  openshopfloor.       │                                      │
│  │  zeroguess.ai         │                                      │
│  └───────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Was bleibt unveraendert

| Komponente | Status | Namespace |
|-----------|--------|-----------|
| Factory Sim v3 | BLEIBT | factory |
| Gateway (v8) | BLEIBT | osf |
| Chat UI (v8) | BLEIBT | osf |
| Frontend (v8) | BLEIBT | osf |
| osf-postgres (Gateway DB) | BLEIBT | osf |
| Redis | BLEIBT | osf |
| PG Factory (192.168.178.150:30432) | BLEIBT | extern |
| MQTT Broker (192.168.178.150:31883) | BLEIBT | extern |
| LLM Server (192.168.178.120) | BLEIBT | extern |
| Cloudflare Pages | BLEIBT | extern |

## Was v9 neu deployt (parallel zu v8)

| Komponente | Typ | Image | Port |
|-----------|-----|-------|------|
| Neo4j | StatefulSet | `neo4j:5.26-community` | 7687 (bolt), 7474 (http) |
| KG Server | Deployment | `192.168.178.150:32000/osf-kg-server:v9` | 8035 |
| KG Builder | Job | `192.168.178.150:32000/osf-kg-builder:v9` | — (laeuft einmal, exit) |
| v9 Web UI | Deployment | `nginx:1.27-alpine` + static export | 3009 (NodePort 30909) |

## DB-Schema-Trennung

| DB | Schema/DB | Verwendet von |
|---|-----------|---------------|
| PG Factory (.150:30432) | `llm_test_v3` | Sim v3, Gateway MCP Tools |
| PG Factory (.150:30432) | `llm_test_v3.kg_builder_runs` | KG Builder (Runs-Tabelle) |
| osf-postgres (in-cluster) | `public` | Gateway (users, sessions, mcp_servers) |
| Neo4j (v9, in-cluster) | `neo4j` (default DB) | KG Server, KG Builder |

- v9 KG-Daten leben in **Neo4j** (eigene Instanz, keine Kollision mit v8)
- `kg_builder_runs` Tabelle in bestehender Factory-PG (eigene Tabelle, kein Konflikt)
- Gateway `mcp_servers` Tabelle bekommt einen Eintrag fuer `kg-v9` (auto-registration)

## K8s Manifests (k8s/v9/)

### Zu erstellen/aktualisieren

| Datei | Beschreibung |
|-------|-------------|
| `neo4j.yaml` | NEU — StatefulSet + Service + PVC |
| `kg-server.yaml` | REWRITE — Deployment + Service (ersetzt altes kg-builder.yaml) |
| `kg-builder-job.yaml` | NEU — Job (one-shot build, depends on Neo4j) |
| `v9-web.yaml` | NEU — nginx + static export, NodePort 30909 |
| `v9-config.yaml` | NEU — ConfigMap fuer v9-spezifische Env Vars |
| `v9-secrets.yaml.example` | NEU — Neo4j Password etc. |

### Zu loeschen

| Datei | Grund |
|-------|-------|
| `kg-agent.yaml` | Ersetzt durch kg-server |
| `mcp-proxy.yaml` | Nicht mehr noetig (kg-server IST der MCP Server) |
| `uns-stream.yaml` | MQTT Bridge ist jetzt im kg-server |

## Env Variablen (v9-config ConfigMap)

```yaml
# KG Server + Builder
NEO4J_URL: "bolt://osf-neo4j-v9:7687"
NEO4J_USER: "neo4j"
NEO4J_DATABASE: "neo4j"
EMBEDDING_URL: "http://192.168.178.120:5003"
EMBEDDING_MODEL: "nomic-embed-text"
EMBEDDING_DIM: "768"
LLM_URL: "http://192.168.178.120:5001"
LLM_MODEL: "qwen2.5-32b-instruct"
MQTT_RAW_URL: "mqtt://192.168.178.150:31883"
DOMAIN: "discrete"

# Builder-spezifisch (braucht MCP Proxy fuer Tool Discovery)
MCP_PROXY_URL: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
ERP_DB_HOST: "192.168.178.150"
ERP_DB_PORT: "30432"
ERP_DB_NAME: "bigdata_homelab"
ERP_DB_USER: "admin"
DB_SCHEMA: "llm_test_v3"

# Gateway-Integration (auto-registration)
GATEWAY_DB_URL: "postgresql://admin:PASSWORD@osf-postgres:5432/osf"
KG_SERVER_URL: "http://osf-kg-server-v9:8035"
```

## Deploy-Reihenfolge

```bash
# 1. Neo4j starten (braucht PVC)
kubectl apply -f k8s/v9/neo4j.yaml
kubectl wait --for=condition=ready pod -l app=osf-neo4j-v9 -n osf --timeout=120s

# 2. KG Server starten (registriert sich im Gateway)
kubectl apply -f k8s/v9/v9-config.yaml
kubectl apply -f k8s/v9/kg-server.yaml
kubectl wait --for=condition=ready pod -l app=osf-kg-server-v9 -n osf --timeout=60s

# 3. KG Builder Job starten (baut Graph, dann exit)
kubectl apply -f k8s/v9/kg-builder-job.yaml
kubectl wait --for=condition=complete job/osf-kg-builder-v9 -n osf --timeout=300s

# 4. Web UI starten (optional)
kubectl apply -f k8s/v9/v9-web.yaml

# 5. Verify
kubectl exec -it deploy/osf-kg-server-v9 -n osf -- node dist/builder/verify.js --domain discrete
```

## Verifikation

1. **Neo4j**: `kubectl port-forward svc/osf-neo4j-v9 37474:7474 -n osf` → Browser oeffnen
2. **KG Server Health**: `kubectl exec -it deploy/osf-kg-server-v9 -n osf -- wget -qO- http://localhost:8035/health`
3. **MCP Tools**: `curl -s osf-kg-server-v9:8035/mcp -d '{"method":"tools/list"}' -H 'Content-Type: application/json'`
4. **Gateway Discovery**: `SELECT name, url, status, tool_count FROM mcp_servers WHERE name='kg-v9'` → status=online
5. **Chat Test**: Im Gateway-Chat fragen: "Welche Maschinen gibt es?" → LLM nutzt `kg_*` Tools
6. **Kein v8 Impact**: Alle v8 Pods laufen unveraendert, kein Restart
7. **Verify CLI**: `npm run verify -- --domain discrete --with-server --server-url http://osf-kg-server-v9:8035`

## Image Build

```bash
# Im osf-kg-builder/ Verzeichnis:
docker build -f Dockerfile.server -t 192.168.178.150:32000/osf-kg-server:v9 .
docker push 192.168.178.150:32000/osf-kg-server:v9

docker build -f Dockerfile.builder -t 192.168.178.150:32000/osf-kg-builder:v9 .
docker push 192.168.178.150:32000/osf-kg-builder:v9
```

## Rollback

```bash
# v9 komplett entfernen ohne v8 zu beeinflussen:
kubectl delete -f k8s/v9/
# Gateway vergisst kg-v9 automatisch (status=offline oder DELETE FROM mcp_servers WHERE name='kg-v9')
```
