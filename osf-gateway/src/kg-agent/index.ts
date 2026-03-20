// KG Agent — Auto-discovery of machines and sensors from MQTT UNS
// Subscribes to Factory/#, creates KG vertices/edges via Cypher on Apache AGE

import mqtt from 'mqtt';
import pg from 'pg';
import { logger } from '../logger';

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const FLUSH_INTERVAL_MS = 15_000;

// KG database (erpdb with Apache AGE) — shared with tools.ts
export const kgPool = new pg.Pool({
  host: process.env.ERP_DB_HOST || 'localhost',
  port: parseInt(process.env.ERP_DB_PORT || '5432'),
  database: process.env.ERP_DB_NAME || 'erpdb',
  user: process.env.ERP_DB_USER || 'admin',
  password: process.env.ERP_DB_PASSWORD || '',
  max: 3,
  idleTimeoutMillis: 30_000,
});

const DB_SCHEMA = process.env.DB_SCHEMA || 'llm_test_v3';
const GRAPH_NAME = 'factory_graph';

// Known entities (avoid re-creating on every message)
const knownMachines = new Set<string>();
const knownSensors = new Set<string>();

// Pending value updates (debounced)
interface PendingUpdate {
  lastValue: number | string | null;
  unit: string | null;
  category: string;
  lastSeen: string;
}
const MAX_PENDING = 10_000;
const pendingUpdates = new Map<string, PendingUpdate>();

let mqttClient: mqtt.MqttClient | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let kgAvailable = false;
let stats = { discovered: 0, updates: 0, errors: 0 };

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '').slice(0, 200);
}

function escapeVal(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  return `'${escapeStr(String(v).slice(0, 500))}'`;
}

async function execCypher(cypher: string): Promise<void> {
  const client = await kgPool.connect();
  try {
    await client.query("LOAD 'age'");
    await client.query(`SET search_path = ag_catalog, "${DB_SCHEMA}", public`);
    await client.query(`SELECT * FROM cypher('${GRAPH_NAME}', $$ ${cypher} $$) AS (r agtype)`);
  } finally {
    client.release();
  }
}

async function batchExecCypher(queries: string[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const q of queries) {
    try {
      await execCypher(q);
      success++;
    } catch (err: any) {
      failed++;
      if (!err.message?.includes('already exists')) {
        logger.warn({ err: err.message, cypher: q.slice(0, 100) }, 'KG Agent: Cypher failed');
      }
    }
  }
  return { success, failed };
}

async function checkKgAvailable(): Promise<boolean> {
  try {
    const client = await kgPool.connect();
    try {
      await client.query("LOAD 'age'");
      await client.query(`SET search_path = ag_catalog, "${DB_SCHEMA}", public`);
      await client.query(`SELECT * FROM cypher('${GRAPH_NAME}', $$ MATCH (n) RETURN n LIMIT 1 $$) AS (r agtype)`);
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

// ─── Topic Profile Parsing (loaded from Historian API) ─────────────────────

interface TopicProfile {
  id: number;
  name: string;
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  enabled: boolean;
  priority: number;
}

const HISTORIAN_URL = process.env.HISTORIAN_URL || 'http://localhost:8030';
const PROFILE_RELOAD_MS = 30_000;

// Builtin fallback — identical to Factory profile
const BUILTIN_PROFILES: TopicProfile[] = [{
  id: -1, name: 'Factory (default)', prefix: 'Factory', subscription: 'Factory/#',
  seg_machine: 1, seg_work_order: 2, seg_tool_id: 3, seg_category: 4,
  seg_variable_start: 5, null_marker: '---', enabled: true, priority: 100,
}];

let activeProfiles: TopicProfile[] = [...BUILTIN_PROFILES];
let profileReloadTimer: NodeJS.Timeout | null = null;

async function loadProfilesFromHistorian(): Promise<void> {
  try {
    const resp = await fetch(`${HISTORIAN_URL}/profiles`, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { profiles?: TopicProfile[] };
    if (data.profiles?.length && data.profiles.length > 0) {
      activeProfiles = (data.profiles as TopicProfile[])
        .filter(p => p.enabled)
        .sort((a, b) => b.priority - a.priority);
    }
  } catch {
    // Silently keep current profiles (builtin fallback on first failure)
  }
}

function getKgActiveSubscriptions(): string[] {
  return [...new Set(activeProfiles.filter(p => p.enabled).map(p => p.subscription))];
}

function parseTopic(topic: string): { machine: string; workOrder: string | null; toolId: string | null; category: string; variable: string } | null {
  const parts = topic.split('/');

  for (const profile of activeProfiles) {
    if (!profile.enabled) continue;
    if (parts[0] !== profile.prefix) continue;
    if (parts.length <= profile.seg_variable_start) continue;

    const nullMarker = profile.null_marker || '---';

    const machine = profile.seg_machine !== null && profile.seg_machine < parts.length
      ? parts[profile.seg_machine] : 'unknown';
    const workOrderRaw = profile.seg_work_order !== null && profile.seg_work_order < parts.length
      ? parts[profile.seg_work_order] : null;
    const toolIdRaw = profile.seg_tool_id !== null && profile.seg_tool_id < parts.length
      ? parts[profile.seg_tool_id] : null;
    const category = profile.seg_category !== null && profile.seg_category < parts.length
      ? parts[profile.seg_category] : 'unknown';
    const variable = parts.slice(profile.seg_variable_start).join('/');

    return {
      machine,
      workOrder: workOrderRaw === nullMarker ? null : workOrderRaw,
      toolId: toolIdRaw === nullMarker ? null : toolIdRaw,
      category,
      variable,
    };
  }

  return null;
}

function onMessage(topic: string, payload: Buffer): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;

  let value: number | string | null = null;
  let unit: string | null = null;

  try {
    const json = JSON.parse(payload.toString());
    const raw = json.Value ?? json.value;
    if (typeof raw === 'number') value = raw;
    else if (typeof raw === 'string') value = raw;
    unit = json.Unit || json.unit || null;
  } catch {
    return; // Skip non-JSON
  }

  const sensorId = `${parsed.machine}/${parsed.variable}`;
  const now = new Date().toISOString();

  // Track new machines
  if (!knownMachines.has(parsed.machine)) {
    knownMachines.add(parsed.machine);
    stats.discovered++;
    logger.info({ machine: parsed.machine }, 'KG Agent: new machine discovered');
  }

  // Track new sensors
  if (!knownSensors.has(sensorId)) {
    knownSensors.add(sensorId);
    stats.discovered++;
  }

  // Buffer value update (cap size to avoid unbounded growth)
  if (pendingUpdates.size >= MAX_PENDING && !pendingUpdates.has(sensorId)) return;
  pendingUpdates.set(sensorId, {
    lastValue: value,
    unit,
    category: parsed.category,
    lastSeen: now,
  });
}

async function flush(): Promise<void> {
  if (pendingUpdates.size === 0 || !kgAvailable) return;

  const queries: string[] = [];
  const now = new Date().toISOString();

  for (const [sensorId, update] of pendingUpdates) {
    const [machine, ...varParts] = sensorId.split('/');
    const variable = varParts.join('/');

    // MERGE Machine
    queries.push(
      `MERGE (m:Machine {id: '${escapeStr(machine)}'})
       SET m.last_seen = '${now}', m.source = 'uns-discovery'
       RETURN m`
    );

    // MERGE Sensor
    queries.push(
      `MERGE (s:Sensor {id: '${escapeStr(sensorId)}'})
       SET s.name = '${escapeStr(variable)}',
           s.machine = '${escapeStr(machine)}',
           s.category = '${escapeStr(update.category)}',
           s.unit = ${escapeVal(update.unit)},
           s.last_value = ${escapeVal(update.lastValue)},
           s.last_seen = '${update.lastSeen}',
           s.source = 'uns-discovery'
       RETURN s`
    );

    // MERGE Edge: Machine -[:HAS_SENSOR]-> Sensor
    queries.push(
      `MATCH (m:Machine {id: '${escapeStr(machine)}'})
       MATCH (s:Sensor {id: '${escapeStr(sensorId)}'})
       MERGE (m)-[r:HAS_SENSOR]->(s)
       RETURN r`
    );
  }

  pendingUpdates.clear();

  if (queries.length > 0) {
    const result = await batchExecCypher(queries);
    stats.updates += result.success;
    stats.errors += result.failed;
  }
}

export async function startKgAgent(): Promise<void> {
  logger.info('KG Agent: starting...');

  // Check KG availability
  kgAvailable = await checkKgAvailable();
  if (!kgAvailable) {
    logger.warn('KG Agent: Apache AGE not available, will retry periodically');
  } else {
    logger.info('KG Agent: Apache AGE connected');
  }

  // Periodically check KG availability
  setInterval(async () => {
    kgAvailable = await checkKgAvailable();
  }, 60_000);

  // Load topic profiles from Historian API
  await loadProfilesFromHistorian();
  profileReloadTimer = setInterval(loadProfilesFromHistorian, PROFILE_RELOAD_MS);

  // Connect MQTT
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: `osf-kg-agent-${Date.now()}`,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: true,
  });

  mqttClient.on('connect', () => {
    logger.info('KG Agent: MQTT connected');
    const subs = getKgActiveSubscriptions();
    for (const sub of subs) {
      mqttClient!.subscribe(sub, { qos: 0 });
    }
  });

  mqttClient.on('message', onMessage);

  mqttClient.on('error', (err) => {
    logger.error({ err: err.message }, 'KG Agent: MQTT error');
  });

  // Start flush timer
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  // Stats logging
  setInterval(() => {
    if (stats.discovered > 0 || stats.updates > 0) {
      logger.info({ ...stats, known: knownMachines.size, sensors: knownSensors.size }, 'KG Agent stats');
    }
  }, 60_000);

  logger.info('KG Agent: ready');
}

export function getKgAgentStats(): { discovered: number; updates: number; errors: number; machines: number; sensors: number; kgAvailable: boolean; flushIntervalMs: number } {
  return {
    ...stats,
    machines: knownMachines.size,
    sensors: knownSensors.size,
    kgAvailable,
    flushIntervalMs: FLUSH_INTERVAL_MS,
  };
}

export async function stopKgAgent(): Promise<void> {
  if (flushTimer) clearInterval(flushTimer);
  if (profileReloadTimer) clearInterval(profileReloadTimer);
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
  // Flush remaining pending updates before closing pool
  await flush().catch(err => logger.warn({ err: (err as Error).message }, 'KG Agent: flush on shutdown failed'));
  await kgPool.end();
  logger.info('KG Agent: stopped');
}
