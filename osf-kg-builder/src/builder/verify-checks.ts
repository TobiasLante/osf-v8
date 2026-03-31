import { cypherQuery, initializeGraph, closeGraph, validateLabel } from '../shared/cypher-utils';
import { initVectorStore, getEmbeddingStats, semanticSearch } from '../shared/vector-store';
import { generateEmbedding } from '../shared/embedding-service';
import { loadDomainConfig, loadSchemaTemplate } from '../shared/domain-config';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { SchemaTemplate } from '../shared/types';

// ── Types ──────────────────────────────────────────────────────────

export interface CheckResult {
  phase: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerifyReport {
  domain: string;
  timestamp: string;
  phases: Record<string, CheckResult[]>;
  summary: { total: number; passed: number; failed: number };
  allPassed: boolean;
}

export interface VerifyOptions {
  domain: string;
  withServer: boolean;
  serverUrl: string;
}

// ── Main Runner ───────────────────────────────────────────────────

export async function runAllChecks(opts: VerifyOptions): Promise<VerifyReport> {
  const report: VerifyReport = {
    domain: opts.domain,
    timestamp: new Date().toISOString(),
    phases: {},
    summary: { total: 0, passed: 0, failed: 0 },
    allPassed: true,
  };

  try {
    report.phases['graph_structure'] = await checkGraphStructure();
    report.phases['data_integrity'] = await checkDataIntegrity();
    report.phases['embeddings'] = await checkEmbeddings();
    report.phases['domain_compliance'] = await checkDomainCompliance();

    if (opts.withServer) {
      report.phases['mcp_server'] = await checkMcpServer(opts.serverUrl);
    }
  } finally {
    await closeGraph();
  }

  // Summarize
  for (const checks of Object.values(report.phases)) {
    for (const c of checks) {
      report.summary.total++;
      if (c.passed) report.summary.passed++;
      else { report.summary.failed++; report.allPassed = false; }
    }
  }

  return report;
}

// ── Phase 1: Graph Structure ──────────────────────────────────────

async function checkGraphStructure(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const phase = 'graph_structure';

  // Neo4j connectivity
  const graphOk = await initializeGraph();
  checks.push({ phase, name: 'neo4j_reachable', passed: graphOk, detail: graphOk ? 'Connected' : 'Neo4j not available' });
  if (!graphOk) return checks;

  // Load template
  const domain = loadDomainConfig();
  const template = loadSchemaTemplate(domain.domain);
  if (!template) {
    checks.push({ phase, name: 'template_loaded', passed: false, detail: `No template for domain: ${domain.domain}` });
    return checks;
  }
  checks.push({ phase, name: 'template_loaded', passed: true, detail: `${template.nodeTypes.length} node types, ${template.edgeTypes.length} edge types` });

  // Check each node label exists with count > 0
  for (const nt of template.nodeTypes) {
    try {
      validateLabel(nt.label);
      const rows = await cypherQuery(`MATCH (n:${nt.label}) RETURN count(n) AS cnt`);
      const count = rows[0]?.cnt ?? rows[0] ?? 0;
      const n = typeof count === 'number' ? count : parseInt(String(count), 10) || 0;
      checks.push({ phase, name: `node_${nt.label}`, passed: n > 0, detail: `${n} nodes` });
    } catch (e: any) {
      checks.push({ phase, name: `node_${nt.label}`, passed: false, detail: e.message });
    }
  }

  // Check each edge type exists
  for (const et of template.edgeTypes) {
    try {
      validateLabel(et.label);
      const rows = await cypherQuery(`MATCH ()-[r:${et.label}]->() RETURN count(r) AS cnt`);
      const count = rows[0]?.cnt ?? rows[0] ?? 0;
      const n = typeof count === 'number' ? count : parseInt(String(count), 10) || 0;
      checks.push({ phase, name: `edge_${et.label}`, passed: n > 0, detail: `${n} edges` });
    } catch (e: any) {
      checks.push({ phase, name: `edge_${et.label}`, passed: false, detail: e.message });
    }
  }

  return checks;
}

// ── Phase 2: Data Integrity ───────────────────────────────────────

async function checkDataIntegrity(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const phase = 'data_integrity';

  const domain = loadDomainConfig();
  const template = loadSchemaTemplate(domain.domain);
  if (!template) return checks;

  // Orphan nodes (nodes with zero relationships)
  try {
    const rows = await cypherQuery('MATCH (n) WHERE NOT (n)--() RETURN count(n) AS cnt');
    const orphans = rows[0]?.cnt ?? rows[0] ?? 0;
    const n = typeof orphans === 'number' ? orphans : parseInt(String(orphans), 10) || 0;
    checks.push({ phase, name: 'no_orphan_nodes', passed: n === 0, detail: `${n} orphan nodes` });
  } catch (e: any) {
    checks.push({ phase, name: 'no_orphan_nodes', passed: false, detail: e.message });
  }

  // ID uniqueness per label
  for (const nt of template.nodeTypes) {
    try {
      validateLabel(nt.label);
      const rows = await cypherQuery(`MATCH (n:${nt.label}) WITH n.${nt.idProperty} AS id, count(*) AS c WHERE c > 1 RETURN count(id) AS duplicates`);
      const dups = rows[0]?.duplicates ?? rows[0] ?? 0;
      const n = typeof dups === 'number' ? dups : parseInt(String(dups), 10) || 0;
      checks.push({ phase, name: `unique_id_${nt.label}`, passed: n === 0, detail: n === 0 ? 'All IDs unique' : `${n} duplicate IDs` });
    } catch (e: any) {
      checks.push({ phase, name: `unique_id_${nt.label}`, passed: false, detail: e.message });
    }
  }

  // Required properties not null
  for (const nt of template.nodeTypes) {
    const requiredProps = nt.properties.filter(p => p.required);
    for (const prop of requiredProps) {
      try {
        validateLabel(nt.label);
        const rows = await cypherQuery(`MATCH (n:${nt.label}) WHERE n.${prop.name} IS NULL RETURN count(n) AS cnt`);
        const nullCount = rows[0]?.cnt ?? rows[0] ?? 0;
        const n = typeof nullCount === 'number' ? nullCount : parseInt(String(nullCount), 10) || 0;
        checks.push({ phase, name: `required_${nt.label}_${prop.name}`, passed: n === 0, detail: n === 0 ? 'All set' : `${n} null values` });
      } catch (e: any) {
        checks.push({ phase, name: `required_${nt.label}_${prop.name}`, passed: false, detail: e.message });
      }
    }
  }

  return checks;
}

// ── Phase 3: Embeddings ───────────────────────────────────────────

async function checkEmbeddings(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const phase = 'embeddings';

  // Vector store connectivity
  const vectorOk = await initVectorStore();
  checks.push({ phase, name: 'vector_store_ready', passed: vectorOk, detail: vectorOk ? 'Connected' : 'Vector store not available' });
  if (!vectorOk) return checks;

  // Embedding stats
  try {
    const stats = await getEmbeddingStats();
    checks.push({ phase, name: 'embeddings_exist', passed: stats.total > 0, detail: `${stats.total} embeddings total` });

    // Coverage: compare embedded nodes to total nodes
    const totalRows = await cypherQuery('MATCH (n) RETURN count(n) AS cnt');
    const totalNodes = totalRows[0]?.cnt ?? totalRows[0] ?? 0;
    const total = typeof totalNodes === 'number' ? totalNodes : parseInt(String(totalNodes), 10) || 1;
    const coverage = total > 0 ? Math.round((stats.total / total) * 100) : 0;
    checks.push({ phase, name: 'embedding_coverage', passed: coverage >= 80, detail: `${coverage}% (${stats.total}/${total})` });
  } catch (e: any) {
    checks.push({ phase, name: 'embeddings_exist', passed: false, detail: e.message });
  }

  // Semantic search test
  try {
    const testQuery = 'production status';
    const embedding = await generateEmbedding(testQuery);

    // Dimension check
    checks.push({ phase, name: 'embedding_dimension', passed: embedding.length === config.embedding.dim, detail: `${embedding.length}d (expected ${config.embedding.dim}d)` });

    const results = await semanticSearch(embedding, 5, 0.1);
    checks.push({ phase, name: 'semantic_search_works', passed: results.length > 0, detail: `${results.length} results for "${testQuery}"` });
  } catch (e: any) {
    checks.push({ phase, name: 'semantic_search_works', passed: false, detail: e.message });
  }

  return checks;
}

// ── Phase 4: Domain Compliance ────────────────────────────────────

async function checkDomainCompliance(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const phase = 'domain_compliance';

  const domain = loadDomainConfig();
  const template = loadSchemaTemplate(domain.domain);
  if (!template) return checks;

  // Sample checks from template
  for (const sc of template.sampleChecks) {
    try {
      if (sc.type === 'node_min_count') {
        validateLabel(sc.label);
        const rows = await cypherQuery(`MATCH (n:${sc.label}) RETURN count(n) AS cnt`);
        const count = rows[0]?.cnt ?? rows[0] ?? 0;
        const n = typeof count === 'number' ? count : parseInt(String(count), 10) || 0;
        checks.push({ phase, name: `sample_${sc.label}_min_${sc.min}`, passed: n >= (sc.min || 0), detail: `${n} found` });
      } else if (sc.type === 'edge_exists') {
        validateLabel(sc.label);
        const rows = await cypherQuery(`MATCH ()-[r:${sc.label}]->() RETURN count(r) AS cnt`);
        const count = rows[0]?.cnt ?? rows[0] ?? 0;
        const n = typeof count === 'number' ? count : parseInt(String(count), 10) || 0;
        checks.push({ phase, name: `sample_edge_${sc.label}`, passed: n > 0, detail: `${n} edges` });
      } else if (sc.type === 'hierarchy') {
        validateLabel(sc.child!);
        validateLabel(sc.edge!);
        validateLabel(sc.parent!);
        const rows = await cypherQuery(`MATCH (c:${sc.child})-[:${sc.edge}]->(p:${sc.parent}) RETURN count(c) AS cnt`);
        const count = rows[0]?.cnt ?? rows[0] ?? 0;
        const n = typeof count === 'number' ? count : parseInt(String(count), 10) || 0;
        checks.push({ phase, name: `sample_hierarchy_${sc.child}_${sc.parent}`, passed: n > 0, detail: `${n} links` });
      }
    } catch (e: any) {
      checks.push({ phase, name: `sample_${sc.label || sc.child}`, passed: false, detail: e.message });
    }
  }

  // Compliance checks from template (Cypher-based)
  for (const cc of template.complianceChecks) {
    // Write guard: block dangerous keywords in compliance check Cypher
    if (/\b(CALL|LOAD|FOREACH|REMOVE|CREATE|MERGE|DELETE|DETACH|DROP|ALTER)\b/i.test(cc.cypher)) {
      checks.push({ phase, name: `compliance_${cc.name.substring(0, 40).replace(/\s+/g, '_')}`, passed: false, detail: 'Blocked: compliance Cypher contains write keyword' });
      continue;
    }
    try {
      const rows = await cypherQuery(cc.cypher);
      const violations = rows[0]?.violations ?? rows[0] ?? 0;
      const n = typeof violations === 'number' ? violations : parseInt(String(violations), 10) || 0;
      const passed = n === 0;
      checks.push({
        phase,
        name: `compliance_${cc.name.substring(0, 40).replace(/\s+/g, '_')}`,
        passed: cc.severity === 'warning' ? true : passed,  // warnings always pass
        detail: n === 0 ? 'No violations' : `${n} violations (${cc.severity})`,
      });
    } catch (e: any) {
      checks.push({ phase, name: `compliance_${cc.name.substring(0, 40).replace(/\s+/g, '_')}`, passed: false, detail: e.message });
    }
  }

  // Domain-specific tools defined
  if (template.tools && template.tools.length > 0) {
    checks.push({ phase, name: 'domain_tools_defined', passed: true, detail: `${template.tools.length} tools` });
  }

  return checks;
}

// ── Phase 5: MCP Server (optional) ────────────────────────────────

async function checkMcpServer(serverUrl: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const phase = 'mcp_server';

  // Health check
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json() as any;
    checks.push({ phase, name: 'health_endpoint', passed: data.status === 'ok', detail: JSON.stringify(data) });
  } catch (e: any) {
    checks.push({ phase, name: 'health_endpoint', passed: false, detail: e.message });
    return checks; // Server not reachable, skip remaining
  }

  // tools/list
  try {
    const res = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as any;
    const tools = data.result?.tools || [];
    checks.push({ phase, name: 'tools_list', passed: tools.length >= 8, detail: `${tools.length} tools` });
  } catch (e: any) {
    checks.push({ phase, name: 'tools_list', passed: false, detail: e.message });
  }

  // tools/call kg_schema
  try {
    const res = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kg_schema', arguments: {} } }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json() as any;
    const content = data.result?.content;
    const hasContent = Array.isArray(content) && content.length > 0 && content[0].text;
    checks.push({ phase, name: 'tool_call_kg_schema', passed: !!hasContent, detail: hasContent ? 'Schema returned' : 'No content' });
  } catch (e: any) {
    checks.push({ phase, name: 'tool_call_kg_schema', passed: false, detail: e.message });
  }

  return checks;
}

// ── Report Formatter ──────────────────────────────────────────────

export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [
    `\n== Verify Report: ${report.domain} ==`,
    `Timestamp: ${report.timestamp}`,
    '',
  ];

  for (const [phaseName, checks] of Object.entries(report.phases)) {
    const passed = checks.filter(c => c.passed).length;
    lines.push(`--- ${phaseName} (${passed}/${checks.length}) ---`);
    for (const c of checks) {
      lines.push(`  ${c.passed ? 'PASS' : 'FAIL'}: ${c.name} — ${c.detail}`);
    }
    lines.push('');
  }

  lines.push(`== Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed ==`);
  lines.push(report.allPassed ? '== ALL CHECKS PASSED ==' : '== SOME CHECKS FAILED ==');
  lines.push('');

  return lines.join('\n');
}
