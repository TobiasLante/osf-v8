import { Pool } from 'pg';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { getAllTools } from './kg-tools';

/**
 * Auto-register kg-server as MCP server in the Gateway's mcp_servers table.
 * Skips silently if GATEWAY_DB_URL is not configured (standalone mode).
 */

let gatewayPool: Pool | null = null;

export async function registerWithGateway(): Promise<void> {
  if (!config.gateway.dbUrl) {
    logger.info('GATEWAY_DB_URL not set — skipping gateway registration (standalone mode)');
    return;
  }

  try {
    gatewayPool = new Pool({
      connectionString: config.gateway.dbUrl,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // Test connectivity
    await gatewayPool.query('SELECT 1');

    const toolCount = getAllTools().length;
    const serverUrl = config.kgServerUrl;

    // Upsert: insert or update if name already exists
    await gatewayPool.query(`
      INSERT INTO mcp_servers (id, name, url, auth_type, status, tool_count, categories, health_check_at, created_at)
      VALUES (gen_random_uuid(), 'kg-v9', $1, 'none', 'online', $2, '{kg}', NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET
        url = $1,
        status = 'online',
        tool_count = $2,
        health_check_at = NOW()
    `, [serverUrl, toolCount]);

    logger.info({ url: serverUrl, tools: toolCount }, 'Registered with gateway as kg-v9');
  } catch (e: any) {
    // Non-fatal — server works standalone without gateway
    logger.warn({ err: e.message }, 'Gateway registration failed (non-fatal)');
    gatewayPool?.end().catch(() => {});
    gatewayPool = null;
  }
}

export async function deregisterFromGateway(): Promise<void> {
  if (!gatewayPool) return;

  try {
    await gatewayPool.query(`UPDATE mcp_servers SET status = 'offline' WHERE name = 'kg-v9'`);
    logger.info('Deregistered from gateway (status=offline)');
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Gateway deregistration failed');
  } finally {
    await gatewayPool.end().catch(() => {});
    gatewayPool = null;
  }
}
