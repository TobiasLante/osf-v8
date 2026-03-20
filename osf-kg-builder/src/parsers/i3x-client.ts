import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { NodeTypeSpec, EdgeTypeSpec, SchemaProposal } from '../shared/types';
import { vertexCypher, edgeCypher, executeBatched, escapeId, validateLabel } from '../shared/cypher-utils';

// ── Types ──────────────────────────────────────────────────────────

export interface I3xObject {
  elementId: string;
  displayName: string;
  typeId: string;
  parentId?: string;
  isComposition?: boolean;
  namespaceUri?: string;
}

export interface I3xObjectType {
  elementId: string;
  displayName: string;
  parentTypeId?: string;
  namespaceUri?: string;
}

export interface I3xRelationshipType {
  elementId: string;
  displayName: string;
  inverseDisplayName?: string;
}

export interface I3xNamespace {
  uri: string;
  displayName: string;
}

// ── Internal Helpers ───────────────────────────────────────────────

let cachedSpec: any = null;

async function i3xFetch(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`i3X HTTP ${res.status}: ${res.statusText}`);
      return res;
    } catch (e: any) {
      lastError = e;
      if (attempt < 2) {
        logger.warn({ url, attempt, err: e.message }, 'i3X request failed, retrying');
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  clearTimeout(timeout);
  throw lastError || new Error(`i3X request failed: ${url}`);
}

// ── API Functions ──────────────────────────────────────────────────

export async function fetchI3xSpec(): Promise<any> {
  if (cachedSpec) return cachedSpec;

  const baseUrl = config.smProfileUrl || process.env.I3X_BASE_URL || '';
  if (!baseUrl) throw new Error('No i3X base URL configured (set I3X_BASE_URL)');

  const res = await i3xFetch(`${baseUrl}/openapi.json`);
  cachedSpec = await res.json();
  logger.info({ paths: Object.keys(cachedSpec.paths || {}).length }, 'Fetched i3X OpenAPI spec');
  return cachedSpec;
}

export async function getNamespaces(baseUrl: string): Promise<I3xNamespace[]> {
  const res = await i3xFetch(`${baseUrl}/namespaces`);
  const data: any = await res.json();
  return Array.isArray(data) ? data : data.items || data.namespaces || [];
}

export async function getObjectTypes(baseUrl: string, namespaceUri?: string): Promise<I3xObjectType[]> {
  const url = namespaceUri
    ? `${baseUrl}/objecttypes?namespaceUri=${encodeURIComponent(namespaceUri)}`
    : `${baseUrl}/objecttypes`;
  const res = await i3xFetch(url);
  const data: any = await res.json();
  return Array.isArray(data) ? data : data.items || data.objectTypes || [];
}

export async function getObjects(baseUrl: string, typeId?: string): Promise<I3xObject[]> {
  const url = typeId
    ? `${baseUrl}/objects?typeId=${encodeURIComponent(typeId)}`
    : `${baseUrl}/objects`;
  const res = await i3xFetch(url);
  const data: any = await res.json();
  return Array.isArray(data) ? data : data.items || data.objects || [];
}

export async function getRelatedObjects(
  baseUrl: string,
  elementIds: string[],
  relationshipTypeId?: string,
): Promise<any> {
  const body: any = { elementIds };
  if (relationshipTypeId) body.relationshipTypeId = relationshipTypeId;

  const res = await i3xFetch(`${baseUrl}/objects/related`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getRelationshipTypes(baseUrl: string): Promise<I3xRelationshipType[]> {
  const res = await i3xFetch(`${baseUrl}/relationshiptypes`);
  const data: any = await res.json();
  return Array.isArray(data) ? data : data.items || data.relationshipTypes || [];
}

export async function getValues(baseUrl: string, elementIds: string[]): Promise<any> {
  const res = await i3xFetch(`${baseUrl}/objects/value`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elementIds }),
  });
  return res.json();
}

// ── i3X → SchemaProposal ──────────────────────────────────────────

export async function i3xToSchemaProposal(baseUrl: string): Promise<SchemaProposal> {
  logger.info({ baseUrl }, 'Building schema proposal from i3X metadata');

  const objectTypes = await getObjectTypes(baseUrl);
  const relationshipTypes = await getRelationshipTypes(baseUrl);

  const nodeTypes: NodeTypeSpec[] = objectTypes.map(ot => ({
    label: sanitizeLabel(ot.displayName),
    idProperty: 'elementId',
    properties: [
      { name: 'elementId', type: 'string', description: 'i3X element ID' },
      { name: 'displayName', type: 'string', description: 'Display name' },
      ...(ot.namespaceUri ? [{ name: 'namespaceUri', type: 'string', description: 'Namespace URI' }] : []),
    ],
    sourceTool: 'i3x',
    sourceMapping: `Objects of type ${ot.displayName} (typeId: ${ot.elementId})`,
  }));

  const edgeTypes: EdgeTypeSpec[] = relationshipTypes.map(rt => ({
    label: sanitizeLabel(rt.displayName).toUpperCase().replace(/\s+/g, '_'),
    fromType: '*',
    toType: '*',
    properties: rt.inverseDisplayName
      ? [{ name: 'inverseDisplayName', type: 'string' }]
      : [],
    sourceTool: 'i3x',
    sourceMapping: `i3X relationship type: ${rt.displayName} (${rt.elementId})`,
  }));

  const toolMappings = [{
    toolName: 'i3x',
    produces: nodeTypes.map(nt => nt.label),
    impliesEdges: edgeTypes.map(et => et.label),
  }];

  logger.info(
    { nodeTypes: nodeTypes.length, edgeTypes: edgeTypes.length },
    'i3X schema proposal built',
  );

  return { nodeTypes, edgeTypes, toolMappings };
}

// ── i3X → Graph Import ────────────────────────────────────────────

export async function importI3xToGraph(
  baseUrl: string,
  onProgress: (msg: string) => void,
): Promise<{ nodes: number; edges: number }> {
  let totalNodes = 0;
  let totalEdges = 0;

  onProgress('Fetching i3X object types...');
  const objectTypes = await getObjectTypes(baseUrl);
  onProgress(`Found ${objectTypes.length} object types`);

  for (const ot of objectTypes) {
    const label = sanitizeLabel(ot.displayName);
    onProgress(`Fetching objects of type ${label}...`);

    const objects = await getObjects(baseUrl, ot.elementId);
    if (objects.length === 0) continue;

    const queries = objects.map(obj =>
      vertexCypher(label, obj.elementId, {
        displayName: obj.displayName,
        typeId: obj.typeId,
        ...(obj.parentId ? { parentId: obj.parentId } : {}),
        ...(obj.namespaceUri ? { namespaceUri: obj.namespaceUri } : {}),
        ...(obj.isComposition !== undefined ? { isComposition: obj.isComposition } : {}),
      }),
    );

    const result = await executeBatched(queries, (done, total) => {
      onProgress(`${label}: ${done}/${total} nodes`);
    });
    totalNodes += result.success;
    onProgress(`${label}: ${result.success} nodes created (${result.failed} failed)`);
  }

  onProgress('Fetching relationship types...');
  const relationshipTypes = await getRelationshipTypes(baseUrl);

  const allObjects = await getObjects(baseUrl);
  const allElementIds = allObjects.map(o => o.elementId);

  if (allElementIds.length > 0) {
    for (const rt of relationshipTypes) {
      const edgeLabel = sanitizeLabel(rt.displayName).toUpperCase().replace(/\s+/g, '_');
      try { validateLabel(edgeLabel); } catch { logger.warn({ edgeLabel }, 'Invalid edge label, skipping'); continue; }
      onProgress(`Fetching ${edgeLabel} relationships...`);

      const edgeQueries: string[] = [];
      for (let i = 0; i < allElementIds.length; i += 100) {
        const batch = allElementIds.slice(i, i + 100);
        try {
          const related = await getRelatedObjects(baseUrl, batch, rt.elementId);
          const items = Array.isArray(related) ? related : related.items || related.relationships || [];
          for (const item of items) {
            const fromId = item.sourceElementId || item.fromElementId || item.elementId;
            const toId = item.targetElementId || item.toElementId || item.relatedElementId;
            if (fromId && toId) {
              const safeFrom = escapeId(fromId);
              const safeTo = escapeId(toId);
              edgeQueries.push(`MATCH (a {id: '${safeFrom}'}) MATCH (b {id: '${safeTo}'}) MERGE (a)-[r:${edgeLabel}]->(b) RETURN r`);
            }
          }
        } catch (e: any) {
          logger.warn({ err: e.message, relationshipType: rt.displayName }, 'Failed to fetch related objects');
        }
      }

      if (edgeQueries.length > 0) {
        const result = await executeBatched(edgeQueries, (done, total) => {
          onProgress(`${edgeLabel}: ${done}/${total} edges`);
        });
        totalEdges += result.success;
        onProgress(`${edgeLabel}: ${result.success} edges created (${result.failed} failed)`);
      }
    }
  }

  onProgress(`Import complete: ${totalNodes} nodes, ${totalEdges} edges`);
  return { nodes: totalNodes, edges: totalEdges };
}

// ── Utilities ──────────────────────────────────────────────────────

function sanitizeLabel(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || 'Unknown';
}
