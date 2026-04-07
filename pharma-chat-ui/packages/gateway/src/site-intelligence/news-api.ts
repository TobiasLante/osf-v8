/**
 * News/Press Release Enrichment — uses Google News RSS to find press releases
 * and industry articles about a company. Then fetches the top articles and
 * uses LLM to extract structured intelligence (partnerships, facility details, etc.)
 *
 * This closes the gap between website-only data and what a human analyst finds
 * by reading BioProcess Insider, PR Newswire, Contract Pharma, etc.
 */

import * as cheerio from 'cheerio';
import { llmExtractJson } from './llm-client';

const TIMEOUT_MS = 10_000;
const MAX_ARTICLES_TO_FETCH = 5;
const MAX_ARTICLE_TEXT = 3000;

export interface NewsEnrichment {
  totalArticles: number;
  parentCompany?: string;
  partnerships: string[];
  facilityDetails?: string;
  scale?: string;
  equipmentVendors: string[];
  keyFacts: string[];
  articles: Array<{ title: string; date: string; source: string }>;
}

export async function enrichFromNews(companyName: string): Promise<NewsEnrichment | null> {
  try {
    // Fetch Google News RSS
    const query = encodeURIComponent(`"${companyName}"`);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const resp = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Process1st/1.0)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[news-api] RSS fetch failed: HTTP ${resp.status}`);
      return null;
    }

    const xml = await resp.text();
    const articles = parseRssArticles(xml);
    console.log(`[news-api] Found ${articles.length} articles for "${companyName}"`);

    if (articles.length === 0) return null;

    // Fetch top articles for content extraction
    const articleTexts: string[] = [];
    for (const article of articles.slice(0, MAX_ARTICLES_TO_FETCH)) {
      const text = await fetchArticleText(article.link);
      if (text && text.length > 100) {
        articleTexts.push(`[${article.title}]\n${text}`);
      }
    }

    // LLM extraction from article texts
    const intelligence = articleTexts.length > 0
      ? await extractIntelligence(companyName, articleTexts, articles)
      : buildFromTitlesOnly(companyName, articles);

    return intelligence;
  } catch (err: any) {
    console.warn(`[news-api] Error for "${companyName}":`, err.message);
    return null;
  }
}

interface RssArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

function parseRssArticles(xml: string): RssArticle[] {
  const articles: RssArticle[] = [];
  const $ = cheerio.load(xml, { xmlMode: true });

  $('item').each((_, item) => {
    let title = $(item).find('title').text().trim();
    // Decode HTML entities + normalize curly quotes to ASCII
    title = title
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

    const link = $(item).find('link').text().trim();
    const pubDate = $(item).find('pubDate').text().trim();

    // Extract source from title: "Title - Source Name"
    const sourceSplit = title.split(' - ');
    const source = sourceSplit.length > 1 ? sourceSplit[sourceSplit.length - 1].trim() : '';
    const cleanTitle = sourceSplit.length > 1 ? sourceSplit.slice(0, -1).join(' - ').trim() : title;

    articles.push({ title: cleanTitle, link, pubDate, source });
  });

  return articles;
}

async function fetchArticleText(url: string): Promise<string | null> {
  try {
    // Google News redirects through their servers — follow the redirect
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Process1st/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, noscript, iframe, svg, aside').remove();

    // Try article-specific selectors first
    let text = '';
    const selectors = ['article', '.article-body', '.entry-content', '.post-content', 'main', '[role="main"]'];
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) {
        text = el.text();
        break;
      }
    }
    if (!text) text = $('body').text();

    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ARTICLE_TEXT);
  } catch {
    return null;
  }
}

async function extractIntelligence(
  companyName: string,
  articleTexts: string[],
  allArticles: RssArticle[],
): Promise<NewsEnrichment> {
  const combined = articleTexts.join('\n\n---\n\n').slice(0, 8000);

  const prompt = `You are a pharma industry analyst. Extract ALL intelligence about "${companyName}" from these press releases and news articles.

Return a JSON object:
- parentCompany: parent company name (e.g. "CHA Biotech" or "Maravai LifeSciences") or null
- partnerships: array of ALL partner/client/collaborator company names mentioned
- facilityDetails: facility info string (location, square footage, cleanroom type, year opened, number of suites)
- scale: manufacturing scale mentioned (e.g. "500L Fed Batch", "up to 2000L")
- equipmentVendors: array of equipment vendor names mentioned (Sartorius, Cytiva, Thermo Fisher, etc.)
- keyFacts: array of 3-5 key facts not captured in other fields (leadership changes, revenue milestones, expansion plans, regulatory events)

Return ONLY valid JSON. Extract aggressively.

Articles:
${combined}`;

  const parsed = await llmExtractJson<any>(prompt);

  // Always extract from titles too (more reliable than LLM for parent/partners)
  const titleParent = extractParentFromTitles(companyName, allArticles);
  const titlePartners = extractPartnersFromTitles(companyName, allArticles);
  const titleVendors = extractVendorsFromTitles(allArticles);

  // Merge: title-based > LLM-based for structured data
  const llmPartners = Array.isArray(parsed?.partnerships) ? parsed.partnerships : [];
  const allPartners = [...new Set([...titlePartners, ...llmPartners])];
  const allVendors = [...new Set([...titleVendors, ...(Array.isArray(parsed?.equipmentVendors) ? parsed.equipmentVendors : [])])];

  return {
    totalArticles: allArticles.length,
    parentCompany: titleParent || parsed?.parentCompany || undefined,
    partnerships: allPartners,
    facilityDetails: parsed?.facilityDetails || undefined,
    scale: parsed?.scale || undefined,
    equipmentVendors: allVendors,
    keyFacts: Array.isArray(parsed?.keyFacts) ? parsed.keyFacts : [],
    articles: allArticles.slice(0, 10).map(a => ({
      title: a.title,
      date: a.pubDate ? new Date(a.pubDate).toISOString().split('T')[0] : '',
      source: a.source,
    })),
  };
}

function buildFromTitlesOnly(companyName: string, articles: RssArticle[]): NewsEnrichment {
  return {
    totalArticles: articles.length,
    parentCompany: extractParentFromTitles(companyName, articles),
    partnerships: extractPartnersFromTitles(companyName, articles),
    equipmentVendors: extractVendorsFromTitles(articles),
    keyFacts: [],
    articles: articles.slice(0, 10).map(a => ({
      title: a.title,
      date: a.pubDate ? new Date(a.pubDate).toISOString().split('T')[0] : '',
      source: a.source,
    })),
  };
}

function extractPartnersFromTitles(companyName: string, articles: RssArticle[]): string[] {
  const partners = new Set<string>();
  const shortName = companyName.split(/\s+/)[0].toLowerCase();

  for (const a of articles) {
    const title = a.title;

    // "Matica partners with Calidi Biotherapeutics"
    // "Matica and Texas A&M Form Strategic Partnership"
    // "Matica Bio, Cirsium Biosciences Enter AAV Manufacturing Pact"
    const patterns = [
      /(?:partners?\s+with|collaborat\w*\s+with|team\w*\s+(?:up\s+)?with)\s+([A-Z][A-Za-z&\s'.]+?)(?:\s+to\b|\s+for\b|\s*[-–,]|\s*$)/i,
      /(?:and|,)\s+([A-Z][A-Za-z&\s'.]+?)\s+(?:Form|Enter|Establish|Announce|team|partner|collaborat)/i,
      /(?:deal|pact|agreement|contract)\s+with\s+([A-Z][A-Za-z&\s'.]+?)(?:\s+to\b|\s+for\b|\s*[-–]|\s*$)/i,
      /([A-Z][A-Za-z&\s'.]+?)\s+(?:Enter|Form|Establish)\s+.*?(?:Partnership|Pact|Agreement|Collaboration)/i,
    ];

    for (const pat of patterns) {
      const match = title.match(pat);
      if (match) {
        const partner = match[1].trim().replace(/['']s\s*$/, '');
        if (partner.length > 3 && partner.length < 50 && !partner.toLowerCase().includes(shortName)) {
          partners.add(partner);
        }
      }
    }
  }

  return Array.from(partners);
}

function extractVendorsFromTitles(articles: RssArticle[]): string[] {
  const vendors = new Set<string>();
  const knownVendors = ['sartorius', 'cytiva', 'thermo fisher', 'milliporesigma', 'repligen', 'g-con', 'polyplus'];
  const allText = articles.map(a => a.title.toLowerCase()).join(' ');

  for (const v of knownVendors) {
    if (allText.includes(v)) vendors.add(v.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  }
  return Array.from(vendors);
}

function extractParentFromTitles(companyName: string, articles: RssArticle[]): string | undefined {
  const shortName = companyName.split(/\s+/)[0].toLowerCase(); // "matica"

  for (const a of articles) {
    const title = a.title;
    // "CHA Biotech's Matica Bio" / "CHA Biotech unit" / "CHA Biotech CDMO arm"
    const patterns = [
      /([A-Z][A-Za-z\s]{2,30}?)'s\s+(?:subsidiary|unit|arm|US\s+subsidiary|CDMO\s+arm)/i,
      /([A-Z][A-Za-z\s]{2,30}?)\s+(?:subsidiary|unit|CDMO\s+arm)\s/i,
      new RegExp(`([A-Z][A-Za-z\\s]{2,30}?)'s\\s+(?:.*?${shortName})`, 'i'),
      new RegExp(`([A-Z][A-Za-z\\s]{2,30}?)\\s+(?:subsidiary|unit|CDMO\\s+arm)\\s+(?:.*?${shortName})`, 'i'),
    ];
    for (const pat of patterns) {
      const match = title.match(pat);
      if (match) {
        const parent = match[1].trim();
        // Filter out false positives (the company itself, or very short matches)
        if (parent.length > 3 && !parent.toLowerCase().includes(shortName)) {
          return parent;
        }
      }
    }
  }
  return undefined;
}
