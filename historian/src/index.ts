// Historian v2 — Main entry point
// MQTT → routed TimescaleDB tables with COPY protocol + MCP server + REST API

import { logger } from './logger.js';
import { initSchema, cleanupWithDropChunks } from './db.js';
import { initDiskBuffer, replayPendingBatches, removeFlushedBatches } from './disk-buffer.js';
import { loadRoutes, startHotReload, stopHotReload } from './config-manager.js';
import { loadProfiles, startProfileReload, stopProfileReload } from './topic-profiles.js';
import { replayBatch, startLegacyFlush, flushAll, stopAll, getFlushStats } from './flush-engine.js';
import { start as startSubscriber, stop as stopSubscriber, getSubscriberStats } from './subscriber.js';
import { startMcpServer } from './mcp-server.js';

const LEGACY_FLUSH_MS = parseInt(process.env.HISTORIAN_FLUSH_MS || '5000');
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000; // Every 6 hours

async function main(): Promise<void> {
  logger.info('[historian] Starting v2...');

  // 1. Init disk buffer
  initDiskBuffer();

  // 2. Init DB schema (creates tables, seeds default routes)
  await initSchema();

  // 3. Load routes + topic profiles into memory
  await loadRoutes();
  startHotReload();
  await loadProfiles();
  startProfileReload();

  // 4. Replay disk buffer (crash recovery)
  const pendingBatches = await replayPendingBatches();
  if (pendingBatches.length > 0) {
    let flushed = 0;
    for (const batch of pendingBatches) {
      const ok = await replayBatch(batch.table, batch.rows);
      if (ok) flushed++;
    }
    removeFlushedBatches(flushed);
    logger.info(`[historian] Replayed ${flushed}/${pendingBatches.length} pending batches`);
  }

  // 5. Start legacy flush (for uns_history compatibility)
  startLegacyFlush(LEGACY_FLUSH_MS);

  // 6. Start MQTT subscriber (QoS 1, persistent session)
  await startSubscriber();

  // 7. Start MCP + REST API server
  const mcpServer = startMcpServer();

  // 8. Periodic cleanup with drop_chunks
  const cleanupTimer = setInterval(async () => {
    try {
      await cleanupWithDropChunks();
      logger.info('[historian] Cleanup completed (drop_chunks)');
    } catch (err: any) {
      logger.error(`[historian] Cleanup error: ${err.message}`);
    }
  }, CLEANUP_INTERVAL_MS);

  // 9. Stats logging
  const statsTimer = setInterval(() => {
    const sub = getSubscriberStats();
    const flush = getFlushStats();
    const tables = flush.perTable.map(t => `${t.table}:${t.bufferSize}`).join(' ');
    logger.info(
      `[historian] rx=${sub.received} routed=${sub.routed} inserted=${flush.totals.inserted} ` +
      `buf=${flush.totals.bufferSize} err=${flush.totals.errors} msg/s=${flush.totals.msgPerSec} ` +
      `mqtt=${sub.mqttConnected ? 'up' : 'DOWN'}${sub.paused ? ' PAUSED' : ''} [${tables}]`
    );
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[historian] Shutting down...');
    clearInterval(cleanupTimer);
    clearInterval(statsTimer);
    stopHotReload();
    stopProfileReload();
    await stopSubscriber();
    await flushAll();
    stopAll();
    mcpServer.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('[historian] v2 Ready');
}

main().catch((err) => {
  logger.error(`[historian] Fatal: ${err.message}`);
  process.exit(1);
});
