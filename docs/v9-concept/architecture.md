# OSF v9 — Agentenbasierte Fabrik-Integration

## Vision

Eine Fabrik in 5 Minuten anbinden. Keine Code-Aenderungen, keine Konfigurationsdateien.
Admin gibt URL + Credentials ein → Onboarding Agent entdeckt die verfuegbaren Datenquellen
→ KG Agent baut den Knowledge Graph → Historian speichert die Historie
→ Chat kann sofort Fragen beantworten.

## Grundprinzipien

1. **SM = Cypher.** Keine CESMII SM Profiles, kein XML, kein OPC-UA NodeSet-Matching.
   Die Semantik einer Fabrik steckt in Graph-Vertices und -Edges.
   Ein LLM versteht Cypher. Ein LLM versteht kein XML.

2. **OSF erzeugt keinen UNS — OSF konsumiert ihn.** OPC-UA → MQTT ist OT-Infrastruktur
   (i-flow, Kepware, Neuron). Das ist nicht unser Produkt. OSF beginnt am MQTT Broker.

3. **Alles dynamisch, nichts hardcoded.** MCP Server werden ueber die DB registriert,
   nicht ueber Env-Vars im Code. Neue Datenquelle = DB-Eintrag, kein Deployment.

4. **Vier Agenten, eine Plattform.** Jeder Agent macht genau eine Sache.
   Zusammen decken sie den gesamten Datenfluss ab.

## Architektur

```
+--------------------------------------------------------------+
| Layer 0: OT-Connectivity (NICHT OSF)                         |
|   i-flow / Kepware / Neuron / Node-RED                       |
|   OPC-UA Maschinen -> MQTT Topics                            |
|   Konfiguriert vom OT-Team oder Partner                      |
|                                                              |
|   Simulation: publisher.ts simuliert diesen Layer            |
+--------------------------------------------------------------+
| Layer 1: #shared.UNS (MQTT Broker)                           |
|   Factory/{Machine}/{WO}/{Tool}/{Category}/{Variable}        |
|   ISA-95 Hierarchie. JSON Payload.                           |
|   = Gegenwart. Was passiert JETZT.                           |
+--------------+-----------------------+-----------------------+
|              |                       |                       |
|    +---------v----------+  +---------v----------+            |
|    | Historian Agent     |  | KG Agent           |            |
|    | MQTT -> SQL         |  | MQTT -> Cypher     |            |
|    | = Vergangenheit     |  | = Beziehungen      |            |
|    +---------+----------+  +---------+----------+            |
|              |                       |                       |
|    +---------v----------+  +---------v----------+            |
|    | uns_history (PG)    |  | factory_graph (AGE)|            |
|    | Zeitreihen          |  | Vertices + Edges   |            |
|    +--------------------+  +--------------------+            |
+--------------------------------------------------------------+
| Layer 2: MCP Onboarding Agent                                |
|   URL + Credentials -> tools/list -> Kategorisieren          |
|   -> INSERT INTO mcp_servers -> Gateway laedt dynamisch      |
+--------------------------------------------------------------+
| Layer 3: MCP Server (dynamisch aus DB)                       |
|   ERP MCP:     Stammdaten (DB)                               |
|   UNS MCP:     Live-Daten (MQTT Cache)                       |
|   History MCP: Zeitreihen (uns_history)                      |
|   KG MCP:      Graph-Traversal (Cypher)                      |
+--------------------------------------------------------------+
| Layer 4: Chat + Agents                                       |
|   LLM -> dynamische MCP Tool-Liste -> Antwort               |
+--------------------------------------------------------------+
```

## Datenfluss: Simulation vs. Produktion

```
SIMULATION:                          PRODUKTION:

DB (Virtual PLC)                     Echte SPS/PLC
    |                                    |
    v                                    v
publisher.ts                         i-flow / Kepware
    |                                    |
    v                                    v
MQTT Broker <----- identisch -----> MQTT Broker
    |                                    |
    +-->  KG Agent --> Graph             +-->  KG Agent --> Graph
    +--> Historian --> uns_history       +--> Historian --> uns_history
    +-->  UNS MCP --> Live Cache         +-->  UNS MCP --> Live Cache
```

Ab dem MQTT Broker ist alles identisch. `publisher.ts` simuliert Layer 0.
In Produktion wird er durch i-flow ersetzt. Layer 1-4 aendern sich nicht.

ERP-Daten aus der DB lesen ist korrekt — auch in der echten Fabrik ist SAP
eine Datenbank. Stammdaten (Orders, Articles, BOMs, Kunden, Lieferanten)
kommen immer aus einer DB.
