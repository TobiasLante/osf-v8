#!/usr/bin/env node
import { runAllChecks, formatVerifyReport, VerifyOptions } from './verify-checks';
import { logger } from '../shared/logger';

/**
 * Verify CLI — Post-build onboarding test suite.
 *
 * Usage:
 *   npm run verify -- --domain discrete
 *   npm run verify -- --domain pharma --with-server
 *   npm run verify -- --domain discrete --with-server --server-url http://kg-server:8035
 */

function parseArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  const opts: VerifyOptions = {
    domain: process.env.DOMAIN || 'discrete',
    withServer: false,
    serverUrl: 'http://localhost:8035',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--domain':
      case '-d':
        opts.domain = args[++i] || opts.domain;
        break;
      case '--with-server':
        opts.withServer = true;
        break;
      case '--server-url':
        opts.serverUrl = args[++i] || opts.serverUrl;
        break;
      default:
        if (args[i].startsWith('-')) {
          logger.warn({ arg: args[i] }, 'Unknown argument');
        }
    }
  }

  // Set DOMAIN env for domain-config to pick up
  process.env.DOMAIN = opts.domain;

  return opts;
}

async function main() {
  const opts = parseArgs();
  logger.info({ domain: opts.domain, withServer: opts.withServer }, 'Verify CLI starting');

  const report = await runAllChecks(opts);

  // JSON to stdout (machine-readable)
  console.log(JSON.stringify(report, null, 2));

  // Formatted to stderr (human-readable)
  console.error(formatVerifyReport(report));

  process.exit(report.allPassed ? 0 : 1);
}

main().catch(e => {
  logger.fatal({ err: e.message }, 'Verify failed');
  process.exit(1);
});
