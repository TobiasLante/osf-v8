/**
 * Website Enrichment — fetches a company website and uses LLM to extract
 * structured pharma manufacturing intelligence (modalities, scale, cGMP, partnerships).
 * This is the primary data source for CDMOs where FDA/CT.gov APIs return nothing.
 */

import * as cheerio from 'cheerio';
import type { WebsiteEnrichment } from '@p1/shared';
import { llmExtractJson } from './llm-client';

const TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 8000;
const SUBPAGES = ['/about', '/capabilities', '/services', '/technology', '/manufacturing'];

export async function enrichFromWebsite(
  companyName: string,
  websiteUrl?: string,
): Promise<WebsiteEnrichment | null> {
  try {
    const baseUrl = websiteUrl || guessWebsiteUrl(companyName);
    if (!baseUrl) return null;

    // Fetch homepage + up to 2 subpages
    const texts = await fetchPageTexts(baseUrl);
    if (!texts.length) return null;

    const combined = texts.join('\n\n---\n\n').slice(0, MAX_TEXT_CHARS);
    return await extractWithLlm(combined, companyName);
  } catch (err: any) {
    console.warn(`[website-enrichment] Error for "${companyName}":`, err.message);
    return null;
  }
}

function guessWebsiteUrl(companyName: string): string | null {
  // Common patterns: "Matica Biotechnology" -> "maticabio.com", "TriLink BioTechnologies" -> "trilinkbiotech.com"
  const cleaned = companyName
    .toLowerCase()
    .replace(/[,.\s]+inc\.?$/i, '')
    .replace(/[,.\s]+llc\.?$/i, '')
    .replace(/[,.\s]+ltd\.?$/i, '')
    .trim();

  // Try with and without spaces
  const variants = [
    cleaned.replace(/\s+/g, ''),           // maticabiotechnology
    cleaned.replace(/\s+/g, '').replace('ology', ''),  // maticabiotech
    cleaned.replace(/\s+/g, ''),           // direct
  ];

  // We'll try the first variant — the fetch will tell us if it works
  return `https://${variants[0]}.com`;
}

async function fetchPageTexts(baseUrl: string): Promise<string[]> {
  const texts: string[] = [];

  // Fetch homepage
  const homeText = await fetchAndExtractText(baseUrl);
  if (homeText) texts.push(homeText);

  // Try subpages (stop after 2 successful ones)
  let found = 0;
  for (const sub of SUBPAGES) {
    if (found >= 2) break;
    const url = baseUrl.replace(/\/$/, '') + sub;
    const text = await fetchAndExtractText(url);
    if (text && text.length > 200) {
      texts.push(text);
      found++;
    }
  }

  return texts;
}

async function fetchAndExtractText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Process1st/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await resp.text();
    return htmlToText(html);
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, noscript, iframe, svg').remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  // Get text from main content areas first, fallback to body
  let text = '';
  const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.main-content'];
  for (const sel of mainSelectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 200) {
      text = el.text();
      break;
    }
  }
  if (!text) text = $('body').text();

  // Clean up whitespace
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 5000);
}

async function extractWithLlm(
  websiteText: string,
  companyName: string,
): Promise<WebsiteEnrichment | null> {
  const prompt = `Extract pharmaceutical manufacturing intelligence from this company website text for "${companyName}".

Return a JSON object with these fields:
- modalities: array of molecule types manufactured (use these exact terms where applicable: "mAb", "AAV", "Lentivirus", "mRNA", "pDNA", "ADC", "Oligonucleotide")
- scale: production scale if mentioned (e.g. "500L", "50L to 2000L", "clinical to commercial")
- cgmpStatus: GMP classification if mentioned (e.g. "cGMP", "R&D only", "clinical GMP", "commercial GMP")
- partnerships: array of partner/vendor names mentioned (e.g. "Sartorius", "G-CON", "Texas A&M")
- equipmentMentions: array of specific equipment brands or types mentioned (e.g. "Biostat STR", "CIMmultus", "AKTA")

Return ONLY valid JSON, no markdown, no explanation. If a field has no data, use an empty array or null.

Website text:
${websiteText}`;

  try {
    const parsed = await llmExtractJson<any>(prompt);
    if (!parsed) return fallbackExtraction(websiteText);

    return {
      modalities: Array.isArray(parsed.modalities) ? parsed.modalities : [],
      scale: parsed.scale || undefined,
      cgmpStatus: parsed.cgmpStatus || undefined,
      partnerships: Array.isArray(parsed.partnerships) ? parsed.partnerships : [],
      equipmentMentions: Array.isArray(parsed.equipmentMentions) ? parsed.equipmentMentions : [],
    };
  } catch (err: any) {
    console.warn('[website-enrichment] LLM extraction failed:', err.message);
    return fallbackExtraction(websiteText);
  }
}

/** Keyword-based fallback when LLM is not available */
function fallbackExtraction(text: string): WebsiteEnrichment {
  const lower = text.toLowerCase();

  const modalityKeywords: Record<string, string> = {
    'monoclonal antibod': 'mAb', 'mab ': 'mAb',
    'aav': 'AAV', 'adeno-associated': 'AAV',
    'lentivir': 'Lentivirus', 'car-t': 'Lentivirus',
    'mrna': 'mRNA', 'in vitro transcription': 'mRNA', 'ivt': 'mRNA',
    'plasmid': 'pDNA', 'pdna': 'pDNA',
    'antibody-drug conjugate': 'ADC', 'adc': 'ADC',
    'oligonucleotide': 'Oligonucleotide',
  };

  const modalities = new Set<string>();
  for (const [kw, mod] of Object.entries(modalityKeywords)) {
    if (lower.includes(kw)) modalities.add(mod);
  }

  const vendorKeywords = ['sartorius', 'cytiva', 'thermo fisher', 'milliporesigma', 'repligen', 'g-con', 'polyplus'];
  const partnerships = vendorKeywords.filter(v => lower.includes(v)).map(v =>
    v.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
  );

  return {
    modalities: Array.from(modalities),
    cgmpStatus: lower.includes('cgmp') || lower.includes('gmp') ? 'cGMP' : undefined,
    partnerships,
    equipmentMentions: [],
  };
}
