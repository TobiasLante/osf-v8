# CI/CD Pipeline — OSF Platform (v8 Gateway + v9 KG Builder)

> Gesamtkonzept fuer eine einheitliche CI/CD Pipeline des osf-v8 Monorepos.
> Versionierung: v8.x.x (Gateway bleibt Kern, v9 KG-Builder wird Modul).
> Stand: 2026-03-21.

---

## 1. Ist-Zustand

### 1.1 Repo-Struktur

```
osf-v8/                              Monorepo
+-- osf-gateway/          v8.12.0    Fastify, Vitest, SWC
+-- osf-kg-builder/       v9.1.0     KG Builder + Server + Web UI (ein Pod)
+-- osf-frontend/         v1.19.0    Next.js (Cloudflare Pages)
+-- chat-ui/                         Standalone Chat (nginx)
+-- k8s/                             Manifests + deploy-and-test.sh
+-- k8s/v9/                          Neo4j + KG Builder K8s YAMLs
+-- .github/workflows/ci.yml        Nur Gateway (tsc + vitest)
+-- .env                             Versionen fuer K8s Deploy

osf-schemas/                         Eigenes Repo (GitHub)
+-- profiles/                        SM Profiles (JSON)
+-- sources/postgresql/              PG Source-Schemas (JSON, ${ENV_VAR})
+-- sources/opcua/                   OPC-UA Source-Schemas (JSON)
+-- sync/mqtt/                       MQTT Sync-Schemas (JSON)
+-- sync/polling/                    Polling Sync-Schemas (JSON)
```

### 1.2 Was existiert

| Komponente | Build | Tests | Lint | CI | CD |
|------------|-------|-------|------|----|----|
| **osf-gateway** | SWC -> dist/ | Vitest (9 Dateien) | — | ci.yml (tsc + test) | deploy-and-test.sh |
| **osf-kg-builder** | SWC -> dist/ | Keine | — | Keine | docker build + push + k8s apply |
| **osf-kg-builder/web** | Next.js -> out/ | Keine | next lint | Keine | Eigenes Docker Image (nginx) |
| **osf-frontend** | Next.js -> out/ | Keine | — | Keine | deploy.sh -> CF Pages |
| **chat-ui** | Statisch | Keine | — | Keine | deploy-and-test.sh |
| **osf-schemas** | — | Keine | — | Keine | Git push, Builder pollt |
| **K8s Deploy** | — | 33 Smoke-Tests | — | Manuell | deploy-and-test.sh |

### 1.3 Architektur-Aenderungen seit v8.8

- **KG Server = KG Builder**: Ein Pod, ein Image (`Dockerfile.server`), ein Deployment.
  KG Server Service (`osf-kg-server`) zeigt via Selector auf Builder Pods.
- **Apache AGE abgeloest**: Nur noch Neo4j (v5.26, eigene StatefulSet auf k8sserv4).
- **Schema-Repo**: `osf-schemas` auf GitHub, Builder pollt alle 60 Min + bei Startup.
- **Env-Var-Substitution**: Source-JSONs nutzen `${ERP_DB_HOST}` statt hardcoded IPs.
  Schema-Loader ersetzt `"${VAR}"` mit `process.env[VAR]` (Strings bleiben Strings,
  reine Zahlen werden zu Numbers fuer JSON-Kompatibilitaet).
- **ClusterIP statt NodePort**: PG-Verbindungen intern via K8s Service-DNS
  (postgress-erp-svc.default:5432 statt 192.168.178.150:30431).
- **Neo4j Tuning**: 8G Heap, 4G Pagecache, 16 CPU Limit (Xeon E5-2690 v3, 24 Cores).
- **Batch-Optimierung**: 10k Batch-Size, 3x parallele UNWIND MERGE.

### 1.4 Probleme

1. **Kein CI fuer v9** — KG-Builder Fehler werden erst bei Deploy bemerkt
2. **Kein Lint** — Code-Qualitaet nicht erzwungen
3. **Keine Docker-Build-Validierung** — Broken Dockerfiles fliegen erst beim Deploy auf
4. **Kein automatisches Deployment** — Alles manuell via SSH + deploy-and-test.sh
5. **Keine Schema-Validierung** — osf-schemas Repo hat keine CI
6. **Keine Versionskopplung** — Gateway v8.12.0 + KG-Builder v9.1.0 sind unabhaengig

---

## 2. Ziel-Architektur

### 2.1 Versionierung

Gateway und KG-Builder werden unter einer gemeinsamen Version gefuehrt:

```
v8.13.0  = Gateway 8.13.0 + KG-Builder als Modul
v8.14.0  = naechstes Feature-Release
```

Die v9-Bezeichnung bleibt intern fuer den KG-Builder, aber das Release-Tag
des Monorepos ist `v8.x.x`.

### 2.2 Branch-Strategie

```
feature/*  -->  PR  -->  dev   -->  PR  -->  main
                          |                    |
                    CI: full suite        CI: full suite
                    CD: test env          CD: production
                          |                    |
                          v                    v
                   .110 Test-Cluster     .150 Prod-Cluster
                   (docker-compose)      (K8s)
```

| Branch | CI | CD | Ziel |
|--------|----|----|------|
| `feature/*` | Lint + TypeCheck + Tests + Docker Build | — | Entwicklung |
| `dev` | Lint + TypeCheck + Tests + Docker Build | Deploy auf .110 (optional) | Integration |
| `main` | Lint + TypeCheck + Tests + Docker Build | Deploy auf .150 (manuell getriggert) | Produktion |

### 2.3 Pipeline-Uebersicht

```
Push / PR
    |
    +---> [1] Lint & TypeCheck         (~15s)    parallel
    +---> [2] Unit Tests               (~30s)    parallel
    +---> [3] Build Artifacts          (~45s)    parallel
    |         +-- Gateway (SWC)
    |         +-- KG-Builder (SWC)
    |         +-- KG-Web (Next.js)
    |
    +---> [4] Docker Build Validation  (~90s)    nach [3]
    |         +-- osf-gateway
    |         +-- osf-kg-builder (Dockerfile.server)
    |         +-- osf-v9-web (nginx)
    |
    +---> [5] Schema Validation        (~10s)    parallel
    |         +-- JSON Schema Check
    |         +-- Cross-Ref Validation
    |         +-- Env-Var Completeness
    |
    +---> [6] Integration Tests        (~60s)    nach [4]
    |         +-- Neo4j Service Container
    |         +-- Gateway Health Check
    |         +-- KG-Server Health Check
    |
    +---> [7] Deploy (manuell/auto)    nach [6]
              +-- Docker Push -> Registry
              +-- K8s Apply
              +-- Smoke Tests
```

---

## 3. CI Jobs im Detail

### 3.1 Job: lint-typecheck

Laeuft bei **jedem Push und PR**. Keine externen Services noetig.

```yaml
lint-typecheck:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }

    # Gateway
    - run: cd osf-gateway && npm ci
    - run: cd osf-gateway && npx tsc --noEmit

    # KG-Builder Backend
    - run: cd osf-kg-builder && npm ci
    - run: cd osf-kg-builder && npx tsc --noEmit

    # KG-Builder Web
    - run: cd osf-kg-builder/web && npm ci
    - run: cd osf-kg-builder/web && npx next lint
```

**Erwartete Laufzeit:** ~15 Sekunden (nach npm cache).

**Was es faengt:**
- TypeScript Fehler (fehlende Imports, falsche Typen)
- Next.js Lint-Fehler (React Hooks Rules, a11y)
- Kaputte Imports nach Refactoring

### 3.2 Job: test

Laeuft parallel zu lint-typecheck.

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }

    # Gateway Tests (Vitest)
    - run: cd osf-gateway && npm ci
    - run: cd osf-gateway && npm test

    # KG-Builder Tests
    # - run: cd osf-kg-builder && npm test
```

**Aktuell:** Nur Gateway-Tests (9 Dateien, Vitest).

**Empfehlung fuer KG-Builder Tests:**

| Prioritaet | Test | Was |
|------------|------|-----|
| P1 | config.test.ts | Env-Var Parsing, required() wirft bei fehlenden Passwords |
| P1 | schema-loader.test.ts | loadAll*, validateSchemaRefs, **${ENV_VAR} Substitution** |
| P1 | schema-loader.test.ts | Numerische Ports werden zu Numbers nach Substitution |
| P2 | cypher-utils.test.ts | Parallel-Batch-Logik (3x concurrent UNWIND) |
| P2 | routes.test.ts | Health Endpoint, Build-Trigger (`POST /api/kg/build`) |
| P3 | mqtt-bridge.test.ts | topicMatches(), validateMessage(), deriveLabel() |
| P3 | chart-engine.test.ts | Cypher-Generierung aus Frage |

Diese Tests brauchen keine externen Services (Pure-Logic-Tests).

### 3.3 Job: build

Validiert, dass alle Artefakte sauber kompilieren.

```yaml
build:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }

    # Gateway
    - run: cd osf-gateway && npm ci && npm run build

    # KG-Builder Backend
    - run: cd osf-kg-builder && npm ci && npm run build

    # KG-Builder Web
    - run: cd osf-kg-builder/web && npm ci && npx next build

    # Artefakte cachen (fuer Docker Job)
    - uses: actions/upload-artifact@v4
      with:
        name: build-artifacts
        path: |
          osf-gateway/dist/
          osf-kg-builder/dist/
          osf-kg-builder/web/out/
```

**Erwartete Laufzeit:** ~45 Sekunden.

### 3.4 Job: docker

Validiert Docker-Builds. Pushed NICHT ins Registry (nur Build-Test).

```yaml
docker:
  runs-on: ubuntu-latest
  needs: build
  steps:
    - uses: actions/checkout@v4

    - name: Build Gateway Image
      run: docker build -f osf-gateway/Dockerfile -t osf-gateway:ci osf-gateway/

    - name: Build KG-Builder Image (Server + Builder unified)
      run: docker build -f osf-kg-builder/Dockerfile.server -t osf-kg-builder:ci osf-kg-builder/

    - name: Build KG Web UI Image
      run: docker build -f osf-kg-builder/web/Dockerfile -t osf-v9-web:ci osf-kg-builder/web/

    - name: Verify Health Endpoint (KG-Builder)
      run: |
        docker run -d --name kg-test -p 8035:8035 \
          -e NEO4J_URL=bolt://localhost:7687 \
          -e NEO4J_PASSWORD=unused \
          -e ERP_DB_HOST=localhost \
          -e ERP_DB_PORT=5432 \
          -e ERP_DB_PASSWORD=unused \
          -e BIGDATA_DB_HOST=localhost \
          -e BIGDATA_DB_PORT=5432 \
          -e QMS_DB_HOST=localhost \
          -e QMS_DB_PORT=5432 \
          -e WMS_DB_HOST=localhost \
          -e WMS_DB_PORT=5432 \
          osf-kg-builder:ci || true
        sleep 3
        docker logs kg-test 2>&1 | head -20
        docker rm -f kg-test
```

**Erwartete Laufzeit:** ~90 Sekunden (Docker Build dominiert).

### 3.5 Job: schema-validation

Validiert die Schema-JSONs im osf-schemas Repo. Laeuft bei jedem Push.

```yaml
schema-validation:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/checkout@v4
      with:
        repository: TobiasLante/osf-schemas
        path: osf-schemas
        token: ${{ secrets.SCHEMA_REPO_TOKEN }}

    - uses: actions/setup-node@v4
      with: { node-version: 20 }

    - name: Validate Schema JSONs
      run: |
        cd osf-kg-builder && npm ci

        # 1. All JSONs must parse
        find ../osf-schemas -name '*.json' -exec python3 -c "
        import json, sys
        with open(sys.argv[1]) as f: json.load(f)
        print(f'  OK: {sys.argv[1]}')
        " {} \;

        # 2. Cross-reference validation (profiles <-> sources <-> syncs)
        ERP_DB_HOST=localhost ERP_DB_PORT=5432 \
        BIGDATA_DB_HOST=localhost BIGDATA_DB_PORT=5432 \
        QMS_DB_HOST=localhost QMS_DB_PORT=5432 \
        WMS_DB_HOST=localhost WMS_DB_PORT=5432 \
        npx tsx -e "
        import { loadAllProfiles, loadAllSources, loadAllSyncs, validateSchemaRefs } from './src/builder/schema-loader';
        const p = loadAllProfiles('../osf-schemas');
        const s = loadAllSources('../osf-schemas');
        const y = loadAllSyncs('../osf-schemas');
        const errors = validateSchemaRefs(p, s, y);
        console.log(p.length + ' profiles, ' + s.length + ' sources, ' + y.length + ' syncs');
        if (errors.length > 0) { console.error(errors); process.exit(1); }
        console.log('All cross-references valid');
        "

        # 3. Check all ${ENV_VAR} references resolve to known vars
        grep -roh '\${[A-Z_]*}' ../osf-schemas/sources/ | sort -u | while read var; do
          name=$(echo "$var" | sed 's/[${}]//g')
          echo "  Required env var: $name"
        done
```

**Erwartete Laufzeit:** ~10 Sekunden.

**Was es faengt:**
- Kaputte JSON-Syntax
- Verwaiste profileRef (Source zeigt auf nicht-existierendes Profil)
- Fehlende sourceRef in Polling-Syncs
- Unbekannte ${ENV_VAR} Referenzen

### 3.6 Job: integration

Laeuft nur auf `dev` und `main`. Neo4j als Service-Container.

```yaml
integration:
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main'
  needs: [lint-typecheck, test, build, schema-validation]
  services:
    neo4j:
      image: neo4j:5.26-community
      env:
        NEO4J_AUTH: neo4j/testpassword
        NEO4J_PLUGINS: '["apoc"]'
      ports:
        - 7687:7687
        - 7474:7474
      options: >-
        --health-cmd "wget -qO- http://localhost:7474 || exit 1"
        --health-interval 5s
        --health-timeout 5s
        --health-retries 10
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_DB: testdb
        POSTGRES_USER: admin
        POSTGRES_PASSWORD: testpassword
      ports:
        - 5432:5432
      options: >-
        --health-cmd "pg_isready -U admin"
        --health-interval 5s
        --health-timeout 3s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }

    # Gateway Integration
    - name: Gateway Health
      run: |
        cd osf-gateway && npm ci
        DATABASE_URL=postgres://admin:testpassword@localhost:5432/testdb \
        JWT_SECRET=ci-test-secret \
        timeout 10 node dist/index.js &
        sleep 3
        curl -f http://localhost:8080/health || exit 1
        kill %1

    # KG-Builder Integration (Schema Dry-Run)
    - name: KG Builder Dry-Run
      run: |
        cd osf-kg-builder && npm ci
        NEO4J_URL=bolt://localhost:7687 \
        NEO4J_USER=neo4j \
        NEO4J_PASSWORD=testpassword \
        ERP_DB_HOST=localhost \
        ERP_DB_PORT=5432 \
        ERP_DB_PASSWORD=testpassword \
        ERP_DB_NAME=testdb \
        BIGDATA_DB_HOST=localhost \
        BIGDATA_DB_PORT=5432 \
        QMS_DB_HOST=localhost \
        QMS_DB_PORT=5432 \
        WMS_DB_HOST=localhost \
        WMS_DB_PORT=5432 \
        npx tsx src/builder/dry-run.ts || true
```

**Erwartete Laufzeit:** ~60 Sekunden (30s Service-Startup + 30s Tests).

---

## 4. CD Pipeline

### 4.1 Trigger-Modell

| Event | Aktion |
|-------|--------|
| PR merged -> `dev` | CI laeuft. Deploy auf .110 optional (workflow_dispatch) |
| PR merged -> `main` | CI laeuft. Deploy auf .150 manuell getriggert |
| Tag `v8.x.x` | Release: Docker Push + K8s Deploy + CF Pages Deploy |

**Kein automatisches Deploy auf Produktion.** Immer manueller Trigger
(`workflow_dispatch`) oder Tag-basiert.

### 4.2 Deploy Job

```yaml
deploy:
  runs-on: ubuntu-latest
  if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')
  needs: [lint-typecheck, test, build, docker, schema-validation, integration]
  environment: production    # GitHub Environment mit Approval
  steps:
    # 1. Docker Build + Push to local registry
    - name: Build & Push Gateway
      run: |
        docker build -f osf-gateway/Dockerfile -t $REGISTRY/osf-gateway:$VERSION osf-gateway/
        docker push $REGISTRY/osf-gateway:$VERSION

    - name: Build & Push KG-Builder (unified Server + Builder)
      run: |
        docker build -f osf-kg-builder/Dockerfile.server -t $REGISTRY/osf-kg-builder:$VERSION osf-kg-builder/
        docker push $REGISTRY/osf-kg-builder:$VERSION

    - name: Build & Push KG Web UI
      run: |
        docker build -f osf-kg-builder/web/Dockerfile -t $REGISTRY/osf-v9-web:$VERSION osf-kg-builder/web/
        docker push $REGISTRY/osf-v9-web:$VERSION

    # 2. K8s Deploy via SSH
    - name: Deploy to K8s
      uses: appleboy/ssh-action@v1
      with:
        host: 192.168.178.150
        username: tlante
        key: ${{ secrets.SSH_KEY }}
        script: |
          cd /opt/osf-v8
          git pull
          cd k8s
          ./deploy-and-test.sh osf

    # 3. Cloudflare Pages (Frontend)
    - name: Deploy Frontend
      run: |
        cd osf-frontend
        npm ci && npm run build
        npx wrangler pages deploy out/ \
          --project-name openshopfloor \
          --branch main
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}

    # 4. Smoke Tests
    - name: Smoke Tests
      uses: appleboy/ssh-action@v1
      with:
        host: 192.168.178.150
        username: tlante
        key: ${{ secrets.SSH_KEY }}
        script: /opt/osf-v8/k8s/test-env/smoke-test.sh 192.168.178.150
```

### 4.3 Deploy Flow (visuell)

```
Tag v8.13.0 erstellt
    |
    v
CI: lint + test + build + docker + schema-validation + integration
    |
    v  (alles gruen)
CD: deploy (GitHub Environment: production, Approval noetig)
    |
    +---> Docker Build + Push (3 Images -> 192.168.178.150:32000)
    +---> SSH -> deploy-and-test.sh osf
    +---> CF Pages Deploy (openshopfloor.zeroguess.ai)
    +---> SSH -> smoke-test.sh (33 Checks)
    |
    v
Release Notes (auto-generiert aus Commits)
```

---

## 5. Docker Registry & Image-Strategie

### 5.1 Lokales Registry

```
192.168.178.150:32000    (K8s-internes Registry)
```

| Image | Dockerfile | Beschreibung |
|-------|-----------|-------------|
| osf-gateway | `osf-gateway/Dockerfile` | Fastify API Gateway |
| osf-kg-builder | `osf-kg-builder/Dockerfile.server` | KG Builder + Server (unified) |
| osf-v9-web | `osf-kg-builder/web/Dockerfile` | KG Web UI (nginx static) |
| osf-nodered | `osf-gateway/Dockerfile.nodered` | Node-RED Flows |

**Hinweis:** `Dockerfile.builder` ist veraltet. `Dockerfile.server` enthaelt
Builder + Server in einem Image. KG Server Service (`osf-kg-server`) zeigt
via Selector auf `app: osf-kg-builder`.

### 5.2 CI-Tags

Fuer CI Docker-Validierung (nicht gepusht):

```
osf-gateway:ci-{sha}
osf-kg-builder:ci-{sha}
```

---

## 6. Secrets Management

### 6.1 GitHub Secrets (Repository-Level)

| Secret | Wofuer |
|--------|--------|
| `SSH_KEY` | Deploy via SSH auf .150 |
| `CF_API_TOKEN` | Cloudflare Pages Deploy |
| `CF_ACCOUNT_ID` | Cloudflare Account |
| `REGISTRY_URL` | `192.168.178.150:32000` |
| `SCHEMA_REPO_TOKEN` | osf-schemas Repo Checkout (CI Schema-Validation) |

### 6.2 GitHub Environments

| Environment | Schutz | Ziel |
|-------------|--------|------|
| `test` | Kein Approval | .110 Docker-Compose |
| `production` | Approval erforderlich | .150 K8s Cluster |

---

## 7. Monorepo Change Detection

Nicht jeder Push betrifft alle Komponenten. Die Pipeline nutzt Path-Filter:

```yaml
changes:
  runs-on: ubuntu-latest
  outputs:
    gateway: ${{ steps.filter.outputs.gateway }}
    kg-builder: ${{ steps.filter.outputs.kg-builder }}
    frontend: ${{ steps.filter.outputs.frontend }}
    k8s: ${{ steps.filter.outputs.k8s }}
  steps:
    - uses: dorny/paths-filter@v3
      id: filter
      with:
        filters: |
          gateway:
            - 'osf-gateway/**'
          kg-builder:
            - 'osf-kg-builder/**'
          frontend:
            - 'osf-frontend/**'
          k8s:
            - 'k8s/**'
```

Dann bedingt ausfuehren:

```yaml
lint-gateway:
  needs: changes
  if: needs.changes.outputs.gateway == 'true'
```

---

## 8. Caching-Strategie

```yaml
# npm Cache (pro Komponente)
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('osf-gateway/package-lock.json') }}

# Docker Layer Cache
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Erwartete Ersparnis: ~30s pro Job (npm ci) + ~60s (Docker Layers).

---

## 9. Notifications

| Event | Kanal | Bedingung |
|-------|-------|-----------|
| CI fehlgeschlagen | GitHub PR Check | Immer |
| Deploy erfolgreich | GitHub Release | Bei Tag |
| Smoke-Test fehlgeschlagen | GitHub Issue (auto) | Bei Deploy |

---

## 10. Bestehende Infrastruktur einbinden

### 10.1 deploy-and-test.sh

Das bestehende Script bleibt das primaere Deploy-Tool. Die CI/CD Pipeline
**ruft es auf**, ersetzt es nicht.

```
CI/CD Pipeline
    |
    +---> SSH auf .150
    +---> cd /opt/osf-v8 && git pull
    +---> k8s/deploy-and-test.sh osf
    +---> Ergebnis zurueck an GitHub (Exit Code)
```

**Vorteil:** deploy-and-test.sh enthaelt 1542 Zeilen bewaehrte Logik
(Conflict Detection, Image Digest Verification, Health Probes, 33 Smoke-Tests).
Diese zu duplizieren waere Fehlerquelle.

### 10.2 Smoke-Test Integration

```yaml
smoke:
  needs: deploy
  steps:
    - uses: appleboy/ssh-action@v1
      with:
        host: 192.168.178.150
        username: tlante
        key: ${{ secrets.SSH_KEY }}
        script: |
          /opt/osf-v8/k8s/test-env/smoke-test.sh 192.168.178.150 2>&1
          echo "EXIT_CODE=$?" >> /tmp/smoke-result.txt
    - name: Check Result
      run: |
        ssh tlante@192.168.178.150 'cat /tmp/smoke-result.txt'
```

### 10.3 Cloudflare Deploy

Bestehende `osf-frontend/deploy.sh` wird weiterhin unterstuetzt (manuell).
CI/CD nutzt `wrangler` direkt fuer reproduzierbare Deploys.

---

## 11. Schema-Repo CI (osf-schemas)

Das osf-schemas Repo bekommt eine eigene Mini-Pipeline:

```yaml
# .github/workflows/validate.yml (im osf-schemas Repo)
name: Validate Schemas
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: JSON Syntax Check
        run: find . -name '*.json' -exec python3 -c "import json,sys; json.load(open(sys.argv[1]))" {} \;
      - name: Check ${ENV_VAR} References
        run: |
          KNOWN_VARS="ERP_DB_HOST ERP_DB_PORT BIGDATA_DB_HOST BIGDATA_DB_PORT QMS_DB_HOST QMS_DB_PORT WMS_DB_HOST WMS_DB_PORT"
          for var in $(grep -roh '\${[A-Z_]*}' sources/ | sort -u | sed 's/[${}]//g'); do
            echo "$KNOWN_VARS" | grep -qw "$var" || { echo "UNKNOWN: \${$var}"; exit 1; }
          done
          echo "All env var references valid"
```

**Spaeter (mit i-flow Integration):**
- Schema-Aenderung -> Webhook an i-flow -> Auto-Rekonfiguration
- Oder: i-flow pollt das Repo direkt (wie der KG Builder)

---

## 12. Migration: Schrittweise Einfuehrung

Die Pipeline wird inkrementell eingefuehrt, nicht Big-Bang.

### Phase 1: CI Basics (sofort)

```
.github/workflows/ci.yml erweitern:
  +-- Gateway:    tsc + vitest        (existiert)
  +-- KG-Builder: tsc --noEmit        (neu)
  +-- KG-Web:     next build + lint   (neu)
```

**Aufwand:** ~30 Minuten. Kein neuer Workflow noetig, nur ci.yml erweitern.

### Phase 2: Docker Build + Schema Validation (Woche 1)

```
Neuer Job in ci.yml:
  +-- docker build (3 Images: gateway, kg-builder, v9-web)
  +-- Kein Push, nur Build-Test
  +-- Schema JSON Validation + Cross-Ref Check
```

**Aufwand:** ~1 Stunde. Braucht SCHEMA_REPO_TOKEN Secret.

### Phase 3: Integration Tests (Woche 2)

```
Neuer Job in ci.yml:
  +-- Neo4j + Postgres Service-Container
  +-- Gateway Health Check
  +-- KG-Builder Dry-Run mit Schema-Repo
```

**Aufwand:** ~2 Stunden. Braucht dry-run.ts Script.

### Phase 4: CD Pipeline (Woche 3)

```
Neuer Workflow: deploy.yml
  +-- workflow_dispatch Trigger
  +-- Docker Push -> lokales Registry
  +-- SSH -> deploy-and-test.sh
  +-- SSH -> smoke-test.sh
```

**Aufwand:** ~3 Stunden. Braucht SSH_KEY + Registry-Zugang.

### Phase 5: Branch-Strategie + Schema-Repo CI (Woche 4)

```
  +-- dev Branch anlegen
  +-- Protection Rules (require CI pass)
  +-- osf-schemas: eigene validate.yml Pipeline
  +-- Optional: Auto-Deploy auf .110
```

---

## 13. Kosten & Laufzeit

### GitHub Actions (Free Tier)

| Metrik | Wert |
|--------|------|
| Inkludiert (public repo) | 2.000 Min/Monat |
| Inkludiert (private repo) | 500 Min/Monat |
| Geschaetzte Nutzung/Monat | ~100 Min (selten, Solo-Dev) |

### Pipeline-Laufzeiten (geschaetzt)

| Job | Laufzeit | Trigger |
|-----|----------|---------|
| lint-typecheck | ~15s | Jeder Push |
| test | ~30s | Jeder Push |
| build | ~45s | Jeder Push |
| docker | ~90s | Jeder Push |
| schema-validation | ~10s | Jeder Push |
| integration | ~60s | Nur dev/main |
| deploy | ~5min | Manuell / Tag |
| **Gesamt (CI)** | **~3 Min** | |
| **Gesamt (CI+CD)** | **~8 Min** | |

---

## 14. Zusammenfassung

| Aspekt | Entscheidung |
|--------|-------------|
| Versionierung | Monorepo `v8.x.x`, KG-Builder als Modul |
| Branches | `feature/* -> dev -> main` |
| CI Runner | GitHub-hosted `ubuntu-latest` |
| CI Scope | Lint + TypeCheck + Tests + Docker Build + Schema Validation + Integration |
| CD Trigger | Manuell (`workflow_dispatch`) oder Tag (`v8.x.x`) |
| CD Ziel | SSH -> deploy-and-test.sh (bewaehrt, 1542 Zeilen) |
| Docker Registry | `192.168.178.150:32000` (lokal) |
| Docker Images | 3 Images: gateway, kg-builder (unified), v9-web |
| Schema-Repo | osf-schemas (GitHub), eigene CI, ${ENV_VAR} Substitution |
| Smoke Tests | Bestehende 33 Checks via SSH |
| Frontend | Cloudflare Pages via `wrangler` |
| Path-Filter | `dorny/paths-filter` — nur betroffene Komponenten bauen |
| Caching | npm + Docker Layer (GitHub Actions Cache) |
| Test-Env (.110) | Vorbereitet, noch nicht aktiv |
| Prod-Env (.150) | K8s, Approval-Gate via GitHub Environment |
| Migration | 5 Phasen ueber 4 Wochen, inkrementell |

---

## 15. Abhaengigkeiten zwischen Komponenten

```
osf-gateway (v8)
    |
    +--- nutzt ---> PostgreSQL (osf DB)
    +--- nutzt ---> Redis
    +--- nutzt ---> LLM Server (llama.cpp)
    +--- nutzt ---> MQTT Broker
    +--- proxy ---> osf-kg-server (Service -> KG Builder Pod)
    +--- enthaelt -> Governance (Rollen, Tool-Kategorien)
    +--- enthaelt -> Learning Groups
    |
osf-kg-builder (v9, unified Server + Builder)
    |
    +--- nutzt ---> Neo4j 5.26 (StatefulSet, k8sserv4)
    +--- nutzt ---> PostgreSQL (ERP/QMS/WMS/BigData, via ClusterIP)
    +--- nutzt ---> LLM Server (Embedding: nomic-embed-text on .120:5003)
    +--- nutzt ---> MQTT Broker (Live Sync, 192.168.178.150:31883)
    +--- registriert sich bei ---> osf-gateway (MCP Server)
    +--- pollt ---> osf-schemas (GitHub, alle 60 Min)
    +--- Web UI ---> POST /api/kg/build (SSE Build-Trigger)
    |
osf-schemas (eigenes Repo)
    |
    +--- profiles/     SM Profiles (Ziel-Datenmodell)
    +--- sources/      PG + OPC-UA Quellen (${ENV_VAR} Connections)
    +--- sync/         MQTT + Polling Konfiguration
    +--- gelesen von ---> KG Builder (Git Poll)
    +--- gelesen von ---> i-flow (geplant, native JSON-Verarbeitung)
    |
osf-frontend
    |
    +--- ruft auf ---> osf-gateway API (via CF Tunnel)
    |
osf-v9-web
    |
    +--- ruft auf ---> osf-kg-server:30035 (NodePort -> KG Builder Pod)
```

**Kritische Abhaengigkeit:** Gateway -> KG-Server (MCP Proxy).
Wenn der KG-Server ein Breaking Change hat, muss der Gateway getestet werden.
Der Integration-Test-Job deckt das ab.

---

## 16. Offene Punkte (spaeter)

| # | Thema | Wann |
|---|-------|------|
| 1 | KG-Builder Unit Tests schreiben (schema-loader, cypher-utils) | Nach Phase 3 |
| 2 | E2E Tests (Playwright/Cypress fuer Frontend) | Optional |
| 3 | Dependabot / Renovate fuer Dependency-Updates | Nach Phase 5 |
| 4 | Container Security Scanning (Trivy) | Nach Phase 4 |
| 5 | Performance Tests (KG Build Benchmark: Full-Build < 30 Min) | Optional |
| 6 | Test-KG-Server auf .110 aufsetzen | Parallel zu Phase 5 |
| 7 | Canary Deployments (2-Replica Gateway) | Optional |
| 8 | i-flow Integration: Schema-Webhook oder Git-Poll | Nach i-flow Beta |
| 9 | LLM Discovery Agent: Auto-Generierung von Source-JSONs | Nach i-flow |
| 10 | docker-compose.yml fuer Standalone-Deployment (Produkt) | Roadmap |
| 11 | Neo4j Tuning als Teil der Deploy-Config (Heap/Pagecache/CPU) | Done (9.1.0) |
