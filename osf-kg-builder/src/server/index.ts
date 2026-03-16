import express from 'express';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { loadDomainConfig } from '../shared/domain-config';
import { initializeGraph, closeGraph } from '../shared/cypher-utils';
import { initVectorStore } from '../shared/vector-store';
import { startMqttBridge, stopMqttBridge } from './mqtt-bridge';
import { createRouter } from './routes';
import { loadDomainTools } from './kg-tools';

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

  // Express app
  const app = express();
  app.use(express.json());

  // Mount all routes
  app.use(createRouter(graphAvailable, vectorAvailable));

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'osf-kg-server listening');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await stopMqttBridge();
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
