import { cypherQuery } from './cypher-utils';
import { callLlm, ChatMessage } from './llm-client';
import { SchemaProposal } from './schema-planner';
import { logger } from './logger';

export interface ValidationReport {
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  sampleChecks: SampleCheck[];
  cesmiiCompliance: CesmiiCheck[];
  accuracy: number;
  issues: string[];
}

interface SampleCheck {
  description: string;
  passed: boolean;
  detail: string;
}

interface CesmiiCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

// ── Count nodes/edges ──────────────────────────────────────────────

export async function countNodesByType(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  try {
    // AGE doesn't support labels() function easily, query each known label
    const labels = ['Machine', 'Article', 'Order', 'Material', 'Customer', 'Supplier',
      'Tool', 'Pool', 'MachineType', 'Area', 'Site', 'KPIDef', 'MaintenanceOrder',
      'DowntimeRecord', 'QualityNotification', 'SubcontractOrder', 'Subcontractor',
      'PurchaseOrder', 'Messmittel', 'MaterialLot', 'MaintenanceNotification', 'Sensor'];

    for (const label of labels) {
      try {
        const rows = await cypherQuery(`MATCH (n:${label}) RETURN count(n)`);
        const count = typeof rows[0] === 'number' ? rows[0] : parseInt(String(rows[0]), 10) || 0;
        if (count > 0) counts[label] = count;
      } catch { /* label doesn't exist yet */ }
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Failed to count nodes');
  }
  return counts;
}

export async function countEdgesByType(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const edgeLabels = ['WORKS_ON', 'PRODUCES', 'HAS_BOM', 'FOR_CUSTOMER', 'SUPPLIED_BY',
    'MEMBER_OF', 'NEEDS_POOL', 'NEEDS_TOOL', 'USES_TOOL', 'INSTANCE_OF', 'HAS_SUBTYPE',
    'LOCATED_IN', 'PART_OF', 'HAS_KPI', 'HAS_MAINTENANCE', 'HAD_DOWNTIME', 'FULFILLS',
    'OUTSOURCES', 'SUBCONTRACTED_TO', 'FOR_ARTICLE', 'AFFECTS_ARTICLE',
    'ORDERS_MATERIAL', 'ORDERED_FROM', 'PRODUCED_LOT', 'CONSUMED_BY', 'DERIVED_FROM',
    'FROM_MATERIAL', 'FROM_SUPPLIER', 'HAS_NOTIFICATION', 'HAS_SENSOR'];

  for (const label of edgeLabels) {
    try {
      const rows = await cypherQuery(`MATCH ()-[r:${label}]->() RETURN count(r)`);
      const count = typeof rows[0] === 'number' ? rows[0] : parseInt(String(rows[0]), 10) || 0;
      if (count > 0) counts[label] = count;
    } catch { /* edge type doesn't exist */ }
  }
  return counts;
}

// ── Sample checks ──────────────────────────────────────────────────

export async function runSampleChecks(): Promise<SampleCheck[]> {
  const checks: SampleCheck[] = [];

  // Check: Machine SGM-004 exists with oee property
  try {
    const rows = await cypherQuery(`MATCH (m:Machine {id: 'SGM-004'}) RETURN m.oee`);
    checks.push({
      description: 'Machine SGM-004 exists with OEE property',
      passed: rows.length > 0 && rows[0] !== null,
      detail: rows.length > 0 ? `OEE = ${rows[0]}` : 'Not found',
    });
  } catch (e: any) {
    checks.push({ description: 'Machine SGM-004 exists', passed: false, detail: e.message });
  }

  // Check: Machine has WORKS_ON edges
  try {
    const rows = await cypherQuery(`MATCH (m:Machine)-[:WORKS_ON]->(o:Order) RETURN count(o)`);
    const count = parseInt(String(rows[0]), 10) || 0;
    checks.push({
      description: 'Machines have WORKS_ON edges to Orders',
      passed: count > 0,
      detail: `${count} edges found`,
    });
  } catch (e: any) {
    checks.push({ description: 'WORKS_ON edges', passed: false, detail: e.message });
  }

  return checks;
}

// ── CESMII compliance ──────────────────────────────────────────────

export async function runCesmiiChecks(): Promise<CesmiiCheck[]> {
  const checks: CesmiiCheck[] = [];

  // Every Machine should have INSTANCE_OF → MachineType
  try {
    const total = await cypherQuery(`MATCH (m:Machine) RETURN count(m)`);
    const linked = await cypherQuery(`MATCH (m:Machine)-[:INSTANCE_OF]->(t:MachineType) RETURN count(m)`);
    const totalN = parseInt(String(total[0]), 10) || 0;
    const linkedN = parseInt(String(linked[0]), 10) || 0;
    checks.push({
      rule: 'Every Machine has INSTANCE_OF → MachineType',
      passed: totalN > 0 && linkedN === totalN,
      detail: `${linkedN}/${totalN} machines linked to type`,
    });
  } catch (e: any) {
    checks.push({ rule: 'INSTANCE_OF check', passed: false, detail: e.message });
  }

  // Equipment topology: Areas linked to Site
  try {
    const areas = await cypherQuery(`MATCH (a:Area) RETURN count(a)`);
    const linked = await cypherQuery(`MATCH (a:Area)-[:PART_OF]->(s:Site) RETURN count(a)`);
    const areasN = parseInt(String(areas[0]), 10) || 0;
    const linkedN = parseInt(String(linked[0]), 10) || 0;
    checks.push({
      rule: 'Every Area has PART_OF → Site',
      passed: areasN === 0 || linkedN === areasN,
      detail: areasN > 0 ? `${linkedN}/${areasN} areas linked` : 'No areas yet',
    });
  } catch (e: any) {
    checks.push({ rule: 'Equipment topology', passed: false, detail: e.message });
  }

  return checks;
}

// ── Full validation ────────────────────────────────────────────────

export async function runValidation(): Promise<ValidationReport> {
  const [nodeCounts, edgeCounts, sampleChecks, cesmiiCompliance] = await Promise.all([
    countNodesByType(),
    countEdgesByType(),
    runSampleChecks(),
    runCesmiiChecks(),
  ]);

  const totalChecks = sampleChecks.length + cesmiiCompliance.length;
  const passed = sampleChecks.filter(c => c.passed).length + cesmiiCompliance.filter(c => c.passed).length;
  const accuracy = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 0;

  const issues: string[] = [];
  for (const c of sampleChecks) if (!c.passed) issues.push(`SAMPLE: ${c.description} — ${c.detail}`);
  for (const c of cesmiiCompliance) if (!c.passed) issues.push(`CESMII: ${c.rule} — ${c.detail}`);

  return { nodeCounts, edgeCounts, sampleChecks, cesmiiCompliance, accuracy, issues };
}

// ── Format for Chat ────────────────────────────────────────────────

export function formatValidationReport(report: ValidationReport): string {
  const lines: string[] = [`## Validation Report (Accuracy: ${report.accuracy}%)\n`];

  lines.push('### Node Counts');
  for (const [label, count] of Object.entries(report.nodeCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${label}**: ${count}`);
  }

  lines.push('\n### Edge Counts');
  for (const [label, count] of Object.entries(report.edgeCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${label}**: ${count}`);
  }

  lines.push('\n### Sample Checks');
  for (const c of report.sampleChecks) {
    lines.push(`- ${c.passed ? 'PASS' : 'FAIL'}: ${c.description} — ${c.detail}`);
  }

  lines.push('\n### CESMII Compliance');
  for (const c of report.cesmiiCompliance) {
    lines.push(`- ${c.passed ? 'PASS' : 'FAIL'}: ${c.rule} — ${c.detail}`);
  }

  if (report.issues.length > 0) {
    lines.push(`\n### Issues (${report.issues.length})`);
    for (const issue of report.issues) lines.push(`- ${issue}`);
  }

  lines.push('\nFrage mich etwas ueber den Graph ("Was weisst du ueber SGM-004?") oder sage "fertig".');
  return lines.join('\n');
}

// ── Graph QA ───────────────────────────────────────────────────────

export async function answerGraphQuestion(question: string, schema: SchemaProposal): Promise<string> {
  const schemaDesc = schema.nodeTypes.map(n => `${n.label}(${n.properties.map(p => p.name).join(',')})`).join(', ');
  const edgeDesc = schema.edgeTypes.map(e => `(${e.fromType})-[${e.label}]->(${e.toType})`).join(', ');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a Cypher query expert for Apache AGE. Generate a single Cypher query to answer the user's question.
Graph schema — Nodes: ${schemaDesc}. Edges: ${edgeDesc}.
Return ONLY the Cypher query, nothing else. Use RETURN with explicit property access (e.g. n.id, n.name).`,
    },
    { role: 'user', content: question },
  ];

  const cypher = (await callLlm(messages, { maxTokens: 500 })).trim().replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

  try {
    const rows = await cypherQuery(cypher);
    const formatted = rows.slice(0, 10).map(r => typeof r === 'object' ? JSON.stringify(r) : String(r)).join('\n');
    return `**Query:** \`${cypher}\`\n\n**Result (${rows.length} rows):**\n${formatted || 'No results'}`;
  } catch (e: any) {
    return `**Query failed:** \`${cypher}\`\n**Error:** ${e.message}`;
  }
}
