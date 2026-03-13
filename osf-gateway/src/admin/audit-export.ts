/**
 * Audit Export — CSV/JSON download for compliance.
 * Streams results in 1000-row pages to avoid loading full result set into memory.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { logger } from '../logger';

const router = Router();
const PAGE_SIZE = 1000;
const MAX_RANGE_DAYS = 90;

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function validateDates(from: string | undefined, to: string | undefined): { fromDate: Date; toDate: Date } | { error: string } {
  if (!from) {
    return { error: 'Missing required parameter: from' };
  }

  const fromDate = new Date(from);
  if (isNaN(fromDate.getTime())) {
    return { error: 'Invalid date format for "from". Use ISO 8601 (e.g. 2026-01-01)' };
  }

  const toDate = to ? new Date(to) : new Date();
  if (isNaN(toDate.getTime())) {
    return { error: 'Invalid date format for "to". Use ISO 8601 (e.g. 2026-03-13)' };
  }

  if (fromDate > toDate) {
    return { error: '"from" must be before "to"' };
  }

  const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    return { error: `Date range exceeds maximum of ${MAX_RANGE_DAYS} days` };
  }

  return { fromDate, toDate };
}

// GET /admin/audit/export
router.get('/export', async (req: Request, res: Response) => {
  const format = (req.query.format as string || 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'json') {
    res.status(400).json({ error: 'Invalid format. Use "csv" or "json"' });
    return;
  }

  const validation = validateDates(req.query.from as string, req.query.to as string);
  if ('error' in validation) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const { fromDate, toDate } = validation;
  const action = req.query.action as string | undefined;
  const user = req.query.user as string | undefined;
  const tool = req.query.tool as string | undefined;

  // Build query with optional filters
  const conditions: string[] = ['created_at >= $1', 'created_at <= $2'];
  const params: any[] = [fromDate.toISOString(), toDate.toISOString()];
  let idx = 3;

  if (action) {
    conditions.push(`action = $${idx++}`);
    params.push(action);
  }
  if (user) {
    conditions.push(`user_email ILIKE $${idx++}`);
    params.push(`%${user}%`);
  }
  if (tool) {
    conditions.push(`tool_name ILIKE $${idx++}`);
    params.push(`%${tool}%`);
  }

  const whereClause = conditions.join(' AND ');

  // Format date range for filename
  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = toDate.toISOString().split('T')[0];
  const ext = format === 'csv' ? 'csv' : 'json';
  const filename = `audit-export-${fromStr}_${toStr}.${ext}`;

  try {
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // UTF-8 BOM for Excel compatibility
      res.write('\uFEFF');
      res.write('id,created_at,user_id,user_email,action,tool_name,tool_category,source,ip_address,detail\n');

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await pool.query(
          `SELECT id, created_at, user_id, user_email, action, tool_name, tool_category, source, ip_address, detail
           FROM audit_log WHERE ${whereClause}
           ORDER BY created_at ASC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          params,
        );

        for (const row of result.rows) {
          const line = [
            row.id,
            row.created_at?.toISOString?.() || row.created_at || '',
            escapeCSV(row.user_id || ''),
            escapeCSV(row.user_email || ''),
            escapeCSV(row.action || ''),
            escapeCSV(row.tool_name || ''),
            escapeCSV(row.tool_category || ''),
            escapeCSV(row.source || ''),
            escapeCSV(row.ip_address || ''),
            escapeCSV(row.detail || ''),
          ].join(',');
          res.write(line + '\n');
        }

        hasMore = result.rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      res.end();
    } else {
      // JSON format — stream as array
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      res.write('[\n');
      let offset = 0;
      let hasMore = true;
      let first = true;

      while (hasMore) {
        const result = await pool.query(
          `SELECT id, created_at, user_id, user_email, action, tool_name, tool_category, source, ip_address, detail
           FROM audit_log WHERE ${whereClause}
           ORDER BY created_at ASC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
          params,
        );

        for (const row of result.rows) {
          if (!first) res.write(',\n');
          first = false;
          res.write(JSON.stringify(row));
        }

        hasMore = result.rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      res.write('\n]\n');
      res.end();
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Audit export failed');
    // If headers already sent, we can't change status
    if (!res.headersSent) {
      res.status(500).json({ error: 'Audit export failed' });
    } else {
      res.end();
    }
  }
});

export default router;
