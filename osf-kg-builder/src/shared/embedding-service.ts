import { config } from './config';
import { logger } from './logger';

/**
 * Embedding Service — generates vector embeddings via llama.cpp
 * OpenAI-compatible /v1/embeddings endpoint.
 */

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

/**
 * Generate embeddings for one or more texts.
 * Batches up to `batchSize` texts per API call.
 */
export async function generateEmbeddings(
  texts: string[],
  batchSize = 50,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await callEmbeddingAPI(batch);
    for (let j = 0; j < batch.length; j++) {
      if (j < embeddings.length) {
        results.push({ text: batch[j], embedding: validateDimension(embeddings[j]) });
      }
    }
  }

  return results;
}

/**
 * Generate a single embedding (convenience wrapper).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const results = await callEmbeddingAPI([text]);
  return validateDimension(results[0]);
}

/**
 * Validate that an embedding has the expected dimension.
 */
function validateDimension(embedding: number[]): number[] {
  const expected = config.embedding.dim;
  if (!embedding || embedding.length !== expected) {
    throw new Error(`Embedding dimension mismatch: got ${embedding?.length ?? 0}, expected ${expected}`);
  }
  return embedding;
}

/**
 * Call llama.cpp OpenAI-compatible /v1/embeddings endpoint.
 */
async function callEmbeddingAPI(texts: string[]): Promise<number[][]> {
  const url = config.embedding.url;
  const model = config.embedding.model;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${url}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Embedding HTTP ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json() as any;

      // OpenAI-compatible response: { data: [{ embedding: number[], index: number }] }
      if (data.data && Array.isArray(data.data)) {
        // Sort by index to maintain input order
        const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
        return sorted.map((d: any) => d.embedding);
      }

      throw new Error('Unexpected embedding response format');
    } catch (e: any) {
      if (e.message?.includes('Unexpected embedding')) throw e;
      logger.warn({ attempt, err: e.message }, 'Embedding API call failed');
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Embedding API exhausted retries');
}

/**
 * Build a text representation of a KG node for embedding.
 */
export function nodeToText(nodeId: string, label: string, props: Record<string, any>): string {
  const parts = [`${label}: ${nodeId}`];
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && value !== undefined && key !== 'id') {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(' | ');
}
