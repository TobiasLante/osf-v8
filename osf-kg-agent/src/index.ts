import express from 'express';
import mqtt from 'mqtt';
import pg from 'pg';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
});

const PORT = parseInt(process.env.PORT || '8032', 10);
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const FLUSH_INTERVAL_MS = 15_000;
const MAX_PENDING = 10_000;
const HISTORIAN_URL = process.env.HISTORIAN_URL || 'http://localhost:8030';
const PROFILE_RELOAD_MS = 30_000;

// KG database (erpdb with Apache AGE)
const kgPool = new pg.Pool({
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
const pendingUpdates = new Map<string, PendingUpdate>();

let mqttClient: mqtt.MqttClient | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let kgAvailable = false;
let mqttConnected = false;
let stats = { discovered: 0, updates: 0, errors: 0 };
let httpServer: import('http').Server | null = null;
const allIntervals: NodeJS.Timeout[] = [];

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
        logger.warn({ err: err.message, cypher: q.slice(0, 100) }, 'Cypher failed');
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

// ─── Topic Profile Parsing ─────────────────────────────────────────────

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

const BUILTIN_PROFILES: TopicProfile[] = [{
  id: -1, name: 'Factory (default)', prefix: 'Factory', subscription: 'Factory/#',
  seg_machine: 1, seg_work_order: 2, seg_tool_id: 3, seg_category: 4,
  seg_variable_start: 5, null_marker: '---', enabled: true, priority: 100,
}];

let activeProfiles: TopicProfile[] = [...BUILTIN_PROFILES];

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
    // Silently keep current profiles
  }
}

function getActiveSubscriptions(): string[] {
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
    return;
  }

  const sensorId = `${parsed.machine}/${parsed.variable}`;
  const now = new Date().toISOString();

  if (!knownMachines.has(parsed.machine)) {
    knownMachines.add(parsed.machine);
    stats.discovered++;
    logger.info({ machine: parsed.machine }, 'New machine discovered');
  }

  if (!knownSensors.has(sensorId)) {
    knownSensors.add(sensorId);
    stats.discovered++;
  }

  if (pendingUpdates.size >= MAX_PENDING && !pendingUpdates.has(sensorId)) {
    logger.warn({ size: pendingUpdates.size, max: MAX_PENDING }, 'pendingUpdates limit reached, skipping new sensor');
    return;
  }

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

    queries.push(
      `MERGE (m:Machine {id: '${escapeStr(machine)}'})
       SET m.last_seen = '${now}', m.source = 'uns-discovery'
       RETURN m`
    );

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

// ─── HTTP Server ───────────────────────────────────────────────────────

const app = express();

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'osf-kg-agent',
    mqttConnected,
    kgAvailable,
    machines: knownMachines.size,
    sensors: knownSensors.size,
  });
});

app.get('/health/ready', (_req, res) => {
  const ready = mqttConnected && kgAvailable;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    service: 'osf-kg-agent',
    mqttConnected,
    kgAvailable,
    machines: knownMachines.size,
    sensors: knownSensors.size,
  });
});

app.get('/stats', (_req, res) => {
  res.json({
    ...stats,
    machines: knownMachines.size,
    sensors: knownSensors.size,
    kgAvailable,
    flushIntervalMs: FLUSH_INTERVAL_MS,
    pendingUpdates: pendingUpdates.size,
    activeProfiles: activeProfiles.length,
  });
});

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  logger.info('KG Agent starting...');

  // Check KG availability
  kgAvailable = await checkKgAvailable();
  if (!kgAvailable) {
    logger.warn('Apache AGE not available, will retry periodically');
  } else {
    logger.info('Apache AGE connected');
  }

  // Periodically check KG availability
  allIntervals.push(setInterval(async () => {
    kgAvailable = await checkKgAvailable();
  }, 60_000));

  // Load topic profiles from Historian API
  await loadProfilesFromHistorian();
  allIntervals.push(setInterval(loadProfilesFromHistorian, PROFILE_RELOAD_MS));

  // Connect MQTT
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: `osf-kg-agent-${Date.now()}`,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: true,
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    logger.info('MQTT connected');
    const subs = getActiveSubscriptions();
    for (const sub of subs) {
      mqttClient!.subscribe(sub, { qos: 0 });
    }
  });

  mqttClient.on('close', () => {
    mqttConnected = false;
  });

  mqttClient.on('offline', () => {
    mqttConnected = false;
  });

  mqttClient.on('message', onMessage);

  mqttClient.on('error', (err) => {
    logger.error({ err: err.message }, 'MQTT error');
  });

  // Start flush timer
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  allIntervals.push(flushTimer);

  // Stats logging
  allIntervals.push(setInterval(() => {
    if (stats.discovered > 0 || stats.updates > 0) {
      logger.info({ ...stats, known: knownMachines.size, sensors: knownSensors.size }, 'KG Agent stats');
    }
  }, 60_000));

  // Start HTTP server
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'KG Agent HTTP server started');
  });
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down...`);
  for (const interval of allIntervals) clearInterval(interval);
  allIntervals.length = 0;
  try {
    await flush();
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Error during final flush');
  }
  if (mqttClient) mqttClient.end(true);
  if (httpServer) httpServer.close();
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
