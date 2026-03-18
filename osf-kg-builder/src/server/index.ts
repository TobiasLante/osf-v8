import express from 'express';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { loadDomainConfig } from '../shared/domain-config';
import { initializeGraph, closeGraph } from '../shared/cypher-utils';
import { initVectorStore } from '../shared/vector-store';
import { startMqttBridge, stopMqttBridge } from './mqtt-bridge';
import { createRouter } from './routes';
import { loadDomainTools } from './kg-tools';
import { registerWithGateway, deregisterFromGateway } from './register-mcp';
import { SchemaSync } from '../builder/schema-sync';
import { loadAllProfiles, loadAllOpcUaMappings, loadAllUnsMappings, validateSchemaRefs } from '../builder/schema-loader';
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
      const opcuaMappings = loadAllOpcUaMappings(basePath);
      const unsMappings = loadAllUnsMappings(basePath);

      if (profiles.length === 0) {
        logger.warn('[SchemaSync] No profiles found — skipping build');
        return;
      }

      const errors = validateSchemaRefs(profiles, opcuaMappings, unsMappings);
      if (errors.length > 0) {
        logger.warn({ errorCount: errors.length }, '[SchemaSync] Schema validation errors — skipping build');
        return;
      }

      await buildFromSchemas(profiles, opcuaMappings, unsMappings);
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[SchemaSync] Auto-rebuild failed');
    }
  };

  schemaSync.onUpdate = rebuildFromSchemas;

  schemaSync.start()
    .then(() => rebuildFromSchemas())
    .catch(e => logger.warn({ err: e.message }, 'Schema sync start failed (schemas not available)'));

  // Express app
  const app = express();
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
