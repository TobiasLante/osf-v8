import { cypherQuery } from './cypher-utils';
import { callLlm, ChatMessage } from './llm-client';
import { SchemaProposal } from './schema-planner';
import { loadDomainConfig } from './domain-config';
import { logger } from './logger';
import { generateEmbedding } from './embedding-service';
import { semanticSearch } from './vector-store';

export interface ValidationReport {
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  sampleChecks: SampleCheck[];
  complianceChecks: ComplianceCheck[];
  accuracy: number;
  issues: string[];
}

interface SampleCheck {
  description: string;
  passed: boolean;
  detail: string;
}

interface ComplianceCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

// ── Count nodes/edges ──────────────────────────────────────────────

export async function countNodesByType(confirmedSchema?: SchemaProposal): Promise<Record<string, number>> {
  const domain = loadDomainConfig();
  const counts: Record<string, number> = {};

  // Build label set from domain expected types + confirmed schema types
  const labelSet = new Set<string>(domain.expectedNodeTypes);
  if (confirmedSchema) {
    for (const nt of confirmedSchema.nodeTypes) {
      labelSet.add(nt.label);
    }
  }

  try {
    for (const label of labelSet) {
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

export async function countEdgesByType(confirmedSchema?: SchemaProposal): Promise<Record<string, number>> {
  const domain = loadDomainConfig();
  const counts: Record<string, number> = {};

  // Build edge label set from domain expected types + confirmed schema types
  const edgeLabelSet = new Set<string>(domain.expectedEdgeTypes);
  if (confirmedSchema) {
    for (const et of confirmedSchema.edgeTypes) {
      edgeLabelSet.add(et.label);
    }
  }

  for (const label of edgeLabelSet) {
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
  const domain = loadDomainConfig();
  const checks: SampleCheck[] = [];

  if (!domain.sampleChecks || domain.sampleChecks.length === 0) {
    return checks;
  }

  for (const check of domain.sampleChecks) {
    try {
      if (check.type === 'node_min_count') {
        const rows = await cypherQuery(`MATCH (n:${check.label}) RETURN count(n)`);
        const count = typeof rows[0] === 'number' ? rows[0] : parseInt(String(rows[0]), 10) || 0;
        checks.push({
          description: `${check.label} node count >= ${check.min}`,
          passed: count >= (check.min || 0),
          detail: `${count} found`,
        });
      } else if (check.type === 'edge_exists') {
        const rows = await cypherQuery(`MATCH ()-[r:${check.label}]->() RETURN count(r)`);
        const count = typeof rows[0] === 'number' ? rows[0] : parseInt(String(rows[0]), 10) || 0;
        checks.push({
          description: `${check.label} edges exist`,
          passed: count > 0,
          detail: `${count} edges found`,
        });
      } else if (check.type === 'hierarchy') {
        const rows = await cypherQuery(`MATCH (c:${check.child})-[:${check.edge}]->(p:${check.parent}) RETURN count(c)`);
        const count = typeof rows[0] === 'number' ? rows[0] : parseInt(String(rows[0]), 10) || 0;
        checks.push({
          description: `${check.child} -[${check.edge}]-> ${check.parent} hierarchy exists`,
          passed: count > 0,
          detail: `${count} links found`,
        });
      }
    } catch (e: any) {
      checks.push({
        description: `Check for ${check.label || check.child || 'unknown'}`,
        passed: false,
        detail: e.message,
      });
    }
  }

  return checks;
}

// ── Compliance checks ────────────────────────────────────────────

export async function runComplianceChecks(): Promise<ComplianceCheck[]> {
  const domain = loadDomainConfig();
  const checks: ComplianceCheck[] = [];

  if (!domain.complianceChecks || domain.complianceChecks.length === 0) {
    return checks;
  }

  for (const rule of domain.complianceChecks) {
    // Check hierarchy-type compliance rules from sampleChecks
    const hierarchyCheck = (domain.sampleChecks || []).find(
      sc => sc.type === 'hierarchy' && rule.toLowerCase().includes(sc.child?.toLowerCase() || '') && rule.toLowerCase().includes(sc.parent?.toLowerCase() || '')
    );

    if (hierarchyCheck) {
      try {
        const total = await cypherQuery(`MATCH (c:${hierarchyCheck.child}) RETURN count(c)`);
        const linked = await cypherQuery(`MATCH (c:${hierarchyCheck.child})-[:${hierarchyCheck.edge}]->(p:${hierarchyCheck.parent}) RETURN count(c)`);
        const totalN = typeof total[0] === 'number' ? total[0] : parseInt(String(total[0]), 10) || 0;
        const linkedN = typeof linked[0] === 'number' ? linked[0] : parseInt(String(linked[0]), 10) || 0;
        checks.push({
          rule,
          passed: totalN === 0 || linkedN === totalN,
          detail: totalN > 0 ? `${linkedN}/${totalN} linked` : 'No entities yet',
        });
      } catch (e: any) {
        checks.push({ rule, passed: false, detail: e.message });
      }
    } else {
      // Informational — log the compliance rule as passed (advisory)
      checks.push({
        rule,
        passed: true,
        detail: 'Advisory rule — not automatically verified',
      });
    }
  }

  return checks;
}

// ── Full validation ────────────────────────────────────────────────

export async function runValidation(confirmedSchema?: SchemaProposal): Promise<ValidationReport> {
  const [nodeCounts, edgeCounts, sampleChecks, complianceChecks] = await Promise.all([
    countNodesByType(confirmedSchema),
    countEdgesByType(confirmedSchema),
    runSampleChecks(),
    runComplianceChecks(),
  ]);

  const totalChecks = sampleChecks.length + complianceChecks.length;
  const passed = sampleChecks.filter(c => c.passed).length + complianceChecks.filter(c => c.passed).length;
  const accuracy = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 0;

  const issues: string[] = [];
  for (const c of sampleChecks) if (!c.passed) issues.push(`SAMPLE: ${c.description} — ${c.detail}`);
  for (const c of complianceChecks) if (!c.passed) issues.push(`COMPLIANCE: ${c.rule} — ${c.detail}`);

  return { nodeCounts, edgeCounts, sampleChecks, complianceChecks, accuracy, issues };
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

  lines.push('\n### Compliance Checks');
  for (const c of report.complianceChecks) {
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

  // Semantic search boost: find relevant nodes via embeddings
  let semanticHint = '';
  try {
    const queryEmb = await generateEmbedding(question);
    const similar = await semanticSearch(queryEmb, 5, 0.4);
    if (similar.length > 0) {
      semanticHint = `\nSemantisch relevante Nodes: ${similar.map(s => `${s.node_label}:${s.node_id} (similarity: ${s.similarity?.toFixed(2)})`).join(', ')}`;
    }
  } catch {
    // Embedding unavailable — continue without semantic boost
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a Neo4j Cypher expert. Generate a single Cypher query to answer the user's question.
Graph schema — Nodes: ${schemaDesc}. Edges: ${edgeDesc}.${semanticHint}
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
