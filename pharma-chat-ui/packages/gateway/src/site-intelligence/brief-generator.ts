/**
 * PreMeeting Sales Brief Generator — 1-page condensed intelligence document.
 * Reference: Process1st_Fate_Therapeutics_PreMeeting Sales Brief.pdf
 *
 * Layout: dense single-page with 6 sections:
 *   Left column:  Account Snapshot, Know Before You Walk In, Three Lines
 *   Right column: WON + Follow-Up Leads, The Play, Watch Out For
 *
 * Since DOCX doesn't natively support columns well, we use a 2-column table
 * as the page layout container.
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, Header, Footer, PageBreak,
} from 'docx';
import { llmComplete } from './llm-client';
import type {
  ReportRequest, ProcessStep, EquipmentStatusValue,
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
} from '@p1/shared';

// ── Brand Colors ──
const BRAND_PRIMARY  = '2B5E8C';
const BRAND_DARK     = '1E4A6E';
const BRAND_ACCENT   = 'D4740A';
const COLOR_WON      = '2E7D32';
const COLOR_OPEN     = 'E67E22';
const COLOR_COMP     = 'C0392B';
const COLOR_NC       = '7F8C8D';
const COLOR_VERIFY   = '0097A7';
const COLOR_NO_SAR   = '8E24AA';
const COLOR_TEXT      = '1E293B';
const COLOR_DIM       = '64748B';
const COLOR_LIGHT_BG  = 'F1F5F9';
const COLOR_WARM_BG   = 'FFF8E1';
const WHITE           = 'FFFFFF';

const STATUS_LABELS: Record<string, string> = {
  WON: 'WON', OPEN: 'OPEN', COMPETITOR: 'COMPETITOR',
  NO_CONTACT: 'FOLLOW UP', VERIFY: 'FOLLOW UP', NO_SAR_PRODUCT: 'NO SAR PRODUCT',
};

const STATUS_COLORS: Record<string, string> = {
  WON: COLOR_WON, OPEN: COLOR_OPEN, COMPETITOR: COLOR_COMP,
  NO_CONTACT: COLOR_NC, VERIFY: COLOR_VERIFY, NO_SAR_PRODUCT: COLOR_NO_SAR,
};

export async function generateBrief(request: ReportRequest): Promise<Buffer> {
  const { input, enrichment, resolution, processSteps } = request;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Run LLM calls in parallel
  const [knowBeforeYouWalkIn, threeLines, thePlay, watchOutFor] = await Promise.all([
    generateKnowBeforeYouWalkIn(input, enrichment, resolution, processSteps),
    generateThreeLines(input, enrichment, resolution, processSteps),
    generateThePlay(input, enrichment, resolution, processSteps),
    generateWatchOutFor(input, enrichment, resolution, processSteps),
  ]);

  const temp = inferTemperatureShort(enrichment);
  const tempColor = temp === 'HOT' ? 'C0392B' : temp === 'WARM' ? BRAND_ACCENT : COLOR_NC;
  const tempReason = inferTemperatureReason(enrichment, resolution);
  const wonSteps = processSteps.filter(s => s.status === 'WON');
  const existingWin = wonSteps.length > 0
    ? wonSteps.map(s => s.product || s.step).join(', ')
    : 'None confirmed';

  const leadProgram = getLeadProgram(enrichment, resolution);

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 18, color: COLOR_TEXT } } },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 600, right: 500, bottom: 500, left: 500 },
          size: { width: 12240, height: 15840 }, // Letter
        },
      },
      headers: { default: new Header({ children: [
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: 'PROCESS-1ST LLC  |  PRE-CALL BRIEF  |  ', size: 14, color: COLOR_DIM }),
            new TextRun({ text: `${input.accountName}, ${input.location || ''}  |  ${input.vendor}  |  Confidential`, size: 14, color: COLOR_DIM }),
          ],
        }),
      ] }) },
      children: [
        // ── Title Bar ──
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: 65, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
              children: [
                new Paragraph({
                  spacing: { before: 80, after: 20 },
                  children: [new TextRun({ text: `${input.accountName}  |  ${input.location || ''}`, bold: true, size: 28, color: WHITE })],
                }),
                new Paragraph({
                  spacing: { after: 80 },
                  children: [new TextRun({
                    text: `${resolution.modality}  |  ${input.vendor} Sales Brief  |  ${date}`,
                    size: 18, color: 'B0D4F1',
                  })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.SOLID, color: COLOR_WARM_BG, fill: COLOR_WARM_BG },
              children: [
                new Paragraph({
                  spacing: { before: 60 },
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: temp, bold: true, size: 36, color: tempColor })],
                }),
                new Paragraph({
                  spacing: { after: 60 },
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: tempReason, size: 15, color: COLOR_TEXT })],
                }),
              ],
            }),
          ] })],
        }),

        spacer(40),

        // ── Account Snapshot ──
        sectionLabel('ACCOUNT SNAPSHOT'),
        ...buildSnapshotTable(input, enrichment, resolution, existingWin, leadProgram),

        spacer(40),

        // ── WON + Follow-Up Leads ──
        sectionLabel('WON + FOLLOW-UP LEADS'),
        ...buildFollowUpImportant(processSteps),
        buildLeadsTable(processSteps, input.vendor),

        spacer(40),

        // ── Know Before You Walk In ──
        sectionLabel('KNOW BEFORE YOU WALK IN'),
        ...parseBullets(knowBeforeYouWalkIn).map(b =>
          new Paragraph({
            spacing: { before: 15, after: 15 },
            children: [
              new TextRun({ text: '▸  ', bold: true, color: BRAND_PRIMARY, size: 17 }),
              new TextRun({ text: b, size: 17 }),
            ],
          })
        ),

        spacer(40),

        // ── Three Lines ──
        sectionLabel('THREE LINES'),
        ...buildThreeLinesRows(threeLines),

        spacer(40),

        // ── The Play ──
        sectionLabel('THE PLAY'),
        ...parseBullets(thePlay).map(b =>
          new Paragraph({
            spacing: { before: 15, after: 15 },
            children: [
              new TextRun({ text: '▸  ', bold: true, color: BRAND_ACCENT, size: 17 }),
              new TextRun({ text: b, size: 17 }),
            ],
          })
        ),

        spacer(40),

        // ── Watch Out For ──
        sectionLabel('WATCH OUT FOR'),
        buildWatchOutTable(watchOutFor),

        spacer(60),

        // ── Footer Tagline ──
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60 },
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: BRAND_PRIMARY } },
          children: [new TextRun({ text: 'Read this. Walk in. Close.', bold: true, size: 18, color: BRAND_PRIMARY, italics: true })],
        }),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Layout Helpers ──

function spacer(spacing: number): Paragraph {
  return new Paragraph({ spacing: { before: spacing } });
}

function sectionLabel(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 20, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BRAND_PRIMARY } },
    children: [new TextRun({ text, bold: true, size: 16, color: BRAND_PRIMARY, allCaps: true, font: 'Calibri' })],
  });
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0 };
  return { top: none, bottom: none, left: none, right: none };
}

// ── Snapshot ──

function buildSnapshotTable(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, existingWin: string, leadProgram: string): Paragraph[] {
  const ws = enrichment.website;
  const rows: [string, string][] = [
    ['Site', `${input.location || input.accountName}`],
    ['Modality', resolution.modality],
    ['Starting Material', getStartingMaterial(resolution)],
    ['Lead Program', leadProgram],
    ['GMP Status', ws?.cgmpStatus || 'Not confirmed'],
    ['Existing Win', existingWin],
  ];

  return rows.map(([label, value]) => new Paragraph({
    spacing: { before: 20, after: 20 },
    children: [
      new TextRun({ text: `${label}:  `, bold: true, size: 17, color: BRAND_PRIMARY }),
      new TextRun({ text: value, size: 17 }),
    ],
  }));
}

function getStartingMaterial(resolution: ModalityResolution): string {
  const mod = resolution.modality.toLowerCase();
  if (mod.includes('ipsc') || mod.includes('allogeneic')) return 'Master iPSC cell bank';
  if (mod.includes('car-t') || mod.includes('autologous')) return 'Patient apheresis';
  if (mod.includes('mab')) return 'CHO cell bank';
  if (mod.includes('aav')) return 'HEK293 cell bank / plasmid';
  if (mod.includes('mrna')) return 'DNA template / IVT';
  if (mod.includes('lenti')) return 'HEK293T cell bank / plasmid';
  return 'Cell bank';
}

function getLeadProgram(enrichment: EnrichmentData, resolution: ModalityResolution): string {
  if (resolution.accountType === 'cdmo') {
    const count = enrichment.clinicalTrials?.studies?.length || 0;
    return count > 0
      ? `CDMO — ${count} sponsor trial(s) found, pipeline not attributable`
      : 'CDMO — sponsor pipeline, not publicly listed';
  }
  const studies = enrichment.clinicalTrials?.studies || [];
  if (studies.length === 0) return 'No public clinical programs';
  const lead = studies[0];
  const phase = lead.phase || 'N/A';
  const conditions = lead.conditions?.slice(0, 2).join(', ') || '';
  const name = lead.interventions?.[0]?.name || lead.nctId;
  return `${name} — ${phase}${conditions ? `, ${conditions}` : ''}`;
}

// ── Leads Table ──

function buildFollowUpImportant(steps: ProcessStep[]): Paragraph[] {
  const hasOpen = steps.some(s => s.status === 'OPEN');
  const allFollowUp = steps.every(s => s.status !== 'OPEN');

  if (allFollowUp) {
    return [new Paragraph({
      spacing: { before: 20, after: 30 },
      children: [
        new TextRun({ text: 'IMPORTANT: ', bold: true, color: BRAND_ACCENT, size: 16 }),
        new TextRun({ text: 'All equipment below is either WON (confirmed) or a FOLLOW-UP LEAD (needs facility walkthrough to qualify). Nothing is OPEN — no public expansion announcement found.', size: 16 }),
      ],
    })];
  }
  return [];
}

function buildLeadsTable(steps: ProcessStep[], vendor: string): Table {
  // Group by unit operation, show status + product
  const rows = steps.map(step => {
    const status = step.status || 'NO_CONTACT';
    const briefStatus = status === 'WON' ? 'WON'
      : status === 'OPEN' ? 'OPEN'
      : status === 'COMPETITOR' ? 'COMP'
      : status === 'NO_SAR_PRODUCT' ? 'NO SAR'
      : 'FOLLOW UP';
    const statusColor = STATUS_COLORS[status] || COLOR_NC;

    return new TableRow({ children: [
      new TableCell({
        width: { size: 22, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: statusColor, fill: statusColor },
        children: [new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: briefStatus, bold: true, size: 14, color: WHITE })],
        })],
      }),
      new TableCell({
        width: { size: 78, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [
            new TextRun({ text: `${step.step}`, bold: true, size: 16 }),
            new TextRun({ text: `  |  ${step.product || '—'}`, size: 15, color: COLOR_DIM }),
          ],
        })],
      }),
    ] });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({
          shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
          width: { size: 22, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: 'Status', bold: true, size: 14, color: WHITE })] })],
        }),
        new TableCell({
          shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
          width: { size: 78, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: 'Unit Operation  |  Sartorius Product', bold: true, size: 14, color: WHITE })] })],
        }),
      ] }),
      ...rows,
    ],
  });
}

// ── Three Lines ──

function buildThreeLinesRows(text: string): Paragraph[] {
  const lines = parseThreeLines(text);
  const labels = ['Open', 'Value', 'Close'];
  const colors = [BRAND_PRIMARY, COLOR_WON, BRAND_ACCENT];

  return lines.map((line, i) => {
    const label = labels[i] || `Line ${i + 1}`;
    const color = colors[i] || BRAND_PRIMARY;
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [
        new TableCell({
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color, fill: color },
          children: [new Paragraph({
            spacing: { before: 30, after: 30 },
            children: [new TextRun({ text: label, bold: true, size: 16, color: WHITE })],
          })],
        }),
        new TableCell({
          width: { size: 85, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            spacing: { before: 30, after: 30 },
            children: [new TextRun({ text: `"${line}"`, size: 16, italics: true })],
          })],
        }),
      ] })],
    });
  }).flatMap((table, i) => i < lines.length - 1 ? [table, spacer(20)] : [table]) as any[];
}

// ── Watch Out For ──

function buildWatchOutTable(text: string): Table {
  const entries = parseWatchOutFor(text);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({
          shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
          width: { size: 25, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: 'Competitor', bold: true, size: 14, color: WHITE })] })],
        }),
        new TableCell({
          shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
          width: { size: 75, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [new TextRun({ text: 'Their play / Your counter', bold: true, size: 14, color: WHITE })] })],
        }),
      ] }),
      ...entries.map((entry, i) => new TableRow({ children: [
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          shading: i % 2 === 0 ? { type: ShadingType.SOLID, color: COLOR_LIGHT_BG, fill: COLOR_LIGHT_BG } : undefined,
          children: [new Paragraph({
            spacing: { before: 20, after: 20 },
            children: [new TextRun({ text: entry.name, bold: true, size: 16 })],
          })],
        }),
        new TableCell({
          width: { size: 75, type: WidthType.PERCENTAGE },
          shading: i % 2 === 0 ? { type: ShadingType.SOLID, color: COLOR_LIGHT_BG, fill: COLOR_LIGHT_BG } : undefined,
          children: [new Paragraph({
            spacing: { before: 20, after: 20 },
            children: [new TextRun({ text: entry.play, size: 15 })],
          })],
        }),
      ] })),
    ],
  });
}

// ── LLM Prompts ──

async function generateKnowBeforeYouWalkIn(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const wonSteps = steps.filter(s => s.status === 'WON');
  const ws = enrichment.website;

  return callLlmSonnet(`Write 5-7 bullet points for "Know Before You Walk In" section of a pre-call sales brief for ${input.vendor} visiting ${input.accountName}.

ACCOUNT:
- ${input.accountName}: ${resolution.modality} ${resolution.scale}, ${resolution.phase}, ${resolution.accountType}
${ws?.parentCompany ? `- Parent: ${ws.parentCompany}` : ''}
${ws?.keyDifferentiators?.length ? `- Tech: ${ws.keyDifferentiators.slice(0, 3).join(', ')}` : ''}
${ws?.partnerships?.length ? `- Partnerships: ${ws.partnerships.slice(0, 4).join(', ')}` : ''}
${ws?.recentNews?.length ? `- News: ${ws.recentNews[0]}` : ''}
${enrichment.edgar?.filings?.length ? `- SEC: ${enrichment.edgar.filings[0].filer} (${enrichment.edgar.filings[0].form})` : ''}
- WON equipment: ${wonSteps.map(s => s.product || s.step).join(', ') || 'none confirmed'}
- Total unit operations: ${steps.length}, of which ${steps.filter(s => s.status === 'NO_CONTACT').length} are NO CONTACT

RULES:
- Each bullet is one bold statement. No sub-bullets.
- First bullet MUST describe the manufacturing model (batch from cell bank, autologous, continuous, etc.)
- Include one bullet about confirmed equipment (what is WON vs NO CONTACT)
- Include one bullet about the key clinical/business trigger (pivotal study, expansion, etc.)
- Include one bullet about the competitive landscape (who is likely in the building)
- Last bullet: mention no public expansion announcement if none found
- Be direct, not diplomatic. This is internal intel.
- NO markdown. NO numbering.`);
}

async function generateThreeLines(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const wonSteps = steps.filter(s => s.status === 'WON');
  const openSteps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT');
  const ws = enrichment.website;

  return callLlmSonnet(`Write three sales talking points for a ${input.vendor} rep visiting ${input.accountName}.

CONTEXT:
- ${resolution.modality} ${resolution.scale}, ${resolution.phase}
- WON: ${wonSteps.map(s => s.product).join(', ') || 'none confirmed'}
- Open/Unknown: ${openSteps.slice(0, 5).map(s => `${s.step} (${s.product || '—'})`).join(', ')}
${ws?.recentNews?.length ? `- News: ${ws.recentNews[0]}` : ''}
${ws?.keyDifferentiators?.length ? `- Their tech: ${ws.keyDifferentiators[0]}` : ''}

Write EXACTLY three lines:
Open: [one sentence opening the conversation — reference a specific fact]
Value: [one sentence value proposition — name specific products and unit operations]
Close: [one sentence asking for specific next step — facility walkthrough, technical review, etc.]

Each line is direct speech in quotation marks. Sound human, not corporate.`);
}

async function generateThePlay(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const wonSteps = steps.filter(s => s.status === 'WON');
  const openSteps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT');

  return callLlmSonnet(`Write 3 action bullets for "THE PLAY" section of a pre-call sales brief.

${input.accountName}: ${resolution.modality} ${resolution.scale}
- WON: ${wonSteps.map(s => `${s.step}: ${s.product}`).join(', ') || 'none'}
- Open/Unknown: ${openSteps.slice(0, 6).map(s => `${s.step}: ${s.product || '—'}`).join(', ')}
${enrichment.website?.recentNews?.length ? `- Trigger: ${enrichment.website.recentNews[0]}` : ''}

Write EXACTLY 3 bullets:
1. The door opener — what gets you into the facility
2. The scale-up conversation — what clinical/business trigger creates urgency
3. The competitive anchor — which specific ${input.vendor} product has no equivalent from competitors

RULES:
- Each bullet: bold first clause, then explanation
- Name specific products and unit operations
- NO generic "leverage the platform" language
- Be tactical and specific`);
}

async function generateWatchOutFor(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const allSteps = steps.map(s => `${s.step}: ${s.product||'—'} [${s.status}] Comp=${s.vendor||'—'}`).join('\n');

  return callLlmSonnet(`Write competitor watch-out entries for a pre-call brief about ${input.accountName} (${resolution.modality}).

EQUIPMENT:
${allSteps}

Write entries for Cytiva, Thermo Fisher, and Repligen in this format:
[NAME]: [their play in 1 sentence]. / Counter: [your counter in 1 sentence].

RULES:
- Name specific competitor products
- Name specific ${input.vendor} counter-products
- Keep each entry to 2 sentences total (play + counter)
- Be direct and tactical`);
}

async function callLlmSonnet(prompt: string): Promise<string> {
  return llmComplete(prompt, { maxTokens: 600, model: 'claude-sonnet-4-20250514' });
}

// ── Parsers ──

function parseBullets(text: string): string[] {
  return text.split('\n')
    .map(l => l.replace(/^[-▸●•*\d.)\s]+/, '').trim())
    .filter(l => l.length > 10);
}

function parseThreeLines(text: string): string[] {
  const lines: string[] = [];
  for (const label of ['Open', 'Opening', 'Value', 'Close']) {
    const regex = new RegExp(`${label}[^:]*[:\\s]+[""]?(.+?)[""]?(?=(?:Open|Value|Close|$))`, 'is');
    const match = text.match(regex);
    if (match) lines.push(match[1].trim().replace(/[""]/g, '').replace(/\n+/g, ' '));
  }
  if (lines.length < 3) {
    const fallback = text.split('\n').map(l => l.replace(/^[^:]+:\s*/, '').replace(/[""]/g, '').trim()).filter(l => l.length > 15);
    return fallback.slice(0, 3);
  }
  return lines.slice(0, 3);
}

interface WatchOutEntry { name: string; play: string; }

function parseWatchOutFor(text: string): WatchOutEntry[] {
  const entries: WatchOutEntry[] = [];
  const competitors = ['Cytiva', 'Thermo Fisher', 'Repligen', 'MilliporeSigma'];
  const compPattern = competitors.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  for (const comp of competitors) {
    const namePattern = comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${namePattern}[:\\s]+(.+?)(?=${compPattern}|$)`, 'is');
    const match = text.match(regex);
    if (match) {
      entries.push({ name: comp, play: match[1].trim().replace(/\n+/g, ' ').replace(/^[:\s]+/, '').slice(0, 300) });
    }
  }
  return entries;
}

// ── Temperature ──

function inferTemperatureShort(enrichment: EnrichmentData): string {
  const hasApprovals = (enrichment.openFda?.approvals?.length || 0) > 0;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;
  const cgmp = (enrichment.website?.cgmpStatus || '').toLowerCase();
  const hasTrials = (enrichment.clinicalTrials?.studies?.length || 0) > 0;
  if (hasApprovals) return 'HOT';
  if (cgmp.includes('commercial') && hasEdgar) return 'HOT';
  if (cgmp.includes('commercial') && hasTrials) return 'HOT';
  if (hasTrials) return 'WARM';
  if (hasEdgar) return 'WARM';
  if (cgmp.includes('cgmp')) return 'WARM';
  return 'COLD';
}

function inferTemperatureReason(enrichment: EnrichmentData, resolution: ModalityResolution): string {
  const studies = enrichment.clinicalTrials?.studies || [];
  const approvals = enrichment.openFda?.approvals || [];
  if (approvals.length > 0) return `${approvals.length} approved product(s)`;
  if (studies.length > 0) {
    const lead = studies[0];
    return `${lead.interventions?.[0]?.name || lead.nctId} ${lead.phase || ''} ${lead.status || ''}`.trim();
  }
  return 'Limited public data';
}
