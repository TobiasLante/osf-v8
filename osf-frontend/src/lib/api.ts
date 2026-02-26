import { LS_TOKEN, LS_REFRESH_TOKEN } from '@/lib/constants';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://osf-api.zeroguess.ai';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let isRefreshing = false;

async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    localStorage.setItem(LS_TOKEN, data.token);
    localStorage.setItem(LS_REFRESH_TOKEN, data.refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

function forceLogout() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_REFRESH_TOKEN);
  window.location.href = '/login';
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(LS_TOKEN) : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // On 401, try to refresh the token once, then retry
  if (res.status === 401 && token && !isRefreshing) {
    isRefreshing = true;
    const newToken = await tryRefreshToken();
    isRefreshing = false;

    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retry = await fetch(`${API_BASE}${path}`, { ...options, headers });
      if (retry.ok) return retry.json();
    }

    // Refresh failed or retry failed — force logout
    forceLogout();
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }

  return res.json();
}

export interface SSEEvent {
  type: string;
  [key: string]: any;
}

/** Execute a V7 agent and stream progress events via SSE */
export function executeV7Agent(
  agentName: string,
  sessionId: string,
  onEvent: (event: SSEEvent) => void,
  options: { language?: string } = {}
): { cancel: () => void; done: Promise<any> } {
  let cancelled = false;
  let eventSource: EventSource | null = null;
  let resolveDone: (value: any) => void;
  let rejectDone: (err: any) => void;

  // The done promise resolves when the SSE 'done' event arrives (not when POST returns)
  const done = new Promise<any>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  // 1. Connect SSE first
  eventSource = new EventSource(`${API_BASE}/v7/progress/${sessionId}`);

  eventSource.addEventListener('progress', (e: MessageEvent) => {
    if (cancelled) return;
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
      // Close SSE and resolve when agent is done
      if (data.type === 'done') {
        eventSource?.close();
        eventSource = null;
        resolveDone(data);
      }
      if (data.type === 'error') {
        eventSource?.close();
        eventSource = null;
        rejectDone(new ApiError(500, data.message || 'Agent error'));
      }
    } catch {}
  });

  eventSource.addEventListener('connected', () => {
    // SSE connected, now trigger the agent
  });

  eventSource.onerror = () => {
    // SSE errors are normal on disconnect — ignore if cancelled or done
  };

  // 2. POST to execute — returns 202 immediately (fire-and-forget)
  const token = typeof window !== 'undefined' ? localStorage.getItem(LS_TOKEN) : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  fetch(`${API_BASE}/v7/agents/${agentName}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, language: options.language || 'de' }),
  }).then(async (res) => {
    if (!res.ok && res.status !== 202) {
      const text = await res.text();
      rejectDone(new ApiError(res.status, text));
      eventSource?.close();
      eventSource = null;
    }
  }).catch((err) => {
    rejectDone(err);
    eventSource?.close();
    eventSource = null;
  });

  return {
    cancel: () => {
      cancelled = true;
      eventSource?.close();
      eventSource = null;
      resolveDone({ cancelled: true });
      // Try to stop the agent
      fetch(`${API_BASE}/v7/agents/${agentName}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    },
    done,
  };
}

/**
 * Poll flow events from the DB-backed endpoint.
 * Drop-in replacement for streamSSE — yields SSEEvent objects.
 */
export async function* pollFlowEvents(runId: string): AsyncGenerator<SSEEvent> {
  let cursor = -1;
  const POLL_INTERVAL = 2000;

  while (true) {
    const data = await apiFetch<{ status: string; events: (SSEEvent & { seq: number })[] }>(
      `/flows/api/runs/${runId}/events?after=${cursor}`
    );

    for (const evt of data.events) {
      cursor = evt.seq;
      yield evt;
    }

    if (data.status === 'completed' || data.status === 'failed') break;

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

export async function* streamSSE(
  path: string,
  body: any
): AsyncGenerator<SSEEvent> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(LS_TOKEN) : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      try {
        yield JSON.parse(trimmed.slice(6));
      } catch {
        // skip malformed
      }
    }
  }
}
