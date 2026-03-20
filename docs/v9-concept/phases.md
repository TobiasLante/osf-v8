# OSF v9 — Phasen

## Phase 1: Dynamische MCP Server (Gateway-Refactoring)

- `mcp_servers` DB-Tabelle + Migration in `pool.ts`
- `tool-executor.ts`: dynamisches Laden statt hardcoded `MCP_SERVERS`
- Admin API: CRUD Endpoints fuer `/admin/mcp-servers`
- Admin UI: MCP Server Verwaltung (Liste, Status, Hinzufuegen)
- Onboarding Agent: Connect -> Discover -> Categorize -> Register
- Health-Check Loop: periodisch Status aller registrierten Server pruefen

## Phase 2: KG Agent + Historian

- KG Agent: MQTT Subscriber -> Auto-Discovery -> Cypher MERGE
- Historian Agent: MQTT Subscriber -> Batch INSERT -> `uns_history`
- History MCP Server mit Tools:
  - `history_get_trend`
  - `history_compare`
  - `history_aggregate`
  - `history_anomalies`
- Retention Policy konfigurierbar (Admin UI)

## Phase 3: Integration + Polish

- KG Tools erweitern: `kg_machine_sensors`, `kg_discovered_machines`
- `kg_impact_analysis` um Sensor-Edges erweitern
- Chat Agents: History-Fragen beantworten ("OEE letzte Woche?")
- Health-Monitoring Dashboard fuer alle Agenten (Onboarding, KG, Historian)
- Multi-Fabrik: mehrere MQTT Broker, mehrere ERP Server

## Nicht im Scope

| Feature | Warum nicht |
|---|---|
| OPC-UA -> MQTT Bridge | OT-Infrastruktur. i-flow's Job. |
| CESMII SM Profile Matching | SM = Cypher. Semantik durch Graph-Edges, nicht XML-Labels. |
| SparkplugB | Overkill. JSON Payload reicht. LLM versteht kein Protobuf. |
| Eigene UNS-Spezifikation | ISA-95 + bestehendes Topic-Schema reicht. |

## Referenzen

- ISA-95 Part 2 — Hierarchie: Enterprise/Site/Area/Line/Cell
- CESMII i3X (https://github.com/cesmii/i3X) — Common API Spec (Referenz)
- mkashwin/unifiednamespace (https://github.com/mkashwin/unifiednamespace) — Open Source UNS
- Bestehender Code: `factory-simulator-v3/src/knowledge-graph/` — KG Sync, Cypher, MQTT Subscriber
