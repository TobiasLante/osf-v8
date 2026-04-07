/**
 * Status Inference — assigns WON/OPEN/COMPETITOR/NO_CONTACT to each unit operation
 * based on enrichment signals. Uses deterministic rules first, LLM for ambiguous cases.
 */

import type { EnrichmentData, EquipmentStatus, EquipmentStatusValue, VendorMapRow, VendorKey } from '@p1/shared';
import { llmExtractJson } from './llm-client';
import { getVendorMapTab, VENDOR_KEYS } from './vendor-map';

// No hardcoded vendor→equipment mapping. Instead, we use the Vendor Map itself:
// If website mentions "Sartorius" as partner, find all rows where Sartorius has a product
// and the user's vendor is NOT Sartorius → those rows are COMPETITOR.

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

  // Phase 2: Deterministic rules — use the Vendor Map itself to infer competitors
  const ws = enrichment.website;
  if (ws) {
    const mentionedPartners = ws.partnerships.map(p => p.toLowerCase());
    const mentionedEquipment = ws.equipmentMentions.map(e => e.toLowerCase());
    const userKey = VENDOR_KEYS[userVendor] as VendorKey | undefined;

    // For each vendor mentioned as a partner on the website...
    for (const [vendorName, vendorKey] of Object.entries(VENDOR_KEYS)) {
      if (vendorName.toLowerCase() === userVendor.toLowerCase()) continue; // skip our vendor

      const isMentionedAsPartner = mentionedPartners.some(p =>
        p.includes(vendorName.toLowerCase())
      );
      if (!isMentionedAsPartner) continue;

      // ...find all rows where that vendor has a product → mark as COMPETITOR
      for (const row of rows) {
        const competitorProduct = row.vendors[vendorKey as VendorKey];
        if (competitorProduct) {
          status[row.unitOperation] = 'COMPETITOR';
        }
      }
    }

    // Also check for specific equipment mentions matching competitor products
    for (const row of rows) {
      if (status[row.unitOperation] !== 'NO_CONTACT') continue; // already classified
      for (const [vk, product] of Object.entries(row.vendors)) {
        if (userKey && vk === userKey) continue; // skip our products
        if (!product) continue;
        // If the website mentions a specific competitor product name
        const productLower = product.toLowerCase();
        if (mentionedEquipment.some(e => productLower.includes(e) || e.includes(productLower.split(' ')[0]))) {
          status[row.unitOperation] = 'COMPETITOR';
        }
      }
    }
  }

  // Phase 3: LLM-assisted refinement
  if (ws) {
    try {
      const llmStatus = await llmRefineStatus(enrichment, rows, userVendor);
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
): Promise<EquipmentStatus> {

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

  const parsed = await llmExtractJson<Record<string, string>>(prompt);
  if (!parsed) return {};

  const result: EquipmentStatus = {};

  for (const [op, val] of Object.entries(parsed)) {
    if (['WON', 'OPEN', 'COMPETITOR', 'NO_CONTACT'].includes(val as string)) {
      result[op] = val as EquipmentStatusValue;
    }
  }

  return result;
}
