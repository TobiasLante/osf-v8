import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  nodes: any[];
}

const TEMPLATES_DIR = path.join(__dirname);

// Cache loaded templates
let templateCache: FlowTemplate[] | null = null;

export function getTemplates(): FlowTemplate[] {
  if (templateCache) return templateCache;

  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
  templateCache = files.map(f => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8');
    return JSON.parse(content) as FlowTemplate;
  });
  return templateCache;
}

export function getTemplate(id: string): FlowTemplate | undefined {
  return getTemplates().find(t => t.id === id);
}

/**
 * Generate a fresh copy of the template nodes with new unique IDs.
 * This allows multiple users to install the same template without ID conflicts.
 */
export function instantiateTemplate(template: FlowTemplate): any[] {
  const idMap = new Map<string, string>();

  // First pass: generate new IDs for all nodes
  for (const node of template.nodes) {
    const newId = uuidv4().replace(/-/g, '').slice(0, 16);
    idMap.set(node.id, newId);
  }

  // Second pass: clone nodes with new IDs and rewired connections
  return template.nodes.map(node => {
    const clone = { ...node };
    clone.id = idMap.get(node.id) || node.id;

    // Remap tab reference
    if (clone.z && idMap.has(clone.z)) {
      clone.z = idMap.get(clone.z);
    }

    // Remap wires
    if (clone.wires && Array.isArray(clone.wires)) {
      clone.wires = clone.wires.map((port: any) => {
        if (Array.isArray(port)) {
          return port.map((targetId: string) => idMap.get(targetId) || targetId);
        }
        return port;
      });
    }

    return clone;
  });
}
