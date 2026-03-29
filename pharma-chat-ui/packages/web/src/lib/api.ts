const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3101';

// ── localStorage keys ──
const LS_PROVIDER = 'p1_provider';
const LS_API_KEY = 'p1_apiKey';
const LS_MODEL = 'p1_model';
const LS_CUSTOM_BASE_URL = 'p1_customBaseUrl';

export type Provider = 'anthropic' | 'openai' | 'custom';

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
}

export function loadLlmConfig(): LlmConfig {
  if (typeof window === 'undefined') return { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-4-20250514' };
  return {
    provider: (localStorage.getItem(LS_PROVIDER) as Provider) || 'anthropic',
    apiKey: localStorage.getItem(LS_API_KEY) || '',
    model: localStorage.getItem(LS_MODEL) || 'claude-sonnet-4-20250514',
    customBaseUrl: localStorage.getItem(LS_CUSTOM_BASE_URL) || undefined,
  };
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(LS_PROVIDER, cfg.provider);
  localStorage.setItem(LS_API_KEY, cfg.apiKey);
  localStorage.setItem(LS_MODEL, cfg.model);
  if (cfg.customBaseUrl) localStorage.setItem(LS_CUSTOM_BASE_URL, cfg.customBaseUrl);
}

// ── Chat — SSE stream from gateway ──

export async function sendChat(
  messages: Array<{ role: string; content: string }>,
  callbacks: {
    onToolStart?: (name: string, args: any) => void;
    onToolResult?: (name: string, content: string) => void;
    onContent?: (text: string) => void;
    onError?: (error: string) => void;
    onDone?: () => void;
  },
) {
  const config = loadLlmConfig();
  if (!config.apiKey) throw new Error('No API key configured');

  const gatewayConfig = {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.customBaseUrl,
  };

  const res = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, config: gatewayConfig }),
  });

  if (!res.ok) throw new Error(await res.text());

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'tool_start') callbacks.onToolStart?.(event.name, event.args);
        else if (event.type === 'tool_result') callbacks.onToolResult?.(event.name, event.content);
        else if (event.type === 'content') callbacks.onContent?.(event.text);
        else if (event.type === 'error') callbacks.onError?.(event.message);
        else if (event.type === 'done') callbacks.onDone?.();
      } catch {
        // Skip malformed SSE lines
      }
    }
  }
}

// ── Tools list ──

export async function getTools() {
  const res = await fetch(`${GATEWAY_URL}/api/tools`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.tools || [];
}

// ── Stats ──

export async function getStats() {
  const res = await fetch(`${GATEWAY_URL}/api/stats`);
  if (!res.ok) return null;
  return res.json();
}

// ── Enrichment ──

export async function enrichClinicalTrials(companyName: string) {
  const res = await fetch(`${GATEWAY_URL}/api/enrich/clinicaltrials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName }),
  });
  return res.json();
}

export async function enrichFda(companyName: string) {
  const res = await fetch(`${GATEWAY_URL}/api/enrich/fda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName }),
  });
  return res.json();
}
