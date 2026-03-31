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
  if (cfg.customBaseUrl) {
    localStorage.setItem(LS_CUSTOM_BASE_URL, cfg.customBaseUrl);
  } else {
    localStorage.removeItem(LS_CUSTOM_BASE_URL);
  }
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
  signal?: AbortSignal,
) {
  const config = loadLlmConfig();
  if (!config.apiKey && config.provider !== 'custom') throw new Error('No API key configured');

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
    signal,
  });

  if (!res.ok) throw new Error(await res.text());
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
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
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Tools list ──

export async function getTools() {
  const res = await fetch(`${GATEWAY_URL}/api/tools`);
  if (!res.ok) return [];
  return res.json();
}

// ── Stats ──

export async function getStats() {
  const res = await fetch(`${GATEWAY_URL}/api/stats`);
  if (!res.ok) return null;
  return res.json();
}

// ── i3x REST API (structured data) ──

export interface Account {
  elementId: string;
  displayName: string;
  properties: Record<string, any>;
}

export interface AccountDetail extends Account {
  related: Array<{
    elementId: string;
    displayName: string;
    typeId: string;
    relationships?: Record<string, boolean>;
  }>;
}

export interface Vendor {
  elementId: string;
  displayName: string;
  properties: Record<string, any>;
}

export interface ProcessTemplate {
  elementId: string;
  displayName: string;
  steps: Array<{ elementId: string; displayName: string }>;
}

export async function getAccounts(): Promise<Account[]> {
  const res = await fetch(`${GATEWAY_URL}/api/accounts`);
  if (!res.ok) return [];
  return res.json();
}

export async function getAccount(id: string): Promise<AccountDetail | null> {
  const res = await fetch(`${GATEWAY_URL}/api/accounts/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getVendors(): Promise<Vendor[]> {
  const res = await fetch(`${GATEWAY_URL}/api/vendors`);
  if (!res.ok) return [];
  return res.json();
}

export async function getProcessTemplates(): Promise<ProcessTemplate[]> {
  const res = await fetch(`${GATEWAY_URL}/api/process-templates`);
  if (!res.ok) return [];
  return res.json();
}

// ── Enrichment ──

export async function enrichClinicalTrials(companyName: string) {
  const res = await fetch(`${GATEWAY_URL}/api/enrich/clinicaltrials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName }),
  });
  if (!res.ok) return { studies: [], summary: 'API error' };
  return res.json();
}

export async function enrichFda(companyName: string) {
  const res = await fetch(`${GATEWAY_URL}/api/enrich/fda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName }),
  });
  if (!res.ok) return { approvals: [], summary: 'API error' };
  return res.json();
}
