import { pool } from '../db/pool';

export interface CodeAgent {
  id: string;
  userId: string;
  repoFullName: string;
  repoUrl: string;
  name: string;
  description: string;
  icon: string;
  entry: string;
  timeoutSeconds: number;
  bundledCode: string | null;
  manifest: any;
  deployStatus: string;
  deployError: string | null;
  isPublic: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToAgent(row: any): CodeAgent {
  return {
    id: row.id,
    userId: row.user_id,
    repoFullName: row.repo_full_name,
    repoUrl: row.repo_url,
    name: row.name,
    description: row.description,
    icon: row.icon,
    entry: row.entry,
    timeoutSeconds: row.timeout_seconds,
    bundledCode: row.bundled_code,
    manifest: row.manifest,
    deployStatus: row.deploy_status,
    deployError: row.deploy_error,
    isPublic: row.is_public,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Strip bundled code from public responses */
export function safeAgent(agent: CodeAgent): Omit<CodeAgent, 'bundledCode'> {
  const { bundledCode, ...rest } = agent;
  return rest;
}

export async function getCodeAgent(id: string): Promise<CodeAgent | null> {
  const result = await pool.query('SELECT * FROM code_agents WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

export async function getUserCodeAgents(userId: string): Promise<CodeAgent[]> {
  const result = await pool.query(
    'SELECT * FROM code_agents WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows.map(rowToAgent);
}

export async function getPublicCodeAgents(): Promise<CodeAgent[]> {
  const result = await pool.query(
    "SELECT * FROM code_agents WHERE is_public = TRUE AND deploy_status = 'deployed' ORDER BY updated_at DESC LIMIT 50"
  );
  return result.rows.map(rowToAgent);
}

export async function deleteCodeAgent(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM code_agents WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return (result.rowCount || 0) > 0;
}
