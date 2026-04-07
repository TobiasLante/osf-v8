/**
 * Account Store — persists Facility nodes in Neo4j after report generation.
 * Uses Neo4j HTTP API (no driver dependency needed).
 */

import type { SiteIntelligenceInput, EnrichmentData, ModalityResolution } from '@p1/shared';

const NEO4J_URL = process.env.NEO4J_URL || 'http://pharma-neo4j.i3x.svc.cluster.local:7474';
const NEO4J_DB = process.env.NEO4J_DB || 'neo4j';

interface SavedAccount {
  facilityId: string;
  companyName: string;
  location: string;
  modality: string;
  scale: string;
  accountType: string;
  lastEnriched: string;
}

export async function saveAccount(
  input: SiteIntelligenceInput,
  enrichment: EnrichmentData,
  resolution: ModalityResolution,
): Promise<string> {
  const facilityId = generateFacilityId(input.accountName, input.location);
  const ws = enrichment.website;
  const now = new Date().toISOString();

  const cypher = `
    MERGE (f:Facility {facility_id: $facilityId})
    SET f += {
      company_name: $companyName,
      address: $location,
      parent_company: $parentCompany,
      modalities: $modalities,
      gmp_status: $gmpStatus,
      scale: $scale,
      phase: $phase,
      account_type: $accountType,
      fei_number: $feiNumber,
      sales_temperature: $salesTemp,
      vendor_perspective: $vendor,
      enrichment_timestamp: $timestamp,
      confidence_score: $confidence
    }
    RETURN f.facility_id AS id
  `;

  const params = {
    facilityId,
    companyName: input.accountName,
    location: input.location || '',
    parentCompany: ws?.parentCompany || '',
    modalities: (ws?.modalities || [resolution.modality]).join(', '),
    gmpStatus: ws?.cgmpStatus || '',
    scale: resolution.scale,
    phase: resolution.phase,
    accountType: resolution.accountType,
    feiNumber: enrichment.decrs?.feiNumber || '',
    salesTemp: inferTemperature(enrichment),
    vendor: input.vendor,
    timestamp: now,
    confidence: resolution.confidence,
  };

  try {
    await runCypher(cypher, params);
    console.log(`[account-store] Saved facility ${facilityId} (${input.accountName})`);
    return facilityId;
  } catch (err: any) {
    console.warn(`[account-store] Failed to save: ${err.message}`);
    return facilityId;
  }
}

export async function listAccounts(): Promise<SavedAccount[]> {
  try {
    const result = await runCypher(
      `MATCH (f:Facility)
       RETURN f.facility_id AS facilityId, f.company_name AS companyName,
              f.address AS location, f.modalities AS modality, f.scale AS scale,
              f.account_type AS accountType, f.enrichment_timestamp AS lastEnriched
       ORDER BY f.enrichment_timestamp DESC
       LIMIT 50`,
      {},
    );
    return result;
  } catch (err: any) {
    console.warn(`[account-store] Failed to list accounts: ${err.message}`);
    return [];
  }
}

export async function getAccount(facilityId: string): Promise<any | null> {
  try {
    const results = await runCypher(
      `MATCH (f:Facility {facility_id: $id}) RETURN f`,
      { id: facilityId },
    );
    return results[0]?.f || null;
  } catch {
    return null;
  }
}

// ── Neo4j HTTP API ──

async function runCypher(cypher: string, parameters: Record<string, any>): Promise<any[]> {
  const url = `${NEO4J_URL}/db/${NEO4J_DB}/query/v2`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement: cypher, parameters }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Neo4j HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data: any = await resp.json();

  if (data.errors?.length) {
    throw new Error(`Neo4j error: ${data.errors[0].message}`);
  }

  // Parse v2 response format
  const columns = data.data?.fields || [];
  const rows = data.data?.values || [];
  return rows.map((row: any[]) => {
    const obj: any = {};
    columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
    return obj;
  });
}

function generateFacilityId(name: string, location?: string): string {
  const base = `${name}_${location || 'unknown'}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return base.slice(0, 80);
}

function inferTemperature(enrichment: EnrichmentData): string {
  const hasApprovals = (enrichment.openFda?.approvals?.length || 0) > 0;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;
  const cgmp = (enrichment.website?.cgmpStatus || '').toLowerCase();
  if (hasApprovals) return 'HOT';
  if (cgmp.includes('commercial') && hasEdgar) return 'HOT';
  if (hasEdgar || cgmp.includes('cgmp')) return 'WARM';
  return 'COLD';
}
