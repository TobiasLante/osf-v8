import mqtt, { MqttClient } from 'mqtt';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { generateEmbedding, nodeToText } from '../shared/embedding-service';
import { upsertEmbedding } from '../shared/vector-store';
import { vertexCypher, batchCypher } from '../shared/cypher-utils';

/**
 * Unified MQTT Bridge — subscribes to raw broker, validates/enriches,
 * and writes directly to KG (Neo4j). No second broker needed.
 *
 * Merged from mqtt-transform.ts + mqtt-kg-bridge.ts.
 */

export interface TransformRule {
  topicPattern: string;
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
  republishTopic: string;
}

interface BridgeStats {
  received: number;
  validated: number;
  rejected: number;
  kgUpdated: number;
  errors: number;
}

let client: MqttClient | null = null;
let stats: BridgeStats = { received: 0, validated: 0, rejected: 0, kgUpdated: 0, errors: 0 };
let running = false;
let batchBuffer: string[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

const BATCH_INTERVAL_MS = 2000;
const BATCH_MAX_SIZE = 50;

/**
 * Start the unified MQTT bridge: subscribe → validate → enrich → KG.
 */
export async function startMqttBridge(): Promise<void> {
  if (running) return;

  const rules = config.mqtt.transformRules;
  if (rules.length === 0) {
    logger.info('No MQTT transform rules configured, skipping bridge');
    return;
  }

  logger.info({ rawUrl: config.mqtt.rawUrl, rules: rules.length }, 'Starting unified MQTT bridge');

  client = mqtt.connect(config.mqtt.rawUrl, {
    clientId: `kg-server-bridge-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('MQTT bridge connect timeout — continuing anyway');
      resolve();
    }, 10_000);

    client!.on('connect', () => {
      clearTimeout(timer);
      logger.info('MQTT bridge connected to raw broker');

      // Subscribe to all rule topic patterns
      for (const rule of rules) {
        client!.subscribe(rule.topicPattern, { qos: 1 }, (err) => {
          if (err) logger.error({ topic: rule.topicPattern, err: err.message }, 'Subscribe failed');
          else logger.info({ topic: rule.topicPattern }, 'Subscribed');
        });
      }

      resolve();
    });

    client!.on('error', (err) => {
      logger.warn({ err: err.message }, 'MQTT bridge error');
    });
  });

  // Message handler with concurrency limit
  let inflight = 0;
  const MAX_INFLIGHT = 100;

  client.on('message', (topic, payload) => {
    stats.received++;
    if (inflight >= MAX_INFLIGHT) {
      stats.rejected++;
      return;
    }
    inflight++;
    handleMessage(topic, payload, rules)
      .catch(e => {
        stats.errors++;
        logger.warn({ topic, err: e.message }, 'Bridge error');
      })
      .finally(() => { inflight--; });
  });

  // Periodic batch flush to KG
  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS);

  running = true;
  logger.info('Unified MQTT bridge started');
}

/**
 * Stop the MQTT bridge.
 */
export async function stopMqttBridge(): Promise<void> {
  if (!running) return;
  running = false;

  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  await flushBatch();

  client?.end(true);
  client = null;
  logger.info('MQTT bridge stopped');
}

/**
 * Get bridge stats.
 */
export function getBridgeStats(): BridgeStats & { running: boolean; bufferSize: number } {
  return { ...stats, running, bufferSize: batchBuffer.length };
}

/**
 * Handle a single incoming message: validate → enrich → buffer for KG.
 */
async function handleMessage(topic: string, payload: Buffer, rules: TransformRule[]): Promise<void> {
  const rule = rules.find(r => topicMatches(r.topicPattern, topic));
  if (!rule) return;

  let data: Record<string, any>;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    stats.rejected++;
    return;
  }

  // Validate
  if (!validateMessage(data, rule.validation)) {
    stats.rejected++;
    return;
  }
  stats.validated++;

  // Enrich
  if (rule.enrichment.addTimestamp) {
    data._enriched_at = new Date().toISOString();
    data._source_topic = topic;
  }

  // Optional embedding
  if (rule.enrichment.addEmbedding && data.id) {
    try {
      const text = nodeToText(data.id, data.type || 'Unknown', data);
      const embedding = await generateEmbedding(text);
      await upsertEmbedding(data.id, data.type || 'MQTTNode', text, embedding);
    } catch {
      // Non-critical
    }
  }

  // Extract node info and buffer Cypher for KG write
  const nodeId = data.id || data.machine_id || data.sensor_id || data.equipment_id;
  if (!nodeId) return;

  const label = deriveLabel(topic, data);
  if (!label) return;

  const props: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith('_') && k !== 'id' && v !== null && v !== undefined) {
      props[k] = v;
    }
  }
  props.last_mqtt_update = new Date().toISOString();

  const cypher = vertexCypher(label, String(nodeId), props);
  batchBuffer.push(cypher);

  if (batchBuffer.length >= BATCH_MAX_SIZE) {
    flushBatch();
  }
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
 * Sanitize a string to be a valid Neo4j label.
 */
function sanitizeLabel(raw: string): string | null {
  const cleaned = String(raw).replace(/[^a-zA-Z0-9_]/g, '');
  return cleaned.length > 0 && cleaned.length <= 64 ? cleaned : null;
}

/**
 * Derive a KG node label from MQTT topic and message data.
 */
function deriveLabel(topic: string, data: Record<string, any>): string | null {
  if (data.type) return sanitizeLabel(data.type);
  if (data.node_label) return sanitizeLabel(data.node_label);

  const parts = topic.split('/').filter(Boolean);

  if (parts.some(p => p.toLowerCase().includes('bde'))) return 'BDEEvent';
  if (parts.some(p => p.toLowerCase().includes('sensor'))) return 'SensorReading';
  if (parts.some(p => p.toLowerCase().includes('machine'))) return 'Machine';
  if (parts.some(p => p.toLowerCase().includes('alarm'))) return 'Alarm';
  if (parts.some(p => p.toLowerCase().includes('order'))) return 'ProductionOrder';

  if (parts.length >= 2) return sanitizeLabel(parts[parts.length - 2]) || 'MQTTNode';

  return 'MQTTNode';
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
 * Flush buffered Cypher queries to Neo4j.
 */
async function flushBatch(): Promise<void> {
  if (batchBuffer.length === 0 || flushing) return;
  flushing = true;

  const queries = [...batchBuffer];
  batchBuffer = [];

  try {
    const result = await batchCypher(queries);
    stats.kgUpdated += result.success;
    if (result.failed > 0) {
      stats.errors += result.failed;
      logger.warn({ success: result.success, failed: result.failed }, 'Bridge batch partial failure');
    }
  } catch (e: any) {
    stats.errors += queries.length;
    logger.error({ err: e.message, batchSize: queries.length }, 'Bridge batch flush failed');
  } finally {
    flushing = false;
  }
}
