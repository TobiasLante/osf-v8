/**
 * Status Inference — assigns WON/OPEN/COMPETITOR/NO_CONTACT to each unit operation
 * based on enrichment signals. Uses deterministic rules first, LLM for ambiguous cases.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { EnrichmentData, EquipmentStatus, EquipmentStatusValue, VendorMapRow } from '@p1/shared';
import { getVendorMapTab } from './vendor-map';

// Known vendor → upstream equipment mapping
const VENDOR_UPSTREAM_KEYWORDS: Record<string, string[]> = {
  sartorius: ['biostat', 'rm ', 'str ', 'bioreactor', 'shake flask', 'cell seed', 'cell cultivation'],
  cytiva: ['wave', 'xdr', 'akta'],
  'thermo fisher': ['hyperforma', 'dynadrive', 'nunc'],
  milliporesigma: ['mobius'],
  repligen: ['xcell', 'atf', 'krosflo'],
};

export async function inferStatus(
  enrichment: EnrichmentData,
  vendorMapTab: string,
  userVendor: string,
): Promise<EquipmentStatus> {
  const rows = getVendorMapTab(vendorMapTab);
  if (!rows.length) return {};

  const status: EquipmentStatus = {};

  // Phase 1: Default everything to NO_CONTACT
  for (const row of rows) {
    status[row.unitOperation] = 'NO_CONTACT';
  }

  // Phase 2: Deterministic rules from website partnerships/equipment
  const ws = enrichment.website;
  if (ws) {
    const partnerships = ws.partnerships.map(p => p.toLowerCase());
    const equipment = ws.equipmentMentions.map(e => e.toLowerCase());
    const userVendorLower = userVendor.toLowerCase();

    for (const row of rows) {
      const rowLower = row.equipmentName.toLowerCase();
      const opLower = row.unitOperation.toLowerCase();

      // Check if a competitor vendor is mentioned as partner for this equipment type
      for (const [vendor, keywords] of Object.entries(VENDOR_UPSTREAM_KEYWORDS)) {
        if (vendor === userVendorLower) continue; // skip our own vendor

        const isPartner = partnerships.some(p => p.includes(vendor));
        const isEquipmentMentioned = equipment.some(e =>
          keywords.some(kw => e.includes(kw))
        );

        if (isPartner || isEquipmentMentioned) {
          // Check if this unit operation matches the vendor's typical equipment
          const matchesRow = keywords.some(kw =>
            rowLower.includes(kw) || opLower.includes(kw)
          );

          if (matchesRow) {
            status[row.unitOperation] = 'COMPETITOR';
          }
        }
      }
    }
  }

  // Phase 3: LLM-assisted refinement (optional, if API key available)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && ws) {
    try {
      const llmStatus = await llmRefineStatus(enrichment, rows, userVendor, apiKey);
      // Only override NO_CONTACT with LLM suggestions (don't override deterministic COMPETITOR)
      for (const [op, val] of Object.entries(llmStatus)) {
        if (status[op] === 'NO_CONTACT' && val !== 'NO_CONTACT') {
          status[op] = val;
        }
      }
    } catch (err: any) {
      console.warn('[status-inference] LLM refinement failed:', err.message);
    }
  }

  return status;
}

async function llmRefineStatus(
  enrichment: EnrichmentData,
  rows: VendorMapRow[],
  userVendor: string,
  apiKey: string,
): Promise<EquipmentStatus> {
  const client = new Anthropic({ apiKey });

  // Build context from enrichment
  const context: string[] = [];
  if (enrichment.website?.partnerships.length) {
    context.push(`Partnerships: ${enrichment.website.partnerships.join(', ')}`);
  }
  if (enrichment.website?.equipmentMentions.length) {
    context.push(`Equipment mentioned: ${enrichment.website.equipmentMentions.join(', ')}`);
  }
  if (enrichment.edgar?.filings.length) {
    for (const f of enrichment.edgar.filings.slice(0, 3)) {
      if (f.excerpt) context.push(`SEC Filing (${f.filer}): ${f.excerpt.slice(0, 200)}`);
    }
  }
  if (enrichment.website?.cgmpStatus) {
    context.push(`GMP Status: ${enrichment.website.cgmpStatus}`);
  }

  if (!context.length) return {};

  const unitOps = rows.map(r => r.unitOperation).filter((v, i, a) => a.indexOf(v) === i);

  const prompt = `You are analyzing a pharmaceutical manufacturing facility. Based on these signals, classify each unit operation.

The salesperson works for: ${userVendor}

Intelligence gathered:
${context.join('\n')}

Unit operations to classify:
${unitOps.map((op, i) => `${i + 1}. ${op}`).join('\n')}

For each unit operation, assign exactly one status:
- COMPETITOR: Another vendor's equipment is confirmed installed
- WON: Our vendor (${userVendor}) equipment is confirmed installed
- OPEN: Active opportunity, no competitor confirmed
- NO_CONTACT: No information available

Return ONLY a JSON object mapping unit operation names to status values. Example:
{"Cell Seed Cultivation": "COMPETITOR", "Capture Chromatography": "NO_CONTACT"}

Only classify operations where you have evidence. Leave ambiguous ones as NO_CONTACT.`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  const parsed = JSON.parse(jsonMatch[0]);
  const result: EquipmentStatus = {};

  for (const [op, val] of Object.entries(parsed)) {
    if (['WON', 'OPEN', 'COMPETITOR', 'NO_CONTACT'].includes(val as string)) {
      result[op] = val as EquipmentStatusValue;
    }
  }

  return result;
}
