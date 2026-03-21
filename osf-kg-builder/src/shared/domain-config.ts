import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';
import { config as appConfig } from './config';
import { DomainConfig, DomainCheck, SchemaTemplate, TemplateNodeType, TemplateEdgeType } from './types';
import { NodeTypeSpec, EdgeTypeSpec } from './types';

// ── Built-in Presets ───────────────────────────────────────────────

export const DOMAIN_PRESETS: Record<string, DomainConfig> = {
  manufacturing: {
    domain: 'manufacturing',
    displayName: 'Discrete Manufacturing',
    systemPromptContext: 'discrete manufacturing (ISA-95, CESMII Smart Manufacturing Profiles)',
    ontologyHint: 'ISA-95 equipment hierarchy (Enterprise → Site → Area → WorkCenter → WorkUnit)',
    expectedNodeTypes: [
      'Machine', 'Article', 'Order', 'Material', 'Customer', 'Supplier',
      'Tool', 'Pool', 'MachineType', 'Area', 'Site', 'KPIDef', 'Sensor',
    ],
    expectedEdgeTypes: [
      'WORKS_ON', 'PRODUCES', 'HAS_BOM', 'FOR_CUSTOMER', 'SUPPLIED_BY',
      'INSTANCE_OF', 'LOCATED_IN', 'PART_OF', 'HAS_KPI', 'HAS_SENSOR', 'USES_TOOL',
    ],
    sampleChecks: [
      { type: 'node_min_count', label: 'Machine', min: 1 },
      { type: 'edge_exists', label: 'WORKS_ON' },
      { type: 'hierarchy', label: 'Site→Area', parent: 'Site', child: 'Area', edge: 'PART_OF' },
    ],
    schemaExamples: {
      nodeExample: 'Machine (maschine_id, name, oee, status)',
      edgeExample: 'WORKS_ON (Machine → Order, start_date)',
    },
    profileFormat: 'cesmii',
    complianceChecks: [],
  },

  pharma: {
    domain: 'pharma',
    displayName: 'Pharmaceutical Manufacturing',
    systemPromptContext: 'pharmaceutical batch manufacturing (GMP, ISA-88, 21 CFR Part 11)',
    ontologyHint: 'ISA-88 batch control hierarchy (Site → Area → ProcessCell → Unit → EquipmentModule)',
    expectedNodeTypes: [
      'Equipment', 'Batch', 'Ingredient', 'Product', 'TestResult', 'Specification',
      'Vessel', 'Reactor', 'Operator', 'Site', 'Area', 'Recipe',
    ],
    expectedEdgeTypes: [
      'PROVIDES', 'EXECUTED_FOR', 'CONTAINS', 'PRODUCED_IN', 'TESTED_BY',
      'FOLLOWS_RECIPE', 'SUPPLIED_BY', 'LOCATED_IN', 'PART_OF',
      'HAS_SPECIFICATION', 'REQUIRES_TEST', 'CONSUMED_BY',
    ],
    sampleChecks: [
      { type: 'node_min_count', label: 'Batch', min: 1 },
      { type: 'edge_exists', label: 'CONTAINS' },
      { type: 'hierarchy', label: 'Site→Area', parent: 'Site', child: 'Area', edge: 'PART_OF' },
    ],
    schemaExamples: {
      nodeExample: 'Batch (batch_id, product, status, start_date)',
      edgeExample: 'CONTAINS (Batch → Ingredient, quantity, unit)',
    },
    profileFormat: 'mtp',
    complianceChecks: [
      'Every Batch must have at least one TESTED_BY edge',
      'Every Equipment must have LOCATED_IN → Area',
    ],
  },

  chemical: {
    domain: 'chemical',
    displayName: 'Chemical Process Industry',
    systemPromptContext: 'chemical process industry (ISA-88/95, continuous and batch processes)',
    ontologyHint: 'ISA-88 batch + ISA-95 continuous hierarchy',
    expectedNodeTypes: [
      'Reactor', 'Charge', 'RawMaterial', 'AnalysisResult', 'Recipe',
      'Product', 'Equipment', 'Column', 'HeatExchanger', 'Tank', 'Site', 'Area',
    ],
    expectedEdgeTypes: [
      'PRODUCED_IN', 'CONTAINS', 'ANALYZED_BY', 'FOLLOWS_RECIPE',
      'FROM_LOT', 'SUPPLIED_BY', 'LOCATED_IN', 'PART_OF', 'FEEDS_INTO', 'STORES',
    ],
    sampleChecks: [
      { type: 'node_min_count', label: 'Reactor', min: 1 },
      { type: 'edge_exists', label: 'CONTAINS' },
      { type: 'hierarchy', label: 'Site→Area', parent: 'Site', child: 'Area', edge: 'PART_OF' },
    ],
    schemaExamples: {
      nodeExample: 'Reactor (reactor_id, name, capacity, temperature_max)',
      edgeExample: 'CONTAINS (Charge → RawMaterial, quantity, unit)',
    },
    profileFormat: 'mtp',
    complianceChecks: [],
  },

  medtech: {
    domain: 'medtech',
    displayName: 'Medical Device Manufacturing',
    systemPromptContext: 'medical device manufacturing (MDR, UDI traceability, ISO 13485)',
    ontologyHint: 'Device genealogy and traceability chain',
    expectedNodeTypes: [
      'Device', 'Component', 'Measurement', 'Tool', 'CleanroomBatch',
      'Packaging', 'Equipment', 'Calibration', 'Specification', 'Site', 'Area',
    ],
    expectedEdgeTypes: [
      'PRODUCED_BY', 'MEASURED_BY', 'USED_TOOL', 'PACKAGED_IN', 'HAS_UDI',
      'CALIBRATED_BY', 'PART_OF', 'LOCATED_IN', 'HAS_SPECIFICATION', 'TRACED_TO',
    ],
    sampleChecks: [
      { type: 'node_min_count', label: 'Device', min: 1 },
      { type: 'edge_exists', label: 'PRODUCED_BY' },
      { type: 'hierarchy', label: 'Site→Area', parent: 'Site', child: 'Area', edge: 'PART_OF' },
    ],
    schemaExamples: {
      nodeExample: 'Device (udi, product_code, lot, serial_number)',
      edgeExample: 'PRODUCED_BY (Device → Equipment, timestamp)',
    },
    profileFormat: 'mtp',
    complianceChecks: [],
  },
};

// ── Load Domain Config ─────────────────────────────────────────────

// Domain aliases — map alternative names to canonical preset keys
const DOMAIN_ALIASES: Record<string, string> = {
  discrete: 'manufacturing',
};

export function loadDomainConfig(): DomainConfig {
  const rawDomain = process.env.DOMAIN || 'manufacturing';
  const domain = DOMAIN_ALIASES[rawDomain] || rawDomain;

  if (DOMAIN_PRESETS[domain]) {
    logger.info({ domain, rawDomain }, 'Loaded domain preset');
    return DOMAIN_PRESETS[domain];
  }

  // Try loading from file
  const configPath = process.env.DOMAIN_CONFIG_PATH;
  if (configPath) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as DomainConfig;
      logger.info({ domain: parsed.domain, path: configPath }, 'Loaded domain config from file');
      return parsed;
    } catch (e: any) {
      logger.error({ err: e.message, path: configPath }, 'Failed to load domain config from file');
    }
  }

  logger.warn({ domain: rawDomain }, 'Unknown domain preset and no DOMAIN_CONFIG_PATH — falling back to manufacturing');
  return DOMAIN_PRESETS.manufacturing;
}

// ── Domain → Schema Hint ───────────────────────────────────────────

export function domainToSchemaHint(domain: DomainConfig): string {
  const lines: string[] = [
    `Domain: ${domain.displayName}`,
    `Context: ${domain.systemPromptContext}`,
    `Ontology: ${domain.ontologyHint}`,
    '',
    'Expected Node Types:',
    `  ${domain.expectedNodeTypes.join(', ')}`,
    '',
    'Expected Edge Types:',
    `  ${domain.expectedEdgeTypes.join(', ')}`,
    '',
    'Schema Examples:',
    `  Node: ${domain.schemaExamples.nodeExample}`,
    `  Edge: ${domain.schemaExamples.edgeExample}`,
    '',
    `Profile Format: ${domain.profileFormat}`,
  ];

  if (domain.complianceChecks.length > 0) {
    lines.push('', 'Compliance Checks:');
    for (const check of domain.complianceChecks) {
      lines.push(`  - ${check}`);
    }
  }

  return lines.join('\n');
}

// ── Schema Template Loader ─────────────────────────────────────────

const TEMPLATES_DIR = join(__dirname, '../../templates');

export function loadSchemaTemplate(domain: string): SchemaTemplate | null {
  // Resolve aliases so both "discrete" and "manufacturing" find the same template
  const resolved = DOMAIN_ALIASES[domain] || domain;

  // Search order: schema repo (synced from GitHub) → bundled templates
  const candidates = [
    join(appConfig.schemaRepo.localPath, 'templates', `${resolved}.json`),
    join(appConfig.schemaRepo.localPath, 'templates', `${domain}.json`),
    join(TEMPLATES_DIR, `${resolved}.json`),
    join(TEMPLATES_DIR, `${domain}.json`),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const template = JSON.parse(raw) as SchemaTemplate;
      logger.info({ domain: template.domain, nodes: template.nodeTypes.length, edges: template.edgeTypes.length, path: filePath }, 'Loaded schema template');
      return template;
    } catch (e: any) {
      logger.error({ err: e.message, path: filePath }, 'Failed to load schema template');
    }
  }

  logger.info({ domain, resolved, candidates }, 'No schema template found in any location');
  return null;
}

/**
 * Convert a SchemaTemplate to NodeTypeSpec[] + EdgeTypeSpec[] for the pipeline.
 */
export function templateToSpecs(template: SchemaTemplate): { nodeTypes: NodeTypeSpec[]; edgeTypes: EdgeTypeSpec[] } {
  const nodeTypes: NodeTypeSpec[] = template.nodeTypes.map(nt => ({
    label: nt.label,
    idProperty: nt.idProperty,
    properties: nt.properties.map(p => ({
      name: p.name,
      type: p.type,
      description: p.description || p.name,
    })),
    sourceTool: nt.sourceTool,
    sourceMapping: `Template: ${template.domain} — ${nt.label} from ${nt.sourceTool}`,
  }));

  const edgeTypes: EdgeTypeSpec[] = template.edgeTypes.map(et => ({
    label: et.label,
    fromType: et.fromType,
    toType: et.toType,
    sourceTool: et.sourceTool,
    sourceMapping: `Template: FK ${et.fkProperty} on ${et.sourceTool}`,
    fkProperty: et.fkProperty,
  }));

  return { nodeTypes, edgeTypes };
}
