// Health Agent — LLM client (OpenAI-compatible, llama.cpp)

import type { ToolDef } from './tools.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmResponse {
  content: string | null;
  tool_calls: ToolCall[] | null;
}

const TIMEOUT_MS = 120_000;

export async function callLlm(
  messages: ChatMessage[],
  tools: ToolDef[],
  llmUrl: string,
): Promise<LlmResponse> {
  const body = {
    model: 'qwen2.5',
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    temperature: 0.2,
    max_tokens: 4096,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${llmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0]?.message;

    return {
      content: choice?.content || null,
      tool_calls: choice?.tool_calls || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLlmAvailability(llmUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${llmUrl}/v1/models`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
