import { NodeTypeSpec } from '../shared/types';
import { TemplateNodeType } from '../shared/types';
import { vertexCypher, executeBatched } from '../shared/cypher-utils';
import { sampleMcpTool } from './tool-discovery';
import { logger } from '../shared/logger';
import { generateEmbeddings, nodeToText } from '../shared/embedding-service';
import { batchUpsertEmbeddings } from '../shared/vector-store';
import { config } from '../shared/config';

export interface DeterministicResult {
  extracted: number;
  committed: number;
  embeddingsStored: number;
}

/**
 * Deterministic extraction: JSON.parse → Schema-Map → Neo4j MERGE.
 * No LLM needed — uses template idProperty + property names directly.
 * Returns null if the tool response is not parseable JSON, signaling LLM fallback.
 */
export async function deterministicExtract(
  nodeType: NodeTypeSpec,
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<DeterministicResult | null> {
  onProgress(`Extracting ${nodeType.label} from ${nodeType.sourceTool} (deterministic)...`);

  // Call the MCP tool
  let rawData: string;
  try {
    rawData = await sampleMcpTool(nodeType.sourceTool, {}, authToken);
  } catch (e: any) {
    logger.warn({ tool: nodeType.sourceTool, err: e.message }, 'Tool call failed');
    return { extracted: 0, committed: 0, embeddingsStored: 0 };
  }

  // Try to parse as JSON
  let rows: any[];
  try {
    const parsed = JSON.parse(rawData);
    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (parsed.content && Array.isArray(parsed.content)) {
      // MCP tool response format: { content: [{ type: "text", text: "..." }] }
      const text = parsed.content[0]?.text || '[]';
      const inner = JSON.parse(text);
      rows = Array.isArray(inner) ? inner : [inner];
    } else {
      rows = [parsed];
    }
  } catch {
    // Not JSON — signal LLM fallback
    return null;
  }

  if (rows.length === 0) {
    return { extracted: 0, committed: 0, embeddingsStored: 0 };
  }

  // Map rows to Cypher MERGE queries
  const propNames = new Set(nodeType.properties.map(p => p.name));
  const queries: Array<{ id: string; props: Record<string, any>; cypher: string }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = String(row[nodeType.idProperty] || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // Pick only properties defined in the schema
    const props: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (propNames.has(k) && v !== null && v !== undefined) {
        props[k] = v;
      }
    }

    queries.push({
      id,
      props,
      cypher: vertexCypher(nodeType.label, id, props),
    });
  }

  onProgress(`${nodeType.label}: ${queries.length} entities parsed, writing to graph...`, {
    nodeType: nodeType.label, current: queries.length, total: queries.length,
  });

  // Execute batched
  const result = await executeBatched(queries.map(q => q.cypher));

  onProgress(`${nodeType.label}: ${queries.length} extracted, ${result.success} committed`, {
    nodeType: nodeType.label, current: queries.length, total: queries.length,
  });

  // Post-extraction: generate embeddings
  let embeddingsStored = 0;
  if (result.success > 0) {
    try {
      const textsForEmbed = queries.map(q => nodeToText(q.id, nodeType.label, q.props));
      const embedResults = await generateEmbeddings(textsForEmbed, 50);
      const items = embedResults
        .filter((_, idx) => idx < queries.length)
        .map((er, idx) => ({
          nodeId: queries[idx].id,
          nodeLabel: nodeType.label,
          textContent: er.text,
          embedding: er.embedding,
        }));
      const embResult = await batchUpsertEmbeddings(items);
      embeddingsStored = embResult.success;
      onProgress(`${nodeType.label}: ${embResult.success} embeddings stored`, {
        nodeType: nodeType.label, embeddings: embResult.success,
      });
    } catch (e: any) {
      logger.warn({ nodeType: nodeType.label, err: e.message }, 'Embedding generation failed (non-critical)');
    }
  }

  return {
    extracted: queries.length,
    committed: result.success,
    embeddingsStored,
  };
}
