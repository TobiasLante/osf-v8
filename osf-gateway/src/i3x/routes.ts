// i3X Gateway Routes — OSF as i3X Server (Read-Only)
// REST facade on the Knowledge Graph (Apache AGE)
// Response formats match CESMII i3X / i3x-client.ts interfaces

import { Router, Request, Response } from 'express';
import neo4j, { Driver } from 'neo4j-driver';
import { requireAuth } from '../auth/middleware';
import { logger } from '../logger';
import { openApiSpec } from './openapi';

const router = Router();

// ── Neo4j connection (same graph as KG Builder) ─────────────────

const NEO4J_URL = process.env.NEO4J_URL || 'bolt://osf-neo4j.osf.svc.cluster.local:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || '';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    const auth = NEO4J_PASSWORD ? neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD) : undefined;
    driver = neo4j.driver(NEO4J_URL, auth);
  }
  return driver;
}

async function cypherQuery(cypher: string, params?: Record<string, any>): Promise<any[]> {
  const session = getDriver().session({ database: NEO4J_DATABASE });
  try {
    const result = await session.run(cypher, params || {});
    return result.records.map(r => {
      if (r.keys.length === 1) {
        return toJS(r.get(r.keys[0]));
      }
      const obj: any = {};
      for (const key of r.keys) {
        obj[key] = toJS(r.get(key));
      }
      return obj;
    });
  } finally {
    await session.close();
  }
}

/** Convert Neo4j types (Integer, Node, etc.) to plain JS */
function toJS(val: any): any {
  if (val === null || val === undefined) return val;
  if (neo4j.isInt(val)) return val.toNumber();
  if (val.properties && val.labels) {
    // Node
    return { ...toJSProps(val.properties), _labels: val.labels };
  }
  if (val.properties && val.type) {
    // Relationship
    return { ...toJSProps(val.properties), _type: val.type };
  }
  if (Array.isArray(val)) return val.map(toJS);
  if (typeof val === 'object') return toJSProps(val);
  return val;
}

function toJSProps(props: Record<string, any>): Record<string, any> {
  const out: any = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = neo4j.isInt(v) ? v.toNumber() : v;
  }
  return out;
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
  <title>OSF i3X API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #0a0a0f; font-family: -apple-system, system-ui, sans-serif; }
    /* Hide default topbar */
    .swagger-ui .topbar { display: none; }
    /* OSF branded header */
    .osf-header {
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
      border-bottom: 1px solid rgba(255,149,0,0.2);
      padding: 16px 24px;
      display: flex; align-items: center; gap: 12px;
    }
    .osf-logo { width: 32px; height: 32px; border-radius: 4px; background: linear-gradient(135deg, #ff9500, #ff6b00); display: flex; align-items: center; justify-content: center; color: #0a0a0f; font-weight: 800; font-size: 14px; }
    .osf-title { color: #fff; font-size: 18px; font-weight: 600; }
    .osf-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: rgba(255,149,0,0.15); color: #ff9500; border: 1px solid rgba(255,149,0,0.3); letter-spacing: 0.5px; }
    /* Dark theme overrides */
    .swagger-ui { background: #0a0a0f; }
    .swagger-ui .info .title { color: #ff9500; }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .scheme-container { background: #0f0f1a; box-shadow: none; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .swagger-ui .opblock-tag { color: #e0e0e0; border-bottom-color: rgba(255,255,255,0.08); }
    .swagger-ui .opblock .opblock-summary { border-color: rgba(255,255,255,0.08); }
    .swagger-ui .opblock .opblock-summary-description { color: #999; }
    .swagger-ui .opblock.opblock-get { background: rgba(97,175,254,0.05); border-color: rgba(97,175,254,0.3); }
    .swagger-ui .opblock.opblock-post { background: rgba(73,204,144,0.05); border-color: rgba(73,204,144,0.3); }
    .swagger-ui .opblock-body { background: #0a0a0f; }
    .swagger-ui table thead tr td, .swagger-ui table thead tr th { color: #ccc; border-bottom-color: rgba(255,255,255,0.1); }
    .swagger-ui .model-title { color: #ff9500; }
    .swagger-ui .model { color: #ccc; }
    .swagger-ui .prop-type { color: #ff9500; }
    .swagger-ui .parameter__name { color: #e0e0e0; }
    .swagger-ui .parameter__type { color: #999; }
    .swagger-ui .response-col_status { color: #ff9500; }
    .swagger-ui .responses-inner { background: #0f0f1a; }
    .swagger-ui select { background: #1a1a2e; color: #e0e0e0; border-color: rgba(255,255,255,0.15); }
    .swagger-ui input[type=text] { background: #1a1a2e; color: #e0e0e0; border-color: rgba(255,255,255,0.15); }
    .swagger-ui textarea { background: #1a1a2e; color: #e0e0e0; border-color: rgba(255,255,255,0.15); }
    .swagger-ui .btn { border-color: rgba(255,255,255,0.15); }
    .swagger-ui .btn.authorize { color: #ff9500; border-color: #ff9500; }
    .swagger-ui .markdown p, .swagger-ui .markdown li { color: #bbb; }
    .swagger-ui .info .description .markdown p { color: #999; }
    .swagger-ui .info a { color: #ff9500; }
  </style>
</head>
<body>
  <div class="osf-header">
    <div class="osf-logo">OS</div>
    <span class="osf-title">OpenShopFloor i3X API</span>
    <span class="osf-badge">CESMII SM Profile Compatible</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      defaultModelsExpandDepth: 2,
      docExpansion: 'list',
    });
  </script>
</body>
</html>`);
});

// ── GET /namespaces — ISA-95 hierarchy (distinct domains/sites/areas) ──

router.get('/namespaces', async (_req: Request, res: Response) => {
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

router.get('/objecttypes', async (_req: Request, res: Response) => {
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

router.get('/objects', async (req: Request, res: Response) => {
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
      cypher = `MATCH (n:${label}) RETURN n LIMIT ${limit}`;
    } else {
      cypher = `MATCH (n) RETURN n LIMIT ${limit}`;
    }

    const rows = await cypherQuery(cypher);
    res.json(rows.map(formatObject));
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects query failed');
    res.status(500).json({ error: 'Failed to query objects' });
  }
});

// ── GET /objects/:id — Single object by elementId ───────────────

router.get('/objects/:id', async (req: Request, res: Response) => {
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
      RETURN n LIMIT 1
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

router.get('/objects/:id/children', async (req: Request, res: Response) => {
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
      RETURN child LIMIT 200
    `);
    res.json(rows.map(formatObject));
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] children query failed');
    res.status(500).json({ error: 'Failed to query children' });
  }
});

// ── GET /relationshiptypes — Distinct edge labels from KG ───────

router.get('/relationshiptypes', async (_req: Request, res: Response) => {
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
          RETURN n LIMIT 1
        `);
        if (rows.length > 0) {
          const { _labels, ...props } = rows[0] || {};
          results.push({ elementId: oid, values: props });
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
          RETURN type(r) AS relType, m LIMIT 100
        `);

        for (const row of rows) {
          results.push({
            sourceElementId: oid,
            relationshipType: row?.relType || 'UNKNOWN',
            object: formatObject(row?.m),
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

router.get('/subscriptions', async (_req: Request, res: Response) => {
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

// ── GET /objects/:id/kpis — KPI values for an object ────────────

router.get('/objects/:id/kpis', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id || id.length > 200) {
      res.status(400).json({ error: 'Invalid object ID' });
      return;
    }
    const safe = safeEscape(id);
    const rows = await cypherQuery(`
      MATCH (m)-[:HAS_KPI]->(k:KPI)
      WHERE m.id = '${safe}' OR m.machine_id = '${safe}' OR m.order_no = '${safe}'
      RETURN k
    `);

    const kpis = rows.map((row: any) => {
      const p = typeof row === 'object' && row !== null ? row : {};
      return {
        kpiId: p.kpi_type || p.id,
        name: p.name,
        value: p.value,
        unit: p.unit,
        category: p.category,
        target: p.target,
        warning: p.warning,
        critical: p.critical,
        lastCalculated: p.last_calculated,
        status: p.value != null && p.critical != null && p.warning != null
          ? p.value >= (p.target || Infinity) ? 'good'
            : p.value >= p.warning ? 'warning'
            : 'critical'
          : undefined,
      };
    });

    res.json(kpis);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] kpis query failed');
    res.status(500).json({ error: 'Failed to query KPIs' });
  }
});

// ── Shared object formatter ─────────────────────────────────────

/** Composition label set — ISA-95 hierarchy types that contain children */
const COMPOSITION_LABELS = new Set(['Site', 'Area', 'ProductionLine', 'Enterprise', 'Machine']);

function formatObject(row: any): any {
  if (!row || typeof row !== 'object') return { elementId: '', displayName: '' };

  // Neo4j node: { ...props, _labels: [...] }  (via toJS conversion)
  const labels = Array.isArray(row._labels) ? row._labels : [];
  const { _labels, ...nodeProps } = row;
  const primaryLabel = labels.length > 0 ? labels[0] : undefined;
  const isComposition = labels.some((l: string) => COMPOSITION_LABELS.has(l));
  const elementId = String(nodeProps.id || nodeProps.machine_id || nodeProps.order_no || '');

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
