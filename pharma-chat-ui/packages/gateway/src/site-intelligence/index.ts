/**
 * Site Intelligence Orchestrator — routes and coordinates all enrichment,
 * resolution, status inference, and report generation steps.
 */

import express, { Router, Request, Response } from 'express';
import type { IRouter } from 'express';
import type {
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
  EquipmentStatus, ReportRequest,
} from '@p1/shared';
import { getVendorMapTabs, getVendorMapTab, getProcessSteps, findTabByModality } from './vendor-map';
import { queryDecrs } from './decrs-api';
import { queryHcters } from './hcters-api';
import { queryEdgar } from './edgar-api';
import { enrichFromWebsite } from './website-enrichment';
import { resolveModality } from './modality-resolver';
import { inferStatus } from './status-inference';
import { generateReport } from './report-generator';
import { generateBrief } from './brief-generator';
import { enrichFromNews, type NewsEnrichment } from './news-api';
import { setRequestApiKey } from './llm-client';
import { saveAccount, listAccounts } from './account-store';

export const siteIntelligenceRouter: IRouter = Router();

// ── Middleware: extract API key from X-API-Key header ──
siteIntelligenceRouter.use('/api/site-intelligence', (req: Request, _res: Response, next: express.NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  setRequestApiKey(apiKey || null);
  next();
});

// ── GET /api/site-intelligence/accounts — list saved accounts ──

siteIntelligenceRouter.get('/api/site-intelligence/accounts', async (_req: Request, res: Response) => {
  const accounts = await listAccounts();
  res.json({ accounts });
});

// ── GET /api/site-intelligence/vendor-map — list available tabs ──

siteIntelligenceRouter.get('/api/site-intelligence/vendor-map', (_req: Request, res: Response) => {
  res.json({ tabs: getVendorMapTabs() });
});

// ── GET /api/site-intelligence/vendor-map/:tab — get rows for a tab ──

siteIntelligenceRouter.get('/api/site-intelligence/vendor-map/:tab', (req: Request, res: Response) => {
  const rows = getVendorMapTab(req.params.tab);
  if (!rows.length) {
    res.status(404).json({ error: `Tab "${req.params.tab}" not found` });
    return;
  }
  res.json({ tab: req.params.tab, rows });
});

// ── GET /api/site-intelligence/enrich-stream — SSE stream for live progress ──

siteIntelligenceRouter.get('/api/site-intelligence/enrich-stream', async (req: Request, res: Response) => {
  const accountName = req.query.accountName as string;
  const location = req.query.location as string | undefined;
  const vendor = req.query.vendor as string | undefined;

  if (!accountName) {
    res.status(400).json({ error: 'Missing accountName' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event: string, data: any) => {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  };

  send('start', { accountName, sources: 7 });

  const companyName = accountName;
  const fdaEncoded = encodeURIComponent(`"${companyName}"`);
  const ctUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(companyName)}&pageSize=20`;

  // Run each source and stream progress
  const results: any = {};

  const runSource = async (name: string, fn: () => Promise<any>) => {
    send('source_start', { name });
    try {
      const result = await fn();
      results[name] = result;
      send('source_done', { name, preview: summarizeSource(name, result) });
    } catch (err: any) {
      results[name] = null;
      send('source_error', { name, error: err.message });
    }
  };

  // Phase 1: Run CT.gov + fast APIs in parallel, website waits for CT.gov email
  let ctEmail: string | undefined;

  await Promise.allSettled([
    runSource('clinicalTrials', async () => {
    const resp = await fetch(ctUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return { studies: [], summary: 'Failed' };
    const data: any = await resp.json();
    const studies = (data?.studies || []).map((s: any) => {
      const proto = s.protocolSection || {};
      return {
        nctId: proto.identificationModule?.nctId,
        title: proto.identificationModule?.briefTitle || '',
        phase: proto.designModule?.phases?.[0] || 'N/A',
        status: proto.statusModule?.overallStatus || 'N/A',
        conditions: proto.conditionsModule?.conditions || [],
        interventions: (proto.armsInterventionsModule?.interventions || []).map((iv: any) => ({ type: iv.type, name: iv.name })),
        sponsor: proto.sponsorCollaboratorsModule?.leadSponsor?.name,
        collaborators: (proto.sponsorCollaboratorsModule?.collaborators || []).map((c: any) => c.name),
        _contactEmail: proto.contactsLocationsModule?.centralContacts?.[0]?.email,
      };
    });
    // Extract email for website lookup
    let email = studies.find((s: any) => s._contactEmail)?._contactEmail;

    // If no email in general results, try recruiting studies (they have contact info)
    if (!email && studies.length > 0) {
      try {
        const recruitUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(companyName)}&filter.overallStatus=RECRUITING,ACTIVE_NOT_RECRUITING&pageSize=5`;
        const recruitResp = await fetch(recruitUrl, { signal: AbortSignal.timeout(10000) });
        if (recruitResp.ok) {
          const recruitData: any = await recruitResp.json();
          for (const rs of recruitData?.studies || []) {
            const rEmail = rs.protocolSection?.contactsLocationsModule?.centralContacts?.[0]?.email;
            if (rEmail) { email = rEmail; break; }
          }
        }
      } catch { /* ignore secondary lookup failure */ }
    }

    if (email) {
      ctEmail = email;
      console.log(`[site-intelligence] CT.gov contact email: ${email} → domain: ${email.split('@')[1]}`);
    }
    return { studies, summary: `Found ${studies.length} studies` };
  }),

    runSource('openFda', async () => {
      const resp = await fetch(`https://api.fda.gov/drug/drugsfda.json?search=openfda.manufacturer_name:${fdaEncoded}&limit=20`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return { approvals: [], summary: 'No results' };
      const data: any = await resp.json();
      const approvals = (data.results || []).map((r: any) => ({
        application_number: r.application_number,
        application_type: r.application_type,
        brand_name: r.openfda?.brand_name?.[0] || r.products?.[0]?.brand_name || 'N/A',
        generic_name: r.openfda?.generic_name?.[0] || 'N/A',
        route: r.openfda?.route?.[0] || 'N/A',
        isBLA: r.application_number?.startsWith('BLA') ?? false,
      }));
      return { approvals, summary: `Found ${approvals.length} products` };
    }),

    runSource('decrs', () => queryDecrs(companyName).then(r => r.length > 0 ? r[0] : null)),
    runSource('hcters', () => queryHcters(companyName)),
    runSource('edgar', () => queryEdgar(companyName)),
    runSource('website', async () => {
      // Wait up to 10s for CT.gov to provide email domain
      for (let i = 0; i < 20 && !ctEmail && !results.clinicalTrials; i++) {
        await new Promise(r => setTimeout(r, 500));
      }
      return enrichFromWebsite(companyName, undefined, ctEmail);
    }),
    runSource('news', () => enrichFromNews(companyName)),
  ]);

  // Merge news into website (same logic as POST endpoint)
  let website = results.website;
  const news: NewsEnrichment | null = results.news;
  if (news && website) {
    const allPartners = new Set([
      ...website.partnerships,
      ...news.partnerships.filter((p: string) =>
        p.length > 3 && p.length < 60 && !p.toLowerCase().startsWith('to ') &&
        !p.toLowerCase().startsWith('for ') && !p.toLowerCase().includes('advance') &&
        !p.toLowerCase().includes('nonprofit') && /[A-Z]/.test(p[0])
      ),
    ]);
    website.partnerships = Array.from(allPartners);
    if (news.parentCompany && isValidParentCompany(news.parentCompany)) {
      console.log(`[site-intelligence] Parent company from news titles: ${news.parentCompany}`);
      website.parentCompany = news.parentCompany;
    } else if (website.parentCompany && !isValidParentCompany(website.parentCompany)) {
      website.parentCompany = undefined;
    }
    if (!website.facilityDetails && news.facilityDetails) website.facilityDetails = news.facilityDetails;
    if (!website.scale && news.scale) website.scale = news.scale;
    const allEquip = new Set([...website.equipmentMentions, ...news.equipmentVendors]);
    website.equipmentMentions = Array.from(allEquip);
    if (news.keyFacts.length) website.keyDifferentiators = [...(website.keyDifferentiators || []), ...news.keyFacts];
    if (news.articles.length) website.recentNews = news.articles.slice(0, 5).map((a: any) => `${a.title} (${a.source}, ${a.date})`);
  } else if (news && !website) {
    website = {
      modalities: [], partnerships: news.partnerships, equipmentMentions: news.equipmentVendors,
      parentCompany: news.parentCompany, facilityDetails: news.facilityDetails, scale: news.scale,
      keyDifferentiators: news.keyFacts,
      recentNews: news.articles.slice(0, 5).map((a: any) => `${a.title} (${a.source}, ${a.date})`),
    };
  }

  const enrichment: EnrichmentData = {
    clinicalTrials: results.clinicalTrials || { studies: [], summary: 'Failed' },
    openFda: results.openFda || { approvals: [], summary: 'Failed' },
    decrs: results.decrs || null,
    hcters: results.hcters || null,
    edgar: results.edgar || null,
    website,
  };

  send('complete', { enrichment });
  res.end();
});

function summarizeSource(name: string, result: any): string {
  if (!result) return 'No data';
  switch (name) {
    case 'clinicalTrials': return `${result.studies?.length || 0} studies`;
    case 'openFda': return `${result.approvals?.length || 0} products`;
    case 'decrs': return result?.feiNumber ? `FEI: ${result.feiNumber}` : 'Not found';
    case 'hcters': return result?.hasRegistration ? 'Registered' : 'Not found';
    case 'edgar': return `${result?.totalMentions || 0} filings`;
    case 'website': return result?.modalities?.length ? result.modalities.join(', ') : 'Extracted';
    case 'news': return `${result?.totalArticles || 0} articles`;
    default: return 'Done';
  }
}

// ── POST /api/site-intelligence/enrich — batch version (kept for API/curl testing) ──

siteIntelligenceRouter.post('/api/site-intelligence/enrich', async (req: Request, res: Response) => {
  const input: SiteIntelligenceInput = req.body;
  if (!input.accountName) {
    res.status(400).json({ error: 'Missing accountName' });
    return;
  }

  const companyName = input.accountName;
  const location = input.location;

  console.log(`[site-intelligence] Enriching "${companyName}" (${location || 'no location'})`);

  try {
    // Import the existing FDA API functions by calling the same endpoints internally
    // But for efficiency, we call the underlying APIs directly here.
    const ctUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(companyName)}&pageSize=20`;
    const fdaEncoded = encodeURIComponent(`"${companyName}"`);

    // Run all 6 enrichment sources in parallel
    const [ctResult, fdaResult, decrsResult, hctersResult, edgarResult, websiteResult, newsResult] =
      await Promise.allSettled([
        // 1. ClinicalTrials.gov
        fetch(ctUrl, { signal: AbortSignal.timeout(15000) })
          .then(r => r.ok ? r.json() : null)
          .then((data: any) => {
            const studies = (data?.studies || []).map((s: any) => {
              const proto = s.protocolSection || {};
              const id = proto.identificationModule || {};
              const status = proto.statusModule || {};
              const design = proto.designModule || {};
              return {
                nctId: id.nctId,
                title: id.briefTitle || '',
                phase: design.phases?.[0] || 'N/A',
                status: status.overallStatus || 'N/A',
                conditions: proto.conditionsModule?.conditions || [],
                interventions: (proto.armsInterventionsModule?.interventions || []).map(
                  (iv: any) => ({ type: iv.type, name: iv.name })
                ),
                sponsor: proto.sponsorCollaboratorsModule?.leadSponsor?.name,
                collaborators: (proto.sponsorCollaboratorsModule?.collaborators || []).map((c: any) => c.name),
              };
            });
            return { studies, summary: `Found ${studies.length} studies` };
          }),

        // 2. openFDA
        fetch(`https://api.fda.gov/drug/drugsfda.json?search=openfda.manufacturer_name:${fdaEncoded}&limit=20`,
          { signal: AbortSignal.timeout(10000) })
          .then(r => r.ok ? r.json() : { results: [] })
          .then((data: any) => {
            const approvals = (data.results || []).map((r: any) => ({
              application_number: r.application_number,
              application_type: r.application_type,
              brand_name: r.openfda?.brand_name?.[0] || r.products?.[0]?.brand_name || 'N/A',
              generic_name: r.openfda?.generic_name?.[0] || 'N/A',
              route: r.openfda?.route?.[0] || 'N/A',
              isBLA: r.application_number?.startsWith('BLA') ?? false,
            }));
            return { approvals, summary: `Found ${approvals.length} FDA products` };
          })
          .catch(() => ({ approvals: [], summary: 'openFDA query failed' })),

        // 3. DECRS
        queryDecrs(companyName).then(results =>
          results.length > 0 ? results[0] : null
        ),

        // 4. HCTERS
        queryHcters(companyName),

        // 5. SEC EDGAR
        queryEdgar(companyName),

        // 6. Website
        enrichFromWebsite(companyName),

        // 7. News / Press Releases (Google News RSS)
        enrichFromNews(companyName),
      ]);

    // Merge news data into website enrichment for richer intelligence
    let website = websiteResult.status === 'fulfilled' ? websiteResult.value : null;
    const news: NewsEnrichment | null = newsResult.status === 'fulfilled' ? newsResult.value : null;

    if (news && website) {
      // Merge news partnerships into website partnerships (deduplicated, cleaned)
      const allPartners = new Set([
        ...website.partnerships,
        ...news.partnerships.filter(p =>
          p.length > 3 && p.length < 60 &&
          !p.toLowerCase().startsWith('to ') &&
          !p.toLowerCase().startsWith('for ') &&
          !p.toLowerCase().includes('advance') &&
          !p.toLowerCase().includes('nonprofit') &&
          /[A-Z]/.test(p[0]) // Must start with uppercase (company name)
        ),
      ]);
      website.partnerships = Array.from(allPartners);

      // Fill gaps from news
      if (news.parentCompany && isValidParentCompany(news.parentCompany)) {
        console.log(`[site-intelligence] Parent company from news titles: ${news.parentCompany}`);
        website.parentCompany = news.parentCompany;
      } else if (website.parentCompany && !isValidParentCompany(website.parentCompany)) {
        website.parentCompany = undefined;
      }
      if (!website.facilityDetails && news.facilityDetails) website.facilityDetails = news.facilityDetails;
      if (!website.scale && news.scale) website.scale = news.scale;

      // Merge equipment vendors into equipment mentions
      const allEquip = new Set([...website.equipmentMentions, ...news.equipmentVendors]);
      website.equipmentMentions = Array.from(allEquip);

      // Add news key facts to differentiators
      if (news.keyFacts.length) {
        website.keyDifferentiators = [...(website.keyDifferentiators || []), ...news.keyFacts];
      }

      // Add news articles to recentNews
      if (news.articles.length) {
        website.recentNews = news.articles.slice(0, 5).map(a => `${a.title} (${a.source}, ${a.date})`);
      }
    } else if (news && !website) {
      // No website data at all — create from news alone
      website = {
        modalities: [],
        partnerships: news.partnerships,
        equipmentMentions: news.equipmentVendors,
        parentCompany: news.parentCompany,
        facilityDetails: news.facilityDetails,
        scale: news.scale,
        keyDifferentiators: news.keyFacts,
        recentNews: news.articles.slice(0, 5).map(a => `${a.title} (${a.source}, ${a.date})`),
      };
    }

    const enrichment: EnrichmentData = {
      clinicalTrials: ctResult.status === 'fulfilled' && ctResult.value
        ? ctResult.value : { studies: [], summary: 'CT.gov query failed' },
      openFda: fdaResult.status === 'fulfilled' && fdaResult.value
        ? fdaResult.value : { approvals: [], summary: 'openFDA query failed' },
      decrs: decrsResult.status === 'fulfilled' ? decrsResult.value : null,
      hcters: hctersResult.status === 'fulfilled' ? hctersResult.value : null,
      edgar: edgarResult.status === 'fulfilled' ? edgarResult.value : null,
      website,
    };

    console.log(`[site-intelligence] Enrichment complete: CT=${enrichment.clinicalTrials.studies.length} studies, FDA=${enrichment.openFda.approvals.length} approvals, DECRS=${enrichment.decrs ? 'found' : 'none'}, HCTERS=${enrichment.hcters?.hasRegistration ? 'yes' : 'no'}, EDGAR=${enrichment.edgar?.totalMentions || 0} mentions, Website=${enrichment.website ? 'extracted' : 'failed'}, News=${news?.totalArticles || 0} articles`);

    res.json(enrichment);
  } catch (err: any) {
    console.error('[site-intelligence] Enrichment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/site-intelligence/resolve — modality resolution ──

siteIntelligenceRouter.post('/api/site-intelligence/resolve', (req: Request, res: Response) => {
  const { enrichment } = req.body as { enrichment: EnrichmentData };
  if (!enrichment) {
    res.status(400).json({ error: 'Missing enrichment data' });
    return;
  }

  const resolution = resolveModality(enrichment);
  console.log(`[site-intelligence] Resolved: ${resolution.modality} ${resolution.scale} (${resolution.confidence.toFixed(2)} confidence, tab: ${resolution.vendorMapTab})`);
  res.json(resolution);
});

// ── POST /api/site-intelligence/status — status inference ──

siteIntelligenceRouter.post('/api/site-intelligence/status', async (req: Request, res: Response) => {
  const { enrichment, vendorMapTab, userVendor } = req.body;
  if (!enrichment || !vendorMapTab || !userVendor) {
    res.status(400).json({ error: 'Missing enrichment, vendorMapTab, or userVendor' });
    return;
  }

  try {
    const status = await inferStatus(enrichment, vendorMapTab, userVendor);
    res.json(status);
  } catch (err: any) {
    console.error('[site-intelligence] Status inference error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/site-intelligence/report — generate DOCX (detailed, brief, or both) ──

siteIntelligenceRouter.post('/api/site-intelligence/report', async (req: Request, res: Response) => {
  const request: ReportRequest = req.body;
  if (!request.input || !request.enrichment || !request.resolution) {
    res.status(400).json({ error: 'Missing required report fields' });
    return;
  }

  const reportType = request.reportType || 'both';
  const safeName = request.input.accountName.replace(/\s+/g, '_');

  try {
    console.log(`[site-intelligence] Generating ${reportType} report for "${request.input.accountName}"`);

    // Save to Knowledge Graph (async, don't block report generation)
    saveAccount(request.input, request.enrichment, request.resolution).catch(() => {});

    if (reportType === 'detailed') {
      const buffer = await generateReport(request);
      const filename = `P1st_${safeName}_Intelligence_Report.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } else if (reportType === 'brief') {
      const buffer = await generateBrief(request);
      const filename = `P1st_${safeName}_PreMeeting_Brief.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } else {
      // 'both' — generate both and return as JSON with base64 buffers
      const [detailedBuf, briefBuf] = await Promise.all([
        generateReport(request),
        generateBrief(request),
      ]);
      res.json({
        detailed: {
          filename: `P1st_${safeName}_Intelligence_Report.docx`,
          base64: detailedBuf.toString('base64'),
          size: detailedBuf.length,
        },
        brief: {
          filename: `P1st_${safeName}_PreMeeting_Brief.docx`,
          base64: briefBuf.toString('base64'),
          size: briefBuf.length,
        },
      });
    }
  } catch (err: any) {
    console.error('[site-intelligence] Report generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/site-intelligence/process-steps — get ProcessStep[] for a resolved account ──

siteIntelligenceRouter.post('/api/site-intelligence/process-steps', (req: Request, res: Response) => {
  const { vendorMapTab, userVendor, equipmentStatus } = req.body;
  if (!vendorMapTab || !userVendor) {
    res.status(400).json({ error: 'Missing vendorMapTab or userVendor' });
    return;
  }

  const steps = getProcessSteps(vendorMapTab, userVendor, equipmentStatus || {});
  res.json({ steps });
});

// ── Helpers ──

/** Filter out garbage parent company values extracted from news headlines */
function isValidParentCompany(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  // Reject if it looks like a news headline fragment
  const garbage = ['layoff', 'report', 'announce', 'acquire', 'merger', 'deal', 'stock', 'share',
    'price', 'revenue', 'quarter', 'growth', 'profit', 'loss', 'restructur', 'bankrupt',
    'lawsuit', 'settle', 'fda', 'approval', 'clinical', 'trial', 'study', 'phase'];
  const lower = name.toLowerCase();
  if (garbage.some(g => lower.includes(g))) return false;
  // Reject if it contains sentence-like patterns (spaces + lowercase words)
  if ((name.match(/\s/g) || []).length > 4) return false;
  // Must start with uppercase
  if (!/^[A-Z]/.test(name)) return false;
  return true;
}
