import { cypherQuery, batchCypher, validateLabel, escapeId, escapeValue } from './cypher-utils';
import { config } from './config';
import { logger } from './logger';

/**
 * Vector Store — Neo4j native vector index for KG node embeddings.
 * Uses cosine similarity via db.index.vector.queryNodes (Neo4j 5.11+).
 *
 * Embeddings are stored directly as a property on the :Node label.
 * The vector index is created in initializeGraph() (cypher-utils.ts).
 */

export interface NodeEmbeddingRow {
  node_id: string;
  node_label: string;
  text_content: string;
  similarity?: number;
}

/**
 * Initialize vector store — for Neo4j, the index is created in initializeGraph().
 * This function just verifies connectivity.
 */
export async function initVectorStore(): Promise<boolean> {
  try {
    await cypherQuery('RETURN 1');
    logger.info('Neo4j vector store ready (native vector index)');
    return true;
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Vector store not available');
    return false;
  }
}

/**
 * Upsert a single node embedding.
 * Stores the embedding directly on the node as a property.
 */
export async function upsertEmbedding(
  nodeId: string,
  nodeLabel: string,
  textContent: string,
  embedding: number[],
): Promise<void> {
  // MERGE a :Node with the specific label, store embedding + text
  validateLabel(nodeLabel);
  const cypher = `
    MERGE (n:Node:${nodeLabel} {id: '${escapeId(nodeId)}'})
    SET n.text_content = ${escapeValue(textContent.substring(0, 500))},
        n.embedding = ${JSON.stringify(embedding)},
        n.embedding_model = '${config.embedding.model}',
        n.embedded_at = datetime()
    RETURN n.id
  `;
  await batchCypher([cypher]);
}

/**
 * Batch upsert embeddings.
 */
export async function batchUpsertEmbeddings(
  items: Array<{ nodeId: string; nodeLabel: string; textContent: string; embedding: number[] }>,
): Promise<{ success: number; failed: number }> {
  const queries = items.map(item => {
    validateLabel(item.nodeLabel);
    return `
    MERGE (n:Node:${item.nodeLabel} {id: '${escapeId(item.nodeId)}'})
    SET n.text_content = ${escapeValue(item.textContent.substring(0, 500))},
        n.embedding = ${JSON.stringify(item.embedding)},
        n.embedding_model = '${config.embedding.model}',
        n.embedded_at = datetime()
    RETURN n.id
  `;
  });

  return batchCypher(queries);
}

/**
 * Semantic search: find k nearest nodes using Neo4j vector index.
 */
export async function semanticSearch(
  queryEmbedding: number[],
  limit = 10,
  minSimilarity = 0.3,
  labelFilter?: string,
): Promise<NodeEmbeddingRow[]> {
  // Use Neo4j's native vector search
  if (labelFilter) validateLabel(labelFilter);
  const cypher = `
    CALL db.index.vector.queryNodes('node_embedding', ${limit}, ${JSON.stringify(queryEmbedding)})
    YIELD node, score
    ${labelFilter ? `WHERE '${labelFilter}' IN labels(node)` : ''}
    RETURN node.id AS node_id,
           [l IN labels(node) WHERE l <> 'Node'][0] AS node_label,
           node.text_content AS text_content,
           score AS similarity
    ORDER BY score DESC
  `;

  try {
    const rows = await cypherQuery(cypher);
    return rows
      .map((r: any) => ({
        node_id: r.node_id,
        node_label: r.node_label || 'Node',
        text_content: r.text_content || '',
        similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(r.similarity),
      }))
      .filter(r => r.similarity >= minSimilarity);
  } catch (e: any) {
    // Fallback: vector index may not exist yet
    logger.warn({ err: e.message }, 'Vector search failed — index may not be ready');
    return [];
  }
}

/**
 * Get embedding count stats.
 */
export async function getEmbeddingStats(): Promise<{ total: number; byLabel: Record<string, number> }> {
  try {
    const totalRows = await cypherQuery('MATCH (n:Node) WHERE n.embedding IS NOT NULL RETURN count(n) AS cnt');
    const total = totalRows[0]?.cnt ?? totalRows[0] ?? 0;

    const byLabelRows = await cypherQuery(`
      MATCH (n:Node) WHERE n.embedding IS NOT NULL
      WITH [l IN labels(n) WHERE l <> 'Node'][0] AS label
      RETURN label, count(*) AS cnt ORDER BY cnt DESC
    `);

    const byLabel: Record<string, number> = {};
    for (const row of byLabelRows) {
      if (row.label) byLabel[row.label] = typeof row.cnt === 'number' ? row.cnt : parseInt(String(row.cnt), 10);
    }

    return { total: typeof total === 'number' ? total : parseInt(String(total), 10), byLabel };
  } catch {
    return { total: 0, byLabel: {} };
  }
}
