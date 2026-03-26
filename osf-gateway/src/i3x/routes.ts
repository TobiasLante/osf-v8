// i3X Gateway Routes — OSF as i3X Server (Read-Only)
// REST facade on the Knowledge Graph (Apache AGE)
// Response formats match CESMII i3X / i3x-client.ts interfaces

import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { kgPool } from '../kg-agent/index';
import { logger } from '../logger';
import { openApiSpec } from './openapi';

const router = Router();

const DB_SCHEMA = process.env.DB_SCHEMA || 'llm_test_v3';
const GRAPH_NAME = 'factory_graph';

// ── Cypher query helper (same pattern as kg-agent/tools.ts) ─────

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

function validateLabel(label: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label) && label.length <= 100;
}

/** Escape user input for Cypher string literals — matches cypher-utils.ts escapeId() */
function safeEscape(id: string): string {
  return String(id || '')
    .replace(/\\/g, '\\\\')   // backslash first (before other escapes add backslashes)
    .replace(/'/g, "\\'")     // single quotes
    .replace(/\$/g, '')       // strip dollar signs (AGE parameter syntax)
    .substring(0, 200);
}

// ── GET /openapi.json — Full OpenAPI 3.0.3 spec ─────────────────

router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// ── GET /docs — Embedded Swagger UI ─────────────────────────────

router.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>OSF i3X API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #1a1a2e; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #e94560; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`);
});

// ── GET /namespaces — ISA-95 hierarchy (distinct domains/sites/areas) ──

router.get('/namespaces', requireAuth, async (_req: Request, res: Response) => {
  try {
    const sites = await cypherQuery(`MATCH (s:Site) RETURN s.name AS name`);
    const areas = await cypherQuery(`MATCH (a:Area) RETURN a.name AS name`);

    const namespaces = [
      ...sites.map((s: any) => ({
        uri: `urn:osf:site:${typeof s === 'string' ? s : s?.name || s}`,
        displayName: typeof s === 'string' ? s : s?.name || String(s),
      })),
      ...areas.map((a: any) => ({
        uri: `urn:osf:area:${typeof a === 'string' ? a : a?.name || a}`,
        displayName: typeof a === 'string' ? a : a?.name || String(a),
      })),
    ];

    res.json(namespaces);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] namespaces query failed');
    res.status(500).json({ error: 'Failed to query namespaces' });
  }
});

// ── GET /objecttypes — SM Profiles (node labels as types) ───────

/** Known type hierarchy from SM Profile parentType — authoritative source of truth */
const TYPE_HIERARCHY: Record<string, string> = {
  CNC_Machine: 'Machine',
  MillingMachine: 'Machine',
  FiveAxisMillingMachine: 'Machine',
  Lathe: 'Machine',
  GrindingMachine: 'Machine',
  InjectionMoldingMachine: 'Machine',
  FFS_Cell: 'Machine',
  AssemblyLine: 'Machine',
  CustomerOrder: 'Order',
  ProductionOrder: 'Order',
  PurchaseOrder: 'Order',
  MaintenanceOrder: 'Order',
};

router.get('/objecttypes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await cypherQuery(`
      MATCH (n)
      WITH labels(n) AS lbls
      UNWIND lbls AS lbl
      RETURN DISTINCT lbl
    `);

    const objectTypes = rows.map((label: any) => {
      const name = typeof label === 'string' ? label : String(label);
      const parentLabel = TYPE_HIERARCHY[name];
      return {
        elementId: `type:${name}`,
        displayName: name.replace(/_/g, ' '),
        parentTypeId: parentLabel ? `type:${parentLabel}` : undefined,
        namespaceUri: `urn:osf:smprofile:${name}`,
      };
    });

    res.json(objectTypes);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objecttypes query failed');
    res.status(500).json({ error: 'Failed to query object types' });
  }
});

// ── GET /objects — Instances from KG (with optional typeId filter) ──

router.get('/objects', requireAuth, async (req: Request, res: Response) => {
  try {
    const typeId = req.query.typeId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);

    let cypher: string;
    if (typeId) {
      const label = typeId.replace(/^type:/, '');
      if (!validateLabel(label)) {
        res.status(400).json({ error: 'Invalid typeId' });
        return;
      }
      cypher = `MATCH (n:${label}) RETURN id(n) AS eid, properties(n) AS props, labels(n) AS lbls LIMIT ${limit}`;
    } else {
      cypher = `MATCH (n) RETURN id(n) AS eid, properties(n) AS props, labels(n) AS lbls LIMIT ${limit}`;
    }

    const rows = await cypherQuery(cypher);
    res.json(rows.map(formatObject));
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects query failed');
    res.status(500).json({ error: 'Failed to query objects' });
  }
});

// ── GET /objects/:id — Single object by elementId ───────────────

router.get('/objects/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id || id.length > 200) {
      res.status(400).json({ error: 'Invalid object ID' });
      return;
    }
    const safe = safeEscape(id);
    // Main node
    const rows = await cypherQuery(`
      MATCH (n) WHERE n.id = '${safe}' OR n.machine_id = '${safe}' OR n.order_no = '${safe}'
      RETURN id(n) AS eid, properties(n) AS props, labels(n) AS lbls LIMIT 1
    `);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    // Resolve parentId via PART_OF edge
    let parentId: string | undefined;
    try {
      const parentRows = await cypherQuery(`
        MATCH (n)-[:PART_OF]->(parent)
        WHERE n.id = '${safe}' OR n.machine_id = '${safe}' OR n.order_no = '${safe}'
        RETURN parent.id AS pid, parent.name AS pname LIMIT 1
      `);
      if (parentRows.length > 0) {
        const pr = parentRows[0];
        parentId = typeof pr === 'string' ? pr : pr?.pid || pr?.pname;
      }
    } catch { /* parent lookup is optional */ }
    const obj = formatObject(rows[0]);
    if (parentId) obj.parentId = parentId;
    res.json(obj);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] object query failed');
    res.status(500).json({ error: 'Failed to query object' });
  }
});

// ── GET /objects/:id/children — Composition children ────────────

router.get('/objects/:id/children', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id || id.length > 200) {
      res.status(400).json({ error: 'Invalid object ID' });
      return;
    }
    const safe = safeEscape(id);
    const rows = await cypherQuery(`
      MATCH (parent)<-[:PART_OF]-(child)
      WHERE parent.id = '${safe}' OR parent.name = '${safe}'
      RETURN id(child) AS eid, properties(child) AS props, labels(child) AS lbls LIMIT 200
    `);
    res.json(rows.map(formatObject));
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] children query failed');
    res.status(500).json({ error: 'Failed to query children' });
  }
});

// ── GET /relationshiptypes — Distinct edge labels from KG ───────

router.get('/relationshiptypes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await cypherQuery(`
      MATCH ()-[r]->()
      RETURN DISTINCT type(r) AS relType
    `);

    // Build inverse lookup from known pairs
    const inverseMap: Record<string, string> = {
      PART_OF: 'CONTAINS',
      CONTAINS: 'PART_OF',
      PRODUCES: 'PRODUCED_BY',
      EXECUTES: 'EXECUTED_BY',
      HAS_SENSOR: 'SENSOR_OF',
      HAS_BOM: 'BOM_OF',
      FOR_ARTICLE: 'ORDERED_IN',
      TRIGGERS: 'TRIGGERED_BY',
      RUNS_ON: 'RUNS',
      FROM_SUPPLIER: 'SUPPLIES',
      USES_MOULD: 'USED_BY',
      FOR_MACHINE: 'HAS_MAINTENANCE',
    };

    const relTypes = rows.map((rt: any) => {
      const name = typeof rt === 'string' ? rt : String(rt);
      return {
        elementId: `rel:${name}`,
        displayName: name.replace(/_/g, ' '),
        inverseDisplayName: inverseMap[name]?.replace(/_/g, ' '),
      };
    });

    res.json(relTypes);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] relationshiptypes query failed');
    res.status(500).json({ error: 'Failed to query relationship types' });
  }
});

// ── POST /objects/value — Current values for specific objects ────

router.post('/objects/value', requireAuth, async (req: Request, res: Response) => {
  try {
    const { elementIds } = req.body;
    if (!Array.isArray(elementIds) || elementIds.length === 0) {
      res.status(400).json({ error: 'elementIds array required' });
      return;
    }
    if (elementIds.length > 100) {
      res.status(400).json({ error: 'Max 100 elementIds per request' });
      return;
    }

    const results: any[] = [];
    for (const oid of elementIds) {
      if (typeof oid !== 'string' || oid.length > 200) continue;
      const safe = safeEscape(oid);
      try {
        const rows = await cypherQuery(`
          MATCH (n) WHERE n.id = '${safe}' OR n.machine_id = '${safe}' OR n.order_no = '${safe}'
          RETURN properties(n) AS props LIMIT 1
        `);
        if (rows.length > 0) {
          results.push({ elementId: oid, values: rows[0] });
        }
      } catch (err: any) {
        logger.debug({ elementId: oid, err: err.message }, '[i3x] value lookup failed');
      }
    }

    res.json(results);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects/value query failed');
    res.status(500).json({ error: 'Failed to query values' });
  }
});

// ── POST /objects/related — Related objects (i3X standard) ──────

router.post('/objects/related', requireAuth, async (req: Request, res: Response) => {
  try {
    const { elementIds, relationshipTypeId } = req.body;
    if (!Array.isArray(elementIds) || elementIds.length === 0) {
      res.status(400).json({ error: 'elementIds array required' });
      return;
    }
    if (elementIds.length > 50) {
      res.status(400).json({ error: 'Max 50 elementIds per request' });
      return;
    }

    let relFilter = '';
    if (relationshipTypeId && typeof relationshipTypeId === 'string') {
      const relLabel = relationshipTypeId.replace(/^rel:/, '');
      if (!validateLabel(relLabel)) {
        res.status(400).json({ error: 'Invalid relationshipTypeId' });
        return;
      }
      relFilter = `:${relLabel}`;
    }

    const results: any[] = [];
    for (const oid of elementIds) {
      if (typeof oid !== 'string' || oid.length > 200) continue;
      const safe = safeEscape(oid);
      try {
        const rows = await cypherQuery(`
          MATCH (n)-[r${relFilter}]-(m)
          WHERE n.id = '${safe}' OR n.machine_id = '${safe}' OR n.order_no = '${safe}'
          RETURN type(r) AS relType, id(m) AS eid, properties(m) AS props, labels(m) AS lbls LIMIT 100
        `);

        for (const row of rows) {
          results.push({
            sourceElementId: oid,
            relationshipType: row?.relType || 'UNKNOWN',
            object: formatObject(row),
          });
        }
      } catch (err: any) {
        logger.debug({ elementId: oid, err: err.message }, '[i3x] related query failed');
      }
    }

    res.json(results);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects/related query failed');
    res.status(500).json({ error: 'Failed to query related objects' });
  }
});

// ── GET /subscriptions — Active sync channels (from config) ─────

router.get('/subscriptions', requireAuth, async (_req: Request, res: Response) => {
  try {
    const mqttBroker = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    const subscriptions = [
      {
        type: 'mqtt',
        broker: mqttBroker,
        topic: 'Factory/#',
        description: 'Factory UNS — all machine telemetry',
      },
    ];
    res.json(subscriptions);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] subscriptions query failed');
    res.status(500).json({ error: 'Failed to query subscriptions' });
  }
});

// ── Shared object formatter ─────────────────────────────────────

/** Composition label set — ISA-95 hierarchy types that contain children */
const COMPOSITION_LABELS = new Set(['Site', 'Area', 'ProductionLine', 'Enterprise', 'Machine']);

function formatObject(row: any): any {
  const props = typeof row === 'object' && row !== null ? row : {};
  const nodeProps = props.props || props;
  const labels = Array.isArray(props.lbls) ? props.lbls : [];
  const primaryLabel = labels.length > 0 ? labels[0] : undefined;

  const isComposition = labels.some((l: string) => COMPOSITION_LABELS.has(l));

  const elementId = String(nodeProps.id || nodeProps.machine_id || nodeProps.order_no || props.eid || '');

  return {
    elementId,
    displayName: nodeProps.name || nodeProps.displayName || nodeProps.id || elementId,
    typeId: primaryLabel ? `type:${primaryLabel}` : undefined,
    isComposition: isComposition || undefined,
    namespaceUri: primaryLabel ? `urn:osf:${primaryLabel.toLowerCase()}` : undefined,
    properties: nodeProps,
  };
}

export default router;
