// Historian — MQTT subscriber with buffered batch insert

import mqtt from 'mqtt';
import { batchInsert, type HistoryRow } from './db.js';

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://192.168.178.150:31883';
const FLUSH_INTERVAL_MS = parseInt(process.env.HISTORIAN_FLUSH_MS || '5000');
const MAX_BUFFER = 10_000;

let client: mqtt.MqttClient | null = null;
let buffer: HistoryRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let stats = { received: 0, inserted: 0, errors: 0, flushes: 0 };

// Parse topic: Factory/{Machine}/{WorkOrder}/{Tool}/{Category}/{Variable}
function parseTopic(topic: string): { machine: string; workOrder: string | null; toolId: string | null; category: string; variable: string } | null {
  const parts = topic.split('/');
  if (parts.length < 6 || parts[0] !== 'Factory') return null;

  return {
    machine: parts[1],
    workOrder: parts[2] === '---' ? null : parts[2],
    toolId: parts[3] === '---' ? null : parts[3],
    category: parts[4],
    variable: parts.slice(5).join('/'), // Handle nested variables
  };
}

function onMessage(topic: string, payload: Buffer): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;

  let value: number | null = null;
  let valueText: string | null = null;
  let unit: string | null = null;

  try {
    const json = JSON.parse(payload.toString());
    const raw = json.Value ?? json.value;

    if (typeof raw === 'number') {
      value = raw;
    } else if (typeof raw === 'string') {
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        value = num;
      } else {
        valueText = raw.slice(0, 500);
      }
    } else if (raw !== undefined && raw !== null) {
      valueText = String(raw).slice(0, 500);
    }

    unit = json.Unit || json.unit || null;
  } catch {
    // Non-JSON payload — store as text
    valueText = payload.toString().slice(0, 500);
  }

  stats.received++;
  buffer.push({
    machine: parsed.machine,
    category: parsed.category,
    variable: parsed.variable,
    value,
    value_text: valueText,
    unit,
    work_order: parsed.workOrder,
    tool_id: parsed.toolId,
    topic,
  });

  // Prevent unbounded growth
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(-MAX_BUFFER);
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0); // Take all, clear buffer
  try {
    const count = await batchInsert(batch);
    stats.inserted += count;
    stats.flushes++;
    if (stats.flushes % 100 === 0) {
      console.log(`[subscriber] Stats: received=${stats.received}, inserted=${stats.inserted}, errors=${stats.errors}, flushes=${stats.flushes}`);
    }
  } catch (err: any) {
    stats.errors++;
    console.error(`[subscriber] Batch insert failed (${batch.length} rows): ${err.message}`);
    // Put rows back at front of buffer for retry (but limit total)
    if (buffer.length < MAX_BUFFER) {
      buffer.unshift(...batch.slice(0, MAX_BUFFER - buffer.length));
    }
  }
}

export function getStats() {
  return { ...stats, bufferSize: buffer.length };
}

export async function start(): Promise<void> {
  console.log(`[subscriber] Connecting to ${MQTT_BROKER}...`);

  client = mqtt.connect(MQTT_BROKER, {
    clientId: `osf-historian-${Date.now()}`,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: true,
  });

  client.on('connect', () => {
    console.log('[subscriber] MQTT connected');
    client!.subscribe('Factory/#', { qos: 0 }, (err) => {
      if (err) console.error(`[subscriber] Subscribe error: ${err.message}`);
      else console.log('[subscriber] Subscribed to Factory/#');
    });
  });

  client.on('message', onMessage);

  client.on('error', (err) => {
    console.error(`[subscriber] MQTT error: ${err.message}`);
  });

  client.on('close', () => {
    console.log('[subscriber] MQTT disconnected, reconnecting...');
  });

  // Start flush timer
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  console.log(`[subscriber] Flush interval: ${FLUSH_INTERVAL_MS}ms`);
}

export async function stop(): Promise<void> {
  if (flushTimer) clearInterval(flushTimer);
  await flush(); // Final flush
  if (client) {
    client.end(true);
    client = null;
  }
  console.log('[subscriber] Stopped');
}
