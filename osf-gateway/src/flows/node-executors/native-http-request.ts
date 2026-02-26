import { NodeExecutor, tryParseJson, msgToOutput } from './types';

/** Block requests to private/internal networks (SSRF prevention) */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const host = parsed.hostname.toLowerCase();
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|0000:|\[::1\])/.test(host)) return true;
    if (host.endsWith('.svc.cluster.local') || host.endsWith('.internal') || host.endsWith('.local')) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Executor for native Node-RED 'http request' node.
 * Makes HTTP requests to external APIs.
 */
export const executeNativeHttpRequest: NodeExecutor = async (input) => {
  const method = (input.config.method || 'GET').toUpperCase();
  let url = input.config.url || '';
  const returnType = input.config.ret || 'txt';

  // Use upstream msg if available
  const msg: any = input.msg
    ? { ...input.msg }
    : { payload: tryParseJson(input.previousOutput) };

  // Replace {{field}} in URL from msg
  url = url.replace(/\{\{([^}]+)\}\}/g, (_match: string, path: string) => {
    const parts = path.trim().split('.');
    let value: any = msg;
    for (const p of parts) {
      if (value === undefined || value === null) return '';
      value = value[p];
    }
    return value !== undefined && value !== null ? String(value) : '';
  });

  if (!url) {
    if (typeof msg.url === 'string') {
      url = msg.url;
    } else if (typeof msg.payload === 'string' && msg.payload.startsWith('http')) {
      url = msg.payload;
    } else {
      throw new Error('http request: no URL configured');
    }
  }

  if (isBlockedUrl(url)) {
    throw new Error('http request: requests to private/internal networks are not allowed');
  }

  const headers: Record<string, string> = {};
  if (input.config.headers) {
    for (const h of Object.entries(input.config.headers)) {
      headers[h[0] as string] = h[1] as string;
    }
  }
  // Also use msg.headers if set
  if (msg.headers && typeof msg.headers === 'object') {
    Object.assign(headers, msg.headers);
  }

  const fetchOptions: RequestInit = { method, headers: { ...headers } };

  if (['POST', 'PUT', 'PATCH'].includes(method) && msg.payload !== undefined) {
    const body = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
    fetchOptions.body = body;
    if (!headers['Content-Type'] && !headers['content-type']) {
      (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  fetchOptions.signal = controller.signal;

  const resp = await fetch(url, fetchOptions);
  clearTimeout(timeout);

  // Set response metadata on msg (Node-RED standard)
  msg.statusCode = resp.status;
  msg.headers = Object.fromEntries(resp.headers.entries());

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    msg.payload = text.slice(0, 500);
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }

  if (returnType === 'obj') {
    msg.payload = await resp.json();
  } else {
    msg.payload = await resp.text();
  }

  return { output: msgToOutput(msg), msg };
};
