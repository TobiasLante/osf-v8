import mqtt, { MqttClient } from 'mqtt';
import { config } from './config';
import { logger } from './logger';
import { generateEmbedding, nodeToText } from './embedding-service';
import { upsertEmbedding } from './vector-store';

/**
 * MQTT Transform Service — subscribes to raw broker, validates/enriches,
 * publishes to curated broker.
 */

export interface TransformRule {
  topicPattern: string;       // e.g. "Factory/+/BDE/#"
  validation: {
    min?: number;
    max?: number;
    requiredFields?: string[];
  };
  enrichment: {
    kgLookup?: boolean;
    addTimestamp?: boolean;
    addEmbedding?: boolean;
  };
  republishTopic: string;      // e.g. "curated/Factory/..."
}

interface TransformStats {
  received: number;
  validated: number;
  rejected: number;
  published: number;
  errors: number;
}

let rawClient: MqttClient | null = null;
let curatedClient: MqttClient | null = null;
let stats: TransformStats = { received: 0, validated: 0, rejected: 0, published: 0, errors: 0 };
let running = false;

/**
 * Start the transform service.
 */
export async function startTransformService(): Promise<void> {
  if (running) return;

  const rules = config.mqtt.transformRules;
  if (rules.length === 0) {
    logger.info('No MQTT transform rules configured, skipping');
    return;
  }

  logger.info({ rawUrl: config.mqtt.rawUrl, curatedUrl: config.mqtt.curatedUrl, rules: rules.length }, 'Starting MQTT transform service');

  // Connect to raw broker
  rawClient = mqtt.connect(config.mqtt.rawUrl, {
    clientId: `kg-builder-transform-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });

  // Connect to curated broker
  curatedClient = mqtt.connect(config.mqtt.curatedUrl, {
    clientId: `kg-builder-curated-pub-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });

  await Promise.all([
    waitForConnect(rawClient, 'raw'),
    waitForConnect(curatedClient, 'curated'),
  ]);

  // Subscribe to all rule topic patterns on raw broker
  for (const rule of rules) {
    rawClient.subscribe(rule.topicPattern, { qos: 1 }, (err) => {
      if (err) logger.error({ topic: rule.topicPattern, err: err.message }, 'Subscribe failed');
      else logger.info({ topic: rule.topicPattern }, 'Subscribed to raw topic');
    });
  }

  // Message handler with concurrency limit
  let inflight = 0;
  const MAX_INFLIGHT = 100;

  rawClient.on('message', (topic, payload) => {
    stats.received++;
    if (inflight >= MAX_INFLIGHT) {
      stats.rejected++;
      return; // backpressure: drop message
    }
    inflight++;
    handleMessage(topic, payload, rules)
      .catch(e => {
        stats.errors++;
        logger.warn({ topic, err: e.message }, 'Transform error');
      })
      .finally(() => { inflight--; });
  });

  running = true;
  logger.info('MQTT transform service started');
}

/**
 * Stop the transform service.
 */
export async function stopTransformService(): Promise<void> {
  if (!running) return;
  running = false;

  rawClient?.end(true);
  curatedClient?.end(true);
  rawClient = null;
  curatedClient = null;
  logger.info('MQTT transform service stopped');
}

/**
 * Get transform stats.
 */
export function getTransformStats(): TransformStats & { running: boolean } {
  return { ...stats, running };
}

/**
 * Handle a single incoming message: validate, enrich, republish.
 */
async function handleMessage(topic: string, payload: Buffer, rules: TransformRule[]): Promise<void> {
  // Find matching rule
  const rule = rules.find(r => topicMatches(r.topicPattern, topic));
  if (!rule) return;

  // Parse payload
  let data: Record<string, any>;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    stats.rejected++;
    return; // non-JSON payloads are silently dropped
  }

  // Validate
  if (!validateMessage(data, rule.validation)) {
    stats.rejected++;
    return;
  }
  stats.validated++;

  // Enrich
  const enriched = await enrichMessage(data, topic, rule.enrichment);

  // Build curated topic — strip wildcards and resolve to concrete topic
  const finalTopic = resolveCuratedTopic(rule.republishTopic, topic);

  // Publish to curated broker
  if (curatedClient?.connected) {
    curatedClient.publish(finalTopic, JSON.stringify(enriched), { qos: 1 });
    stats.published++;
  }
}

/**
 * Resolve curated topic from rule template + actual source topic.
 * Wildcards (+, #) are replaced with the matching segments from the source topic.
 * If the template is purely wildcards (e.g. "curated/Factory/#"), fall back to "curated/{topic}".
 */
function resolveCuratedTopic(template: string, sourceTopic: string): string {
  // If template contains wildcards, replace them with source segments
  if (template.includes('+') || template.includes('#')) {
    const tmplParts = template.split('/');
    const srcParts = sourceTopic.split('/');
    const result: string[] = [];

    for (let i = 0; i < tmplParts.length; i++) {
      if (tmplParts[i] === '#') {
        // '#' consumes all remaining source segments
        result.push(...srcParts.slice(i));
        break;
      } else if (tmplParts[i] === '+') {
        result.push(srcParts[i] || '_');
      } else {
        result.push(tmplParts[i]);
      }
    }
    return result.join('/');
  }

  // No wildcards — use template as-is (concrete topic)
  return template;
}

/**
 * Validate message against rule.
 */
function validateMessage(data: Record<string, any>, validation: TransformRule['validation']): boolean {
  if (validation.requiredFields) {
    for (const field of validation.requiredFields) {
      if (data[field] === undefined || data[field] === null) return false;
    }
  }

  // Check numeric range for all numeric values
  if (validation.min !== undefined || validation.max !== undefined) {
    for (const value of Object.values(data)) {
      if (typeof value === 'number') {
        if (validation.min !== undefined && value < validation.min) return false;
        if (validation.max !== undefined && value > validation.max) return false;
      }
    }
  }

  return true;
}

/**
 * Enrich message with timestamps, KG labels, embeddings.
 */
async function enrichMessage(
  data: Record<string, any>,
  topic: string,
  enrichment: TransformRule['enrichment'],
): Promise<Record<string, any>> {
  const enriched = { ...data };

  if (enrichment.addTimestamp) {
    enriched._enriched_at = new Date().toISOString();
    enriched._source_topic = topic;
  }

  // kgLookup: planned for v9.1 — would attach KG node properties to the message
  // if (enrichment.kgLookup) { ... }

  if (enrichment.addEmbedding && data.id) {
    try {
      const text = nodeToText(data.id, data.type || 'Unknown', data);
      const embedding = await generateEmbedding(text);
      await upsertEmbedding(data.id, data.type || 'MQTTNode', text, embedding);
      enriched._embedded = true;
    } catch {
      // Embedding failure is non-critical
    }
  }

  return enriched;
}

/**
 * MQTT topic wildcard matching.
 */
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === '#') return true;
  const patParts = pattern.split('/');
  const topParts = topic.split('/');

  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === '#') return true;
    if (patParts[i] === '+') continue;
    if (i >= topParts.length || patParts[i] !== topParts[i]) return false;
  }

  return patParts.length === topParts.length;
}

/**
 * Wait for MQTT client to connect.
 */
function waitForConnect(client: MqttClient, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.warn({ broker: name }, 'MQTT connect timeout — continuing anyway');
      resolve();
    }, 10_000);

    client.on('connect', () => {
      clearTimeout(timer);
      logger.info({ broker: name }, 'MQTT connected');
      resolve();
    });

    client.on('error', (err) => {
      logger.warn({ broker: name, err: err.message }, 'MQTT connection error');
    });
  });
}
