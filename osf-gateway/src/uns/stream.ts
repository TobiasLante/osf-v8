import { Router, Request, Response } from 'express';
import mqtt from 'mqtt';
import { logger } from '../logger';

const router = Router();

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://192.168.178.150:31883';

// Shared MQTT connection (lazy init)
let sharedClient: mqtt.MqttClient | null = null;
let subscribers = new Map<string, Set<(topic: string, payload: string) => void>>();

function getClient(): mqtt.MqttClient {
  if (sharedClient && sharedClient.connected) return sharedClient;

  sharedClient = mqtt.connect(MQTT_BROKER, {
    clientId: `osf-gateway-uns-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  sharedClient.on('connect', () => {
    logger.info({ broker: MQTT_BROKER }, 'UNS MQTT connected');
    // Re-subscribe all active filters
    for (const filter of subscribers.keys()) {
      sharedClient!.subscribe(filter, { qos: 0 });
    }
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

  return sharedClient;
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
router.get('/stream', (req: Request, res: Response) => {
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
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  const client = getClient();

  const cb = (topic: string, payload: string) => {
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
  res.write(`data: ${JSON.stringify({ type: 'connected', broker: MQTT_BROKER, filter })}\n\n`);

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

// Keep a cache of recent messages
function initCache() {
  const client = getClient();
  client.subscribe('Factory/#', { qos: 0 });

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

// Initialize cache on first import
initCache();

export default router;
