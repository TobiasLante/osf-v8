/**
 * Typed REST client for the i3x Server API (v0).
 * Used by the gateway to fetch structured data without going through MCP.
 */

const I3X_BASE = process.env.MCP_URL || 'http://192.168.178.150:30900';
const I3X_API = `${I3X_BASE}/i3x/v0`;
const TIMEOUT_MS = 15_000;

// ── Types (mirror i3x OpenAPI spec) ──

export interface I3xObjectType {
  elementId: string;
  displayName: string;
  namespaceUri: string;
  schema?: Record<string, any>;
}

export interface I3xObject {
  elementId: string;
  displayName: string;
  typeId: string;
  parentId: string | null;
  isComposition: boolean;
  namespaceUri: string;
  relationships?: Record<string, boolean>;
}

export interface I3xObjectValue {
  elementId: string;
  displayName: string;
  typeId: string;
  properties: Record<string, { value: any; quality: string; timestamp: string }>;
}

// ── Helpers ──

async function i3xFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${I3X_API}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`i3x ${resp.status}: ${await resp.text().catch(() => 'no body')}`);
  }
  return resp.json() as Promise<T>;
}

// ── Public API ──

export function getObjectTypes(namespaceUri?: string): Promise<I3xObjectType[]> {
  const qs = namespaceUri ? `?namespaceUri=${encodeURIComponent(namespaceUri)}` : '';
  return i3xFetch<I3xObjectType[]>(`/objecttypes${qs}`);
}

export function getObjects(typeId?: string, limit = 200): Promise<I3xObject[]> {
  const params = new URLSearchParams();
  if (typeId) params.set('typeId', typeId);
  params.set('limit', String(limit));
  return i3xFetch<I3xObject[]>(`/objects?${params}`);
}

export function getObjectValues(elementIds: string[]): Promise<I3xObjectValue[]> {
  return i3xFetch<I3xObjectValue[]>('/objects/value', {
    method: 'POST',
    body: JSON.stringify({ elementIds }),
  });
}

export function getRelatedObjects(
  elementIds: string[],
  relationshiptype?: string,
): Promise<I3xObject[]> {
  return i3xFetch<I3xObject[]>('/objects/related', {
    method: 'POST',
    body: JSON.stringify({ elementIds, ...(relationshiptype ? { relationshiptype } : {}) }),
  });
}

export function getNamespaces(): Promise<Array<{ uri: string; displayName: string }>> {
  return i3xFetch('/namespaces');
}
