/**
 * FDA CBER HCTERS (Human Cell and Tissue Establishment Registration) Scraper.
 * Queries the HCT/P public registration database for cell and gene therapy sites.
 * A positive match is a strong signal for AAV / Lentivirus / Cell Therapy modality.
 */

import * as cheerio from 'cheerio';
import type { HctersResult } from '@p1/shared';

const HCTERS_URL = 'https://www.accessdata.fda.gov/scripts/cber/CFAppsPub/tiss/index.cfm';
const TIMEOUT_MS = 10_000;

export async function queryHcters(establishmentName: string): Promise<HctersResult> {
  try {
    const body = new URLSearchParams({
      fuseAction: 'fuse_DisplayResults',
      EstablishmentName: establishmentName,
    });

    const resp = await fetch(HCTERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[hcters-api] HTTP ${resp.status} for "${establishmentName}"`);
      return { hasRegistration: false };
    }

    const html = await resp.text();
    return parseHctersHtml(html, establishmentName);
  } catch (err: any) {
    console.warn(`[hcters-api] Error querying "${establishmentName}":`, err.message);
    return { hasRegistration: false };
  }
}

function parseHctersHtml(html: string, searchName: string): HctersResult {
  const $ = cheerio.load(html);
  const details: string[] = [];

  // Look for result rows in any table on the page
  $('table').each((_, table) => {
    $(table).find('tr').each((__, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;

      const text = $(row).text().trim();
      if (!text) return;

      // Check if this row contains establishment data (not headers/navigation)
      const cellTexts = cells.map((___, cell) => $(cell).text().trim()).get();
      const hasContent = cellTexts.some(t => t.length > 3 && !t.startsWith('Page'));
      if (hasContent) {
        details.push(cellTexts.filter(t => t).join(' | '));
      }
    });
  });

  // Also check for "no records" messages
  const pageText = $('body').text().toLowerCase();
  const noResults = pageText.includes('no records') ||
    pageText.includes('no results') ||
    pageText.includes('0 records');

  if (noResults || details.length === 0) {
    return { hasRegistration: false, establishmentName: searchName };
  }

  return {
    hasRegistration: true,
    establishmentName: searchName,
    details: details.slice(0, 10), // cap at 10 entries
  };
}
