import { NodeExecutor } from './types';
import { logger } from '../../logger';

/** Block requests to private/internal networks (SSRF prevention) */
function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const host = parsed.hostname.toLowerCase();
    // Block private IPs, localhost, link-local, K8s internal, cloud metadata
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|0000:|\[::1\])/.test(host)) return true;
    if (host.endsWith('.svc.cluster.local') || host.endsWith('.internal') || host.endsWith('.local')) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Execute an osf-http node.
 * Makes HTTP requests with template URL support, auth headers, and JSON mode.
 */
export const executeOsfHttp: NodeExecutor = async (input) => {
  const method = (input.config.method || 'GET').toUpperCase();
  let url = input.config.url || '';
  const returnJson = input.config.returnJson !== false;
  const authType = input.config.authType || 'none';
  const authValue = input.config.authValue || '';
  const customHeaders: Record<string, string> = input.config.headers || {};
  const timeoutMs = Math.min((parseInt(input.config.timeout, 10) || 30) * 1000, 120_000);

  // Parse input data for template replacement and body
  let data: any;
  try {
    data = JSON.parse(input.previousOutput);
  } catch {
    data = input.previousOutput;
  }

  // Replace ${field} and {{field}} in URL
  url = url.replace(/(?:\$\{([^}]+)\}|\{\{([^}]+)\}\})/g, (_match: string, p1: string, p2: string) => {
    const path = (p1 || p2).trim().split('.');
    let value: any = data;
    for (const p of path) {
      if (value === undefined || value === null) return '';
      value = typeof value === 'object' ? value[p] : undefined;
    }
    return value !== undefined && value !== null ? encodeURIComponent(String(value)) : '';
  });

  if (!url) {
    throw new Error('osf-http: no URL configured');
  }

  if (isBlockedUrl(url)) {
    throw new Error('osf-http: requests to private/internal networks are not allowed');
  }

  // Build headers
  const headers: Record<string, string> = { ...customHeaders };
  if (authType === 'bearer' && authValue) {
    headers['Authorization'] = `Bearer ${authValue}`;
  } else if (authType === 'api-key' && authValue) {
    headers['X-API-Key'] = authValue;
  }

  const fetchOptions: RequestInit = { method, headers };

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    fetchOptions.body = body;
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  fetchOptions.signal = controller.signal;

  logger.info({ nodeId: input.config.id, method, url }, 'osf-http request');

  const resp = await fetch(url, fetchOptions);
  clearTimeout(timeout);

  const respText = await resp.text();

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${respText.slice(0, 500)}`);
  }

  if (returnJson) {
    try {
      JSON.parse(respText); // validate
      return { output: respText };
    } catch {
      return { output: JSON.stringify({ body: respText, status: resp.status }) };
    }
  }

  return { output: respText };
};
