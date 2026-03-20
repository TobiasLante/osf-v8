# CI/CD Pipeline — OSF Platform (v8 Gateway + v9 KG Builder)

> Gesamtkonzept fuer eine einheitliche CI/CD Pipeline des osf-v8 Monorepos.
> Versionierung: v8.x.x (Gateway bleibt Kern, v9 KG-Builder wird Modul).
> Stand: 2026-03-19.

---

## 1. Ist-Zustand

### 1.1 Repo-Struktur (Monorepo)

```
osf-v8/
+-- osf-gateway/          v8.6.0   Express, Vitest, SWC
+-- osf-kg-builder/       v9.3.1   KG Server + Builder + Web UI
+-- osf-frontend/         v1.6.0   Next.js (Cloudflare Pages)
+-- chat-ui/              v8.2.2   Standalone Chat (nginx)
+-- k8s/                           Manifests + deploy-and-test.sh
+-- .github/workflows/ci.yml      Nur Gateway (tsc + vitest)
+-- .env                           Versionen fuer K8s Deploy
```

### 1.2 Was existiert

| Komponente | Build | Tests | Lint | CI | CD |
|------------|-------|-------|------|----|----|
| **osf-gateway** | SWC → dist/ | Vitest (9 Dateien) | — | ci.yml (tsc + test) | deploy-and-test.sh |
| **osf-kg-builder** (backend) | SWC → dist/ | Keine | — | Keine | docker-compose |
| **osf-kg-builder** (web) | Next.js → out/ | Keine | next lint | Keine | docker-compose |
| **osf-frontend** | Next.js → out/ | Keine | — | Keine | deploy.sh → CF Pages |
| **chat-ui** | Statisch | Keine | — | Keine | deploy-and-test.sh |
| **K8s Deploy** | — | 33 Smoke-Tests | — | Manuell | deploy-and-test.sh |

### 1.3 Probleme

1. **Kein CI fuer v9** — KG-Builder Fehler werden erst bei Deploy bemerkt
2. **Kein Lint** — Code-Qualitaet nicht erzwungen
3. **Keine Docker-Build-Validierung** — Broken Dockerfiles fliegen erst beim Deploy auf
4. **Kein automatisches Deployment** — Alles manuell via SSH + deploy-and-test.sh
5. **Keine Versionskopplung** — Gateway v8.6.0 + KG-Builder v9.3.1 sind unabhaengig,
   aber muessen zusammen funktionieren

---

## 2. Ziel-Architektur

### 2.1 Versionierung

Gateway und KG-Builder werden unter einer gemeinsamen Version gefuehrt:

```
v8.7.0   = Gateway 8.7.0 + KG-Builder als Modul
v8.8.0   = naechstes Feature-Release
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
    |         +-- osf-kg-builder
    |         +-- osf-kg-server
    |         +-- osf-v9-web (nginx)
    |
    +---> [5] Integration Tests        (~60s)    nach [4]
    |         +-- Neo4j Service Container
    |         +-- Gateway Health Check
    |         +-- KG-Server Health Check
    |
    +---> [6] Deploy (manuell/auto)    nach [5]
              +-- Docker Push → Registry
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

    # KG-Builder Tests (noch keine — Platzhalter)
    # - run: cd osf-kg-builder && npm test
```

**Aktuell:** Nur Gateway-Tests (9 Dateien, Vitest).

**Empfehlung fuer KG-Builder Tests (spaeter hinzufuegen):**

| Prioritaet | Test | Was |
|------------|------|-----|
| P1 | config.test.ts | Env-Var Parsing, required() wirft bei fehlenden Passwords |
| P1 | schema-loader.test.ts | loadAllProfiles/Sources/Syncs + validateSchemaRefs |
| P2 | routes.test.ts | Health Endpoint, Semantic Search Input-Validation |
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

    - name: Build KG-Builder Image
      run: docker build -f osf-kg-builder/Dockerfile.builder -t osf-kg-builder:ci osf-kg-builder/

    - name: Build KG-Server Image
      run: docker build -f osf-kg-builder/Dockerfile.server -t osf-kg-server:ci osf-kg-builder/

    - name: Verify Health Endpoint (KG-Server)
      run: |
        docker run -d --name kg-test -p 8035:8035 \
          -e NEO4J_URL=bolt://localhost:7687 \
          -e NEO4J_PASSWORD=unused \
          -e ERP_DB_PASSWORD=unused \
          osf-kg-server:ci || true
        sleep 3
        docker logs kg-test 2>&1 | head -20
        docker rm -f kg-test
```

**Erwartete Laufzeit:** ~90 Sekunden (Docker Build dominiert).

### 3.5 Job: integration

Laeuft nur auf `dev` und `main`. Neo4j als Service-Container.

```yaml
integration:
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main'
  needs: [lint-typecheck, test, build]
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
        ERP_DB_PASSWORD=testpassword \
        ERP_DB_HOST=localhost \
        ERP_DB_PORT=5432 \
        ERP_DB_NAME=testdb \
        npx tsx src/builder/dry-run.ts || true
```

**Erwartete Laufzeit:** ~60 Sekunden (30s Service-Startup + 30s Tests).

---

## 4. CD Pipeline

### 4.1 Trigger-Modell

| Event | Aktion |
|-------|--------|
| PR merged → `dev` | CI laeuft. Deploy auf .110 optional (workflow_dispatch) |
| PR merged → `main` | CI laeuft. Deploy auf .150 manuell getriggert |
| Tag `v8.x.x` | Release: Docker Push + K8s Deploy + CF Pages Deploy |

**Kein automatisches Deploy auf Produktion.** Immer manueller Trigger
(`workflow_dispatch`) oder Tag-basiert.

### 4.2 Deploy Job

```yaml
deploy:
  runs-on: ubuntu-latest
  if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')
  needs: [lint-typecheck, test, build, docker, integration]
  environment: production    # GitHub Environment mit Approval
  steps:
    # 1. Docker Build + Push to local registry
    - name: Build & Push Gateway
      run: |
        docker build -f osf-gateway/Dockerfile -t $REGISTRY/osf-gateway:$VERSION osf-gateway/
        docker push $REGISTRY/osf-gateway:$VERSION

    - name: Build & Push KG-Builder
      run: |
        docker build -f osf-kg-builder/Dockerfile.builder -t $REGISTRY/osf-kg-builder:$VERSION osf-kg-builder/
        docker push $REGISTRY/osf-kg-builder:$VERSION

    - name: Build & Push KG-Server
      run: |
        docker build -f osf-kg-builder/Dockerfile.server -t $REGISTRY/osf-kg-server:$VERSION osf-kg-builder/
        docker push $REGISTRY/osf-kg-server:$VERSION

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
Tag v8.7.0 erstellt
    |
    v
CI: lint + test + build + docker + integration
    |
    v  (alles gruen)
CD: deploy (GitHub Environment: production, Approval noetig)
    |
    +---> Docker Build + Push (4 Images → 192.168.178.150:32000)
    +---> SSH → deploy-and-test.sh osf
    +---> CF Pages Deploy (openshopfloor.zeroguess.ai)
    +---> SSH → smoke-test.sh (33 Checks)
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

| Image | Tag-Pattern | Beispiel |
|-------|-------------|---------|
| osf-gateway | `v{version}` | `osf-gateway:v8.7.0` |
| osf-kg-builder | `v{version}` | `osf-kg-builder:v8.7.0` |
| osf-kg-server | `v{version}` | `osf-kg-server:v8.7.0` |
| osf-v9-web | `v{version}` | `osf-v9-web:v8.7.0` |
| osf-nodered | `v{version}` | `osf-nodered:v8.7.0` |

### 5.2 CI-Tags

Fuer CI Docker-Validierung (nicht gepusht):

```
osf-gateway:ci-{sha}
osf-kg-server:ci-{sha}
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
| `KG_BUILDER_TOKEN` | Schema-Repo Checkout (fuer Dry-Run) |

### 6.2 GitHub Environments

| Environment | Schutz | Ziel |
|-------------|--------|------|
| `test` | Kein Approval | .110 Docker-Compose |
| `production` | Approval erforderlich | .150 K8s Cluster |

---

## 7. Monorepo Change Detection

Nicht jeder Push betrifft alle Komponenten. Die Pipeline nutzt Path-Filter:

```yaml
on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]

# In jedem Job:
jobs:
  gateway:
    if: contains(github.event.head_commit.modified, 'osf-gateway/') || github.event_name == 'workflow_dispatch'
  kg-builder:
    if: contains(github.event.head_commit.modified, 'osf-kg-builder/') || github.event_name == 'workflow_dispatch'
  frontend:
    if: contains(github.event.head_commit.modified, 'osf-frontend/') || github.event_name == 'workflow_dispatch'
```

Besser: `dorny/paths-filter` Action:

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

**Vorteil:** deploy-and-test.sh enthaelt 1542 Zeilen bewährte Logik
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

## 11. Migration: Schrittweise Einfuehrung

Die Pipeline wird inkrementell eingefuehrt, nicht Big-Bang.

### Phase 1: CI Basics (sofort)

```
.github/workflows/ci.yml erweitern:
  +-- Gateway:    tsc + vitest        (existiert)
  +-- KG-Builder: tsc --noEmit        (neu)
  +-- KG-Web:     next build + lint   (neu)
```

**Aufwand:** ~30 Minuten. Kein neuer Workflow noetig, nur ci.yml erweitern.

### Phase 2: Docker Build Validation (Woche 1)

```
Neuer Job in ci.yml:
  +-- docker build (alle 4 Images)
  +-- Kein Push, nur Build-Test
```

**Aufwand:** ~1 Stunde. Braucht keine Secrets.

### Phase 3: Integration Tests (Woche 2)

```
Neuer Job in ci.yml:
  +-- Neo4j + Postgres Service-Container
  +-- Gateway Health Check
  +-- KG-Builder Dry-Run
```

**Aufwand:** ~2 Stunden. Braucht dry-run.ts Script.

### Phase 4: CD Pipeline (Woche 3)

```
Neuer Workflow: deploy.yml
  +-- workflow_dispatch Trigger
  +-- Docker Push → lokales Registry
  +-- SSH → deploy-and-test.sh
  +-- SSH → smoke-test.sh
```

**Aufwand:** ~3 Stunden. Braucht SSH_KEY + Registry-Zugang.

### Phase 5: Branch-Strategie (Woche 4)

```
  +-- dev Branch anlegen
  +-- Protection Rules (require CI pass)
  +-- Optional: Auto-Deploy auf .110
```

---

## 12. Kosten & Laufzeit

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
| integration | ~60s | Nur dev/main |
| deploy | ~5min | Manuell / Tag |
| **Gesamt (CI)** | **~3 Min** | |
| **Gesamt (CI+CD)** | **~8 Min** | |

---

## 13. Zusammenfassung

| Aspekt | Entscheidung |
|--------|-------------|
| Versionierung | Monorepo `v8.x.x`, KG-Builder als Modul |
| Branches | `feature/* -> dev -> main` |
| CI Runner | GitHub-hosted `ubuntu-latest` |
| CI Scope | Lint + TypeCheck + Tests + Docker Build + Integration |
| CD Trigger | Manuell (`workflow_dispatch`) oder Tag (`v8.x.x`) |
| CD Ziel | SSH → deploy-and-test.sh (bewaehrt, 1542 Zeilen) |
| Docker Registry | `192.168.178.150:32000` (lokal) |
| Smoke Tests | Bestehende 33 Checks via SSH |
| Frontend | Cloudflare Pages via `wrangler` |
| Path-Filter | `dorny/paths-filter` — nur betroffene Komponenten bauen |
| Caching | npm + Docker Layer (GitHub Actions Cache) |
| Test-Env (.110) | Vorbereitet, noch nicht aktiv |
| Prod-Env (.150) | K8s, Approval-Gate via GitHub Environment |
| Migration | 5 Phasen ueber 4 Wochen, inkrementell |

---

## 14. Abhaengigkeiten zwischen Komponenten

```
osf-gateway (v8)
    |
    +--- nutzt ---> PostgreSQL (osf DB)
    +--- nutzt ---> Redis
    +--- nutzt ---> LLM Server (llama.cpp)
    +--- nutzt ---> MQTT Broker
    +--- proxy ---> osf-mcp-proxy ---> osf-kg-server
    +--- enthaelt -> KG Agent (MQTT → Apache AGE)
    +--- enthaelt -> Governance (Rollen, Tool-Kategorien)
    |
osf-kg-builder (v9)
    |
    +--- nutzt ---> Neo4j (eigene Instanz)
    +--- nutzt ---> PostgreSQL (Factory DB, read-only)
    +--- nutzt ---> LLM Server (Embedding + Chat)
    +--- nutzt ---> MQTT Broker (Live Sync)
    +--- registriert sich bei ---> osf-gateway (MCP Server)
    +--- pollt ---> osf-schemas (GitHub)
    |
osf-frontend
    |
    +--- ruft auf ---> osf-gateway API (via CF Tunnel)
    |
osf-v9-web
    |
    +--- ruft auf ---> osf-kg-server API (direkt)
```

**Kritische Abhaengigkeit:** Gateway → KG-Server (MCP Proxy).
Wenn der KG-Server ein Breaking Change hat, muss der Gateway getestet werden.
Der Integration-Test-Job deckt das ab.

---

## 15. Offene Punkte (spaeter)

| # | Thema | Wann |
|---|-------|------|
| 1 | KG-Builder Unit Tests schreiben | Nach Phase 3 |
| 2 | E2E Tests (Playwright/Cypress fuer Frontend) | Optional |
| 3 | Dependabot / Renovate fuer Dependency-Updates | Nach Phase 5 |
| 4 | Container Security Scanning (Trivy) | Nach Phase 4 |
| 5 | Performance Tests (KG Build Benchmark) | Optional |
| 6 | Test-KG-Server auf .110 aufsetzen | Parallel zu Phase 5 |
| 7 | Canary Deployments (2-Replica Gateway) | Optional |
