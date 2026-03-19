import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function OpcUaMtpContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          OpenShopFloor bridges the gap between industrial automation protocols
          and AI-driven analytics. The platform integrates with{" "}
          <strong>OPC-UA</strong> (the standard for machine-to-machine
          communication) and <strong>MTP</strong> (VDI 2658 &mdash; Module Type
          Package for modular process plants) to automatically discover equipment,
          extract data models, and build a live Knowledge Graph.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
            <div className="text-blue-400 font-semibold text-sm mb-1">MTP Parser</div>
            <div className="text-xs text-text-muted">
              Parses AutomationML/CAEX files (VDI 2658) to extract equipment
              modules, services, variables, and OPC-UA endpoints
            </div>
          </div>
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
            <div className="text-green-400 font-semibold text-sm mb-1">SM Profile Parser</div>
            <div className="text-xs text-text-muted">
              Parses CESMII Smart Manufacturing Profiles (OPC-UA NodeSet XML) to
              extract type hierarchies, attributes, and relationships
            </div>
          </div>
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3">
            <div className="text-purple-400 font-semibold text-sm mb-1">KG Builder Integration</div>
            <div className="text-xs text-text-muted">
              Parsed models are merged into the schema-driven Knowledge Graph
              with ISA-95 hierarchy (Site → Area → Line → Machine)
            </div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Architecture">
        <div className="mt-2 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// OPC-UA / MTP Integration Pipeline"}</div>
          <div className="flex flex-col gap-0">
            <div>
              <span className="text-blue-400">AutomationML (.aml)</span>{" "}
              <span className="text-text-dim">&mdash; MTP module descriptions (VDI 2658)</span>
            </div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ▼"}</div>
            <div>
              <span className="text-yellow-400">MTP Parser</span>{" "}
              <span className="text-text-dim">&mdash; extractModule(), extractService(), extractVariable()</span>
            </div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ├── MTPModule { name, services[], variables[], opcuaEndpoint }"}</div>
            <div className="text-text-dim">{"    ├── MTPService { name, procedures[], states[] }"}</div>
            <div className="text-text-dim">{"    └── MTPVariable { name, dataType, unit, opcuaNodeId }"}</div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ▼"}</div>
            <div>
              <span className="text-green-400">SM Profile Parser</span>{" "}
              <span className="text-text-dim">&mdash; OPC-UA NodeSet XML (CESMII profiles)</span>
            </div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ├── SMProfileType { browseName, parentType, attributes[] }"}</div>
            <div className="text-text-dim">{"    └── Relationships { from, to, referenceType }"}</div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ▼"}</div>
            <div>
              <span className="text-purple-400">Schema Planner</span>{" "}
              <span className="text-text-dim">&mdash; mergeExternalSources()</span>
            </div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ├── Merge MTP node types + edge types into schema proposal"}</div>
            <div className="text-text-dim">{"    └── Merge SM Profile type hierarchy as schema hints"}</div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ▼"}</div>
            <div>
              <span className="text-red-400">Knowledge Graph</span>{" "}
              <span className="text-text-dim">&mdash; Neo4j with ISA-95 hierarchy</span>
            </div>
            <div className="text-text-dim">{"    │"}</div>
            <div className="text-text-dim">{"    ├── Site → Area → Line → Machine (ISA-95)"}</div>
            <div className="text-text-dim">{"    ├── Machine → Sensor (OPC-UA tags / MQTT variables)"}</div>
            <div className="text-text-dim">{"    └── Equipment → Service → Variable (MTP / ISA-88)"}</div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="MTP Parser (VDI 2658)">
        <p>
          The Module Type Package (MTP) standard defines how modular process
          equipment describes itself. An MTP file is an AutomationML/CAEX XML
          document that contains:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Process Equipment Assemblies (PEAs)</strong> &mdash; Physical modules
            like reactors, dosing stations, or separation units. Each PEA exposes
            services and variables.
          </li>
          <li>
            <strong>Services</strong> &mdash; Executable operations with defined
            state machines and procedures. For example, a dosing PEA offers a
            &quot;Dosing&quot; service with procedures &quot;Start&quot;,
            &quot;Abort&quot;, &quot;Complete&quot;.
          </li>
          <li>
            <strong>Process Variables</strong> &mdash; Real-time sensor data like
            temperature, pressure, flow rate. Each variable has a data type, unit,
            and an optional <code className="text-accent">opcuaNodeId</code> for
            direct OPC-UA access.
          </li>
          <li>
            <strong>OPC-UA Endpoint</strong> &mdash; The PEA&apos;s OPC-UA server
            address, enabling direct communication for reading tags and invoking
            services.
          </li>
        </ul>
        <WikiCallout type="info">
          The parser supports both <code>InstanceHierarchy</code> and{" "}
          <code>SystemUnitClassLib</code> elements, handling nested equipment
          structures recursively. Role classes like{" "}
          <code>ProcessEquipmentAssembly</code> are used to identify PEAs.
        </WikiCallout>

        <h4 className="font-semibold text-text mt-4 mb-2">Parsed Data Model</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border">
            <thead>
              <tr className="bg-bg-surface text-text-muted">
                <th className="px-3 py-2 text-left border-b border-border">Type</th>
                <th className="px-3 py-2 text-left border-b border-border">Fields</th>
                <th className="px-3 py-2 text-left border-b border-border">Source in AutomationML</th>
              </tr>
            </thead>
            <tbody className="text-text">
              <tr className="border-b border-border/50">
                <td className="px-3 py-2 font-mono text-blue-400">MTPModule</td>
                <td className="px-3 py-2">name, description, services[], variables[], opcuaEndpoint</td>
                <td className="px-3 py-2 text-text-muted">InternalElement with PEA role class</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2 font-mono text-green-400">MTPService</td>
                <td className="px-3 py-2">name, procedures[], states[]</td>
                <td className="px-3 py-2 text-text-muted">Child elements with Service role</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-yellow-400">MTPVariable</td>
                <td className="px-3 py-2">name, dataType, unit, opcuaNodeId</td>
                <td className="px-3 py-2 text-text-muted">Attributes with dataType + unit</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="font-semibold text-text mt-4 mb-2">Industry Standards</h4>
        <ul className="list-disc list-inside space-y-1 text-sm text-text-muted">
          <li><strong>VDI 2658</strong> &mdash; Module Type Package specification</li>
          <li><strong>IEC 62714</strong> &mdash; AutomationML / CAEX data exchange format</li>
          <li><strong>ISA-88</strong> &mdash; Batch control: Procedure → Unit Procedure → Operation</li>
          <li><strong>ISA-95</strong> &mdash; Equipment hierarchy: Site → Area → ProcessCell → Unit</li>
        </ul>
      </WikiSection>

      <WikiSection title="CESMII SM Profiles">
        <p>
          CESMII Smart Manufacturing Profiles use the OPC-UA NodeSet XML format to
          define standardized type hierarchies for manufacturing equipment. The SM
          Profile Parser extracts:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Type Hierarchies</strong> &mdash; <code>UAObjectType</code>{" "}
            elements with <code>HasSubtype</code> references form an inheritance
            tree (e.g., <code>CNCMachine</code> extends <code>Machine</code>)
          </li>
          <li>
            <strong>Attributes</strong> &mdash; <code>UAVariable</code> elements
            with data types and descriptions, linked to parent types via{" "}
            <code>HasProperty</code> / <code>HasComponent</code> references
          </li>
          <li>
            <strong>Relationships</strong> &mdash; Reference types between objects
            define how equipment types relate to each other
          </li>
        </ul>
        <WikiCallout type="tip">
          SM Profiles are used as <strong>schema hints</strong> for the KG Builder.
          When building a Knowledge Graph, the planner merges SM Profile type
          hierarchies with MTP equipment models and database-discovered entities
          to create a comprehensive graph schema.
        </WikiCallout>

        <h4 className="font-semibold text-text mt-4 mb-2">How SM Profiles Flow into the KG</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm text-text-muted">
          <li>Load SM Profile XML from file or URL</li>
          <li>Parse into <code>SMProfileSchema</code> (types + relationships)</li>
          <li>Convert to schema hints via <code>smProfileToSchemaHint()</code></li>
          <li>Feed into Schema Planner as LLM context for graph design</li>
          <li>Build type system in Neo4j: unique constraints per profile type</li>
        </ol>
      </WikiSection>

      <WikiSection title="OPC-UA Mappings in the KG Builder">
        <p>
          The KG Builder&apos;s 3-schema system supports <code>opcua</code> as a
          source type alongside <code>postgresql</code>. OPC-UA mappings define:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Endpoint</strong> &mdash; The OPC-UA server URL (e.g.,{" "}
            <code>opc.tcp://192.168.1.100:4840</code>)
          </li>
          <li>
            <strong>Node Mappings</strong> &mdash; Which OPC-UA browse names map
            to which KG node types and properties
          </li>
          <li>
            <strong>ISA-95 Hierarchy</strong> &mdash; Automatic generation of{" "}
            <code>Site → Area → Line → Machine</code> relationships from
            equipment topology
          </li>
        </ul>

        <h4 className="font-semibold text-text mt-4 mb-2">Instance Building</h4>
        <p className="text-sm text-text-muted">
          The <code>buildInstanceNodes()</code> phase creates concrete equipment
          nodes from OPC-UA source definitions. Each machine gets:
        </p>
        <div className="mt-2 rounded-md border border-border bg-[#0d1117] p-3 font-mono text-xs text-gray-300">
          <div>{"MERGE (m:Machine {id: 'CNC-001'})"}</div>
          <div>{"SET m.name = 'CNC-001',"}</div>
          <div>{"    m.opcua_endpoint = 'opc.tcp://10.0.1.20:4840',"}</div>
          <div>{"    m.area = 'Fertigung',"}</div>
          <div>{"    m.line = 'CNC-Linie-1'"}</div>
          <div className="mt-2">{"// ISA-95 hierarchy edges"}</div>
          <div>{"MERGE (site:Site {id: 'Werk-Süd'})"}</div>
          <div>{"MERGE (area:Area {id: 'Fertigung'})"}</div>
          <div>{"MERGE (site)-[:CONTAINS]->(area)"}</div>
          <div>{"MERGE (area)-[:CONTAINS]->(m)"}</div>
        </div>
      </WikiSection>

      <WikiSection title="From MTP to Knowledge Graph">
        <p>
          When an MTP file is loaded, the platform creates a complete digital twin
          in the Knowledge Graph:
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs border border-border">
            <thead>
              <tr className="bg-bg-surface text-text-muted">
                <th className="px-3 py-2 text-left border-b border-border">MTP Element</th>
                <th className="px-3 py-2 text-left border-b border-border">KG Node Type</th>
                <th className="px-3 py-2 text-left border-b border-border">KG Relationships</th>
              </tr>
            </thead>
            <tbody className="text-text">
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">PEA (ProcessEquipmentAssembly)</td>
                <td className="px-3 py-2 font-mono text-blue-400">Equipment</td>
                <td className="px-3 py-2 text-text-muted">CONTAINS → Service, HAS_VARIABLE → Variable</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Service + Procedures</td>
                <td className="px-3 py-2 font-mono text-green-400">Service</td>
                <td className="px-3 py-2 text-text-muted">HAS_PROCEDURE → Procedure, HAS_STATE → State</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Process Variable</td>
                <td className="px-3 py-2 font-mono text-yellow-400">Variable</td>
                <td className="px-3 py-2 text-text-muted">MONITORED_BY → Sensor (if opcuaNodeId present)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">OPC-UA Endpoint</td>
                <td className="px-3 py-2 text-text-muted">Property on Equipment</td>
                <td className="px-3 py-2 text-text-muted">opcua_endpoint field for direct tag access</td>
              </tr>
            </tbody>
          </table>
        </div>
      </WikiSection>

      <WikiSection title="Domain Templates">
        <p>
          The platform ships with pre-built domain templates that define
          industry-specific node types, relationships, and compliance
          requirements. Each template integrates differently with OPC-UA and MTP:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Discrete Manufacturing</div>
            <div className="text-xs text-text-muted mt-1">Profile: CESMII SM Profiles</div>
            <div className="text-xs text-text-muted">Standard: ISA-95</div>
            <div className="text-xs text-text-muted">Nodes: Machine, Article, Order, Material, Supplier, Tool, Customer</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Pharmaceutical</div>
            <div className="text-xs text-text-muted mt-1">Profile: MTP (VDI 2658)</div>
            <div className="text-xs text-text-muted">Standard: GMP, 21 CFR Part 11</div>
            <div className="text-xs text-text-muted">Nodes: Reactor, Batch, Recipe, CleanRoom, Substance, QualityTest</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Chemical Process</div>
            <div className="text-xs text-text-muted mt-1">Profile: MTP (VDI 2658)</div>
            <div className="text-xs text-text-muted">Standard: ISA-88 / ISA-95</div>
            <div className="text-xs text-text-muted">Nodes: ProcessUnit, Stream, Recipe, PID_Loop, Alarm, SIS_Function</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Medical Devices</div>
            <div className="text-xs text-text-muted mt-1">Profile: MTP (VDI 2658)</div>
            <div className="text-xs text-text-muted">Standard: MDR, UDI traceability</div>
            <div className="text-xs text-text-muted">Nodes: DeviceAssembly, CleanRoom, SterilizationBatch, UDI_Record</div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="MQTT UNS Bridge">
        <p>
          OPC-UA tags don&apos;t have to be read directly &mdash; the recommended
          architecture routes OPC-UA data through MQTT using the Unified Namespace
          (UNS) pattern:
        </p>
        <div className="mt-2 rounded-md border border-border bg-[#0d1117] p-3 font-mono text-xs text-gray-300">
          <div className="text-text-dim">{"// OPC-UA → MQTT → KG pipeline"}</div>
          <div className="mt-1">
            <span className="text-blue-400">OPC-UA Server</span>
            <span className="text-text-dim"> (PLC/SCADA)</span>
          </div>
          <div className="text-text-dim">{"    │  OPC-UA Subscription"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-yellow-400">Edge Gateway</span>
            <span className="text-text-dim"> (Kepware / Edge Agent / custom)</span>
          </div>
          <div className="text-text-dim">{"    │  MQTT Publish"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-green-400">MQTT Broker</span>
            <span className="text-text-dim"> → Factory/CNC-001/FA-2024-0142/OP-10/OEE/availability</span>
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├──▶ "}<span className="text-purple-400">Historian</span>{" → TimescaleDB (time-series)"}</div>
          <div className="text-text-dim">{"    ├──▶ "}<span className="text-red-400">KG Agent</span>{" → Neo4j (auto-discovery)"}</div>
          <div className="text-text-dim">{"    └──▶ "}<span className="text-cyan-400">UNS Stream</span>{" → SSE (real-time UI)"}</div>
        </div>
        <WikiCallout type="tip">
          The{" "}
          <Link href="/docs/wiki/knowledge-graph" className="text-accent hover:underline">
            KG Agent
          </Link>{" "}
          auto-discovers machines and sensors from MQTT topic patterns and
          registers them in the Knowledge Graph. No manual configuration needed
          &mdash; plug in a new machine and it appears in the graph within seconds.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="Roadmap">
        <p>Upcoming OPC-UA features planned for future releases:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>OPC-UA Browse Agent</strong> &mdash; Auto-discover OPC-UA
            servers on the network, browse their address space, and map tags to
            MQTT UNS topics automatically
          </li>
          <li>
            <strong>Live Tag Subscription</strong> &mdash; Direct OPC-UA
            subscriptions for high-frequency data without MQTT intermediary
          </li>
          <li>
            <strong>MTP Orchestration</strong> &mdash; Use the KG to orchestrate
            MTP services across equipment modules &mdash; e.g., start a batch
            recipe by invoking service procedures via OPC-UA method calls
          </li>
          <li>
            <strong>PackML Integration</strong> &mdash; Map PackML state machines
            to KG state nodes for real-time equipment status tracking
          </li>
          <li>
            <strong>OPC-UA Alarms &amp; Conditions</strong> &mdash; Subscribe to
            OPC-UA A&amp;C events and create alarm nodes in the KG for
            AI-powered root cause analysis
          </li>
        </ul>
      </WikiSection>
    </>
  );
}
