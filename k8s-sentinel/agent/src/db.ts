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

      CREATE TABLE IF NOT EXISTS runbooks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        cluster_id UUID REFERENCES clusters(id),
        match_type TEXT,
        match_namespace TEXT,
        match_resource TEXT,
        steps JSONB NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        is_template BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS runbook_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        runbook_id UUID REFERENCES runbooks(id),
        incident_id UUID REFERENCES incidents(id),
        cluster_id UUID REFERENCES clusters(id),
        status TEXT DEFAULT 'running',
        steps_completed INT DEFAULT 0,
        steps_total INT NOT NULL,
        log JSONB DEFAULT '[]',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cluster_id UUID REFERENCES clusters(id),
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        namespace TEXT,
        resource_kind TEXT,
        resource_name TEXT,
        description TEXT NOT NULL,
        trend_data JSONB,
        predicted_event TEXT,
        estimated_eta TEXT,
        acknowledged BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cluster_id UUID REFERENCES clusters(id),
        action TEXT NOT NULL,
        tool_name TEXT,
        params JSONB,
        result TEXT,
        status TEXT NOT NULL,
        blocked_reason TEXT,
        user_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pending_tool_calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cluster_id UUID REFERENCES clusters(id),
        tool_name TEXT NOT NULL,
        params JSONB NOT NULL,
        danger_level TEXT NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
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

export async function hasOpenIncident(type: string, resourceName: string, clusterId?: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM incidents WHERE type = $1 AND resource_name = $2 AND fix_status IN ('pending', 'proposed', 'alert') AND ($3::uuid IS NULL OR cluster_id = $3) LIMIT 1`,
    [type, resourceName, clusterId || null]
  );
  return result.rows.length > 0;
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
      'SELECT * FROM protected_pods WHERE cluster_id = $1 OR cluster_id IS NULL ORDER BY namespace, pod_pattern',
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
      'DELETE FROM protected_pods WHERE namespace = $1 AND pod_pattern = $2 AND (cluster_id = $3 OR cluster_id IS NULL)',
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

// --- Predictions ---

export interface Prediction {
  id?: string;
  cluster_id?: string;
  type: string;
  severity: string;
  namespace?: string;
  resource_kind?: string;
  resource_name?: string;
  description: string;
  trend_data?: any;
  predicted_event?: string;
  estimated_eta?: string;
  acknowledged?: boolean;
  created_at?: Date;
  expires_at?: Date;
}

export async function insertPrediction(p: Prediction): Promise<Prediction> {
  const result = await pool.query(
    `INSERT INTO predictions (cluster_id, type, severity, namespace, resource_kind, resource_name, description, trend_data, predicted_event, estimated_eta, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [p.cluster_id || null, p.type, p.severity, p.namespace || null, p.resource_kind || null,
     p.resource_name || null, p.description, p.trend_data ? JSON.stringify(p.trend_data) : null,
     p.predicted_event || null, p.estimated_eta || null, p.expires_at || null]
  );
  return result.rows[0];
}

export async function getActivePredictions(clusterId?: string): Promise<Prediction[]> {
  if (clusterId) {
    const result = await pool.query(
      `SELECT * FROM predictions
       WHERE cluster_id = $1 AND acknowledged = FALSE AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [clusterId]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM predictions
     WHERE acknowledged = FALSE AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function acknowledgePrediction(id: string): Promise<Prediction | null> {
  const result = await pool.query(
    `UPDATE predictions SET acknowledged = TRUE WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

export async function expireOldPredictions(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM predictions WHERE expires_at IS NOT NULL AND expires_at < NOW()`
  );
  return result.rowCount || 0;
}

export async function hasActivePrediction(clusterId: string, type: string, resourceName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM predictions
     WHERE cluster_id = $1 AND type = $2 AND resource_name = $3
       AND acknowledged = FALSE AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [clusterId, type, resourceName]
  );
  return result.rows.length > 0;
}

// --- Runbooks ---

export interface RunbookRow {
  id: string;
  name: string;
  cluster_id?: string;
  match_type?: string;
  match_namespace?: string;
  match_resource?: string;
  steps: any[];
  enabled: boolean;
  is_template: boolean;
}

export async function getRunbooks(clusterId?: string): Promise<RunbookRow[]> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM runbooks WHERE cluster_id = $1 OR cluster_id IS NULL ORDER BY is_template DESC, name',
      [clusterId]
    );
    return result.rows;
  }
  const result = await pool.query('SELECT * FROM runbooks ORDER BY is_template DESC, name');
  return result.rows;
}

export async function getRunbookById(id: string): Promise<RunbookRow | null> {
  const result = await pool.query('SELECT * FROM runbooks WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function insertRunbook(r: Partial<RunbookRow>): Promise<RunbookRow> {
  const result = await pool.query(
    `INSERT INTO runbooks (name, cluster_id, match_type, match_namespace, match_resource, steps, enabled, is_template)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [r.name, r.cluster_id || null, r.match_type || null, r.match_namespace || null,
     r.match_resource || null, JSON.stringify(r.steps || []), r.enabled !== false, r.is_template || false]
  );
  return result.rows[0];
}

export async function updateRunbook(id: string, updates: Partial<RunbookRow>): Promise<RunbookRow | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.cluster_id !== undefined) { fields.push(`cluster_id = $${idx++}`); values.push(updates.cluster_id || null); }
  if (updates.match_type !== undefined) { fields.push(`match_type = $${idx++}`); values.push(updates.match_type); }
  if (updates.match_namespace !== undefined) { fields.push(`match_namespace = $${idx++}`); values.push(updates.match_namespace); }
  if (updates.match_resource !== undefined) { fields.push(`match_resource = $${idx++}`); values.push(updates.match_resource); }
  if (updates.steps !== undefined) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(updates.steps)); }
  if (updates.enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(updates.enabled); }
  if (updates.is_template !== undefined) { fields.push(`is_template = $${idx++}`); values.push(updates.is_template); }

  if (fields.length === 0) return getRunbookById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);
  const result = await pool.query(
    `UPDATE runbooks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteRunbook(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM runbooks WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

export async function getEnabledRunbooks(clusterId?: string): Promise<RunbookRow[]> {
  if (clusterId) {
    const result = await pool.query(
      'SELECT * FROM runbooks WHERE enabled = TRUE AND (cluster_id = $1 OR cluster_id IS NULL) ORDER BY name',
      [clusterId]
    );
    return result.rows;
  }
  const result = await pool.query('SELECT * FROM runbooks WHERE enabled = TRUE ORDER BY name');
  return result.rows;
}

// --- Runbook Executions ---

export interface RunbookExecutionRow {
  id: string;
  runbook_id: string;
  incident_id: string;
  cluster_id?: string;
  status: string;
  steps_completed: number;
  steps_total: number;
  log: any[];
  started_at: Date;
  finished_at?: Date;
}

export async function insertExecution(e: Partial<RunbookExecutionRow>): Promise<RunbookExecutionRow> {
  const result = await pool.query(
    `INSERT INTO runbook_executions (runbook_id, incident_id, cluster_id, status, steps_completed, steps_total, log)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [e.runbook_id, e.incident_id, e.cluster_id || null, e.status || 'running',
     e.steps_completed || 0, e.steps_total || 0, JSON.stringify(e.log || [])]
  );
  return result.rows[0];
}

export async function updateExecution(id: string, updates: Partial<RunbookExecutionRow>): Promise<RunbookExecutionRow | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
  if (updates.steps_completed !== undefined) { fields.push(`steps_completed = $${idx++}`); values.push(updates.steps_completed); }
  if (updates.log !== undefined) { fields.push(`log = $${idx++}`); values.push(JSON.stringify(updates.log)); }
  if (updates.finished_at !== undefined) { fields.push(`finished_at = $${idx++}`); values.push(updates.finished_at); }

  if (fields.length === 0) return getExecutionById(id);

  values.push(id);
  const result = await pool.query(
    `UPDATE runbook_executions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function getExecutions(clusterId?: string, limit = 50): Promise<RunbookExecutionRow[]> {
  if (clusterId) {
    const result = await pool.query(
      `SELECT re.*, rb.name as runbook_name FROM runbook_executions re
       LEFT JOIN runbooks rb ON re.runbook_id = rb.id
       WHERE re.cluster_id = $1 ORDER BY re.started_at DESC LIMIT $2`,
      [clusterId, limit]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT re.*, rb.name as runbook_name FROM runbook_executions re
     LEFT JOIN runbooks rb ON re.runbook_id = rb.id
     ORDER BY re.started_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getExecutionById(id: string): Promise<RunbookExecutionRow | null> {
  const result = await pool.query(
    `SELECT re.*, rb.name as runbook_name FROM runbook_executions re
     LEFT JOIN runbooks rb ON re.runbook_id = rb.id
     WHERE re.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// --- Seed Runbook Templates ---

export async function seedRunbookTemplates(): Promise<void> {
  const existing = await pool.query('SELECT id FROM runbooks WHERE is_template = TRUE LIMIT 1');
  if (existing.rows.length > 0) return;

  logger.info('Seeding default runbook templates');

  // 1. OOM Escalation
  await insertRunbook({
    name: 'OOM Escalation',
    match_type: 'OOMKilled',
    is_template: true,
    steps: [
      { type: 'check_condition', params: { check: 'restartCount > 3' }, on_failure: 'abort' },
      { type: 'delete_pod', params: {} },
      { type: 'wait', params: { seconds: 30 } },
      { type: 'check_condition', params: { check: 'pod_ready' }, on_failure: 'continue' },
      { type: 'rollback_deployment', params: {}, on_failure: 'continue' },
      { type: 'notify', params: { message: 'OOM escalation completed for $resource in $namespace' } },
    ],
  });

  // 2. CrashLoop Recovery
  await insertRunbook({
    name: 'CrashLoop Recovery',
    match_type: 'CrashLoopBackOff',
    is_template: true,
    steps: [
      { type: 'delete_pod', params: {} },
      { type: 'wait', params: { seconds: 60 } },
      { type: 'check_condition', params: { check: 'pod_ready' }, on_failure: 'continue' },
      { type: 'notify', params: { message: 'Manual intervention needed for $resource in $namespace' }, on_failure: 'continue' },
    ],
  });

  // 3. Stale Job Cleanup
  await insertRunbook({
    name: 'Stale Job Cleanup',
    match_type: 'FailedJob',
    is_template: true,
    steps: [
      { type: 'delete_pod', params: {} },
      { type: 'notify', params: { message: 'Failed job $resource cleaned up in $namespace' } },
    ],
  });
}
