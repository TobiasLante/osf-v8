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
  idProp?: string; // Neo4j property to MERGE on (default: 'id')
  props: Record<string, any>;
}

export interface BulkEdge {
  fromLabel: string;
  fromId: string;
  fromIdProp?: string; // Neo4j property to match on (default: 'id')
  edgeLabel: string;
  toLabel: string;
  toId: string;
  toIdProp?: string;   // Neo4j property to match on (default: 'id')
  props?: Record<string, any>;
}

/**
 * UNWIND-based bulk merge — groups by label, sends 1 Cypher per label per batch.
 * ~10-50x faster than individual MERGE statements.
 */
export async function bulkMergeNodes(nodes: BulkNode[]): Promise<{ success: number; failed: number }> {
  if (nodes.length === 0) return { success: 0, failed: 0 };

  // Group by label+idProp (nodes of the same label always share the same idProp)
  const byLabel = new Map<string, { idProp: string; items: Array<{ id: string; props: Record<string, any> }> }>();
  for (const n of nodes) {
    const idProp = n.idProp || 'id';
    const entry = byLabel.get(n.label) || { idProp, items: [] };
    entry.items.push({ id: n.id, props: { [idProp]: n.id, ...n.props } });
    byLabel.set(n.label, entry);
  }

  const session = getDriver().session({ database: config.neo4j.database });
  let success = 0;
  let failed = 0;

  try {
    for (const [label, { idProp, items }] of byLabel) {
      validateLabel(label);
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idProp)) {
        logger.warn({ label, idProp }, 'Invalid idProp, skipping');
        failed += items.length;
        continue;
      }
      try {
        await session.executeWrite(async (tx) => {
          await tx.run(
            `UNWIND $batch AS row MERGE (n:${label} {${idProp}: row.id}) SET n += row.props`,
            { batch: items.map(i => ({ id: i.id, props: i.props })) },
          );
        });
        success += items.length;
      } catch (e: any) {
        // Constraint violation from parallel MERGE — retry items individually
        if (e.message?.includes('already exists')) {
          let retryOk = 0, retryFail = 0;
          for (const item of items) {
            try {
              await session.executeWrite(async (tx) => {
                await tx.run(
                  `MERGE (n:${label} {${idProp}: $id}) SET n += $props`,
                  { id: item.id, props: item.props },
                );
              });
              retryOk++;
            } catch { retryFail++; }
          }
          success += retryOk;
          failed += retryFail;
        } else {
          logger.warn({ label, idProp, count: items.length, err: e.message?.substring(0, 100) }, 'Bulk merge failed');
          failed += items.length;
        }
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

  // Group by (fromLabel, edgeLabel, toLabel, fromIdProp, toIdProp)
  const key = (e: BulkEdge) => `${e.fromLabel}|${e.edgeLabel}|${e.toLabel}|${e.fromIdProp || 'id'}|${e.toIdProp || 'id'}`;
  const byType = new Map<string, { fromLabel: string; edgeLabel: string; toLabel: string; fromIdProp: string; toIdProp: string; pairs: Array<{ fromId: string; toId: string; props?: Record<string, any> }> }>();
  for (const e of edges) {
    const k = key(e);
    if (!byType.has(k)) byType.set(k, { fromLabel: e.fromLabel, edgeLabel: e.edgeLabel, toLabel: e.toLabel, fromIdProp: e.fromIdProp || 'id', toIdProp: e.toIdProp || 'id', pairs: [] });
    byType.get(k)!.pairs.push({ fromId: e.fromId, toId: e.toId, ...(e.props ? { props: e.props } : {}) });
  }

  const session = getDriver().session({ database: config.neo4j.database });
  let success = 0;
  let failed = 0;

  try {
    for (const [, { fromLabel, edgeLabel, toLabel, fromIdProp, toIdProp, pairs }] of byType) {
      validateLabel(fromLabel);
      validateLabel(edgeLabel);
      validateLabel(toLabel);
      try {
        const hasProps = pairs.some(p => p.props);
        await session.executeWrite(async (tx) => {
          await tx.run(
            hasProps
              ? `UNWIND $batch AS row
                 MATCH (a:${fromLabel} {${fromIdProp}: row.fromId})
                 MATCH (b:${toLabel} {${toIdProp}: row.toId})
                 MERGE (a)-[r:${edgeLabel}]->(b)
                 SET r += row.props`
              : `UNWIND $batch AS row
                 MATCH (a:${fromLabel} {${fromIdProp}: row.fromId})
                 MATCH (b:${toLabel} {${toIdProp}: row.toId})
                 MERGE (a)-[:${edgeLabel}]->(b)`,
            { batch: pairs.map(p => ({ fromId: p.fromId, toId: p.toId, props: p.props || {} })) },
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
  const PARALLEL = 3;

  const batches: BulkNode[][] = [];
  for (let i = 0; i < nodes.length; i += config.batchSize) {
    batches.push(nodes.slice(i, i + config.batchSize));
  }

  for (let i = 0; i < batches.length; i += PARALLEL) {
    const chunk = batches.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(chunk.map(b => bulkMergeNodes(b)));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalSuccess += r.value.success;
        totalFailed += r.value.failed;
      } else {
        totalFailed += config.batchSize;
      }
    }
    onProgress?.(Math.min((i + PARALLEL) * config.batchSize, nodes.length), nodes.length);
  }

  return { success: totalSuccess, failed: totalFailed };
}

export async function executeBulkEdges(
  edges: BulkEdge[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;
  const PARALLEL = 3;

  const batches: BulkEdge[][] = [];
  for (let i = 0; i < edges.length; i += config.batchSize) {
    batches.push(edges.slice(i, i + config.batchSize));
  }

  for (let i = 0; i < batches.length; i += PARALLEL) {
    const chunk = batches.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(chunk.map(b => bulkMergeEdges(b)));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalSuccess += r.value.success;
        totalFailed += r.value.failed;
      } else {
        totalFailed += config.batchSize;
      }
    }
    onProgress?.(Math.min((i + PARALLEL) * config.batchSize, edges.length), edges.length);
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
