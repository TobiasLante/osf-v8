// Simple in-memory sliding window rate limiter
const windows = new Map<string, number[]>();

const WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const timestamps = windows.get(key) || [];

  // Remove expired entries
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);

  if (valid.length >= maxPerMinute) {
    windows.set(key, valid);
    return false;
  }

  valid.push(now);
  windows.set(key, valid);
  return true;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of windows.entries()) {
    const valid = timestamps.filter((t) => now - t < WINDOW_MS);
    if (valid.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, valid);
    }
  }
}, 5 * 60_000);
