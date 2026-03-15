import { XMLParser } from 'fast-xml-parser';
import { logger } from './logger';

export interface SMProfileAttribute {
  name: string;
  dataType: string;
  description?: string;
}

export interface SMProfileType {
  name: string;
  browseName: string;
  parentType?: string;
  attributes: SMProfileAttribute[];
}

export interface SMProfileSchema {
  types: SMProfileType[];
  relationships: Array<{ from: string; to: string; referenceType: string }>;
}

export function parseSMProfile(xmlString: string): SMProfileSchema {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['UAObjectType', 'UAVariable', 'Reference'].includes(name),
  });

  const doc = parser.parse(xmlString);
  const nodeSet = doc.UANodeSet || doc;
  const types: SMProfileType[] = [];
  const relationships: Array<{ from: string; to: string; referenceType: string }> = [];

  // Extract ObjectTypes
  const objectTypes = nodeSet.UAObjectType || [];
  for (const ot of Array.isArray(objectTypes) ? objectTypes : [objectTypes]) {
    if (!ot) continue;
    const browseName = ot['@_BrowseName'] || ot.BrowseName || '';
    const nodeId = ot['@_NodeId'] || '';
    const parentNodeId = ot['@_ParentNodeId'] || '';

    const attrs: SMProfileAttribute[] = [];

    // Extract references to find child variables
    const refs = ot.References?.Reference || [];
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      if (!ref) continue;
      const refType = ref['@_ReferenceType'] || '';
      const targetId = ref['#text'] || ref;
      if (refType === 'HasProperty' || refType === 'HasComponent') {
        relationships.push({ from: browseName, to: String(targetId), referenceType: refType });
      }
      if (refType === 'HasSubtype' && ref['@_IsForward'] === 'false') {
        // Parent type
        types.push({ name: browseName, browseName, parentType: String(targetId), attributes: attrs });
      }
    }

    if (!types.find(t => t.name === browseName)) {
      types.push({ name: browseName, browseName, parentType: parentNodeId || undefined, attributes: attrs });
    }
  }

  // Extract Variables (become attributes on their parent type)
  const variables = nodeSet.UAVariable || [];
  for (const v of Array.isArray(variables) ? variables : [variables]) {
    if (!v) continue;
    const browseName = v['@_BrowseName'] || '';
    const dataType = v['@_DataType'] || 'String';
    const parentNodeId = v['@_ParentNodeId'] || '';
    const description = v.Description?.['#text'] || v.Description || '';

    // Find parent type and add attribute
    const parentType = types.find(t =>
      relationships.some(r => r.from === t.name && r.to === parentNodeId)
    ) || types.find(t => t.browseName === parentNodeId);

    if (parentType) {
      parentType.attributes.push({ name: browseName, dataType, description: String(description) });
    }
  }

  logger.info({ types: types.length, relationships: relationships.length }, 'Parsed SM Profile');
  return { types, relationships };
}

export async function fetchSMProfileFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch SM Profile: HTTP ${res.status}`);
  return res.text();
}

export function smProfileToSchemaHint(profile: SMProfileSchema): string {
  const lines: string[] = ['CESMII SM Profile Reference:'];
  for (const t of profile.types) {
    const attrs = t.attributes.map(a => `${a.name} (${a.dataType})`).join(', ');
    lines.push(`  Type: ${t.name}${t.parentType ? ` extends ${t.parentType}` : ''}`);
    if (attrs) lines.push(`    Attributes: ${attrs}`);
  }
  return lines.join('\n');
}
