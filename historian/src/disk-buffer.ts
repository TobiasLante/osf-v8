// Historian v2 — Disk Buffer for crash recovery
// Append-only JSONL file, replayed on startup

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { TableRow } from './db.js';

const BUFFER_DIR = process.env.HISTORIAN_BUFFER_DIR || '/tmp/historian-buffer';
const BUFFER_FILE = path.join(BUFFER_DIR, 'pending.jsonl');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB safety limit

export interface BufferedBatch {
  table: string;
  rows: TableRow[];
  ts: string; // ISO timestamp when buffered
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initDiskBuffer(): void {
  if (!fs.existsSync(BUFFER_DIR)) {
    fs.mkdirSync(BUFFER_DIR, { recursive: true });
  }
  console.log(`[disk-buffer] Initialized at ${BUFFER_DIR}`);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function appendBatch(table: string, rows: TableRow[]): void {
  if (rows.length === 0) return;

  // Safety: don't grow beyond limit
  try {
    const stat = fs.statSync(BUFFER_FILE);
    if (stat.size > MAX_FILE_SIZE) {
      console.error(`[disk-buffer] File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB, skipping write`);
      return;
    }
  } catch {
    // File doesn't exist yet — fine
  }

  const batch: BufferedBatch = {
    table,
    rows,
    ts: new Date().toISOString(),
  };

  try {
    fs.appendFileSync(BUFFER_FILE, JSON.stringify(batch) + '\n');
  } catch (err: any) {
    console.error(`[disk-buffer] Write failed: ${err.message}`);
  }
}

// ─── Replay ───────────────────────────────────────────────────────────────────

export async function replayPendingBatches(): Promise<BufferedBatch[]> {
  if (!fs.existsSync(BUFFER_FILE)) {
    return [];
  }

  const batches: BufferedBatch[] = [];

  const stream = fs.createReadStream(BUFFER_FILE, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const batch = JSON.parse(line) as BufferedBatch;
      batches.push(batch);
    } catch {
      console.warn(`[disk-buffer] Skipping corrupt line`);
    }
  }

  if (batches.length > 0) {
    console.log(`[disk-buffer] Found ${batches.length} pending batches for replay`);
  }

  return batches;
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export function clearBuffer(): void {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      fs.unlinkSync(BUFFER_FILE);
    }
  } catch (err: any) {
    console.error(`[disk-buffer] Clear failed: ${err.message}`);
  }
}

// ─── Remove specific batch (after successful flush) ───────────────────────────

/**
 * Rewrites the buffer file excluding already-flushed batches.
 * Called after successful replay to remove processed entries.
 */
export function removeFlushedBatches(flushedCount: number): void {
  if (!fs.existsSync(BUFFER_FILE)) return;

  try {
    const content = fs.readFileSync(BUFFER_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    if (flushedCount >= lines.length) {
      // All flushed — remove file
      fs.unlinkSync(BUFFER_FILE);
    } else {
      // Keep remaining lines
      const remaining = lines.slice(flushedCount);
      fs.writeFileSync(BUFFER_FILE, remaining.join('\n') + '\n');
    }
  } catch (err: any) {
    console.error(`[disk-buffer] Remove flushed failed: ${err.message}`);
  }
}
