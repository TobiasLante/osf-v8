import { logger } from './logger';
import type { ClusterRow } from './db';

export type CheckLoopFn = (clusterId: string, clusterConfig: any) => Promise<void>;

const loops = new Map<string, NodeJS.Timeout>();

export function startClusterLoop(cluster: ClusterRow, checkFn: CheckLoopFn, intervalMs: number): void {
  if (loops.has(cluster.id)) {
    logger.warn({ clusterId: cluster.id, name: cluster.name }, 'Loop already running, stopping first');
    stopClusterLoop(cluster.id);
  }

  logger.info({ clusterId: cluster.id, name: cluster.name, intervalMs }, 'Starting cluster check loop');

  // First check after 3s delay, then interval
  const initialTimeout = setTimeout(async () => {
    try {
      await checkFn(cluster.id, cluster);
    } catch (err: any) {
      logger.error({ err: err.message, clusterId: cluster.id }, 'Check loop error (initial)');
    }

    const interval = setInterval(async () => {
      try {
        await checkFn(cluster.id, cluster);
      } catch (err: any) {
        logger.error({ err: err.message, clusterId: cluster.id }, 'Check loop error');
      }
    }, intervalMs);

    // Replace the initial timeout with the interval in the map
    loops.set(cluster.id, interval);
  }, 3000);

  loops.set(cluster.id, initialTimeout);
}

export function stopClusterLoop(clusterId: string): void {
  const timer = loops.get(clusterId);
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    loops.delete(clusterId);
    logger.info({ clusterId }, 'Stopped cluster check loop');
  }
}

export function stopAllLoops(): void {
  for (const [clusterId, timer] of loops) {
    clearTimeout(timer);
    clearInterval(timer);
    logger.info({ clusterId }, 'Stopped cluster check loop');
  }
  loops.clear();
}

export function getActiveLoops(): string[] {
  return Array.from(loops.keys());
}
