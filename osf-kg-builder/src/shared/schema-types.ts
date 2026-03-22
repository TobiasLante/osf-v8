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
  syncType: 'mqtt' | 'polling' | 'pg-notify';
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

// ── Schema Build Report ─────────────────────────────────────────

export interface SchemaBuildReport {
  profiles: number;
  sources: { opcua: number; postgresql: number; rest: number; mcp: number };
  syncs: { mqtt: number; polling: number };
  constraintsCreated: number;
  nodesMerged: number;
  edgesCreated: number;
  mqttSubscriptions: number;
  pollingJobs: number;
  errors: string[];
  duration: number;
}
