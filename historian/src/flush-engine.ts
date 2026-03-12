// Historian v2 — Flush Engine
// Per-table buffers with independent timers, COPY protocol flush,
// chunking (max 5000), dead letter after 3 retries

import { copyInsert, batchInsert, recordDeadLetter, type TableRow, type HistoryRow } from './db.js';
import { appendBatch } from './disk-buffer.js';

const MAX_CHUNK = 5000;
const MAX_RETRIES = 3;

// ─── Per-Table Buffer ─────────────────────────────────────────────────────────

interface TableBuffer {
  table: string;
  rows: TableRow[];
  flushIntervalS: number;
  timer: NodeJS.Timeout | null;
  retryCount: number;
  stats: {
    inserted: number;
    errors: number;
    flushes: number;
    lastFlushMs: number;
    deadLettered: number;
  };
}

const tableBuffers = new Map<string, TableBuffer>();

// Legacy buffer for uns_history (keeps MCP tools working)
let legacyBuffer: HistoryRow[] = [];
let legacyTimer: NodeJS.Timeout | null = null;
const legacyStats = { inserted: 0, errors: 0, flushes: 0 };

// ─── Buffer Management ───────────────────────────────────────────────────────

function getOrCreateBuffer(table: string, flushIntervalS: number): TableBuffer {
  let buf = tableBuffers.get(table);
  if (buf) {
    // Update flush interval if changed
    if (buf.flushIntervalS !== flushIntervalS) {
      if (buf.timer) clearInterval(buf.timer);
      buf.flushIntervalS = flushIntervalS;
      buf.timer = setInterval(() => flushTable(table), flushIntervalS * 1000);
    }
    return buf;
  }

  buf = {
    table,
    rows: [],
    flushIntervalS,
    timer: null,
    retryCount: 0,
    stats: { inserted: 0, errors: 0, flushes: 0, lastFlushMs: 0, deadLettered: 0 },
  };

  buf.timer = setInterval(() => flushTable(table), flushIntervalS * 1000);
  tableBuffers.set(table, buf);
  return buf;
}

// ─── Push Row ─────────────────────────────────────────────────────────────────

export function pushRow(table: string, flushIntervalS: number, row: TableRow): void {
  const buf = getOrCreateBuffer(table, flushIntervalS);
  buf.rows.push(row);
}

export function pushLegacyRow(row: HistoryRow): void {
  legacyBuffer.push(row);
  // Cap legacy buffer
  if (legacyBuffer.length > 10_000) {
    legacyBuffer = legacyBuffer.slice(-10_000);
  }
}

// ─── Flush ────────────────────────────────────────────────────────────────────

async function flushTable(table: string): Promise<void> {
  const buf = tableBuffers.get(table);
  if (!buf || buf.rows.length === 0) return;

  const batch = buf.rows.splice(0);

  // Write to disk buffer before attempting DB write
  appendBatch(table, batch);

  const startMs = Date.now();

  try {
    // Chunk into MAX_CHUNK-sized batches
    for (let i = 0; i < batch.length; i += MAX_CHUNK) {
      const chunk = batch.slice(i, i + MAX_CHUNK);
      await copyInsert(table, chunk);
    }

    buf.stats.inserted += batch.length;
    buf.stats.flushes++;
    buf.stats.lastFlushMs = Date.now() - startMs;
    buf.retryCount = 0;
  } catch (err: any) {
    buf.retryCount++;
    buf.stats.errors++;

    if (buf.retryCount >= MAX_RETRIES) {
      // Dead letter: log, drop, continue
      console.error(`[flush] Dead letter: ${table} (${batch.length} rows, ${buf.retryCount} retries): ${err.message}`);
      await recordDeadLetter(table, batch.length, err.message, batch.slice(0, 3));
      buf.stats.deadLettered += batch.length;
      buf.retryCount = 0;
    } else {
      // Put back for retry
      console.warn(`[flush] Retry ${buf.retryCount}/${MAX_RETRIES} for ${table} (${batch.length} rows): ${err.message}`);
      buf.rows.unshift(...batch);
    }
  }
}

async function flushLegacy(): Promise<void> {
  if (legacyBuffer.length === 0) return;
  const batch = legacyBuffer.splice(0);
  try {
    for (let i = 0; i < batch.length; i += MAX_CHUNK) {
      const chunk = batch.slice(i, i + MAX_CHUNK);
      await batchInsert(chunk);
    }
    legacyStats.inserted += batch.length;
    legacyStats.flushes++;
  } catch (err: any) {
    legacyStats.errors++;
    console.error(`[flush] Legacy insert failed (${batch.length} rows): ${err.message}`);
    if (legacyBuffer.length < 10_000) {
      legacyBuffer.unshift(...batch.slice(0, 10_000 - legacyBuffer.length));
    }
  }
}

// ─── Replay from disk buffer ──────────────────────────────────────────────────

export async function replayBatch(table: string, rows: TableRow[]): Promise<boolean> {
  try {
    for (let i = 0; i < rows.length; i += MAX_CHUNK) {
      const chunk = rows.slice(i, i + MAX_CHUNK);
      await copyInsert(table, chunk);
    }
    return true;
  } catch (err: any) {
    console.error(`[flush] Replay failed for ${table} (${rows.length} rows): ${err.message}`);
    return false;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startLegacyFlush(intervalMs: number): void {
  legacyTimer = setInterval(flushLegacy, intervalMs);
}

export async function flushAll(): Promise<void> {
  const promises = [...tableBuffers.keys()].map(t => flushTable(t));
  promises.push(flushLegacy());
  await Promise.allSettled(promises);
}

export function stopAll(): void {
  for (const buf of tableBuffers.values()) {
    if (buf.timer) clearInterval(buf.timer);
  }
  if (legacyTimer) clearInterval(legacyTimer);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface FlushStats {
  perTable: {
    table: string;
    bufferSize: number;
    inserted: number;
    errors: number;
    flushes: number;
    lastFlushMs: number;
    deadLettered: number;
  }[];
  legacy: {
    bufferSize: number;
    inserted: number;
    errors: number;
    flushes: number;
  };
  totals: {
    bufferSize: number;
    inserted: number;
    errors: number;
    msgPerSec: number;
  };
}

let lastStatsTime = Date.now();
let lastInserted = 0;

export function getFlushStats(): FlushStats {
  const perTable = [...tableBuffers.values()].map(buf => ({
    table: buf.table,
    bufferSize: buf.rows.length,
    inserted: buf.stats.inserted,
    errors: buf.stats.errors,
    flushes: buf.stats.flushes,
    lastFlushMs: buf.stats.lastFlushMs,
    deadLettered: buf.stats.deadLettered,
  }));

  let totalInserted = perTable.reduce((s, t) => s + t.inserted, 0) + legacyStats.inserted;
  let totalBuffer = perTable.reduce((s, t) => s + t.bufferSize, 0) + legacyBuffer.length;
  let totalErrors = perTable.reduce((s, t) => s + t.errors, 0) + legacyStats.errors;

  const now = Date.now();
  const elapsedS = (now - lastStatsTime) / 1000;
  const msgPerSec = elapsedS > 0 ? (totalInserted - lastInserted) / elapsedS : 0;
  lastStatsTime = now;
  lastInserted = totalInserted;

  return {
    perTable,
    legacy: {
      bufferSize: legacyBuffer.length,
      inserted: legacyStats.inserted,
      errors: legacyStats.errors,
      flushes: legacyStats.flushes,
    },
    totals: {
      bufferSize: totalBuffer,
      inserted: totalInserted,
      errors: totalErrors,
      msgPerSec: Math.round(msgPerSec * 100) / 100,
    },
  };
}

/**
 * Get total buffer fill percentage (across all tables).
 */
export function getBufferFillPercent(): number {
  let total = 0;
  for (const buf of tableBuffers.values()) {
    total += buf.rows.length;
  }
  total += legacyBuffer.length;
  // Consider 50k as 100%
  return Math.min(100, (total / 50_000) * 100);
}
