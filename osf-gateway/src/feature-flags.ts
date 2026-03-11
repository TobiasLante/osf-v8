/**
 * Feature Flags — ENV-based, changeable via K8s ConfigMap restart (no code deploy).
 *
 * Usage:
 *   import { ff } from '../feature-flags';
 *   if (ff.forceDiscussion) { ... }
 */

import { logger } from './logger';

function flag(envKey: string, fallback: boolean): boolean {
  const v = process.env[envKey];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

function str(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback;
}

export const ff = {
  /** Override intent classifier — always route to discussion pipeline */
  get forceDiscussion(): boolean { return flag('FF_FORCE_DISCUSSION', false); },

  /** Force simple pipeline (bypass intent classifier) */
  get forceSimple(): boolean { return flag('FF_FORCE_SIMPLE', false); },

  /** Skip KG phase in discussion pipeline (if KG is broken) */
  get disableKgPhase(): boolean { return flag('FF_DISABLE_KG_PHASE', false); },

  /** Skip debate round in discussion pipeline */
  get disableDebate(): boolean { return flag('FF_DISABLE_DEBATE', false); },

  /** Custom message shown when LLM is unavailable */
  get llmFallbackMessage(): string {
    return str('FF_LLM_FALLBACK_MESSAGE',
      'Der KI-Server ist vorübergehend nicht erreichbar. Bitte versuche es in einigen Minuten erneut.');
  },

  /** Enable /metrics endpoint (Prometheus) */
  get enableMetrics(): boolean { return flag('FF_ENABLE_METRICS', false); },

  /** Enable MCP circuit breakers */
  get enableMcpCircuitBreaker(): boolean { return flag('FF_ENABLE_MCP_CB', true); },
};

/** Log all active feature flags at startup */
export function logFeatureFlags(): void {
  const active: string[] = [];
  if (ff.forceDiscussion) active.push('FF_FORCE_DISCUSSION');
  if (ff.forceSimple) active.push('FF_FORCE_SIMPLE');
  if (ff.disableKgPhase) active.push('FF_DISABLE_KG_PHASE');
  if (ff.disableDebate) active.push('FF_DISABLE_DEBATE');
  if (ff.enableMetrics) active.push('FF_ENABLE_METRICS');
  if (!ff.enableMcpCircuitBreaker) active.push('FF_ENABLE_MCP_CB=false');
  if (process.env.FF_LLM_FALLBACK_MESSAGE) active.push('FF_LLM_FALLBACK_MESSAGE');

  if (active.length > 0) {
    logger.info({ flags: active }, 'Active feature flags');
  }
}
