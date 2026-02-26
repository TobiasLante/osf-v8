import { LlmConfig } from '../../chat/llm-client';

export interface UpstreamInfo {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  output: string;                    // JSON-String of the upstream output
  msg?: Record<string, any>;        // Full msg object (Node-RED compatible)
}

export interface NodeInput {
  previousOutput: string;           // first/only upstream output (backwards compat)
  allInputs?: UpstreamInfo[];       // all upstream outputs (for multi-input nodes)
  msg?: Record<string, any>;        // Full msg from first upstream (for native nodes)
  config: Record<string, any>;
  userId: string;
  llmConfig: LlmConfig;
  runId: string;
}

export interface NodeResult {
  output: string;
  msg?: Record<string, any>;   // Full msg object to pass downstream (native nodes)
  outputPort?: number;         // For decision nodes: which output port to use
  multiOutput?: string[];      // For multi-output nodes: array of outputs per port
  paused?: boolean;            // For human-input nodes: pause execution
}

/** Try to parse a string as JSON, return original string on failure */
export function tryParseJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}

/** Build a msg object from a raw output string */
export function outputToMsg(output: string, nodeId: string): Record<string, any> {
  return { payload: tryParseJson(output), _msgid: nodeId };
}

/** Extract previousOutput string from a msg object */
export function msgToOutput(msg: Record<string, any>): string {
  const p = msg.payload;
  return typeof p === 'string' ? p : JSON.stringify(p);
}

export type NodeExecutor = (input: NodeInput) => Promise<NodeResult>;
