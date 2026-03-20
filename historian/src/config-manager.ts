// Historian v2 — Config Manager
// Loads category routes from DB, hot-reloads every 30s

import { getRoutes, type CategoryRoute } from './db.js';
import { logger } from './logger.js';

const RELOAD_INTERVAL_MS = 30_000;

// In-memory route lookup: category → route config
let routeMap = new Map<string, CategoryRoute>();
let fallbackRoute: CategoryRoute | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

// ─── Route Lookup ─────────────────────────────────────────────────────────────

/**
 * Find the target table for a given category.
 * Returns the specific route if category matches, otherwise the '*' fallback.
 */
export function resolveRoute(category: string): CategoryRoute | null {
  const route = routeMap.get(category);
  if (route && route.enabled) return route;
  if (fallbackRoute && fallbackRoute.enabled) return fallbackRoute;
  return null;
}

/**
 * Get all loaded routes (for stats/API).
 */
export function getLoadedRoutes(): CategoryRoute[] {
  return [...routeMap.values()];
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export async function loadRoutes(): Promise<void> {
  try {
    const routes = await getRoutes();
    const newMap = new Map<string, CategoryRoute>();
    let newFallback: CategoryRoute | null = null;

    for (const r of routes) {
      if (r.category === '*') {
        newFallback = r;
      } else {
        newMap.set(r.category, r);
      }
    }

    routeMap = newMap;
    fallbackRoute = newFallback;
    logger.info(`[config] Loaded ${routes.length} routes (${newMap.size} specific + ${newFallback ? '1 fallback' : 'no fallback'})`);
  } catch (err: any) {
    logger.error(`[config] Failed to load routes: ${err.message}`);
  }
}

// ─── Hot Reload ───────────────────────────────────────────────────────────────

export function startHotReload(): void {
  reloadTimer = setInterval(loadRoutes, RELOAD_INTERVAL_MS);
  logger.info(`[config] Hot-reload every ${RELOAD_INTERVAL_MS / 1000}s`);
}

export function stopHotReload(): void {
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
}
