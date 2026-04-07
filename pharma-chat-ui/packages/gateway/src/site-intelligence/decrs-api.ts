/**
 * FDA DECRS (Drug Establishment Current Registration Site) Scraper.
 * Queries accessdata.fda.gov to find registered drug manufacturing facilities.
 * Returns FEI number, business operations, address for a given firm name.
 */

import * as cheerio from 'cheerio';
import type { DecrsResult } from '@p1/shared';

const DECRS_URL = 'https://www.accessdata.fda.gov/scripts/cder/drls/getdrls.cfm';
const TIMEOUT_MS = 10_000;

export async function queryDecrs(firmName: string): Promise<DecrsResult[]> {
  try {
    const body = new URLSearchParams({ firm_name: firmName, Submit: 'Submit' });

    const resp = await fetch(DECRS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[decrs-api] HTTP ${resp.status} for "${firmName}"`);
      return [];
    }

    const html = await resp.text();
    return parseDecrsHtml(html);
  } catch (err: any) {
    console.warn(`[decrs-api] Error querying "${firmName}":`, err.message);
    return [];
  }
}

function parseDecrsHtml(html: string): DecrsResult[] {
  const $ = cheerio.load(html);
  const results: DecrsResult[] = [];

  // The DECRS results page has a DataTable with columns:
  // Firm Name | FDA Establishment Identifier | DUNS | Business Operations | Address | Expiration Date
  const rows = $('table.dataTable tbody tr, table#DataTables_Table_0 tbody tr');

  if (rows.length === 0) {
    // Try a more general approach — find any table with th containing "Firm Name"
    $('table').each((_, table) => {
      const headers = $(table).find('th').map((__, th) => $(th).text().trim()).get();
      if (!headers.some(h => h.includes('Firm Name'))) return;

      $(table).find('tbody tr, tr').each((__, row) => {
        const cells = $(row).find('td');
        if (cells.length < 4) return;

        const result = extractFromCells($, cells);
        if (result) results.push(result);
      });
    });

    return results;
  }

  rows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;

    const result = extractFromCells($, cells);
    if (result) results.push(result);
  });

  return results;
}

function extractFromCells($: cheerio.CheerioAPI, cells: cheerio.Cheerio<any>): DecrsResult | null {
  const firmName = $(cells[0]).text().trim();
  if (!firmName) return null;

  const feiNumber = $(cells[1]).text().trim();
  const dunsNumber = $(cells[2]).text().trim() || undefined;

  // Business Operations can contain <br /> separated values
  const bizOpsHtml = $(cells[3]).html() || '';
  const businessOperations = bizOpsHtml
    .split(/<br\s*\/?>/i)
    .map(s => s.replace(/<[^>]*>/g, '').trim())
    .filter(s => s && s !== ';')
    .map(s => s.replace(/;\s*$/, '').trim());

  const address = $(cells[4]).text().trim();
  const expirationDate = $(cells[5])?.text().trim() || undefined;

  return {
    firmName,
    feiNumber,
    dunsNumber,
    businessOperations,
    address,
    expirationDate,
  };
}
