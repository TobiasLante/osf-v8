import { EdgeTypeSpec, NodeTypeSpec } from '../shared/types';
import { edgeCypher, executeBatched, cypherQuery, validateLabel } from '../shared/cypher-utils';
import { sampleMcpTool } from './tool-discovery';
import { logger } from '../shared/logger';

export interface ExtractedEdge {
  from: string;
  to: string;
  props?: Record<string, any>;
}

export interface BuildReport {
  edgeTypes: Record<string, { extracted: number; cypherSuccess: number; cypherFailed: number }>;
  totalEdges: number;
  totalSuccess: number;
  totalFailed: number;
}

async function getNodeIds(label: string): Promise<string[]> {
  try {
    validateLabel(label);
    const rows = await cypherQuery(`MATCH (n:${label}) RETURN n.id`);
    return rows.map(r => typeof r === 'string' ? r : r?.id || String(r)).filter(Boolean);
  } catch (e: any) {
    logger.warn({ label, err: e.message }, 'Failed to get node IDs');
    return [];
  }
}

/**
 * Deterministic FK-based edge extraction.
 * Parses the tool output JSON, finds the fromId (via nodeType.idProperty)
 * and the toId (via edgeType.fkProperty) in each row.
 * No LLM involved — 100% schema-driven.
 */
function extractEdgesDeterministic(
  rawData: string,
  fromIdProp: string,
  fkProperty: string,
  fromIds: Set<string>,
  toIds: Set<string>,
): ExtractedEdge[] {
  let rows: any[];
  try {
    const parsed = JSON.parse(rawData);
    rows = Array.isArray(parsed) ? parsed : parsed.rows || parsed.data || parsed.result || [];
    if (!Array.isArray(rows)) rows = [parsed];
  } catch {
    // Data might be wrapped in markdown code blocks or have prefix text
    const jsonMatch = rawData.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    try { rows = JSON.parse(jsonMatch[0]); } catch { return []; }
  }

  const edges: ExtractedEdge[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const fromVal = String(row[fromIdProp] ?? '');
    const toVal = String(row[fkProperty] ?? '');
    if (!fromVal || !toVal) continue;
    if (fromIds.has(fromVal) && toIds.has(toVal)) {
      edges.push({ from: fromVal, to: toVal });
    }
  }

  return edges;
}

export async function executeRelationshipBuilding(
  edgeTypes: EdgeTypeSpec[],
  nodeTypes: NodeTypeSpec[],
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<BuildReport> {
  const report: BuildReport = {
    edgeTypes: {},
    totalEdges: 0,
    totalSuccess: 0,
    totalFailed: 0,
  };

  // Build lookup: nodeLabel → idProperty
  const nodeIdMap = new Map<string, string>();
  for (const nt of nodeTypes) {
    nodeIdMap.set(nt.label, nt.idProperty);
  }

  for (const et of edgeTypes) {
    onProgress(`Building ${et.fromType} —[${et.label}]→ ${et.toType}...`);

    if (!et.fkProperty) {
      logger.warn({ edge: et.label }, 'Skipping edge — no fkProperty defined in schema');
      report.edgeTypes[et.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    const fromIdProp = nodeIdMap.get(et.fromType);
    if (!fromIdProp) {
      logger.warn({ edge: et.label, fromType: et.fromType }, 'Skipping edge — fromType not found in nodeTypes');
      report.edgeTypes[et.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    const fromIds = await getNodeIds(et.fromType);
    const toIds = await getNodeIds(et.toType);

    if (fromIds.length === 0 || toIds.length === 0) {
      logger.warn({ edge: et.label, fromCount: fromIds.length, toCount: toIds.length }, 'Skipping edge — missing nodes');
      report.edgeTypes[et.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    let rawData: string;
    try {
      rawData = await sampleMcpTool(et.sourceTool, {}, authToken);
    } catch (e: any) {
      logger.warn({ tool: et.sourceTool, err: e.message }, 'Tool call failed during edge building');
      report.edgeTypes[et.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    const fromSet = new Set(fromIds);
    const toSet = new Set(toIds);
    const edges = extractEdgesDeterministic(rawData, fromIdProp, et.fkProperty, fromSet, toSet);

    if (edges.length === 0) {
      logger.warn({ edge: et.label, fk: et.fkProperty, fromIdProp, dataLen: rawData.length }, 'No edges extracted — check FK property names in schema');
    }

    const queries = edges.map(e => edgeCypher(et.fromType, e.from, et.label, et.toType, e.to, e.props));
    const result = await executeBatched(queries);

    report.edgeTypes[et.label] = {
      extracted: edges.length,
      cypherSuccess: result.success,
      cypherFailed: result.failed,
    };
    report.totalEdges += edges.length;
    report.totalSuccess += result.success;
    report.totalFailed += result.failed;

    onProgress(`${et.label}: ${edges.length} edges, ${result.success} committed`, {
      edgeType: et.label, current: edges.length, total: edges.length,
    });
  }

  return report;
}
