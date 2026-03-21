import neo4j, { Driver, Session } from 'neo4j-driver';
import { Pool } from 'pg';
import { config } from './config';
import { logger } from './logger';

// ── Neo4j Driver (graph operations) ───────────────────────────────

let driver: Driver;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      config.neo4j.url,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
      { maxConnectionPoolSize: 10, connectionAcquisitionTimeout: 10_000 },
    );
  }
  return driver;
}

// ── PostgreSQL Pool (only for kg_builder_runs table — not graph) ──

export const kgPool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 3,
  idleTimeoutMillis: 30_000,
});

// ── Label Validation ───────────────────────────────────────────────

export function validateLabel(label: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(label)) {
    throw new Error(`Invalid Cypher label: ${label}`);
  }
  return label;
}

// ── Escaping ───────────────────────────────────────────────────────

export function escapeValue(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '')
    .substring(0, 500);
  return `'${s}'`;
}

export function escapeId(id: string): string {
  return String(id || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '')
    .substring(0, 200);
}

// ── Cypher Generators (standard Cypher — works with Neo4j) ────────

export function vertexCypher(label: string, id: string, properties: Record<string, any>): string {
  validateLabel(label);
  const safeId = escapeId(id);
  const propsStr = Object.entries({ id, ...properties })
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${escapeValue(v)}`)
    .join(', ');
  return `MERGE (n:${label} {id: '${safeId}'}) SET n = {${propsStr}} RETURN n`;
}

export function edgeCypher(
  fromLabel: string, fromId: string,
  edgeLabel: string,
  toLabel: string, toId: string,
  properties?: Record<string, any>,
): string {
  validateLabel(fromLabel);
  validateLabel(edgeLabel);
  validateLabel(toLabel);
  const safeFromId = escapeId(fromId);
  const safeToId = escapeId(toId);
  const propsStr = properties
    ? ` {${Object.entries(properties).filter(([_, v]) => v !== undefined).map(([k, v]) => `${k}: ${escapeValue(v)}`).join(', ')}}`
    : '';
  return `MATCH (a:${fromLabel} {id: '${safeFromId}'}) MATCH (b:${toLabel} {id: '${safeToId}'}) MERGE (a)-[r:${edgeLabel}]->(b) ${properties ? `SET r = ${propsStr.trim()}` : ''} RETURN r`;
}

// ── UNWIND Bulk Merge (fast path — 1 query per batch) ─────────────

export interface BulkNode {
  label: string;
  id: string;
  props: Record<string, any>;
}

export interface BulkEdge {
  fromLabel: string;
  fromId: string;
  edgeLabel: string;
  toLabel: string;
  toId: string;
}

/**
 * UNWIND-based bulk merge — groups by label, sends 1 Cypher per label per batch.
 * ~10-50x faster than individual MERGE statements.
 */
export async function bulkMergeNodes(nodes: BulkNode[]): Promise<{ success: number; failed: number }> {
  if (nodes.length === 0) return { success: 0, failed: 0 };

  // Group by label
  const byLabel = new Map<string, Array<{ id: string; props: Record<string, any> }>>();
  for (const n of nodes) {
    const group = byLabel.get(n.label) || [];
    group.push({ id: n.id, props: { id: n.id, ...n.props } });
    byLabel.set(n.label, group);
  }

  const session = getDriver().session({ database: config.neo4j.database });
  let success = 0;
  let failed = 0;

  try {
    for (const [label, items] of byLabel) {
      validateLabel(label);
      try {
        await session.executeWrite(async (tx) => {
          await tx.run(
            `UNWIND $batch AS row MERGE (n:${label} {id: row.id}) SET n += row.props`,
            { batch: items.map(i => ({ id: i.id, props: i.props })) },
          );
        });
        success += items.length;
      } catch (e: any) {
        logger.warn({ label, count: items.length, err: e.message?.substring(0, 100) }, 'Bulk merge failed');
        failed += items.length;
      }
    }
  } finally {
    await session.close();
  }

  return { success, failed };
}

/**
 * UNWIND-based bulk edge merge — groups by (fromLabel, edgeLabel, toLabel).
 */
export async function bulkMergeEdges(edges: BulkEdge[]): Promise<{ success: number; failed: number }> {
  if (edges.length === 0) return { success: 0, failed: 0 };

  // Group by (fromLabel, edgeLabel, toLabel)
  const key = (e: BulkEdge) => `${e.fromLabel}|${e.edgeLabel}|${e.toLabel}`;
  const byType = new Map<string, { fromLabel: string; edgeLabel: string; toLabel: string; pairs: Array<{ fromId: string; toId: string }> }>();
  for (const e of edges) {
    const k = key(e);
    if (!byType.has(k)) byType.set(k, { fromLabel: e.fromLabel, edgeLabel: e.edgeLabel, toLabel: e.toLabel, pairs: [] });
    byType.get(k)!.pairs.push({ fromId: e.fromId, toId: e.toId });
  }

  const session = getDriver().session({ database: config.neo4j.database });
  let success = 0;
  let failed = 0;

  try {
    for (const [, { fromLabel, edgeLabel, toLabel, pairs }] of byType) {
      validateLabel(fromLabel);
      validateLabel(edgeLabel);
      validateLabel(toLabel);
      try {
        await session.executeWrite(async (tx) => {
          await tx.run(
            `UNWIND $batch AS row
             MATCH (a:${fromLabel} {id: row.fromId})
             MATCH (b:${toLabel} {id: row.toId})
             MERGE (a)-[:${edgeLabel}]->(b)`,
            { batch: pairs },
          );
        });
        success += pairs.length;
      } catch (e: any) {
        logger.warn({ fromLabel, edgeLabel, toLabel, count: pairs.length, err: e.message?.substring(0, 100) }, 'Bulk edge merge failed');
        failed += pairs.length;
      }
    }
  } finally {
    await session.close();
  }

  return { success, failed };
}

// ── Legacy Batch Execution (fallback for raw Cypher strings) ──────

export async function batchCypher(queries: string[]): Promise<{ success: number; failed: number }> {
  if (queries.length === 0) return { success: 0, failed: 0 };

  const session = getDriver().session({ database: config.neo4j.database });
  let success = 0;
  let failed = 0;

  try {
    await session.executeWrite(async (tx) => {
      for (const cypher of queries) {
        try {
          await tx.run(cypher);
          success++;
        } catch (e: any) {
          failed++;
          if (failed <= 5) {
            logger.warn({ err: e.message?.substring(0, 100) }, 'Cypher failed');
          }
        }
      }
    });
  } catch (e: any) {
    logger.warn({ err: e.message?.substring(0, 100), batchSize: queries.length }, 'Batch tx failed, falling back');
    success = 0;
    failed = 0;
    for (const cypher of queries) {
      try { await session.run(cypher); success++; } catch { failed++; }
    }
  } finally {
    await session.close();
  }

  return { success, failed };
}

// ── Batch with throttling ──────────────────────────────────────────

export async function executeBatched(
  queries: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < queries.length; i += config.batchSize) {
    const batch = queries.slice(i, i + config.batchSize);
    const result = await batchCypher(batch);
    totalSuccess += result.success;
    totalFailed += result.failed;
    onProgress?.(Math.min(i + config.batchSize, queries.length), queries.length);
  }

  return { success: totalSuccess, failed: totalFailed };
}

/**
 * Bulk merge with progress callback — uses UNWIND fast path.
 */
export async function executeBulkNodes(
  nodes: BulkNode[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < nodes.length; i += config.batchSize) {
    const batch = nodes.slice(i, i + config.batchSize);
    const result = await bulkMergeNodes(batch);
    totalSuccess += result.success;
    totalFailed += result.failed;
    onProgress?.(Math.min(i + config.batchSize, nodes.length), nodes.length);
  }

  return { success: totalSuccess, failed: totalFailed };
}

export async function executeBulkEdges(
  edges: BulkEdge[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < edges.length; i += config.batchSize) {
    const batch = edges.slice(i, i + config.batchSize);
    const result = await bulkMergeEdges(batch);
    totalSuccess += result.success;
    totalFailed += result.failed;
    onProgress?.(Math.min(i + config.batchSize, edges.length), edges.length);
  }

  return { success: totalSuccess, failed: totalFailed };
}

// ── Graph Initialization (Neo4j) ──────────────────────────────────

export async function initializeGraph(): Promise<boolean> {
  try {
    const session = getDriver().session({ database: config.neo4j.database });
    try {
      // Verify connectivity
      await session.run('RETURN 1');

      // Create uniqueness constraint on node id (idempotent)
      await session.run('CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE').catch(() => {});

      // Create vector index for embeddings (Neo4j 5.11+)
      await session.run(`
        CREATE VECTOR INDEX node_embedding IF NOT EXISTS
        FOR (n:Node) ON (n.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: ${config.embedding.dim},
          \`vector.similarity_function\`: 'cosine'
        }}
      `).catch((e: any) => {
        logger.info({ err: e.message }, 'Vector index creation skipped (may already exist or Neo4j < 5.11)');
      });

      logger.info({ url: config.neo4j.url, database: config.neo4j.database }, 'Neo4j initialized');
      return true;
    } finally {
      await session.close();
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Neo4j not available');
    return false;
  }
}

// ── Query helper (Neo4j) ──────────────────────────────────────────

export async function cypherQuery(cypher: string, params?: Record<string, any>): Promise<any[]> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const result = await session.run(cypher, params);
    return result.records.map(record => {
      if (record.keys.length === 1) {
        return toPlainValue(record.get(0));
      }
      const obj: Record<string, any> = {};
      for (const key of record.keys) {
        obj[key as string] = toPlainValue(record.get(key));
      }
      return obj;
    });
  } finally {
    await session.close();
  }
}

// ── Shutdown ──────────────────────────────────────────────────────

export async function closeGraph(): Promise<void> {
  if (driver) {
    await driver.close();
    logger.info('Neo4j driver closed');
  }
}

// ── Neo4j value conversion helper ─────────────────────────────────

function toPlainValue(val: any): any {
  if (val === null || val === undefined) return val;
  // Neo4j Integer → JS number
  if (neo4j.isInt(val)) return val.toNumber();
  // Neo4j Node → plain object
  if (val.properties) return { ...toPlainProps(val.properties), _labels: val.labels };
  // Neo4j Relationship → plain object
  if (val.type && val.properties) return { ...toPlainProps(val.properties), _type: val.type };
  // Array
  if (Array.isArray(val)) return val.map(toPlainValue);
  return val;
}

function toPlainProps(props: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = neo4j.isInt(v) ? v.toNumber() : v;
  }
  return out;
}
