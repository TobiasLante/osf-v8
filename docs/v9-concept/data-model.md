# OSF v9 — Datenmodell

## Neue DB-Tabellen

### mcp_servers (Onboarding Agent)

```sql
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_type TEXT DEFAULT 'none',     -- none | basic | bearer | api_key
  credentials_encrypted TEXT,
  status TEXT DEFAULT 'pending',     -- pending | online | offline | error
  tools JSONB DEFAULT '[]',
  tool_count INT DEFAULT 0,
  categories TEXT[] DEFAULT '{}',    -- ['erp', 'oee', 'kg']
  health_check_at TIMESTAMPTZ,
  error_message TEXT,
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mcp_servers_status ON mcp_servers(status);
```

### uns_history (Historian Agent)

```sql
CREATE TABLE uns_history (
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine     TEXT NOT NULL,
  category    TEXT NOT NULL,          -- BDE, ProcessData, QMS
  variable    TEXT NOT NULL,          -- Act_Qty_Good, Act_OEE
  value       DOUBLE PRECISION,
  value_text  TEXT,                   -- fuer nicht-numerische Werte
  unit        TEXT,
  work_order  TEXT,
  tool_id     TEXT,
  topic       TEXT NOT NULL
);

-- TimescaleDB (wenn verfuegbar):
SELECT create_hypertable('uns_history', 'ts');

-- Indices
CREATE INDEX idx_uns_hist_machine_ts ON uns_history(machine, ts DESC);
CREATE INDEX idx_uns_hist_variable_ts ON uns_history(variable, ts DESC);
CREATE INDEX idx_uns_hist_topic_ts ON uns_history(topic, ts DESC);
```

## Neue KG Elemente (durch KG Agent)

### Neuer Vertex-Label: Sensor

```cypher
(:Sensor {
  id: 'CNC-01/Act_OEE',
  name: 'Act_OEE',
  machine: 'CNC-01',
  mqtt_topic: 'Factory/CNC-01/.../ProcessData/Act_OEE',
  data_type: 'Double',
  unit: '%',
  category: 'ProcessData',
  source: 'uns-discovery',
  discovered_at: '2026-03-15T10:00:00Z',
  last_value: 87.3,
  last_seen: '2026-03-15T10:05:00Z'
})
```

### Neue Edges

```cypher
-- Machine hat Sensor (entdeckt aus MQTT-Stream)
(m:Machine)-[:HAS_SENSOR]->(s:Sensor)

-- Sensor liefert KPI-Wert (optional, per Regel oder LLM)
(s:Sensor)-[:FEEDS_KPI]->(k:KPIDef)
```

### Bestehende KG Labels (unveraendert)

Machine, Article, Order, Material, Supplier, Customer, Tool, Pool,
MachineType, Area, Site, KPIDef, MaintenanceOrder, QualityNotification,
PurchaseOrder, MaterialLot, Subcontractor, SubcontractOrder, Messmittel,
DowntimeRecord, MaintenanceNotification

### Integration mit bestehenden KG Tools

Bestehende Tools funktionieren automatisch:
- `kg_dependency_graph`: `MATCH (m)-[r*1..2]-(n)` findet jetzt auch Sensoren
- `kg_bottleneck_analysis`: Machines mit vielen Sensoren ranken hoeher

Einzige Erweiterung in `kg-handlers.ts` — in `handleImpactAnalysis` fuer Machine:
```cypher
UNION
MATCH (m:Machine {id: $id})-[:HAS_SENSOR]->(s:Sensor)
RETURN s AS affected, 'Sensor auf Maschine' AS relationship
```

## MCP Server Landschaft

| MCP Server | Liest von | Beispiel-Tools | Status |
|---|---|---|---|
| **ERP** | DB | `factory_get_orders`, `factory_get_stock` | Existiert |
| **UNS** | MQTT Cache | `uns_subscribe`, `uns_snapshot` | Existiert |
| **KG** | Apache AGE | `kg_impact_analysis`, `kg_trace_order` | Existiert, erweitern |
| **History** | `uns_history` | `history_get_trend`, `history_compare`, `history_anomalies` | **Neu** |

### Neue History MCP Tools

| Tool | Beschreibung |
|---|---|
| `history_get_trend` | Zeitreihe fuer eine Variable: Machine + Variable + Zeitraum |
| `history_compare` | Zwei Maschinen/Variablen im gleichen Zeitraum vergleichen |
| `history_aggregate` | AVG/MIN/MAX pro Stunde/Tag/Woche |
| `history_anomalies` | Werte ausserhalb 2 Standardabweichungen |

### Neue KG MCP Tools

| Tool | Beschreibung |
|---|---|
| `kg_discovered_machines` | Alle per UNS entdeckten Maschinen |
| `kg_machine_sensors` | Sensoren einer Maschine mit Live-Werten |

## UNS Topic Schema

Kein neuer Standard. ISA-95 Hierarchie, bestehendes Pattern:

```
Factory/{Machine}/{WorkOrder}/{Tool}/{Category}/{Variable}
```

Payload Format (JSON):
```json
{"Value": 42.3, "Unit": "°C", "Definition": "Spindle Temperature"}
```

Alle Datenquellen nutzen das gleiche Schema:

| Quelle | Beispiel-Topic |
|---|---|
| Factory-Sim (ERP) | `Factory/CNC-01/FA240001/WZM-CNC01-001/BDE/Act_Qty_Good` |
| FFS-Sim (CNC Cells) | `Factory/BZ-1/O1001/---/BDE/Act_Qty_Good` |
| Echte Maschine (via i-flow) | `Factory/CNC-07/.../ProcessData/Temperature` |
