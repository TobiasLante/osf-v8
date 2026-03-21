// ── Shared Types (used by builder, server, parsers) ─────────────

export interface NodeTypeSpec {
  label: string;
  idProperty: string;
  properties: Array<{ name: string; type: string; description: string }>;
  sourceTool: string;
  sourceMapping: string;
}

export interface EdgeTypeSpec {
  label: string;
  fromType: string;
  toType: string;
  properties?: Array<{ name: string; type: string }>;
  sourceTool: string;
  sourceMapping: string;
  fkProperty?: string;
}

export interface ToolMapping {
  toolName: string;
  produces: string[];
  impliesEdges: string[];
}

export interface SchemaProposal {
  nodeTypes: NodeTypeSpec[];
  edgeTypes: EdgeTypeSpec[];
  toolMappings: ToolMapping[];
}

export interface SchemaRun {
  id: string;
  status: 'planning' | 'confirmed' | 'extracting' | 'building' | 'validating' | 'correcting' | 'complete' | 'failed';
  proposal: SchemaProposal | null;
  confirmedSchema: SchemaProposal | null;
  extractionReport: any;
  validationReport: any;
  createdAt: string;
  updatedAt: string;
}

export interface DomainCheck {
  type: 'node_min_count' | 'edge_exists' | 'hierarchy';
  label: string;
  min?: number;
  parent?: string;
  child?: string;
  edge?: string;
}

export interface DomainConfig {
  domain: string;
  displayName: string;
  systemPromptContext: string;
  ontologyHint: string;
  expectedNodeTypes: string[];
  expectedEdgeTypes: string[];
  sampleChecks: DomainCheck[];
  schemaExamples: { nodeExample: string; edgeExample: string };
  profileFormat: 'cesmii' | 'mtp' | 'i3x' | 'none';
  complianceChecks: string[];
}

// ── Schema Template Types ───────────────────────────────────────

export interface TemplateProperty {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface TemplateNodeType {
  label: string;
  idProperty: string;
  sourceTool: string;
  properties: TemplateProperty[];
}

export interface TemplateEdgeType {
  label: string;
  fromType: string;
  toType: string;
  fkProperty: string;
  sourceTool: string;
}

export interface ComplianceRule {
  name: string;
  cypher: string;
  severity: 'error' | 'warning';
}

export interface TemplateTool {
  name: string;
  description: string;
  cypher: string;
  inputSchema: { type: 'object'; properties: Record<string, any>; required: string[] };
}

export interface SchemaTemplate {
  domain: string;
  displayName: string;
  standard: string;
  nodeTypes: TemplateNodeType[];
  edgeTypes: TemplateEdgeType[];
  complianceChecks: ComplianceRule[];
  sampleChecks: DomainCheck[];
  tools?: TemplateTool[];
}
