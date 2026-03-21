import express from 'express';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { loadDomainConfig } from '../shared/domain-config';
import { initializeGraph, closeGraph } from '../shared/cypher-utils';
import { initVectorStore } from '../shared/vector-store';
import { startMqttBridge, stopMqttBridge } from './mqtt-bridge';
import { createRouter, setSchemaSync } from './routes';
import { loadDomainTools } from './kg-tools';
import { registerWithGateway, deregisterFromGateway } from './register-mcp';
import { SchemaSync } from '../builder/schema-sync';
import { loadAllProfiles, loadAllSources, loadAllSyncs, validateSchemaRefs } from '../builder/schema-loader';
import { buildFromSchemas, stopLiveUpdates } from '../builder/schema-kg-builder';

/**
 * KG Server — Always-on service providing:
 * - MCP Server (generic + domain-specific KG tools via JSON-RPC)
 * - REST API (semantic search, chart, health, MQTT status, review)
 * - MQTT Bridge (raw broker → KG in-process)
 */

async function main() {
  const domain = loadDomainConfig();
  logger.info({ domain: domain.domain, displayName: domain.displayName }, 'Domain config loaded');

  // Load domain-specific tools from template
  loadDomainTools();

  logger.info({ port: config.port }, 'Starting osf-kg-server');

  const graphAvailable = await initializeGraph();
  logger.info({ graphAvailable }, 'Graph status');

  const vectorAvailable = await initVectorStore();
  logger.info({ vectorAvailable }, 'Vector store status');

  // Start MQTT bridge (non-blocking)
  startMqttBridge().catch(e => logger.warn({ err: e.message }, 'MQTT bridge start failed'));

  // Start Schema Sync (clone osf-schemas repo + poll for updates)
  const schemaSync = new SchemaSync({
    repoUrl: config.schemaRepo.url,
    localPath: config.schemaRepo.localPath,
    branch: config.schemaRepo.branch,
    pollIntervalMs: config.schemaRepo.pollIntervalMs,
    token: config.schemaRepo.token || undefined,
  });

  const rebuildFromSchemas = async () => {
    try {
      const basePath = schemaSync.getLocalPath();
      const profiles = loadAllProfiles(basePath);
      const sources = loadAllSources(basePath);
      const syncs = loadAllSyncs(basePath);

      if (profiles.length === 0) {
        logger.warn('[SchemaSync] No profiles found — skipping build');
        return;
      }

      const errors = validateSchemaRefs(profiles, sources, syncs);
      if (errors.length > 0) {
        logger.warn({ errorCount: errors.length }, '[SchemaSync] Schema validation errors — skipping build');
        return;
      }

      await buildFromSchemas(profiles, sources, syncs);
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[SchemaSync] Auto-rebuild failed');
    }
  };

  // Build mutex to prevent concurrent builds
  let buildInProgress = false;
  const safeBuild = async (reason: string) => {
    if (buildInProgress) {
      logger.info({ reason }, 'Build already in progress, skipping');
      return;
    }
    buildInProgress = true;
    try {
      logger.info({ reason }, 'Starting KG build...');
      await rebuildFromSchemas();
    } finally {
      buildInProgress = false;
    }
  };

  schemaSync.onUpdate = () => safeBuild('schema-change');
  setSchemaSync(schemaSync);

  schemaSync.start()
    .then(() => safeBuild('initial'))
    .catch(e => logger.warn({ err: e.message }, 'Schema sync start failed (schemas not available)'));

  // Scheduled builds (e.g., 09:00 + 19:00)
  const scheduleHours = config.buildScheduleHours;
  if (scheduleHours.length > 0) {
    logger.info({ scheduleHours }, 'Build schedule configured');
    let lastTriggeredHour = -1;
    setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      if (scheduleHours.includes(hour) && minute === 0 && lastTriggeredHour !== hour) {
        lastTriggeredHour = hour;
        safeBuild(`scheduled-${hour}:00`);
      }
      if (!scheduleHours.includes(hour)) {
        lastTriggeredHour = -1;
      }
    }, 30_000); // Check every 30s
  }

  // Express app
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json());

  // Mount all routes
  app.use(createRouter(graphAvailable, vectorAvailable));

  app.listen(config.port, async () => {
    logger.info({ port: config.port }, 'osf-kg-server listening');
    // Register with gateway after server is ready to accept connections
    await registerWithGateway();
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await deregisterFromGateway();
    await stopMqttBridge();
    await stopLiveUpdates();
    await schemaSync.stop();
    await closeGraph();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(e => {
  logger.fatal({ err: e.message }, 'Failed to start');
  process.exit(1);
});
