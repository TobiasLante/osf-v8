/** Shared API configuration — single source of truth for the KG Server URL. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8035';

/** Typed fetch wrapper with error handling. */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) throw new Error(await res.text().catch(() => '') || `HTTP ${res.status}`);
  return res.json();
}
