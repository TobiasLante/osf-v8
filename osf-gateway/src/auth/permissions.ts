/**
 * Governance: Cached permission engine.
 * Resolves user_roles → role_permissions → tool_classifications to determine
 * which tools a user may call. 60s TTL cache, invalidated on role changes.
 */

import { pool } from '../db/pool';
import { logger } from '../logger';

interface CacheEntry {
  allowedCategories: Set<string>;
  allowedTools: Set<string>;
  time: number;
}

const CACHE_TTL = 60_000; // 60s
const cache = new Map<string, CacheEntry>();

/** Get the set of allowed category IDs for a user (from their factory roles). */
async function loadUserCategories(userId: string): Promise<Set<string>> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT rp.category_id
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId]
    );
    return new Set(result.rows.map((r: any) => r.category_id));
  } catch {
    // Tables may not exist yet — allow everything (backward compat)
    return new Set(['__all__']);
  }
}

/** Get the set of approved tool names the user may call. */
async function loadAllowedTools(categories: Set<string>): Promise<Set<string>> {
  if (categories.has('__all__')) {
    return new Set(['__all__']);
  }

  if (categories.size === 0) {
    return new Set();
  }

  try {
    const catArray = [...categories];
    const result = await pool.query(
      `SELECT tool_name FROM tool_classifications
       WHERE status = 'approved' AND category_id = ANY($1)`,
      [catArray]
    );
    return new Set(result.rows.map((r: any) => r.tool_name));
  } catch {
    // Table may not exist — allow everything
    return new Set(['__all__']);
  }
}

async function resolvePermissions(userId: string): Promise<CacheEntry> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.time < CACHE_TTL) {
    return cached;
  }

  const allowedCategories = await loadUserCategories(userId);
  const allowedTools = await loadAllowedTools(allowedCategories);

  const entry: CacheEntry = { allowedCategories, allowedTools, time: now };
  cache.set(userId, entry);
  return entry;
}

/** Get the set of category IDs this user may access. */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const entry = await resolvePermissions(userId);
  return entry.allowedCategories;
}

/** Check if a specific tool is allowed for this user. */
export async function isToolAllowed(userId: string, toolName: string): Promise<boolean> {
  const entry = await resolvePermissions(userId);

  // Wildcard: user has no governance restrictions yet
  if (entry.allowedTools.has('__all__')) return true;

  // No roles assigned — check if there are ANY tool classifications.
  // If no classifications exist at all, governance is not yet active → allow everything.
  if (entry.allowedCategories.size === 0) {
    try {
      const count = await pool.query('SELECT COUNT(*) as c FROM tool_classifications');
      if (parseInt(count.rows[0].c) === 0) return true; // No classifications yet
    } catch {
      return true; // Table doesn't exist
    }
    return false; // Classifications exist but user has no roles
  }

  // Tool is in the allowed set
  if (entry.allowedTools.has(toolName)) return true;

  // Tool is not classified yet (pending/unknown) — block if governance is active
  try {
    const result = await pool.query(
      'SELECT status FROM tool_classifications WHERE tool_name = $1',
      [toolName]
    );
    if (result.rows.length === 0) {
      // Unknown tool — not classified at all. Block by default (secure default).
      return false;
    }
    // Tool exists but is pending/rejected or in a category the user can't access
    return false;
  } catch {
    return true; // Table doesn't exist
  }
}

/** Filter a list of tools to only those the user may access. */
export async function filterToolsForUser(
  userId: string,
  tools: any[]
): Promise<any[]> {
  const entry = await resolvePermissions(userId);

  // Wildcard — return all
  if (entry.allowedTools.has('__all__')) return tools;

  // No roles and no classifications → governance not active yet
  if (entry.allowedCategories.size === 0) {
    try {
      const count = await pool.query('SELECT COUNT(*) as c FROM tool_classifications');
      if (parseInt(count.rows[0].c) === 0) return tools;
    } catch {
      return tools;
    }
    return []; // User has no roles but governance is active
  }

  return tools.filter((t: any) => {
    const name = t.function?.name || t.name;
    return entry.allowedTools.has(name);
  });
}

/** Invalidate cache for a user (call after role assignment changes). */
export function invalidatePermissionCache(userId?: string): void {
  if (userId) {
    cache.delete(userId);
  } else {
    cache.clear();
  }
  logger.debug({ userId: userId || 'all' }, 'Permission cache invalidated');
}
