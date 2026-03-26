// i3X Gateway Routes — OSF as i3X Server (Read-Only)
// REST facade on the Knowledge Graph (Apache AGE)
// Response formats match i3x-client.ts interfaces

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

// ── GET /namespaces — ISA-95 hierarchy (distinct domains/sites/areas) ──

router.get('/namespaces', requireAuth, async (_req: Request, res: Response) => {
  try {
    const sites = await cypherQuery(`
      MATCH (s:Site) RETURN s.name AS name
    `);
    const areas = await cypherQuery(`
      MATCH (a:Area) RETURN a.name AS name
    `);

    const namespaces = [
      ...sites.map((s: any) => ({
        uri: `urn:osf:site:${s}`,
        displayName: typeof s === 'string' ? s : s?.name || String(s),
      })),
      ...areas.map((a: any) => ({
        uri: `urn:osf:area:${a}`,
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
    // Get distinct labels from the graph
    const rows = await cypherQuery(`
      MATCH (n)
      WITH labels(n) AS lbls
      UNWIND lbls AS lbl
      RETURN DISTINCT lbl
    `);

    const objectTypes = rows.map((label: any) => {
      const name = typeof label === 'string' ? label : String(label);
      return {
        elementId: `type:${name}`,
        displayName: name.replace(/_/g, ' '),
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

function validateLabel(label: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label) && label.length <= 100;
}

router.get('/objects', requireAuth, async (req: Request, res: Response) => {
  try {
    const typeId = req.query.typeId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);

    let cypher: string;
    if (typeId) {
      // Strip "type:" prefix if present
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

    const objects = rows.map((row: any) => {
      const props = typeof row === 'object' && row !== null ? row : {};
      // Apache AGE returns {eid, props, lbls} or just the properties depending on the query
      const nodeProps = props.props || props;
      const labels = props.lbls || [];
      const primaryLabel = Array.isArray(labels) && labels.length > 0 ? labels[0] : 'Unknown';

      return {
        elementId: String(nodeProps.id || nodeProps.machine_id || nodeProps.order_no || props.eid || ''),
        displayName: nodeProps.name || nodeProps.displayName || nodeProps.id || String(props.eid || ''),
        typeId: `type:${primaryLabel}`,
        properties: nodeProps,
      };
    });

    res.json(objects);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects query failed');
    res.status(500).json({ error: 'Failed to query objects' });
  }
});

// ── GET /relationshiptypes — Distinct edge labels from KG ───────

router.get('/relationshiptypes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await cypherQuery(`
      MATCH ()-[r]->()
      RETURN DISTINCT type(r) AS relType
    `);

    const relTypes = rows.map((rt: any) => {
      const name = typeof rt === 'string' ? rt : String(rt);
      return {
        elementId: `rel:${name}`,
        displayName: name.replace(/_/g, ' '),
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
    const { objectIds } = req.body;
    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      res.status(400).json({ error: 'objectIds array required' });
      return;
    }
    if (objectIds.length > 100) {
      res.status(400).json({ error: 'Max 100 objectIds per request' });
      return;
    }

    const results: any[] = [];
    for (const oid of objectIds) {
      if (typeof oid !== 'string' || oid.length > 200) continue;
      // Escape single quotes in the ID to prevent Cypher injection
      const safeId = oid.replace(/'/g, "\\'");
      try {
        const rows = await cypherQuery(`
          MATCH (n) WHERE n.id = '${safeId}' OR n.machine_id = '${safeId}' OR n.order_no = '${safeId}'
          RETURN properties(n) AS props LIMIT 1
        `);
        if (rows.length > 0) {
          results.push({
            objectId: oid,
            values: rows[0],
          });
        }
      } catch (err: any) {
        logger.debug({ objectId: oid, err: err.message }, '[i3x] value lookup failed for object');
      }
    }

    res.json(results);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] objects/value query failed');
    res.status(500).json({ error: 'Failed to query values' });
  }
});

// ── GET /subscriptions — Active sync channels (from config) ─────

router.get('/subscriptions', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Return MQTT topic subscriptions and polling jobs from the KG builder
    // These are runtime state — we return what's configured, not live state
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

// ── GET /objects/:id/related — Related objects via edges ─────────

router.get('/objects/:id/related', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id || id.length > 200) {
      res.status(400).json({ error: 'Invalid object ID' });
      return;
    }
    const safeId = id.replace(/'/g, "\\'");
    const direction = req.query.direction as string || 'both';

    let cypher: string;
    if (direction === 'outgoing') {
      cypher = `MATCH (n)-[r]->(m) WHERE n.id = '${safeId}' OR n.machine_id = '${safeId}' RETURN type(r) AS relType, properties(m) AS props, labels(m) AS lbls LIMIT 100`;
    } else if (direction === 'incoming') {
      cypher = `MATCH (n)<-[r]-(m) WHERE n.id = '${safeId}' OR n.machine_id = '${safeId}' RETURN type(r) AS relType, properties(m) AS props, labels(m) AS lbls LIMIT 100`;
    } else {
      cypher = `MATCH (n)-[r]-(m) WHERE n.id = '${safeId}' OR n.machine_id = '${safeId}' RETURN type(r) AS relType, properties(m) AS props, labels(m) AS lbls LIMIT 100`;
    }

    const rows = await cypherQuery(cypher);

    const related = rows.map((row: any) => ({
      relationshipType: row?.relType || 'UNKNOWN',
      object: {
        elementId: row?.props?.id || row?.props?.machine_id || '',
        displayName: row?.props?.name || row?.props?.id || '',
        typeId: `type:${Array.isArray(row?.lbls) && row.lbls.length > 0 ? row.lbls[0] : 'Unknown'}`,
        properties: row?.props || {},
      },
    }));

    res.json(related);
  } catch (err: any) {
    logger.error({ err: err.message }, '[i3x] related objects query failed');
    res.status(500).json({ error: 'Failed to query related objects' });
  }
});

export default router;
