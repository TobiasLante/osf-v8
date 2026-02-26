import { pool } from '../db/pool';
import { getUserId } from './async-context';
import { SEED_FLOW } from './seed-flow';

/**
 * Custom Node-RED storage plugin that stores flows per user in PostgreSQL.
 * Uses AsyncLocalStorage to determine the current user from the request context.
 */
const SYSTEM_USER = '__system__';

const storagePlugin = {
  init(_settings: any): Promise<void> {
    return Promise.resolve();
  },

  async getFlows(): Promise<any[]> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return [];
    const result = await pool.query(
      'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length > 0) return result.rows[0].flow_json;

    // First time: seed the example flow and persist it
    const revision = Date.now().toString();
    await pool.query(
      `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, JSON.stringify(SEED_FLOW), revision]
    );
    return SEED_FLOW;
  },

  async saveFlows(flows: any[], _complete?: boolean): Promise<string> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return '0';
    const revision = Date.now().toString();
    await pool.query(
      `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET flow_json = $2, revision = $3, updated_at = NOW()`,
      [userId, JSON.stringify(flows), revision]
    );
    return revision;
  },

  async getCredentials(): Promise<Record<string, any>> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return {};
    const result = await pool.query(
      'SELECT credentials FROM nodered_credentials WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0].credentials : {};
  },

  async saveCredentials(credentials: Record<string, any>): Promise<void> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return;
    await pool.query(
      `INSERT INTO nodered_credentials (user_id, credentials, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET credentials = $2, updated_at = NOW()`,
      [userId, JSON.stringify(credentials)]
    );
  },

  async getSettings(): Promise<Record<string, any>> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return {};
    const result = await pool.query(
      'SELECT settings FROM nodered_settings WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0].settings : {};
  },

  async saveSettings(settings: Record<string, any>): Promise<void> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return;
    await pool.query(
      `INSERT INTO nodered_settings (user_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = NOW()`,
      [userId, JSON.stringify(settings)]
    );
  },

  async getLibraryEntry(type: string, path: string): Promise<any> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return [];

    // If path ends with /, list entries in that directory
    if (path.endsWith('/') || path === '') {
      const prefix = path === '' ? '' : path;
      const result = await pool.query(
        `SELECT path, meta FROM nodered_library
         WHERE user_id = $1 AND type = $2 AND path LIKE $3`,
        [userId, type, prefix + '%']
      );
      return result.rows.map((r: any) => {
        const relativePath = r.path.slice(prefix.length);
        const parts = relativePath.split('/');
        if (parts.length > 1) {
          return parts[0]; // directory name
        }
        return { fn: parts[0], ...r.meta };
      });
    }

    const result = await pool.query(
      'SELECT body FROM nodered_library WHERE user_id = $1 AND type = $2 AND path = $3',
      [userId, type, path]
    );
    return result.rows.length > 0 ? result.rows[0].body : '';
  },

  async saveLibraryEntry(type: string, path: string, meta: any, body: string): Promise<void> {
    const userId = getUserId();
    if (userId === SYSTEM_USER) return;
    await pool.query(
      `INSERT INTO nodered_library (user_id, type, path, meta, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, type, path) DO UPDATE SET meta = $4, body = $5`,
      [userId, type, path, JSON.stringify(meta), body]
    );
  },
};

export default storagePlugin;
