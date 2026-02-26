import { NodeExecutor } from './types';
import { pool } from '../../db/pool';
import { getLlmConfig } from '../../chat/llm-client';
import { buildGraph } from '../graph-builder';
import { logger } from '../../logger';
import { NodeInput, NodeResult, UpstreamInfo } from './types';

// Import executor registry lazily to avoid circular dependency
let EXECUTORS: Record<string, (input: NodeInput) => Promise<NodeResult>> | null = null;

function getExecutors() {
  if (!EXECUTORS) {
    // Dynamic import to break circular dependency
    const engine = require('../engine');
    EXECUTORS = engine._EXECUTORS;
  }
  return EXECUTORS;
}

/**
 * Execute an osf-sub-flow node.
 * Calls another user flow by ID and returns its output.
 */
export const executeOsfSubFlow: NodeExecutor = async (input) => {
  const subFlowId = input.config.flowId;
  if (!subFlowId) {
    throw new Error('osf-sub-flow: no flow ID configured');
  }

  const maxDepth = parseInt(input.config.maxDepth, 10) || 3;
  const currentDepth = parseInt(input.config._depth as string, 10) || 0;

  if (currentDepth >= maxDepth) {
    throw new Error(`osf-sub-flow: max recursion depth (${maxDepth}) exceeded`);
  }

  // Load the sub-flow
  const flowResult = await pool.query(
    'SELECT uf.*, nf.flow_json FROM user_flows uf JOIN nodered_flows nf ON nf.user_id = uf.user_id WHERE uf.id = $1 AND uf.user_id = $2',
    [subFlowId, input.userId]
  );

  if (flowResult.rows.length === 0) {
    throw new Error(`osf-sub-flow: flow ${subFlowId} not found`);
  }

  const flow = flowResult.rows[0];
  const tabNodes = (flow.flow_json || []).filter((n: any) => n.z === flow.flow_tab_id || n.id === flow.flow_tab_id);
  const graph = buildGraph(tabNodes);

  if (graph.entryNodes.length === 0) {
    throw new Error('osf-sub-flow: target flow has no entry nodes');
  }

  logger.info({ nodeId: input.config.id, subFlowId, depth: currentDepth }, 'osf-sub-flow executing');

  // Mini-engine: execute the sub-flow synchronously
  const nodeOutputs = new Map<string, string[]>();
  const queue: string[] = [...graph.entryNodes];
  const executed = new Set<string>();

  // We don't have engine executors here to avoid circular deps,
  // so we pass through and let the parent engine handle sub-flows
  // For now, pass input as first node's input
  const subInput = input.previousOutput;

  // Simple BFS execution (subset of engine logic)
  // Note: this is a simplified version — complex sub-flows may need the full engine
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (executed.has(nodeId)) continue;

    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    // Check all upstreams ready
    let ready = true;
    for (const [_id, otherNode] of graph.nodes) {
      for (const portWires of otherNode.wires) {
        if (portWires.includes(nodeId) && !nodeOutputs.has(otherNode.id)) {
          ready = false;
          break;
        }
      }
      if (!ready) break;
    }
    if (!ready) { queue.push(nodeId); continue; }

    executed.add(nodeId);

    // Collect upstream inputs
    const allInputs: UpstreamInfo[] = [];
    for (const [_id, otherNode] of graph.nodes) {
      for (let portIdx = 0; portIdx < otherNode.wires.length; portIdx++) {
        if (otherNode.wires[portIdx].includes(nodeId) && nodeOutputs.has(otherNode.id)) {
          const outputs = nodeOutputs.get(otherNode.id)!;
          allInputs.push({
            nodeId: otherNode.id,
            nodeType: otherNode.type,
            nodeLabel: otherNode.name || otherNode.type,
            output: outputs[portIdx] ?? outputs[0] ?? '',
          });
        }
      }
    }

    const previousOutput = allInputs.length > 0 ? allInputs[0].output : subInput;
    const executors = getExecutors();

    const executor = executors?.[node.type];
    if (!executor) {
      nodeOutputs.set(nodeId, [previousOutput]);
      continue;
    }

    const result = await executor({
      previousOutput,
      allInputs: allInputs.length > 0 ? allInputs : undefined,
      config: { ...node.config, id: nodeId, _depth: String(currentDepth + 1) },
      userId: input.userId,
      llmConfig: input.llmConfig,
      runId: input.runId,
    });

    if (result.multiOutput && result.multiOutput.length > 0) {
      nodeOutputs.set(nodeId, result.multiOutput);
    } else {
      nodeOutputs.set(nodeId, [result.output]);
    }

    // Queue downstream
    const portIndex = result.outputPort ?? 0;
    if (result.multiOutput && result.multiOutput.length > 0) {
      for (let pi = 0; pi < result.multiOutput.length; pi++) {
        for (const targetId of (node.wires[pi] || [])) {
          if (!executed.has(targetId)) queue.push(targetId);
        }
      }
    } else {
      for (const targetId of (node.wires[portIndex] || [])) {
        if (!executed.has(targetId)) queue.push(targetId);
      }
    }
  }

  // Return last output
  const allOutputArrays = Array.from(nodeOutputs.values());
  const lastArr = allOutputArrays[allOutputArrays.length - 1];
  return { output: lastArr ? lastArr[0] : '' };
};
