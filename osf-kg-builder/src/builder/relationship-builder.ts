import { callLlmJson, ChatMessage } from '../shared/llm-client';
import { EdgeTypeSpec } from '../shared/types';
import { edgeCypher, executeBatched, cypherQuery, validateLabel } from '../shared/cypher-utils';
import { sampleMcpTool } from './tool-discovery';
import { loadDomainConfig } from '../shared/domain-config';
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

async function extractEdgesFromData(
  edgeType: EdgeTypeSpec,
  data: string,
  fromIds: string[],
  toIds: string[],
): Promise<ExtractedEdge[]> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a data extraction specialist. Extract relationships between ${loadDomainConfig().systemPromptContext} entities. Output ONLY valid JSON.`,
    },
    {
      role: 'user',
      content: `Extract all "${edgeType.label}" relationships from this data.

Edge: ${edgeType.fromType} —[${edgeType.label}]→ ${edgeType.toType}
${edgeType.properties?.length ? `Edge properties: ${edgeType.properties.map(p => p.name).join(', ')}` : ''}

Mapping hint: ${edgeType.sourceMapping}

Known ${edgeType.fromType} IDs (first 50): ${fromIds.slice(0, 50).join(', ')}
Known ${edgeType.toType} IDs (first 50): ${toIds.slice(0, 50).join(', ')}

DATA:
${data}

RESPONSE FORMAT: Pure JSON.
{"edges": [{"from": "source-id", "to": "target-id"${edgeType.properties?.length ? ', "props": {"key": "value"}' : ''}}]}

Rules:
- ONLY use IDs that exist in the known ID lists above
- Do NOT invent or hallucinate relationships
- Extract only relationships supported by the data`,
    },
  ];

  const result = await callLlmJson<{ edges: ExtractedEdge[] }>(messages);
  return (result.edges || []).filter(e => e.from && e.to);
}

export async function executeRelationshipBuilding(
  edgeTypes: EdgeTypeSpec[],
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<BuildReport> {
  const report: BuildReport = {
    edgeTypes: {},
    totalEdges: 0,
    totalSuccess: 0,
    totalFailed: 0,
  };

  for (const et of edgeTypes) {
    onProgress(`Building ${et.fromType} —[${et.label}]→ ${et.toType}...`);

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

    const dataStr = rawData.substring(0, 8000);
    let edges: ExtractedEdge[];
    try {
      edges = await extractEdgesFromData(et, dataStr, fromIds, toIds);
    } catch (e: any) {
      logger.warn({ edge: et.label, err: e.message }, 'Edge extraction failed');
      report.edgeTypes[et.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    const fromSet = new Set(fromIds);
    const toSet = new Set(toIds);
    const valid = edges.filter(e => fromSet.has(e.from) && toSet.has(e.to));
    const dropped = edges.length - valid.length;
    if (dropped > 0) {
      logger.warn({ edge: et.label, dropped }, 'Dropped edges with unknown endpoints');
    }

    const queries = valid.map(e => edgeCypher(et.fromType, e.from, et.label, et.toType, e.to, e.props));
    const result = await executeBatched(queries);

    report.edgeTypes[et.label] = {
      extracted: valid.length,
      cypherSuccess: result.success,
      cypherFailed: result.failed,
    };
    report.totalEdges += valid.length;
    report.totalSuccess += result.success;
    report.totalFailed += result.failed;

    onProgress(`${et.label}: ${valid.length} edges, ${result.success} committed`, {
      edgeType: et.label, current: valid.length, total: valid.length,
    });
  }

  return report;
}
