import mqtt, { MqttClient } from 'mqtt';
import { SMProfile, OpcUaMapping, UnsMapping, SchemaBuildReport } from '../shared/schema-types';
import { vertexCypher, edgeCypher, batchCypher, executeBatched } from '../shared/cypher-utils';
import { logger } from '../shared/logger';
import { config } from '../shared/config';
import neo4j from 'neo4j-driver';

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
    const props: Record<string, any> = {
      [idProp]: m.machineId,
      name: m.machineName,
      opcua_endpoint: m.endpoint,
      ...m.staticProperties,
    };

    queries.push(vertexCypher(label, m.machineId, props));

    // ISA-95 hierarchy: Site → Area → Line → Machine
    const loc = m.location;
    if (loc.site) {
      hierarchyQueries.push(vertexCypher('Site', loc.site, { name: loc.site, enterprise: loc.enterprise || '' }));
    }
    if (loc.area) {
      hierarchyQueries.push(vertexCypher('Area', loc.area, { name: loc.area }));
      if (loc.site) {
        hierarchyQueries.push(edgeCypher('Area', loc.area, 'PART_OF', 'Site', loc.site));
      }
    }
    if (loc.line) {
      hierarchyQueries.push(vertexCypher('ProductionLine', loc.line, { name: loc.line }));
      if (loc.area) {
        hierarchyQueries.push(edgeCypher('ProductionLine', loc.line, 'PART_OF', 'Area', loc.area));
      }
      // Machine → Line
      hierarchyQueries.push(edgeCypher(label, m.machineId, 'PART_OF', 'ProductionLine', loc.line));
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
    if (p) {
      machineToProfile.set(m.machineId, { label: p.kgNodeLabel, idProp: p.kgIdProperty });
      // Also map by machineName (UNS topics use display names)
      machineToProfile.set(m.machineName, { label: p.kgNodeLabel, idProp: p.kgIdProperty });
    }
  }

  // Also build machineId lookup from machineName
  const nameToId = new Map<string, string>();
  for (const m of opcuaMappings) {
    nameToId.set(m.machineName, m.machineId);
  }

  let subscriptionCount = 0;

  for (const uns of unsMappings) {
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
        clientId: `kg-schema-${uns.mappingId}-${Date.now()}`,
      });

      client.on('connect', () => {
        client.subscribe(uns.topicStructure.subscribeFilter, { qos: 0 }, (err) => {
          if (err) {
            logger.error({ filter: uns.topicStructure.subscribeFilter, err: err.message }, '[SchemaLive] Subscribe failed');
          } else {
            logger.info({ filter: uns.topicStructure.subscribeFilter, broker: brokerUrl }, '[SchemaLive] Subscribed');
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
          const value = extractJsonPath(data, uns.payloadSchema.valuePath);
          if (value === undefined || value === null) return;

          const timestamp = extractJsonPath(data, uns.payloadSchema.timestampPath);

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
}

// ── Full Schema Build Pipeline ──────────────────────────────────

export async function buildFromSchemas(
  profiles: SMProfile[],
  opcuaMappings: OpcUaMapping[],
  unsMappings: UnsMapping[],
): Promise<SchemaBuildReport> {
  const start = Date.now();
  const errors: string[] = [];

  logger.info({
    profiles: profiles.length,
    machines: opcuaMappings.length,
    unsMappings: unsMappings.length,
  }, '[SchemaBuild] Starting schema-driven KG build...');

  // Phase 1: Type System
  let constraintsCreated = 0;
  try {
    constraintsCreated = await buildTypeSystem(profiles);
  } catch (err) {
    errors.push(`Phase 1 (Type System): ${(err as Error).message}`);
  }

  // Phase 2: Instance Nodes
  let nodesMerged = 0;
  let edgesCreated = 0;
  try {
    const result = await buildInstances(opcuaMappings, profiles);
    nodesMerged = result.nodesMerged;
    edgesCreated = result.edgesCreated;
  } catch (err) {
    errors.push(`Phase 2 (Instances): ${(err as Error).message}`);
  }

  // Phase 3: Live MQTT Subscriptions
  let mqttSubscriptions = 0;
  try {
    mqttSubscriptions = await startLiveUpdates(unsMappings, opcuaMappings, profiles);
  } catch (err) {
    errors.push(`Phase 3 (MQTT): ${(err as Error).message}`);
  }

  const report: SchemaBuildReport = {
    profiles: profiles.length,
    machines: opcuaMappings.length,
    unsMappings: unsMappings.length,
    constraintsCreated,
    nodesMerged,
    edgesCreated,
    mqttSubscriptions,
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
