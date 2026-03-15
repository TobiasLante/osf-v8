import { config } from './config';
import { logger } from './logger';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function llmChat(messages: ChatMessage[], maxTokens = 1024): Promise<string> {
  const url = `${config.llm.url}/v1/chat/completions`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.llm.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${body}`);
      }

      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      logger.warn({ attempt, err: err.message }, 'LLM call failed');
      if (attempt === 2) {
        return `[LLM unavailable: ${err.message}]`;
      }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  return '[LLM unavailable]';
}
