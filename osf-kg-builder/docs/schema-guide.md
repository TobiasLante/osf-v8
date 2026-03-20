# KG Schema Guide — 3 Schemas to Auto-Build the Knowledge Graph

The Knowledge Graph is built automatically from 3 JSON schemas that live in version control.
No LLM is needed for graph construction — the schemas are the single source of truth.

## Overview

| Schema | File Pattern | Responsibility | Who Creates |
|--------|-------------|----------------|-------------|
| **SM Profile** | `schemas/profiles/*.json` | Type system: node labels, properties, edges | Domain expert (manual) |
| **OPC-UA → SM Mapping** | `schemas/mappings/opcua/*.json` | Instance binding: concrete machines → profile types | OPC-UA Discovery Agent or manual |
| **SM → UNS Mapping** | `schemas/mappings/uns/*.json` | Runtime binding: MQTT topic + payload parsing | Integration engineer (manual) |

## How the KG Builder Uses Them

```
SM Profile        →  CREATE CONSTRAINT, define node labels + properties + edges
OPC-UA Mapping    →  MERGE concrete nodes (one per machine), set initial values
UNS Mapping       →  Subscribe MQTT topics, parse payloads, SET live property updates
```

---

## Schema 1: SM Profile

Defines **what types of equipment exist** and what attributes/relationships they have.
One file per equipment type. Follows CESMII SM Profile conventions.

### Example: Injection Molding Machine

**File:** `schemas/profiles/injection-molding-machine.json`

```json
{
  "profileId": "SMProfile-InjectionMoldingMachine",
  "version": "1.0.0",
  "standard": "CESMII",
  "displayName": "Injection Molding Machine",
  "description": "Spritzgussmaschine with ISA-88 process parameters (VDI 2658 compatible)",
  "parentType": null,

  "attributes": [
    {
      "name": "Machine_Status",
      "dataType": "Int32",
      "category": "BDE",
      "description": "1=Produktion, 2=Stillstand, 3=Rüsten, 4=Wartung, 5=Störung",
      "enum": [1, 2, 3, 4, 5]
    },
    {
      "name": "Parts_Good",
      "dataType": "Int32",
      "category": "BDE",
      "description": "Good parts produced per shot (cavities × quality)"
    },
    {
      "name": "Parts_Scrap",
      "dataType": "Int32",
      "category": "BDE",
      "description": "Scrap parts per shot"
    },
    {
      "name": "Shot_Counter",
      "dataType": "Int32",
      "category": "BDE",
      "description": "Cumulative shot counter"
    },
    {
      "name": "Production_Order",
      "dataType": "String",
      "category": "BDE",
      "description": "Active production order number"
    },
    {
      "name": "Article_ID",
      "dataType": "String",
      "category": "BDE",
      "description": "Article being produced"
    },
    {
      "name": "Mould_ID",
      "dataType": "String",
      "category": "BDE",
      "description": "Active mould identifier"
    },
    {
      "name": "Quality",
      "dataType": "String",
      "category": "BDE",
      "description": "Quality assessment (good/marginal/bad)"
    },

    {
      "name": "Temp_Melting",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature",
      "description": "Melt temperature actual"
    },
    {
      "name": "Temp_Melting_Set",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature",
      "description": "Melt temperature setpoint"
    },
    {
      "name": "Temp_Zone_1",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature"
    },
    {
      "name": "Temp_Zone_1_Set",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature"
    },
    {
      "name": "Temp_Nozzle",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature"
    },
    {
      "name": "Temp_Mould_Fixed",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature"
    },
    {
      "name": "Temp_Mould_Moving",
      "dataType": "Float",
      "unit": "°C",
      "category": "ProcessData.Temperature"
    },

    {
      "name": "Pressure_Holding",
      "dataType": "Float",
      "unit": "bar",
      "category": "ProcessData.Pressure"
    },
    {
      "name": "Pressure_Injection_Max",
      "dataType": "Float",
      "unit": "bar",
      "category": "ProcessData.Pressure"
    },
    {
      "name": "Force_Closing",
      "dataType": "Float",
      "unit": "kN",
      "category": "ProcessData.Pressure"
    },

    {
      "name": "Speed_Injection",
      "dataType": "Float",
      "unit": "mm/s",
      "category": "ProcessData.Speed"
    },
    {
      "name": "Speed_Screw_RPM",
      "dataType": "Float",
      "unit": "rpm",
      "category": "ProcessData.Speed"
    },

    {
      "name": "Time_Cycle_Actual",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },
    {
      "name": "Time_Cycle_Planned",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },
    {
      "name": "Time_Dosing",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },
    {
      "name": "Time_Filling",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },
    {
      "name": "Time_Holding",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },
    {
      "name": "Time_Cooling",
      "dataType": "Float",
      "unit": "s",
      "category": "ProcessData.Time"
    },

    {
      "name": "Volume_Shot",
      "dataType": "Float",
      "unit": "cm³",
      "category": "ProcessData.Volume"
    },
    {
      "name": "Volume_Cushion",
      "dataType": "Float",
      "unit": "cm³",
      "category": "ProcessData.Volume"
    },

    {
      "name": "Energy_Total_kWh",
      "dataType": "Float",
      "unit": "kWh",
      "category": "ProcessData.Energy"
    },
    {
      "name": "Power_Current",
      "dataType": "Float",
      "unit": "kW",
      "category": "ProcessData.Energy"
    }
  ],

  "relationships": [
    {
      "type": "PART_OF",
      "target": "ProductionLine",
      "description": "ISA-95: machine belongs to a production line/area"
    },
    {
      "type": "PRODUCES",
      "target": "Article",
      "description": "Currently or historically produced article"
    },
    {
      "type": "EXECUTES",
      "target": "ProductionOrder",
      "description": "Active production order running on this machine"
    },
    {
      "type": "USES_MOULD",
      "target": "Mould",
      "description": "Mould currently installed"
    }
  ],

  "kgNodeLabel": "InjectionMoldingMachine",
  "kgIdProperty": "machine_id"
}
```

### What the KG Builder does with this

```cypher
-- Create constraint
CREATE CONSTRAINT IF NOT EXISTS FOR (n:InjectionMoldingMachine) REQUIRE n.machine_id IS UNIQUE;

-- When a machine instance is created, all attributes become properties
-- Relationships define which edge types are valid for this node label
```

---

## Schema 2: OPC-UA → SM Mapping

Defines **which concrete machine** maps to which SM Profile, and maps each OPC-UA node to an SM attribute.
One file per OPC-UA server (= one per machine in our setup).

### Example: SGM-002 on OPC-UA port 4851

**File:** `schemas/mappings/opcua/sgm-002.json`

```json
{
  "mappingId": "opcua-sgm-002",
  "version": "1.0.0",
  "discoveredAt": "2026-03-18T22:00:00Z",

  "endpoint": "opc.tcp://192.168.178.150:4851",
  "machineId": "SGM-002",
  "machineName": "Spritzgussmaschine 2",
  "profileRef": "SMProfile-InjectionMoldingMachine",

  "location": {
    "enterprise": "ZeroGuess",
    "site": "Homelab",
    "area": "Spritzguss",
    "line": "SGM-1300"
  },

  "nodeMappings": [
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.BDE.Good_Parts",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "BDE", "Good_Parts"],
      "smAttribute": "Parts_Good",
      "dataType": "Int32"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.BDE.Scrap_Parts",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "BDE", "Scrap_Parts"],
      "smAttribute": "Parts_Scrap",
      "dataType": "Int32"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.BDE.Production_Order",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "BDE", "Production_Order"],
      "smAttribute": "Production_Order",
      "dataType": "String"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.BDE.Mould_ID",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "BDE", "Mould_ID"],
      "smAttribute": "Mould_ID",
      "dataType": "String"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Temperature.Melting_Actual",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Temperature", "Melting_Actual"],
      "smAttribute": "Temp_Melting",
      "dataType": "Float"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Temperature.Melting_Set",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Temperature", "Melting_Set"],
      "smAttribute": "Temp_Melting_Set",
      "dataType": "Float"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Pressure.Holding_Actual",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Pressure", "Holding_Actual"],
      "smAttribute": "Pressure_Holding",
      "dataType": "Float"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Speed.Injection_Actual",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Speed", "Injection_Actual"],
      "smAttribute": "Speed_Injection",
      "dataType": "Float"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Time.Cycle_Actual",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Time", "Cycle_Actual"],
      "smAttribute": "Time_Cycle_Actual",
      "dataType": "Float"
    },
    {
      "opcuaNodeId": "ns=1;s=Factory.Spritzgussmaschine 2.ProcessData.Energy.Power_Current",
      "browsePath": ["Factory", "Spritzgussmaschine 2", "ProcessData", "Energy", "Power_Current"],
      "smAttribute": "Power_Current",
      "dataType": "Float"
    }
  ],

  "staticProperties": {
    "closingForceKn": 1300,
    "cavities": 8,
    "manufacturer": "Simulated",
    "group": "SGM-1300"
  }
}
```

### What the KG Builder does with this

```cypher
-- Create machine node with static + initial OPC-UA values
MERGE (m:InjectionMoldingMachine {machine_id: 'SGM-002'})
SET m.name = 'Spritzgussmaschine 2',
    m.opcua_endpoint = 'opc.tcp://192.168.178.150:4851',
    m.closing_force_kn = 1300,
    m.cavities = 8,
    m.group = 'SGM-1300'

-- Create location hierarchy + edges
MERGE (site:Site {name: 'Homelab'})
MERGE (area:Area {name: 'Spritzguss'})
MERGE (line:ProductionLine {name: 'SGM-1300'})
MERGE (area)-[:PART_OF]->(site)
MERGE (line)-[:PART_OF]->(area)
MERGE (m)-[:PART_OF]->(line)
```

---

## Schema 3: SM → UNS Mapping

Defines **how MQTT topics and payloads map** to SM attributes.
One file per data source / publisher format. Shared by all machines using that source.

### Example: Factory Simulator v3 UNS Format

**File:** `schemas/mappings/uns/factory-sim-v3.json`

```json
{
  "mappingId": "uns-factory-sim-v3",
  "version": "1.0.0",
  "description": "Factory Simulator v3 MQTT UNS topic and payload format",

  "broker": {
    "host": "192.168.178.150",
    "port": 31883
  },

  "topicStructure": {
    "pattern": "Factory/{machineId}/{workOrder}/{tool}/{category}/{attribute}",
    "segments": {
      "machineId": { "index": 1, "description": "Machine display name (e.g. 'SGM-002')" },
      "workOrder": { "index": 2, "description": "Production order or '---'" },
      "tool":      { "index": 3, "description": "Tool ID or '---'" },
      "category":  { "index": 4, "description": "BDE or ProcessData" },
      "attribute": { "index": 5, "description": "SM attribute name as published" }
    },
    "subscribeFilter": "Factory/#"
  },

  "payloadSchema": {
    "format": "JSON",
    "valuePath": "$.Value",
    "timestampPath": "$.timestamp",
    "timestampFormat": "ISO8601",
    "unitPath": "$.Unit",
    "qualityPath": "$.ValueQualityQualifier",
    "datatypePath": "$.Datatype"
  },

  "attributeMapping": {
    "strategy": "topic_segment",
    "categorySegment": 4,
    "attributeSegment": 5,
    "mappings": [
      { "topicAttribute": "Act_Temp_Melting",         "smAttribute": "Temp_Melting" },
      { "topicAttribute": "Set_Temp_Melting",          "smAttribute": "Temp_Melting_Set" },
      { "topicAttribute": "Act_Temp_Zone1",            "smAttribute": "Temp_Zone_1" },
      { "topicAttribute": "Set_Temp_Zone1",            "smAttribute": "Temp_Zone_1_Set" },
      { "topicAttribute": "Act_Temp_Nozzle",           "smAttribute": "Temp_Nozzle" },
      { "topicAttribute": "Act_Temp_Mould_Fixed",      "smAttribute": "Temp_Mould_Fixed" },
      { "topicAttribute": "Act_Temp_Mould_Moving",     "smAttribute": "Temp_Mould_Moving" },
      { "topicAttribute": "Act_Pressure_Holding",      "smAttribute": "Pressure_Holding" },
      { "topicAttribute": "Act_Pressure_Injection_Max", "smAttribute": "Pressure_Injection_Max" },
      { "topicAttribute": "Act_Force_Clamping",        "smAttribute": "Force_Closing" },
      { "topicAttribute": "Act_Speed_Injection",       "smAttribute": "Speed_Injection" },
      { "topicAttribute": "Act_Speed_Screw",           "smAttribute": "Speed_Screw_RPM" },
      { "topicAttribute": "Act_CycleTime",             "smAttribute": "Time_Cycle_Actual" },
      { "topicAttribute": "Plan_CycleTime",            "smAttribute": "Time_Cycle_Planned" },
      { "topicAttribute": "Act_Time_Dosing",           "smAttribute": "Time_Dosing" },
      { "topicAttribute": "Act_Time_Filling",          "smAttribute": "Time_Filling" },
      { "topicAttribute": "Act_Time_Holding",          "smAttribute": "Time_Holding" },
      { "topicAttribute": "Act_Time_Cooling",          "smAttribute": "Time_Cooling" },
      { "topicAttribute": "Act_Volume_Shot",           "smAttribute": "Volume_Shot" },
      { "topicAttribute": "Act_Volume_Cushion",        "smAttribute": "Volume_Cushion" },
      { "topicAttribute": "Act_Energy_Total",          "smAttribute": "Energy_Total_kWh" },
      { "topicAttribute": "Act_Power_Current",         "smAttribute": "Power_Current" },
      { "topicAttribute": "Act_Qty_Good",              "smAttribute": "Parts_Good" },
      { "topicAttribute": "Act_Qty_Scrap",             "smAttribute": "Parts_Scrap" },
      { "topicAttribute": "Machine_Status",            "smAttribute": "Machine_Status" },
      { "topicAttribute": "Shot_Counter",              "smAttribute": "Shot_Counter" }
    ]
  },

  "machineIdResolution": {
    "strategy": "topic_segment",
    "segment": 1,
    "description": "The first topic segment after 'Factory/' is the machine display name, which matches OPC-UA mapping machineId"
  }
}
```

### What the KG Builder does with this

```
1. Subscribe to "Factory/#"
2. On message:
   a. Parse topic → extract machineId (segment 1), attribute (segment 5)
   b. Look up attributeMapping → get smAttribute name
   c. Parse payload → extract value at $.Value, timestamp at $.timestamp
   d. Find KG node by machineId (from Schema 2)
   e. SET node.{smAttribute} = value, node.{smAttribute}_ts = timestamp
```

---

## Directory Structure in Git

```
osf-kg-builder/
└── schemas/
    ├── profiles/
    │   ├── injection-molding-machine.json    ← Schema 1
    │   ├── cnc-machine.json
    │   ├── assembly-line.json
    │   └── ffs-cell.json
    ├── mappings/
    │   ├── opcua/
    │   │   ├── sgm-002.json                  ← Schema 2 (one per machine)
    │   │   ├── sgm-003.json
    │   │   ├── cnc-01.json
    │   │   └── ...
    │   └── uns/
    │       ├── factory-sim-v3.json           ← Schema 3 (one per source)
    │       └── ffs-simulation.json
    └── README.md                             ← this file
```

## KG Build Pipeline

```
Step 1: Load all profiles from schemas/profiles/
        → Register node labels, constraints, valid properties

Step 2: Load all OPC-UA mappings from schemas/mappings/opcua/
        → MERGE one node per machine, set static properties
        → Create ISA-95 hierarchy edges (PART_OF)
        → Optionally: browse OPC-UA endpoint for initial values

Step 3: Load all UNS mappings from schemas/mappings/uns/
        → Subscribe MQTT broker
        → On each message: parse topic + payload → SET property on KG node

Result: A live Knowledge Graph that stays in sync with the shop floor.
```
