// Historian — History MCP Server (JSON-RPC 2.0)

import http from 'http';
import { query } from './db.js';
import { getStats } from './subscriber.js';

const MCP_PORT = parseInt(process.env.HISTORIAN_MCP_PORT || '8030');

// Tool definitions
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

// Tool handlers
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

// JSON-RPC 2.0 MCP handler
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
        serverInfo: { name: 'osf-historian', version: '1.0.0' },
      },
    };
  }

  // Notifications (no response needed)
  if (method === 'notifications/initialized') return null;

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

export function startMcpServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // Health endpoint
    if (req.method === 'GET' && req.url === '/health') {
      const s = getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...s }));
      return;
    }

    // MCP endpoint
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
    console.log(`[mcp] History MCP server listening on :${MCP_PORT}`);
  });

  return server;
}
