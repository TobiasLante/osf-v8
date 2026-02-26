import { pool } from '../db/pool';
import { getLlmConfig, LlmConfig, isLlmOverloaded } from '../chat/llm-client';
import { buildGraph, FlowGraph, FlowNode } from './graph-builder';
import { NodeInput, NodeResult, UpstreamInfo, outputToMsg, msgToOutput } from './node-executors/types';
import { executeOsfAgent } from './node-executors/osf-agent';
import { executeOsfPrompt } from './node-executors/osf-prompt';
import { executeOsfMcpTool } from './node-executors/osf-mcp-tool';
import { executeOsfDecision } from './node-executors/osf-decision';
import { executeOsfHumanInput } from './node-executors/osf-human-input';
import { executeOsfTs } from './node-executors/osf-ts';
import { executeOsfContext } from './node-executors/osf-context';
import { executeOsfLlm } from './node-executors/osf-llm';
import { executeOsfPromptTpl } from './node-executors/osf-prompt-tpl';
import { executeOsfHttp } from './node-executors/osf-http';
import { executeOsfSubFlow } from './node-executors/osf-sub-flow';
import { executeOsfOutputParser } from './node-executors/osf-output-parser';
// Native Node-RED node executors
import { executeNativeSwitch } from './node-executors/native-switch';
import { executeNativeChange } from './node-executors/native-change';
import { executeNativeTemplate } from './node-executors/native-template';
// native-function removed: `new Function()` without sandbox = RCE. Use osf-ts (isolated-vm) instead.
import { executeNativeHttpRequest } from './node-executors/native-http-request';
import { executeNativeSplit } from './node-executors/native-split';
import { executeNativeJoin } from './node-executors/native-join';
import { executeNativeDebug } from './node-executors/native-debug';
import { executeNativeDelay } from './node-executors/native-delay';
import { logger } from '../logger';
import { runRegistry } from './run-registry';
import { setNodeStatus, clearNodeStatus } from '../nodered/node-status';

const EXECUTORS: Record<string, (input: NodeInput) => Promise<NodeResult>> = {
  // OSF custom nodes
  'osf-agent': executeOsfAgent,
  'osf-prompt': executeOsfPrompt,
  'osf-mcp-erp': executeOsfMcpTool,
  'osf-mcp-fertigung': executeOsfMcpTool,
  'osf-mcp-qms': executeOsfMcpTool,
  'osf-mcp-tms': executeOsfMcpTool,
  'mcp-tool': executeOsfMcpTool,
  'osf-decision': executeOsfDecision,
  'osf-human-input': executeOsfHumanInput,
  'osf-ts': executeOsfTs,
  'osf-context': executeOsfContext,
  'osf-llm': executeOsfLlm,
  'osf-prompt-tpl': executeOsfPromptTpl,
  'osf-http': executeOsfHttp,
  'osf-sub-flow': executeOsfSubFlow,
  'osf-output-parser': executeOsfOutputParser,
  // Native Node-RED nodes
  'switch': executeNativeSwitch,
  'change': executeNativeChange,
  'template': executeNativeTemplate,
  // 'function' executor removed (RCE risk) — use osf-ts node instead
  'http request': executeNativeHttpRequest,
  'split': executeNativeSplit,
  'join': executeNativeJoin,
  'debug': executeNativeDebug,
  'delay': executeNativeDelay,
};

// Export for osf-sub-flow to access
export const _EXECUTORS = EXECUTORS;

/**
 * DB-backed event sink: persists flow events for polling.
 */
interface FlowEventSink {
  emit(event: Record<string, any>): Promise<void>;
}

function createDbEventSink(runId: string): FlowEventSink {
  let seq = 0;
  return {
    async emit(event) {
      await pool.query(
        'INSERT INTO flow_run_events (run_id, seq, event) VALUES ($1, $2, $3)',
        [runId, seq++, JSON.stringify(event)]
      );
    }
  };
}

/**
 * Collect all upstream nodes that wire into the given nodeId.
 * Returns UpstreamInfo[] with each upstream's output (port 0 by default).
 */
function collectUpstreamInputs(
  nodeId: string,
  graph: FlowGraph,
  nodeOutputs: Map<string, string[]>,
  nodeMsgs?: Map<string, any[]>
): UpstreamInfo[] {
  const upstreams: UpstreamInfo[] = [];
  for (const [_id, otherNode] of graph.nodes) {
    for (let portIdx = 0; portIdx < otherNode.wires.length; portIdx++) {
      if (otherNode.wires[portIdx].includes(nodeId) && nodeOutputs.has(otherNode.id)) {
        const outputs = nodeOutputs.get(otherNode.id)!;
        const output = outputs[portIdx] ?? outputs[0] ?? '';
        const msgs = nodeMsgs?.get(otherNode.id);
        const msg = msgs ? (msgs[portIdx] ?? msgs[0]) : undefined;
        upstreams.push({
          nodeId: otherNode.id,
          nodeType: otherNode.type,
          nodeLabel: otherNode.name || otherNode.type,
          output,
          msg,
        });
      }
    }
  }
  return upstreams;
}

/**
 * Check if all *reachable* upstream nodes of a given node have been executed.
 * Only considers upstream nodes that were actually visited (queued) during execution.
 * This handles branching correctly: if a decision node skips a branch,
 * unreachable nodes in that branch won't block downstream merge nodes.
 */
function allUpstreamsReady(
  nodeId: string,
  graph: FlowGraph,
  nodeOutputs: Map<string, string[]>,
  visited: Set<string>
): boolean {
  for (const [_id, otherNode] of graph.nodes) {
    for (const portWires of otherNode.wires) {
      if (portWires.includes(nodeId) && visited.has(otherNode.id) && !nodeOutputs.has(otherNode.id)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Start a flow execution. Returns runId immediately.
 * The flow runs asynchronously in the background, emitting events to the DB.
 */
export async function executeFlow(
  flowId: string,
  userId: string,
  tier: string
): Promise<string> {
  // Load flow definition
  const flowResult = await pool.query(
    'SELECT uf.*, uf.flow_snapshot, nf.flow_json FROM user_flows uf JOIN nodered_flows nf ON nf.user_id = uf.user_id WHERE uf.id = $1 AND uf.user_id = $2',
    [flowId, userId]
  );

  if (flowResult.rows.length === 0) {
    throw new Error('Flow not found');
  }

  const flow = flowResult.rows[0];
  let flowJson: any[] = flow.flow_json || [];
  const tabId = flow.flow_tab_id;

  // Check if the tab exists; if not, try to restore from snapshot
  const tabExists = Array.isArray(flowJson) && flowJson.some((n: any) => n.id === tabId && n.type === 'tab');
  if (!tabExists && flow.flow_snapshot && Array.isArray(flow.flow_snapshot) && flow.flow_snapshot.length > 0) {
    flowJson = [...flowJson, ...flow.flow_snapshot];
    const revision = Date.now().toString();
    await pool.query(
      `UPDATE nodered_flows SET flow_json = $1, revision = $2, updated_at = NOW() WHERE user_id = $3`,
      [JSON.stringify(flowJson), revision, userId]
    );
    logger.info({ userId, tabId }, 'Restored flow tab from snapshot before run');
  }

  // Filter to only nodes belonging to this flow's tab
  const tabNodes = flowJson.filter((n: any) => n.z === tabId || n.id === tabId);

  // Build the graph
  const graph = buildGraph(tabNodes);

  if (graph.entryNodes.length === 0) {
    throw new Error('Flow has no entry nodes');
  }

  // Check if server is accepting new flows
  if (!runRegistry.isAccepting()) {
    throw new Error('Server is shutting down, not accepting new flows');
  }

  // LLM backpressure: reject new flows when LLM queue is saturated
  const llmLoad = isLlmOverloaded();
  if (llmLoad.overloaded) {
    throw new Error(`LLM servers are busy (${llmLoad.totalQueued} queued, max ${llmLoad.threshold}). Please try again in a moment.`);
  }

  // Create run record
  const runResult = await pool.query(
    `INSERT INTO flow_runs (user_id, flow_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, flowId]
  );
  const runId = runResult.rows[0].id;

  // Create DB-backed event sink
  const sink = createDbEventSink(runId);

  // Run the flow asynchronously, tracked by registry
  const flowPromise = runFlowAsync(runId, flowId, userId, tier, graph, sink).catch(err => {
    logger.error({ err: err.message, runId, flowId }, 'Async flow execution crashed');
  });
  runRegistry.register(runId, flowPromise);

  return runId;
}

/**
 * Internal: runs the flow engine loop asynchronously.
 */
async function runFlowAsync(
  runId: string,
  flowId: string,
  userId: string,
  tier: string,
  graph: FlowGraph,
  sink: FlowEventSink
): Promise<void> {
  const llmConfig = await getLlmConfig(userId, tier);

  await sink.emit({ type: 'flow_start', runId, flowId, totalNodes: graph.nodes.size });

  // Execute nodes in topological order using BFS
  const nodeOutputs = new Map<string, string[]>();
  const nodeMsgs = new Map<string, any[]>();
  const queue: string[] = [...graph.entryNodes];
  const visited = new Set<string>(graph.entryNodes);
  const executed = new Set<string>();
  let paused = false;

  while (queue.length > 0 && !paused) {
    const nodeId = queue.shift()!;
    if (executed.has(nodeId)) continue;

    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    // Wait for ALL reachable upstream nodes to be ready before executing
    if (!allUpstreamsReady(nodeId, graph, nodeOutputs, visited)) {
      const remaining = queue.filter(id => !executed.has(id));
      const allBlocked = remaining.length > 0 && remaining.every(id => {
        const n = graph.nodes.get(id);
        return n && !allUpstreamsReady(id, graph, nodeOutputs, visited);
      });
      if (allBlocked && !allUpstreamsReady(nodeId, graph, nodeOutputs, visited)) {
        logger.warn({ nodeId, flowId, queueSize: remaining.length }, 'Flow deadlock detected — skipping blocked nodes');
        break;
      }
      queue.push(nodeId);
      continue;
    }

    executed.add(nodeId);

    const executor = EXECUTORS[node.type];
    if (!executor) {
      await sink.emit({ type: 'node_skipped', nodeId, reason: `Unknown node type: ${node.type}` });
      continue;
    }

    // Collect all upstream inputs (with msg objects)
    const allInputs = collectUpstreamInputs(nodeId, graph, nodeOutputs, nodeMsgs);
    const previousOutput = allInputs.length > 0 ? allInputs[0].output : '';
    const upstreamMsg = allInputs.length > 0 ? allInputs[0].msg : undefined;

    await sink.emit({ type: 'node_start', nodeId, nodeType: node.type, name: node.name || node.type });
    setNodeStatus(nodeId, { fill: 'blue', shape: 'dot', text: 'running...' });

    // Update current_node in run record
    await pool.query('UPDATE flow_runs SET current_node = $1 WHERE id = $2', [nodeId, runId]);

    try {
      const input: NodeInput = {
        previousOutput,
        allInputs: allInputs.length > 0 ? allInputs : undefined,
        msg: upstreamMsg,
        config: { ...node.config, id: nodeId },
        userId,
        llmConfig,
        runId,
      };

      const result = await executor(input);

      if (result.paused) {
        paused = true;
        // Serialize nodeOutputs + nodeMsgs for pause context
        const serialized: Record<string, string[]> = {};
        for (const [k, v] of nodeOutputs) serialized[k] = v;
        const serializedMsgs: Record<string, any[]> = {};
        for (const [k, v] of nodeMsgs) serializedMsgs[k] = v;
        await pool.query(
          `UPDATE flow_runs SET status = 'paused', context = $1 WHERE id = $2`,
          [JSON.stringify({ pausedNodeId: nodeId, nodeOutputs: serialized, nodeMsgs: serializedMsgs }), runId]
        );
        await sink.emit({ type: 'flow_paused', runId, nodeId, nodeName: node.name || node.type });
        break;
      }

      // Store outputs: multiOutput for multi-port, or single output wrapped in array
      if (result.multiOutput && result.multiOutput.length > 0) {
        nodeOutputs.set(nodeId, result.multiOutput);
        // Build per-port msg objects
        nodeMsgs.set(nodeId, result.multiOutput.map(o => outputToMsg(o, nodeId)));
      } else {
        nodeOutputs.set(nodeId, [result.output]);
        // Store msg: use result.msg if native node provided one, else wrap output
        const msg = result.msg || outputToMsg(result.output, nodeId);
        nodeMsgs.set(nodeId, [msg]);
      }

      // Emit content (use first output for display, cap to avoid event loop blocking)
      const displayOutput = result.output;
      if (displayOutput) {
        const chunkSize = 500;
        const maxChunks = 100; // Cap at ~50KB to avoid blocking
        const chunks = Math.min(Math.ceil(displayOutput.length / chunkSize), maxChunks);
        for (let i = 0; i < chunks; i++) {
          await sink.emit({ type: 'node_content', nodeId, text: displayOutput.slice(i * chunkSize, (i + 1) * chunkSize) });
        }
      }

      await sink.emit({ type: 'node_done', nodeId });
      setNodeStatus(nodeId, { fill: 'green', shape: 'dot', text: 'done' });

      // Queue downstream nodes based on output port(s)
      if (result.multiOutput && result.multiOutput.length > 0) {
        for (let portIdx = 0; portIdx < result.multiOutput.length; portIdx++) {
          const targetWires = node.wires[portIdx] || [];
          for (const targetId of targetWires) {
            if (!executed.has(targetId)) {
              queue.push(targetId);
              visited.add(targetId);
            }
          }
        }
      } else {
        const portIndex = result.outputPort ?? 0;
        const targetWires = node.wires[portIndex] || [];
        for (const targetId of targetWires) {
          if (!executed.has(targetId)) {
            queue.push(targetId);
            visited.add(targetId);
          }
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message, nodeId, flowId }, 'Node execution error');
      await sink.emit({ type: 'node_error', nodeId, error: err.message });
      setNodeStatus(nodeId, { fill: 'red', shape: 'ring', text: 'error' });

      await pool.query(
        `UPDATE flow_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: err.message, nodeId }), runId]
      );
      await sink.emit({ type: 'error', message: `Flow failed at node ${node.name || nodeId}` });
      return;
    }
  }

  if (!paused) {
    // Collect final output from the last executed node
    const allOutputArrays = Array.from(nodeOutputs.values());
    const lastOutputArr = allOutputArrays[allOutputArrays.length - 1];
    const lastOutput = lastOutputArr ? lastOutputArr[0] : '';
    await pool.query(
      `UPDATE flow_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ output: lastOutput }), runId]
    );
    await sink.emit({ type: 'flow_complete', runId, nodesExecuted: executed.size });

    // Clear status dots after 10 seconds
    const executedIds = [...executed];
    setTimeout(() => executedIds.forEach(id => clearNodeStatus(id)), 10_000);
  }
}

/**
 * Resume a paused flow after human input is provided.
 * Runs asynchronously — returns immediately.
 */
export async function resumeFlow(
  runId: string,
  userId: string,
  response: string
): Promise<void> {
  const runResult = await pool.query(
    'SELECT * FROM flow_runs WHERE id = $1 AND user_id = $2 AND status = $3',
    [runId, userId, 'paused']
  );

  if (runResult.rows.length === 0) {
    throw new Error('No paused run found');
  }

  const run = runResult.rows[0];
  const context = run.context || {};
  const pausedNodeId = context.pausedNodeId;
  const savedOutputs: Record<string, string[]> = context.nodeOutputs || {};

  // Mark pending input as responded
  await pool.query(
    `UPDATE flow_pending_inputs SET response = $1, responded_at = NOW() WHERE run_id = $2 AND response IS NULL`,
    [response, runId]
  );

  // Update run status
  await pool.query('UPDATE flow_runs SET status = $1 WHERE id = $2', ['running', runId]);

  // Load the flow
  const flowResult = await pool.query(
    'SELECT uf.*, nf.flow_json FROM user_flows uf JOIN nodered_flows nf ON nf.user_id = uf.user_id WHERE uf.id = $1',
    [run.flow_id]
  );

  if (flowResult.rows.length === 0) {
    throw new Error('Flow not found');
  }

  const flow = flowResult.rows[0];
  const tabNodes = (flow.flow_json || []).filter((n: any) => n.z === flow.flow_tab_id || n.id === flow.flow_tab_id);
  const graph = buildGraph(tabNodes);

  // Determine the current max seq for this run so resumed events continue from there
  const seqResult = await pool.query(
    'SELECT COALESCE(MAX(seq), -1) as max_seq FROM flow_run_events WHERE run_id = $1',
    [runId]
  );
  const startSeq = seqResult.rows[0].max_seq + 1;

  // Create event sink continuing from current seq
  const sink: FlowEventSink = (() => {
    let seq = startSeq;
    return {
      async emit(event: Record<string, any>) {
        await pool.query(
          'INSERT INTO flow_run_events (run_id, seq, event) VALUES ($1, $2, $3)',
          [runId, seq++, JSON.stringify(event)]
        );
      }
    };
  })();

  const llmConfig = await getLlmConfig(userId, run.tier || 'free');

  // Restore nodeOutputs as Map<string, string[]>
  const nodeOutputs = new Map<string, string[]>();
  for (const [k, v] of Object.entries(savedOutputs)) {
    nodeOutputs.set(k, Array.isArray(v) ? v : [v as unknown as string]);
  }

  // Restore nodeMsgs
  const nodeMsgs = new Map<string, any[]>();
  const savedMsgs: Record<string, any[]> = context.nodeMsgs || {};
  for (const [k, v] of Object.entries(savedMsgs)) {
    nodeMsgs.set(k, Array.isArray(v) ? v : [v]);
  }

  // Set the human input response as output of the paused node
  nodeOutputs.set(pausedNodeId, [response]);
  nodeMsgs.set(pausedNodeId, [outputToMsg(response, pausedNodeId)]);

  await sink.emit({ type: 'flow_resumed', runId });

  // Continue from the paused node's downstream
  const pausedNode = graph.nodes.get(pausedNodeId);
  if (!pausedNode) {
    await sink.emit({ type: 'error', message: 'Paused node not found in flow' });
    await pool.query(
      `UPDATE flow_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ error: 'Paused node not found' }), runId]
    );
    return;
  }

  const queue: string[] = [];
  for (const portWires of pausedNode.wires) {
    queue.push(...portWires);
  }

  const executed = new Set(nodeOutputs.keys());
  const visited = new Set([...executed, ...queue]);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (executed.has(nodeId)) continue;

    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    // Wait for ALL reachable upstream nodes to be ready
    if (!allUpstreamsReady(nodeId, graph, nodeOutputs, visited)) {
      const remaining = queue.filter(id => !executed.has(id));
      const allBlocked = remaining.length > 0 && remaining.every(id => {
        const n = graph.nodes.get(id);
        return n && !allUpstreamsReady(id, graph, nodeOutputs, visited);
      });
      if (allBlocked && !allUpstreamsReady(nodeId, graph, nodeOutputs, visited)) {
        logger.warn({ nodeId, runId, queueSize: remaining.length }, 'Resume flow deadlock detected');
        break;
      }
      queue.push(nodeId);
      continue;
    }

    executed.add(nodeId);

    const executor = EXECUTORS[node.type];
    if (!executor) continue;

    const allInputs = collectUpstreamInputs(nodeId, graph, nodeOutputs, nodeMsgs);
    const previousOutput = allInputs.length > 0 ? allInputs[0].output : '';
    const upstreamMsg = allInputs.length > 0 ? allInputs[0].msg : undefined;

    await sink.emit({ type: 'node_start', nodeId, nodeType: node.type, name: node.name || node.type });
    setNodeStatus(nodeId, { fill: 'blue', shape: 'dot', text: 'running...' });

    try {
      const result = await executor({
        previousOutput,
        allInputs: allInputs.length > 0 ? allInputs : undefined,
        msg: upstreamMsg,
        config: { ...node.config, id: nodeId },
        userId,
        llmConfig,
        runId,
      });

      if (result.paused) {
        const serialized: Record<string, string[]> = {};
        for (const [k, v] of nodeOutputs) serialized[k] = v;
        const serializedMsgs: Record<string, any[]> = {};
        for (const [k, v] of nodeMsgs) serializedMsgs[k] = v;
        await pool.query(
          `UPDATE flow_runs SET status = 'paused', context = $1 WHERE id = $2`,
          [JSON.stringify({ pausedNodeId: nodeId, nodeOutputs: serialized, nodeMsgs: serializedMsgs }), runId]
        );
        await sink.emit({ type: 'flow_paused', runId, nodeId });
        return;
      }

      if (result.multiOutput && result.multiOutput.length > 0) {
        nodeOutputs.set(nodeId, result.multiOutput);
        nodeMsgs.set(nodeId, result.multiOutput.map(o => outputToMsg(o, nodeId)));
      } else {
        nodeOutputs.set(nodeId, [result.output]);
        const msg = result.msg || outputToMsg(result.output, nodeId);
        nodeMsgs.set(nodeId, [msg]);
      }

      const displayOutput = result.output;
      if (displayOutput) {
        const chunkSize = 500;
        const maxChunks = 100;
        const chunks = Math.min(Math.ceil(displayOutput.length / chunkSize), maxChunks);
        for (let i = 0; i < chunks; i++) {
          await sink.emit({ type: 'node_content', nodeId, text: displayOutput.slice(i * chunkSize, (i + 1) * chunkSize) });
        }
      }
      await sink.emit({ type: 'node_done', nodeId });
      setNodeStatus(nodeId, { fill: 'green', shape: 'dot', text: 'done' });

      if (result.multiOutput && result.multiOutput.length > 0) {
        for (let portIdx = 0; portIdx < result.multiOutput.length; portIdx++) {
          const targetWires = node.wires[portIdx] || [];
          for (const targetId of targetWires) {
            if (!executed.has(targetId)) { queue.push(targetId); visited.add(targetId); }
          }
        }
      } else {
        const portIndex = result.outputPort ?? 0;
        const targetWires = node.wires[portIndex] || [];
        for (const targetId of targetWires) {
          if (!executed.has(targetId)) { queue.push(targetId); visited.add(targetId); }
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message, nodeId, runId }, 'Resume node execution error');
      await pool.query(
        `UPDATE flow_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: err.message, nodeId }), runId]
      );
      setNodeStatus(nodeId, { fill: 'red', shape: 'ring', text: 'error' });
      await sink.emit({ type: 'error', message: `Flow failed at node ${node.name || nodeId}` });
      return;
    }
  }

  const allOutputArrays = Array.from(nodeOutputs.values());
  const lastOutputArr = allOutputArrays[allOutputArrays.length - 1];
  const lastOutput = lastOutputArr ? lastOutputArr[0] : '';
  await pool.query(
    `UPDATE flow_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
    [JSON.stringify({ output: lastOutput }), runId]
  );
  await sink.emit({ type: 'flow_complete', runId, nodesExecuted: executed.size });

  // Clear status dots after 10 seconds
  const executedIds = [...executed];
  setTimeout(() => executedIds.forEach(id => clearNodeStatus(id)), 10_000);
}
