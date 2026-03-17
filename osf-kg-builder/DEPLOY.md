# v9 KG Platform — Deploy Plan

## Architektur

v9 ist ein eigenstaendiger Stack parallel zu v8. Eigener Gateway, eigene DB, eigenes Neo4j.
Shared: Factory Sim v3 (read-only MCP), LLM Server, MQTT Broker.

```
┌─────────────────────────────────────────────────────────────────────┐
│  K8s Cluster (192.168.178.150)                                      │
│                                                                     │
│  ┌──────────── osf namespace (v8 — UNBERUEHRT) ─────────────────┐  │
│  │                                                               │  │
│  │  Gateway(v8) ──→ Chat UI ──→ Frontend                        │  │
│  │  :8012           nginx       nginx                            │  │
│  │     │                                                         │  │
│  │     ├──→ Sim v3 (factory ns, shared)                         │  │
│  │     │                                                         │  │
│  │  PG(v8)   Redis(v8)                                          │  │
│  │  :5432    :6379                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────── osf-v9 namespace (v9 — NEU) ─────────────────────┐  │
│  │                                                               │  │
│  │  Gateway(v9) ──→ Chat UI(v9)                                 │  │
│  │  :8012           nginx                                        │  │
│  │     │                                                         │  │
│  │     ├──→ Sim v3 (factory ns, shared)                         │  │
│  │     ├──→ KG Server ──→ Neo4j                                 │  │
│  │     │    :8035         :7687                                  │  │
│  │     │    MCP+REST+MQTT                                        │  │
│  │     ├──→ Historian ──→ PG Factory (TimescaleDB)              │  │
│  │     │    :8030    MQTT→PG + History MCP Tools                 │  │
│  │     │                                                         │  │
│  │  PG(v9)   Redis(v9)   KG Builder (Job, on-demand)            │  │
│  │  :5432    :6379                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌── factory namespace (shared) ─┐   ┌── Extern ────────────────┐  │
│  │  Factory Sim v3               │   │  LLM (.120:5001, :5003) │  │
│  │  Fertigung :8020              │   │  MQTT (.150:31883)       │  │
│  │  WMS :8022                    │   │  PG Factory (.150:30432) │  │
│  │  Montage :8023                │   └──────────────────────────┘  │
│  │  Chef :8024                   │                                  │
│  └───────────────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Prinzip: Zwei parallele Stacks, eine Fabrik

| | v8 Stack (osf) | v9 Stack (osf-v9) |
|---|---|---|
| **Gateway** | osf-gateway:8012 | osf-gateway-v9:8012 |
| **Chat UI** | osf-chat-ui (nginx) | osf-chat-ui-v9 (nginx) |
| **PostgreSQL** | osf-postgres | osf-postgres-v9 |
| **Redis** | osf-redis | osf-redis-v9 |
| **KG Server** | — | osf-kg-server:8035 |
| **Neo4j** | — | osf-neo4j:7687 |
| **KG Builder** | — | Job (on-demand) |
| **Web UI (v9)** | — | osf-v9-web:3009 |
| **Historian** | — | historian:8030 |
| **Factory Sim** | shared (factory ns) | shared (factory ns) |
| **LLM Server** | shared (.120) | shared (.120) |
| **MQTT Broker** | shared (.150:31883) | shared (.150:31883) |

## Was bleibt unveraendert

| Komponente | Namespace | Aenderung |
|-----------|-----------|-----------|
| Factory Sim v3 | factory | KEINE |
| Gateway (v8) | osf | KEINE |
| Chat UI (v8) | osf | KEINE |
| Frontend (v8) | osf | KEINE |
| osf-postgres | osf | KEINE |
| osf-redis | osf | KEINE |
| LLM Server (.120) | extern | KEINE |
| MQTT Broker (.150) | extern | KEINE |
| PG Factory (.150:30432) | extern | KEINE |

## Was v9 neu deployt (eigener Namespace osf-v9)

| Komponente | Typ | Image | Port |
|-----------|-----|-------|------|
| Gateway (v9) | Deployment | `192.168.178.150:32000/osf-gateway:latest` | 8012, NodePort 30912 |
| Chat UI (v9) | Deployment | `192.168.178.150:32000/osf-chat-ui:latest` | 80, NodePort 30813 |
| PG (v9) | StatefulSet | `postgres:16-alpine` | 5432 |
| Redis (v9) | Deployment | `redis:7-alpine` | 6379 |
| Neo4j | StatefulSet | `neo4j:5.26-community` | 7687, 7474 |
| KG Server | Deployment | `192.168.178.150:32000/osf-kg-server:v9` | 8035 |
| KG Builder | Job | `192.168.178.150:32000/osf-kg-builder:v9` | — |
| Historian | Deployment | `192.168.178.150:32000/osf-historian:2.0.0` | 8030 |
| v9 Web UI | Deployment | `nginx:1.27-alpine` | 3009, NodePort 30909 |

## DB-Schema — Komplett-Uebersicht

### Instanzen

| DB-Instanz | Namespace | Verwendet von |
|---|---|---|
| osf-postgres (osf ns) | osf | v8 Gateway (UNBERUEHRT) |
| osf-postgres-v9 (osf-v9 ns) | osf-v9 | v9 Gateway |
| PG Factory (.150:30432) | extern | Sim v3, KG Builder |
| Neo4j (osf-v9 ns) | osf-v9 | KG Server, KG Builder |

### osf-postgres-v9 — Schema (v9 Gateway DB)

Gateway erstellt ~30 Tabellen automatisch via `initSchema()` beim Start.
Aber: **leere DB reicht nicht** — Seed-Daten muessen rein.

**Init-Script (`k8s/v9/init-db.sql`):**

```sql
-- 1. Database anlegen (laeuft als postgres initdb)
-- (Wird via POSTGRES_DB env var im Container erstellt)

-- 2. Admin-User seeden (nach Gateway initSchema)
-- Gateway erstellt Tabellen automatisch, aber der erste User muss manuell:
INSERT INTO users (id, email, name, password_hash, role, email_verified)
VALUES (
  gen_random_uuid(),
  'admin@zeroguess.ai',
  'Admin',
  '$2b$10$PLACEHOLDER_HASH',  -- bcrypt hash, wird beim ersten Login via UI gesetzt
  'admin',
  true
) ON CONFLICT (email) DO NOTHING;

-- 3. MCP Server registrieren (Sim v3 + Historian + KG Server)
INSERT INTO mcp_servers (name, url, auth_type, status, tool_count, categories)
VALUES
  ('erp', 'http://factory-v3-fertigung.factory.svc.cluster.local:8020', 'none', 'pending', 0, '{erp}'),
  ('oee', 'http://factory-v3-fertigung.factory.svc.cluster.local:8020', 'none', 'pending', 0, '{oee}'),
  ('qms', 'http://factory-v3-fertigung.factory.svc.cluster.local:8020', 'none', 'pending', 0, '{qms}'),
  ('history', 'http://historian:8030', 'none', 'pending', 6, '{history}')
ON CONFLICT (name) DO NOTHING;
-- kg-v9 wird automatisch via register-mcp.ts beim KG-Server-Start registriert
```

**Hinweis:** Gateway's `initSchema()` laeuft beim Container-Start und erstellt alle Tabellen:
- `users`, `refresh_tokens`, `chat_sessions`, `chat_messages`, `agent_runs`
- `agents`, `agent_chains`, `chain_runs`, `email_tokens`
- `nodered_flows`, `nodered_credentials`, `nodered_settings`, `nodered_library`
- `user_flows`, `flow_runs`, `flow_run_events`, `flow_pending_inputs`
- `github_connections`, `code_agents`, `code_agent_runs`, `code_agent_storage`
- `oauth_states`, `news`, `banner`, `nodered_pods`, `nodered_pod_events`
- `challenge_attempts`, `mcp_servers`, `user_deployed_agents`
- + Migrations (ALTER TABLE für security columns, LLM provider, token quota, etc.)

### PG Factory (.150:30432) — Aenderungen

**Neues im Schema `llm_test_v3`:**

```sql
-- kg_builder_runs Tabelle (wird automatisch vom KG Builder erstellt)
-- Aber: Schema muss existieren
CREATE SCHEMA IF NOT EXISTS llm_test_v3;

-- Tabelle wird von schema-planner.ts saveSchemaRun() automatisch erstellt:
-- CREATE TABLE IF NOT EXISTS llm_test_v3.kg_builder_runs (...)
-- Kein manuelles SQL noetig.
```

**Bestehende Factory-Daten (UNBERUEHRT):**
- `llm_test_v3.maschinen`, `llm_test_v3.auftraege`, `llm_test_v3.artikel`, etc.
- Werden von Sim v3 geschrieben, von beiden Gateways via MCP gelesen

### Neo4j (osf-v9 ns) — Schema

```cypher
-- Wird automatisch von initializeGraph() erstellt:

-- Uniqueness Constraint
CREATE CONSTRAINT node_id_unique IF NOT EXISTS
FOR (n:Node) REQUIRE n.id IS UNIQUE;

-- Vector Index (768d nomic-embed-text)
CREATE VECTOR INDEX node_embedding IF NOT EXISTS
FOR (n:Node) ON (n.embedding)
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}};
```

Nach KG Builder Job:
- Node Labels: Machine, Article, Order, Material, Customer, Supplier, BOM (discrete Template)
- Edge Types: RUNS_ON, PRODUCES, HAS_BOM, FOR_CUSTOMER, SUPPLIED_BY
- Embeddings auf allen Nodes (768d, nomic-embed-text)

### Zusammenfassung DB-Isolation

```
v8 Gateway → osf-postgres (osf ns)        ← UNBERUEHRT
v9 Gateway → osf-postgres-v9 (osf-v9 ns)  ← EIGENE INSTANZ
Sim v3     → PG Factory (.150:30432)       ← SHARED, read-only via MCP
KG Builder → PG Factory (kg_builder_runs)  ← EIGENE TABELLE, kein Konflikt
KG Server  → Neo4j (osf-v9 ns)            ← EIGENE INSTANZ
```

- v8 und v9 haben **komplett getrennte Gateway-DBs**
- v9 Gateway hat Sim v3 MCP Server + kg-v9 in seiner eigenen `mcp_servers` Tabelle
- v8 Gateway weiss nichts von v9 — null Risiko
- Factory-Daten sind shared/read-only via MCP Tools
- Neo4j ist v9-exklusiv, keine Kollision moeglich

## K8s Manifests (k8s/v9/)

### Zu erstellen

| Datei | Beschreibung |
|-------|-------------|
| `namespace.yaml` | Namespace `osf-v9` |
| `postgres.yaml` | PG 16 StatefulSet + Service (v9 Gateway DB) |
| `redis.yaml` | Redis 7 Deployment + Service |
| `neo4j.yaml` | Neo4j 5.26 StatefulSet + Service + PVC |
| `gateway.yaml` | Gateway Deployment + Service + NodePort 30912 |
| `chat-ui.yaml` | Chat UI Deployment + Service + NodePort 30813 |
| `kg-server.yaml` | KG Server Deployment + Service |
| `kg-builder-job.yaml` | KG Builder Job (one-shot) |
| `historian.yaml` | Historian (MQTT→TimescaleDB + History MCP :8030) |
| `v9-web.yaml` | v9 Admin Web UI + NodePort 30909 |
| `v9-config.yaml` | ConfigMap (alle Env Vars) |
| `v9-secrets.yaml.example` | Secrets Template |
| `init-db.sql` | Seed: Admin-User + MCP Server Registration |

### Zu loeschen (alt, veraltet)

| Datei | Grund |
|-------|-------|
| `kg-agent.yaml` | Ersetzt durch kg-server |
| `kg-builder.yaml` | Ersetzt durch kg-server + kg-builder-job |
| `mcp-proxy.yaml` | Nicht mehr noetig |
| `uns-stream.yaml` | MQTT Bridge ist im kg-server |

## v9 ConfigMap

```yaml
# Gateway (v9 Instanz)
NODE_ENV: "production"
PORT: "8012"
DB_HOST: "osf-postgres-v9"
DB_PORT: "5432"
REDIS_HOST: "osf-redis-v9"
REDIS_PORT: "6379"
LLM_URL: "http://192.168.178.120:5001"
LLM_MODEL: "qwen2.5-32b-instruct"

# MCP Server URLs (Sim v3 shared + KG Server lokal)
MCP_URL_ERP: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
MCP_URL_OEE: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
MCP_URL_QMS: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
MCP_URL_TMS: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
MCP_URL_UNS: "http://factory-v3-fertigung.factory.svc.cluster.local:8025"
MCP_URL_KG: "http://osf-kg-server:8035"
HISTORIAN_URL: "http://historian:8030"

# Historian
HISTORIAN_DB_HOST: "192.168.178.150"
HISTORIAN_DB_PORT: "30432"
HISTORIAN_DB_NAME: "bigdata_homelab"
HISTORIAN_DB_USER: "admin"
HISTORIAN_MCP_PORT: "8030"
HISTORIAN_FLUSH_MS: "5000"
MQTT_BROKER_URL: "mqtt://192.168.178.150:31883"

# KG Server
NEO4J_URL: "bolt://osf-neo4j:7687"
NEO4J_USER: "neo4j"
NEO4J_DATABASE: "neo4j"
EMBEDDING_URL: "http://192.168.178.120:5003"
EMBEDDING_MODEL: "nomic-embed-text"
EMBEDDING_DIM: "768"
MQTT_RAW_URL: "mqtt://192.168.178.150:31883"
DOMAIN: "discrete"

# KG Builder
MCP_PROXY_URL: "http://factory-v3-fertigung.factory.svc.cluster.local:8020"
ERP_DB_HOST: "192.168.178.150"
ERP_DB_PORT: "30432"
ERP_DB_NAME: "bigdata_homelab"
ERP_DB_USER: "admin"
DB_SCHEMA: "llm_test_v3"

# Gateway-Integration (auto-registration in v9's own PG)
GATEWAY_DB_URL: "postgresql://admin:PASSWORD@osf-postgres-v9:5432/osf"
KG_SERVER_URL: "http://osf-kg-server:8035"
```

## Deploy-Reihenfolge

```bash
# 0. Namespace
kubectl apply -f k8s/v9/namespace.yaml

# 1. Infra (PG, Redis, Neo4j)
kubectl apply -f k8s/v9/v9-config.yaml -f k8s/v9/v9-secrets.yaml
kubectl apply -f k8s/v9/postgres.yaml -f k8s/v9/redis.yaml -f k8s/v9/neo4j.yaml
kubectl wait --for=condition=ready pod -l app=osf-postgres-v9 -n osf-v9 --timeout=60s
kubectl wait --for=condition=ready pod -l app=osf-neo4j -n osf-v9 --timeout=120s

# 2. Gateway (v9 Instanz — gleicher Code, eigene DB)
kubectl apply -f k8s/v9/gateway.yaml -f k8s/v9/chat-ui.yaml
kubectl wait --for=condition=ready pod -l app=osf-gateway-v9 -n osf-v9 --timeout=60s

# 3. Historian (MQTT→TimescaleDB + History MCP Tools)
kubectl apply -f k8s/v9/historian.yaml
kubectl wait --for=condition=ready pod -l app=historian -n osf-v9 --timeout=60s

# 4. KG Server (registriert sich automatisch in v9 Gateway DB)
kubectl apply -f k8s/v9/kg-server.yaml
kubectl wait --for=condition=ready pod -l app=osf-kg-server -n osf-v9 --timeout=60s

# 5. KG Builder Job (baut Graph, dann exit)
kubectl apply -f k8s/v9/kg-builder-job.yaml
kubectl wait --for=condition=complete job/osf-kg-builder -n osf-v9 --timeout=300s

# 6. Web UI (Admin, optional)
kubectl apply -f k8s/v9/v9-web.yaml

# 7. Verify
kubectl exec deploy/osf-kg-server -n osf-v9 -- node dist/builder/verify.js --domain discrete
```

## NodePort-Zuordnung

| Service | v8 Port | v9 Port |
|---------|---------|---------|
| Gateway API | 30012 | 30912 |
| Chat UI | 30080 | 30813 |
| v9 Web UI | — | 30909 |
| Neo4j Browser | — | 30747 |

## Image Build

```bash
# KG Server + Builder (neu)
cd osf-kg-builder/
docker build -f Dockerfile.server -t 192.168.178.150:32000/osf-kg-server:v9 .
docker push 192.168.178.150:32000/osf-kg-server:v9
docker build -f Dockerfile.builder -t 192.168.178.150:32000/osf-kg-builder:v9 .
docker push 192.168.178.150:32000/osf-kg-builder:v9

# Gateway + Chat UI (existierende Images, selber Code wie v8)
# Bereits im Registry: osf-gateway:latest, osf-chat-ui:latest
```

## Verifikation

1. **v8 unveraendert**: `kubectl get pods -n osf` → alle Running, kein Restart
2. **v9 Namespace**: `kubectl get pods -n osf-v9` → alle Running
3. **v9 Gateway Health**: `curl 192.168.178.150:30912/health`
4. **KG Server Health**: `kubectl exec deploy/osf-kg-server -n osf-v9 -- wget -qO- localhost:8035/health`
5. **MCP Discovery**: v9 Gateway sieht Sim v3 Tools UND KG Tools
6. **Chat Test**: `curl 192.168.178.150:30813` → Chat UI, fragen: "Welche Maschinen gibt es?"
7. **KG Tools**: Chat nutzt `kg_impact`, `discrete_order_load` etc.
8. **Neo4j**: `kubectl port-forward svc/osf-neo4j 37474:7474 -n osf-v9` → Browser

## Rollback

```bash
# v9 komplett entfernen — v8 merkt nichts:
kubectl delete namespace osf-v9
```
