/**
 * Report Generator — Premium DOCX following Process-1st Template v3.
 * Design principle: This must look like a $5000 consulting document,
 * not a ChatGPT output. No bullet points in strategy. No markdown.
 * Specific product names. Confident, direct language.
 *
 * Reference: Process1st_Fate_Therapeutics_Detailed Intelligence Report.pdf
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
const BRAND_PRIMARY  = '2B5E8C'; // Deep blue (from reference PDF header)
const BRAND_DARK     = '1E4A6E'; // Darker blue
const BRAND_ACCENT   = 'D4740A'; // Warm orange (from reference PDF accents)
const BRAND_BG       = 'F5F8FC'; // Light blue-gray
const COLOR_WON      = '2E7D32'; // Green — confirmed installed
const COLOR_OPEN     = 'E67E22'; // Orange — open opportunity
const COLOR_COMP     = 'C0392B'; // Red — competitor
const COLOR_NC       = '7F8C8D'; // Gray — no contact
const COLOR_VERIFY   = '0097A7'; // Cyan — product exists, needs iPSC confirmation
const COLOR_NO_SAR   = '8E24AA'; // Purple — no Sartorius product, sole source gap
const COLOR_TEXT      = '1E293B'; // Slate-800
const COLOR_DIM       = '64748B'; // Slate-500
const COLOR_LIGHT_BG  = 'F1F5F9'; // Slate-100
const COLOR_WARM_BG   = 'FFF8E1'; // Warm yellow bg for callouts
const WHITE           = 'FFFFFF';

const STATUS_COLORS: Record<EquipmentStatusValue, string> = {
  WON: COLOR_WON, OPEN: COLOR_OPEN, COMPETITOR: COLOR_COMP,
  NO_CONTACT: COLOR_NC, VERIFY: COLOR_VERIFY, NO_SAR_PRODUCT: COLOR_NO_SAR,
};

const STATUS_LABELS: Record<EquipmentStatusValue, { icon: string; text: string }> = {
  WON:            { icon: '✓', text: 'Confirmed Installed' },
  OPEN:           { icon: '●', text: 'Open Opportunity' },
  COMPETITOR:     { icon: '✕', text: 'Competitor' },
  NO_CONTACT:     { icon: '◆', text: 'Equipment Unknown — Follow Up Required' },
  VERIFY:         { icon: '◇', text: 'Product Exists — Confirm iPSC Application' },
  NO_SAR_PRODUCT: { icon: '✗', text: 'No Sartorius Product' },
};

export async function generateReport(request: ReportRequest): Promise<Buffer> {
  const { input, enrichment, resolution, processSteps } = request;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Run all LLM sections in parallel
  const [strategy, talkingPoints, checklist, competitorAnalysis, executiveTeam, keyInsight] = await Promise.all([
    generateStrategy(input, enrichment, resolution, processSteps),
    generateTalkingPoints(input, enrichment, resolution, processSteps),
    generateChecklist(input, enrichment, resolution, processSteps),
    generateCompetitorAnalysis(input, enrichment, resolution, processSteps),
    generateExecutiveTeam(input, enrichment),
    generateKeyInsight(input, enrichment, resolution, processSteps),
  ]);

  const headerText = `${resolution.modality} Process Map`;
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21, color: COLOR_TEXT } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 900, right: 750, bottom: 900, left: 750 } },
      },
      headers: { default: new Header({ children: [
        new Paragraph({
          spacing: { after: 80 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BRAND_PRIMARY } },
          children: [
            new TextRun({ text: 'PROCESS-1ST LLC', bold: true, color: BRAND_PRIMARY, size: 16, font: 'Calibri' }),
            new TextRun({ text: `  |  ${input.accountName}, ${input.location || ''}  |  ${headerText}  |  Confidential`, size: 14, color: COLOR_DIM }),
          ],
        }),
      ] }) },
      footers: { default: new Footer({ children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' } },
          spacing: { before: 80 },
          children: [new TextRun({
            text: `Process-1st LLC  |  Confidential`,
            size: 14, color: COLOR_DIM,
          })],
        }),
      ] }) },
      children: [
        // ── Cover Block ──
        spacer(300),
        new Paragraph({
          children: [new TextRun({ text: 'PROCESS-1ST LLC', bold: true, size: 52, color: BRAND_PRIMARY, font: 'Calibri' })],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: 'Account Intelligence Report — Version 1', size: 28, color: COLOR_TEXT })],
        }),
        new Paragraph({
          spacing: { after: 400 },
          children: [new TextRun({
            text: `${input.accountName}  |  ${input.location || ''}  |  ${resolution.modality}  |  ${date}  |  ${input.vendor} Edition`,
            size: 20, color: COLOR_DIM,
          })],
        }),

        // ── SECTION 1: ACCOUNT HEADER ──
        sectionHeader('SECTION 1', 'ACCOUNT HEADER'),
        sectionTitle('Site Intelligence Profile and Facility Pipeline'),

        // ── 1A — Site Intelligence Profile ──
        subSectionTitle('1A — Site Intelligence Profile'),
        buildSiteProfileTable(input, enrichment, resolution, executiveTeam),
        spacer(100),

        // ── Sales Temperature Callout ──
        buildTemperatureCallout(enrichment, resolution),
        spacer(200),

        // ── 1B — Facility Pipeline ──
        subSectionTitle('1B — Facility Pipeline'),
        ...buildPipelineSection(enrichment, resolution),
        spacer(200),

        // ── SECTION 2: PROCESS MAP (new page) ──
        sectionHeader('SECTION 2', 'PROCESS MAP: EQUIPMENT POSITION AND COMPETITIVE LANDSCAPE', true),
        sectionTitle(`Full Process Equipment Map — ${resolution.modality}`),
        para(`Process template: ${resolution.modality} (${resolution.vendorMapTab}). Vendor: ${input.vendor}. ${buildProcessDescription(resolution)}`, { size: 19, color: COLOR_DIM, italics: true }),
        spacer(100),

        // Status key callout
        buildStatusKeyCallout(),
        spacer(100),
        buildStatusLegend(),
        spacer(100),
        buildEquipmentTable(processSteps, input.vendor),
        spacer(100),

        // Portfolio gap callout
        ...buildPortfolioGapCallout(processSteps, input.vendor),
        spacer(200),

        // ── SECTION 3: RECOMMENDED STRATEGY (new page) ──
        sectionHeader('SECTION 3', 'RECOMMENDED STRATEGY', true),
        sectionTitle('The Commercial Play for This Account'),
        spacer(50),

        // Key insight callout box
        buildInsightCallout(keyInsight),
        spacer(150),
        buildStrategyTable(strategy),
        spacer(200),

        // ── SECTION 4: COMPETITOR RECOMMENDATIONS (new page) ──
        sectionHeader('SECTION 4', 'COMPETITOR RECOMMENDATIONS', true),
        sectionTitle('What the Other Sales Teams Are Going to Say'),
        para(`Based on each competitor's product coverage in the ${resolution.modality} tab of Vendor Map. ${getTopCompetitorIntro(processSteps)}`, { size: 19, color: COLOR_DIM, italics: true }),
        spacer(100),
        ...buildCompetitorSection(competitorAnalysis),
        spacer(200),

        // ── SECTION 5: TALKING POINTS ──
        sectionHeader('SECTION 5', 'TALKING POINTS'),
        sectionTitle('Three Lines to Open, Position, and Close'),
        spacer(50),
        buildTalkingPointsTable(talkingPoints),
        spacer(200),

        // ── SECTION 6: PROCESS TREASURE MAP (new page) ──
        sectionHeader('SECTION 6', 'PROCESS TREASURE MAP', true),
        sectionTitle('Visual Opportunity Map — Equipment Coverage by Unit Operation'),
        spacer(50),
        buildTreasureMapTable(processSteps, resolution),
        spacer(200),

        // ── SECTION 7: MEETING PREPARATION CHECKLIST ──
        sectionHeader('SECTION 7', 'MEETING PREPARATION CHECKLIST'),
        sectionTitle('Required Materials Before Any Customer Meeting'),
        spacer(100),
        ...buildChecklistParagraphs(checklist, resolution, input),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Layout Helpers ──

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

function sectionHeader(number: string, title: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    spacing: { before: pageBreakBefore ? 0 : 200, after: 40 },
    keepNext: true,
    children: [
      ...(pageBreakBefore ? [new PageBreak()] : []),
      new TextRun({ text: `${number}    ${title}`, bold: true, size: 16, color: BRAND_PRIMARY, allCaps: true, font: 'Calibri' }),
    ],
  });
}

function sectionTitle(title: string): Paragraph {
  return new Paragraph({
    spacing: { after: 100 },
    keepNext: true,
    children: [new TextRun({ text: title, bold: true, size: 28, color: COLOR_TEXT })],
  });
}

function subSectionTitle(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 150, after: 80 },
    keepNext: true,
    children: [new TextRun({ text: title, bold: true, size: 22, color: BRAND_PRIMARY })],
  });
}

function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: BRAND_PRIMARY, fill: BRAND_PRIMARY },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({
      spacing: { before: 50, after: 50 },
      children: [new TextRun({ text, bold: true, color: WHITE, size: 18, font: 'Calibri' })],
    })],
  });
}

function cell(text: string, opts?: { bold?: boolean; color?: string; shading?: string; width?: number; italics?: boolean }): TableCell {
  return new TableCell({
    ...(opts?.shading ? { shading: { type: ShadingType.SOLID, color: opts.shading, fill: opts.shading } } : {}),
    ...(opts?.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, size: 18, bold: opts?.bold, color: opts?.color || COLOR_TEXT, italics: opts?.italics })],
    })],
  });
}

function multiLineCell(lines: Array<{ text: string; bold?: boolean; color?: string; size?: number; italics?: boolean }>, opts?: { shading?: string; width?: number }): TableCell {
  return new TableCell({
    ...(opts?.shading ? { shading: { type: ShadingType.SOLID, color: opts.shading, fill: opts.shading } } : {}),
    ...(opts?.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    children: lines.map(line => new Paragraph({
      spacing: { before: 20, after: 20 },
      children: [new TextRun({
        text: line.text,
        size: line.size || 18,
        bold: line.bold,
        color: line.color || COLOR_TEXT,
        italics: line.italics,
      })],
    })),
  });
}

// ── Section Builders ──

function buildSiteProfileTable(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, executiveTeam: string): Table {
  const ws = enrichment.website;
  const decrs = enrichment.decrs;

  const sourcesUsed: string[] = [];
  if (enrichment.clinicalTrials?.studies?.length) sourcesUsed.push('ClinicalTrials.gov');
  if (enrichment.openFda?.approvals?.length) sourcesUsed.push('openFDA');
  if (decrs) sourcesUsed.push('FDA DECRS');
  if (enrichment.hcters?.hasRegistration) sourcesUsed.push('CBER HCTERS');
  if (enrichment.edgar?.totalMentions) sourcesUsed.push('SEC EDGAR');
  if (ws) sourcesUsed.push('Company Website');

  const parentInfo = ws?.parentCompany
    ? ws.parentCompany
    : 'Independent — publicly traded or private (verify)';

  const fields: [string, string][] = [
    ['Company', input.accountName],
    ['Address', input.location || 'Not specified'],
    ['Parent Company', parentInfo],
    ['Modalities', ws?.modalities?.length ? ws.modalities.join(', ') : resolution.modality],
    ['GMP Status', ws?.cgmpStatus || (decrs ? `FDA-registered facility (FEI: ${decrs.feiNumber})` : 'Not confirmed from public sources')],
    ['Scale', ws?.scale || resolution.scale],
    ['Phase', resolution.phase !== 'Unknown' ? resolution.phase : 'Not determined from public data'],
    ['IND Visibility', resolution.accountType === 'cdmo'
      ? 'CDMO — manufacturing under sponsor INDs; pipeline not publicly attributable'
      : 'Internal pipeline company. See Facility Pipeline below.'],
  ];

  // Executive Team (LLM-generated)
  if (executiveTeam && executiveTeam.length > 20) {
    fields.push(['Executive Team', executiveTeam]);
  }

  fields.push(
    ['Process Templates', `${resolution.modality} (${resolution.vendorMapTab})`],
    ['Equipment Scope', buildEquipmentScope(enrichment, resolution)],
    ['Key Differentiators', ws?.keyDifferentiators?.slice(0, 4).join('; ') || 'Not identified from public sources'],
    ['Key Partnerships', ws?.partnerships?.length ? ws.partnerships.slice(0, 6).join(', ') : 'None identified'],
    ['Sales Temperature', inferTemperature(enrichment)],
    ['Data Sources', sourcesUsed.join(', ') || 'Limited public data'],
  );

  if (enrichment.edgar?.totalMentions) {
    const filingInfo = enrichment.edgar.filings.slice(0, 3).map(f => `${f.filer} (${f.form}, ${f.date})`).join('; ');
    fields.push(['SEC Filing Intelligence', `${enrichment.edgar.totalMentions} filing(s): ${filingInfo}`]);
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Field', 22), headerCell('Data — Source: Public Records')] }),
      ...fields.map(([label, value], i) => new TableRow({
        children: [
          cell(label, { bold: true, color: BRAND_PRIMARY, shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined, width: 22 }),
          cell(value, { shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined }),
        ],
      })),
    ],
  });
}

function buildEquipmentScope(enrichment: EnrichmentData, resolution: ModalityResolution): string {
  const ws = enrichment.website;
  const mentions = ws?.equipmentMentions || [];
  if (mentions.length > 0) {
    return `CONFIRMED: ${mentions.join(', ')}. All other equipment: NOT CONFIRMED — no public disclosure of specific equipment at this site.`;
  }
  return 'NOT CONFIRMED — no public disclosure of specific equipment at this site. All equipment should be classified as NO CONTACT until facility walkthrough.';
}

function buildTemperatureCallout(enrichment: EnrichmentData, resolution: ModalityResolution): Table {
  const temp = inferTemperatureShort(enrichment);
  const reason = inferTemperatureReason(enrichment, resolution);
  const tempColor = temp === 'HOT' ? 'C0392B' : temp === 'WARM' ? BRAND_ACCENT : COLOR_NC;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, color: COLOR_WARM_BG, fill: COLOR_WARM_BG },
        children: [
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [new TextRun({ text: temp, bold: true, size: 32, color: tempColor })],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: reason, size: 19, color: COLOR_TEXT })],
          }),
        ],
      }),
    ] })],
  });
}

function buildPipelineSection(enrichment: EnrichmentData, resolution: ModalityResolution): (Paragraph | Table)[] {
  if (resolution.accountType === 'cdmo') {
    return [
      para(`CDMO account — pipeline belongs to sponsor clients, not publicly attributable to this site.`, { italics: true, size: 19, color: COLOR_DIM }),
      para(`Individual molecule details are NOT PUBLICLY LISTED per CDMO confidentiality.`, { italics: true, size: 19, color: COLOR_DIM }),
    ];
  }

  const studies = enrichment.clinicalTrials?.studies || [];
  if (!studies.length) {
    return [para('No clinical trials found in public databases for this facility.', { italics: true, color: COLOR_DIM })];
  }

  // Enhanced pipeline table: Molecule Name, Molecule Type, Development Stage, Clinical Milestone Notes
  return [
    para(`Internal pipeline company. All programs are ${resolution.accountType === 'innovator' ? 'owned' : 'associated'} assets.`, { italics: true, size: 19, color: COLOR_DIM }),
    spacer(50),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [
          headerCell('Molecule Name', 22),
          headerCell('Molecule Type', 18),
          headerCell('Development Stage', 15),
          headerCell('Clinical Milestone Notes (Public)', 45),
        ] }),
        ...studies.slice(0, 10).map((s, i) => {
          const moleculeName = extractMoleculeName(s);
          const moleculeType = extractMoleculeType(s, resolution);
          const stage = s.phase || 'N/A';
          const stageColor = stage.includes('3') || stage.includes('III') ? COLOR_WON
            : stage.includes('2') || stage.includes('II') ? COLOR_OPEN
            : stage.includes('1') || stage.includes('I') ? BRAND_PRIMARY
            : COLOR_DIM;
          const notes = buildMilestoneNotes(s);
          const bg = i % 2 === 0 ? COLOR_LIGHT_BG : undefined;

          return new TableRow({ children: [
            cell(moleculeName, { bold: true, shading: bg, width: 22 }),
            cell(moleculeType, { shading: bg, width: 18 }),
            cell(stage, { bold: true, color: stageColor, shading: bg, width: 15 }),
            cell(notes, { shading: bg, width: 45 }),
          ] });
        }),
      ],
    }),
  ];
}

function buildStatusKeyCallout(): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, color: COLOR_WARM_BG, fill: COLOR_WARM_BG },
        children: [new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({ text: 'IMPORTANT: ', bold: true, color: BRAND_ACCENT, size: 18 }),
            new TextRun({ text: 'STATUS KEY: WON = confirmed by salesperson. NO CONTACT = equipment presence at this site is unknown — follow-up with manufacturing team required before qualifying. VERIFY = Sartorius has a product but its specific application has not been confirmed in literature or catalog. NO SAR PRODUCT = Sartorius has no equivalent — sole-source gap.', size: 17, color: COLOR_TEXT }),
          ],
        })],
      }),
    ] })],
  });
}

function buildStatusLegend(): Table {
  const statuses: EquipmentStatusValue[] = ['WON', 'NO_CONTACT', 'COMPETITOR', 'NO_SAR_PRODUCT', 'VERIFY'];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: statuses.map(s => new TableCell({
        shading: { type: ShadingType.SOLID, color: STATUS_COLORS[s], fill: STATUS_COLORS[s] },
        children: [new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [
            new TextRun({ text: `${STATUS_LABELS[s].text}`, size: 14, color: WHITE, bold: true }),
          ],
        })],
      })),
    })],
  });
}

function buildEquipmentTable(steps: ProcessStep[], vendor: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        headerCell('Unit Operation', 20),
        headerCell('Equipment Name (from BFD)', 22),
        headerCell(`Our Product (${vendor})`, 25),
        headerCell('Competitive Threats', 33),
      ] }),
      ...steps.map((step, i) => {
        const status = (step.status || 'NO_CONTACT') as EquipmentStatusValue;
        const statusColor = STATUS_COLORS[status] || COLOR_NC;
        const bg = i % 2 === 0 ? COLOR_LIGHT_BG : undefined;

        // Our Product column styling
        const productText = step.product || '—';
        const isNoSar = status === 'NO_SAR_PRODUCT';
        const productColor = isNoSar ? COLOR_NO_SAR
          : status === 'WON' ? COLOR_WON
          : status === 'VERIFY' ? COLOR_VERIFY
          : COLOR_TEXT;
        const productBold = status === 'WON' || status === 'VERIFY';

        // Competitor column
        const competitorLines: Array<{ text: string; bold?: boolean; color?: string; size?: number; italics?: boolean }> = [];
        if (step.vendor && step.vendor !== '—') {
          // Parse pipe-delimited vendors into labeled lines
          const vendors = step.vendor.split('|').map(v => v.trim()).filter(Boolean);
          for (const v of vendors) {
            competitorLines.push({ text: v, size: 16, color: COLOR_DIM });
          }
        }

        return new TableRow({ children: [
          // Unit Operation
          cell(step.step, { bold: true, shading: bg, width: 20 }),
          // Equipment Name (from BFD)
          cell(step.equipment, { shading: bg, width: 22, color: COLOR_DIM }),
          // Our Product with status color
          multiLineCell([
            { text: productText, bold: productBold, color: productColor },
            ...(isNoSar ? [{ text: 'NO SARTORIUS PRODUCT', size: 14, bold: true, color: COLOR_NO_SAR }] : []),
            ...(status === 'VERIFY' ? [{ text: '(? VERIFY)', size: 14, color: COLOR_VERIFY, italics: true }] : []),
          ], { shading: bg, width: 25 }),
          // Competitive Threats
          multiLineCell(
            competitorLines.length > 0 ? competitorLines : [{ text: '—', color: COLOR_DIM }],
            { shading: bg, width: 33 },
          ),
        ] });
      }),
    ],
  });
}

function buildPortfolioGapCallout(steps: ProcessStep[], vendor: string): Paragraph[] {
  const noSarSteps = steps.filter(s => s.status === 'NO_SAR_PRODUCT');
  if (noSarSteps.length === 0) return [];

  const gapOps = noSarSteps.map(s => s.step).join(', ');
  return [
    spacer(50),
    new Paragraph({
      spacing: { before: 50, after: 50 },
      children: [
        new TextRun({ text: 'GAP: ', bold: true, color: COLOR_NO_SAR, size: 19 }),
        new TextRun({
          text: `PORTFOLIO GAP: ${vendor} has no product for: ${gapOps}. These are sole-source positions for competitors. If the account uses these operations, competitor vendors have an entry point that cannot be displaced with ${vendor} equipment.`,
          size: 18, color: COLOR_TEXT,
        }),
      ],
    }),
  ];
}

function buildInsightCallout(insight: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      new TableCell({
        shading: { type: ShadingType.SOLID, color: COLOR_WARM_BG, fill: COLOR_WARM_BG },
        borders: {
          left: { style: BorderStyle.SINGLE, size: 6, color: BRAND_ACCENT },
        },
        children: [new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [new TextRun({ text: insight, bold: true, size: 20, color: COLOR_TEXT, italics: true })],
        })],
      }),
    ] })],
  });
}

function buildStrategyTable(strategy: string): Table {
  const plays = parseStrategyPlays(strategy);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: plays.map(([label, text], i) => {
      const labelColor = label === 'Primary' ? COLOR_WON : label === 'Secondary' ? BRAND_PRIMARY : BRAND_ACCENT;
      return new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, color: labelColor, fill: labelColor },
            width: { size: 14, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 60, after: 60 },
              children: [new TextRun({ text: label, bold: true, color: WHITE, size: 19 })],
            })],
          }),
          cell(text, { width: 86, shading: i % 2 === 0 ? COLOR_LIGHT_BG : undefined }),
        ],
      });
    }),
  });
}

function buildCompetitorSection(analysis: string): (Paragraph | Table)[] {
  const competitors = parseCompetitorAnalysis(analysis);
  if (competitors.length === 0) {
    return [para('No competitor analysis available.', { italics: true, color: COLOR_DIM })];
  }

  const elements: (Paragraph | Table)[] = [];
  for (const comp of competitors) {
    elements.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [
            headerCell(comp.name, 20),
            headerCell('Their Strategy  |  Threat to Sartorius  |  Counter-Move'),
          ] }),
          new TableRow({ children: [
            cell('', { width: 20 }),
            multiLineCell([
              { text: comp.strategy, size: 18 },
              { text: '', size: 10 },
              { text: `▸ Threat: ${comp.threat}`, size: 17, color: COLOR_COMP, italics: true },
              { text: '', size: 10 },
              { text: `▸ Counter: ${comp.counter}`, size: 17, color: COLOR_WON, italics: true },
            ]),
          ] }),
        ],
      }),
      spacer(100),
    );
  }
  return elements;
}

function buildTalkingPointsTable(talkingPoints: string): Table {
  const points = parseTalkingPoints(talkingPoints);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('TALKING POINT', 18), headerCell('SCRIPT', 82)] }),
      ...points.map(([label, text]) => new TableRow({
        children: [
          cell(label, { bold: true, color: BRAND_PRIMARY, width: 18 }),
          new TableCell({
            width: { size: 82, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [new TextRun({ text: `"${text.replace(/^["']+|["']+$/g, '')}"`, size: 18, italics: true })],
            })],
          }),
        ],
      })),
    ],
  });
}

function buildTreasureMapTable(steps: ProcessStep[], resolution: ModalityResolution): Table {
  const counts: Record<string, number> = { WON: 0, OPEN: 0, COMPETITOR: 0, NO_CONTACT: 0, VERIFY: 0, NO_SAR_PRODUCT: 0 };
  for (const s of steps) counts[(s.status || 'NO_CONTACT')]++;

  // Build step-by-step treasure map rows
  const rows = steps.map((step, i) => {
    const status = (step.status || 'NO_CONTACT') as EquipmentStatusValue;
    const statusColor = STATUS_COLORS[status] || COLOR_NC;
    const bg = i % 2 === 0 ? COLOR_LIGHT_BG : undefined;

    return new TableRow({ children: [
      cell(step.step, { bold: true, shading: bg, width: 35 }),
      cell(step.product || '—', { shading: bg, width: 35 }),
      new TableCell({
        shading: { type: ShadingType.SOLID, color: statusColor, fill: statusColor },
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: STATUS_LABELS[status]?.text || 'Unknown', size: 15, color: WHITE, bold: true })],
        })],
      }),
    ] });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        headerCell('Unit Operation', 35),
        headerCell('Sartorius Product', 35),
        headerCell('Status', 30),
      ] }),
      ...rows,
      // Summary row
      new TableRow({ children: [
        cell('TOTALS', { bold: true, width: 35 }),
        cell('', { width: 35 }),
        cell(
          `✓ Won: ${counts.WON}  ●Open: ${counts.OPEN}  ✕Comp: ${counts.COMPETITOR}  ◆NC: ${counts.NO_CONTACT}  ◇Verify: ${counts.VERIFY}  ✗NoSar: ${counts.NO_SAR_PRODUCT}`,
          { width: 30, bold: true },
        ),
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

// ── Pipeline Helpers ──

function extractMoleculeName(study: { nctId: string; title: string; interventions: Array<{ type: string; name: string }> }): string {
  // Try to get molecule name from interventions first
  for (const iv of study.interventions) {
    if (iv.name && iv.name.length > 2 && iv.name.length < 40) return `${iv.name} (${study.nctId})`;
  }
  // Fallback: extract first capitalized code from title
  const code = study.title.match(/\b([A-Z]{2,4}[\-]?\d{3,6})\b/);
  if (code) return `${code[1]} (${study.nctId})`;
  return study.nctId;
}

function extractMoleculeType(study: { interventions: Array<{ type: string; name: string }> }, resolution: ModalityResolution): string {
  const types = study.interventions.map(iv => iv.type).filter(Boolean);
  if (types.includes('GENETIC')) return 'Gene Therapy';
  if (types.includes('BIOLOGICAL')) return resolution.modality.includes('mAb') ? 'Monoclonal Antibody' : resolution.modality;
  if (types.includes('DRUG')) return 'Small Molecule / Drug';
  return resolution.modality;
}

function buildMilestoneNotes(study: { title: string; status: string; phase: string; conditions: string[]; sponsor?: string; collaborators?: string[] }): string {
  const parts: string[] = [];
  if (study.conditions?.length) parts.push(`Indications: ${study.conditions.slice(0, 3).join(', ')}`);
  if (study.status) parts.push(study.status);
  if (study.sponsor) parts.push(`Sponsor: ${study.sponsor}`);
  if (study.collaborators?.length) parts.push(`Collab: ${study.collaborators.slice(0, 2).join(', ')}`);
  return parts.join('. ') || study.title.slice(0, 80);
}

function buildProcessDescription(resolution: ModalityResolution): string {
  const mod = resolution.modality.toLowerCase();
  if (mod.includes('ipsc') || mod.includes('car-t') || mod.includes('cell therapy')) {
    return 'The process begins from a master cell bank and proceeds through directed differentiation, T-cell expansion, harvest, formulation, and inventory cryopreservation. This is NOT the autologous process — there is no patient apheresis or vein-to-vein cold chain.';
  }
  if (mod.includes('mab')) return 'Standard monoclonal antibody platform: upstream cell cultivation through downstream purification, formulation, and fill.';
  if (mod.includes('aav')) return 'AAV gene therapy vector manufacturing: transfection/infection, harvest, multi-step purification, and cryopreservation.';
  if (mod.includes('mrna')) return 'mRNA manufacturing: in-vitro transcription, purification, LNP encapsulation, and fill/finish.';
  if (mod.includes('lenti')) return 'Lentiviral vector manufacturing: transfection, harvest, purification, and cryopreservation.';
  return '';
}

function getTopCompetitorIntro(steps: ProcessStep[]): string {
  const compSteps = steps.filter(s => s.status === 'COMPETITOR');
  if (compSteps.length === 0) return 'No confirmed competitor positions.';
  const vendors = new Set(compSteps.flatMap(s => (s.vendor || '').split('|').map(v => v.trim().split(':')[0].trim())).filter(Boolean));
  return `${vendors.size} competitor vendor(s) identified with confirmed or likely positions.`;
}

// ── Temperature Helpers ──

function inferTemperature(enrichment: EnrichmentData): string {
  const temp = inferTemperatureShort(enrichment);
  return `${temp}. ${inferTemperatureReason(enrichment, { phase: '', modality: '' } as any)}`;
}

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
  const hasApprovals = (enrichment.openFda?.approvals?.length || 0) > 0;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;
  const hasTrials = (enrichment.clinicalTrials?.studies?.length || 0) > 0;
  const cgmp = (enrichment.website?.cgmpStatus || '').toLowerCase();
  const ws = enrichment.website;

  const reasons: string[] = [];
  if (hasApprovals) reasons.push('Approved products with active manufacturing');
  if (hasTrials) reasons.push(`${enrichment.clinicalTrials.studies.length} active clinical program(s)`);
  if (hasEdgar) reasons.push('Active SEC filing activity');
  if (cgmp.includes('commercial')) reasons.push('cGMP commercial facility');
  if (ws?.equipmentMentions?.length) reasons.push(`${ws.equipmentMentions.length} confirmed equipment mention(s)`);
  if (ws?.partnerships?.length) reasons.push(`${ws.partnerships.length} known partnership(s)`);
  if (reasons.length === 0) reasons.push('Limited public intelligence — no confirmed expansion');
  return reasons.join('. ');
}

// ── LLM Prompts ──

async function generateStrategy(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
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

RULES:
- Each item: [specific document/action] — [why it matters for THIS account]
- Name specific equipment from the OPEN opportunities list
- Include at least one head-to-head comparison document against a named competitor
- Include at least one item about understanding the account's specific technology/platform
- NO generic items. NO numbering. One item per line.`);
}

async function generateCompetitorAnalysis(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const compSteps = steps.filter(s => s.status === 'COMPETITOR');
  const allSteps = steps.map(s => `${s.step}: Our=${s.product||'—'} [${s.status}] Comp=${s.vendor||'—'}`).join('\n');

  return callLlmSonnet(`You are writing the Competitor Recommendations section of a Process-1st Account Intelligence Report for ${input.accountName} (${resolution.modality}).

EQUIPMENT LANDSCAPE:
${allSteps}

ACCOUNT CONTEXT:
${enrichment.website?.partnerships?.length ? `- Known partnerships: ${enrichment.website.partnerships.join(', ')}` : ''}
${enrichment.website?.equipmentMentions?.length ? `- Equipment mentions: ${enrichment.website.equipmentMentions.join(', ')}` : ''}

Write analysis for EXACTLY these competitors: Cytiva, Thermo Fisher, Repligen. If MilliporeSigma has significant presence, include them too.

For EACH competitor, write in this EXACT format:
[COMPETITOR_NAME]
STRATEGY: [one paragraph: how they will pitch, which products they lead with, which accounts they reference]
THREAT: [one sentence: the specific threat to ${input.vendor}, what makes them dangerous at THIS account]
COUNTER: [one sentence: how ${input.vendor} should counter — name specific products and advantages]

RULES:
- Name specific competitor products (e.g., "Xuri W25", "AKTA", "Sepax C-Pro", "XCell ATF")
- Name specific ${input.vendor} counter-products
- Reference the equipment table positions above
- Be direct and tactical, not diplomatic. This is internal sales intelligence.
- NO bullet points. NO markdown formatting.`);
}

async function generateExecutiveTeam(input: SiteIntelligenceInput, enrichment: EnrichmentData): Promise<string> {
  const ws = enrichment.website;
  if (!ws) return '';

  return callLlmSonnet(`Based on the following public information about ${input.accountName}, identify the executive leadership team relevant to manufacturing and procurement decisions.

KNOWN DATA:
${ws.keyDifferentiators?.length ? `- Company focus: ${ws.keyDifferentiators.join(', ')}` : ''}
${ws.parentCompany ? `- Parent company: ${ws.parentCompany}` : ''}
${enrichment.edgar?.filings?.length ? `- SEC filings mention: ${enrichment.edgar.filings.map(f => f.excerpt.slice(0, 100)).join('; ')}` : ''}
${ws.recentNews?.length ? `- Recent news: ${ws.recentNews.slice(0, 2).join('; ')}` : ''}

List key executives in this format (one per line):
Name, Title — [brief context if available]
NOTE: Head of Manufacturing, Head of Technical Operations, and Head of Process Development not publicly listed — identify from LinkedIn before first meeting

RULES:
- Only include names that appear in public filings, press releases, or company website
- If you cannot confirm specific names, say "Not publicly available — research via LinkedIn required"
- Focus on: CEO, CFO, Head of Manufacturing/Operations, VP of Process Development
- Keep it concise — max 4-5 entries`);
}

async function generateKeyInsight(input: SiteIntelligenceInput, enrichment: EnrichmentData, resolution: ModalityResolution, steps: ProcessStep[]): Promise<string> {
  const wonCount = steps.filter(s => s.status === 'WON').length;
  const openCount = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT').length;
  const compCount = steps.filter(s => s.status === 'COMPETITOR').length;

  return callLlmSonnet(`Write ONE key strategic insight (2-3 sentences) for a ${input.vendor} salesperson about ${input.accountName}.

CONTEXT:
- Modality: ${resolution.modality} ${resolution.scale}
- Equipment: ${wonCount} WON, ${openCount} open/unknown, ${compCount} competitor
- Type: ${resolution.accountType}
${enrichment.website?.keyDifferentiators?.length ? `- Their tech: ${enrichment.website.keyDifferentiators[0]}` : ''}
${enrichment.website?.recentNews?.length ? `- News: ${enrichment.website.recentNews[0]}` : ''}

Write a single paragraph that captures the ONE thing the salesperson must understand before walking in. This goes in a highlighted callout box.

Example quality: "Fate's process starts from a cell bank and manufactures in batches — it is closer to a biologic than it is to CAR-T. The salesperson who maps that correctly before walking in will win. The salesperson who pitches autologous cell therapy will lose the room."

RULES:
- Must be specific to THIS account and modality
- Must contain an actionable insight, not a generic observation
- Bold, direct tone — this is a wake-up call, not a summary
- 2-3 sentences max. No markdown.`);
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
      const cleanLabel = label.replace(/^Opening$/, 'Opening Line').replace(/^Close$/, 'Close / Next Step');
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

interface CompetitorEntry { name: string; strategy: string; threat: string; counter: string; }

function parseCompetitorAnalysis(text: string): CompetitorEntry[] {
  const entries: CompetitorEntry[] = [];
  const competitors = ['Cytiva', 'Thermo Fisher', 'Repligen', 'MilliporeSigma'];

  // Build a boundary pattern for lookahead
  const compPattern = competitors.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  for (const comp of competitors) {
    // Match competitor name (case-insensitive, with optional punctuation)
    const namePattern = comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Try structured format: NAME\nSTRATEGY: ...\nTHREAT: ...\nCOUNTER: ...
    const regex = new RegExp(
      `${namePattern}[\\s\\n:]*(?:STRATEGY|Strategy|strategy)[:\\s]+(.+?)(?:THREAT|Threat|threat)[:\\s]+(.+?)(?:COUNTER|Counter|counter)[:\\s]+(.+?)(?=${compPattern}|$)`,
      'is'
    );
    const match = text.match(regex);
    if (match) {
      entries.push({
        name: comp,
        strategy: match[1].trim().replace(/\n+/g, ' ').replace(/^[:\s]+/, ''),
        threat: match[2].trim().replace(/\n+/g, ' ').replace(/^[:\s]+/, ''),
        counter: match[3].trim().replace(/\n+/g, ' ').replace(/^[:\s]+/, ''),
      });
      continue;
    }

    // Fallback: try to find a section for this competitor with any structure
    const sectionRegex = new RegExp(`${namePattern}[\\s\\n:]+(.+?)(?=${compPattern}|$)`, 'is');
    const sectionMatch = text.match(sectionRegex);
    if (sectionMatch) {
      const block = sectionMatch[1].trim();
      // Try to split by Threat/Counter markers
      const threatSplit = block.split(/(?:Threat|THREAT)[:\s]+/i);
      const strategy = threatSplit[0]?.replace(/^(?:STRATEGY|Strategy)[:\s]+/i, '').trim() || block.slice(0, 200);
      let threat = 'See detailed report';
      let counter = 'Requires further analysis';
      if (threatSplit[1]) {
        const counterSplit = threatSplit[1].split(/(?:Counter|COUNTER)[:\s]+/i);
        threat = counterSplit[0]?.trim().replace(/\n+/g, ' ') || threat;
        counter = counterSplit[1]?.trim().replace(/\n+/g, ' ') || counter;
      }
      entries.push({ name: comp, strategy: strategy.replace(/\n+/g, ' '), threat, counter });
    }
  }
  return entries;
}
