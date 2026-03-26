// i3X Gateway Routes — OSF as i3X Server (Read-Only)
// REST facade on the Knowledge Graph (Apache AGE)
// Response formats match CESMII i3X / i3x-client.ts interfaces

import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { kgPool } from '../kg-agent/index';
import { logger } from '../logger';

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

function safeEscape(id: string): string {
  return id.replace(/'/g, "\\'");
}

// ── GET /openapi.json — OpenAPI spec for i3X discovery ──────────

router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'OSF i3X API',
      version: '1.0.0',
      description: 'CESMII i3X-compatible REST API on the OSF Knowledge Graph',
    },
    paths: {
      '/namespaces': { get: { summary: 'ISA-95 hierarchy namespaces (Sites, Areas)' } },
      '/objecttypes': { get: { summary: 'SM Profile types (distinct KG labels)' } },
      '/objects': { get: { summary: 'Object instances, optional ?typeId= filter' } },
      '/objects/{id}': { get: { summary: 'Single object by elementId' } },
      '/objects/related': { post: { summary: 'Related objects for given elementIds' } },
      '/objects/value': { post: { summary: 'Current property values for elementIds' } },
      '/objects/{id}/children': { get: { summary: 'Child objects (composition)' } },
      '/relationshiptypes': { get: { summary: 'Distinct edge types from KG' } },
      '/subscriptions': { get: { summary: 'Active sync channels (MQTT, Polling)' } },
    },
  });
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

router.get('/objecttypes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await cypherQuery(`
      MATCH (n)
      WITH labels(n) AS lbls
      UNWIND lbls AS lbl
      RETURN DISTINCT lbl
    `);

    // Build parent lookup: child label → parent label (from nodes with multiple labels)
    const parentLookup = new Map<string, string>();
    const multiLabelRows = await cypherQuery(`
      MATCH (n) WHERE size(labels(n)) > 1
      RETURN DISTINCT labels(n) AS lbls LIMIT 200
    `);
    for (const row of multiLabelRows) {
      const lbls = Array.isArray(row) ? row : row?.lbls || [];
      if (lbls.length >= 2) {
        // First label is the specific type, subsequent are parent types
        for (let i = 0; i < lbls.length - 1; i++) {
          parentLookup.set(lbls[i], lbls[lbls.length - 1]);
        }
      }
    }

    const objectTypes = rows.map((label: any) => {
      const name = typeof label === 'string' ? label : String(label);
      return {
        elementId: `type:${name}`,
        displayName: name.replace(/_/g, ' '),
        parentTypeId: parentLookup.has(name) ? `type:${parentLookup.get(name)}` : undefined,
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
    const rows = await cypherQuery(`
      MATCH (n) WHERE n.id = '${safe}' OR n.machine_id = '${safe}' OR n.order_no = '${safe}'
      RETURN id(n) AS eid, properties(n) AS props, labels(n) AS lbls LIMIT 1
    `);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    res.json(formatObject(rows[0]));
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

    const relFilter = relationshipTypeId
      ? `:${relationshipTypeId.replace(/^rel:/, '').replace(/[^a-zA-Z0-9_]/g, '')}`
      : '';

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

function formatObject(row: any): any {
  const props = typeof row === 'object' && row !== null ? row : {};
  const nodeProps = props.props || props;
  const labels = props.lbls || [];
  const primaryLabel = Array.isArray(labels) && labels.length > 0 ? labels[0] : 'Unknown';

  // Detect parentId from PART_OF edges (if available in properties)
  const parentId = nodeProps._parentId || undefined;

  // Composition: nodes connected via PART_OF are compositions
  const isComposition = Array.isArray(labels) && labels.some((l: string) =>
    ['Site', 'Area', 'ProductionLine', 'Enterprise'].includes(l)
  );

  return {
    elementId: String(nodeProps.id || nodeProps.machine_id || nodeProps.order_no || props.eid || ''),
    displayName: nodeProps.name || nodeProps.displayName || nodeProps.id || String(props.eid || ''),
    typeId: `type:${primaryLabel}`,
    parentId,
    isComposition,
    namespaceUri: `urn:osf:${primaryLabel.toLowerCase()}`,
    properties: nodeProps,
  };
}

export default router;
