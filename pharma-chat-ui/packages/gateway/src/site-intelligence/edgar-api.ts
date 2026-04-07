/**
 * SEC EDGAR Full-Text Search API.
 * Searches SEC filings (10-K, 10-Q, 8-K) for mentions of a company name.
 * For CDMOs this reveals client relationships that no other public source exposes.
 */

import type { EdgarResult } from '@p1/shared';

const EDGAR_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_FILING_BASE = 'https://www.sec.gov/Archives/edgar/data';
const USER_AGENT = 'Process1st/1.0 (contact@process-1st.com)';
const TIMEOUT_MS = 15_000;
const MAX_FULL_FETCH = 5;
const DELAY_BETWEEN_REQUESTS_MS = 250;

export async function queryEdgar(companyName: string): Promise<EdgarResult | null> {
  // Try full name first, then shorter variants
  const variants = [companyName, ...generateShortNames(companyName)];

  for (const name of variants) {
    const result = await queryEdgarSingle(name);
    if (result && result.totalMentions > 0) return result;
  }

  return { totalMentions: 0, filings: [] };
}

function generateShortNames(name: string): string[] {
  const shorts: string[] = [];
  // "Matica Biotechnology" → "Matica Bio"
  const cleaned = name.replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?)$/i, '').trim();
  if (cleaned !== name) shorts.push(cleaned);
  // Try dropping long suffixes: "Biotechnology" → "Bio", "Therapeutics" → "Ther"
  const shortened = cleaned
    .replace(/Biotechnology/i, 'Bio')
    .replace(/BioTechnologies/i, 'Biotech')
    .replace(/Therapeutics/i, 'Ther')
    .replace(/Pharmaceuticals/i, 'Pharma');
  if (shortened !== cleaned) shorts.push(shortened);
  return shorts.filter((s, i, a) => a.indexOf(s) === i);
}

async function queryEdgarSingle(companyName: string): Promise<EdgarResult | null> {
  try {
    const query = encodeURIComponent(`"${companyName}"`);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const startDate = twoYearsAgo.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    const url = `${EDGAR_SEARCH_URL}?q=${query}&forms=10-K,10-Q,8-K,S-1&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[edgar-api] HTTP ${resp.status} for "${companyName}"`);
      return null;
    }

    const data: any = await resp.json();
    const hits = data.hits?.hits || [];
    const total = data.hits?.total?.value || 0;

    if (total === 0) return { totalMentions: 0, filings: [] };

    // Extract metadata from hits
    const filings = hits.slice(0, 10).map((h: any) => ({
      filer: h._source?.display_names?.[0] || 'Unknown',
      form: h._source?.form || h._source?.root_forms?.[0] || 'N/A',
      date: h._source?.file_date || 'N/A',
      excerpt: '', // filled below for <=5 hits
      _id: h._id,
    }));

    // For small result sets, fetch the actual documents to extract excerpts
    if (total <= MAX_FULL_FETCH) {
      for (let i = 0; i < filings.length; i++) {
        const filing = filings[i];
        try {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
          const excerpt = await fetchFilingExcerpt(filing._id, companyName);
          filing.excerpt = excerpt;
        } catch {
          filing.excerpt = '(document not accessible)';
        }
      }
    }

    // Clean up internal fields
    const cleanFilings = filings.map(({ _id, ...rest }: any) => rest);

    return { totalMentions: total, filings: cleanFilings };
  } catch (err: any) {
    console.warn(`[edgar-api] Error querying "${companyName}":`, err.message);
    return null;
  }
}

async function fetchFilingExcerpt(docId: string, companyName: string): Promise<string> {
  // docId format: "0001234567-26-012345:filename.htm"
  const [accession, filename] = docId.split(':');
  if (!accession || !filename) return '';

  // Build SEC URL from accession number
  const parts = accession.split('-');
  if (parts.length < 3) return '';
  const cik = parts[0].replace(/^0+/, '');
  const accessionClean = accession.replace(/-/g, '');
  const url = `${EDGAR_FILING_BASE}/${cik}/${accessionClean}/${filename}`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) return '';

  const html = await resp.text();
  // Strip HTML tags to get plain text
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Find the company name mention and extract surrounding context
  const searchLower = companyName.toLowerCase();
  const textLower = text.toLowerCase();
  const idx = textLower.indexOf(searchLower);

  if (idx === -1) return '(mentioned in filing metadata)';

  const start = Math.max(0, idx - 200);
  const end = Math.min(text.length, idx + companyName.length + 200);
  return '...' + text.slice(start, end).trim() + '...';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
