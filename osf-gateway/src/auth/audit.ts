/**
 * Governance: Buffered audit logger.
 * Fire-and-forget audit entries. Flushes to DB every 1s or when buffer hits 50 entries.
 */

import { pool } from '../db/pool';
import { logger } from '../logger';

interface AuditEntry {
  user_id: string;
  user_email?: string;
  action: string;
  tool_name?: string;
  tool_category?: string;
  source?: string;
  ip_address?: string;
  detail?: string;
}

const buffer: AuditEntry[] = [];
const FLUSH_SIZE = 50;
const FLUSH_INTERVAL_MS = 1000;

let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);

  try {
    // Build multi-row INSERT
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const e of batch) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(
        e.user_id,
        e.user_email || null,
        e.action,
        e.tool_name || null,
        e.tool_category || null,
        e.source || null,
        e.ip_address || null,
        (e.detail || '').slice(0, 200),
      );
    }

    await pool.query(
      `INSERT INTO audit_log (user_id, user_email, action, tool_name, tool_category, source, ip_address, detail)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  } catch (err: any) {
    // Don't lose entries — put them back (but cap to prevent memory leak)
    if (buffer.length < 500) {
      buffer.unshift(...batch);
    }
    logger.warn({ err: err.message, dropped: batch.length }, 'Audit flush failed');
  }
}

/** Log an audit entry (fire-and-forget, buffered). */
export function audit(entry: AuditEntry): void {
  buffer.push(entry);

  if (buffer.length >= FLUSH_SIZE) {
    flush().catch(() => {});
  }
}

/** Start the periodic flush timer. */
export function startAuditFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

/** Stop the flush timer and flush remaining entries. */
export async function stopAuditFlush(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
}
