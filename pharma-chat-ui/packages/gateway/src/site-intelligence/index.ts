/**
 * Site Intelligence Orchestrator — routes and coordinates all enrichment,
 * resolution, status inference, and report generation steps.
 */

import { Router, Request, Response } from 'express';
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

export const siteIntelligenceRouter: IRouter = Router();

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

// ── POST /api/site-intelligence/enrich — run all 6 APIs in parallel ──

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
    const ctUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(companyName)}${location ? `+${encodeURIComponent(location)}` : ''}&pageSize=20`;
    const fdaEncoded = encodeURIComponent(`"${companyName}"`);

    // Run all 6 enrichment sources in parallel
    const [ctResult, fdaResult, decrsResult, hctersResult, edgarResult, websiteResult] =
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
      ]);

    const enrichment: EnrichmentData = {
      clinicalTrials: ctResult.status === 'fulfilled' && ctResult.value
        ? ctResult.value : { studies: [], summary: 'CT.gov query failed' },
      openFda: fdaResult.status === 'fulfilled' && fdaResult.value
        ? fdaResult.value : { approvals: [], summary: 'openFDA query failed' },
      decrs: decrsResult.status === 'fulfilled' ? decrsResult.value : null,
      hcters: hctersResult.status === 'fulfilled' ? hctersResult.value : null,
      edgar: edgarResult.status === 'fulfilled' ? edgarResult.value : null,
      website: websiteResult.status === 'fulfilled' ? websiteResult.value : null,
    };

    console.log(`[site-intelligence] Enrichment complete: CT=${enrichment.clinicalTrials.studies.length} studies, FDA=${enrichment.openFda.approvals.length} approvals, DECRS=${enrichment.decrs ? 'found' : 'none'}, HCTERS=${enrichment.hcters?.hasRegistration ? 'yes' : 'no'}, EDGAR=${enrichment.edgar?.totalMentions || 0} mentions, Website=${enrichment.website ? 'extracted' : 'failed'}`);

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

// ── POST /api/site-intelligence/report — generate DOCX ──

siteIntelligenceRouter.post('/api/site-intelligence/report', async (req: Request, res: Response) => {
  const request: ReportRequest = req.body;
  if (!request.input || !request.enrichment || !request.resolution) {
    res.status(400).json({ error: 'Missing required report fields' });
    return;
  }

  try {
    console.log(`[site-intelligence] Generating report for "${request.input.accountName}"`);
    const buffer = await generateReport(request);

    const filename = `P1st_${request.input.accountName.replace(/\s+/g, '_')}_Intelligence_Report.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
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
