// Historian v2 — MCP Server + REST API
// Existing MCP tools unchanged + new REST endpoints for dashboard

import http from 'http';
import {
  query, getRoutes, createRoute, updateRoute, deleteRoute,
  getRetentionPolicies, setRetentionPolicy,
  createTable, listTables,
} from './db.js';
import { getSubscriberStats, getExplorerMessages } from './subscriber.js';
import { getFlushStats } from './flush-engine.js';

const MCP_PORT = parseInt(process.env.HISTORIAN_MCP_PORT || '8030');

// ─── MCP Tool Definitions (unchanged) ─────────────────────────────────────────

const tools = [
  {
    name: 'history_get_trend',
    description: 'Zeitreihe fuer eine Variable einer Maschine. Gibt Werte mit Zeitstempel zurueck.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Maschinen-ID (z.B. CNC-01)' },
        variable: { type: 'string', description: 'Variable (z.B. Act_OEE, Act_Qty_Good)' },
        hours: { type: 'number', description: 'Zeitraum in Stunden (default 24)', default: 24 },
        limit: { type: 'number', description: 'Max Datenpunkte (default 100)', default: 100 },
      },
      required: ['machine', 'variable'],
    },
  },
  {
    name: 'history_compare',
    description: 'Vergleiche eine Variable zwischen zwei Maschinen im gleichen Zeitraum.',
    inputSchema: {
      type: 'object',
      properties: {
        machine_a: { type: 'string', description: 'Erste Maschine' },
        machine_b: { type: 'string', description: 'Zweite Maschine' },
        variable: { type: 'string', description: 'Variable zum Vergleichen' },
        hours: { type: 'number', description: 'Zeitraum in Stunden (default 24)', default: 24 },
      },
      required: ['machine_a', 'machine_b', 'variable'],
    },
  },
  {
    name: 'history_aggregate',
    description: 'Aggregierte Werte (AVG, MIN, MAX) pro Stunde/Tag/Woche fuer eine Variable.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Maschinen-ID' },
        variable: { type: 'string', description: 'Variable' },
        granularity: { type: 'string', enum: ['hour', 'day', 'week'], description: 'Aggregations-Ebene', default: 'hour' },
        hours: { type: 'number', description: 'Zeitraum in Stunden (default 168 = 1 Woche)', default: 168 },
      },
      required: ['machine', 'variable'],
    },
  },
  {
    name: 'history_anomalies',
    description: 'Finde Werte die mehr als 2 Standardabweichungen vom Mittelwert abweichen.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Maschinen-ID' },
        variable: { type: 'string', description: 'Variable' },
        hours: { type: 'number', description: 'Zeitraum in Stunden (default 24)', default: 24 },
        sigma: { type: 'number', description: 'Sigma-Schwelle (default 2)', default: 2 },
      },
      required: ['machine', 'variable'],
    },
  },
  {
    name: 'history_machines',
    description: 'Liste aller Maschinen mit Daten im Historian, inkl. letztem Wert und Anzahl Datenpunkte.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Zeitraum in Stunden (default 24)', default: 24 },
      },
      required: [],
    },
  },
  {
    name: 'history_variables',
    description: 'Liste aller Variablen einer Maschine mit letztem Wert.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Maschinen-ID' },
      },
      required: ['machine'],
    },
  },
];

// ─── MCP Tool Handlers (unchanged) ────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'history_get_trend': {
      const hours = args.hours || 24;
      const limit = Math.min(args.limit || 100, 1000);
      const rows = await query(
        `SELECT ts, value, value_text, unit FROM uns_history
         WHERE machine = $1 AND variable = $2 AND ts > NOW() - INTERVAL '1 hour' * $3
         ORDER BY ts DESC LIMIT $4`,
        [args.machine, args.variable, hours, limit]
      );
      return { machine: args.machine, variable: args.variable, hours, dataPoints: rows.length, data: rows };
    }

    case 'history_compare': {
      const hours = args.hours || 24;
      const [rowsA, rowsB] = await Promise.all([
        query(
          `SELECT ts, value FROM uns_history WHERE machine = $1 AND variable = $2 AND ts > NOW() - INTERVAL '1 hour' * $3 ORDER BY ts DESC LIMIT 100`,
          [args.machine_a, args.variable, hours]
        ),
        query(
          `SELECT ts, value FROM uns_history WHERE machine = $1 AND variable = $2 AND ts > NOW() - INTERVAL '1 hour' * $3 ORDER BY ts DESC LIMIT 100`,
          [args.machine_b, args.variable, hours]
        ),
      ]);
      const avgA = rowsA.length ? rowsA.reduce((s: number, r: any) => s + (r.value || 0), 0) / rowsA.length : null;
      const avgB = rowsB.length ? rowsB.reduce((s: number, r: any) => s + (r.value || 0), 0) / rowsB.length : null;
      return {
        variable: args.variable, hours,
        machine_a: { machine: args.machine_a, dataPoints: rowsA.length, avg: avgA, data: rowsA.slice(0, 20) },
        machine_b: { machine: args.machine_b, dataPoints: rowsB.length, avg: avgB, data: rowsB.slice(0, 20) },
      };
    }

    case 'history_aggregate': {
      const hours = args.hours || 168;
      const gran = args.granularity || 'hour';
      const rows = await query(
        `SELECT date_trunc($1, ts) as period,
                AVG(value) as avg, MIN(value) as min, MAX(value) as max, COUNT(*) as count
         FROM uns_history
         WHERE machine = $2 AND variable = $3 AND ts > NOW() - INTERVAL '1 hour' * $4
         GROUP BY period ORDER BY period DESC`,
        [gran, args.machine, args.variable, hours]
      );
      return { machine: args.machine, variable: args.variable, granularity: gran, hours, data: rows };
    }

    case 'history_anomalies': {
      const hours = args.hours || 24;
      const sigma = args.sigma || 2;
      const rows = await query(
        `WITH stats AS (
           SELECT AVG(value) as mean, STDDEV(value) as stddev
           FROM uns_history
           WHERE machine = $1 AND variable = $2 AND ts > NOW() - INTERVAL '1 hour' * $3 AND value IS NOT NULL
         )
         SELECT h.ts, h.value, s.mean, s.stddev,
                ABS(h.value - s.mean) / NULLIF(s.stddev, 0) as sigma_distance
         FROM uns_history h, stats s
         WHERE h.machine = $1 AND h.variable = $2 AND h.ts > NOW() - INTERVAL '1 hour' * $3
           AND h.value IS NOT NULL AND s.stddev > 0
           AND ABS(h.value - s.mean) > s.stddev * $4
         ORDER BY sigma_distance DESC LIMIT 50`,
        [args.machine, args.variable, hours, sigma]
      );
      return { machine: args.machine, variable: args.variable, hours, sigma, anomalies: rows.length, data: rows };
    }

    case 'history_machines': {
      const hours = args.hours || 24;
      const rows = await query(
        `SELECT machine, COUNT(*) as data_points, COUNT(DISTINCT variable) as variables,
                MAX(ts) as last_seen, MIN(ts) as first_seen
         FROM uns_history WHERE ts > NOW() - INTERVAL '1 hour' * $1
         GROUP BY machine ORDER BY data_points DESC`,
        [hours]
      );
      return { hours, machines: rows };
    }

    case 'history_variables': {
      const rows = await query(
        `SELECT variable, category, unit, COUNT(*) as data_points,
                MAX(ts) as last_seen,
                (SELECT value FROM uns_history h2 WHERE h2.machine = $1 AND h2.variable = uns_history.variable ORDER BY ts DESC LIMIT 1) as last_value
         FROM uns_history WHERE machine = $1
         GROUP BY variable, category, unit ORDER BY variable`,
        [args.machine]
      );
      return { machine: args.machine, variables: rows };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── JSON-RPC 2.0 MCP Handler ────────────────────────────────────────────────

function handleJsonRpc(body: any): any {
  const { id, method, params } = body;

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    return handleTool(name, args || {}).then(result => ({
      jsonrpc: '2.0', id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    }));
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'osf-historian', version: '2.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return null;

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// ─── REST API Routes ──────────────────────────────────────────────────────────

async function handleRestApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', `http://localhost`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS headers for dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // GET /health — enhanced with per-table stats
  if (method === 'GET' && path === '/health') {
    const subscriber = getSubscriberStats();
    const flush = getFlushStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version: '2.0.0',
      mqtt: {
        connected: subscriber.mqttConnected,
        paused: subscriber.paused,
        received: subscriber.received,
        routed: subscriber.routed,
        unrouted: subscriber.unrouted,
        pauses: subscriber.pauses,
      },
      flush: flush.totals,
      perTable: flush.perTable,
      legacy: flush.legacy,
      explorer: { size: subscriber.explorerSize },
    }));
    return true;
  }

  // GET /stats — live stats
  if (method === 'GET' && path === '/stats') {
    const subscriber = getSubscriberStats();
    const flush = getFlushStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mqtt: subscriber,
      flush: flush.totals,
      perTable: flush.perTable,
      legacy: flush.legacy,
    }));
    return true;
  }

  // GET /routes — all category routes
  if (method === 'GET' && path === '/routes') {
    try {
      const routes = await getRoutes();
      json(res, 200, { routes });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // POST /routes — create new route
  if (method === 'POST' && path === '/routes') {
    const body = await readBody(req);
    const { category, target_table, flush_interval_s } = body;
    if (!category || !target_table) {
      json(res, 400, { error: 'category and target_table required' });
      return true;
    }
    try {
      const route = await createRoute(category, target_table, flush_interval_s || 5);
      json(res, 201, route);
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // PUT /routes/:id — update route
  const routeMatch = path.match(/^\/routes\/(\d+)$/);
  if (method === 'PUT' && routeMatch) {
    const body = await readBody(req);
    try {
      const route = await updateRoute(parseInt(routeMatch[1]), body);
      if (!route) { json(res, 404, { error: 'Not found' }); return true; }
      json(res, 200, route);
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // DELETE /routes/:id — delete route
  if (method === 'DELETE' && routeMatch) {
    try {
      const ok = await deleteRoute(parseInt(routeMatch[1]));
      json(res, ok ? 200 : 404, { ok });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // GET /retention — retention policies
  if (method === 'GET' && path === '/retention') {
    try {
      const policies = await getRetentionPolicies();
      json(res, 200, { policies });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // PUT /retention/:table — set retention + downsampling
  const retentionMatch = path.match(/^\/retention\/([a-z0-9_]+)$/);
  if (method === 'PUT' && retentionMatch) {
    const body = await readBody(req);
    const { retention_days, downsampling_interval, downsampling_retention_days } = body;
    if (!retention_days) {
      json(res, 400, { error: 'retention_days required' });
      return true;
    }
    try {
      const policy = await setRetentionPolicy(
        retentionMatch[1],
        retention_days,
        downsampling_interval || null,
        downsampling_retention_days || null
      );
      json(res, 200, policy);
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // GET /explorer — ring-buffer messages with filtering
  if (method === 'GET' && path === '/explorer') {
    const machine = url.searchParams.get('machine') || undefined;
    const category = url.searchParams.get('category') || undefined;
    const variable = url.searchParams.get('variable') || undefined;
    const messages = getExplorerMessages({ machine, category, variable });
    json(res, 200, { messages, count: messages.length });
    return true;
  }

  // POST /tables — create new table
  if (method === 'POST' && path === '/tables') {
    const body = await readBody(req);
    if (!body.name) {
      json(res, 400, { error: 'name required' });
      return true;
    }
    try {
      await createTable(body.name);
      json(res, 201, { ok: true, table: body.name });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  // GET /tables — list historian tables
  if (method === 'GET' && path === '/tables') {
    try {
      const tables = await listTables();
      json(res, 200, { tables });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return true;
  }

  return false; // Not handled
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

export function startMcpServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // Try REST API first
    const handled = await handleRestApi(req, res);
    if (handled) return;

    // MCP endpoint (POST /mcp or POST /)
    if (req.method === 'POST' && (req.url === '/mcp' || req.url === '/')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const result = await handleJsonRpc(parsed);
          if (result === null) {
            res.writeHead(204);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(MCP_PORT, () => {
    console.log(`[mcp] Historian v2 server listening on :${MCP_PORT}`);
  });

  return server;
}
