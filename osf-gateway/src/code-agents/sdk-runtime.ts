import { callMcpTool, getMcpTools } from '../chat/tool-executor';
import { callLlm, getLlmConfig, ChatMessage } from '../chat/llm-client';
import { pool } from '../db/pool';
import { Response } from 'express';

export interface SdkCallbacks {
  callMcpTool(name: string, args: Record<string, unknown>): Promise<string>;
  callLlm(prompt: string): Promise<string>;
  callLlmJson(prompt: string): Promise<string>;
  listTools(): Promise<string>;
  storageGet(key: string): Promise<string | null>;
  storageSet(key: string, value: string): Promise<void>;
  storageDelete(key: string): Promise<void>;
  log(message: string): void;
}

export function createSdkCallbacks(
  userId: string,
  agentId: string,
  tier: string,
  res: Response,
  logs: string[]
): SdkCallbacks {
  return {
    async callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
      res.write(`data: ${JSON.stringify({ type: 'tool_start', name, arguments: args })}\n\n`);
      const result = await callMcpTool(name, args);
      res.write(`data: ${JSON.stringify({ type: 'tool_result', name, result })}\n\n`);
      return result;
    },

    async callLlm(prompt: string): Promise<string> {
      res.write(`data: ${JSON.stringify({ type: 'llm_start', prompt: prompt.slice(0, 200) })}\n\n`);
      const config = await getLlmConfig(userId, tier);
      const messages: ChatMessage[] = [
        { role: 'user', content: prompt },
      ];
      const response = await callLlm(messages, undefined, config);
      const content = response.content || '';
      // Stream the actual LLM content so discussion rounds are visible
      if (content) {
        res.write(`data: ${JSON.stringify({ type: 'content', text: content })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'llm_result', length: content.length })}\n\n`);
      return content;
    },

    async callLlmJson(prompt: string): Promise<string> {
      const jsonPrompt = prompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object.';
      res.write(`data: ${JSON.stringify({ type: 'llm_start', prompt: prompt.slice(0, 200) + ' [JSON mode]' })}\n\n`);
      const config = await getLlmConfig(userId, tier);
      const messages: ChatMessage[] = [
        { role: 'user', content: jsonPrompt },
      ];
      const response = await callLlm(messages, undefined, config);
      let content = response.content || '';
      // Strip markdown code fences if the LLM wraps it
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      res.write(`data: ${JSON.stringify({ type: 'llm_result', length: content.length, format: 'json' })}\n\n`);
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
        [agentId, userId, key]
      );
      if (result.rows.length === 0) return null;
      return JSON.stringify(result.rows[0].value);
    },

    async storageSet(key: string, value: string): Promise<void> {
      await pool.query(
        `INSERT INTO code_agent_storage (agent_id, user_id, key, value, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (agent_id, user_id, key) DO UPDATE SET value = $4::jsonb, updated_at = NOW()`,
        [agentId, userId, key, value]
      );
    },

    async storageDelete(key: string): Promise<void> {
      await pool.query(
        'DELETE FROM code_agent_storage WHERE agent_id = $1 AND user_id = $2 AND key = $3',
        [agentId, userId, key]
      );
    },

    log(message: string): void {
      const entry = `[${new Date().toISOString()}] ${message}`;
      logs.push(entry);
      res.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
    },
  };
}
