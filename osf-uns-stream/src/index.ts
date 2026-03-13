import express, { Request, Response, NextFunction } from 'express';
import mqtt from 'mqtt';
import jwt from 'jsonwebtoken';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
});

const PORT = parseInt(process.env.PORT || '8033', 10);
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const HISTORIAN_URL = process.env.HISTORIAN_URL || 'http://localhost:8030';
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const IS_PROD = process.env.NODE_ENV === 'production';
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = [
  'https://openshopfloor.zeroguess.ai',
  'https://osf-api.zeroguess.ai',
  ...(IS_PROD ? [] : ['http://localhost:3000', 'http://localhost:3001']),
  ...EXTRA_ORIGINS,
];

// ─── JWT Auth Middleware ────────────────────────────────────────────────

interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Try Bearer token
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as unknown as JwtPayload;
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  }

  // Try token query param (for EventSource/SSE)
  const tokenParam = req.query?.token as string;
  if (tokenParam) {
    try {
      req.user = jwt.verify(tokenParam, JWT_SECRET, { algorithms: ['HS256'] }) as unknown as JwtPayload;
      next();
      return;
    } catch {
      // fall through
    }
  }

  res.status(401).json({ error: 'Missing Authorization header' });
}

// ─── MQTT Client ───────────────────────────────────────────────────────

let sharedClient: mqtt.MqttClient | null = null;
const subscribers = new Map<string, Set<(topic: string, payload: string) => void>>();

function getClient(): mqtt.MqttClient {
  if (sharedClient && sharedClient.connected) return sharedClient;

  sharedClient = mqtt.connect(MQTT_BROKER, {
    clientId: `osf-uns-stream-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  sharedClient.on('connect', () => {
    logger.info({ broker: MQTT_BROKER }, 'MQTT connected');
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
    logger.warn({ err: err.message }, 'MQTT error');
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

// ─── Topic Cache ───────────────────────────────────────────────────────

const topicCache = new Map<string, { payload: string; ts: number }>();

let cachedSubscriptions: string[] = ['Factory/#'];

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

function initCache() {
  const client = getClient();

  loadSubscriptionsFromHistorian().then(() => {
    for (const sub of cachedSubscriptions) {
      client.subscribe(sub, { qos: 0 });
    }
  });

  setInterval(async () => {
    const oldSubs = [...cachedSubscriptions];
    await loadSubscriptionsFromHistorian();
    for (const sub of cachedSubscriptions) {
      if (!oldSubs.includes(sub)) client.subscribe(sub, { qos: 0 });
    }
    for (const sub of oldSubs) {
      if (!cachedSubscriptions.includes(sub)) client.unsubscribe(sub);
    }
  }, 30_000);

  client.on('message', (topic, payload) => {
    topicCache.set(topic, { payload: payload.toString(), ts: Date.now() });
    if (topicCache.size > 5000) {
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [k, v] of topicCache) {
        if (v.ts < cutoff) topicCache.delete(k);
      }
    }
  });
}

// Periodic cleanup
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [key, entry] of topicCache) {
    if (entry.ts < cutoff) topicCache.delete(key);
  }
}, 60_000).unref();

// ─── Express App ───────────────────────────────────────────────────────

const app = express();

// Health (no auth)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'osf-uns-stream',
    mqttConnected: sharedClient?.connected ?? false,
    topicCacheSize: topicCache.size,
    subscriberCount: subscribers.size,
  });
});

// All other routes require auth
app.use(requireAuth);

// GET /stream?filter=Factory/#
app.get('/stream', (req: Request, res: Response) => {
  const filter = (req.query.filter as string) || 'Factory/#';

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

  const client = getClient();

  const cb = (topic: string, payload: string) => {
    if (res.writableEnded) return;
    const data = JSON.stringify({ topic, payload, ts: Date.now() });
    res.write(`data: ${data}\n\n`);
  };

  if (!subscribers.has(filter)) {
    subscribers.set(filter, new Set());
    client.subscribe(filter, { qos: 0 });
  }
  subscribers.get(filter)!.add(cb);

  res.write(`data: ${JSON.stringify({ type: 'connected', filter })}\n\n`);

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

// GET /snapshot
app.get('/snapshot', (_req: Request, res: Response) => {
  const entries: Array<{ topic: string; payload: string; ts: number }> = [];
  for (const [topic, val] of topicCache) {
    entries.push({ topic, ...val });
  }
  entries.sort((a, b) => a.topic.localeCompare(b.topic));
  res.json({ count: entries.length, topics: entries });
});

// GET /topics
app.get('/topics', (_req: Request, res: Response) => {
  const machines = new Map<string, { topics: number; lastSeen: number; categories: Set<string> }>();

  for (const [topic, val] of topicCache) {
    const parts = topic.split('/');
    if (parts.length < 2) continue;
    const machine = parts[1];
    const entry = machines.get(machine) || { topics: 0, lastSeen: 0, categories: new Set<string>() };
    entry.topics++;
    if (val.ts > entry.lastSeen) entry.lastSeen = val.ts;
    if (parts.length >= 5) entry.categories.add(parts[4]);
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

// ─── Start ─────────────────────────────────────────────────────────────

initCache();

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'UNS Stream HTTP server started');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  if (sharedClient) sharedClient.end(true);
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  if (sharedClient) sharedClient.end(true);
  process.exit(0);
});
