// Health Agent — Persist reports to health_checks table

import pg from 'pg';

function getClient(): pg.Client {
  return new pg.Client({
    host: process.env.DB_HOST || 'osf-postgres.osf.svc.cluster.local',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'osf',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'osf',
    connectionTimeoutMillis: 5_000,
  });
}

async function ensureTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id SERIAL PRIMARY KEY,
      status VARCHAR(10) NOT NULL,
      report TEXT NOT NULL,
      tool_calls INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_health_checks_created ON health_checks(created_at DESC)
  `);
}

export async function saveReport(
  status: 'ok' | 'alert' | 'error',
  report: string,
  toolCalls: number,
  durationMs: number,
): Promise<void> {
  let client: pg.Client | null = null;
  try {
    client = getClient();
    await client.connect();
    await ensureTable(client);

    await client.query(
      'INSERT INTO health_checks (status, report, tool_calls, duration_ms) VALUES ($1, $2, $3, $4)',
      [status, report, toolCalls, durationMs]
    );

    // Clean up reports older than 30 days
    await client.query("DELETE FROM health_checks WHERE created_at < NOW() - INTERVAL '30 days'");

    console.log(`[db] Report saved (status=${status}, tools=${toolCalls}, duration=${durationMs}ms)`);
  } catch (err: any) {
    console.error(`[db] Failed to save report: ${err.message}`);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
