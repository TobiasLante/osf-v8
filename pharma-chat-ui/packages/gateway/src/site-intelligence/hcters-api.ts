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

  // The HCTERS results page shows actual establishment names in a results table.
  // The search form page (no results) shows "Enter Query Criteria" and form fields.
  // Key: if the page still shows the search form, there are NO results.
  const pageText = $('body').text();

  // Detect if this is the search form (no results) vs actual results
  const isSearchForm = pageText.includes('Enter Query Criteria') ||
    pageText.includes('Select the parameters');
  const hasNoResults = pageText.toLowerCase().includes('no records') ||
    pageText.toLowerCase().includes('no results') ||
    pageText.toLowerCase().includes('0 records') ||
    pageText.toLowerCase().includes('no establishments found');

  // Look for actual establishment data — must contain the search name
  const searchLower = searchName.toLowerCase();
  let foundMatch = false;
  const details: string[] = [];

  // Results appear in a table with establishment names
  $('table').each((_, table) => {
    $(table).find('tr').each((__, row) => {
      const rowText = $(row).text().toLowerCase();
      // Only count rows that actually contain the search term
      if (rowText.includes(searchLower) || rowText.includes(searchLower.split(' ')[0].toLowerCase())) {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const cellTexts = cells.map((___, cell) => $(cell).text().trim()).get()
            .filter(t => t.length > 2);
          if (cellTexts.length > 0) {
            foundMatch = true;
            details.push(cellTexts.join(' | '));
          }
        }
      }
    });
  });

  if (!foundMatch || isSearchForm || hasNoResults) {
    return { hasRegistration: false, establishmentName: searchName };
  }

  return {
    hasRegistration: true,
    establishmentName: searchName,
    details: details.slice(0, 10),
  };
}
