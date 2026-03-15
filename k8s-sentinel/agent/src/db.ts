import { Pool } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool(config.db);

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        namespace TEXT,
        resource_kind TEXT,
        resource_name TEXT,
        description TEXT,
        diagnosis TEXT,
        proposed_fix TEXT,
        fix_status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS check_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        pods_total INT,
        pods_healthy INT,
        nodes_total INT,
        nodes_ready INT,
        issues_found INT,
        fixes_applied INT
      );

      CREATE TABLE IF NOT EXISTS cluster_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS protected_pods (
        namespace TEXT NOT NULL,
        pod_pattern TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (namespace, pod_pattern)
      );
    `);
    logger.info('Database schema initialized');
  } finally {
    client.release();
  }
}

export interface Incident {
  id?: string;
  type: string;
  severity: 'harmless' | 'medium' | 'critical';
  namespace?: string;
  resource_kind?: string;
  resource_name?: string;
  description: string;
  diagnosis?: string;
  proposed_fix?: string;
  fix_status?: string;
  created_at?: Date;
  resolved_at?: Date;
}

export async function insertIncident(incident: Incident): Promise<Incident> {
  const result = await pool.query(
    `INSERT INTO incidents (type, severity, namespace, resource_kind, resource_name, description, diagnosis, proposed_fix, fix_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [incident.type, incident.severity, incident.namespace, incident.resource_kind,
     incident.resource_name, incident.description, incident.diagnosis,
     incident.proposed_fix, incident.fix_status || 'pending']
  );
  return result.rows[0];
}

export async function getIncidents(filters?: { severity?: string; fix_status?: string; namespace?: string }): Promise<Incident[]> {
  let query = 'SELECT * FROM incidents WHERE 1=1';
  const params: string[] = [];

  if (filters?.severity) {
    params.push(filters.severity);
    query += ` AND severity = $${params.length}`;
  }
  if (filters?.fix_status) {
    params.push(filters.fix_status);
    query += ` AND fix_status = $${params.length}`;
  }
  if (filters?.namespace) {
    params.push(filters.namespace);
    query += ` AND namespace = $${params.length}`;
  }

  query += ' ORDER BY created_at DESC LIMIT 100';
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const result = await pool.query('SELECT * FROM incidents WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateIncidentStatus(id: string, fix_status: string, resolved_at?: Date): Promise<Incident | null> {
  const result = await pool.query(
    `UPDATE incidents SET fix_status = $1, resolved_at = $2 WHERE id = $3 RETURNING *`,
    [fix_status, resolved_at || null, id]
  );
  return result.rows[0] || null;
}

export async function insertCheckRun(run: Partial<{
  pods_total: number; pods_healthy: number; nodes_total: number;
  nodes_ready: number; issues_found: number; fixes_applied: number;
  finished_at: Date;
}>): Promise<string> {
  const result = await pool.query(
    `INSERT INTO check_runs (pods_total, pods_healthy, nodes_total, nodes_ready, issues_found, fixes_applied, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [run.pods_total, run.pods_healthy, run.nodes_total, run.nodes_ready,
     run.issues_found, run.fixes_applied, run.finished_at]
  );
  return result.rows[0].id;
}

export async function getCheckRuns(limit = 20): Promise<any[]> {
  const result = await pool.query('SELECT * FROM check_runs ORDER BY started_at DESC LIMIT $1', [limit]);
  return result.rows;
}

export async function insertSnapshot(snapshot: any): Promise<void> {
  await pool.query('INSERT INTO cluster_snapshots (snapshot) VALUES ($1)', [JSON.stringify(snapshot)]);
}

export async function getLatestSnapshot(): Promise<any | null> {
  const result = await pool.query('SELECT * FROM cluster_snapshots ORDER BY created_at DESC LIMIT 1');
  return result.rows[0]?.snapshot || null;
}

// --- Protected Pods ---

export interface ProtectedPod {
  namespace: string;
  pod_pattern: string;
  reason?: string;
  created_at?: Date;
}

export async function getProtectedPods(): Promise<ProtectedPod[]> {
  const result = await pool.query('SELECT * FROM protected_pods ORDER BY namespace, pod_pattern');
  return result.rows;
}

export async function addProtectedPod(namespace: string, podPattern: string, reason?: string): Promise<ProtectedPod> {
  const result = await pool.query(
    `INSERT INTO protected_pods (namespace, pod_pattern, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (namespace, pod_pattern) DO UPDATE SET reason = $3
     RETURNING *`,
    [namespace, podPattern, reason || 'Production workload']
  );
  return result.rows[0];
}

export async function removeProtectedPod(namespace: string, podPattern: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM protected_pods WHERE namespace = $1 AND pod_pattern = $2',
    [namespace, podPattern]
  );
  return (result.rowCount || 0) > 0;
}

export async function isPodProtected(namespace: string, podName: string): Promise<boolean> {
  const protections = await getProtectedPods();
  return protections.some(p => {
    if (p.namespace !== namespace && p.namespace !== '*') return false;
    if (p.pod_pattern === '*') return true;
    // Support simple prefix matching with *
    if (p.pod_pattern.endsWith('*')) {
      return podName.startsWith(p.pod_pattern.slice(0, -1));
    }
    return podName === p.pod_pattern;
  });
}
