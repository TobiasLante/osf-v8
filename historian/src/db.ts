// Historian v2 — Database: schema, COPY protocol, table templates, retention
// Handles category_routes, retention_policies, TimescaleDB continuous aggregates

import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';

const pool = new pg.Pool({
  host: process.env.HISTORIAN_DB_HOST || process.env.FACTORY_DB_HOST || 'localhost',
  port: parseInt(process.env.HISTORIAN_DB_PORT || process.env.FACTORY_DB_PORT || '5432'),
  database: process.env.HISTORIAN_DB_NAME || 'bigdata_homelab',
  user: process.env.HISTORIAN_DB_USER || process.env.FACTORY_DB_USER || 'admin',
  password: process.env.HISTORIAN_DB_PASSWORD || process.env.FACTORY_DB_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
});

// ─── Schema ───────────────────────────────────────────────────────────────────

const HISTORIAN_SCHEMA = 'historian';

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${HISTORIAN_SCHEMA}`);

    // TimescaleDB extension (graceful fallback)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE');
      console.log('[db] TimescaleDB extension ready');
    } catch (err: any) {
      console.log(`[db] TimescaleDB not available: ${err.message}`);
    }

    // Legacy table (keep for existing MCP tools)
    await client.query(`
      CREATE TABLE IF NOT EXISTS uns_history (
        ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        machine     TEXT NOT NULL,
        category    TEXT NOT NULL,
        variable    TEXT NOT NULL,
        value       DOUBLE PRECISION,
        value_text  TEXT,
        unit        TEXT,
        work_order  TEXT,
        tool_id     TEXT,
        topic       TEXT NOT NULL
      )
    `);

    // Try hypertable on legacy table
    try {
      await client.query("SELECT create_hypertable('uns_history', 'ts', if_not_exists => true)");
    } catch {}

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_uns_hist_machine_ts ON uns_history(machine, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_uns_hist_variable_ts ON uns_history(variable, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_uns_hist_topic_ts ON uns_history(topic, ts DESC);
    `);

    // Category routes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${HISTORIAN_SCHEMA}.category_routes (
        id            SERIAL PRIMARY KEY,
        category      TEXT NOT NULL UNIQUE,
        target_table  TEXT NOT NULL,
        flush_interval_s INTEGER NOT NULL DEFAULT 5,
        enabled       BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Retention policies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${HISTORIAN_SCHEMA}.retention_policies (
        target_table        TEXT PRIMARY KEY,
        retention_days      INTEGER NOT NULL DEFAULT 30,
        downsampling_interval TEXT,  -- '1 minute', '5 minutes', '1 hour', NULL=disabled
        downsampling_retention_days INTEGER,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Dead letter table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${HISTORIAN_SCHEMA}.dead_letters (
        id          SERIAL PRIMARY KEY,
        target_table TEXT NOT NULL,
        row_count   INTEGER NOT NULL,
        error       TEXT NOT NULL,
        sample_data JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Topic profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${HISTORIAN_SCHEMA}.topic_profiles (
        id               SERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        prefix           TEXT NOT NULL UNIQUE,
        subscription     TEXT NOT NULL,
        seg_machine      INT,
        seg_work_order   INT,
        seg_tool_id      INT,
        seg_category     INT,
        seg_variable_start INT NOT NULL,
        null_marker      TEXT DEFAULT '---',
        is_builtin       BOOLEAN DEFAULT false,
        enabled          BOOLEAN DEFAULT true,
        priority         INT DEFAULT 0,
        example_topic    TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed default routes + profiles
    await seedDefaultRoutes(client);
    await seedDefaultProfiles(client);

    console.log('[db] Schema initialized (v2)');
  } finally {
    client.release();
  }
}

// ─── Default Routes ───────────────────────────────────────────────────────────

interface DefaultRoute {
  category: string;
  target_table: string;
  flush_interval_s: number;
  retention_days: number;
}

const DEFAULT_ROUTES: DefaultRoute[] = [
  { category: 'BDE', target_table: 'bde', flush_interval_s: 5, retention_days: 90 },
  { category: 'ProcessData', target_table: 'process_data', flush_interval_s: 1, retention_days: 30 },
  { category: 'Energy', target_table: 'energy', flush_interval_s: 5, retention_days: 365 },
  { category: 'Quality', target_table: 'quality', flush_interval_s: 5, retention_days: 180 },
  { category: '*', target_table: 'uns_raw', flush_interval_s: 10, retention_days: 14 },
];

async function seedDefaultRoutes(client: pg.PoolClient): Promise<void> {
  for (const r of DEFAULT_ROUTES) {
    // Insert route if not exists
    await client.query(`
      INSERT INTO ${HISTORIAN_SCHEMA}.category_routes (category, target_table, flush_interval_s)
      VALUES ($1, $2, $3)
      ON CONFLICT (category) DO NOTHING
    `, [r.category, r.target_table, r.flush_interval_s]);

    // Insert retention if not exists
    await client.query(`
      INSERT INTO ${HISTORIAN_SCHEMA}.retention_policies (target_table, retention_days)
      VALUES ($1, $2)
      ON CONFLICT (target_table) DO NOTHING
    `, [r.target_table, r.retention_days]);

    // Ensure target table exists
    await ensureTable(client, r.target_table);
  }
}

// ─── Table Template ───────────────────────────────────────────────────────────

export async function ensureTable(clientOrPool: pg.PoolClient | pg.Pool, tableName: string): Promise<void> {
  // Sanitize table name: only alphanumeric + underscore
  const safe = tableName.replace(/[^a-z0-9_]/gi, '');
  if (safe !== tableName) throw new Error(`Invalid table name: ${tableName}`);

  const fullName = `${HISTORIAN_SCHEMA}.${safe}`;

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ${fullName} (
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      machine     TEXT NOT NULL,
      variable    TEXT NOT NULL,
      value       DOUBLE PRECISION,
      value_text  TEXT,
      unit        TEXT,
      work_order  TEXT,
      tool_id     TEXT
    )
  `);

  // Try hypertable
  try {
    await clientOrPool.query(`SELECT create_hypertable('${fullName}', 'ts', if_not_exists => true)`);
  } catch {}

  // Indexes
  await clientOrPool.query(`
    CREATE INDEX IF NOT EXISTS idx_${safe}_machine_ts ON ${fullName}(machine, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_${safe}_variable_ts ON ${fullName}(variable, ts DESC);
  `);
}

// ─── COPY Protocol Insert ─────────────────────────────────────────────────────

export interface HistoryRow {
  ts?: string;
  machine: string;
  category: string;
  variable: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  work_order: string | null;
  tool_id: string | null;
  topic: string;
}

export interface TableRow {
  ts?: string;
  machine: string;
  variable: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  work_order: string | null;
  tool_id: string | null;
}

/**
 * COPY-based batch insert for routed tables (historian schema).
 * 10-50x faster than multi-row INSERT.
 */
export async function copyInsert(tableName: string, rows: TableRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const safe = tableName.replace(/[^a-z0-9_]/gi, '');
  const fullName = `${HISTORIAN_SCHEMA}.${safe}`;

  const client = await pool.connect();
  try {
    const stream = client.query(
      copyFrom(`COPY ${fullName} (ts, machine, variable, value, value_text, unit, work_order, tool_id) FROM STDIN WITH (FORMAT csv, NULL '\\N')`)
    );

    const csvLines: string[] = [];
    for (const r of rows) {
      const ts = r.ts || new Date().toISOString();
      csvLines.push([
        ts,
        escapeCsv(r.machine),
        escapeCsv(r.variable),
        r.value !== null && r.value !== undefined ? String(r.value) : '\\N',
        r.value_text !== null && r.value_text !== undefined ? escapeCsv(r.value_text) : '\\N',
        r.unit !== null && r.unit !== undefined ? escapeCsv(r.unit) : '\\N',
        r.work_order !== null && r.work_order !== undefined ? escapeCsv(r.work_order) : '\\N',
        r.tool_id !== null && r.tool_id !== undefined ? escapeCsv(r.tool_id) : '\\N',
      ].join(','));
    }

    const readable = Readable.from(csvLines.join('\n') + '\n');

    await new Promise<void>((resolve, reject) => {
      readable.pipe(stream);
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return rows.length;
  } finally {
    client.release();
  }
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Legacy batch INSERT for uns_history (keeps MCP tools working).
 */
export async function batchInsert(rows: HistoryRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of rows) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(r.machine, r.category, r.variable, r.value, r.value_text, r.unit, r.work_order, r.tool_id, r.topic);
  }

  const sql = `INSERT INTO uns_history (machine, category, variable, value, value_text, unit, work_order, tool_id, topic) VALUES ${placeholders.join(', ')}`;
  const result = await pool.query(sql, values);
  return result.rowCount || 0;
}

// ─── Category Routes ──────────────────────────────────────────────────────────

export interface CategoryRoute {
  id: number;
  category: string;
  target_table: string;
  flush_interval_s: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function getRoutes(): Promise<CategoryRoute[]> {
  const result = await pool.query(
    `SELECT * FROM ${HISTORIAN_SCHEMA}.category_routes ORDER BY category`
  );
  return result.rows;
}

export async function createRoute(category: string, targetTable: string, flushIntervalS: number): Promise<CategoryRoute> {
  await ensureTable(pool, targetTable);
  const result = await pool.query(
    `INSERT INTO ${HISTORIAN_SCHEMA}.category_routes (category, target_table, flush_interval_s)
     VALUES ($1, $2, $3) RETURNING *`,
    [category, targetTable, flushIntervalS]
  );
  // Also create default retention
  await pool.query(
    `INSERT INTO ${HISTORIAN_SCHEMA}.retention_policies (target_table, retention_days)
     VALUES ($1, 30) ON CONFLICT (target_table) DO NOTHING`,
    [targetTable]
  );
  return result.rows[0];
}

export async function updateRoute(id: number, updates: Partial<Pick<CategoryRoute, 'target_table' | 'flush_interval_s' | 'enabled'>>): Promise<CategoryRoute | null> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.target_table !== undefined) {
    await ensureTable(pool, updates.target_table);
    sets.push(`target_table = $${idx++}`);
    values.push(updates.target_table);
  }
  if (updates.flush_interval_s !== undefined) {
    sets.push(`flush_interval_s = $${idx++}`);
    values.push(updates.flush_interval_s);
  }
  if (updates.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(updates.enabled);
  }
  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE ${HISTORIAN_SCHEMA}.category_routes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteRoute(id: number): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM ${HISTORIAN_SCHEMA}.category_routes WHERE id = $1`,
    [id]
  );
  return (result.rowCount || 0) > 0;
}

// ─── Retention Policies ───────────────────────────────────────────────────────

export interface RetentionPolicy {
  target_table: string;
  retention_days: number;
  downsampling_interval: string | null;
  downsampling_retention_days: number | null;
  updated_at: string;
}

export async function getRetentionPolicies(): Promise<RetentionPolicy[]> {
  const result = await pool.query(
    `SELECT * FROM ${HISTORIAN_SCHEMA}.retention_policies ORDER BY target_table`
  );
  return result.rows;
}

export async function setRetentionPolicy(
  targetTable: string,
  retentionDays: number,
  downsamplingInterval: string | null,
  downsamplingRetentionDays: number | null
): Promise<RetentionPolicy> {
  const result = await pool.query(
    `INSERT INTO ${HISTORIAN_SCHEMA}.retention_policies (target_table, retention_days, downsampling_interval, downsampling_retention_days, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (target_table) DO UPDATE SET
       retention_days = $2,
       downsampling_interval = $3,
       downsampling_retention_days = $4,
       updated_at = NOW()
     RETURNING *`,
    [targetTable, retentionDays, downsamplingInterval, downsamplingRetentionDays]
  );

  // Apply TimescaleDB policies
  await applyTimescaleDbPolicies(targetTable, retentionDays, downsamplingInterval, downsamplingRetentionDays);

  return result.rows[0];
}

// ─── TimescaleDB Policies ─────────────────────────────────────────────────────

async function applyTimescaleDbPolicies(
  tableName: string,
  retentionDays: number,
  downsamplingInterval: string | null,
  downsamplingRetentionDays: number | null
): Promise<void> {
  const fullName = `${HISTORIAN_SCHEMA}.${tableName}`;

  // Validate retentionDays is a positive integer
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    console.warn(`[db] Invalid retention days: ${retentionDays}, skipping`);
    return;
  }

  // Validate downsampling parameters if provided
  if (downsamplingInterval !== null) {
    const VALID_INTERVALS = ['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour', '6 hours', '1 day', '1 week'];
    if (!VALID_INTERVALS.includes(downsamplingInterval)) {
      console.warn(`[db] Invalid downsampling interval: ${downsamplingInterval}, skipping`);
      return;
    }
  }
  if (downsamplingRetentionDays !== null) {
    if (!Number.isInteger(downsamplingRetentionDays) || downsamplingRetentionDays <= 0) {
      console.warn(`[db] Invalid downsampling retention days: ${downsamplingRetentionDays}, skipping`);
      return;
    }
  }

  try {
    // Remove existing retention policy, then add new one
    try {
      await pool.query(`SELECT remove_retention_policy('${fullName}', if_exists => true)`);
    } catch {}
    await pool.query(`SELECT add_retention_policy('${fullName}', INTERVAL '${retentionDays} days', if_not_exists => true)`);
    console.log(`[db] Retention policy: ${fullName} → ${retentionDays} days`);
  } catch (err: any) {
    console.log(`[db] Could not set retention policy for ${fullName}: ${err.message}`);
  }

  // Continuous aggregate for downsampling
  if (downsamplingInterval && downsamplingRetentionDays) {
    const viewName = `${fullName}_agg`;
    try {
      // Create continuous aggregate
      await pool.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS ${viewName}
        WITH (timescaledb.continuous) AS
          SELECT time_bucket('${downsamplingInterval}', ts) AS ts,
                 machine, variable,
                 AVG(value) AS avg_value,
                 MIN(value) AS min_value,
                 MAX(value) AS max_value,
                 COUNT(*) AS sample_count
          FROM ${fullName}
          GROUP BY 1, machine, variable
        WITH NO DATA
      `);

      // Add refresh policy
      try {
        await pool.query(`SELECT remove_continuous_aggregate_policy('${viewName}', if_exists => true)`);
      } catch {}
      await pool.query(`
        SELECT add_continuous_aggregate_policy('${viewName}',
          start_offset => INTERVAL '${downsamplingRetentionDays} days',
          end_offset => INTERVAL '${downsamplingInterval}',
          schedule_interval => INTERVAL '${downsamplingInterval}',
          if_not_exists => true
        )
      `);

      // Add retention policy on aggregate
      try {
        await pool.query(`SELECT remove_retention_policy('${viewName}', if_exists => true)`);
      } catch {}
      await pool.query(`
        SELECT add_retention_policy('${viewName}', INTERVAL '${downsamplingRetentionDays} days', if_not_exists => true)
      `);

      console.log(`[db] Continuous aggregate: ${viewName} (${downsamplingInterval}, ${downsamplingRetentionDays}d retention)`);
    } catch (err: any) {
      console.log(`[db] Could not create continuous aggregate for ${fullName}: ${err.message}`);
    }
  }
}

// ─── Cleanup (drop_chunks) ────────────────────────────────────────────────────

export async function cleanupWithDropChunks(): Promise<void> {
  const policies = await getRetentionPolicies();
  for (const p of policies) {
    const fullName = `${HISTORIAN_SCHEMA}.${p.target_table}`;
    try {
      // Try TimescaleDB drop_chunks first
      await pool.query(
        `SELECT drop_chunks('${fullName}', older_than => INTERVAL '${p.retention_days} days')`
      );
    } catch {
      // Fallback to DELETE for non-hypertables
      try {
        await pool.query(
          `DELETE FROM ${fullName} WHERE ts < NOW() - INTERVAL '1 day' * $1`,
          [p.retention_days]
        );
      } catch {}
    }
  }

  // Also clean legacy table
  try {
    await pool.query(`SELECT drop_chunks('uns_history', older_than => INTERVAL '30 days')`);
  } catch {
    try {
      await pool.query(`DELETE FROM uns_history WHERE ts < NOW() - INTERVAL '30 days'`);
    } catch {}
  }

  // Clean old dead letters (keep 7 days)
  try {
    await pool.query(`DELETE FROM ${HISTORIAN_SCHEMA}.dead_letters WHERE created_at < NOW() - INTERVAL '7 days'`);
  } catch {}
}

// ─── Dead Letter ──────────────────────────────────────────────────────────────

export async function recordDeadLetter(targetTable: string, rowCount: number, error: string, sampleData: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ${HISTORIAN_SCHEMA}.dead_letters (target_table, row_count, error, sample_data)
       VALUES ($1, $2, $3, $4)`,
      [targetTable, rowCount, error, JSON.stringify(sampleData)]
    );
  } catch (err: any) {
    console.error(`[db] Failed to record dead letter: ${err.message}`);
  }
}

// ─── Table Management ─────────────────────────────────────────────────────────

export async function createTable(tableName: string): Promise<void> {
  await ensureTable(pool, tableName);
}

export async function listTables(): Promise<{ table_name: string; row_estimate: number; size: string }[]> {
  const result = await pool.query(`
    SELECT tablename as table_name,
           pg_stat_get_live_tuples(c.oid) as row_estimate,
           pg_size_pretty(pg_total_relation_size(c.oid)) as size
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
    WHERE t.schemaname = $1
      AND t.tablename NOT IN ('category_routes', 'retention_policies', 'dead_letters', 'topic_profiles')
    ORDER BY t.tablename
  `, [HISTORIAN_SCHEMA]);
  return result.rows;
}

// ─── Topic Profiles ──────────────────────────────────────────────────────────

export interface TopicProfile {
  id: number;
  name: string;
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  is_builtin: boolean;
  enabled: boolean;
  priority: number;
  example_topic: string | null;
  created_at: string;
  updated_at: string;
}

async function seedDefaultProfiles(client: pg.PoolClient): Promise<void> {
  const defaults = [
    {
      name: 'Factory (default)',
      prefix: 'Factory',
      subscription: 'Factory/#',
      seg_machine: 1,
      seg_work_order: 2,
      seg_tool_id: 3,
      seg_category: 4,
      seg_variable_start: 5,
      null_marker: '---',
      is_builtin: true,
      priority: 100,
      example_topic: 'Factory/BZ-1/FA-FFS-000000/T01/BDE/Act_Qty_Good',
    },
    {
      name: 'ISA-95',
      prefix: 'Enterprise',
      subscription: 'Enterprise/#',
      seg_machine: 4,
      seg_work_order: null,
      seg_tool_id: null,
      seg_category: 5,
      seg_variable_start: 6,
      null_marker: '---',
      is_builtin: true,
      priority: 50,
      example_topic: 'Enterprise/Site/Area/Line/CNC-01/BDE/Spindle_RPM',
    },
  ];

  for (const p of defaults) {
    await client.query(`
      INSERT INTO ${HISTORIAN_SCHEMA}.topic_profiles
        (name, prefix, subscription, seg_machine, seg_work_order, seg_tool_id, seg_category, seg_variable_start, null_marker, is_builtin, priority, example_topic)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (prefix) DO NOTHING
    `, [p.name, p.prefix, p.subscription, p.seg_machine, p.seg_work_order, p.seg_tool_id, p.seg_category, p.seg_variable_start, p.null_marker, p.is_builtin, p.priority, p.example_topic]);
  }
}

export async function getTopicProfiles(): Promise<TopicProfile[]> {
  const result = await pool.query(
    `SELECT * FROM ${HISTORIAN_SCHEMA}.topic_profiles ORDER BY priority DESC`
  );
  return result.rows;
}

export async function createTopicProfile(profile: {
  name: string;
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  priority: number;
  example_topic: string | null;
}): Promise<TopicProfile> {
  const result = await pool.query(
    `INSERT INTO ${HISTORIAN_SCHEMA}.topic_profiles
       (name, prefix, subscription, seg_machine, seg_work_order, seg_tool_id, seg_category, seg_variable_start, null_marker, priority, example_topic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [profile.name, profile.prefix, profile.subscription, profile.seg_machine, profile.seg_work_order, profile.seg_tool_id, profile.seg_category, profile.seg_variable_start, profile.null_marker, profile.priority, profile.example_topic]
  );
  return result.rows[0];
}

export async function updateTopicProfile(id: number, updates: Partial<Omit<TopicProfile, 'id' | 'is_builtin' | 'created_at' | 'updated_at'>>): Promise<TopicProfile | null> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const fields: Array<[string, keyof typeof updates]> = [
    ['name', 'name'],
    ['prefix', 'prefix'],
    ['subscription', 'subscription'],
    ['seg_machine', 'seg_machine'],
    ['seg_work_order', 'seg_work_order'],
    ['seg_tool_id', 'seg_tool_id'],
    ['seg_category', 'seg_category'],
    ['seg_variable_start', 'seg_variable_start'],
    ['null_marker', 'null_marker'],
    ['enabled', 'enabled'],
    ['priority', 'priority'],
    ['example_topic', 'example_topic'],
  ];

  for (const [col, key] of fields) {
    if (updates[key] !== undefined) {
      sets.push(`${col} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE ${HISTORIAN_SCHEMA}.topic_profiles SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteTopicProfile(id: number): Promise<boolean> {
  // Protect builtins
  const check = await pool.query(
    `SELECT is_builtin FROM ${HISTORIAN_SCHEMA}.topic_profiles WHERE id = $1`,
    [id]
  );
  if (check.rows[0]?.is_builtin) return false;

  const result = await pool.query(
    `DELETE FROM ${HISTORIAN_SCHEMA}.topic_profiles WHERE id = $1 AND is_builtin = false`,
    [id]
  );
  return (result.rowCount || 0) > 0;
}

// ─── Query Helper ─────────────────────────────────────────────────────────────

export async function query(sql: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

export { pool, HISTORIAN_SCHEMA };
