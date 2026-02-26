export interface FlowNode {
  id: string;
  type: string;
  name?: string;
  wires: string[][];    // wires[portIndex] = [targetNodeId, ...]
  config: Record<string, any>;
}

export interface FlowGraph {
  nodes: Map<string, FlowNode>;
  entryNodes: string[];
}

/**
 * Parse Node-RED flow JSON into a DAG.
 * Accepts ALL node types except infrastructure types (tab, comment, group, etc.).
 * This allows native Node-RED nodes (switch, change, template, debug, etc.)
 * to be included alongside custom OSF nodes.
 */
export function buildGraph(flowJson: any[]): FlowGraph {
  const SKIP_TYPES = new Set([
    'tab', 'comment', 'subflow', 'subflow:*', 'group',
    'inject', 'catch', 'status', 'link in', 'link out', 'link call',
    'unknown',
  ]);

  const nodes = new Map<string, FlowNode>();
  const hasIncoming = new Set<string>();

  // First pass: collect all non-infrastructure nodes
  for (const raw of flowJson) {
    if (!raw.id || !raw.type) continue;
    if (SKIP_TYPES.has(raw.type)) continue;
    if (raw.type.startsWith('subflow:')) continue;

    const wires: string[][] = (raw.wires || []).map((portWires: any) =>
      Array.isArray(portWires) ? portWires : []
    );

    const { id, type, name, wires: _, ...rest } = raw;
    nodes.set(id, { id, type, name, wires, config: rest });
  }

  // Second pass: find nodes with incoming connections
  for (const [_id, node] of nodes) {
    for (const portWires of node.wires) {
      for (const targetId of portWires) {
        if (nodes.has(targetId)) {
          hasIncoming.add(targetId);
        }
      }
    }
  }

  // Entry nodes: no incoming connections
  const entryNodes = Array.from(nodes.keys()).filter(id => !hasIncoming.has(id));

  // DAG validation: detect cycles via topological sort
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function dfs(nodeId: string): void {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new Error(`Cycle detected at node ${nodeId}`);

    visiting.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) {
      for (const portWires of node.wires) {
        for (const targetId of portWires) {
          if (nodes.has(targetId)) dfs(targetId);
        }
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const entryId of entryNodes) {
    dfs(entryId);
  }

  // Check all nodes are reachable
  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId); // Visit unreachable components (isolated nodes)
    }
  }

  return { nodes, entryNodes };
}
