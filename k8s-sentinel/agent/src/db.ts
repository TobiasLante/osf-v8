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

      CREATE TABLE IF NOT EXISTS clusters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        config JSONB NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notification_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        events TEXT[] DEFAULT '{}',
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Add cluster_id columns (idempotent)
      DO $$ BEGIN
        ALTER TABLE incidents ADD COLUMN cluster_id UUID REFERENCES clusters(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE check_runs ADD COLUMN cluster_id UUID REFERENCES clusters(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE cluster_snapshots ADD COLUMN cluster_id UUID REFERENCES clusters(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE protected_pods ADD COLUMN cluster_id UUID REFERENCES clusters(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
    logger.info('Database schema initialized');
  } finally {
    client.release();
  }
}

// --- Incidents ---

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
  cluster_id?: string;
}

export async function insertIncident(incident: Incident, clusterId?: string): Promise<Incident> {
  const result = await pool.query(
    `INSERT INTO incidents (type, severity, namespace, resource_kind, resource_name, description, diagnosis, proposed_fix, fix_status, cluster_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [incident.type, incident.severity, incident.namespace, incident.resource_kind,
     incident.resource_name, incident.description, incident.diagnosis,
     incident.proposed_fix, incident.fix_status || 'pending', clusterId || null]
  );
  return result.rows[0];
}

export async function getIncidents(filters?: { severity?: string; fix_status?: string; namespace?: string; cluster_id?: string }): Promise<Incident[]> {
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
  if (filters?.cluster_id) {
    params.push(filters.cluster_id);
    query += ` AND cluster_id = $${params.length}`;
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

// --- Check Runs ---

export async function insertCheckRun(run: Partial<{
  pods_total: number; pods_healthy: number; nodes_total: number;
  nodes_ready: number; issues_found: number; fixes_applied: number;
  finished_at: Date;
}>, clusterId?: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO check_runs (pods_total, pods_healthy, nodes_total, nodes_ready, issues_found, fixes_applied, finished_at, cluster_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [run.pods_total, run.pods_healthy, run.nodes_total, run.nodes_ready,
     run.issues_found, run.fixes_applied, run.finished_at, clusterId || null]
  );
  return result.rows[0].id;
}

export async function getCheckRuns(limit = 20, clusterId?: string): Promise<any[]> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM check_runs WHERE cluster_id = $1 ORDER BY started_at DESC LIMIT $2',
      [clusterId, limit]
    );
    return result.rows;
  }
  const result = await pool.query('SELECT * FROM check_runs ORDER BY started_at DESC LIMIT $1', [limit]);
  return result.rows;
}

// --- Snapshots ---

export async function insertSnapshot(snapshot: any, clusterId?: string): Promise<void> {
  await pool.query(
    'INSERT INTO cluster_snapshots (snapshot, cluster_id) VALUES ($1, $2)',
    [JSON.stringify(snapshot), clusterId || null]
  );
}

export async function getLatestSnapshot(clusterId?: string): Promise<any | null> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM cluster_snapshots WHERE cluster_id = $1 ORDER BY created_at DESC LIMIT 1',
      [clusterId]
    );
    return result.rows[0]?.snapshot || null;
  }
  const result = await pool.query('SELECT * FROM cluster_snapshots ORDER BY created_at DESC LIMIT 1');
  return result.rows[0]?.snapshot || null;
}

export async function getRecentSnapshots(clusterId: string, count: number): Promise<any[]> {
  const result = await pool.query(
    'SELECT * FROM cluster_snapshots WHERE cluster_id = $1 ORDER BY created_at DESC LIMIT $2',
    [clusterId, count]
  );
  return result.rows;
}

// --- Protected Pods ---

export interface ProtectedPod {
  namespace: string;
  pod_pattern: string;
  reason?: string;
  created_at?: Date;
  cluster_id?: string;
}

export async function getProtectedPods(clusterId?: string): Promise<ProtectedPod[]> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM protected_pods WHERE cluster_id = $1 ORDER BY namespace, pod_pattern',
      [clusterId]
    );
    return result.rows;
  }
  const result = await pool.query('SELECT * FROM protected_pods ORDER BY namespace, pod_pattern');
  return result.rows;
}

export async function addProtectedPod(namespace: string, podPattern: string, reason?: string, clusterId?: string): Promise<ProtectedPod> {
  const result = await pool.query(
    `INSERT INTO protected_pods (namespace, pod_pattern, reason, cluster_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (namespace, pod_pattern) DO UPDATE SET reason = $3
     RETURNING *`,
    [namespace, podPattern, reason || 'Production workload', clusterId || null]
  );
  return result.rows[0];
}

export async function removeProtectedPod(namespace: string, podPattern: string, clusterId?: string): Promise<boolean> {
  if (clusterId) {
    const result = await pool.query(
      'DELETE FROM protected_pods WHERE namespace = $1 AND pod_pattern = $2 AND cluster_id = $3',
      [namespace, podPattern, clusterId]
    );
    return (result.rowCount || 0) > 0;
  }
  const result = await pool.query(
    'DELETE FROM protected_pods WHERE namespace = $1 AND pod_pattern = $2',
    [namespace, podPattern]
  );
  return (result.rowCount || 0) > 0;
}

export async function isPodProtected(namespace: string, podName: string, clusterId?: string): Promise<boolean> {
  const protections = await getProtectedPods(clusterId);
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

// --- Clusters ---

export interface ClusterRow {
  id: string;
  name: string;
  type: 'k8s' | 'docker';
  config: any;
  enabled: boolean;
}

export async function getClusters(): Promise<ClusterRow[]> {
  const result = await pool.query('SELECT * FROM clusters ORDER BY name');
  return result.rows;
}

export async function getClusterById(id: string): Promise<ClusterRow | null> {
  const result = await pool.query('SELECT * FROM clusters WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function insertCluster(name: string, type: string, config: any): Promise<ClusterRow> {
  const result = await pool.query(
    `INSERT INTO clusters (name, type, config) VALUES ($1, $2, $3) RETURNING *`,
    [name, type, JSON.stringify(config)]
  );
  return result.rows[0];
}

export async function updateCluster(id: string, updates: Partial<ClusterRow>): Promise<ClusterRow | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(updates.name);
  }
  if (updates.type !== undefined) {
    fields.push(`type = $${idx++}`);
    values.push(updates.type);
  }
  if (updates.config !== undefined) {
    fields.push(`config = $${idx++}`);
    values.push(JSON.stringify(updates.config));
  }
  if (updates.enabled !== undefined) {
    fields.push(`enabled = $${idx++}`);
    values.push(updates.enabled);
  }

  if (fields.length === 0) return getClusterById(id);

  values.push(id);
  const result = await pool.query(
    `UPDATE clusters SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteCluster(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM clusters WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// --- Notification Config ---

export interface NotificationConfigRow {
  id: string;
  type: 'slack' | 'webhook';
  url: string;
  events: string[];
  enabled: boolean;
}

export async function getNotificationConfigs(): Promise<NotificationConfigRow[]> {
  const result = await pool.query('SELECT * FROM notification_config WHERE enabled = TRUE ORDER BY type');
  return result.rows;
}

export async function insertNotificationConfig(type: string, url: string, events: string[]): Promise<NotificationConfigRow> {
  const result = await pool.query(
    `INSERT INTO notification_config (type, url, events) VALUES ($1, $2, $3) RETURNING *`,
    [type, url, events]
  );
  return result.rows[0];
}

export async function deleteNotificationConfig(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM notification_config WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}
