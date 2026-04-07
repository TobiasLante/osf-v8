/**
 * Modality Resolution Engine — deterministic decision tree that takes
 * all enrichment signals and outputs a confidence-scored modality classification.
 * Maps the result to the correct Vendor Map tab for equipment lookup.
 */

import type { EnrichmentData, ModalityResolution } from '@p1/shared';
import { TAB_CONFIG, findTabByModality } from './vendor-map';

// ── Signal weights ──

const WEIGHT_CTGOV      = 0.35;
const WEIGHT_OPENFDA    = 0.20;
const WEIGHT_DECRS      = 0.10;
const WEIGHT_HCTERS     = 0.15;
const WEIGHT_WEBSITE    = 0.15;
const WEIGHT_EDGAR      = 0.05;

type ModalityCandidate = {
  modality: string;
  scale?: string;
  score: number;
  signals: string[];
};

export function resolveModality(enrichment: EnrichmentData): ModalityResolution {
  const candidates: ModalityCandidate[] = [];
  const allSignals: string[] = [];

  // ── Signal 1: ClinicalTrials.gov intervention types ──
  const ctStudies = enrichment.clinicalTrials?.studies || [];
  if (ctStudies.length > 0) {
    const interventionTypes = new Map<string, number>();

    for (const study of ctStudies) {
      for (const iv of study.interventions) {
        const t = iv.type?.toUpperCase();
        const n = (iv.name || '').toLowerCase();

        if (t === 'GENETIC') {
          if (n.includes('aav') || n.includes('adeno')) {
            increment(interventionTypes, 'AAV');
          } else if (n.includes('lenti') || n.includes('car-t') || n.includes('car t')) {
            increment(interventionTypes, 'Lentivirus');
          } else {
            increment(interventionTypes, 'AAV'); // AAV more common
          }
          allSignals.push(`CT.gov: GENETIC intervention "${iv.name}" → Gene Therapy`);
        } else if (t === 'BIOLOGICAL') {
          if (n.includes('mrna') || n.includes('m-rna') || n.includes('messenger rna') ||
              n.includes('messenger ribonucleic')) {
            increment(interventionTypes, 'mRNA');
          } else if (n.includes('mab') || n.includes('antibod') || n.includes('umab') ||
                     n.includes('izumab') || n.includes('tinib')) {
            increment(interventionTypes, 'mAb');
          } else if (n.includes('adc') || n.includes('conjugat')) {
            increment(interventionTypes, 'ADC');
          } else if (n.includes('aav') || n.includes('adeno-associated')) {
            increment(interventionTypes, 'AAV');
          } else if (n.includes('lenti') || n.includes('car-t') || n.includes('car t')) {
            increment(interventionTypes, 'Lentivirus');
          } else if (n.includes('vaccine') || n.includes('dose') || n.includes('placebo') ||
                     n.includes('booster') || n.includes('immunization')) {
            // Vaccine/placebo — skip, don't count as mAb
            allSignals.push(`CT.gov: Skipped vaccine/placebo "${iv.name}"`);
            continue;
          } else {
            // Unknown biological — don't default to mAb, just skip
            continue;
          }
          allSignals.push(`CT.gov: BIOLOGICAL intervention "${iv.name}"`);
        } else if (t === 'DRUG') {
          if (n.includes('adc') || n.includes('conjugat')) {
            increment(interventionTypes, 'ADC');
            allSignals.push(`CT.gov: DRUG+conjugate "${iv.name}" → ADC`);
          }
        }
      }
    }

    // Score proportionally — the modality with more interventions wins
    const totalInterventions = [...interventionTypes.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [mod, count] of interventionTypes) {
      const proportion = count / totalInterventions; // 0-1, proportional to how dominant this modality is
      candidates.push({
        modality: mod,
        score: WEIGHT_CTGOV * proportion * Math.min(totalInterventions / 3, 1.5), // boost if many studies
        signals: [`CT.gov: ${count}/${totalInterventions} interventions suggest ${mod} (${Math.round(proportion * 100)}%)`],
      });
    }

    // Phase inference from CT.gov
    const phases = ctStudies.map(s => s.phase).filter(Boolean);
    if (phases.some(p => p.includes('3') || p.includes('III'))) {
      allSignals.push('CT.gov: Phase III studies present');
    }
  } else {
    allSignals.push('CT.gov: No studies found (typical for CDMOs)');
  }

  // ── Signal 2: openFDA BLA/NDA ──
  const approvals = enrichment.openFda?.approvals || [];
  if (approvals.length > 0) {
    const blaCount = approvals.filter(a => a.isBLA).length;
    const ndaCount = approvals.length - blaCount;

    if (blaCount > 0) {
      candidates.push({
        modality: 'mAb',
        score: WEIGHT_OPENFDA * Math.min(blaCount / 3, 1),
        signals: [`openFDA: ${blaCount} BLA approvals → biologic (likely mAb)`],
      });
    }
    if (ndaCount > 0) {
      allSignals.push(`openFDA: ${ndaCount} NDA approvals (small molecule — may be outside scope)`);
    }
  }

  // ── Signal 3: DECRS business operations ──
  if (enrichment.decrs) {
    const ops = enrichment.decrs.businessOperations.map(o => o.toLowerCase());
    if (ops.some(o => o.includes('api manufacture') || o.includes('manufacture'))) {
      allSignals.push(`DECRS: Registered manufacturing facility (FEI: ${enrichment.decrs.feiNumber})`);
      // DECRS doesn't tell modality directly, but confirms manufacturing capability
      for (const c of candidates) {
        c.score += WEIGHT_DECRS * 0.5; // boost existing candidates
      }
    }
  }

  // ── Signal 5: Website (evaluated BEFORE HCTERS so we can check for conflicts) ──
  const ws = enrichment.website;
  const websiteModalities = new Set<string>();
  if (ws && ws.modalities.length > 0) {
    for (const mod of ws.modalities) {
      const normalized = normalizeModality(mod);
      if (normalized) {
        websiteModalities.add(normalized);
        // Website modalities get higher weight — they are explicit, not inferred
        candidates.push({
          modality: normalized,
          scale: ws.scale || undefined,
          score: WEIGHT_WEBSITE * 1.5, // 1.5x boost for explicit website mention
          signals: [`Website: "${mod}" mentioned → ${normalized}`],
        });
      }
    }
    if (ws.partnerships.length > 0) {
      allSignals.push(`Website: Partnerships with ${ws.partnerships.join(', ')}`);
    }
    if (ws.cgmpStatus) {
      allSignals.push(`Website: ${ws.cgmpStatus} status confirmed`);
    }

    // News titles as additional modality signal
    const newsText = (ws.recentNews || []).join(' ').toLowerCase();
    if (newsText) {
      const newsModalities: Record<string, number> = {};
      const newsKw: [string, string][] = [
        ['mrna', 'mRNA'], ['m-rna', 'mRNA'], ['messenger rna', 'mRNA'],
        ['aav', 'AAV'], ['adeno-associated', 'AAV'], ['gene therapy', 'AAV'],
        ['lentivir', 'Lentivirus'], ['car-t', 'Lentivirus'], ['car t', 'Lentivirus'],
        ['monoclonal antibod', 'mAb'], ['bispecific', 'mAb'],
        ['antibody-drug conjugate', 'ADC'], ['adc ', 'ADC'],
        ['plasmid', 'pDNA'], ['pdna', 'pDNA'],
        ['oligonucleotide', 'mRNA'],
      ];
      for (const [kw, mod] of newsKw) {
        const count = (newsText.match(new RegExp(kw, 'gi')) || []).length;
        if (count > 0) newsModalities[mod] = (newsModalities[mod] || 0) + count;
      }
      for (const [mod, count] of Object.entries(newsModalities)) {
        const normalized = normalizeModality(mod);
        if (normalized) {
          websiteModalities.add(normalized);
          candidates.push({
            modality: normalized,
            score: WEIGHT_WEBSITE * Math.min(count / 5, 1), // scale with frequency
            signals: [`News: "${mod}" mentioned ${count}x in press releases`],
          });
        }
      }
    }
  }

  // ── Signal 4: HCTERS (Cell/Gene Therapy) — evaluated AFTER website ──
  if (enrichment.hcters?.hasRegistration) {
    const geneTherapyMods = new Set(['AAV', 'Lentivirus']);
    const websiteHasNonGT = [...websiteModalities].some(m => !geneTherapyMods.has(m));
    const hctersWeight = websiteHasNonGT ? WEIGHT_HCTERS * 0.3 : WEIGHT_HCTERS;

    candidates.push({
      modality: 'AAV',
      score: hctersWeight,
      signals: [`HCTERS: HCT/P registration → cell/gene therapy${websiteHasNonGT ? ' (reduced — website suggests other modality)' : ''}`],
    });
    if (!websiteHasNonGT) {
      candidates.push({
        modality: 'Lentivirus',
        score: hctersWeight * 0.7,
        signals: ['HCTERS: HCT/P registration → possible lentivirus'],
      });
    }
    allSignals.push('HCTERS: HCT/P establishment registered');
  }

  // ── Signal 6: EDGAR ──
  if (enrichment.edgar && enrichment.edgar.totalMentions > 0) {
    allSignals.push(`SEC EDGAR: ${enrichment.edgar.totalMentions} filing(s) mention this company`);
    for (const f of enrichment.edgar.filings.slice(0, 3)) {
      if (f.excerpt) {
        allSignals.push(`EDGAR: ${f.filer} (${f.form}, ${f.date})`);
      }
    }
  }

  // ── Aggregate candidates ──
  const aggregated = new Map<string, { score: number; signals: string[]; scale?: string }>();
  for (const c of candidates) {
    const existing = aggregated.get(c.modality);
    if (existing) {
      existing.score += c.score;
      existing.signals.push(...c.signals);
      if (c.scale && !existing.scale) existing.scale = c.scale;
    } else {
      aggregated.set(c.modality, { score: c.score, signals: [...c.signals], scale: c.scale });
    }
  }

  // Pick highest-scoring modality
  let bestModality = 'unknown';
  let bestScore = 0;
  let bestSignals: string[] = [];
  let bestScale: string | undefined;

  for (const [mod, data] of aggregated) {
    if (data.score > bestScore) {
      bestModality = mod;
      bestScore = data.score;
      bestSignals = data.signals;
      bestScale = data.scale;
    }
  }

  // ── Determine scale ──
  const scale = bestScale || inferScale(enrichment, bestModality);

  // ── Find Vendor Map tab ──
  const vendorMapTab = findTabByModality(bestModality, scale) || findTabByModality(bestModality) || '';

  // ── Phase ──
  const phase = inferPhase(enrichment);

  // ── Account type ──
  const accountType = inferAccountType(enrichment);

  return {
    modality: bestModality,
    scale: scale || 'unknown',
    vendorMapTab,
    phase,
    accountType,
    confidence: Math.min(bestScore, 1.0),
    signals: [...bestSignals, ...allSignals],
  };
}

// ── Helpers ──

function normalizeModality(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('mab') || lower.includes('monoclonal') || lower.includes('antibody')) return 'mAb';
  if (lower.includes('aav') || lower.includes('adeno-associated')) return 'AAV';
  if (lower.includes('lenti') || lower.includes('lv')) return 'Lentivirus';
  if (lower.includes('mrna') || lower.includes('m-rna')) return 'mRNA';
  if (lower.includes('pdna') || lower.includes('plasmid')) return 'pDNA';
  if (lower.includes('adc') || lower.includes('antibody-drug')) return 'ADC';
  if (lower.includes('oligo')) return null; // not in our vendor map
  return null;
}

function inferScale(enrichment: EnrichmentData, modality: string): string {
  // Website scale mention takes priority
  const wsScale = enrichment.website?.scale?.toLowerCase() || '';
  if (wsScale.includes('2000')) return '2000L';
  if (wsScale.includes('1000')) return '1000L';
  if (wsScale.includes('500'))  return '500L';
  if (wsScale.includes('200'))  return '200L';
  if (wsScale.includes('50'))   return '50L';
  if (wsScale.includes('40'))   return '40L';

  // Default scale per modality (from available vendor map tabs)
  const defaults: Record<string, string> = {
    'mAb': '2000L',        // Fed Batch more common
    'AAV': '500L',
    'Lentivirus': '50L',
    'ADC': 'Platform',
    'mRNA': '50L',
    'pDNA': '40L',
  };
  return defaults[modality] || 'unknown';
}

function inferPhase(enrichment: EnrichmentData): string {
  const studies = enrichment.clinicalTrials?.studies || [];

  // Check for approved products
  if (enrichment.openFda?.approvals?.length) return 'Commercial';

  // Check highest phase in CT.gov
  const phases = studies.map(s => s.phase || '');
  if (phases.some(p => p.includes('4')))  return 'Commercial (Phase IV)';
  if (phases.some(p => p.includes('3')))  return 'Phase III';
  if (phases.some(p => p.includes('2')))  return 'Phase II';
  if (phases.some(p => p.includes('1')))  return 'Phase I';

  // Website fallback
  const wsText = (enrichment.website?.cgmpStatus || '').toLowerCase();
  if (wsText.includes('commercial')) return 'Commercial';
  if (wsText.includes('clinical'))   return 'Clinical';

  return 'Unknown';
}

function inferAccountType(enrichment: EnrichmentData): 'innovator' | 'cdmo' | 'unknown' {
  // Strongest signal: LLM-extracted account type from website
  const wsAccountType = (enrichment.website?.accountType || '').toLowerCase();
  if (wsAccountType.includes('cdmo') || wsAccountType.includes('cmo')) return 'cdmo';
  if (wsAccountType.includes('innovator')) return 'innovator';

  // Secondary: keyword scan across all website data
  const wsText = [
    ...(enrichment.website?.modalities || []),
    enrichment.website?.cgmpStatus || '',
    enrichment.website?.facilityDetails || '',
    ...(enrichment.website?.partnerships || []),
    ...(enrichment.website?.keyDifferentiators || []),
  ].join(' ').toLowerCase();

  if (wsText.includes('cdmo') || wsText.includes('contract development') ||
      wsText.includes('contract manufactur') || wsText.includes('cmo ') ||
      wsText.includes('outsourc') || wsText.includes('client') ||
      wsText.includes('sponsor')) {
    return 'cdmo';
  }

  // If CT.gov has studies with the company as sponsor → innovator
  const studies = enrichment.clinicalTrials?.studies || [];
  if (studies.some(s => s.sponsor)) return 'innovator';

  // If openFDA has approvals → innovator
  if (enrichment.openFda?.approvals?.length) return 'innovator';

  // CDMOs often have EDGAR mentions from client filings but no own CT.gov/FDA data
  const noOwnData = studies.length === 0 && !enrichment.openFda?.approvals?.length;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;
  if (noOwnData && hasEdgar) return 'cdmo';

  return 'unknown';
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}
