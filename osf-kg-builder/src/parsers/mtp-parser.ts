import { XMLParser } from 'fast-xml-parser';
import { logger } from '../shared/logger';
import { NodeTypeSpec, EdgeTypeSpec } from '../shared/types';

// ── Types ──────────────────────────────────────────────────────────

export interface MTPModule {
  name: string;
  description?: string;
  services: MTPService[];
  variables: MTPVariable[];
  opcuaEndpoint?: string;
}

export interface MTPService {
  name: string;
  procedures: string[];
  states: string[];
}

export interface MTPVariable {
  name: string;
  dataType: string;
  unit?: string;
  opcuaNodeId?: string;
}

export interface MTPSchema {
  modules: MTPModule[];
}

// ── Parse MTP / AutomationML ───────────────────────────────────────

export function parseMTP(xmlString: string): MTPSchema {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) =>
      ['InternalElement', 'Attribute', 'ExternalInterface', 'RoleRequirements', 'SupportedRoleClass'].includes(name),
  });

  const doc = parser.parse(xmlString);
  const modules: MTPModule[] = [];

  // Navigate to InstanceHierarchy → InternalElement(s)
  const caexFile = doc.CAEXFile || doc;
  const hierarchies = caexFile.InstanceHierarchy;
  const hierarchyList = Array.isArray(hierarchies) ? hierarchies : hierarchies ? [hierarchies] : [];

  for (const hierarchy of hierarchyList) {
    const elements = hierarchy.InternalElement || [];
    for (const el of Array.isArray(elements) ? elements : [elements]) {
      if (!el) continue;
      walkElement(el, modules);
    }
  }

  // Also check SystemUnitClassLib for module definitions
  const sysLibs = caexFile.SystemUnitClassLib;
  const sysLibList = Array.isArray(sysLibs) ? sysLibs : sysLibs ? [sysLibs] : [];
  for (const lib of sysLibList) {
    const classes = lib.SystemUnitClass || lib.InternalElement || [];
    for (const cls of Array.isArray(classes) ? classes : [classes]) {
      if (!cls) continue;
      walkElement(cls, modules);
    }
  }

  logger.info({ modules: modules.length }, 'Parsed MTP file');
  return { modules };
}

function walkElement(el: any, modules: MTPModule[]): void {
  const name = el['@_Name'] || el['@_ID'] || '';
  const roleRef = getRoleRef(el);
  const suc = el['@_RefBaseSystemUnitPath'] || '';

  const isPEA =
    suc.includes('PEA') ||
    suc.includes('ProcessEquipmentAssembly') ||
    roleRef.includes('PEA') ||
    roleRef.includes('ProcessEquipmentAssembly');

  if (isPEA) {
    const mod = extractModule(el, name);
    modules.push(mod);
    return;
  }

  // Recurse into children
  const children = el.InternalElement || [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (!child) continue;
    walkElement(child, modules);
  }
}

function getRoleRef(el: any): string {
  const rr = el.RoleRequirements;
  if (rr) {
    const rrList = Array.isArray(rr) ? rr : [rr];
    for (const r of rrList) {
      const ref = r['@_RefBaseRoleClassPath'] || '';
      if (ref) return ref;
    }
  }
  const src = el.SupportedRoleClass;
  if (src) {
    const srcList = Array.isArray(src) ? src : [src];
    for (const s of srcList) {
      const ref = s['@_RefRoleClassPath'] || '';
      if (ref) return ref;
    }
  }
  return el['@_RefBaseRoleClassPath'] || '';
}

function extractModule(el: any, name: string): MTPModule {
  const description = extractAttributeValue(el, 'Description') || undefined;
  const services: MTPService[] = [];
  const variables: MTPVariable[] = [];
  let opcuaEndpoint: string | undefined;

  const children = el.InternalElement || [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (!child) continue;
    const childName = child['@_Name'] || '';
    const childRole = getRoleRef(child);

    if (
      childRole.toLowerCase().includes('service') ||
      childName.toLowerCase().includes('service')
    ) {
      services.push(extractService(child, childName));
      continue;
    }

    const nested = child.InternalElement || [];
    for (const n of Array.isArray(nested) ? nested : [nested]) {
      if (!n) continue;
      const nRole = getRoleRef(n);
      const nName = n['@_Name'] || '';
      if (nRole.toLowerCase().includes('service') || nName.toLowerCase().includes('service')) {
        services.push(extractService(n, nName));
      }
    }
  }

  const attrs = el.Attribute || [];
  for (const attr of Array.isArray(attrs) ? attrs : [attrs]) {
    if (!attr) continue;
    const v = extractVariable(attr);
    if (v) variables.push(v);
  }

  extractVariablesDeep(el, variables);

  const extInterfaces = el.ExternalInterface || [];
  for (const ei of Array.isArray(extInterfaces) ? extInterfaces : [extInterfaces]) {
    if (!ei) continue;
    const eiRole = ei['@_RefBaseClassPath'] || getRoleRef(ei) || '';
    if (eiRole.toLowerCase().includes('opcua') || eiRole.toLowerCase().includes('opc')) {
      opcuaEndpoint = extractAttributeValue(ei, 'Address') || extractAttributeValue(ei, 'Endpoint') || ei['@_Name'];
    }
  }

  return { name, description, services, variables, opcuaEndpoint };
}

function extractService(el: any, name: string): MTPService {
  const procedures: string[] = [];
  const states: string[] = [];

  const children = el.InternalElement || [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (!child) continue;
    const childName = child['@_Name'] || '';
    const childRole = getRoleRef(child);
    if (childRole.toLowerCase().includes('procedure') || childName.toLowerCase().includes('procedure')) {
      procedures.push(childName);
    }
  }

  const attrs = el.Attribute || [];
  for (const attr of Array.isArray(attrs) ? attrs : [attrs]) {
    if (!attr) continue;
    const attrName = attr['@_Name'] || '';
    if (attrName.toLowerCase().includes('state') || attrName.toLowerCase().includes('commandenable')) {
      const val = attr.Value || attr['@_Value'] || '';
      if (val) states.push(String(val));
    }
  }

  if (states.length === 0) {
    states.push('Idle', 'Starting', 'Running', 'Completing', 'Completed', 'Aborting', 'Aborted', 'Resetting');
  }

  return { name, procedures, states };
}

function extractVariable(attr: any): MTPVariable | null {
  const name = attr['@_Name'] || '';
  if (!name) return null;
  const dataType = attr['@_AttributeDataType'] || attr['@_DataType'] || 'String';
  const unit = attr['@_Unit'] || extractAttributeValue(attr, 'Unit') || undefined;

  const nested = attr.Attribute || [];
  let opcuaNodeId: string | undefined;
  for (const n of Array.isArray(nested) ? nested : [nested]) {
    if (!n) continue;
    const nName = n['@_Name'] || '';
    if (nName.toLowerCase().includes('nodeid') || nName.toLowerCase().includes('opcua')) {
      opcuaNodeId = n.Value || n['@_Value'] || undefined;
    }
  }

  return { name, dataType: simplifyDataType(dataType), unit, opcuaNodeId };
}

function extractVariablesDeep(el: any, variables: MTPVariable[]): void {
  const children = el.InternalElement || [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (!child) continue;
    const attrs = child.Attribute || [];
    for (const attr of Array.isArray(attrs) ? attrs : [attrs]) {
      if (!attr) continue;
      const v = extractVariable(attr);
      if (v && !variables.find(existing => existing.name === v.name)) {
        variables.push(v);
      }
    }
    extractVariablesDeep(child, variables);
  }
}

function extractAttributeValue(el: any, attrName: string): string | null {
  const attrs = el.Attribute || [];
  for (const attr of Array.isArray(attrs) ? attrs : [attrs]) {
    if (!attr) continue;
    if ((attr['@_Name'] || '') === attrName) {
      return attr.Value || attr['@_Value'] || null;
    }
  }
  return null;
}

function simplifyDataType(dt: string): string {
  const lower = dt.toLowerCase();
  if (lower.includes('float') || lower.includes('double') || lower.includes('real')) return 'Float';
  if (lower.includes('int') || lower.includes('long') || lower.includes('short')) return 'Int';
  if (lower.includes('bool')) return 'Boolean';
  if (lower.includes('date') || lower.includes('time')) return 'DateTime';
  return 'String';
}

// ── MTP → Schema Hint ──────────────────────────────────────────────

export function mtpToSchemaHint(schema: MTPSchema): string {
  const lines: string[] = ['MTP Module Reference:'];

  for (const mod of schema.modules) {
    lines.push(`  Module: ${mod.name} (PEA)`);

    if (mod.services.length > 0) {
      const svcParts = mod.services.map(s => {
        const stateStr = s.states.length > 0 ? ` (states: ${s.states.join(', ')})` : '';
        return `${s.name}${stateStr}`;
      });
      lines.push(`    Services: ${svcParts.join(', ')}`);
    }

    if (mod.variables.length > 0) {
      const varParts = mod.variables.map(v => {
        const unitStr = v.unit ? `, ${v.unit}` : '';
        return `${v.name} (${v.dataType}${unitStr})`;
      });
      lines.push(`    Variables: ${varParts.join(', ')}`);
    }

    if (mod.opcuaEndpoint) {
      lines.push(`    OPC-UA: ${mod.opcuaEndpoint}`);
    }
  }

  return lines.join('\n');
}

// ── Fetch MTP from URL ─────────────────────────────────────────────

export async function fetchMTPFromUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  // Block private/metadata IPs
  const host = parsed.hostname;
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|localhost$)/i.test(host)) {
    throw new Error(`Blocked internal URL: ${host}`);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch MTP file: HTTP ${res.status}`);
  return res.text();
}

// ── MTP → Node Types ───────────────────────────────────────────────

export function mtpToNodeTypes(schema: MTPSchema): NodeTypeSpec[] {
  const nodeTypes: NodeTypeSpec[] = [];

  for (const mod of schema.modules) {
    nodeTypes.push({
      label: 'Equipment',
      idProperty: 'name',
      properties: [
        { name: 'name', type: 'string', description: `MTP module name` },
        ...(mod.description ? [{ name: 'description', type: 'string', description: 'Module description' }] : []),
        ...(mod.opcuaEndpoint ? [{ name: 'opcuaEndpoint', type: 'string', description: 'OPC-UA endpoint' }] : []),
        ...mod.variables.map(v => ({
          name: v.name,
          type: v.dataType,
          description: v.unit ? `${v.dataType} (${v.unit})` : v.dataType,
        })),
      ],
      sourceTool: 'mtp',
      sourceMapping: `MTP module ${mod.name}`,
    });

    for (const svc of mod.services) {
      nodeTypes.push({
        label: 'Service',
        idProperty: 'name',
        properties: [
          { name: 'name', type: 'string', description: `Service ID: ${mod.name}_${svc.name}` },
          { name: 'moduleName', type: 'string', description: 'Parent module name' },
          { name: 'states', type: 'string', description: `ISA-88 states: ${svc.states.join(', ')}` },
          ...(svc.procedures.length > 0
            ? [{ name: 'procedures', type: 'string', description: `Procedures: ${svc.procedures.join(', ')}` }]
            : []),
        ],
        sourceTool: 'mtp',
        sourceMapping: `MTP service ${svc.name} on module ${mod.name}`,
      });
    }
  }

  return nodeTypes;
}

// ── MTP → Edge Types ───────────────────────────────────────────────

export function mtpToEdgeTypes(schema: MTPSchema): EdgeTypeSpec[] {
  const edgeTypes: EdgeTypeSpec[] = [];

  for (const mod of schema.modules) {
    if (mod.services.length > 0) {
      edgeTypes.push({
        label: 'PROVIDES',
        fromType: 'Equipment',
        toType: 'Service',
        sourceTool: 'mtp',
        sourceMapping: `Module ${mod.name} provides ${mod.services.length} service(s)`,
      });
    }
  }

  const seen = new Set<string>();
  const deduped: EdgeTypeSpec[] = [];
  for (const et of edgeTypes) {
    const key = `${et.label}:${et.fromType}:${et.toType}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(et);
    }
  }

  return deduped;
}
