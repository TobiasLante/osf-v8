import Link from "next/link";
import { WikiSection } from "@/components/wiki/WikiSection";
import { WikiCallout } from "@/components/wiki/WikiCallout";

export function OpcUaMtpContent() {
  return (
    <>
      <WikiSection title="Overview">
        <p>
          Maschinen in der Fertigung stellen ihre Daten per{" "}
          <strong>OPC-UA Server</strong> bereit &mdash; jede CNC, jeder Roboter,
          jede SPS hat einen eingebauten OPC-UA Server, der Prozesswerte,
          Zustande und Alarme exponiert. OpenShopFloor verbindet sich mit diesen
          OPC-UA Servern und bringt die Daten in die Plattform: in den{" "}
          <strong>Knowledge Graph</strong>, in die{" "}
          <strong>Historian Time-Series DB</strong> und in den{" "}
          <strong>Unified Namespace (MQTT)</strong>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
            <div className="text-blue-400 font-semibold text-sm mb-1">OPC-UA Server</div>
            <div className="text-xs text-text-muted">
              Jede Maschine hat einen OPC-UA Server. Er exponiert Tags
              (Variablen), Methoden und Events in einem hierarchischen
              Address Space.
            </div>
          </div>
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
            <div className="text-green-400 font-semibold text-sm mb-1">Edge Gateway</div>
            <div className="text-xs text-text-muted">
              Liest OPC-UA Tags per Subscription, publiziert Werte auf
              den MQTT Broker im UNS-Format. Kepware, Ignition, oder
              custom Node-RED.
            </div>
          </div>
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3">
            <div className="text-purple-400 font-semibold text-sm mb-1">OpenShopFloor</div>
            <div className="text-xs text-text-muted">
              Empfangt die MQTT-Daten und verteilt sie: Historian speichert,
              KG Agent entdeckt Maschinen, UNS Stream zeigt live an.
            </div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="OPC-UA Server auf Maschinen">
        <p>
          Ein OPC-UA Server ist ein Dienst, der direkt auf der Maschine (SPS,
          CNC-Steuerung, Roboter-Controller) lauft. Er stellt einen{" "}
          <strong>Address Space</strong> bereit &mdash; eine hierarchische Struktur
          mit:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Variablen (Tags)</strong> &mdash; Echtzeitwerte wie
            Spindeldrehzahl, Temperatur, Vorschub, Stuckzahl, OEE. Jeder Tag hat
            eine <code className="text-accent">NodeId</code>, einen Datentyp und
            eine Engineering Unit.
          </li>
          <li>
            <strong>Objekte</strong> &mdash; Hierarchische Gruppierung: Maschine →
            Achsen → Spindel → Drehzahl. Folgt dem ISA-95 Equipment Model.
          </li>
          <li>
            <strong>Methoden</strong> &mdash; Aufrufbare Funktionen auf der
            Maschine, z.B. Programm starten, Werkzeug wechseln, Reset.
          </li>
          <li>
            <strong>Events &amp; Alarme</strong> &mdash; Storungen, Warnungen,
            Zustandswechsel. OPC-UA Alarms &amp; Conditions (A&amp;C).
          </li>
        </ul>

        <h4 className="font-semibold text-text mt-4 mb-2">Typische OPC-UA Server in der Fertigung</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border">
            <thead>
              <tr className="bg-bg-surface text-text-muted">
                <th className="px-3 py-2 text-left border-b border-border">Maschine</th>
                <th className="px-3 py-2 text-left border-b border-border">OPC-UA Server</th>
                <th className="px-3 py-2 text-left border-b border-border">Typische Tags</th>
              </tr>
            </thead>
            <tbody className="text-text">
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">CNC-Frasmaschine</td>
                <td className="px-3 py-2 text-text-muted">Siemens SINUMERIK, Fanuc, Heidenhain</td>
                <td className="px-3 py-2 font-mono text-xs">SpindleSpeed, FeedRate, ToolId, ProgramName, PartsCount</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Spritzgussmaschine</td>
                <td className="px-3 py-2 text-text-muted">EUROMAP 77/83 (OPC-UA Companion Spec)</td>
                <td className="px-3 py-2 font-mono text-xs">CavityPressure, MeltTemp, CycleTime, ShotWeight, MoldTemp</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Roboter</td>
                <td className="px-3 py-2 text-text-muted">KUKA, ABB, Fanuc (OPC-UA Robotics CS)</td>
                <td className="px-3 py-2 font-mono text-xs">JointPositions, TCP_Speed, ProgramState, CycleCount</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">SPS / PLC</td>
                <td className="px-3 py-2 text-text-muted">Siemens S7 (OPC-UA), Beckhoff TwinCAT, Codesys</td>
                <td className="px-3 py-2 font-mono text-xs">Temperatur, Druck, Durchfluss, Ventilstellung, Status</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Montagelinie</td>
                <td className="px-3 py-2 text-text-muted">PackML State Machine (OPC-UA)</td>
                <td className="px-3 py-2 font-mono text-xs">CurrentState, StationOEE, TaktTime, ScrapCount</td>
              </tr>
            </tbody>
          </table>
        </div>
      </WikiSection>

      <WikiSection title="Daten-Pipeline: OPC-UA → MQTT → OpenShopFloor">
        <p>
          Der Standardweg: Ein <strong>Edge Gateway</strong> liest die OPC-UA Tags
          per Subscription und publiziert die Werte auf den MQTT Broker im
          ISA-95 UNS-Topic-Format:
        </p>
        <div className="mt-3 rounded-md border border-border bg-[#0d1117] p-4 font-mono text-xs text-gray-300 leading-relaxed">
          <div className="text-text-dim mb-2">{"// Datenfluss: OPC-UA Server → OpenShopFloor"}</div>
          <div className="mt-1">
            <span className="text-blue-400">OPC-UA Server</span>
            <span className="text-text-dim"> (auf CNC-001, opc.tcp://10.0.1.20:4840)</span>
          </div>
          <div className="text-text-dim">{"    │  Subscription: SpindleSpeed, FeedRate, PartsCount"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-yellow-400">Edge Gateway</span>
            <span className="text-text-dim"> (Kepware / Ignition / Node-RED / custom)</span>
          </div>
          <div className="text-text-dim">{"    │  Mapping: NodeId → MQTT Topic"}</div>
          <div className="text-text-dim">{"    │  ns=2;s=Spindle.Speed → Factory/CNC-001/.../OEE/spindle_speed"}</div>
          <div className="text-text-dim">{"    ▼"}</div>
          <div>
            <span className="text-green-400">MQTT Broker</span>
            <span className="text-text-dim"> (Unified Namespace)</span>
          </div>
          <div className="text-text-dim">{"    │"}</div>
          <div className="text-text-dim">{"    ├──▶ "}<span className="text-purple-400">Historian</span>{" → TimescaleDB (time-series speichern)"}</div>
          <div className="text-text-dim">{"    ├──▶ "}<span className="text-red-400">KG Agent</span>{" → Neo4j (Maschine + Sensoren entdecken)"}</div>
          <div className="text-text-dim">{"    └──▶ "}<span className="text-cyan-400">UNS Stream</span>{" → SSE (Live-Dashboard im Browser)"}</div>
        </div>

        <WikiCallout type="info">
          Das Topic-Format folgt ISA-95:{" "}
          <code>Factory/&#123;Machine&#125;/&#123;Order&#125;/&#123;Step&#125;/&#123;Category&#125;/&#123;Variable&#125;</code>.
          Der KG Agent parst diese Topics automatisch und erstellt Maschinen-
          und Sensor-Knoten im Knowledge Graph.
        </WikiCallout>

        <h4 className="font-semibold text-text mt-4 mb-2">Edge Gateway Optionen</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Kepware / KEPServerEX</div>
            <div className="text-xs text-text-muted mt-1">
              Industriestandard. OPC-UA Client → IoT Gateway → MQTT Publisher.
              Drag &amp; Drop Tag-Mapping.
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Ignition Edge</div>
            <div className="text-xs text-text-muted mt-1">
              OPC-UA Verbindung + MQTT Transmission Module.
              Tag-Groups mit konfigurierbarer Publish-Rate.
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Node-RED + node-red-contrib-opcua</div>
            <div className="text-xs text-text-muted mt-1">
              Open-Source. OPC-UA Client Node → Function Node (Mapping) →
              MQTT Out Node. Flexibel, kostenlos.
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Custom Agent (geplant)</div>
            <div className="text-xs text-text-muted mt-1">
              OpenShopFloor OPC-UA Discovery Agent: Auto-Browse, Auto-Map
              zu UNS Topics, Auto-Register im KG.
            </div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="OPC-UA im Knowledge Graph">
        <p>
          Der KG Builder kennt <code>opcua</code> als Source-Typ. OPC-UA Mappings
          definieren, welche Server und Tags zu welchen KG-Knoten werden:
        </p>
        <div className="mt-2 rounded-md border border-border bg-[#0d1117] p-3 font-mono text-xs text-gray-300">
          <div className="text-text-dim">{"// Jede Maschine wird ein Knoten im KG"}</div>
          <div>{"MERGE (m:Machine {id: 'CNC-001'})"}</div>
          <div>{"SET m.name = 'DMG MORI DMU 50',"}</div>
          <div>{"    m.opcua_endpoint = 'opc.tcp://10.0.1.20:4840',"}</div>
          <div>{"    m.area = 'Fertigung',"}</div>
          <div>{"    m.line = 'CNC-Linie-1'"}</div>
          <div className="mt-2 text-text-dim">{"// ISA-95 Equipment Hierarchy"}</div>
          <div>{"MERGE (site:Site {id: 'Werk-Sued'})"}</div>
          <div>{"MERGE (area:Area {id: 'Fertigung'})"}</div>
          <div>{"MERGE (line:Line {id: 'CNC-Linie-1'})"}</div>
          <div>{"MERGE (site)-[:CONTAINS]->(area)"}</div>
          <div>{"MERGE (area)-[:CONTAINS]->(line)"}</div>
          <div>{"MERGE (line)-[:CONTAINS]->(m)"}</div>
          <div className="mt-2 text-text-dim">{"// Sensoren (OPC-UA Tags) als eigene Knoten"}</div>
          <div>{"MERGE (s:Sensor {id: 'CNC-001/spindle_speed'})"}</div>
          <div>{"SET s.unit = 'rpm', s.category = 'OEE'"}</div>
          <div>{"MERGE (m)-[:HAS_SENSOR]->(s)"}</div>
        </div>

        <WikiCallout type="tip">
          Der{" "}
          <Link href="/docs/wiki/knowledge-graph" className="text-accent hover:underline">
            KG Agent
          </Link>{" "}
          entdeckt Maschinen und Sensoren automatisch aus MQTT-Topics &mdash;
          ohne manuelle Konfiguration. Neue Maschine anschliessen, und sie
          erscheint in Sekunden im Graph.
        </WikiCallout>
      </WikiSection>

      <WikiSection title="MTP (VDI 2658) fur Prozessindustrie">
        <p>
          In der Prozessindustrie (Pharma, Chemie) beschreiben sich modulare
          Anlagenteile per <strong>Module Type Package (MTP)</strong>.
          Ein MTP-File ist ein AutomationML/CAEX XML-Dokument mit:
        </p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>Process Equipment Assemblies (PEAs)</strong> &mdash; Physische
            Module wie Reaktoren, Dosieranlagen, Separatoren. Jedes PEA hat einen
            eigenen OPC-UA Server.
          </li>
          <li>
            <strong>Services</strong> &mdash; Ausfuhrbare Operationen mit
            Zustandsmaschinen: Start, Pause, Abort, Complete.
          </li>
          <li>
            <strong>Prozessvariablen</strong> &mdash; Jede Variable hat einen
            <code className="text-accent ml-1">opcuaNodeId</code> fur direkten
            Zugriff auf den OPC-UA Server des Moduls.
          </li>
        </ul>
        <p className="mt-2 text-sm text-text-muted">
          OpenShopFloor parst diese MTP-Files und erstellt daraus automatisch
          Knoten im Knowledge Graph: Equipment → Service → Variable. Der
          OPC-UA Endpoint wird gespeichert fur spatere direkte Kommunikation.
        </p>

        <h4 className="font-semibold text-text mt-4 mb-2">MTP → KG Mapping</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border">
            <thead>
              <tr className="bg-bg-surface text-text-muted">
                <th className="px-3 py-2 text-left border-b border-border">MTP Element</th>
                <th className="px-3 py-2 text-left border-b border-border">KG Knoten</th>
                <th className="px-3 py-2 text-left border-b border-border">KG Beziehungen</th>
              </tr>
            </thead>
            <tbody className="text-text">
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">PEA (Reaktor, Dosierer)</td>
                <td className="px-3 py-2 font-mono text-blue-400">Equipment</td>
                <td className="px-3 py-2 text-text-muted">CONTAINS → Service, HAS_VARIABLE → Variable</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="px-3 py-2">Service + Prozeduren</td>
                <td className="px-3 py-2 font-mono text-green-400">Service</td>
                <td className="px-3 py-2 text-text-muted">HAS_PROCEDURE → Procedure</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Prozessvariable</td>
                <td className="px-3 py-2 font-mono text-yellow-400">Variable</td>
                <td className="px-3 py-2 text-text-muted">opcuaNodeId → direkter OPC-UA Tag-Zugriff</td>
              </tr>
            </tbody>
          </table>
        </div>
      </WikiSection>

      <WikiSection title="CESMII Smart Manufacturing Profiles">
        <p>
          CESMII SM Profiles definieren standardisierte Typen fur
          Fertigungsequipment im OPC-UA NodeSet XML Format. Der Parser
          extrahiert:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Typ-Hierarchien</strong> &mdash; z.B.{" "}
            <code>CNCMachine</code> erbt von <code>Machine</code>
          </li>
          <li>
            <strong>Attribute</strong> &mdash; Datentypen und Units pro
            Equipment-Typ
          </li>
          <li>
            <strong>Beziehungen</strong> &mdash; HasProperty, HasComponent
            zwischen Typen
          </li>
        </ul>
        <p className="mt-2 text-sm text-text-muted">
          SM Profiles werden als Schema-Hints fur den KG Builder verwendet:
          sie definieren, welche Knoten-Typen und Properties der Graph
          haben soll.
        </p>
      </WikiSection>

      <WikiSection title="Domain Templates">
        <p>
          Jede Industrie hat andere OPC-UA Server, andere Standards und andere
          Anforderungen. OpenShopFloor liefert vorkonfigurierte Templates:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Diskrete Fertigung</div>
            <div className="text-xs text-text-muted mt-1">OPC-UA: SINUMERIK, Fanuc, Heidenhain</div>
            <div className="text-xs text-text-muted">Standard: ISA-95, CESMII SM Profiles</div>
            <div className="text-xs text-text-muted">Knoten: Machine, Article, Order, Material, Supplier, Tool</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Pharma</div>
            <div className="text-xs text-text-muted mt-1">OPC-UA: MTP/PEA Server (VDI 2658)</div>
            <div className="text-xs text-text-muted">Standard: GMP, 21 CFR Part 11</div>
            <div className="text-xs text-text-muted">Knoten: Reactor, Batch, Recipe, CleanRoom, QualityTest</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Chemie / Prozessindustrie</div>
            <div className="text-xs text-text-muted mt-1">OPC-UA: MTP/PEA Server, DCS OPC-UA Gateway</div>
            <div className="text-xs text-text-muted">Standard: ISA-88 / ISA-95</div>
            <div className="text-xs text-text-muted">Knoten: ProcessUnit, Stream, Recipe, PID_Loop, Alarm</div>
          </div>
          <div className="rounded-md border border-border bg-bg-surface p-3">
            <div className="font-semibold text-sm text-text">Medizintechnik</div>
            <div className="text-xs text-text-muted mt-1">OPC-UA: Reinraum-SPS, Sterilisationsanlagen</div>
            <div className="text-xs text-text-muted">Standard: MDR, UDI Traceability</div>
            <div className="text-xs text-text-muted">Knoten: DeviceAssembly, CleanRoom, SterilizationBatch, UDI</div>
          </div>
        </div>
      </WikiSection>

      <WikiSection title="Roadmap">
        <p>Geplante OPC-UA Features:</p>
        <ul className="list-disc list-inside space-y-2 mt-2">
          <li>
            <strong>OPC-UA Discovery Agent</strong> &mdash; Automatisch OPC-UA
            Server im Netzwerk finden, Address Space browsen, Tags auf
            MQTT UNS Topics mappen, Maschinen im KG registrieren.
          </li>
          <li>
            <strong>Direkte Tag Subscription</strong> &mdash; OPC-UA
            Subscriptions ohne MQTT-Umweg fur Hochfrequenz-Daten
            (Schwingungsanalyse, Werkzeugbrucherkennung).
          </li>
          <li>
            <strong>OPC-UA Method Calls</strong> &mdash; Uber den KG
            Maschinenoperationen auslosen: Programm starten, Parameter
            setzen, Werkzeugwechsel initiieren.
          </li>
          <li>
            <strong>PackML State Machine</strong> &mdash; PackML-Zustande
            (Execute, Idle, Stopped, Aborted) als KG-Knoten fur
            Echtzeit-Equipment-Tracking.
          </li>
          <li>
            <strong>Alarms &amp; Conditions</strong> &mdash; OPC-UA A&amp;C
            Events als Alarm-Knoten im KG fur AI-gestutzte
            Root-Cause-Analyse.
          </li>
        </ul>
      </WikiSection>
    </>
  );
}
