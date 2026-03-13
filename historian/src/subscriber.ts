// Historian v2 — MQTT Subscriber
// QoS 1 + persistent session, route engine, backpressure, explorer ring-buffer

import mqtt from 'mqtt';
import type { HistoryRow, TableRow } from './db.js';
import { resolveRoute } from './config-manager.js';
import { pushRow, pushLegacyRow, getBufferFillPercent } from './flush-engine.js';
import { parseTopic, getActiveSubscriptions } from './topic-profiles.js';

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const BACKPRESSURE_HIGH = 80; // % — pause MQTT
const BACKPRESSURE_LOW = 50;  // % — resume MQTT

let client: mqtt.MqttClient | null = null;
let paused = false;
let stats = { received: 0, routed: 0, unrouted: 0, pauses: 0 };

// Explorer ring-buffer: last 1000 messages
const EXPLORER_SIZE = 1000;
const explorerBuffer: ExplorerMessage[] = [];
let explorerIndex = 0;

export interface ExplorerMessage {
  ts: string;
  topic: string;
  machine: string;
  category: string;
  variable: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  routed_to: string | null;
}

// ─── Message Handler ──────────────────────────────────────────────────────────

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
    valueText = payload.toString().slice(0, 500);
  }

  stats.received++;

  // Route to target table
  const route = resolveRoute(parsed.category);
  let routedTo: string | null = null;

  if (route) {
    const tableRow: TableRow = {
      machine: parsed.machine,
      variable: parsed.variable,
      value,
      value_text: valueText,
      unit,
      work_order: parsed.workOrder,
      tool_id: parsed.toolId,
    };
    pushRow(route.target_table, route.flush_interval_s, tableRow);
    routedTo = route.target_table;
    stats.routed++;
  } else {
    stats.unrouted++;
  }

  // Also push to legacy uns_history (keeps MCP tools working)
  const legacyRow: HistoryRow = {
    machine: parsed.machine,
    category: parsed.category,
    variable: parsed.variable,
    value,
    value_text: valueText,
    unit,
    work_order: parsed.workOrder,
    tool_id: parsed.toolId,
    topic,
  };
  pushLegacyRow(legacyRow);

  // Explorer ring-buffer
  const explorerMsg: ExplorerMessage = {
    ts: new Date().toISOString(),
    topic,
    machine: parsed.machine,
    category: parsed.category,
    variable: parsed.variable,
    value,
    value_text: valueText,
    unit,
    routed_to: routedTo,
  };

  if (explorerBuffer.length < EXPLORER_SIZE) {
    explorerBuffer.push(explorerMsg);
  } else {
    explorerBuffer[explorerIndex % EXPLORER_SIZE] = explorerMsg;
  }
  explorerIndex++;

  // Backpressure check
  checkBackpressure();
}

// ─── Backpressure ─────────────────────────────────────────────────────────────

function checkBackpressure(): void {
  if (!client) return;

  const fill = getBufferFillPercent();

  if (!paused && fill >= BACKPRESSURE_HIGH) {
    paused = true;
    stats.pauses++;
    // Unsubscribe all active subscriptions to stop receiving messages
    for (const sub of getActiveSubscriptions()) {
      client.unsubscribe(sub);
    }
    console.warn(`[subscriber] BACKPRESSURE: paused at ${fill.toFixed(0)}% buffer fill`);
  } else if (paused && fill <= BACKPRESSURE_LOW) {
    paused = false;
    for (const sub of getActiveSubscriptions()) {
      client.subscribe(sub, { qos: 1 });
    }
    console.log(`[subscriber] BACKPRESSURE: resumed at ${fill.toFixed(0)}% buffer fill`);
  }
}

// ─── Explorer ─────────────────────────────────────────────────────────────────

export function getExplorerMessages(filter?: {
  machine?: string;
  category?: string;
  variable?: string;
}): ExplorerMessage[] {
  let messages: ExplorerMessage[];

  if (explorerBuffer.length < EXPLORER_SIZE) {
    messages = [...explorerBuffer];
  } else {
    // Ring-buffer: read from explorerIndex to end, then start to explorerIndex
    const idx = explorerIndex % EXPLORER_SIZE;
    messages = [
      ...explorerBuffer.slice(idx),
      ...explorerBuffer.slice(0, idx),
    ];
  }

  if (filter) {
    if (filter.machine) {
      const m = filter.machine.toLowerCase();
      messages = messages.filter(msg => msg.machine.toLowerCase().includes(m));
    }
    if (filter.category) {
      const c = filter.category.toLowerCase();
      messages = messages.filter(msg => msg.category.toLowerCase().includes(c));
    }
    if (filter.variable) {
      const v = filter.variable.toLowerCase();
      messages = messages.filter(msg => msg.variable.toLowerCase().includes(v));
    }
  }

  return messages.reverse(); // Newest first
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getSubscriberStats() {
  return {
    ...stats,
    paused,
    mqttConnected: client?.connected || false,
    explorerSize: Math.min(explorerBuffer.length, EXPLORER_SIZE),
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  console.log(`[subscriber] Connecting to ${MQTT_BROKER} (QoS 1, persistent session)...`);

  client = mqtt.connect(MQTT_BROKER, {
    clientId: 'osf-historian-v2',
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: false, // Persistent session — no message loss
  });

  client.on('connect', () => {
    console.log('[subscriber] MQTT connected');
    const subs = getActiveSubscriptions();
    for (const sub of subs) {
      client!.subscribe(sub, { qos: 1 }, (err) => {
        if (err) console.error(`[subscriber] Subscribe error for ${sub}: ${err.message}`);
        else console.log(`[subscriber] Subscribed to ${sub} (QoS 1)`);
      });
    }
  });

  client.on('message', onMessage);

  client.on('error', (err) => {
    console.error(`[subscriber] MQTT error: ${err.message}`);
  });

  client.on('close', () => {
    console.log('[subscriber] MQTT disconnected, reconnecting...');
  });
}

export async function stop(): Promise<void> {
  if (client) {
    client.end(true);
    client = null;
  }
  console.log('[subscriber] Stopped');
}
