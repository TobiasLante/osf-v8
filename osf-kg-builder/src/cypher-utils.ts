import { Pool } from 'pg';
import { config } from './config';
import { logger } from './logger';

// Dedicated pool for KG operations (separate from API connections)
export const kgPool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 5,
  idleTimeoutMillis: 30_000,
});

// ── Escaping ───────────────────────────────────────────────────────

export function escapeValue(v: any): string {
  if (v === null || v === undefined) return "''";
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

// ── Cypher Generators ──────────────────────────────────────────────

export function vertexCypher(label: string, id: string, properties: Record<string, any>): string {
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
  const safeFromId = escapeId(fromId);
  const safeToId = escapeId(toId);
  const propsStr = properties
    ? ` {${Object.entries(properties).filter(([_, v]) => v !== undefined).map(([k, v]) => `${k}: ${escapeValue(v)}`).join(', ')}}`
    : '';
  return `MATCH (a:${fromLabel} {id: '${safeFromId}'}) MATCH (b:${toLabel} {id: '${safeToId}'}) MERGE (a)-[r:${edgeLabel}]->(b) ${properties ? `SET r = ${propsStr.trim()}` : ''} RETURN r`;
}

// ── Batch Execution ────────────────────────────────────────────────

export async function batchCypher(queries: string[]): Promise<{ success: number; failed: number }> {
  if (queries.length === 0) return { success: 0, failed: 0 };

  const client = await kgPool.connect();
  let success = 0;
  let failed = 0;

  try {
    await client.query(`LOAD 'age'`);
    await client.query(`SET search_path = ag_catalog, "${config.db.schema}", public`);

    for (const cypher of queries) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await client.query(
            `SELECT * FROM cypher('${config.graph.name}', $$ ${cypher} $$) AS (result agtype)`
          );
          success++;
          break;
        } catch (e: any) {
          if (e.message?.includes('Entity failed to be updated') && attempt < 2) {
            await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
            continue;
          }
          failed++;
          if (failed <= 5) {
            logger.warn({ err: e.message?.substring(0, 100) }, 'Cypher failed');
          }
          break;
        }
      }
    }
  } finally {
    client.release();
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
    if (i + config.batchSize < queries.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return { success: totalSuccess, failed: totalFailed };
}

// ── Graph Initialization ───────────────────────────────────────────

export async function initializeGraph(): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('initializeGraph timed out after 10s')), 10_000)
  );

  try {
    return await Promise.race([initializeGraphInner(), timeout]);
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Apache AGE not available');
    return false;
  }
}

async function initializeGraphInner(): Promise<boolean> {
  const client = await kgPool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS age');
    await client.query(`LOAD 'age'`);
    await client.query(`SET search_path = ag_catalog, "$user", public`);

    const graphCheck = await client.query(
      `SELECT * FROM ag_catalog.ag_graph WHERE name = $1`, [config.graph.name]
    );

    if (graphCheck.rows.length === 0) {
      await client.query(`SELECT create_graph('${config.graph.name}')`);
      logger.info({ graph: config.graph.name }, 'Created graph');
    }

    logger.info('Apache AGE graph initialized');
    return true;
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Apache AGE init failed');
    return false;
  } finally {
    client.release();
  }
}

// ── Query helper ───────────────────────────────────────────────────

export async function cypherQuery(cypher: string): Promise<any[]> {
  const client = await kgPool.connect();
  try {
    await client.query(`LOAD 'age'`);
    await client.query(`SET search_path = ag_catalog, "${config.db.schema}", public`);
    const result = await client.query(
      `SELECT * FROM cypher('${config.graph.name}', $$ ${cypher} $$) AS (result agtype)`
    );
    return result.rows.map(r => {
      try { return JSON.parse(r.result); } catch { return r.result; }
    });
  } finally {
    client.release();
  }
}
