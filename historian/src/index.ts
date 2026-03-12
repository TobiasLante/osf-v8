// Historian — Main entry point
// Persistent MQTT subscriber → TimescaleDB + History MCP server

import { initSchema, cleanup } from './db.js';
import { start as startSubscriber, stop as stopSubscriber, getStats } from './subscriber.js';
import { startMcpServer } from './mcp-server.js';

const RETENTION_DAYS = parseInt(process.env.HISTORIAN_RETENTION_DAYS || '30');
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000; // Every 6 hours

async function main(): Promise<void> {
  console.log('[historian] Starting...');
  console.log(`[historian] Retention: ${RETENTION_DAYS} days`);

  // 1. Init DB schema
  await initSchema();

  // 2. Start MQTT subscriber
  await startSubscriber();

  // 3. Start MCP server
  startMcpServer();

  // 4. Periodic cleanup
  setInterval(async () => {
    try {
      const deleted = await cleanup(RETENTION_DAYS);
      if (deleted > 0) {
        console.log(`[historian] Cleanup: removed ${deleted} rows older than ${RETENTION_DAYS} days`);
      }
    } catch (err: any) {
      console.error(`[historian] Cleanup error: ${err.message}`);
    }
  }, CLEANUP_INTERVAL_MS);

  // 5. Stats logging
  setInterval(() => {
    const s = getStats();
    console.log(`[historian] received=${s.received} inserted=${s.inserted} buffer=${s.bufferSize} errors=${s.errors}`);
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[historian] Shutting down...');
    await stopSubscriber();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('[historian] Ready');
}

main().catch((err) => {
  console.error(`[historian] Fatal: ${err.message}`);
  process.exit(1);
});
