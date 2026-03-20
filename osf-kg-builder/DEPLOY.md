# v8.x KG Platform — Deploy Plan

## Strategie: In-Place Upgrade, kein zweiter Gateway

Neo4j + KG Server deployen **neben** v8 im gleichen `osf` Namespace.
Gateway bleibt unveraendert — discovered die neuen KG Tools automatisch.
AGE und Neo4j laufen parallel bis Neo4j verifiziert ist, dann wird umgeschaltet.

```
┌─────────────────────────── osf namespace ────────────────────────────┐
│                                                                      │
│  Gateway (v8, UNGEAENDERT)                                          │
│  :8012                                                               │
│     │                                                                │
│     ├──→ Sim v3 (factory ns)          ← bestehend                   │
│     │    get_machines, get_orders...                                  │
│     │                                                                │
│     ├──→ KG Agent (AGE)               ← bestehend, wird abgeloest   │
│     │    kg_discovered_machines...     Stufe 3: runterskalieren      │
│     │                                                                │
│     ├──→ KG Server (NEU)              ← registriert sich automatisch │
│     │    :8035                          kg_impact, kg_search,        │
│     │    MCP + REST + MQTT              discrete_order_load...       │
│     │         │                                                      │
│     │         └──→ Neo4j (NEU)                                      │
│     │              :7687                                             │
│     │                                                                │
│     ├──→ Historian (NEU oder bestehend)                              │
│     │    :8030                                                       │
│     │    MQTT→TimescaleDB + history_* MCP Tools                     │
│     │                                                                │
│     │              KG Builder (Job, NEU)                             │
│     │              baut Graph on-demand, dann exit                   │
│     │                                                                │
│  PG (bestehend)   Redis (bestehend)   Chat UI (bestehend)           │
│  :5432            :6379               nginx                          │
└──────────────────────────────────────────────────────────────────────┘

┌── factory namespace ──┐   ┌── Extern ───────────────────────────┐
│  Factory Sim v3       │   │  LLM Server (.120:5001, :5003)     │
│  Fertigung :8020      │   │  MQTT Broker (.150:31883)           │
│  WMS :8022            │   │  PG Factory (.150:30432)            │
│  Montage :8023        │   └─────────────────────────────────────┘
│  Chef :8024           │
└───────────────────────┘
```

## 3-Stufen Migration

### Stufe 1: Neo4j parallel aufbauen

AGE laeuft weiter. Neo4j + KG Server + Historian werden daneben deployed.
Gateway sieht beide Tool-Sets — LLM entscheidet welches es nutzt.

```
Gateway discovered:
  ├── AGE KG Tools (bestehend)     → kg_discovered_machines, kg_machine_sensors
  ├── Sim v3 Tools (bestehend)     → get_machines, get_orders, get_articles...
  ├── Historian Tools (neu)        → history_get_trend, history_aggregate...
  └── Neo4j KG Tools (neu)        → kg_impact, kg_search, discrete_bom_tree...
```

### Stufe 2: Testen + Verifizieren

```bash
# Verify Graph
npm run verify -- --domain discrete --with-server --server-url http://osf-kg-server:8035

# Chat testen: "Welche Maschinen gibt es?"
# → LLM sollte Neo4j Tools bevorzugen (mehr Tools, bessere Beschreibungen)

# History testen: "OEE Trend der letzten 24 Stunden fuer SGM-004"
# → history_get_trend + kg_aggregate
```

### Stufe 3: AGE abschalten

Wenn Neo4j verifiziert ist:
```bash
# AGE KG Agent stoppen
kubectl scale deploy osf-kg-agent --replicas=0 -n osf

# Optional: AGE MCP Server aus Gateway entfernen
# (passiert automatisch wenn kg-agent offline ist)
```

Rollback jederzeit moeglich:
```bash
kubectl scale deploy osf-kg-agent --replicas=1 -n osf
```

---

## Was UNGEAENDERT bleibt

| Komponente | Aenderung |
|-----------|-----------|
| Gateway (v8) | KEINE — zero Code-Changes |
| Chat UI | KEINE |
| Frontend | KEINE |
| osf-postgres | KEINE (nur 1 INSERT in mcp_servers — automatisch) |
| osf-redis | KEINE |
| Sim v3 (factory ns) | KEINE |
| LLM Server (.120) | KEINE |
| MQTT Broker (.150) | KEINE |

## Was NEU deployed wird (osf Namespace)

| Service | Image | Port | Typ |
|---------|-------|------|-----|
| Neo4j | `neo4j:5.26-community` | 7687, 7474 | StatefulSet + PVC |
| KG Server | `192.168.178.150:32000/osf-kg-server:v9` | 8035 | Deployment |
| KG Builder | `192.168.178.150:32000/osf-kg-builder:v9` | — | Job (one-shot) |
| Historian | `192.168.178.150:32000/osf-historian:2.0.0` | 8030 | Deployment |

---

## DB-Aenderungen

### Bestehende Gateway-DB (osf-postgres) — 1 automatischer INSERT

```sql
-- Wird von register-mcp.ts beim KG-Server-Start automatisch ausgefuehrt:
INSERT INTO mcp_servers (id, name, url, auth_type, status, tool_count, categories)
VALUES (gen_random_uuid(), 'kg-v9', 'http://osf-kg-server:8035', 'none', 'online', 19, '{kg}')
ON CONFLICT (name) DO UPDATE SET url='http://osf-kg-server:8035', status='online', tool_count=19;
```

Kein manuelles SQL noetig. Gateway discovered die Tools innerhalb von 60s.

### Bestehende Gateway-DB — Historian registrieren

```sql
-- Falls Historian noch nicht registriert:
INSERT INTO mcp_servers (name, url, auth_type, status, tool_count, categories)
VALUES ('history', 'http://historian:8030', 'none', 'pending', 6, '{history}')
ON CONFLICT (name) DO NOTHING;
```

### PG Factory (.150:30432)

```sql
-- kg_builder_runs Tabelle — wird automatisch erstellt von saveSchemaRun()
-- Kein manuelles SQL noetig.
-- Bestehende Factory-Daten: UNBERUEHRT
```

### Neo4j (NEU)

```cypher
-- Wird automatisch von initializeGraph() erstellt:
CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE;
CREATE VECTOR INDEX node_embedding IF NOT EXISTS FOR (n:Node) ON (n.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}};
```

Nach KG Builder:
- Nodes: Machine, Article, Order, Material, Customer, Supplier, BOM
- Edges: RUNS_ON, PRODUCES, HAS_BOM, FOR_CUSTOMER, SUPPLIED_BY
- Embeddings: 768d nomic-embed-text auf allen Nodes
- History: Trend-Daten via Historian MCP Tools

### Zusammenfassung

```
Gateway DB (osf-postgres)  → 1 INSERT in mcp_servers (automatisch)
PG Factory (.150:30432)    → 1 neue Tabelle kg_builder_runs (automatisch)
Neo4j (neu)                → eigene Instanz, komplett getrennt
AGE (bestehend)            → bleibt parallel bis Stufe 3
```

---

## K8s Manifests (k8s/v9/)

### Zu erstellen/aktualisieren

| Datei | Beschreibung |
|-------|-------------|
| `neo4j.yaml` | StatefulSet + Service + PVC, namespace: osf |
| `kg-server.yaml` | Deployment + Service, namespace: osf |
| `kg-builder-job.yaml` | Job (one-shot), namespace: osf |
| `historian.yaml` | Deployment + Service, namespace: osf (falls noch nicht deployed) |

### Zu loeschen (veraltet)

| Datei | Grund |
|-------|-------|
| `kg-agent.yaml` | Ersetzt durch kg-server (Stufe 3) |
| `kg-builder.yaml` | Altes Monolith-Manifest, ersetzt |
| `mcp-proxy.yaml` | Nicht mehr noetig |
| `uns-stream.yaml` | MQTT Bridge ist im kg-server |
| `namespace.yaml` | Kein eigener Namespace mehr |
| `postgres.yaml` | Kein eigener PG mehr |
| `redis.yaml` | Kein eigener Redis mehr |
| `gateway.yaml` | Kein eigener Gateway mehr |
| `chat-ui.yaml` | Kein eigener Chat mehr |
| `v9-config.yaml` | Merged in bestehende osf-config |
| `v9-web.yaml` | Optional, spaeter |

### Env Vars (in bestehender osf-config ConfigMap ergaenzen)

```yaml
# KG Server + Builder (NEU)
NEO4J_URL: "bolt://osf-neo4j:7687"
NEO4J_USER: "neo4j"
NEO4J_DATABASE: "neo4j"
EMBEDDING_URL: "http://192.168.178.120:5003"
EMBEDDING_MODEL: "nomic-embed-text"
EMBEDDING_DIM: "768"
DOMAIN: "discrete"
HISTORIAN_URL: "http://historian:8030"
KG_SERVER_URL: "http://osf-kg-server:8035"
GATEWAY_DB_URL: "postgresql://admin:PASSWORD@osf-postgres:5432/osf"

# Historian (NEU, falls noch nicht da)
HISTORIAN_DB_HOST: "192.168.178.150"
HISTORIAN_DB_PORT: "30432"
HISTORIAN_DB_NAME: "bigdata_homelab"
HISTORIAN_DB_USER: "admin"
HISTORIAN_MCP_PORT: "8030"
HISTORIAN_FLUSH_MS: "5000"
MQTT_BROKER_URL: "mqtt://192.168.178.150:31883"
```

### Secrets (in bestehender osf-secrets ergaenzen)

```yaml
NEO4J_PASSWORD: "changeme"
# HISTORIAN_DB_PASSWORD: bereits als FACTORY_DB_PASSWORD vorhanden
```

---

## Deploy-Reihenfolge

```bash
# 0. Pruefen was laeuft
kubectl get pods -n osf
kubectl get pods -n factory

# 1. Neo4j deployen
kubectl apply -f k8s/v9/neo4j.yaml
kubectl wait --for=condition=ready pod -l app=osf-neo4j -n osf --timeout=120s

# 2. Historian deployen (falls noch nicht da)
kubectl get deploy historian -n osf 2>/dev/null || kubectl apply -f k8s/v9/historian.yaml
kubectl wait --for=condition=ready pod -l app=historian -n osf --timeout=60s

# 3. KG Server deployen (registriert sich automatisch im Gateway)
kubectl apply -f k8s/v9/kg-server.yaml
kubectl wait --for=condition=ready pod -l app=osf-kg-server -n osf --timeout=60s

# 4. KG Builder Job (baut Graph aus Sim v3 + Historian Daten)
kubectl apply -f k8s/v9/kg-builder-job.yaml
kubectl wait --for=condition=complete job/osf-kg-builder -n osf --timeout=300s

# 5. Verify
kubectl exec deploy/osf-kg-server -n osf -- node dist/builder/verify.js --domain discrete

# 6. Testen
# → Chat UI oeffnen, fragen: "Welche Maschinen gibt es?"
# → Gateway sollte kg_* und discrete_* Tools nutzen

# 7. (Spaeter) AGE abschalten wenn Neo4j verifiziert
# kubectl scale deploy osf-kg-agent --replicas=0 -n osf
```

## Image Build

```bash
cd osf-kg-builder/
docker build -f Dockerfile.server -t 192.168.178.150:32000/osf-kg-server:v9 .
docker push 192.168.178.150:32000/osf-kg-server:v9

docker build -f Dockerfile.builder -t 192.168.178.150:32000/osf-kg-builder:v9 .
docker push 192.168.178.150:32000/osf-kg-builder:v9

# Historian (falls Image noch nicht im Registry)
cd historian/
docker build -t 192.168.178.150:32000/osf-historian:2.0.0 .
docker push 192.168.178.150:32000/osf-historian:2.0.0
```

## Verifikation

1. **v8 unveraendert**: `kubectl get pods -n osf` → alle bestehenden Pods Running, kein Restart
2. **Neo4j**: `kubectl port-forward svc/osf-neo4j 37474:7474 -n osf` → Browser
3. **KG Server Health**: `kubectl exec deploy/osf-kg-server -n osf -- wget -qO- http://localhost:8035/health`
4. **MCP Discovery**: `SELECT name, url, status, tool_count FROM mcp_servers WHERE name='kg-v9'` → online
5. **Historian**: `kubectl exec deploy/historian -n osf -- wget -qO- http://localhost:8030/health`
6. **Chat**: "Welche Maschinen gibt es?" → LLM nutzt Neo4j Tools
7. **History**: "OEE Trend SGM-004 letzte 24h" → history_get_trend
8. **Verify CLI**: `npm run verify -- --domain discrete --with-server`

## Rollback

```bash
# KG Server + Neo4j entfernen — Gateway vergisst Tools in 60s:
kubectl delete -f k8s/v9/kg-server.yaml
kubectl delete -f k8s/v9/neo4j.yaml
# AGE KG Agent laeuft weiter, null Impact auf v8

# Oder nur KG Server stoppen (Neo4j Daten behalten):
kubectl scale deploy osf-kg-server --replicas=0 -n osf
```

## Datenfluesse

```
Historian-Pfad (historische Daten):
  Sim v3 → MQTT (.150:31883) → Historian → TimescaleDB (.150:30432/uns_history)
                                                ↑
  KG Builder ── history_get_trend ──────────────┘
             ── history_aggregate ──────────────┘
             ── history_machines ───────────────┘

Sim-v3-Pfad (aktuelle Daten):
  KG Builder ── get_machines ──→ Sim v3 MCP ──→ Factory PG (llm_test_v3)
             ── get_orders ────→
             ── get_articles ──→

Beide → deterministicExtract → Neo4j MERGE → Embeddings (768d) → Vector Index
```
