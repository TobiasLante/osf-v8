import { config } from './config';
import { logger } from './logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function callLlm(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean; model?: string },
): Promise<string> {
  const { temperature = 0.3, maxTokens = config.llm.maxTokens, jsonMode = false, model } = options || {};

  for (let attempt = 0; attempt < config.llm.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);

    try {
      const body: any = {
        model: model || config.llm.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${config.llm.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content || '';
      if (!content) throw new Error('Empty LLM response');
      return content;
    } catch (e: any) {
      logger.warn({ attempt, err: e.message }, 'LLM call failed');
      if (attempt < config.llm.maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('LLM call exhausted retries');
}

export async function callLlmJson<T>(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<T> {
  const raw = await callLlm(messages, { ...options, jsonMode: true });

  // Try to extract JSON from response (may be wrapped in markdown code blocks)
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Retry once with fix prompt
    logger.warn('LLM returned invalid JSON, retrying with fix prompt');
    const fixMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: 'Your previous response was not valid JSON. Please return ONLY valid JSON, no markdown, no explanation.' },
    ];
    const fixed = await callLlm(fixMessages, { ...options, jsonMode: true });
    let fixedStr = fixed.trim();
    const fixedFence = fixedStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fixedFence) fixedStr = fixedFence[1].trim();
    return JSON.parse(fixedStr) as T;
  }
}
