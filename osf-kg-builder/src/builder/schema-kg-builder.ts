import mqtt, { MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { SMProfile, SourceSchema, SyncSchema, SchemaBuildReport, PollSourceRef } from '../shared/schema-types';
import { vertexCypher, edgeCypher, batchCypher, executeBatched, escapeValue, escapeId, getDriver, validateLabel, BulkNode, BulkEdge, executeBulkNodes, executeBulkEdges, cypherQuery } from '../shared/cypher-utils';
import { generateEmbeddings, nodeToText } from '../shared/embedding-service';
import { sampleMcpTool } from './tool-discovery';
import { logger } from '../shared/logger';
import { config } from '../shared/config';

// ── Run timestamp for _lastSeen tracking ───────────────────────
let currentRunTimestamp = '';
const builtLabels = new Set<string>();

// ── Validation helpers ───────────────────────────────────────────
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function validateIdentifier(name: string, context: string): string {
  if (!isValidIdentifier(name)) throw new Error(`Invalid identifier in ${context}: ${name}`);
  return name;
}

function validateFilter(filter: string): string {
  // Filter comes from trusted schema config, but guard against obvious injection
  if (filter.includes(';') || filter.includes('--')) {
    throw new Error(`Suspicious filter rejected (contains ; or --): ${filter}`);
  }
  return filter;
}

// Backward-compat aliases
type OpcUaMapping = SourceSchema;
type UnsMapping = SyncSchema;

// ── Phase 1: Type System (from SM Profiles) ─────────────────────

export async function buildTypeSystem(profiles: SMProfile[]): Promise<number> {
  const session = getDriver().session({ database: config.neo4j.database });
  let constraintsCreated = 0;

  try {
    for (const profile of profiles) {
      const label = profile.kgNodeLabel;
      const idProp = profile.kgIdProperty;

      validateLabel(label);
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idProp)) {
        throw new Error(`Invalid identifier for idProp: ${idProp}`);
      }

      try {
        // Drop any existing UNIQUE constraint (causes parallel MERGE failures)
        await session.run(
          `DROP CONSTRAINT ${label.toLowerCase()}_id_unique IF EXISTS`
        ).catch(() => {});
        // Create range index for fast MERGE lookups (no uniqueness enforcement)
        await session.run(
          `CREATE INDEX ${label.toLowerCase()}_${idProp}_idx IF NOT EXISTS FOR (n:${label}) ON (n.${idProp})`
        );
        constraintsCreated++;
        logger.info({ label, idProp }, `[SchemaBuild] Index created: ${label}.${idProp}`);
      } catch (err) {
        // Index may already exist — that's fine
        logger.debug({ label, err: (err as Error).message }, '[SchemaBuild] Index skipped');
      }
    }

  } finally {
    await session.close();
  }

  return constraintsCreated;
}

/**
 * Set parentType as additional Neo4j labels on existing nodes.
 * E.g. all InjectionMoldingMachine nodes also get :Machine label.
 * Called AFTER nodes are created (Phase 2).
 */
export async function applyParentLabels(profiles: SMProfile[]): Promise<number> {
  const session = getDriver().session({ database: config.neo4j.database });
  let applied = 0;

  try {
    for (const profile of profiles) {
      const parentType = profile.parentType as string | undefined;
      if (!parentType || parentType === 'null' || parentType === 'None') continue;

      // parentType can be a label name ("Machine") or a profileId ("SMProfile-CNC-Machine")
      const parentLabel = parentType.startsWith('SMProfile-')
        ? profiles.find(p => p.profileId === parentType)?.kgNodeLabel
        : parentType;
      if (!parentLabel) continue;

      try {
        validateLabel(parentLabel);
        await session.run(`MATCH (n:${profile.kgNodeLabel}) SET n:${parentLabel}`);
        applied++;
        logger.info({ label: profile.kgNodeLabel, parentLabel }, `[SchemaBuild] Parent label: :${profile.kgNodeLabel} → also :${parentLabel}`);
      } catch (err) {
        logger.debug({ err: (err as Error).message }, `[SchemaBuild] Parent label failed for ${profile.kgNodeLabel}`);
      }
    }
  } finally {
    await session.close();
  }

  return applied;
}

// ── Phase 2: Instance Nodes (from OPC-UA Mappings) ──────────────

export async function buildInstances(
  mappings: OpcUaMapping[],
  profiles: SMProfile[],
): Promise<{ nodesMerged: number; edgesCreated: number }> {
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  const queries: string[] = [];
  const hierarchyQueries: string[] = [];

  for (const m of mappings) {
    const profile = profileMap.get(m.profileRef);
    if (!profile) {
      logger.warn({ machineId: m.machineId, profileRef: m.profileRef }, '[SchemaBuild] Profile not found, skipping');
      continue;
    }

    const label = profile.kgNodeLabel;
    const idProp = profile.kgIdProperty;

    // Build properties from static props + machine metadata
    const machineId = m.machineId || m.sourceId || '';
    const props: Record<string, any> = {
      [idProp]: machineId,
      name: m.machineName || '',
      opcua_endpoint: m.endpoint || '',
      ...(m.staticProperties || {}),
    };

    queries.push(vertexCypher(label, machineId, props));

    // ISA-95 hierarchy: Site → Area → Line → Machine
    const loc = m.location;
    if (loc?.site) {
      hierarchyQueries.push(vertexCypher('Site', loc.site, { name: loc.site, enterprise: loc.enterprise || '' }));
    }
    if (loc?.area) {
      hierarchyQueries.push(vertexCypher('Area', loc.area, { name: loc.area }));
      if (loc.site) {
        hierarchyQueries.push(edgeCypher('Area', loc.area, 'PART_OF', 'Site', loc.site));
      }
    }
    if (loc?.line) {
      hierarchyQueries.push(vertexCypher('ProductionLine', loc.line, { name: loc.line }));
      if (loc.area) {
        hierarchyQueries.push(edgeCypher('ProductionLine', loc.line, 'PART_OF', 'Area', loc.area));
      }
      // Machine → Line
      hierarchyQueries.push(edgeCypher(label, machineId, 'PART_OF', 'ProductionLine', loc.line));
    }
  }

  // Execute machine nodes
  const nodeResult = await executeBatched(queries);
  logger.info({ success: nodeResult.success, failed: nodeResult.failed }, '[SchemaBuild] Machine nodes merged');

  // Execute hierarchy (deduplicate first)
  const uniqueHierarchy = [...new Set(hierarchyQueries)];
  const hierResult = await executeBatched(uniqueHierarchy);
  logger.info({ success: hierResult.success, failed: hierResult.failed }, '[SchemaBuild] Hierarchy edges created');

  return {
    nodesMerged: nodeResult.success,
    edgesCreated: hierResult.success,
  };
}

// ── Phase 3: Live MQTT Subscriptions (from UNS Mappings) ────────

let mqttClients: MqttClient[] = [];

export async function startLiveUpdates(
  unsMappings: UnsMapping[],
  opcuaMappings: OpcUaMapping[],
  profiles: SMProfile[],
): Promise<number> {
  // Stop existing subscriptions
  await stopLiveUpdates();

  // Build lookup: machineId → { kgNodeLabel, kgIdProperty }
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  const machineToProfile = new Map<string, { label: string; idProp: string }>();
  for (const m of opcuaMappings) {
    const p = profileMap.get(m.profileRef);
    if (p && m.machineId) {
      machineToProfile.set(m.machineId, { label: p.kgNodeLabel, idProp: p.kgIdProperty });
      if (m.machineName) {
        machineToProfile.set(m.machineName, { label: p.kgNodeLabel, idProp: p.kgIdProperty });
      }
    }
  }

  // Also build machineId lookup from machineName
  const nameToId = new Map<string, string>();
  for (const m of opcuaMappings) {
    if (m.machineName && m.machineId) nameToId.set(m.machineName, m.machineId);
  }

  let subscriptionCount = 0;

  for (const uns of unsMappings) {
    if (!uns.broker || !uns.attributeMapping || !uns.machineIdResolution || !uns.topicStructure) continue;

    const { host, port } = uns.broker;
    const brokerUrl = `mqtt://${host}:${port}`;

    // Build attribute lookup: topicAttribute → smAttribute
    const attrMap = new Map<string, string>();
    for (const am of uns.attributeMapping.mappings) {
      attrMap.set(am.topicAttribute, am.smAttribute);
    }

    const machineIdSegment = uns.machineIdResolution.segment;
    const attributeSegment = uns.attributeMapping.attributeSegment || 5;

    try {
      const client = mqtt.connect(brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 10_000,
        clientId: `kg-schema-${uns.syncId}-${Date.now()}`,
      });

      client.on('connect', () => {
        const filter = uns.topicStructure!.subscribeFilter;
        client.subscribe(filter, { qos: 0 }, (err) => {
          if (err) {
            logger.error({ filter, err: err.message }, '[SchemaLive] Subscribe failed');
          } else {
            logger.info({ filter, broker: brokerUrl }, '[SchemaLive] Subscribed');
          }
        });
      });

      // Batch buffer for KG updates
      let updateBuffer: string[] = [];
      let flushTimer: NodeJS.Timeout | null = null;

      const flushBuffer = async () => {
        if (updateBuffer.length === 0) return;
        const batch = updateBuffer.splice(0, updateBuffer.length);
        try {
          await batchCypher(batch);
        } catch (err) {
          logger.warn({ batchSize: batch.length, err: (err as Error).message }, '[SchemaLive] KG batch failed');
        }
      };

      client.on('message', (topic: string, payload: Buffer) => {
        try {
          const segments = topic.split('/');

          // Resolve machine ID from topic
          const rawMachineId = segments[machineIdSegment];
          if (!rawMachineId) return;

          // Try direct ID match, then name→ID lookup
          const machineId = nameToId.get(rawMachineId) || rawMachineId;
          const machineInfo = machineToProfile.get(machineId) || machineToProfile.get(rawMachineId);
          if (!machineInfo) return;

          // Resolve attribute from topic
          const topicAttribute = segments[attributeSegment];
          if (!topicAttribute) return;
          const smAttribute = attrMap.get(topicAttribute);
          if (!smAttribute) return;

          // Parse payload
          const data = JSON.parse(payload.toString());
          const value = extractJsonPath(data, uns.payloadSchema!.valuePath);
          if (value === undefined || value === null) return;

          const timestamp = extractJsonPath(data, uns.payloadSchema!.timestampPath);

          // Build SET query with proper escaping
          const safeAttr = smAttribute.replace(/[^a-zA-Z0-9_]/g, '_');
          if (!isValidIdentifier(safeAttr)) return;
          const valStr = typeof value === 'string' ? escapeValue(value) : value;
          let setClause = `n.${safeAttr} = ${valStr}`;
          if (timestamp) {
            setClause += `, n.${safeAttr}_ts = ${escapeValue(String(timestamp))}`;
          }

          const cypher = `MATCH (n:${escapeId(machineInfo.label)} {${escapeId(machineInfo.idProp)}: ${escapeValue(machineId)}}) SET ${setClause}`;
          updateBuffer.push(cypher);

          // Flush every 2 seconds
          if (!flushTimer) {
            flushTimer = setTimeout(async () => {
              flushTimer = null;
              await flushBuffer();
            }, 2000);
          }
        } catch (e: any) {
          logger.debug({ topic, err: e.message }, '[SchemaLive] Skip unparseable message');
        }
      });

      client.on('error', (err) => {
        logger.warn({ broker: brokerUrl, err: err.message }, '[SchemaLive] MQTT error');
      });

      mqttClients.push(client);
      subscriptionCount++;
    } catch (err) {
      logger.error({ broker: brokerUrl, err: (err as Error).message }, '[SchemaLive] Failed to connect');
    }
  }

  return subscriptionCount;
}

export async function stopLiveUpdates(): Promise<void> {
  for (const client of mqttClients) {
    try { client.end(true); } catch (e: any) { logger.debug({ err: e.message }, '[SchemaLive] Client close error'); }
  }
  mqttClients = [];
  stopPolling();
  stopPgNotify();
}

// ── Phase 2b: Instance Nodes from PostgreSQL Sources ────────────

const MAX_CONCURRENT_SOURCES = 4;

/** Load a single PG source → returns bulk nodes + edges */
async function loadPgSource(
  src: SourceSchema,
  profile: SMProfile,
  idPropToLabels?: Map<string, string[]>,
): Promise<{ nodes: BulkNode[]; edges: BulkEdge[] }> {
  const conn = src.connection!;
  const pool = new Pool({
    host: conn.host, port: conn.port, database: conn.database,
    user: process.env.PG_USER || 'admin',
    password: process.env.PG_PASSWORD || config.db.password,
    max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 120000, query_timeout: 300000,
  });

  try {
    const idCol = src.columnMappings!.find(c => c.isId);
    if (!idCol) return { nodes: [], edges: [] };

    validateIdentifier(conn.schema, 'connection.schema');
    validateIdentifier(conn.table, 'connection.table');

    // Build SELECT with computed columns
    const isExpr = (col: string) => /[^a-zA-Z0-9_]/.test(col);
    const colAliases = new Map<string, string>();
    const selectParts: string[] = ['*'];
    for (const cm of src.columnMappings!) {
      if (isExpr(cm.column)) {
        const alias = `_expr_${cm.smAttribute}`;
        selectParts.push(`(${cm.column}) AS ${alias}`);
        colAliases.set(cm.column, alias);
      }
    }

    let query = `SELECT ${selectParts.join(', ')} FROM ${conn.schema}.${conn.table}`;
    if (src.filter) query += ` WHERE ${validateFilter(src.filter)}`;

    const result = await pool.query(query);
    const nodes: BulkNode[] = [];
    const edges: BulkEdge[] = [];

    for (const row of result.rows) {
      const idColKey = colAliases.get(idCol.column) || idCol.column;
      const rawId = row[idColKey];
      if (rawId === null || rawId === undefined || rawId === '') continue;
      // Preserve original type (string or number) — Neo4j must store the same type for MATCH to work
      const id: string | number = typeof rawId === 'number' ? rawId : String(rawId);

      const props: Record<string, any> = {};
      for (const cm of src.columnMappings!) {
        const key = colAliases.get(cm.column) || cm.column;
        const val = row[key];
        if (val !== null && val !== undefined) {
          props[cm.smAttribute] = typeof val === 'object' && val instanceof Date ? val.toISOString() : val;
        }
      }

      if (currentRunTimestamp) props._lastSeen = currentRunTimestamp;
      nodes.push({ label: profile.kgNodeLabel, id, idProp: profile.kgIdProperty, props });
      builtLabels.add(profile.kgNodeLabel);

      if (src.edges) {
        for (const edge of src.edges) {
          const fkValue = row[edge.fkColumn];
          if (fkValue === null || fkValue === undefined || fkValue === '') continue;
          const targetIdProp = edge.targetIdProp || 'id';
          const toLabels = idPropToLabels?.get(targetIdProp) || [];
          if (toLabels.length === 0) continue; // No profile with this idProp
          // Preserve original type — must match the type stored on the target node
          const toId: string | number = typeof fkValue === 'number' ? fkValue : String(fkValue);
          edges.push({
            fromLabel: profile.kgNodeLabel, fromId: id,
            fromIdProp: profile.kgIdProperty,
            edgeLabel: edge.type,
            toLabels,
            toId,
            toIdProp: targetIdProp,
          });
        }
      }
    }

    return { nodes, edges };
  } finally {
    await pool.end();
  }
}

export async function buildInstancesFromPostgres(
  sources: SourceSchema[],
  profiles: SMProfile[],
): Promise<{ nodesMerged: number; edgesCreated: number }> {
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  // Lookup: kgIdProperty → [kgNodeLabels] (for resolving targetIdProp → target labels)
  const idPropToLabels = new Map<string, string[]>();
  for (const p of profiles) {
    const labels = idPropToLabels.get(p.kgIdProperty) || [];
    if (!labels.includes(p.kgNodeLabel)) labels.push(p.kgNodeLabel);
    idPropToLabels.set(p.kgIdProperty, labels);
  }
  let totalNodes = 0;
  let totalEdges = 0;

  // Filter valid PG sources
  const pgSources = sources.filter(s =>
    s.sourceType === 'postgresql' && s.connection && s.columnMappings && profileMap.has(s.profileRef)
  );

  // ── Pass 1: Load all sources, merge nodes immediately, collect ALL edges ───
  const allEdges: BulkEdge[] = [];

  for (let i = 0; i < pgSources.length; i += MAX_CONCURRENT_SOURCES) {
    const batch = pgSources.slice(i, i + MAX_CONCURRENT_SOURCES);

    const results = await Promise.allSettled(
      batch.map(async (src) => {
        const profile = profileMap.get(src.profileRef)!;
        const { nodes, edges } = await loadPgSource(src, profile, idPropToLabels);

        // Merge nodes via UNWIND — then free the array immediately
        const nodeResult = await executeBulkNodes(nodes, (done, total) => {
          if (done % 2000 === 0 || done === total) {
            logger.info({ sourceId: src.sourceId, done, total }, '[SchemaBuild] Bulk merging nodes...');
          }
        });
        nodes.length = 0; // Free node objects (can be 350k+)

        logger.info({
          sourceId: src.sourceId, table: src.connection!.table, nodes: nodeResult.success,
        }, '[SchemaBuild] PostgreSQL nodes loaded');

        return { nodeCount: nodeResult.success, edges };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalNodes += r.value.nodeCount;
        for (const e of r.value.edges) allEdges.push(e);
        r.value.edges.length = 0; // Free after pushing to allEdges
      } else {
        logger.error({ err: r.reason?.message }, '[SchemaBuild] PostgreSQL source failed');
      }
    }
  }

  // ── Pass 2: Write ALL edges after ALL nodes exist ───
  if (allEdges.length > 0) {
    logger.info({ edgeCount: allEdges.length }, '[SchemaBuild] Creating edges (all nodes exist now)...');
    const edgeResult = await executeBulkEdges(allEdges, (done, total) => {
      if (done % 5000 === 0 || done === total) {
        logger.info({ done, total }, '[SchemaBuild] Bulk merging edges...');
      }
    });
    totalEdges = edgeResult.success;
    logger.info({ success: edgeResult.success, failed: edgeResult.failed }, '[SchemaBuild] Edges created');
  }

  // Free memory — allEdges can hold 1M+ objects (~500MB)
  allEdges.length = 0;

  return { nodesMerged: totalNodes, edgesCreated: totalEdges };
}

// ── Phase 3b: Polling Sync ──────────────────────────────────────

let pollingTimers: NodeJS.Timeout[] = [];
const lastPollTimestamps = new Map<string, string>();
const pollingPools: Pool[] = [];

export function stopPolling(): void {
  for (const t of pollingTimers) clearInterval(t);
  pollingTimers = [];
  lastPollTimestamps.clear();
  for (const p of pollingPools) {
    p.end().catch(() => {});
  }
  pollingPools.length = 0;
}

export async function startPollingSync(
  pollSyncs: SyncSchema[],
  allSources: SourceSchema[],
  profiles: SMProfile[],
): Promise<number> {
  stopPolling();

  const sourceMap = new Map(allSources.map(s => [s.sourceId, s]));
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  let jobCount = 0;

  for (const sync of pollSyncs) {
    if (sync.syncType !== 'polling' || !sync.sources) continue;

    const intervalMs = sync.pollIntervalMs || 30000;

    // Create one pool per source at setup time and reuse across poll cycles
    const poolForSource = new Map<string, Pool>();
    for (const ref of sync.sources) {
      const src = sourceMap.get(ref.sourceRef);
      if (!src || src.sourceType !== 'postgresql' || !src.connection) continue;
      const conn = src.connection;
      const pool = new Pool({
        host: conn.host, port: conn.port, database: conn.database,
        user: process.env.PG_USER || 'admin',
        password: process.env.PG_PASSWORD || config.db.password,
        max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 120000, query_timeout: 300000,
      });
      poolForSource.set(ref.sourceRef, pool);
      pollingPools.push(pool);
    }

    const pollFn = async () => {
      for (const ref of sync.sources!) {
        const src = sourceMap.get(ref.sourceRef);
        if (!src || src.sourceType !== 'postgresql' || !src.connection || !src.columnMappings) continue;

        const profile = profileMap.get(src.profileRef);
        if (!profile) continue;

        const conn = src.connection;
        const pool = poolForSource.get(ref.sourceRef);
        if (!pool) continue;

        try {
          const idCol = src.columnMappings.find(c => c.isId);
          if (!idCol) continue;

          validateIdentifier(conn.schema, 'connection.schema');
          validateIdentifier(conn.table, 'connection.table');

          // Computed column aliases (same logic as buildInstancesFromPostgres)
          const isExprP = (col: string) => /[^a-zA-Z0-9_]/.test(col);
          const colAliasesP = new Map<string, string>();
          const selectPartsP: string[] = ['*'];
          for (const cm of src.columnMappings) {
            if (isExprP(cm.column)) {
              const alias = `_expr_${cm.smAttribute}`;
              selectPartsP.push(`(${cm.column}) AS ${alias}`);
              colAliasesP.set(cm.column, alias);
            }
          }

          let query = `SELECT ${selectPartsP.join(', ')} FROM ${conn.schema}.${conn.table}`;
          const conditions: string[] = [];
          const params: any[] = [];
          // Filter is trusted from schema config, but validate against obvious injection
          if (src.filter) conditions.push(`(${validateFilter(src.filter)})`);

          if (ref.changeDetection === 'timestamp' && ref.timestampColumn) {
            validateIdentifier(ref.timestampColumn, 'timestampColumn');
            const lastTs = lastPollTimestamps.get(ref.sourceRef);
            if (lastTs) {
              params.push(lastTs);
              conditions.push(`${ref.timestampColumn} > $${params.length}`);
            }
          }

          if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;

          // Ensure deterministic ordering for correct timestamp tracking
          if (ref.changeDetection === 'timestamp' && ref.timestampColumn) {
            query += ` ORDER BY ${ref.timestampColumn} ASC`;
          }

          if (ref.batchSize) query += ` LIMIT ${Number(ref.batchSize)}`;

          const result = await pool.query(query, params);
          if (result.rows.length === 0) continue;

          const nodeQueries: string[] = [];
          for (const row of result.rows) {
            const idColKeyP = colAliasesP.get(idCol.column) || idCol.column;
            const id = String(row[idColKeyP] || '');
            if (!id) continue;
            const props: Record<string, any> = {};
            for (const cm of src.columnMappings) {
              const keyP = colAliasesP.get(cm.column) || cm.column;
              const val = row[keyP];
              if (val !== null && val !== undefined) props[cm.smAttribute] = val;
            }
            nodeQueries.push(vertexCypher(profile.kgNodeLabel, id, props));
          }

          await batchCypher(nodeQueries);

          // Track last timestamp
          if (ref.changeDetection === 'timestamp' && ref.timestampColumn) {
            const lastRow = result.rows[result.rows.length - 1];
            const ts = lastRow[ref.timestampColumn];
            if (ts) lastPollTimestamps.set(ref.sourceRef, new Date(ts).toISOString());
          }

        } catch (err) {
          logger.debug({ sourceRef: ref.sourceRef, err: (err as Error).message }, '[SchemaPoll] Poll failed');
        }
      }
    };

    // Initial poll
    pollFn().catch(() => {});

    // Start interval
    const timer = setInterval(pollFn, intervalMs);
    pollingTimers.push(timer);
    jobCount++;

    logger.info({ syncId: sync.syncId, intervalMs, sourceCount: sync.sources.length }, '[SchemaPoll] Polling started');
  }

  return jobCount;
}

// ── Phase 3c: PostgreSQL LISTEN/NOTIFY Sync ─────────────────────

import { Client } from 'pg';

let pgNotifyClients: Client[] = [];
let pgNotifyStopped = false;

export function stopPgNotify(): void {
  pgNotifyStopped = true;
  for (const c of pgNotifyClients) {
    try { c.end(); } catch (e: any) { logger.debug({ err: e.message }, '[SchemaPgNotify] Client close error'); }
  }
  pgNotifyClients = [];
}

export async function startPgNotifySync(
  notifySyncs: SyncSchema[],
  allSources: SourceSchema[],
  profiles: SMProfile[],
): Promise<number> {
  stopPgNotify();
  pgNotifyStopped = false;

  const sourceMap = new Map(allSources.map(s => [s.sourceId, s]));
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  let channelCount = 0;

  for (const sync of notifySyncs) {
    if (sync.syncType !== 'pg-notify' || !sync.sources) continue;

    // Group sources by connection (host:port:database)
    const connGroups = new Map<string, { conn: { host: string; port: number; database: string }; refs: PollSourceRef[] }>();

    for (const ref of sync.sources) {
      const src = sourceMap.get(ref.sourceRef);
      if (!src?.connection) continue;
      const key = `${src.connection.host}:${src.connection.port}:${src.connection.database}`;
      if (!connGroups.has(key)) {
        connGroups.set(key, { conn: src.connection, refs: [] });
      }
      connGroups.get(key)!.refs.push(ref);
    }

    for (const [connKey, group] of connGroups) {
      // Build channel → source lookup (reused across reconnects)
      const channelToSource = new Map<string, { src: SourceSchema; profile: SMProfile }>();
      const channels: string[] = [];
      for (const ref of group.refs) {
        const src = sourceMap.get(ref.sourceRef)!;
        const profile = profileMap.get(src.profileRef);
        if (!profile) continue;

        const channel = `${src.connection!.schema}_${src.connection!.table}_notify`;
        if (!/^[a-zA-Z0-9_]+$/.test(channel)) {
          throw new Error(`Invalid LISTEN channel name: ${channel}`);
        }
        channelToSource.set(channel, { src, profile });
        channels.push(channel);
      }

      const onNotification = async (msg: { channel: string; payload?: string }) => {
        if (!msg.payload) return;
        const entry = channelToSource.get(msg.channel);
        if (!entry) return;

        try {
          const row = JSON.parse(msg.payload);
          const idCol = entry.src.columnMappings?.find(c => c.isId);
          if (!idCol) return;

          const id = String(row[idCol.column] || '');
          if (!id) return;

          const props: Record<string, any> = {};
          for (const cm of entry.src.columnMappings!) {
            const val = row[cm.column];
            if (val !== null && val !== undefined) props[cm.smAttribute] = val;
          }

          const cypher = vertexCypher(entry.profile.kgNodeLabel, id, props);
          await batchCypher([cypher]);
        } catch (e: any) {
          logger.debug({ channel: msg.channel, err: e.message }, '[SchemaPgNotify] Skip unparseable notification');
        }
      };

      let reconnectDelay = 1000;
      const MAX_RECONNECT_DELAY = 30000;

      const connectAndListen = async (): Promise<Client> => {
        const client = new Client({
          host: group.conn.host,
          port: group.conn.port,
          database: group.conn.database,
          user: process.env.PG_USER || 'admin',
          password: process.env.PG_PASSWORD || config.db.password,
          keepAlive: true,
          keepAliveInitialDelayMillis: 30000,
        });

        await client.connect();

        for (const channel of channels) {
          await client.query(`LISTEN ${channel}`);
          logger.info({ channel }, '[SchemaPgNotify] Listening');
        }

        // Reset backoff on successful connect
        reconnectDelay = 1000;

        client.on('notification', onNotification);

        const scheduleReconnect = () => {
          if (pgNotifyStopped) return;
          const delay = reconnectDelay;
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
          logger.info({ connKey, delayMs: delay }, '[SchemaPgNotify] Scheduling reconnect...');
          setTimeout(async () => {
            if (pgNotifyStopped) return;
            try {
              const newClient = await connectAndListen();
              // Replace in the clients array
              const idx = pgNotifyClients.indexOf(client);
              if (idx !== -1) pgNotifyClients[idx] = newClient;
              else pgNotifyClients.push(newClient);
              logger.info({ connKey }, '[SchemaPgNotify] Reconnected successfully');
            } catch (err) {
              logger.warn({ connKey, err: (err as Error).message, nextDelayMs: reconnectDelay }, '[SchemaPgNotify] Reconnect failed');
              scheduleReconnect();
            }
          }, delay);
        };

        client.on('error', (err) => {
          logger.warn({ connKey, err: err.message }, '[SchemaPgNotify] Client error');
        });

        client.on('end', () => {
          logger.warn({ connKey }, '[SchemaPgNotify] Disconnected');
          scheduleReconnect();
        });

        return client;
      };

      try {
        const client = await connectAndListen();
        channelCount += channels.length;
        pgNotifyClients.push(client);
      } catch (err) {
        logger.error({ connKey, err: (err as Error).message }, '[SchemaPgNotify] Failed to connect');
      }
    }
  }

  return channelCount;
}

// ── Full Schema Build Pipeline ──────────────────────────────────

// ── Phase 2c: Instance Nodes from MCP Tools ─────────────────────

export async function buildInstancesFromMcp(
  sources: SourceSchema[],
  profiles: SMProfile[],
  authToken?: string,
): Promise<{ nodesMerged: number; edgesCreated: number }> {
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  const idPropToLabels = new Map<string, string[]>();
  for (const p of profiles) {
    const labels = idPropToLabels.get(p.kgIdProperty) || [];
    if (!labels.includes(p.kgNodeLabel)) labels.push(p.kgNodeLabel);
    idPropToLabels.set(p.kgIdProperty, labels);
  }
  const mcpSources = sources.filter(s => s.sourceType === 'mcp' && s.mcpTool && profileMap.has(s.profileRef));

  if (mcpSources.length === 0) return { nodesMerged: 0, edgesCreated: 0 };

  let totalNodes = 0;
  let totalEdges = 0;
  const allEdges: BulkEdge[] = [];

  for (const src of mcpSources) {
    const profile = profileMap.get(src.profileRef)!;
    const toolName = src.mcpTool!;
    const idProp = src.idProperty || profile.kgIdProperty;

    try {
      const rawData = await sampleMcpTool(toolName, {}, authToken);
      if (rawData.startsWith('ERROR:')) {
        logger.warn({ tool: toolName, err: rawData }, '[SchemaBuild] MCP tool returned error');
        continue;
      }

      let rows: any[];
      try {
        const parsed = JSON.parse(rawData);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        logger.warn({ tool: toolName }, '[SchemaBuild] MCP tool response not valid JSON');
        continue;
      }

      const nodes: BulkNode[] = [];
      const seen = new Set<string>();

      for (const row of rows) {
        const rawId = row[idProp];
        if (rawId === null || rawId === undefined || rawId === '') continue;
        const id: string | number = typeof rawId === 'number' ? rawId : String(rawId);
        const idKey = String(id);
        if (seen.has(idKey)) continue;
        seen.add(idKey);

        const props: Record<string, any> = {};
        if (src.columnMappings) {
          for (const cm of src.columnMappings) {
            const val = row[cm.column];
            if (val !== null && val !== undefined) props[cm.smAttribute] = val;
          }
        } else {
          // No column mappings — use all fields from the row
          for (const [k, v] of Object.entries(row)) {
            if (v !== null && v !== undefined) props[k] = v;
          }
        }

        if (currentRunTimestamp) props._lastSeen = currentRunTimestamp;
        nodes.push({ label: profile.kgNodeLabel, id, idProp: profile.kgIdProperty, props });
        builtLabels.add(profile.kgNodeLabel);

        if (src.edges) {
          for (const edge of src.edges) {
            const fkValue = row[edge.fkColumn];
            if (fkValue === null || fkValue === undefined || fkValue === '') continue;
            const targetIdProp = edge.targetIdProp || 'id';
            const toLabels = idPropToLabels.get(targetIdProp) || [];
            if (toLabels.length === 0) continue;
            const toId: string | number = typeof fkValue === 'number' ? fkValue : String(fkValue);
            allEdges.push({
              fromLabel: profile.kgNodeLabel, fromId: id,
              fromIdProp: profile.kgIdProperty,
              edgeLabel: edge.type,
              toLabels,
              toId,
              toIdProp: targetIdProp,
              props: currentRunTimestamp ? { _lastSeen: currentRunTimestamp } : undefined,
            });
          }
        }
      }

      const nodeResult = await executeBulkNodes(nodes, (done, total) => {
        if (done % 2000 === 0 || done === total) {
          logger.info({ sourceId: src.sourceId, done, total }, '[SchemaBuild] MCP bulk merging nodes...');
        }
      });

      totalNodes += nodeResult.success;
      logger.info({ sourceId: src.sourceId, tool: toolName, nodes: nodeResult.success }, '[SchemaBuild] MCP nodes loaded');
    } catch (err) {
      logger.error({ sourceId: src.sourceId, tool: toolName, err: (err as Error).message }, '[SchemaBuild] MCP source failed');
    }
  }

  // Pass 2: Create edges
  if (allEdges.length > 0) {
    logger.info({ edgeCount: allEdges.length }, '[SchemaBuild] Creating MCP edges (UNWIND)...');
    const edgeResult = await executeBulkEdges(allEdges);
    totalEdges = edgeResult.success;
    logger.info({ success: edgeResult.success, failed: edgeResult.failed }, '[SchemaBuild] MCP edges created');
  }

  return { nodesMerged: totalNodes, edgesCreated: totalEdges };
}

// ── Tombstone Sweep ─────────────────────────────────────────────

async function tombstoneSweep(runTimestamp: string, labels: Set<string>): Promise<number> {
  if (labels.size === 0) return 0;

  let totalDeleted = 0;
  for (const label of labels) {
    try {
      validateLabel(label);
      const result = await cypherQuery(
        `MATCH (n:${label}) WHERE n._lastSeen IS NOT NULL AND n._lastSeen < $ts DETACH DELETE n RETURN count(n) AS deleted`,
        { ts: runTimestamp },
      );
      const deleted = result[0]?.deleted || 0;
      if (deleted > 0) {
        logger.info({ label, deleted }, '[SchemaBuild] Tombstone sweep — removed stale nodes');
        totalDeleted += deleted;
      }
    } catch (err) {
      logger.warn({ label, err: (err as Error).message }, '[SchemaBuild] Tombstone sweep failed for label');
    }
  }

  return totalDeleted;
}

// ── Main Build Orchestrator ─────────────────────────────────────

export async function buildFromSchemas(
  profiles: SMProfile[],
  sources: SourceSchema[],
  syncs: SyncSchema[],
): Promise<SchemaBuildReport> {
  const start = Date.now();
  const errors: string[] = [];

  // Set run timestamp for _lastSeen tracking
  currentRunTimestamp = new Date().toISOString();
  builtLabels.clear();

  const opcuaSources = sources.filter(s => s.sourceType === 'opcua');
  const pgSources = sources.filter(s => s.sourceType === 'postgresql');
  const mcpSources = sources.filter(s => s.sourceType === 'mcp');
  const mqttSyncs = syncs.filter(s => s.syncType === 'mqtt');
  const pollSyncs = syncs.filter(s => s.syncType === 'polling');
  const kafkaSyncs = syncs.filter(s => s.syncType === 'kafka');
  const webhookSyncs = syncs.filter(s => s.syncType === 'rest-webhook');
  const manualSyncs = syncs.filter(s => s.syncType === 'manual');

  logger.info({
    profiles: profiles.length,
    opcua: opcuaSources.length,
    postgresql: pgSources.length,
    mcp: mcpSources.length,
    mqtt: mqttSyncs.length,
    polling: pollSyncs.length,
    kafka: kafkaSyncs.length,
    webhook: webhookSyncs.length,
    manual: manualSyncs.length,
  }, '[SchemaBuild] Starting schema-driven KG build...');

  // Phase 1: Type System
  let constraintsCreated = 0;
  try {
    constraintsCreated = await buildTypeSystem(profiles);
  } catch (err) {
    errors.push(`Phase 1 (Type System): ${(err as Error).message}`);
  }

  // Phase 2a: OPC-UA Instance Nodes
  let nodesMerged = 0;
  let edgesCreated = 0;
  try {
    const result = await buildInstances(opcuaSources, profiles);
    nodesMerged += result.nodesMerged;
    edgesCreated += result.edgesCreated;
  } catch (err) {
    errors.push(`Phase 2a (OPC-UA Instances): ${(err as Error).message}`);
  }

  // Phase 2b: PostgreSQL Instance Nodes
  try {
    const result = await buildInstancesFromPostgres(pgSources, profiles);
    nodesMerged += result.nodesMerged;
    edgesCreated += result.edgesCreated;
  } catch (err) {
    errors.push(`Phase 2b (PG Instances): ${(err as Error).message}`);
  }

  // Phase 2c: MCP Instance Nodes
  try {
    const result = await buildInstancesFromMcp(mcpSources, profiles, config.mcpAuthToken || undefined);
    nodesMerged += result.nodesMerged;
    edgesCreated += result.edgesCreated;
  } catch (err) {
    errors.push(`Phase 2c (MCP Instances): ${(err as Error).message}`);
  }

  // Phase 2d: Apply parent labels (e.g. InjectionMoldingMachine → also :Machine)
  try {
    await applyParentLabels(profiles);
  } catch (err) {
    errors.push(`Phase 2d (Parent Labels): ${(err as Error).message}`);
  }

  // Phase 3a: Live MQTT Subscriptions
  let mqttSubscriptions = 0;
  try {
    mqttSubscriptions = await startLiveUpdates(mqttSyncs, opcuaSources, profiles);
  } catch (err) {
    errors.push(`Phase 3a (MQTT): ${(err as Error).message}`);
  }

  // Phase 3b: Polling Sync
  let pollingJobs = 0;
  try {
    pollingJobs = await startPollingSync(pollSyncs, sources, profiles);
  } catch (err) {
    errors.push(`Phase 3b (Polling): ${(err as Error).message}`);
  }

  // Phase 3c: PG LISTEN/NOTIFY Sync
  const pgNotifySyncs = syncs.filter(s => s.syncType === 'pg-notify');
  let pgNotifyChannels = 0;
  try {
    pgNotifyChannels = await startPgNotifySync(pgNotifySyncs, sources, profiles);
  } catch (err) {
    errors.push(`Phase 3c (PG Notify): ${(err as Error).message}`);
  }

  // Phase 3d: Kafka Sync (recognized, handler not yet implemented)
  if (kafkaSyncs.length > 0) {
    logger.info({ count: kafkaSyncs.length }, '[SchemaBuild] Kafka syncs registered (consumer not yet implemented — schema validated)');
    for (const ks of kafkaSyncs) {
      const topicCount = ks.kafka?.topics?.length || 0;
      logger.info({ syncId: ks.syncId, topics: topicCount, bootstrapServers: ks.kafka?.bootstrapServers }, '[SchemaBuild] Kafka sync config loaded');
    }
  }

  // Phase 3e: REST-Webhook Sync (recognized, handler not yet implemented)
  if (webhookSyncs.length > 0) {
    logger.info({ count: webhookSyncs.length }, '[SchemaBuild] REST-Webhook syncs registered (endpoint not yet implemented — schema validated)');
    for (const ws of webhookSyncs) {
      logger.info({ syncId: ws.syncId, path: ws.webhook?.webhookPath, profileRef: ws.webhook?.profileRef }, '[SchemaBuild] Webhook sync config loaded');
    }
  }

  // Phase 3f: Manual Import Sync (recognized, handler not yet implemented)
  if (manualSyncs.length > 0) {
    logger.info({ count: manualSyncs.length }, '[SchemaBuild] Manual import syncs registered (trigger not yet implemented — schema validated)');
    for (const ms of manualSyncs) {
      logger.info({ syncId: ms.syncId, trigger: ms.manual?.trigger, format: ms.manual?.format }, '[SchemaBuild] Manual sync config loaded');
    }
  }

  // Phase 4: Tombstone sweep — remove nodes not touched in this run
  try {
    const swept = await tombstoneSweep(currentRunTimestamp, builtLabels);
    if (swept > 0) {
      logger.info({ swept, labels: [...builtLabels] }, '[SchemaBuild] Tombstone sweep complete');
    }
  } catch (err) {
    errors.push(`Phase 4 (Tombstone): ${(err as Error).message}`);
  }

  // Phase 5: Generate embeddings for all nodes
  try {
    const labels = profiles.map(p => p.kgNodeLabel);
    let totalEmbedded = 0;

    for (const label of labels) {
      try { validateLabel(label); } catch { continue; }

      // Get nodes without embeddings
      const nodes = await cypherQuery(
        `MATCH (n:${label}) WHERE n.embedding IS NULL RETURN n.id AS id, properties(n) AS props LIMIT 500`
      );
      if (nodes.length === 0) continue;

      const texts = nodes.map((n: any) => nodeToText(n.id, label, n.props || {}));
      const embedResults = await generateEmbeddings(texts, 50);

      const session = getDriver().session({ database: config.neo4j.database });
      try {
        for (let i = 0; i < embedResults.length; i++) {
          await session.run(
            `MATCH (n:${label} {id: $id}) SET n.embedding = $embedding`,
            { id: nodes[i].id, embedding: embedResults[i].embedding }
          );
        }
        totalEmbedded += embedResults.length;
      } finally {
        await session.close();
      }

      logger.info({ label, count: embedResults.length }, '[SchemaBuild] Embeddings generated');
    }

    logger.info({ totalEmbedded }, '[SchemaBuild] Embedding phase complete');
  } catch (err) {
    errors.push(`Phase 5 (Embeddings): ${(err as Error).message}`);
  }

  // Phase 6: Create Sensor nodes from MQTT topic discovery
  // Each Machine node with live MQTT data gets Sensor child nodes
  try {
    const sensorResult = await cypherQuery(`
      MATCH (m) WHERE m.embedding IS NOT NULL AND any(l IN labels(m) WHERE l ENDS WITH 'Machine' OR l = 'InjectionMoldingMachine' OR l = 'AssemblyLine' OR l = 'FFS_Cell')
      WITH m, [k IN keys(m) WHERE k ENDS WITH '_ts'] AS tsKeys
      UNWIND tsKeys AS tsKey
      WITH m, replace(tsKey, '_ts', '') AS varName
      WHERE m[varName] IS NOT NULL
      MERGE (s:Sensor {id: m.id + '/' + varName})
      SET s.name = varName, s.machine = m.id, s.last_value = m[varName], s.last_seen = m[tsKey]
      MERGE (m)-[:HAS_SENSOR]->(s)
      RETURN count(s) AS sensors
    `);
    const sensorCount = sensorResult[0]?.sensors || 0;
    if (sensorCount > 0) {
      logger.info({ sensorCount }, '[SchemaBuild] Sensor nodes created from MQTT data');
      nodesMerged += sensorCount;
    }
  } catch (err) {
    // Non-fatal — sensors are optional
    logger.warn({ err: (err as Error).message }, '[SchemaBuild] Sensor node creation skipped');
  }

  const report: SchemaBuildReport = {
    profiles: profiles.length,
    sources: { opcua: opcuaSources.length, postgresql: pgSources.length, rest: 0, mcp: mcpSources.length },
    syncs: { mqtt: mqttSubscriptions, polling: pollingJobs, kafka: kafkaSyncs.length, webhook: webhookSyncs.length, manual: manualSyncs.length },
    constraintsCreated,
    nodesMerged,
    edgesCreated,
    mqttSubscriptions,
    pollingJobs,
    errors,
    duration: Date.now() - start,
  };

  logger.info(report, '[SchemaBuild] Build complete');
  return report;
}

// ── Utility: Simple JSONPath extraction ─────────────────────────

function extractJsonPath(obj: any, path: string): any {
  // Supports simple paths like "$.Value", "$.data.value"
  const parts = path.replace(/^\$\.?/, '').split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}
