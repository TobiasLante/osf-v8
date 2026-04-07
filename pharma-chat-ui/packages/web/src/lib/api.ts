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

// ── Site Intelligence ──

import type {
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
  EquipmentStatus, ReportRequest, VendorMapRow, ProcessStep,
} from '@p1/shared';

/** Get auth headers — passes the user's API key to the gateway for LLM calls */
function siteHeaders(): Record<string, string> {
  const cfg = loadLlmConfig();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h['X-API-Key'] = cfg.apiKey;
  return h;
}

/** Batch enrichment (non-streaming fallback) */
export async function siteEnrich(input: SiteIntelligenceInput): Promise<EnrichmentData> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/enrich`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Streaming enrichment with per-source progress updates */
export async function siteEnrichStream(
  input: SiteIntelligenceInput,
  onSourceStart: (name: string) => void,
  onSourceDone: (name: string, preview: string) => void,
  onSourceError: (name: string) => void,
): Promise<EnrichmentData> {
  const cfg = loadLlmConfig();
  const params = new URLSearchParams({
    accountName: input.accountName,
    ...(input.location ? { location: input.location } : {}),
    ...(input.vendor ? { vendor: input.vendor } : {}),
  });

  const url = `${GATEWAY_URL}/api/site-intelligence/enrich-stream?${params}`;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await res.text());
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let enrichment: EnrichmentData | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.event === 'source_start') onSourceStart(evt.name);
        else if (evt.event === 'source_done') onSourceDone(evt.name, evt.preview);
        else if (evt.event === 'source_error') onSourceError(evt.name);
        else if (evt.event === 'complete') enrichment = evt.enrichment;
      } catch { /* skip malformed */ }
    }
  }

  if (!enrichment) throw new Error('Enrichment stream ended without data');
  return enrichment;
}

export async function siteResolve(enrichment: EnrichmentData): Promise<ModalityResolution> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/resolve`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify({ enrichment }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function siteInferStatus(
  enrichment: EnrichmentData, vendorMapTab: string, userVendor: string,
): Promise<EquipmentStatus> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/status`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify({ enrichment, vendorMapTab, userVendor }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function siteGetProcessSteps(
  vendorMapTab: string, userVendor: string, equipmentStatus: EquipmentStatus,
): Promise<ProcessStep[]> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/process-steps`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify({ vendorMapTab, userVendor, equipmentStatus }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.steps || [];
}

export async function siteGenerateReport(request: ReportRequest): Promise<Blob> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/report`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function getSavedAccounts(): Promise<Array<{
  facilityId: string; companyName: string; location: string;
  modality: string; scale: string; accountType: string; lastEnriched: string;
}>> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/accounts`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.accounts || [];
}

export async function getVendorMapTabList(): Promise<string[]> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/vendor-map`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.tabs || [];
}

export async function getVendorMapData(tab: string): Promise<VendorMapRow[]> {
  const res = await fetch(`${GATEWAY_URL}/api/site-intelligence/vendor-map/${encodeURIComponent(tab)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.rows || [];
}
