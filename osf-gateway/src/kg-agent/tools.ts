// KG Sensor Tools — query auto-discovered machines/sensors from Apache AGE
// These tools are registered as local gateway tools (no MCP round-trip needed)

import pg from 'pg';
import { logger } from '../logger';

const kgPool = new pg.Pool({
  host: process.env.ERP_DB_HOST || '192.168.178.150',
  port: parseInt(process.env.ERP_DB_PORT || '30431'),
  database: process.env.ERP_DB_NAME || 'erpdb',
  user: process.env.ERP_DB_USER || 'admin',
  password: process.env.ERP_DB_PASSWORD || '',
  max: 2,
  idleTimeoutMillis: 30_000,
});

const DB_SCHEMA = process.env.DB_SCHEMA || 'llm_test_v3';
const GRAPH_NAME = 'factory_graph';

async function cypherQuery(cypher: string): Promise<any[]> {
  const client = await kgPool.connect();
  try {
    await client.query("LOAD 'age'");
    await client.query(`SET search_path = ag_catalog, "${DB_SCHEMA}", public`);
    const result = await client.query(
      `SELECT * FROM cypher('${GRAPH_NAME}', $$ ${cypher} $$) AS (r agtype)`
    );
    return result.rows.map((r: any) => {
      try {
        return JSON.parse(r.r);
      } catch {
        return r.r;
      }
    });
  } finally {
    client.release();
  }
}

// Tool definitions (OpenAI function calling format)
export const kgSensorToolDefs = [
  {
    type: 'function',
    function: {
      name: 'kg_discovered_machines',
      description: 'Alle Maschinen die automatisch aus dem MQTT UNS entdeckt wurden, mit Sensor-Anzahl und letztem Kontakt.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kg_machine_sensors',
      description: 'Alle Sensoren einer Maschine aus dem KG (auto-discovered), mit letztem Wert, Einheit und Kategorie.',
      parameters: {
        type: 'object',
        properties: {
          machine: { type: 'string', description: 'Maschinen-ID (z.B. CNC-01)' },
        },
        required: ['machine'],
      },
    },
  },
];

// Tool handlers
export async function handleKgSensorTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'kg_discovered_machines': {
        const rows = await cypherQuery(`
          MATCH (m:Machine)
          WHERE m.source = 'uns-discovery'
          OPTIONAL MATCH (m)-[:HAS_SENSOR]->(s:Sensor)
          RETURN m.id, m.last_seen, count(s) AS sensor_count
          ORDER BY m.id
        `);
        // Parse agtype results
        const machines = rows.map((r: any) => {
          if (Array.isArray(r)) {
            return { machine: r[0], last_seen: r[1], sensor_count: r[2] };
          }
          return r;
        });
        return JSON.stringify({ machines, total: machines.length });
      }

      case 'kg_machine_sensors': {
        const machine = String(args.machine || '');
        if (!machine) return JSON.stringify({ error: 'machine parameter required' });

        const escapedMachine = machine.replace(/'/g, "\\'");
        const rows = await cypherQuery(`
          MATCH (m:Machine {id: '${escapedMachine}'})-[:HAS_SENSOR]->(s:Sensor)
          RETURN s.id, s.name, s.category, s.unit, s.last_value, s.last_seen
          ORDER BY s.category, s.name
        `);
        const sensors = rows.map((r: any) => {
          if (Array.isArray(r)) {
            return {
              id: r[0], name: r[1], category: r[2],
              unit: r[3], last_value: r[4], last_seen: r[5],
            };
          }
          return r;
        });
        return JSON.stringify({ machine, sensors, total: sensors.length });
      }

      default:
        return JSON.stringify({ error: `Unknown KG sensor tool: ${name}` });
    }
  } catch (err: any) {
    logger.warn({ err: err.message, tool: name }, 'KG sensor tool failed');
    return JSON.stringify({ error: `KG query failed: ${err.message}` });
  }
}

export function isKgSensorTool(name: string): boolean {
  return name === 'kg_discovered_machines' || name === 'kg_machine_sensors';
}
