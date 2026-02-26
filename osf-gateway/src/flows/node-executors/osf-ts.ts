import { NodeExecutor } from './types';
import { executeSandbox } from '../../code-agents/sandbox';
import { callMcpTool, getMcpTools } from '../../chat/tool-executor';
import { callLlm, getLlmConfig, ChatMessage } from '../../chat/llm-client';
import { pool } from '../../db/pool';
import { logger } from '../../logger';

/**
 * Execute an osf-ts Node-RED node.
 * Runs the user's TypeScript code in an isolated sandbox with the SDK.
 * Supports multi-output: if config.outputs > 1, the return value must be an array.
 */
export const executeOsfTs: NodeExecutor = async (input) => {
  const code = input.config.code;
  if (!code || !code.trim()) {
    throw new Error('osf-ts: no code configured');
  }

  const timeout = Math.min(parseInt(input.config.timeout, 10) || 120, 600);
  const nodeId = input.config.id || 'unknown';
  const numOutputs = parseInt(input.config.outputs, 10) || 1;

  // Strip ES module syntax and wrap in CommonJS for the sandbox
  let cleanCode = code
    .replace(/^export\s+default\s+async\s+function\s+main\s*\([^)]*\)\s*\{/m, '')
    .replace(/^export\s+default\s+function\s+main\s*\([^)]*\)\s*\{/m, '');

  // If we stripped the function wrapper, remove the matching closing brace
  if (cleanCode !== code) {
    // Remove the last closing brace (the function's closing brace)
    const lastBrace = cleanCode.lastIndexOf('}');
    if (lastBrace >= 0) {
      cleanCode = cleanCode.slice(0, lastBrace);
    }
  }

  const bundledCode = `
    module.exports = { default: async function main(ctx) {
      const input = ${JSON.stringify(input.previousOutput || '')};
      ${cleanCode}
    }};
  `;

  const logs: string[] = [];
  const config = await getLlmConfig(input.userId, 'premium');

  const callbacks = {
    async callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
      return await callMcpTool(name, args);
    },

    async callLlm(prompt: string): Promise<string> {
      const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
      const response = await callLlm(messages, undefined, config, input.userId);
      return response.content || '';
    },

    async callLlmJson(prompt: string): Promise<string> {
      const jsonPrompt = prompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object.';
      const messages: ChatMessage[] = [{ role: 'user', content: jsonPrompt }];
      const response = await callLlm(messages, undefined, config, input.userId);
      let content = response.content || '';
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      return content;
    },

    async listTools(): Promise<string> {
      const tools = await getMcpTools();
      const names = tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
      }));
      return JSON.stringify(names);
    },

    async storageGet(key: string): Promise<string | null> {
      const result = await pool.query(
        'SELECT value FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
        [nodeId, input.userId, key]
      );
      if (result.rows.length === 0) return null;
      return JSON.stringify(result.rows[0].value);
    },

    async storageSet(key: string, value: string): Promise<void> {
      await pool.query(
        `INSERT INTO code_agent_storage (agent_id, user_id, key, value, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (agent_id, user_id, key) DO UPDATE SET value = $4::jsonb, updated_at = NOW()`,
        [nodeId, input.userId, key, value]
      );
    },

    async storageDelete(key: string): Promise<void> {
      await pool.query(
        'DELETE FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
        [nodeId, input.userId, key]
      );
    },

    log(message: string): void {
      logs.push(`[${new Date().toISOString()}] ${message}`);
      logger.info({ nodeId, message }, 'osf-ts log');
    },
  };

  const { result, error } = await executeSandbox(bundledCode, callbacks, timeout);

  if (error) {
    throw new Error(`osf-ts execution failed: ${error}`);
  }

  // Multi-output support
  if (numOutputs > 1 && Array.isArray(result)) {
    const multiOutput = result.map((item: any) =>
      typeof item === 'string' ? item : JSON.stringify(item)
    );
    return {
      output: multiOutput[0] || '',
      multiOutput,
    };
  }

  const output = typeof result === 'string' ? result : JSON.stringify(result);
  return { output: output || '' };
};
