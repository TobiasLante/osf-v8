# OSF v9 — Die 4 Agenten

## Uebersicht

| Agent | Laeuft | Input | Output | LLM? |
|---|---|---|---|---|
| **Onboarding** | On-demand (Admin klickt) | URL + Credentials | `mcp_servers` DB | Nein |
| **KG Agent** | Permanent (Subscriber) | MQTT `Factory/#` | Cypher MERGE -> Apache AGE | Nein |
| **Historian** | Permanent (Subscriber) | MQTT `Factory/#` | INSERT -> `uns_history` | Nein |
| **Chat Agents** | Per User-Request | User-Frage | MCP Tool Calls -> Antwort | Ja |

---

## 1. Onboarding Agent

Wird vom Admin ueber die UI ausgeloest. Bekommt eine URL + optional Credentials.

### Pipeline

```
Input: URL + Credentials

1. CONNECT
   -> POST {url}/mcp  {"method": "tools/list"}
   -> Erfolgreich? -> status = 'online'
   -> Timeout/Error? -> status = 'error', error_message speichern

2. DISCOVER
   -> tools/list Response parsen
   -> Jedes Tool: Name, Description, InputSchema
   -> In tools JSONB speichern

3. CATEGORIZE
   -> Tool-Namen analysieren:
     factory_get_*     -> category: 'erp'
     kg_*              -> category: 'kg'
     uns_*             -> category: 'uns'
     quality_*, cpk_*  -> category: 'qms'
     energy_*          -> category: 'energy'
     maintenance_*     -> category: 'maintenance'
     history_*         -> category: 'history'
   -> categories Array befuellen

4. VALIDATE
   -> 1 Test-Call pro Kategorie (read-only Tool)
   -> Antwort plausibel? Loggen.

5. REGISTER
   -> INSERT INTO mcp_servers
   -> Gateway laedt neue Server automatisch (DB-Poll alle 60s)
   -> KG Agent + Chat koennen sofort die Tools nutzen
```

### Beispiel-Flow: Neue Fabrik

```
Admin-UI:
  -> "MCP Server hinzufuegen"
  -> URL: http://kunde-erp:8020
  -> [Verbinden & Entdecken]

Onboarding Agent:
  -> Connected ✓
  -> 35 Tools entdeckt ✓
  -> Kategorien: erp(20), oee(5), kg(6), qms(4) ✓
  -> Test-Call erfolgreich ✓
  -> Registriert ✓

Gesamtzeit: 30 Sekunden. Zero Code.
```

---

## 2. KG Agent

Subscribed permanent auf `Factory/#`. Baut den Knowledge Graph automatisch
aus dem MQTT-Stream. Keine Konfiguration — alles was auf MQTT reinkommt
wird ein Vertex im Graph.

### Logik

```
MQTT Message rein -> Topic parsen -> Machine bekannt?
  NEIN -> MERGE Machine + MERGE Sensor + MERGE Edge (HAS_SENSOR)
          knownMachines.add(machineId)
  JA   -> Sensor bekannt?
    NEIN -> MERGE Sensor + MERGE Edge
            knownSensors.add(sensorId)
    JA   -> Buffer Value Update -> Batch-Flush alle 15s
```

### Was er erzeugt

```cypher
-- Neue Maschine entdeckt (erste MQTT Message mit unbekanntem Topic)
MERGE (m:Machine {id: 'CNC-01'})
SET m.source = 'uns-discovery',
    m.discovered_at = '2026-03-15T10:00:00Z',
    m.last_seen = '2026-03-15T10:05:00Z'

-- Neuer Sensor entdeckt
MERGE (s:Sensor {id: 'CNC-01/Act_OEE'})
SET s.name = 'Act_OEE',
    s.machine = 'CNC-01',
    s.mqtt_topic = 'Factory/CNC-01/.../ProcessData/Act_OEE',
    s.data_type = 'Double',
    s.unit = '%',
    s.category = 'ProcessData',
    s.source = 'uns-discovery',
    s.last_value = 87.3,
    s.last_seen = '2026-03-15T10:05:00Z'

-- Beziehung
MERGE (m)-[:HAS_SENSOR]->(s)
```

### Drei Ebenen im Loop

| Was | Wann | Wie oft |
|---|---|---|
| Neue Machine/Sensor entdecken | Erste Message mit unbekanntem Topic | Einmalig pro Entity |
| Live-Werte updaten | Jede MQTT Message | Debounced, Batch-Flush alle 15s |
| Offline-Erkennung | Periodisch (alle 5 min) | Kein Topic seit 5 min -> status = 'offline' |

### Wiederverwendung

`vertexCypher()`, `edgeCypher()`, `batchCypher()` aus bestehendem
`factory-simulator-v3/src/knowledge-graph/sync.ts`.
Gleiche Apache AGE Infrastruktur, gleicher `factory_graph`.

---

## 3. Historian Agent

Subscribed permanent auf `Factory/#`. Schreibt jeden Wert in eine
Zeitreihen-Tabelle. Simpelster Agent: parse -> buffer -> INSERT.

### Logik

```
MQTT Message: Factory/CNC-01/FA240001/WZM-001/BDE/Act_Qty_Good
Payload: {"Value": 142, "Unit": "Stk", "Definition": "Gut-Teile"}

-> parse topic:   machine=CNC-01, wo=FA240001, tool=WZM-001, cat=BDE, var=Act_Qty_Good
-> parse payload: value=142, unit=Stk
-> buffer (sammelt Messages)
-> alle 5s: Batch INSERT INTO uns_history
```

### Performance

50 Maschinen x 10 Variablen x 1 msg/sec = 500 msg/sec
-> ein INSERT mit 2500 Rows alle 5 Sekunden
-> PostgreSQL schafft das locker

### Retention Policy (konfigurierbar)

- Rohdaten: 30 Tage
- Stuendliche Aggregate: 1 Jahr
- Taegliche Aggregate: unbegrenzt

---

## 4. Chat Agents (bestehen schon)

Nutzen die dynamische MCP Tool-Liste. Rufen ERP, UNS, History und KG
Tools auf. Traversieren den Graph per Cypher.

Keine Aenderung noetig — die Agents funktionieren automatisch mit neuen
MCP Servern, weil die Tool-Liste dynamisch aus der DB kommt.

### Beispiel-Fragen die neu moeglich werden

- "Wie war die OEE von CNC-01 letzte Woche?" -> `history_get_trend`
- "Welche Sensoren hat BZ-1?" -> `kg_machine_sensors` (Cypher)
- "Zeig mir alle entdeckten Maschinen" -> `kg_discovered_machines` (Cypher)
- "Vergleiche Temperaturverlauf CNC-01 vs CNC-02" -> `history_compare`
