import { callLlmJson, ChatMessage } from './llm-client';
import { ToolDiscoveryResult } from './tool-discovery';
import { SMProfileSchema, smProfileToSchemaHint } from './sm-profile-parser';
import { loadDomainConfig, domainToSchemaHint } from './domain-config';
import { kgPool } from './cypher-utils';
import { config } from './config';
import { logger } from './logger';

// ── Types ──────────────────────────────────────────────────────────

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

// ── Schema Planning (LLM) ─────────────────────────────────────────

export async function planSchema(
  discovery: ToolDiscoveryResult,
  smProfile?: SMProfileSchema,
  i3xProposal?: SchemaProposal,
  mtpNodeTypes?: NodeTypeSpec[],
  mtpEdgeTypes?: EdgeTypeSpec[],
): Promise<SchemaProposal> {
  const domain = loadDomainConfig();

  const toolDescriptions = discovery.tools.map(t =>
    `Tool: ${t.name}\n  Description: ${t.description}\n  Sample output (first 500 chars): ${(t.sampleOutput || '').substring(0, 500)}`
  ).join('\n\n');

  const smHint = smProfile ? `\n\n${smProfileToSchemaHint(smProfile)}` : '';

  const complianceSection = domain.complianceChecks.length > 0
    ? `- ${domain.complianceChecks.join('. ')}`
    : '';

  const schemaExamples = domain.schemaExamples || `{
  "nodeTypes": [
    {"label": "Entity", "idProperty": "id", "properties": [{"name": "name", "type": "string", "description": "Name"}], "sourceTool": "tool_name", "sourceMapping": "Each row is one entity"}
  ],
  "edgeTypes": [
    {"label": "RELATES_TO", "fromType": "Entity", "toType": "Entity", "sourceTool": "tool_name", "sourceMapping": "Mapping description"}
  ],
  "toolMappings": [
    {"toolName": "tool_name", "produces": ["Entity"], "impliesEdges": []}
  ]
}`;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a ${domain.displayName} Knowledge Graph architect.
You design graph schemas from data source descriptions.
${domain.ontologyHint}
${domainToSchemaHint(domain)}`,
    },
    {
      role: 'user',
      content: `Analyze these ${discovery.tools.length} MCP tools and design a Knowledge Graph schema.
${smHint}

AVAILABLE TOOLS:
${toolDescriptions}

Design a KG schema with:
1. Node Types (entities like ${domain.expectedNodeTypes.join(', ')})
2. Edge Types (relationships like ${domain.expectedEdgeTypes.join(', ')})
3. Tool Mappings (which tool provides data for which node/edge type)

Rules:
- Each Node Type MUST have a clearly DISTINCT perspective. No overlap.
${complianceSection}
- idProperty should be the field from the tool output that uniquely identifies the entity
- sourceMapping should describe how to extract entities from the tool output

RESPONSE FORMAT: Pure JSON.
${schemaExamples}`,
    },
  ];

  let result = await callLlmJson<SchemaProposal>(messages, { maxTokens: 4096 });

  // Merge i3X proposal if provided (i3X types take priority — they're ground truth)
  if (i3xProposal) {
    const existingNodeLabels = new Set(result.nodeTypes.map(n => n.label));
    const existingEdgeLabels = new Set(result.edgeTypes.map(e => `${e.fromType}-${e.label}-${e.toType}`));

    for (const nt of i3xProposal.nodeTypes) {
      if (existingNodeLabels.has(nt.label)) {
        // i3X takes priority — replace existing
        result.nodeTypes = result.nodeTypes.filter(n => n.label !== nt.label);
      }
      result.nodeTypes.push(nt);
    }

    for (const et of i3xProposal.edgeTypes) {
      const key = `${et.fromType}-${et.label}-${et.toType}`;
      if (existingEdgeLabels.has(key)) {
        result.edgeTypes = result.edgeTypes.filter(e => `${e.fromType}-${e.label}-${e.toType}` !== key);
      }
      result.edgeTypes.push(et);
    }

    if (i3xProposal.toolMappings) {
      result.toolMappings = [...result.toolMappings, ...i3xProposal.toolMappings];
    }
  }

  // Merge MTP node/edge types if provided
  if (mtpNodeTypes && mtpNodeTypes.length > 0) {
    const existingNodeLabels = new Set(result.nodeTypes.map(n => n.label));
    for (const nt of mtpNodeTypes) {
      if (!existingNodeLabels.has(nt.label)) {
        result.nodeTypes.push(nt);
      }
    }
  }

  if (mtpEdgeTypes && mtpEdgeTypes.length > 0) {
    const existingEdgeLabels = new Set(result.edgeTypes.map(e => `${e.fromType}-${e.label}-${e.toType}`));
    for (const et of mtpEdgeTypes) {
      const key = `${et.fromType}-${et.label}-${et.toType}`;
      if (!existingEdgeLabels.has(key)) {
        result.edgeTypes.push(et);
      }
    }
  }

  return result;
}

// ── Format for Chat ────────────────────────────────────────────────

export function formatProposalForChat(proposal: SchemaProposal): string {
  const lines: string[] = ['## KG Schema Proposal\n'];

  lines.push('### Node Types');
  for (const nt of proposal.nodeTypes) {
    const props = nt.properties.map(p => p.name).join(', ');
    lines.push(`- **${nt.label}** (ID: \`${nt.idProperty}\`) — ${nt.properties.length} properties: ${props}`);
    lines.push(`  Source: \`${nt.sourceTool}\``);
  }

  lines.push('\n### Edge Types');
  for (const et of proposal.edgeTypes) {
    lines.push(`- **${et.fromType}** —[${et.label}]→ **${et.toType}**`);
    lines.push(`  Source: \`${et.sourceTool}\``);
  }

  lines.push('\n### Tool Mappings');
  for (const tm of proposal.toolMappings) {
    lines.push(`- \`${tm.toolName}\` → ${tm.produces.join(', ')}${tm.impliesEdges.length > 0 ? ` + edges: ${tm.impliesEdges.join(', ')}` : ''}`);
  }

  lines.push(`\n**Total: ${proposal.nodeTypes.length} node types, ${proposal.edgeTypes.length} edge types, ${proposal.toolMappings.length} tool mappings**`);
  lines.push('\nBestaetige mit "ok" oder sage mir was fehlt/geaendert werden soll.');

  return lines.join('\n');
}

// ── Apply User Corrections ─────────────────────────────────────────

export async function applyUserCorrections(
  proposal: SchemaProposal,
  userMessage: string,
  discovery: ToolDiscoveryResult,
): Promise<SchemaProposal> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a ${loadDomainConfig().displayName} Knowledge Graph architect. Revise the schema based on user feedback.`,
    },
    {
      role: 'user',
      content: `Current schema:\n${JSON.stringify(proposal, null, 2)}\n\nAvailable tools: ${discovery.tools.map(t => t.name).join(', ')}\n\nUser feedback: "${userMessage}"\n\nRevise the schema and return the FULL updated schema as JSON (same format as before).`,
    },
  ];

  return callLlmJson<SchemaProposal>(messages, { maxTokens: 4096 });
}

// ── DB Persistence ─────────────────────────────────────────────────

export async function saveSchemaRun(run: SchemaRun): Promise<void> {
  await kgPool.query(`
    CREATE TABLE IF NOT EXISTS ${config.db.schema}.kg_builder_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'planning',
      proposal JSONB,
      confirmed_schema JSONB,
      extraction_report JSONB,
      validation_report JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await kgPool.query(`
    INSERT INTO ${config.db.schema}.kg_builder_runs (id, status, proposal, confirmed_schema, extraction_report, validation_report, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (id) DO UPDATE SET
      status = $2, proposal = $3, confirmed_schema = $4,
      extraction_report = $5, validation_report = $6, updated_at = NOW()
  `, [run.id, run.status, JSON.stringify(run.proposal), JSON.stringify(run.confirmedSchema), JSON.stringify(run.extractionReport), JSON.stringify(run.validationReport), run.createdAt]);
}

export async function loadSchemaRun(id: string): Promise<SchemaRun | null> {
  const result = await kgPool.query(
    `SELECT * FROM ${config.db.schema}.kg_builder_runs WHERE id = $1`, [id]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    status: r.status,
    proposal: r.proposal,
    confirmedSchema: r.confirmed_schema,
    extractionReport: r.extraction_report,
    validationReport: r.validation_report,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
