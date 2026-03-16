import mqtt, { MqttClient } from 'mqtt';
import { config } from './config';
import { logger } from './logger';
import { vertexCypher, batchCypher } from './cypher-utils';

/**
 * MQTT-KG Bridge — subscribes to curated broker and updates KG nodes/edges in real-time.
 * Curated messages with structured data get merged into the Knowledge Graph.
 */

interface BridgeStats {
  received: number;
  nodesUpdated: number;
  errors: number;
}

let client: MqttClient | null = null;
let stats: BridgeStats = { received: 0, nodesUpdated: 0, errors: 0 };
let running = false;
let batchBuffer: string[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

const BATCH_INTERVAL_MS = 2000;
const BATCH_MAX_SIZE = 50;

/**
 * Start the KG bridge: subscribe to curated broker, update KG.
 */
export async function startKgBridge(): Promise<void> {
  if (running) return;

  logger.info({ curatedUrl: config.mqtt.curatedUrl }, 'Starting MQTT-KG Bridge');

  client = mqtt.connect(config.mqtt.curatedUrl, {
    clientId: `kg-builder-bridge-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('KG Bridge MQTT connect timeout — continuing anyway');
      resolve();
    }, 10_000);

    client!.on('connect', () => {
      clearTimeout(timer);
      logger.info('KG Bridge connected to curated broker');

      // Subscribe to curated KG events
      client!.subscribe('curated/#', { qos: 1 });
      resolve();
    });

    client!.on('error', (err) => {
      logger.warn({ err: err.message }, 'KG Bridge MQTT error');
    });
  });

  client.on('message', (topic, payload) => {
    stats.received++;
    try {
      handleCuratedMessage(topic, payload);
    } catch (e: any) {
      stats.errors++;
    }
  });

  // Periodic batch flush
  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS);

  running = true;
  logger.info('MQTT-KG Bridge started');
}

/**
 * Stop the KG bridge.
 */
export async function stopKgBridge(): Promise<void> {
  if (!running) return;
  running = false;

  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  await flushBatch();

  client?.end(true);
  client = null;
  logger.info('MQTT-KG Bridge stopped');
}

/**
 * Get bridge stats.
 */
export function getBridgeStats(): BridgeStats & { running: boolean; bufferSize: number } {
  return { ...stats, running, bufferSize: batchBuffer.length };
}

/**
 * Handle incoming curated message — extract node data, buffer Cypher.
 */
function handleCuratedMessage(topic: string, payload: Buffer): void {
  let data: Record<string, any>;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return; // skip non-JSON
  }

  // Need at minimum an id and some type info
  const nodeId = data.id || data.machine_id || data.sensor_id || data.equipment_id;
  if (!nodeId) return;

  // Derive label from topic or data
  const label = deriveLabel(topic, data);
  if (!label) return;

  // Build properties (strip internal enrichment fields)
  const props: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith('_') && k !== 'id' && v !== null && v !== undefined) {
      props[k] = v;
    }
  }
  props.last_mqtt_update = new Date().toISOString();

  // Generate Cypher and buffer it
  const cypher = vertexCypher(label, String(nodeId), props);
  batchBuffer.push(cypher);

  // Flush if buffer is full
  if (batchBuffer.length >= BATCH_MAX_SIZE) {
    flushBatch();
  }
}

/**
 * Sanitize a string to be a valid AGE label (alphanumeric + underscore only).
 */
function sanitizeLabel(raw: string): string | null {
  const cleaned = String(raw).replace(/[^a-zA-Z0-9_]/g, '');
  return cleaned.length > 0 && cleaned.length <= 64 ? cleaned : null;
}

/**
 * Derive a KG node label from MQTT topic and message data.
 */
function deriveLabel(topic: string, data: Record<string, any>): string | null {
  // Explicit type in data — sanitize to prevent injection
  if (data.type) return sanitizeLabel(data.type);
  if (data.node_label) return sanitizeLabel(data.node_label);

  // Derive from topic structure: curated/Factory/{site}/BDE/{...}
  const parts = topic.split('/').filter(Boolean);

  // Remove "curated" prefix
  const cleaned = parts[0] === 'curated' ? parts.slice(1) : parts;

  // Look for known patterns
  if (cleaned.some(p => p.toLowerCase().includes('bde'))) return 'BDEEvent';
  if (cleaned.some(p => p.toLowerCase().includes('sensor'))) return 'SensorReading';
  if (cleaned.some(p => p.toLowerCase().includes('machine'))) return 'Machine';
  if (cleaned.some(p => p.toLowerCase().includes('alarm'))) return 'Alarm';
  if (cleaned.some(p => p.toLowerCase().includes('order'))) return 'ProductionOrder';

  // Fallback: use the second-to-last topic segment as label (sanitized)
  if (cleaned.length >= 2) return sanitizeLabel(cleaned[cleaned.length - 2]) || 'MQTTNode';

  return 'MQTTNode';
}

/**
 * Flush buffered Cypher queries to the graph.
 * Uses a lock to prevent concurrent flushes from racing.
 */
async function flushBatch(): Promise<void> {
  if (batchBuffer.length === 0 || flushing) return;
  flushing = true;

  const queries = [...batchBuffer];
  batchBuffer = [];

  try {
    const result = await batchCypher(queries);
    stats.nodesUpdated += result.success;
    if (result.failed > 0) {
      stats.errors += result.failed;
      logger.warn({ success: result.success, failed: result.failed }, 'KG Bridge batch partial failure');
    }
  } catch (e: any) {
    stats.errors += queries.length;
    logger.error({ err: e.message, batchSize: queries.length }, 'KG Bridge batch flush failed');
  } finally {
    flushing = false;
  }
}
