import { Router, Request, Response } from 'express';
import type { IRouter } from 'express';

export const fdaRouter: IRouter = Router();

// ── ClinicalTrials.gov v2 API ──

fdaRouter.post('/api/enrich/clinicaltrials', async (req: Request, res: Response) => {
  const { companyName, location } = req.body;
  if (!companyName) {
    res.status(400).json({ error: 'Missing companyName' });
    return;
  }

  try {
    let query = encodeURIComponent(companyName);
    if (location) query += `+${encodeURIComponent(location)}`;

    const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${query}&pageSize=20`;
    const resp = await fetch(url);
    if (!resp.ok) {
      res.status(resp.status).json({ error: `ClinicalTrials API error: ${resp.status}` });
      return;
    }

    const data: any = await resp.json();
    const studies = (data.studies || []).map((s: any) => {
      const proto = s.protocolSection || {};
      const id = proto.identificationModule || {};
      const status = proto.statusModule || {};
      const design = proto.designModule || {};
      const conditions = proto.conditionsModule?.conditions || [];
      const interventions = (proto.armsInterventionsModule?.interventions || []).map(
        (iv: any) => ({ type: iv.type, name: iv.name })
      );

      return {
        nctId: id.nctId,
        title: id.briefTitle,
        phase: design.phases?.[0] || 'N/A',
        status: status.overallStatus,
        conditions,
        interventions,
      };
    });

    const phaseIII = studies.filter((s: any) => s.phase?.includes('3') || s.phase?.includes('III'));
    const summary = `Found ${studies.length} studies, ${phaseIII.length} in Phase III`;

    res.json({ studies, summary });
  } catch (err: any) {
    console.error('[fda-api] clinicaltrials error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FDA openFDA API ──

fdaRouter.post('/api/enrich/fda', async (req: Request, res: Response) => {
  const { companyName } = req.body;
  if (!companyName) {
    res.status(400).json({ error: 'Missing companyName' });
    return;
  }

  try {
    let approvals = await fetchFdaDrugs(companyName, 'openfda.manufacturer_name');

    // Fallback 1: try sponsor_name
    if (approvals.length === 0) {
      approvals = await fetchFdaDrugs(companyName, 'sponsor_name');
    }

    // Fallback 2: try drug labels
    if (approvals.length === 0) {
      approvals = await fetchFdaLabels(companyName);
    }

    const summary = `Found ${approvals.length} FDA-approved products`;
    res.json({ approvals, summary });
  } catch (err: any) {
    console.error('[fda-api] fda error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function fetchFdaDrugs(companyName: string, field: string): Promise<any[]> {
  const encoded = encodeURIComponent(`"${companyName}"`);
  const url = `https://api.fda.gov/drug/drugsfda.json?search=${field}:${encoded}&limit=20`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data: any = await resp.json();

    return (data.results || []).map((r: any) => {
      const products = r.products || [];
      const openfda = r.openfda || {};
      return {
        application_number: r.application_number,
        application_type: r.application_type,
        brand_name: openfda.brand_name?.[0] || products[0]?.brand_name || 'N/A',
        generic_name: openfda.generic_name?.[0] || 'N/A',
        route: openfda.route?.[0] || products[0]?.route || 'N/A',
      };
    });
  } catch {
    return [];
  }
}

async function fetchFdaLabels(companyName: string): Promise<any[]> {
  const encoded = encodeURIComponent(`"${companyName}"`);
  const url = `https://api.fda.gov/drug/label.json?search=openfda.manufacturer_name:${encoded}&limit=10`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data: any = await resp.json();

    return (data.results || []).map((r: any) => {
      const openfda = r.openfda || {};
      return {
        brand_name: openfda.brand_name?.[0] || 'N/A',
        generic_name: openfda.generic_name?.[0] || 'N/A',
        route: openfda.route?.[0] || 'N/A',
        application_type: openfda.application_number?.[0]?.startsWith('NDA') ? 'NDA' : 'ANDA',
      };
    });
  } catch {
    return [];
  }
}
