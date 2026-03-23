import { Router, Request, Response } from 'express';
import mqtt from 'mqtt';
import { logger } from '../logger';
import { requireAuth } from '../auth/middleware';

const IS_PROD = process.env.NODE_ENV === 'production';
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = [
  'https://openshopfloor.zeroguess.ai',
  'https://osf-api.zeroguess.ai',
  ...(IS_PROD ? [] : ['http://localhost:3000', 'http://localhost:3001']),
  ...EXTRA_ORIGINS,
];

const router = Router();

// All UNS routes require authentication
router.use(requireAuth);

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

// Shared MQTT connection (lazy init with race-condition protection)
let sharedClient: mqtt.MqttClient | null = null;
let connectPromise: Promise<mqtt.MqttClient> | null = null;
let subscribers = new Map<string, Set<(topic: string, payload: string) => void>>();

function getClient(): Promise<mqtt.MqttClient> {
  if (sharedClient?.connected) return Promise.resolve(sharedClient);
  if (connectPromise) return connectPromise;

  connectPromise = new Promise<mqtt.MqttClient>((resolve) => {
    sharedClient = mqtt.connect(MQTT_BROKER, {
      clientId: `osf-gateway-uns-${Date.now()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    sharedClient.on('connect', () => {
      logger.info({ broker: MQTT_BROKER }, 'UNS MQTT connected');
      connectPromise = null;
      // Re-subscribe all active filters
      for (const filter of subscribers.keys()) {
        sharedClient!.subscribe(filter, { qos: 0 });
      }
      resolve(sharedClient!);
    });

    sharedClient.on('message', (topic, payload) => {
      const msg = payload.toString();
      for (const [filter, listeners] of subscribers) {
        if (topicMatchesFilter(topic, filter)) {
          for (const cb of listeners) {
            cb(topic, msg);
          }
        }
      }
    });

    sharedClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'UNS MQTT error');
    });
  });

  return connectPromise;
}

function topicMatchesFilter(topic: string, filter: string): boolean {
  if (filter === '#') return true;
  const topicParts = topic.split('/');
  const filterParts = filter.split('/');
  for (let i = 0; i < filterParts.length; i++) {
    if (filterParts[i] === '#') return true;
    if (filterParts[i] === '+') continue;
    if (filterParts[i] !== topicParts[i]) return false;
  }
  return topicParts.length === filterParts.length;
}

// GET /uns/stream?filter=factory/#
router.get('/stream', async (req: Request, res: Response) => {
  const filter = (req.query.filter as string) || 'factory/#';

  // Validate filter (basic sanitization)
  if (filter.length > 200 || /[^a-zA-Z0-9/_#+\-.]/.test(filter)) {
    res.status(400).json({ error: 'Invalid topic filter' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (ALLOWED_ORIGINS.length > 0) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  const client = await getClient();

  const cb = (topic: string, payload: string) => {
    if (res.writableEnded) return;
    const data = JSON.stringify({ topic, payload, ts: Date.now() });
    res.write(`data: ${data}\n\n`);
  };

  // Add subscriber
  if (!subscribers.has(filter)) {
    subscribers.set(filter, new Set());
    client.subscribe(filter, { qos: 0 });
  }
  subscribers.get(filter)!.add(cb);

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', filter })}\n\n`);

  // Cleanup on disconnect
  req.on('close', () => {
    const set = subscribers.get(filter);
    if (set) {
      set.delete(cb);
      if (set.size === 0) {
        subscribers.delete(filter);
        client.unsubscribe(filter);
      }
    }
  });
});

// GET /uns/snapshot — returns last known values for all topics (quick overview)
const topicCache = new Map<string, { payload: string; ts: number }>();

// Load active subscriptions from Historian API
const HISTORIAN_URL = process.env.HISTORIAN_URL || 'http://localhost:8030';
let cachedSubscriptions: string[] = ['Factory/#']; // fallback

async function loadSubscriptionsFromHistorian(): Promise<void> {
  try {
    const resp = await fetch(`${HISTORIAN_URL}/profiles`, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return;
    const data = await resp.json() as { profiles?: Array<{ enabled: boolean; subscription: string }> };
    if (data.profiles && data.profiles.length > 0) {
      const subs = [...new Set(data.profiles.filter((p: any) => p.enabled).map((p: any) => p.subscription))];
      if (subs.length > 0) cachedSubscriptions = subs as string[];
    }
  } catch {
    // Keep fallback
  }
}

// Keep a cache of recent messages
async function initCache() {
  const client = await getClient();

  // Subscribe to all active profile subscriptions
  await loadSubscriptionsFromHistorian();
  for (const sub of cachedSubscriptions) {
    client.subscribe(sub, { qos: 0 });
  }

  // Reload subscriptions periodically
  setInterval(async () => {
    const c = await getClient();
    const oldSubs = [...cachedSubscriptions];
    await loadSubscriptionsFromHistorian();
    // Subscribe to new, unsubscribe from removed
    for (const sub of cachedSubscriptions) {
      if (!oldSubs.includes(sub)) c.subscribe(sub, { qos: 0 });
    }
    for (const sub of oldSubs) {
      if (!cachedSubscriptions.includes(sub)) c.unsubscribe(sub);
    }
  }, 30_000);

  client.on('message', (topic, payload) => {
    topicCache.set(topic, { payload: payload.toString(), ts: Date.now() });
    // Evict old entries (older than 5 min)
    if (topicCache.size > 5000) {
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [k, v] of topicCache) {
        if (v.ts < cutoff) topicCache.delete(k);
      }
    }
  });
}

router.get('/snapshot', (_req: Request, res: Response) => {
  const entries: Array<{ topic: string; payload: string; ts: number }> = [];
  for (const [topic, val] of topicCache) {
    entries.push({ topic, ...val });
  }
  entries.sort((a, b) => a.topic.localeCompare(b.topic));
  res.json({ count: entries.length, topics: entries });
});

// GET /uns/topics — topic metadata: hierarchy, counts, descriptions
router.get('/topics', (_req: Request, res: Response) => {
  // Build hierarchy from cached topics
  const machines = new Map<string, { topics: number; lastSeen: number; categories: Set<string> }>();

  for (const [topic, val] of topicCache) {
    const parts = topic.split('/');
    if (parts.length < 2) continue;
    const machine = parts[1]; // Factory/{Machine}/...
    const entry = machines.get(machine) || { topics: 0, lastSeen: 0, categories: new Set<string>() };
    entry.topics++;
    if (val.ts > entry.lastSeen) entry.lastSeen = val.ts;
    if (parts.length >= 5) entry.categories.add(parts[4]); // .../Category/Metric
    machines.set(machine, entry);
  }

  const hierarchy = Array.from(machines.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, info]) => ({
      machine: name,
      topicCount: info.topics,
      lastSeen: info.lastSeen,
      ageSeconds: Math.floor((Date.now() - info.lastSeen) / 1000),
      categories: Array.from(info.categories).sort(),
    }));

  // Topic structure description
  const schema = {
    pattern: 'Factory/{Machine}/{Order}/{Step}/{Category}/{Metric}',
    levels: [
      { level: 0, name: 'Factory', description: 'Root namespace' },
      { level: 1, name: 'Machine', description: 'Physical asset (CNC-001, SGM-003, Montage-01)' },
      { level: 2, name: 'Order', description: 'Production order (FA-2024-0142)' },
      { level: 3, name: 'Step', description: 'Operation step (OP-10, OP-20)' },
      { level: 4, name: 'Category', description: 'Data category (OEE, Quality, Energy, Alerts)' },
      { level: 5, name: 'Metric', description: 'Specific measurement (availability, temperature, scrap_rate)' },
    ],
    payload: {
      format: 'JSON',
      fields: [
        { name: 'Value', type: 'number | string | boolean', description: 'The measurement value' },
        { name: 'Unit', type: 'string', description: 'Unit of measurement (%, °C, kWh, pcs)' },
        { name: 'Definition', type: 'string', description: 'Human-readable description of the metric' },
      ],
    },
  };

  res.json({
    totalTopics: topicCache.size,
    totalMachines: machines.size,
    machines: hierarchy,
    schema,
  });
});

// ── Phase 1: Schema-driven ISA-95 Hierarchy from Neo4j ──────────────

const KG_MCP_URL = process.env.MCP_KG_URL || process.env.MCP_URL_KG || 'http://osf-kg-server:8035';

interface HierarchyEntry {
  machine: string;
  labels: string[];
  site: string;
  area: string;
  workCenter: string;
  cell: string;
}

let hierarchyCache: { data: Record<string, HierarchyEntry>; ts: number } | null = null;
const HIERARCHY_TTL = 300_000; // 5 min

async function callKgTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${KG_MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(10_000),
  });
  const rpc = await res.json() as any;
  if (rpc.error) throw new Error(rpc.error.message);
  const text = rpc.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

async function loadHierarchy(): Promise<Record<string, HierarchyEntry>> {
  if (hierarchyCache && Date.now() - hierarchyCache.ts < HIERARCHY_TTL) return hierarchyCache.data;

  const result = await callKgTool('kg_query', {
    cypher: `
      MATCH (m)-[:PART_OF*1..4]->(ancestor)
      WHERE any(l IN labels(m) WHERE l ENDS WITH 'Machine' OR l = 'Machine' OR l = 'InjectionMoldingMachine' OR l = 'FFS_Cell' OR l = 'AssemblyLine')
      WITH m, collect({id: ancestor.id, name: ancestor.name, labels: labels(ancestor)}) AS ancestors
      RETURN m.id AS machine, labels(m) AS labels, ancestors
    `,
  });

  const map: Record<string, HierarchyEntry> = {};
  for (const row of result?.results || []) {
    const ancestors = row.ancestors || [];
    const findByLabel = (label: string) => ancestors.find((a: any) => a.labels?.includes(label));
    const site = findByLabel('Site');
    const area = findByLabel('Area');
    const line = findByLabel('ProductionLine');

    map[row.machine] = {
      machine: row.machine,
      labels: row.labels || [],
      site: site?.name || site?.id || 'Unknown',
      area: area?.name || area?.id || 'Unknown',
      workCenter: line?.name || line?.id || 'Unknown',
      cell: line?.name || line?.id || 'Unknown',
    };
  }

  hierarchyCache = { data: map, ts: Date.now() };
  logger.info({ machines: Object.keys(map).length }, 'UNS hierarchy loaded from KG');
  return map;
}

// GET /uns/hierarchy — ISA-95 hierarchy from Neo4j Knowledge Graph
router.get('/hierarchy', async (_req: Request, res: Response) => {
  try {
    const hierarchy = await loadHierarchy();
    res.json({ source: 'neo4j', count: Object.keys(hierarchy).length, machines: hierarchy });
  } catch (err: any) {
    logger.warn({ err: err.message }, 'UNS hierarchy fetch failed');
    res.status(502).json({ error: 'KG hierarchy unavailable', detail: err.message });
  }
});

// ── Phase 2: Virtual ERP context per machine ────────────────────────

let contextCache: { data: Record<string, any>; ts: number } | null = null;
const CONTEXT_TTL = 60_000; // 1 min (ERP data changes more often)

async function loadContext(): Promise<Record<string, any>> {
  if (contextCache && Date.now() - contextCache.ts < CONTEXT_TTL) return contextCache.data;

  const result = await callKgTool('kg_query', {
    cypher: `
      MATCH (m)-[:WORKS_ON]->(o:Order)
      OPTIONAL MATCH (o)-[:FOR_CUSTOMER]->(c)
      OPTIONAL MATCH (o)-[:HAS_BOM]->(mat)
      WITH m, o, c, collect(DISTINCT {id: mat.id, name: mat.name, stock: mat.stock}) AS materials
      RETURN m.id AS machine,
             o.id AS order_id, o.name AS order_name, o.due_date AS due_date,
             o.quantity AS quantity, o.status AS status,
             c.id AS customer_id, c.name AS customer_name,
             materials
      ORDER BY m.id
    `,
  });

  const map: Record<string, any> = {};
  for (const row of result?.results || []) {
    if (!map[row.machine]) {
      map[row.machine] = { orders: [], customer: null };
    }
    map[row.machine].orders.push({
      id: row.order_id, name: row.order_name,
      due_date: row.due_date, quantity: row.quantity, status: row.status,
      materials: row.materials,
    });
    if (row.customer_name) {
      map[row.machine].customer = { id: row.customer_id, name: row.customer_name };
    }
  }

  contextCache = { data: map, ts: Date.now() };
  return map;
}

// GET /uns/context — ERP context (orders, customers, materials) per machine
router.get('/context', async (_req: Request, res: Response) => {
  try {
    const context = await loadContext();
    res.json({ source: 'neo4j', count: Object.keys(context).length, machines: context });
  } catch (err: any) {
    logger.warn({ err: err.message }, 'UNS context fetch failed');
    res.status(502).json({ error: 'KG context unavailable', detail: err.message });
  }
});

// ── Phase 3: Cache invalidation (called after KG rebuild) ───────────

// POST /uns/invalidate — clear hierarchy + context caches (called by admin or KG builder webhook)
router.post('/invalidate', (_req: Request, res: Response) => {
  hierarchyCache = null;
  contextCache = null;
  logger.info('UNS hierarchy + context caches invalidated');
  res.json({ ok: true, message: 'Caches cleared, next request will reload from KG' });
});

// Initialize cache on first import
initCache().catch(err => {
  logger.warn({ err: err.message }, 'UNS cache init failed (will retry on first request)');
});

// Periodic cleanup: evict topic cache entries older than 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 300_000; // 5 min
  for (const [key, entry] of topicCache) {
    if (entry.ts < cutoff) topicCache.delete(key);
  }
}, 60_000).unref();

export default router;
