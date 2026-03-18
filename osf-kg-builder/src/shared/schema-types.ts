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

// ── Schema 2: OPC-UA → SM Mapping (Instance Binding) ────────────

export interface OpcUaMapping {
  mappingId: string;
  version: string;
  discoveredAt: string;
  endpoint: string;
  machineId: string;
  machineName: string;
  profileRef: string;
  location: {
    enterprise?: string;
    site?: string;
    area?: string;
    line?: string;
  };
  nodeMappings: OpcUaNodeMapping[];
  staticProperties: Record<string, any>;
}

export interface OpcUaNodeMapping {
  opcuaNodeId: string;
  browsePath: string[];
  smAttribute: string;
  dataType: string;
}

// ── Schema 3: SM → UNS Mapping (MQTT Runtime Binding) ───────────

export interface UnsMapping {
  mappingId: string;
  version: string;
  description?: string;
  broker: {
    host: string;
    port: number;
  };
  topicStructure: {
    pattern: string;
    segments: Record<string, { index: number; description?: string }>;
    subscribeFilter: string;
  };
  payloadSchema: {
    format: string;
    valuePath: string;
    timestampPath: string;
    timestampFormat: string;
    unitPath?: string;
    qualityPath?: string;
    datatypePath?: string;
  };
  attributeMapping: {
    strategy: string;
    categorySegment?: number;
    attributeSegment?: number;
    mappings: UnsAttributeMapping[];
  };
  machineIdResolution: {
    strategy: string;
    segment: number;
    description?: string;
  };
}

export interface UnsAttributeMapping {
  topicAttribute: string;
  smAttribute: string;
}

// ── Schema Build Report ─────────────────────────────────────────

export interface SchemaBuildReport {
  profiles: number;
  machines: number;
  unsMappings: number;
  constraintsCreated: number;
  nodesMerged: number;
  edgesCreated: number;
  mqttSubscriptions: number;
  errors: string[];
  duration: number;
}
