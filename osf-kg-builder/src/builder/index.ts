#!/usr/bin/env node
import { runBuildPipeline, PipelineOptions } from './pipeline';
import { logger } from '../shared/logger';

/**
 * CLI entrypoint for the KG Builder batch job.
 *
 * Usage:
 *   npm run build-kg -- --domain discrete
 *   npm run build-kg -- --domain pharma --skip-discovery
 */

function parseArgs(): PipelineOptions {
  const args = process.argv.slice(2);
  const options: PipelineOptions = {
    domain: process.env.DOMAIN || 'manufacturing',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--domain':
      case '-d':
        options.domain = args[++i] || options.domain;
        break;
      case '--sm-profile':
        options.smProfileUrl = args[++i];
        break;
      case '--auth-token':
        options.authToken = args[++i];
        break;
      case '--mtp-urls':
        options.mtpUrls = (args[++i] || '').split(',').filter(Boolean);
        break;
      case '--i3x-endpoints':
        options.i3xEndpoints = (args[++i] || '').split(',').filter(Boolean);
        break;
      case '--skip-discovery':
        options.skipDiscovery = true;
        break;
      default:
        if (args[i].startsWith('-')) {
          logger.warn({ arg: args[i] }, 'Unknown argument');
        }
    }
  }

  // Set DOMAIN env for domain-config to pick up
  process.env.DOMAIN = options.domain;

  return options;
}

async function main() {
  const options = parseArgs();
  logger.info({ domain: options.domain, skipDiscovery: !!options.skipDiscovery }, 'KG Builder CLI starting');

  const result = await runBuildPipeline(options);

  if (result.status === 'complete') {
    logger.info({
      runId: result.runId,
      nodes: result.totalNodes,
      edges: result.totalEdges,
      accuracy: result.accuracy,
    }, 'Build complete');
    process.exit(0);
  } else {
    logger.error({ runId: result.runId, error: result.error }, 'Build failed');
    process.exit(1);
  }
}

main().catch(e => {
  logger.fatal({ err: e.message }, 'Fatal error');
  process.exit(1);
});
