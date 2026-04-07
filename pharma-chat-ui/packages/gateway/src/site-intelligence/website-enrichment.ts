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
const SUBPAGES = ['/about', '/about-us', '/capabilities', '/services', '/technology', '/manufacturing', '/facilities', '/our-services', '/what-we-do'];

export async function enrichFromWebsite(
  companyName: string,
  websiteUrl?: string,
): Promise<WebsiteEnrichment | null> {
  try {
    // Try multiple URL variants
    const urls = websiteUrl ? [websiteUrl] : guessWebsiteUrls(companyName);
    let texts: string[] = [];

    for (const url of urls) {
      texts = await fetchPageTexts(url);
      if (texts.length > 0) {
        console.log(`[website-enrichment] Success with ${url}`);
        break;
      }
    }
    if (!texts.length) return null;

    const combined = texts.join('\n\n---\n\n').slice(0, MAX_TEXT_CHARS);
    return await extractWithLlm(combined, companyName);
  } catch (err: any) {
    console.warn(`[website-enrichment] Error for "${companyName}":`, err.message);
    return null;
  }
}

function guessWebsiteUrls(companyName: string): string[] {
  const cleaned = companyName
    .toLowerCase()
    .replace(/[,.\s]+(inc|llc|ltd|corp)\.?\s*$/i, '')
    .trim();

  const words = cleaned.split(/\s+/);
  const variants = [
    words[0] + 'bio',                                      // maticabio (most common CDMO pattern)
    cleaned.replace(/\s+/g, '').replace('ology', ''),     // maticabiotech
    cleaned.replace(/\s+/g, '').replace('ologies', ''),   // trilinkbiotech
    cleaned.replace(/\s+/g, ''),                          // maticabiotechnology
    words[0] + 'biotech',                                  // maticabiotech
    words[0],                                              // matica
    words.join(''),                                        // fallback
  ];

  const unique = [...new Set(variants)].filter(v => v.length > 3);
  return unique.map(v => `https://${v}.com`);
}

async function fetchPageTexts(baseUrl: string): Promise<string[]> {
  const homeText = await fetchAndExtractText(baseUrl);
  if (!homeText) return [];

  const texts = [homeText];
  texts.push(...(await fetchSubpages(baseUrl)));
  return texts;
}

async function fetchSubpages(baseUrl: string): Promise<string[]> {
  const texts: string[] = [];
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
  const prompt = `You are a pharma industry analyst. Extract ALL manufacturing intelligence from this company website for "${companyName}".

Return a JSON object with these fields — extract as much as possible, do NOT leave fields empty if the text contains relevant information:

- modalities: array of ALL molecule types (use exact terms: "mAb", "AAV", "Lentivirus", "mRNA", "pDNA", "ADC", "Oligonucleotide", "Oncolytic Virus", "Cell Therapy", "Vaccine")
- scale: production scale (e.g. "500L Fed Batch", "50L to 2000L", "clinical to commercial scale")
- cgmpStatus: GMP classification (e.g. "cGMP", "cGMP clinical and commercial", "R&D only")
- accountType: one of "CDMO", "Innovator", "Hybrid" — look for keywords like "contract", "CDMO", "CMO", "outsourced manufacturing" for CDMO; "proprietary pipeline" for Innovator
- parentCompany: parent company name if mentioned (e.g. "CHA Biotech")
- facilityDetails: any facility info (square footage, number of suites/cleanrooms, location, year built)
- partnerships: array of ALL partner/vendor/client names mentioned (equipment vendors like Sartorius, clients, research partners, investors)
- equipmentMentions: array of specific equipment brands or types (e.g. "Biostat STR", "CIMmultus", "single-use bioreactors", "modular cleanrooms")
- keyDifferentiators: array of unique capabilities or technologies mentioned (e.g. "MatiMAX proprietary cell line", "single-use platform")
- recentNews: array of any news/press release headlines visible on the page

Return ONLY valid JSON. Extract aggressively — more data is better.

Website text:
${websiteText}`;

  try {
    const parsed = await llmExtractJson<any>(prompt);
    if (!parsed) return fallbackExtraction(websiteText);

    return {
      modalities: Array.isArray(parsed.modalities) ? parsed.modalities : [],
      scale: parsed.scale || undefined,
      cgmpStatus: parsed.cgmpStatus || undefined,
      accountType: parsed.accountType || undefined,
      parentCompany: parsed.parentCompany || undefined,
      facilityDetails: parsed.facilityDetails || undefined,
      partnerships: Array.isArray(parsed.partnerships) ? parsed.partnerships : [],
      equipmentMentions: Array.isArray(parsed.equipmentMentions) ? parsed.equipmentMentions : [],
      keyDifferentiators: Array.isArray(parsed.keyDifferentiators) ? parsed.keyDifferentiators : [],
      recentNews: Array.isArray(parsed.recentNews) ? parsed.recentNews : [],
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
