# CI/CD Pipeline — osf-schemas Repository

> Konzept & Architektur fuer die GitHub CI/CD Pipeline des Schema-Repos
> (`TobiasLante/osf-schemas`). Stand: 2026-03-19.

---

## 1. Status Quo

Das Schema-Repo wird vom KG-Server per Git-Polling konsumiert:

```
GitHub Repo (main branch)
    |  git clone --depth 1 (bei Server-Start)
    |  git pull (alle 60s polling)
/tmp/osf-schemas/
    +-- profiles/*.json      <-- SM Profiles (Type System)
    +-- sources/**/*.json    <-- Data Sources (OPC-UA, PostgreSQL)
    +-- sync/**/*.json       <-- Live Sync (MQTT, Polling, PG-NOTIFY)
    |
validateSchemaRefs()         <-- Cross-Reference Check
    |
buildFromSchemas()           <-- 5-Phasen Neo4j Build
```

**Problem:** Keine Validierung vor dem Merge. Kaputte JSON oder falsche
`profileRef` werden erst zur Laufzeit vom KG-Server bemerkt.

---

## 2. Ziel-Architektur

### 2.1 Repo-Struktur

```
osf-schemas/
+-- .schemas/                        <-- JSON Schemas (aus KG-Builder generiert)
|   +-- sm-profile.schema.json
|   +-- source-schema.schema.json
|   +-- sync-schema.schema.json
+-- .github/
|   +-- workflows/
|       +-- validate.yml             <-- CI Pipeline
+-- .vscode/
|   +-- settings.json                <-- JSON Schema Mapping (VS Code Autocompletion)
+-- profiles/
|   +-- injection-molding-machine.json
|   +-- cnc-machine.json
|   +-- ...
+-- sources/
|   +-- opcua/
|   |   +-- sgm-002.json
|   +-- postgresql/
|       +-- erp-orders.json
+-- sync/
|   +-- mqtt/
|   |   +-- factory-sim-v3.json
|   +-- polling/
|   |   +-- erp-poll.json
|   +-- pg-notify/
|       +-- listener.json
+-- scripts/
|   +-- validate.ts                  <-- Standalone Validation Script
|   +-- package.json                 <-- Minimal deps (ajv, glob)
+-- README.md
```

### 2.2 Branch-Strategie

```
feature/*  -->  PR  -->  dev   -->  PR  -->  main
                         |                    |
                   CI: validate          CI: validate
                   CI: dry-run           CI: dry-run
                         |                    |
                         v                    v
                  [Test-KG-Server]      Prod-KG-Server
                  (vorbereitet,         (polls main,
                   noch nicht aktiv)     SCHEMA_REPO_BRANCH=main)
```

- **feature/*** : Entwicklung. CI laeuft auf PR.
- **dev** : Integrationsbranch. Test-KG-Server pollt diesen Branch
  (`SCHEMA_REPO_BRANCH=dev`). Aktuell noch kein Test-Server vorhanden,
  aber die Config ist vorbereitet.
- **main** : Produktion. Prod-KG-Server pollt diesen Branch.
- Merge `dev -> main` ist ein bewusster Promote-Schritt.

---

## 3. CI Pipeline

### 3.1 Uebersicht

```yaml
# .github/workflows/validate.yml
Trigger: push (dev, main) + pull_request

Jobs:
  validate:        JSON Lint + Schema Validation + Cross-Refs + Naming
  dry-run:         Echter Neo4j Build (Phase 1 + 2a), nur auf dev/main
```

### 3.2 Job: validate

Laeuft bei **jedem Push und PR**. Kein Service-Container noetig.

| Step | Was | Tool |
|------|-----|------|
| 1. JSON Lint | Syntaxpruefung aller `*.json` | `jsonlint` oder Node.js `JSON.parse` |
| 2. JSON Schema Validation | Strukturvalidierung gegen `.schemas/*.json` | `ajv` |
| 3. Cross-Reference Check | `profileRef` existiert, `sourceRef` existiert | `scripts/validate.ts` |
| 4. Naming Conventions | Dateinamen lowercase-kebab, IDs konsistent | `scripts/validate.ts` |
| 5. Diff Summary | Welche Profiles/Sources/Syncs geaendert? | PR Comment via `actions/github-script` |

**Erwartete Laufzeit:** < 10 Sekunden.

### 3.3 Job: dry-run

Laeuft nur bei **Push auf dev oder main**. Nutzt Neo4j Service-Container.

| Step | Was |
|------|-----|
| 1. Neo4j starten | `neo4j:5.26-community` als Service |
| 2. KG-Builder Deps | `npm ci` im KG-Builder Verzeichnis (oder Checkout) |
| 3. Phase 1: Type System | Constraints anlegen — validiert Profile |
| 4. Phase 2a: OPC-UA Instances | MERGE Nodes — validiert Sources mit `sourceType: opcua` |
| 5. Report | Constraints, Nodes, Edges zaehlen + als Summary ausgeben |

**Uebersprungen (kein Zugang in CI):**
- Phase 2b: PostgreSQL Sources (braucht Factory-DB)
- Phase 3a-c: MQTT / Polling / PG-NOTIFY (braucht Broker/DB)

**Erwartete Laufzeit:** ~45 Sekunden (30s Neo4j Startup + 15s Build).

### 3.4 Workflow Definition

```yaml
name: Schema Validation

on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install validation deps
        working-directory: scripts
        run: npm ci

      - name: JSON Lint
        run: |
          find profiles sources sync -name '*.json' -exec node -e '
            const fs = require("fs");
            const f = process.argv[1];
            try { JSON.parse(fs.readFileSync(f, "utf8")); }
            catch (e) { console.error(f + ": " + e.message); process.exit(1); }
          ' {} \;

      - name: JSON Schema Validation
        working-directory: scripts
        run: npx tsx validate.ts --schemas

      - name: Cross-Reference Check
        working-directory: scripts
        run: npx tsx validate.ts --refs

      - name: Naming Conventions
        working-directory: scripts
        run: npx tsx validate.ts --naming

  dry-run:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    needs: validate
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
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: TobiasLante/osf-v8
          path: kg-builder
          sparse-checkout: osf-kg-builder
          token: ${{ secrets.KG_BUILDER_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install KG Builder
        working-directory: kg-builder/osf-kg-builder
        run: npm ci

      - name: Run Dry Build (Phase 1 + 2a)
        working-directory: kg-builder/osf-kg-builder
        env:
          NEO4J_URL: bolt://localhost:7687
          NEO4J_USER: neo4j
          NEO4J_PASSWORD: testpassword
          NEO4J_DATABASE: neo4j
          ERP_DB_PASSWORD: unused
          SCHEMA_LOCAL_PATH: ${{ github.workspace }}
        run: npx tsx src/builder/dry-run.ts

      - name: Build Summary
        if: always()
        run: |
          echo "## Dry-Run Results" >> $GITHUB_STEP_SUMMARY
          cat kg-builder/osf-kg-builder/dry-run-report.json 2>/dev/null \
            | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
              console.log("| Metric | Count |");
              console.log("|--------|-------|");
              console.log("| Profiles | " + r.profiles + " |");
              console.log("| Constraints | " + r.constraintsCreated + " |");
              console.log("| Nodes Merged | " + r.nodesMerged + " |");
              console.log("| Edges Created | " + r.edgesCreated + " |");
              console.log("| Errors | " + r.errors.length + " |");
              if(r.errors.length) r.errors.forEach(e=>console.log("- " + e));
            ' >> $GITHUB_STEP_SUMMARY || echo "No report generated" >> $GITHUB_STEP_SUMMARY
```

---

## 4. JSON Schema Generierung

### 4.1 Quelle

Die TypeScript-Interfaces (`SMProfile`, `SourceSchema`, `SyncSchema`) leben in:

```
osf-kg-builder/src/shared/schema-types.ts
```

### 4.2 Generierung

Per npm-Script im KG-Builder-Repo:

```bash
npm run generate-schemas
# -> generiert .schemas/sm-profile.schema.json
# -> generiert .schemas/source-schema.schema.json
# -> generiert .schemas/sync-schema.schema.json
```

Implementierung mit `ts-json-schema-generator`:

```jsonc
// package.json (KG-Builder)
{
  "scripts": {
    "generate-schemas": "ts-json-schema-generator --path src/shared/schema-types.ts --type SMProfile -o ../osf-schemas/.schemas/sm-profile.schema.json && ts-json-schema-generator --path src/shared/schema-types.ts --type SourceSchema -o ../osf-schemas/.schemas/source-schema.schema.json && ts-json-schema-generator --path src/shared/schema-types.ts --type SyncSchema -o ../osf-schemas/.schemas/sync-schema.schema.json"
  }
}
```

### 4.3 Sync-Strategie

**Manuell mit npm-Script** (pragmatisch fuer Solo-Entwickler):
- `npm run generate-schemas` ausfuehren wenn sich `schema-types.ts` aendert
- Generierte Schemas ins Schema-Repo committen

**Upgrade-Pfad** (falls spaeter noetig):
- KG-Builder CI pusht automatisch per Cross-Repo-Token ins Schema-Repo
- Trigger: Aenderung an `schema-types.ts`

### 4.4 VS Code Integration

```jsonc
// osf-schemas/.vscode/settings.json
{
  "json.schemas": [
    {
      "fileMatch": ["profiles/**/*.json"],
      "url": "./.schemas/sm-profile.schema.json"
    },
    {
      "fileMatch": ["sources/**/*.json"],
      "url": "./.schemas/source-schema.schema.json"
    },
    {
      "fileMatch": ["sync/**/*.json"],
      "url": "./.schemas/sync-schema.schema.json"
    }
  ]
}
```

---

## 5. Validation Script

Standalone Script im Schema-Repo (`scripts/validate.ts`). Dupliziert die
Cross-Ref-Logik aus dem KG-Builder (~50 Zeilen), da die Validierungsregeln
simpel und stabil sind.

### 5.1 Funktionen

```
validate.ts --schemas    JSON Schema Validation (ajv)
validate.ts --refs       Cross-Reference Check
validate.ts --naming     Naming Conventions
validate.ts --all        Alle Checks
```

### 5.2 Cross-Reference Regeln

| Feld | Muss existieren in |
|------|--------------------|
| `SourceSchema.profileRef` | `profiles/*.json → profileId` |
| `SyncSchema.sources[].sourceRef` | `sources/**/*.json → sourceId` |

### 5.3 Naming Conventions

| Regel | Beispiel |
|-------|---------|
| Dateinamen: `lowercase-kebab.json` | `injection-molding-machine.json` |
| profileId: `SMProfile-PascalCase` | `SMProfile-InjectionMoldingMachine` |
| sourceId: `lowercase-kebab` | `opcua-sgm-002` |
| syncId: `lowercase-kebab` | `uns-factory-sim-v3` |

### 5.4 Dependencies

```jsonc
// scripts/package.json
{
  "private": true,
  "dependencies": {
    "ajv": "^8.17.0",
    "glob": "^11.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 6. Dry-Run Builder

Neues Script im KG-Builder: `src/builder/dry-run.ts`.

Fuehrt nur Phase 1 (Type System) und Phase 2a (OPC-UA Instances) aus.
Schreibt Report als JSON.

```typescript
// src/builder/dry-run.ts (Pseudocode)
import { loadAllProfiles, loadAllSources, loadAllSyncs, validateSchemaRefs } from './schema-loader';
import { buildTypeSystem, buildInstances } from './schema-kg-builder';

const basePath = process.env.SCHEMA_LOCAL_PATH || '/tmp/osf-schemas';
const profiles = loadAllProfiles(basePath);
const sources  = loadAllSources(basePath);
const syncs    = loadAllSyncs(basePath);

// Validate cross-refs
const errors = validateSchemaRefs(profiles, sources, syncs);
if (errors.length > 0) {
  console.error('Validation errors:', errors);
  process.exit(1);
}

// Phase 1: Type System
const constraints = await buildTypeSystem(profiles);

// Phase 2a: OPC-UA Instances only
const opcuaSources = sources.filter(s => s.sourceType === 'opcua');
const { nodesMerged, edgesCreated } = await buildInstances(opcuaSources, profiles);

// Report
const report = { profiles: profiles.length, constraintsCreated: constraints,
                 nodesMerged, edgesCreated, errors: [] };
fs.writeFileSync('dry-run-report.json', JSON.stringify(report, null, 2));
```

---

## 7. Secrets & Tokens

| Secret | Wo | Wofuer |
|--------|----|--------|
| `KG_BUILDER_TOKEN` | Schema-Repo | Checkout des KG-Builder-Repos fuer Dry-Run |
| `SCHEMA_REPO_TOKEN` | KG-Builder-Repo | (Optional) Auto-Push von generierten JSON Schemas |

Beide sind GitHub Personal Access Tokens (fine-grained) mit `contents: read`
auf das jeweilige Repo.

---

## 8. Zusammenfassung

| Aspekt | Entscheidung |
|--------|-------------|
| CI Runner | GitHub-hosted `ubuntu-latest` |
| Validation | JSON Lint + JSON Schema (ajv) + Cross-Refs + Naming |
| Dry-Run | Echte Neo4j 5.26 in Service-Container, Phase 1 + 2a |
| JSON Schema Sync | Manuell via `npm run generate-schemas` im KG-Builder |
| Branch-Strategie | `feature/* -> dev -> main`, Polling pro Environment |
| CD | Polling (Status Quo), kein Webhook noetig |
| Test-KG-Server | Vorbereitet (`SCHEMA_REPO_BRANCH=dev`), noch nicht aktiv |
| Validation Script | Standalone Copy im Schema-Repo (~50 Zeilen) |

---

## 9. Implementierungs-Reihenfolge

1. **JSON Schemas generieren** — `ts-json-schema-generator` im KG-Builder,
   Output nach `osf-schemas/.schemas/`
2. **Validation Script** — `scripts/validate.ts` im Schema-Repo
3. **CI Workflow** — `.github/workflows/validate.yml`
4. **Dry-Run Script** — `src/builder/dry-run.ts` im KG-Builder
5. **VS Code Settings** — `.vscode/settings.json` im Schema-Repo
6. **Branch `dev` anlegen** — Protection Rules, CI Trigger
7. **(Spaeter)** Test-KG-Server aufsetzen, pollt `dev`
