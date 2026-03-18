import mqtt, { MqttClient } from 'mqtt';
import { Pool } from 'pg';
import { SMProfile, SourceSchema, SyncSchema, SchemaBuildReport, PollSourceRef } from '../shared/schema-types';
import { vertexCypher, edgeCypher, batchCypher, executeBatched, escapeValue, escapeId } from '../shared/cypher-utils';
import { logger } from '../shared/logger';
import { config } from '../shared/config';
import neo4j from 'neo4j-driver';

// Backward-compat aliases
type OpcUaMapping = SourceSchema;
type UnsMapping = SyncSchema;

// ── Phase 1: Type System (from SM Profiles) ─────────────────────

export async function buildTypeSystem(profiles: SMProfile[]): Promise<number> {
  const driver = neo4j.driver(config.neo4j.url, neo4j.auth.basic(config.neo4j.user, config.neo4j.password));
  const session = driver.session({ database: config.neo4j.database });
  let constraintsCreated = 0;

  try {
    for (const profile of profiles) {
      const label = profile.kgNodeLabel;
      const idProp = profile.kgIdProperty;

      try {
        await session.run(
          `CREATE CONSTRAINT ${label.toLowerCase()}_id_unique IF NOT EXISTS FOR (n:${label}) REQUIRE n.${idProp} IS UNIQUE`
        );
        constraintsCreated++;
        logger.info({ label, idProp }, `[SchemaBuild] Constraint created: ${label}.${idProp}`);
      } catch (err) {
        // Constraint may already exist — that's fine
        logger.debug({ label, err: (err as Error).message }, '[SchemaBuild] Constraint skipped');
      }
    }
  } finally {
    await session.close();
    await driver.close();
  }

  return constraintsCreated;
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

          // Build SET query
          const safeAttr = smAttribute.replace(/[^a-zA-Z0-9_]/g, '_');
          const valStr = typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : value;
          let setClause = `n.${safeAttr} = ${valStr}`;
          if (timestamp) {
            setClause += `, n.${safeAttr}_ts = '${timestamp}'`;
          }

          const cypher = `MATCH (n:${machineInfo.label} {${machineInfo.idProp}: '${machineId}'}) SET ${setClause}`;
          updateBuffer.push(cypher);

          // Flush every 2 seconds
          if (!flushTimer) {
            flushTimer = setTimeout(async () => {
              flushTimer = null;
              await flushBuffer();
            }, 2000);
          }
        } catch {
          // Silently skip unparseable messages
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
    try { client.end(true); } catch { /* ignore */ }
  }
  mqttClients = [];
  stopPolling();
  stopPgNotify();
}

// ── Phase 2b: Instance Nodes from PostgreSQL Sources ────────────

export async function buildInstancesFromPostgres(
  sources: SourceSchema[],
  profiles: SMProfile[],
): Promise<{ nodesMerged: number; edgesCreated: number }> {
  const profileMap = new Map(profiles.map(p => [p.profileId, p]));
  let totalNodes = 0;
  let totalEdges = 0;

  // Two-pass approach: first all nodes, then all edges.
  // This ensures target nodes exist before edges reference them.
  const allEdgeQueries: string[] = [];

  // ── Pass 1: Create all nodes ──────────────────────────────────
  for (const src of sources) {
    if (src.sourceType !== 'postgresql' || !src.connection || !src.columnMappings) continue;

    const profile = profileMap.get(src.profileRef);
    if (!profile) {
      logger.warn({ sourceId: src.sourceId, profileRef: src.profileRef }, '[SchemaBuild] Profile not found, skipping');
      continue;
    }

    const conn = src.connection;
    const pool = new Pool({
      host: conn.host, port: conn.port, database: conn.database,
      user: process.env.PG_USER || 'admin',
      password: process.env.PG_PASSWORD || process.env.ERP_DB_PASSWORD || '',
      max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    });

    try {
      const idCol = src.columnMappings.find(c => c.isId);
      if (!idCol) {
        logger.warn({ sourceId: src.sourceId }, '[SchemaBuild] No isId column defined, skipping');
        continue;
      }

      let query = `SELECT * FROM ${conn.schema}.${conn.table}`;
      if (src.filter) query += ` WHERE ${src.filter}`;

      const result = await pool.query(query);
      const nodeQueries: string[] = [];

      for (const row of result.rows) {
        const id = String(row[idCol.column] || '');
        if (!id) continue;

        const props: Record<string, any> = {};
        for (const cm of src.columnMappings) {
          const val = row[cm.column];
          if (val !== null && val !== undefined) {
            props[cm.smAttribute] = val;
          }
        }

        nodeQueries.push(vertexCypher(profile.kgNodeLabel, id, props));

        // Collect edges for pass 2
        if (src.edges) {
          for (const edge of src.edges) {
            const fkValue = row[edge.fkColumn];
            if (!fkValue) continue;
            const targetLabel = edge.targetLabel === 'auto' ? 'Node' : edge.targetLabel;
            allEdgeQueries.push(
              edgeCypher(profile.kgNodeLabel, id, edge.type, targetLabel, String(fkValue))
            );
          }
        }
      }

      const nodeResult = await executeBatched(nodeQueries);
      totalNodes += nodeResult.success;

      logger.info({
        sourceId: src.sourceId, table: conn.table, nodes: nodeResult.success,
      }, '[SchemaBuild] PostgreSQL nodes loaded');

    } catch (err) {
      logger.error({ sourceId: src.sourceId, err: (err as Error).message }, '[SchemaBuild] PostgreSQL source failed');
    } finally {
      await pool.end();
    }
  }

  // ── Pass 2: Create all edges (all target nodes now exist) ─────
  if (allEdgeQueries.length > 0) {
    logger.info({ edgeCount: allEdgeQueries.length }, '[SchemaBuild] Creating edges (pass 2)...');
    const edgeResult = await executeBatched(allEdgeQueries);
    totalEdges = edgeResult.success;
    logger.info({ success: edgeResult.success, failed: edgeResult.failed }, '[SchemaBuild] Edges created');
  }

  return { nodesMerged: totalNodes, edgesCreated: totalEdges };
}

// ── Phase 3b: Polling Sync ──────────────────────────────────────

let pollingTimers: NodeJS.Timeout[] = [];
const lastPollTimestamps = new Map<string, string>();

export function stopPolling(): void {
  for (const t of pollingTimers) clearInterval(t);
  pollingTimers = [];
  lastPollTimestamps.clear();
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

    const pollFn = async () => {
      for (const ref of sync.sources!) {
        const src = sourceMap.get(ref.sourceRef);
        if (!src || src.sourceType !== 'postgresql' || !src.connection || !src.columnMappings) continue;

        const profile = profileMap.get(src.profileRef);
        if (!profile) continue;

        const conn = src.connection;
        const pool = new Pool({
          host: conn.host, port: conn.port, database: conn.database,
          user: process.env.PG_USER || 'admin',
          password: process.env.PG_PASSWORD || process.env.ERP_DB_PASSWORD || '',
          max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000,
        });

        try {
          const idCol = src.columnMappings.find(c => c.isId);
          if (!idCol) continue;

          let query = `SELECT * FROM ${conn.schema}.${conn.table}`;
          const conditions: string[] = [];
          if (src.filter) conditions.push(`(${src.filter})`);

          if (ref.changeDetection === 'timestamp' && ref.timestampColumn) {
            const lastTs = lastPollTimestamps.get(ref.sourceRef);
            if (lastTs) {
              conditions.push(`${ref.timestampColumn} > '${lastTs}'`);
            }
          }

          if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
          if (ref.batchSize) query += ` LIMIT ${ref.batchSize}`;

          const result = await pool.query(query);
          if (result.rows.length === 0) { await pool.end(); continue; }

          const nodeQueries: string[] = [];
          for (const row of result.rows) {
            const id = String(row[idCol.column] || '');
            if (!id) continue;
            const props: Record<string, any> = {};
            for (const cm of src.columnMappings) {
              const val = row[cm.column];
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
        } finally {
          await pool.end();
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

export function stopPgNotify(): void {
  for (const c of pgNotifyClients) {
    try { c.end(); } catch { /* ignore */ }
  }
  pgNotifyClients = [];
}

export async function startPgNotifySync(
  notifySyncs: SyncSchema[],
  allSources: SourceSchema[],
  profiles: SMProfile[],
): Promise<number> {
  stopPgNotify();

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
      const client = new Client({
        host: group.conn.host,
        port: group.conn.port,
        database: group.conn.database,
        user: process.env.PG_USER || 'admin',
        password: process.env.PG_PASSWORD || process.env.ERP_DB_PASSWORD || '',
        keepAlive: true,
        keepAliveInitialDelayMillis: 30000,
      });

      try {
        await client.connect();

        // Build channel → source lookup
        const channelToSource = new Map<string, { src: SourceSchema; profile: SMProfile }>();
        for (const ref of group.refs) {
          const src = sourceMap.get(ref.sourceRef)!;
          const profile = profileMap.get(src.profileRef);
          if (!profile) continue;

          // Channel name convention: schema_table_notify (e.g. llm_test_v3_machineid_nodeid_notify)
          const channel = `${src.connection!.schema}_${src.connection!.table}_notify`;
          channelToSource.set(channel, { src, profile });

          await client.query(`LISTEN ${channel}`);
          channelCount++;
          logger.info({ channel, sourceRef: ref.sourceRef }, '[SchemaPgNotify] Listening');
        }

        client.on('notification', async (msg) => {
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
          } catch {
            // Skip unparseable notifications
          }
        });

        client.on('error', (err) => {
          logger.warn({ connKey, err: err.message }, '[SchemaPgNotify] Client error');
        });

        client.on('end', () => {
          logger.warn({ connKey }, '[SchemaPgNotify] Disconnected');
        });

        pgNotifyClients.push(client);
      } catch (err) {
        logger.error({ connKey, err: (err as Error).message }, '[SchemaPgNotify] Failed to connect');
      }
    }
  }

  return channelCount;
}

// ── Full Schema Build Pipeline ──────────────────────────────────

export async function buildFromSchemas(
  profiles: SMProfile[],
  sources: SourceSchema[],
  syncs: SyncSchema[],
): Promise<SchemaBuildReport> {
  const start = Date.now();
  const errors: string[] = [];

  const opcuaSources = sources.filter(s => s.sourceType === 'opcua');
  const pgSources = sources.filter(s => s.sourceType === 'postgresql');
  const mqttSyncs = syncs.filter(s => s.syncType === 'mqtt');
  const pollSyncs = syncs.filter(s => s.syncType === 'polling');

  logger.info({
    profiles: profiles.length,
    opcua: opcuaSources.length,
    postgresql: pgSources.length,
    mqtt: mqttSyncs.length,
    polling: pollSyncs.length,
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

  const report: SchemaBuildReport = {
    profiles: profiles.length,
    sources: { opcua: opcuaSources.length, postgresql: pgSources.length, rest: 0 },
    syncs: { mqtt: mqttSubscriptions, polling: pollingJobs },
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
