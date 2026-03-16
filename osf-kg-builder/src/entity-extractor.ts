import { callLlmJson, ChatMessage } from './llm-client';
import { NodeTypeSpec } from './schema-planner';
import { vertexCypher, executeBatched } from './cypher-utils';
import { sampleMcpTool } from './tool-discovery';
import { loadDomainConfig } from './domain-config';
import { config } from './config';
import { logger } from './logger';

export interface ExtractedNode {
  id: string;
  props: Record<string, any>;
}

export interface ExtractionReport {
  nodeTypes: Record<string, { extracted: number; cypherSuccess: number; cypherFailed: number }>;
  totalNodes: number;
  totalSuccess: number;
  totalFailed: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function extractNodesFromChunk(
  nodeType: NodeTypeSpec,
  dataChunk: string,
  chunkIndex: number,
): Promise<ExtractedNode[]> {
  const propList = nodeType.properties.map(p => `${p.name} (${p.type}): ${p.description}`).join('\n    ');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a data extraction specialist. Extract structured entities from ${loadDomainConfig().systemPromptContext} data. Output ONLY valid JSON.`,
    },
    {
      role: 'user',
      content: `Extract all "${nodeType.label}" entities from this data.

Schema:
  Label: ${nodeType.label}
  ID property: ${nodeType.idProperty}
  Properties:
    ${propList}

Mapping hint: ${nodeType.sourceMapping}

DATA (chunk ${chunkIndex + 1}):
${dataChunk}

RESPONSE FORMAT: Pure JSON.
{"nodes": [{"id": "entity-id-here", "props": {"name": "value", "oee": 85.3}}]}

Rules:
- Only extract entities that actually exist in the data
- Use the exact ID from the data (${nodeType.idProperty} field)
- Only include properties that have actual values in the data
- Do NOT invent or hallucinate any data`,
    },
  ];

  const result = await callLlmJson<{ nodes: ExtractedNode[] }>(messages);
  return (result.nodes || []).filter(n => n.id);
}

export async function executeNodeExtraction(
  nodeTypes: NodeTypeSpec[],
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<ExtractionReport> {
  const report: ExtractionReport = {
    nodeTypes: {},
    totalNodes: 0,
    totalSuccess: 0,
    totalFailed: 0,
  };

  for (const nt of nodeTypes) {
    onProgress(`Extracting ${nt.label} from ${nt.sourceTool}...`);

    // Call the MCP tool
    let rawData: string;
    try {
      rawData = await sampleMcpTool(nt.sourceTool, {}, authToken);
    } catch (e: any) {
      logger.warn({ tool: nt.sourceTool, err: e.message }, 'Tool call failed during extraction');
      report.nodeTypes[nt.label] = { extracted: 0, cypherSuccess: 0, cypherFailed: 0 };
      continue;
    }

    // Parse rows for chunking
    let rows: any[];
    try {
      const parsed = JSON.parse(rawData);
      rows = Array.isArray(parsed) ? parsed : (parsed.content ? JSON.parse(parsed.content[0]?.text || '[]') : [parsed]);
    } catch {
      // If not JSON, treat as single text block
      rows = [rawData];
    }

    // Chunk and extract
    const allNodes: ExtractedNode[] = [];
    const chunks = chunkArray(rows, config.chunkSize);

    for (let i = 0; i < chunks.length; i++) {
      const chunkStr = JSON.stringify(chunks[i]).substring(0, 8000);
      try {
        const nodes = await extractNodesFromChunk(nt, chunkStr, i);
        allNodes.push(...nodes);
        onProgress(`${nt.label}: chunk ${i + 1}/${chunks.length} → ${nodes.length} entities`, {
          nodeType: nt.label, current: i + 1, total: chunks.length,
        });
      } catch (e: any) {
        logger.warn({ nodeType: nt.label, chunk: i, err: e.message }, 'Chunk extraction failed');
      }
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    const unique = allNodes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    // Generate and execute Cypher
    const queries = unique.map(n => vertexCypher(nt.label, n.id, n.props));
    const result = await executeBatched(queries);

    report.nodeTypes[nt.label] = {
      extracted: unique.length,
      cypherSuccess: result.success,
      cypherFailed: result.failed,
    };
    report.totalNodes += unique.length;
    report.totalSuccess += result.success;
    report.totalFailed += result.failed;

    onProgress(`${nt.label}: ${unique.length} nodes extracted, ${result.success} committed`, {
      nodeType: nt.label, current: unique.length, total: unique.length,
    });
  }

  return report;
}
