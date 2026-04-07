/**
 * Report Generator — Premium DOCX following Process-1st Template v3.
 * Design principle: This must look like a $5000 consulting document,
 * not a ChatGPT output. No bullet points in strategy. No markdown.
 * Specific product names. Confident, direct language.
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, Header, Footer, ImageRun, PageBreak,
  type ITableCellOptions, type IParagraphOptions,
} from 'docx';
import { llmComplete } from './llm-client';
import type {
  ReportRequest, ProcessStep, EquipmentStatusValue,
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
} from '@p1/shared';

// ── Brand Colors (Process-1st) ──
const BRAND_PRIMARY  = '0891B2'; // Cyan-600
const BRAND_DARK     = '0E7490'; // Cyan-700
const BRAND_BG       = 'F0FDFA'; // Cyan-50
const COLOR_WON      = '059669'; // Emerald-600
const COLOR_OPEN     = 'D97706'; // Amber-600
const COLOR_COMP     = 'DC2626'; // Red-600
const COLOR_NC       = '6B7280'; // Gray-500
const COLOR_TEXT     = '1E293B'; // Slate-800
const COLOR_DIM      = '64748B'; // Slate-500
const COLOR_LIGHT_BG = 'F8FAFC'; // Slate-50
const WHITE          = 'FFFFFF';

const STATUS_COLORS: Record<EquipmentStatusValue, string> = {
  WON: COLOR_WON, OPEN: COLOR_OPEN, COMPETITOR: COLOR_COMP, NO_CONTACT: COLOR_NC,
};

const STATUS_LABELS: Record<EquipmentStatusValue, { icon: string; text: string }> = {
  WON:        { icon: '✓', text: 'Our Product' },
  OPEN:       { icon: '●', text: 'Open Opportunity' },
  COMPETITOR: { icon: '✕', text: 'Competitor' },
  NO_CONTACT: { icon: '◆', text: 'Unknown' },
};

export async function generateReport(request: ReportRequest): Promise<Buffer> {
  const { input, enrichment, resolution, processSteps } = request;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const [strategy, talkingPoints, checklist] = await Promise.all([
    generateStrategy(input, enrichment, resolution, processSteps),
    generateTalkingPoints(input, enrichment, resolution, processSteps),
    generateChecklist(input, enrichment, resolution, processSteps),
  ]);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21, color: COLOR_TEXT } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 900, right: 800, bottom: 900, left: 800 } },
      },
      headers: { default: new Header({ children: [
        new Paragraph({
          spacing: { after: 100 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BRAND_PRIMARY } },
          children: [
            new TextRun({ text: 'PROCESS-1ST LLC', bold: true, color: BRAND_PRIMARY, size: 18, font: 'Calibri' }),
            new TextRun({ text: '  |  Account Intelligence Report  |  Confidential', size: 16, color: COLOR_DIM }),
          ],
        }),
      ] }) },
      footers: { default: new Footer({ children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
          spacing: { before: 100 },
          children: [new TextRun({
            text: `Process-1st LLC  |  ${input.accountName}  |  ${date}  |  Confidential — For ${input.vendor} Sales Team Use Only`,
            size: 14, color: COLOR_DIM,
          })],
        }),
      ] }) },
      children: [
        // ── Cover Block ──
        spacer(200),
        para('PROCESS-1ST LLC', { bold: true, size: 40, color: BRAND_PRIMARY }),
        para('Account Intelligence Report', { size: 30, color: COLOR_TEXT }),
        para(`${input.accountName}  |  ${resolution.modality}  |  ${date}`, { size: 22, color: COLOR_DIM }),
        spacer(300),

        // ── SECTION 1A ──
        sectionTitle('SECTION 1', 'Site Intelligence Profile'),
        buildSiteProfileTable(input, enrichment, resolution),
        spacer(200),

        // ── SECTION 1B ──
        sectionTitle('SECTION 1B', 'Facility Pipeline'),
        ...buildPipelineSection(enrichment, resolution),
        spacer(200),

        // ── SECTION 2 (new page — large table) ──
        sectionTitle('SECTION 2', 'Process Map — Equipment Position and Competitive Landscape', true),
        para(`Primary modality: ${resolution.modality} ${resolution.scale}. Report generated from ${input.vendor} perspective.`, { size: 19, color: COLOR_DIM, italics: true }),
        spacer(100),
        buildStatusLegend(),
        spacer(100),
        buildEquipmentTable(processSteps, input.vendor),
        spacer(200),

        // ── SECTION 3 (new page — after large equipment table) ──
        sectionTitle('SECTION 3', 'Recommended Strategy', true),
        para('The Commercial Play for This Account', { bold: true, size: 22, color: COLOR_TEXT }),
        spacer(50),
        buildStrategyTable(strategy),
        spacer(200),

        // ── SECTION 4 ──
        sectionTitle('SECTION 4', 'Talking Points'),
        para('Three Lines to Open, Position, and Close', { bold: true, size: 22, color: COLOR_TEXT }),
        spacer(50),
        buildTalkingPointsTable(talkingPoints),
        spacer(200),

        // ── SECTION 5 ──
        sectionTitle('SECTION 5', 'Cross-Selling Opportunities'),
        para('Adjacent Products, Services, and Partner Offerings', { bold: true, size: 22, color: COLOR_TEXT }),
        spacer(50),
        para('PLACEHOLDER — Content to be added by Process-1st', { italics: true, color: COLOR_DIM }),
        spacer(200),

        // ── SECTION 6 (new page) ──
        sectionTitle('SECTION 6', 'Process Treasure Map', true),
        para('Visual Opportunity Map — Equipment Coverage by Unit Operation', { bold: true, size: 22, color: COLOR_TEXT }),
        spacer(50),
        buildTreasureMapTable(processSteps, resolution),
        spacer(200),

        // ── SECTION 7 ──
        sectionTitle('SECTION 7', 'Meeting Preparation Checklist'),
        para('Required Materials Before Any Customer Meeting', { bold: true, size: 22, color: COLOR_TEXT }),
        spacer(100),
        ...buildChecklistParagraphs(checklist, resolution, input),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Helpers ──

function spacer(spacing: number): Paragraph {
  return new Paragraph({ spacing: { before: spacing } });
}

function para(text: string, opts?: { bold?: boolean; size?: number; color?: string; italics?: boolean; alignment?: typeof AlignmentType[keyof typeof AlignmentType]; keepNext?: boolean }): Paragraph {
  return new Paragraph({
    alignment: opts?.alignment,
    keepNext: opts?.keepNext ?? opts?.bold,
    children: [new TextRun({
      text,
      bold: opts?.bold,
      size: opts?.size || 21,
      color: opts?.color || COLOR_TEXT,
      italics: opts?.italics,
    })],
  });
}

function sectionTitle(number: string, title: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    spacing: { before: pageBreakBefore ? 0 : 300, after: 100 },
    keepNext: true,
    keepLines: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BRAND_PRIMARY } },
    children: [
      ...(pageBreakBefore ? [new PageBreak()] : []),
      new TextRun({ text: number + '  ', bold: true, size: 26, color: BRAND_PRIMARY }),
      new TextRun({ text: title, bold: true, size: 26, color: COLOR_TEXT }),
    ],
  });
}

function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: BRAND_DARK, fill: BRAND_DARK },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, bold: true, color: WHITE, size: 18, font: 'Calibri' })],
    })],
  });
}

function cell(text: string, opts?: { bold?: boolean; color?: string; shading?: string; width?: number }): TableCell {
  return new TableCell({
    ...(opts?.shading ? { shading: { type: ShadingType.SOLID, color: opts.shading, fill: opts.shading } } : {}),
    ...(opts?.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({
      spacing: { before: 30, after: 30 },
      children: [new TextRun({ text, size: 18, bold: opts?.bold, color: opts?.color || COLOR_TEXT })],
    })],
  });
}

// ── Section Builders ──

function buildSiteProfileTable(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution): Table {
  const ws = enrichment.website;
  const decrs = enrichment.decrs;

  const sourcesUsed: string[] = [];
  if (enrichment.clinicalTrials?.studies?.length) sourcesUsed.push('ClinicalTrials.gov');
  if (enrichment.openFda?.approvals?.length) sourcesUsed.push('openFDA');
  if (decrs) sourcesUsed.push('FDA DECRS');
  if (enrichment.hcters?.hasRegistration) sourcesUsed.push('CBER HCTERS');
  if (enrichment.edgar?.totalMentions) sourcesUsed.push('SEC EDGAR');
  if (ws) sourcesUsed.push('Company Website');

  const fields: [string, string][] = [
    ['Company', input.accountName + (ws?.parentCompany ? ` (${ws.parentCompany})` : '')],
    ['Address', input.location || 'Not specified'],
    ['Modalities', ws?.modalities?.length ? ws.modalities.join(', ') : resolution.modality],
    ['GMP Status', ws?.cgmpStatus || (decrs ? `FDA-registered facility (FEI: ${decrs.feiNumber})` : 'Not confirmed')],
    ['Scale', ws?.scale || resolution.scale],
    ['Phase', resolution.phase !== 'Unknown' ? resolution.phase : 'Not determined from public data'],
    ['IND Visibility', resolution.accountType === 'cdmo' ? 'CDMO — manufacturing under sponsor INDs; pipeline not publicly attributable' : 'Innovator — see pipeline below'],
    ['Process Templates', resolution.vendorMapTab],
    ['Key Differentiators', ws?.keyDifferentiators?.slice(0, 3).join('; ') || 'Not identified'],
    ['Key Partnerships', ws?.partnerships?.length ? ws.partnerships.slice(0, 5).join(', ') : 'None identified'],
    ['Sales Temperature', inferTemperature(enrichment)],
    ['Data Sources Used', sourcesUsed.join(', ') || 'Limited'],
  ];

  if (enrichment.edgar?.totalMentions) {
    const filingInfo = enrichment.edgar.filings.slice(0, 2).map(f => `${f.filer} (${f.form}, ${f.date})`).join('; ');
    fields.push(['SEC Filing Intelligence', `${enrichment.edgar.totalMentions} filing(s): ${filingInfo}`]);
  }
  if (ws?.recentNews?.length) {
    fields.push(['Recent News', ws.recentNews[0].slice(0, 100)]);
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Field', 25), headerCell('Data — Source: Public Records')] }),
      ...fields.map(([label, value], i) => new TableRow({
        children: [
          cell(label, { bold: true, shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined, width: 25 }),
          cell(value, { shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined }),
        ],
      })),
    ],
  });
}

function buildPipelineSection(enrichment: EnrichmentData, resolution: ModalityResolution): (Paragraph | Table)[] {
  if (resolution.accountType === 'cdmo') {
    return [para('CDMO account — pipeline belongs to sponsor clients, not publicly attributable to this site. Individual molecule details are NOT PUBLICLY LISTED per CDMO confidentiality.', { italics: true, size: 19, color: COLOR_DIM })];
  }
  const studies = enrichment.clinicalTrials?.studies || [];
  if (!studies.length) return [para('No clinical trials found in public databases.', { italics: true, color: COLOR_DIM })];

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('NCT ID'), headerCell('Title'), headerCell('Phase'), headerCell('Status')] }),
      ...studies.slice(0, 8).map(s => new TableRow({ children: [
        cell(s.nctId), cell(s.title.slice(0, 60)), cell(s.phase), cell(s.status),
      ] })),
    ],
  })];
}

function buildStatusLegend(): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: (['WON', 'OPEN', 'COMPETITOR', 'NO_CONTACT'] as EquipmentStatusValue[]).map(s => new TableCell({
        shading: { type: ShadingType.SOLID, color: STATUS_COLORS[s], fill: STATUS_COLORS[s] },
        children: [new Paragraph({ children: [
          new TextRun({ text: `${STATUS_LABELS[s].icon}  ${STATUS_LABELS[s].text}`, size: 16, color: WHITE, bold: true }),
        ] })],
      })),
    })],
  });
}

function buildEquipmentTable(steps: ProcessStep[], vendor: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        headerCell('Unit Operation', 30),
        headerCell(`Our Product (${vendor})`, 30),
        headerCell('Status / Competitive Threats', 40),
      ] }),
      ...steps.map((step, i) => {
        const status = (step.status || 'NO_CONTACT') as EquipmentStatusValue;
        const statusColor = STATUS_COLORS[status];
        const bg = i % 2 === 0 ? COLOR_LIGHT_BG : undefined;

        return new TableRow({ children: [
          new TableCell({
            ...(bg ? { shading: { type: ShadingType.SOLID, color: bg, fill: bg } } : {}),
            width: { size: 30, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({ text: step.step, bold: true, size: 18 })] }),
              new Paragraph({ children: [new TextRun({ text: step.equipment, size: 15, color: COLOR_DIM })] }),
            ],
          }),
          new TableCell({
            ...(bg ? { shading: { type: ShadingType.SOLID, color: bg, fill: bg } } : {}),
            width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({
              text: step.product || '—',
              size: 18,
              bold: status === 'WON' || status === 'OPEN',
              color: status === 'WON' ? COLOR_WON : COLOR_TEXT,
            })] })],
          }),
          new TableCell({
            ...(bg ? { shading: { type: ShadingType.SOLID, color: bg, fill: bg } } : {}),
            width: { size: 40, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({
                text: `${STATUS_LABELS[status].icon} ${STATUS_LABELS[status].text}`,
                size: 16, bold: true, color: statusColor,
              })] }),
              ...(step.vendor && step.vendor !== '—' ? [new Paragraph({ children: [
                new TextRun({ text: step.vendor, size: 15, color: COLOR_DIM }),
              ] })] : []),
            ],
          }),
        ] });
      }),
    ],
  });
}

function buildStrategyTable(strategy: string): Table {
  const plays = parseStrategyPlays(strategy);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: plays.map(([label, text], i) => new TableRow({
      children: [
        cell(label, { bold: true, color: BRAND_PRIMARY, width: 15, shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined }),
        cell(text, { width: 85, shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined }),
      ],
    })),
  });
}

function buildTalkingPointsTable(talkingPoints: string): Table {
  const points = parseTalkingPoints(talkingPoints);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('TALKING POINT', 20), headerCell('SCRIPT', 80)] }),
      ...points.map(([label, text]) => new TableRow({
        children: [
          cell(label, { bold: true, color: BRAND_PRIMARY, width: 20 }),
          new TableCell({
            width: { size: 80, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: `"${text}"`, size: 18, italics: true })] })],
          }),
        ],
      })),
    ],
  });
}

function buildTreasureMapTable(steps: ProcessStep[], resolution: ModalityResolution): Table {
  const counts: Record<EquipmentStatusValue, number> = { WON: 0, OPEN: 0, COMPETITOR: 0, NO_CONTACT: 0 };
  for (const s of steps) counts[(s.status || 'NO_CONTACT') as EquipmentStatusValue]++;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Process Template'), headerCell('Status Summary')] }),
      new TableRow({ children: [
        cell(`${resolution.modality} ${resolution.scale}`),
        new TableCell({ children: [new Paragraph({ children: [
          new TextRun({ text: `✓ Our Product: ${counts.WON}  `, color: COLOR_WON, bold: true, size: 18 }),
          new TextRun({ text: `✕ Competitor: ${counts.COMPETITOR}  `, color: COLOR_COMP, bold: true, size: 18 }),
          new TextRun({ text: `● Open: ${counts.OPEN}  `, color: COLOR_OPEN, bold: true, size: 18 }),
          new TextRun({ text: `◆ Unknown: ${counts.NO_CONTACT}`, color: COLOR_NC, bold: true, size: 18 }),
        ] })] }),
      ] }),
      new TableRow({ children: [
        cell('Refer to the interactive Process Treasure Map in the web application for the full visual equipment flow with color-coded status.'),
        cell(''),
      ] }),
    ],
  });
}

function buildChecklistParagraphs(checklist: string, resolution: ModalityResolution, input: SiteIntelligenceInput): Paragraph[] {
  const standard = [
    `Process flow diagram — ${resolution.modality} ${resolution.scale} BFD — confirm correct version`,
    `Vendor equipment map — ${resolution.vendorMapTab} tab — reviewed and current`,
    `Competitive landscape summary for top 2 OPEN opportunities from Section 2`,
    `Process Treasure Map for ${input.accountName} — pre-populated from site intelligence query`,
  ];

  return [
    para('Standard items — always include, do not modify:', { bold: true }),
    spacer(50),
    ...standard.map(item => para(`☐  ${item}`, { size: 19 })),
    spacer(150),
    para(`${input.accountName}-specific items:`, { bold: true }),
    spacer(50),
    ...checklist.split('\n').filter(l => l.trim()).map(line =>
      para(`☐  ${line.replace(/^[-☐●\d.)\s]+/, '').trim()}`, { size: 19 })
    ),
  ];
}

// ── LLM Prompts — Justin's Tone ──

async function generateStrategy(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const openOps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT');
  const compOps = steps.filter(s => s.status === 'COMPETITOR');
  const wonOps = steps.filter(s => s.status === 'WON');

  // Build a detailed equipment context from the actual process steps
  const equipContext = steps.map(s => {
    const st = s.status || 'NO_CONTACT';
    return `${s.step}: ${s.product || '—'} [${st}]${s.vendor && s.vendor !== '—' ? ` (competitors: ${s.vendor})` : ''}`;
  }).join('\n');

  return callLlmSonnet(`You are writing the strategy section of a Process-1st Account Intelligence Report. Your output will be read by a salesperson from ${input.vendor} before they walk into a meeting with ${input.accountName}.

ACCOUNT CONTEXT:
- Company: ${input.accountName} (${resolution.accountType === 'cdmo' ? 'CDMO' : 'Innovator'})
- Modality: ${resolution.modality} ${resolution.scale}
- Phase: ${resolution.phase}
${input.salesGoal ? `- Sales goal: ${input.salesGoal}` : ''}
${enrichment.website?.parentCompany ? `- Parent company: ${enrichment.website.parentCompany}` : ''}
${enrichment.website?.partnerships?.length ? `- Known partnerships: ${enrichment.website.partnerships.join(', ')}` : ''}
${enrichment.website?.keyDifferentiators?.length ? `- Key capabilities: ${enrichment.website.keyDifferentiators.slice(0, 4).join(', ')}` : ''}
${enrichment.website?.recentNews?.length ? `- Recent news: ${enrichment.website.recentNews[0]}` : ''}
${enrichment.edgar?.filings?.length ? `- SEC filing: ${enrichment.edgar.filings[0].filer} mentioned this company (${enrichment.edgar.filings[0].form}, ${enrichment.edgar.filings[0].date})` : ''}

EQUIPMENT LANDSCAPE (${input.vendor} perspective):
${equipContext}

Write EXACTLY three plays using this format:
Primary: [two sentences]
Secondary: [two sentences]
Expansion: [two sentences]

EXAMPLE OF THE QUALITY EXPECTED (from a different account — do NOT copy this, use it only as a tone reference):
Primary: Move immediately on the downstream transition point — Cell Harvest and UFDF 1 are the first unit operations downstream of the competitor's upstream footprint, and winning them positions us as the lead downstream partner before any other vendor makes contact.
Secondary: Open the chromatography conversation in parallel — both capture and polishing steps are entirely unengaged, and the DynaChrom SU system is the right product to lead with against the incumbent Resolute Flowdrive.
Expansion: Once downstream equipment is anchored, build the full platform story: freeze/thaw, buffer preparation, and sterile filtration. The 2026 capacity expansion means new procurement cycles are forming now.

RULES:
- Name SPECIFIC products from the equipment table above (not generic categories)
- Name SPECIFIC competitor products where installed
- Explain WHY each play matters NOW (timeline pressure, procurement cycles, competitive dynamics)
- Each play must be a clear sequence: Primary = do this first, Secondary = do this in parallel, Expansion = do this after winning
- NO bullet points. NO markdown. NO generic "leverage our platform" language.
- Write like a 20-year bioprocess sales veteran coaching a colleague, not like an AI assistant.`);
}

async function generateTalkingPoints(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const openOps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT').slice(0, 4);
  const compOps = steps.filter(s => s.status === 'COMPETITOR').slice(0, 3);

  return callLlmSonnet(`You are writing three talking points for a Process-1st Account Intelligence Report. These are the exact words a ${input.vendor} salesperson will say in a meeting with ${input.accountName}.

ACCOUNT FACTS:
- ${input.accountName}, ${resolution.modality} ${resolution.scale}, ${resolution.phase}
- Type: ${resolution.accountType === 'cdmo' ? 'CDMO' : 'Innovator'}
${enrichment.website?.parentCompany ? `- Parent: ${enrichment.website.parentCompany}` : ''}
${enrichment.website?.partnerships?.length ? `- Partnerships: ${enrichment.website.partnerships.slice(0, 4).join(', ')}` : ''}
${enrichment.website?.keyDifferentiators?.length ? `- Their differentiator: ${enrichment.website.keyDifferentiators[0]}` : ''}
${enrichment.website?.recentNews?.length ? `- Latest news: ${enrichment.website.recentNews[0]}` : ''}
${enrichment.edgar?.filings?.length ? `- SEC: ${enrichment.edgar.filings[0].filer} filed ${enrichment.edgar.filings[0].form} mentioning them` : ''}
- Open opportunities: ${openOps.map(s => `${s.step} (${s.product || 'no product'})`).join(', ') || 'none identified'}
- Competitor positions: ${compOps.map(s => `${s.step} (${s.vendor})`).join(', ') || 'none identified'}

Write EXACTLY three lines in this format:
Opening Line: [one sentence]
Value Proposition: [one sentence]
Close / Next Step: [one sentence]

EXAMPLE OF THE QUALITY EXPECTED (from a different account):
Opening Line: "Congratulations on the commercial manufacturing agreement in September — going from groundbreaking in 2021 to BLA-stage production in four years is genuinely impressive, and it tells me that your downstream procurement decisions are about to get very serious very fast."
Value Proposition: "Sartorius has the upstream locked up, and that actually creates a clean opportunity for us — your depth filtration, TFF, and chromatography decisions are completely open, and we can come in as your downstream specialist with no conflict and a platform designed for AAV at 500L scale."
Close / Next Step: "I want to bring our AAV applications specialist and walk through your downstream layout with your process team — not a pitch, just an engineering conversation about what your TFF and chrom train needs to look like to support the BLA timeline you're on."

RULES:
- Opening MUST reference a specific fact about THIS company (a date, a partnership, a milestone, a news headline)
- Value Proposition MUST name specific equipment or unit operations from the open opportunities list
- Close MUST ask for something specific (a meeting, a demo, a visit, a technical review) — not "send more information"
- Sound like a confident human salesperson, not an AI. Use natural language, not corporate speak.
- Each line is direct speech in quotation marks.`);
}

async function generateChecklist(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const openOps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT').slice(0, 5);
  const compOps = steps.filter(s => s.status === 'COMPETITOR').slice(0, 3);

  return callLlmSonnet(`Write 4-6 account-specific meeting preparation checklist items for a ${input.vendor} salesperson visiting ${input.accountName}.

CONTEXT:
- ${input.accountName}: ${resolution.modality} ${resolution.scale}, ${resolution.phase}, ${resolution.accountType}
- Top OPEN opportunities: ${openOps.map(s => `${s.step} → ${s.product || 'our product TBD'}`).join('; ')}
- Competitor positions: ${compOps.map(s => `${s.step} → ${s.vendor}`).join('; ') || 'none confirmed'}
${enrichment.website?.partnerships?.length ? `- Partnerships: ${enrichment.website.partnerships.slice(0, 3).join(', ')}` : ''}
${enrichment.website?.keyDifferentiators?.length ? `- Their tech: ${enrichment.website.keyDifferentiators[0]}` : ''}

EXAMPLE (from a different account — use as FORMAT reference only):
AAV applications specialist briefing — confirm familiarity with MatiMAX cell line and 500L Sartorius STR upstream context
SUPRAcap Depth Filter System technical datasheet — account's first downstream decision post-harvest
DynaChrom SU vs. Sartorius Resolute Flowdrive performance comparison — AAV capture and polishing head-to-head
CryoMed Controlled-Rate Freezer AAV application data — two-player market vs. Sartorius Celsius CFT
G-CON POD modular cleanroom constraints — confirm all proposed equipment fits within POD footprint specifications

RULES:
- Each item: [specific document/action] — [why it matters for THIS account]
- Name specific equipment from the OPEN opportunities list
- Include at least one head-to-head comparison document against a named competitor
- Include at least one item about understanding the account's specific technology/platform
- NO generic items. NO numbering. One item per line.`);
}

async function callLlm(prompt: string): Promise<string> {
  return llmComplete(prompt, { maxTokens: 600 });
}

async function callLlmSonnet(prompt: string): Promise<string> {
  return llmComplete(prompt, { maxTokens: 800, model: 'claude-sonnet-4-20250514' });
}

// ── Parsers ──

function parseStrategyPlays(text: string): [string, string][] {
  const plays: [string, string][] = [];
  for (const label of ['Primary', 'Secondary', 'Expansion']) {
    const regex = new RegExp(`${label}[:\\s]+(.+?)(?=(?:Primary|Secondary|Expansion|$))`, 'is');
    const match = text.match(regex);
    if (match) plays.push([label, match[1].trim().replace(/\n+/g, ' ')]);
  }
  if (plays.length === 0) {
    // Fallback: split by lines
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length >= 3) {
      plays.push(['Primary', lines[0]], ['Secondary', lines[1]], ['Expansion', lines[2]]);
    }
  }
  return plays.length > 0 ? plays : [['Primary', text.trim()]];
}

function parseTalkingPoints(text: string): [string, string][] {
  const points: [string, string][] = [];
  for (const label of ['Opening Line', 'Opening', 'Value Proposition', 'Close / Next Step', 'Close']) {
    const regex = new RegExp(`${label}[:\\s]+[""]?(.+?)[""]?(?=(?:Opening|Value|Close|$))`, 'is');
    const match = text.match(regex);
    if (match) {
      const cleanLabel = label.replace('Opening Line', 'Opening Line').replace(/^Opening$/, 'Opening Line').replace(/^Close$/, 'Close / Next Step');
      points.push([cleanLabel, match[1].trim().replace(/[""]/g, '').replace(/\n+/g, ' ')]);
    }
  }
  if (points.length === 0) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length >= 3) {
      points.push(['Opening Line', lines[0]], ['Value Proposition', lines[1]], ['Close / Next Step', lines[2]]);
    }
  }
  return points.length > 0 ? points : [['Opening Line', text.trim()]];
}

function inferTemperature(enrichment: EnrichmentData): string {
  const hasTrials = (enrichment.clinicalTrials?.studies?.length || 0) > 0;
  const hasApprovals = (enrichment.openFda?.approvals?.length || 0) > 0;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;
  const hasHcters = enrichment.hcters?.hasRegistration;
  const wsCgmp = (enrichment.website?.cgmpStatus || '').toLowerCase();
  const hasCommercial = wsCgmp.includes('commercial') || wsCgmp.includes('cgmp');

  if (hasApprovals) return 'HOT — Approved products, active manufacturing';
  if (hasCommercial && hasEdgar) return 'HOT — cGMP commercial facility with active industry relationships';
  if (hasCommercial && hasTrials) return 'HOT — cGMP facility with active clinical pipeline';
  if (hasTrials) return 'WARM — Active clinical pipeline';
  if (hasEdgar && hasHcters) return 'WARM — Registered facility with industry filing activity';
  if (hasEdgar) return 'WARM — Active industry relationships';
  if (hasCommercial) return 'WARM — cGMP facility, procurement likely active';
  return 'COLD — Limited public intelligence';
}
