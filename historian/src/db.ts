// Historian — Database connection + schema

import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.HISTORIAN_DB_HOST || process.env.FACTORY_DB_HOST || '192.168.178.150',
  port: parseInt(process.env.HISTORIAN_DB_PORT || process.env.FACTORY_DB_PORT || '30432'),
  database: process.env.HISTORIAN_DB_NAME || 'bigdata_homelab',
  user: process.env.HISTORIAN_DB_USER || process.env.FACTORY_DB_USER || 'admin',
  password: process.env.HISTORIAN_DB_PASSWORD || process.env.FACTORY_DB_PASSWORD || '',
  max: 5,
  idleTimeoutMillis: 30_000,
});

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
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

    // Try TimescaleDB hypertable (fails gracefully if extension not installed)
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE");
      await client.query("SELECT create_hypertable('uns_history', 'ts', if_not_exists => true)");
      console.log('[db] TimescaleDB hypertable created/verified');
    } catch (err: any) {
      if (err.message?.includes('already a hypertable')) {
        console.log('[db] uns_history is already a hypertable');
      } else {
        console.log(`[db] TimescaleDB not available, using regular table: ${err.message}`);
      }
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_uns_hist_machine_ts ON uns_history(machine, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_uns_hist_variable_ts ON uns_history(variable, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_uns_hist_topic_ts ON uns_history(topic, ts DESC);
    `);

    console.log('[db] Schema initialized');
  } finally {
    client.release();
  }
}

export interface HistoryRow {
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

export async function batchInsert(rows: HistoryRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  // Build multi-row INSERT
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

export async function query(sql: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function cleanup(retentionDays: number = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM uns_history WHERE ts < NOW() - INTERVAL '1 day' * $1`,
    [retentionDays]
  );
  return result.rowCount || 0;
}

export { pool };
