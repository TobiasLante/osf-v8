// ── Schema Types for the 3-Schema KG Build System ───────────────
// These match the JSON format in the osf-schemas GitHub repo.

// ── Schema 1: SM Profile (Type System) ──────────────────────────

export interface SMProfile {
  profileId: string;
  version: string;
  standard: string;
  displayName: string;
  description?: string;
  parentType: string | null;
  abstract?: boolean;          // Abstract parent profiles — no direct instances, skip index creation
  kpiRefs?: string[];          // KPI profile IDs that apply to this type (inherited from parent)
  attributes: SMProfileAttribute[];
  relationships: SMProfileRelationship[];
  kgNodeLabel: string;
  kgIdProperty: string;
}

export interface SMProfileAttribute {
  name: string;
  dataType: 'Int32' | 'Float' | 'String' | 'Boolean';
  unit?: string;
  category: string;
  description?: string;
  enum?: (string | number)[];
}

export interface SMProfileRelationship {
  type: string;
  target: string;
  description?: string;
}

// ── Schema 2: Source Schema (generic — OPC-UA, PostgreSQL, REST) ─

export interface SourceSchema {
  sourceId: string;
  version: string;
  sourceType: 'opcua' | 'postgresql' | 'rest' | 'mcp';
  profileRef: string;
  // OPC-UA specific
  endpoint?: string;
  machineId?: string;
  machineName?: string;
  location?: { enterprise?: string; site?: string; area?: string; line?: string };
  nodeMappings?: OpcUaNodeMapping[];
  staticProperties?: Record<string, any>;
  // Cross-platform fields (used by i-flow, Highbyte, Litmus, Ignition export scripts)
  polling?: PollingConfig;
  security?: SecurityConfig;
  transforms?: TransformConfig[];
  // PostgreSQL specific
  connection?: PostgresConnection;
  columnMappings?: ColumnMapping[];
  filter?: string | null;
  edges?: EdgeMapping[];
  // MCP specific
  mcpTool?: string;
  mcpEndpoint?: string;
  idProperty?: string;
}

// ── Polling / Subscription Config ──────────────────────────────
export interface PollingConfig {
  mode: 'scan' | 'subscribe' | 'on-change';
  intervalMs?: number;  // Required for 'scan' mode (e.g. 5000 = 5s)
}

// ── OPC-UA Security Config ─────────────────────────────────────
export interface SecurityConfig {
  mode: 'None' | 'Sign' | 'SignAndEncrypt';
  policy?: 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256' | 'Aes128_Sha256_RsaOaep' | 'Aes256_Sha256_RsaPss';
  auth: 'Anonymous' | 'Username' | 'Certificate';
  username?: string;
  password?: string;
  certificatePath?: string;
  privateKeyPath?: string;
}

// ── Per-Tag Transform (optional, for Highbyte JS / Litmus formula) ─
export interface TransformConfig {
  smAttribute: string;            // Which attribute this transform applies to
  expression: string;             // Platform-agnostic expression, e.g. "(value - 32) * 0.5556"
  outputDataType?: string;        // Override output data type after transform
}

// ── Datatype Mapping Table (osf-schema canonical → platform-specific) ─
export const DATATYPE_MAP: Record<string, Record<string, string>> = {
  //              osf (canonical)  → platform-specific
  'Int32':   { iflow: 'Number',  highbyte: 'Int32',   litmus: 'int32',   ignition: 'Int4'    },
  'Float':   { iflow: 'Number',  highbyte: 'Real32',  litmus: 'float32', ignition: 'Float4'  },
  'Float64': { iflow: 'Number',  highbyte: 'Real64',  litmus: 'float64', ignition: 'Float8'  },
  'String':  { iflow: 'String',  highbyte: 'String',  litmus: 'string',  ignition: 'String'  },
  'Boolean': { iflow: 'Boolean', highbyte: 'Boolean', litmus: 'bool',    ignition: 'Boolean' },
  'Int16':   { iflow: 'Number',  highbyte: 'Int16',   litmus: 'int16',   ignition: 'Int2'    },
  'Int64':   { iflow: 'Number',  highbyte: 'Int64',   litmus: 'int64',   ignition: 'Int8'    },
  'UInt16':  { iflow: 'Number',  highbyte: 'UInt16',  litmus: 'uint16',  ignition: 'Int2'    },
  'UInt32':  { iflow: 'Number',  highbyte: 'UInt32',  litmus: 'uint32',  ignition: 'Int4'    },
};

export interface PostgresConnection {
  host: string;
  port: number;
  database: string;
  schema: string;
  table: string;
}

export interface ColumnMapping {
  column: string;
  smAttribute: string;
  isId?: boolean;
}

export interface EdgeMapping {
  type: string;
  fkColumn: string;
  targetIdProp: string;   // Property to match target nodes on (e.g. "machine_id", "article_no")
  targetLabel?: string;   // Deprecated — use targetIdProp instead
}

// ── Schema 3: Sync Schema (generic — MQTT, polling, pg-notify) ──

export interface SyncSchema {
  syncId: string;
  version: string;
  syncType: 'mqtt' | 'polling' | 'pg-notify' | 'kafka' | 'rest-webhook' | 'manual';
  // MQTT specific
  broker?: { host: string; port: number };
  topicStructure?: {
    pattern: string;
    segments: Record<string, { index: number; description?: string }>;
    subscribeFilter: string;
  };
  payloadSchema?: {
    format: string;
    valuePath: string;
    timestampPath: string;
    timestampFormat: string;
    unitPath?: string;
    qualityPath?: string;
    datatypePath?: string;
  };
  attributeMapping?: {
    strategy: string;
    categorySegment?: number;
    attributeSegment?: number;
    mappings: UnsAttributeMapping[];
  };
  machineIdResolution?: {
    strategy: string;
    segment: number;
    description?: string;
  };
  // Polling specific
  pollIntervalMs?: number;
  sources?: PollSourceRef[];
  // Kafka specific
  kafka?: {
    bootstrapServers: string;
    consumerGroup: string;
    topics: KafkaTopicConfig[];
    securityProtocol?: 'PLAINTEXT' | 'SASL_PLAINTEXT' | 'SSL' | 'SASL_SSL';
    schemaRegistry?: string;
  };
  // REST-Webhook specific
  webhook?: {
    webhookPath: string;
    secret?: string;
    verifySignature?: boolean;
    profileRef: string;
    idField: string;
    payloadMapping?: Record<string, string>;
  };
  // Manual import specific
  manual?: {
    trigger: 'ui' | 'api' | 'schedule';
    format: 'csv' | 'json';
    profileRef: string;
    idField: string;
    scheduleIntervalMs?: number;
  };
}

export interface KafkaTopicConfig {
  topic: string;
  profileRef: string;
  keyIdProp: string;
  payloadMapping: Record<string, string>;
  consumerGroup?: string;
}

export interface PollSourceRef {
  sourceRef: string;
  changeDetection: 'timestamp' | 'full_refresh';
  timestampColumn?: string;
  batchSize?: number;
  refreshIntervalMs?: number;
}

// ── Legacy alias (backward compat with existing code) ───────────

export type OpcUaMapping = SourceSchema;
export type UnsMapping = SyncSchema;

// ── OPC-UA Node Mapping (used in SourceSchema.nodeMappings) ─────

export interface OpcUaNodeMapping {
  opcuaNodeId: string;
  browsePath: string[];
  smAttribute: string;
  dataType: string;
}

// ── UNS Attribute Mapping (used in SyncSchema.attributeMapping) ──

export interface UnsAttributeMapping {
  topicAttribute: string;
  smAttribute: string;
}

// ── KPI Schema (kpis/ directory) ────────────────────────────────

export interface KPISchema {
  kpiId: string;                // "KPI-OEE"
  version: string;
  displayName: string;          // "Overall Equipment Effectiveness"
  description?: string;
  unit: string;                 // "%", "hours", "kWh"
  category: 'efficiency' | 'quality' | 'maintenance' | 'energy' | 'cost';
  calculation: {
    inputs: string[];           // SM attribute names needed for calculation
    cypher: string;             // Cypher expression computing value from node alias `m`
  };
  thresholds?: {
    target?: number;
    warning?: number;
    critical?: number;
  };
  appliesTo: string[];          // Profile IDs or kgNodeLabels this KPI targets
}

// ── Schema Build Report ─────────────────────────────────────────

export interface SchemaBuildReport {
  profiles: number;
  sources: { opcua: number; postgresql: number; rest: number; mcp: number };
  syncs: { mqtt: number; polling: number; kafka: number; webhook: number; manual: number };
  kpis: number;
  constraintsCreated: number;
  nodesMerged: number;
  edgesCreated: number;
  kpisCalculated: number;
  mqttSubscriptions: number;
  pollingJobs: number;
  errors: string[];
  duration: number;
}
