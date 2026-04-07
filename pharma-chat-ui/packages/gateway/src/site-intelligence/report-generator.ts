/**
 * Report Generator — produces DOCX files following Process-1st Template v3.
 * 7 sections, 19 tables. Equipment table is 100% deterministic from Vendor Map.
 * Strategy, Talking Points, and Checklist are LLM-generated.
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, PageOrientation, Header, Footer,
  type ITableCellOptions,
} from 'docx';
import { llmComplete } from './llm-client';
import type {
  ReportRequest, ProcessStep, EquipmentStatusValue,
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
} from '@p1/shared';

// ── Colors ──
const COLOR_WON        = '10B981';
const COLOR_OPEN       = 'F59E0B';
const COLOR_COMPETITOR = 'EF4444';
const COLOR_NO_CONTACT = '94A3B8';
const COLOR_HEADER_BG  = '0891B2';

const STATUS_LABELS: Record<EquipmentStatusValue, string> = {
  WON: '✓ WON — Already installed',
  OPEN: '● OPEN — Priority opportunity',
  COMPETITOR: '✕ COMPETITOR — Competitive threat',
  NO_CONTACT: '◆ NO CONTACT — First mover territory',
};

const STATUS_COLORS: Record<EquipmentStatusValue, string> = {
  WON: COLOR_WON,
  OPEN: COLOR_OPEN,
  COMPETITOR: COLOR_COMPETITOR,
  NO_CONTACT: COLOR_NO_CONTACT,
};

export async function generateReport(request: ReportRequest): Promise<Buffer> {
  const { input, enrichment, resolution, processSteps } = request;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Generate LLM sections in parallel
  const [strategy, talkingPoints, checklist] = await Promise.all([
    generateStrategy(input, enrichment, resolution, processSteps),
    generateTalkingPoints(input, enrichment, resolution),
    generateChecklist(input, enrichment, resolution, processSteps),
  ]);

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      headers: { default: new Header({ children: [
        new Paragraph({ children: [
          new TextRun({ text: 'PROCESS-1ST LLC', bold: true, color: COLOR_HEADER_BG, size: 16 }),
          new TextRun({ text: '  |  Account Intelligence Report  |  Confidential', size: 16, color: '94A3B8' }),
        ] }),
      ] }) },
      footers: { default: new Footer({ children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: `Process-1st LLC  |  ${input.accountName}  |  ${date}  |  For ${input.vendor} Sales Team Use Only`,
            size: 14, color: '94A3B8',
          })],
        }),
      ] }) },
      children: [
        // ── Title ──
        new Paragraph({ children: [
          new TextRun({ text: 'PROCESS-1ST LLC', bold: true, size: 36, color: COLOR_HEADER_BG }),
        ] }),
        new Paragraph({ children: [
          new TextRun({ text: 'Account Intelligence Report', size: 28 }),
        ] }),
        new Paragraph({ children: [
          new TextRun({
            text: `${input.accountName}  |  ${resolution.modality} ${resolution.scale}  |  ${date}`,
            size: 22, color: '64748B',
          }),
        ] }),
        new Paragraph({ text: '' }),

        // ── Section 1A: Site Intelligence Profile ──
        sectionHeading('SECTION 1', 'Site Intelligence Profile'),
        buildSiteProfileTable(input, enrichment, resolution),
        new Paragraph({ text: '' }),

        // ── Section 1B: Facility Pipeline ──
        sectionHeading('SECTION 1B', 'Facility Pipeline'),
        ...buildPipelineSection(enrichment, resolution),
        new Paragraph({ text: '' }),

        // ── Section 2: Equipment Table ──
        sectionHeading('SECTION 2', 'Process Map — Equipment Position and Competitive Landscape'),
        new Paragraph({ children: [
          new TextRun({
            text: `Primary modality: ${resolution.modality} ${resolution.scale}. Vendor perspective: ${input.vendor}.`,
            size: 20, color: '64748B', italics: true,
          }),
        ] }),
        new Paragraph({ text: '' }),
        buildStatusLegend(),
        new Paragraph({ text: '' }),
        buildEquipmentTable(processSteps, input.vendor),
        new Paragraph({ text: '' }),

        // ── Section 3: Strategy ──
        sectionHeading('SECTION 3', 'Recommended Strategy'),
        ...buildStrategySection(strategy),
        new Paragraph({ text: '' }),

        // ── Section 4: Talking Points ──
        sectionHeading('SECTION 4', 'Talking Points'),
        ...buildTalkingPointsSection(talkingPoints),
        new Paragraph({ text: '' }),

        // ── Section 5: Cross-Selling (Placeholder) ──
        sectionHeading('SECTION 5', 'Cross-Selling Opportunities'),
        new Paragraph({ children: [
          new TextRun({ text: 'PLACEHOLDER — Content to be added by Process-1st', italics: true, color: '94A3B8' }),
        ] }),
        new Paragraph({ text: '' }),

        // ── Section 6: Process Treasure Map ──
        sectionHeading('SECTION 6', 'Process Treasure Map'),
        buildTreasureMapSection(processSteps, resolution),
        new Paragraph({ text: '' }),

        // ── Section 7: Meeting Checklist ──
        sectionHeading('SECTION 7', 'Meeting Preparation Checklist'),
        ...buildChecklistSection(checklist, resolution),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Section Builders ──

function sectionHeading(number: string, title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 400 },
    children: [
      new TextRun({ text: number + '  ', bold: true, size: 24, color: COLOR_HEADER_BG }),
      new TextRun({ text: title, bold: true, size: 24 }),
    ],
  });
}

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: COLOR_HEADER_BG },
    children: [new Paragraph({ children: [
      new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 }),
    ] })],
  });
}

function cell(text: string, opts?: Partial<ITableCellOptions>): TableCell {
  return new TableCell({
    ...opts,
    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
  });
}

function buildSiteProfileTable(
  input: SiteIntelligenceInput,
  enrichment: EnrichmentData,
  resolution: ModalityResolution,
): Table {
  const ws = enrichment.website;
  const decrs = enrichment.decrs;

  const fields: [string, string][] = [
    ['Company', input.accountName],
    ['Address', input.location || 'Not specified'],
    ['Modalities', resolution.modality + (ws?.modalities?.length ? ` (${ws.modalities.join(', ')})` : '')],
    ['GMP Status', ws?.cgmpStatus || (decrs ? 'FDA-registered facility' : 'Not confirmed')],
    ['Scale', resolution.scale],
    ['Phase', resolution.phase],
    ['IND Visibility', resolution.accountType === 'cdmo' ? 'CDMO — pipeline belongs to sponsor clients' : 'Innovator — see pipeline below'],
    ['Process Templates', resolution.vendorMapTab || `${resolution.modality} ${resolution.scale}`],
    ['FEI Number', decrs?.feiNumber || 'Not found in DECRS'],
    ['Sales Temperature', inferTemperature(enrichment)],
    ['Data Sources Used', resolution.signals.length > 0 ? 'CT.gov, openFDA, DECRS, HCTERS, SEC EDGAR, Company Website' : 'Limited public data'],
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Field'), headerCell('Data — Source: Public Records')] }),
      ...fields.map(([label, value]) => new TableRow({
        children: [
          cell(label, { width: { size: 25, type: WidthType.PERCENTAGE } }),
          cell(value),
        ],
      })),
    ],
  });
}

function buildPipelineSection(enrichment: EnrichmentData, resolution: ModalityResolution): (Paragraph | Table)[] {
  if (resolution.accountType === 'cdmo') {
    return [new Paragraph({ children: [
      new TextRun({
        text: 'CDMO account — pipeline belongs to sponsor clients, not publicly attributable to this site.',
        italics: true, size: 20,
      }),
    ] })];
  }

  const studies = enrichment.clinicalTrials?.studies || [];
  if (!studies.length) {
    return [new Paragraph({ children: [
      new TextRun({ text: 'No clinical trials found in public databases.', italics: true, size: 20 }),
    ] })];
  }

  const rows = studies.slice(0, 10).map(s => new TableRow({
    children: [
      cell(s.nctId),
      cell(s.title.slice(0, 80) + (s.title.length > 80 ? '...' : '')),
      cell(s.phase),
      cell(s.status),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        headerCell('NCT ID'), headerCell('Title'), headerCell('Phase'), headerCell('Status'),
      ] }),
      ...rows,
    ],
  })];
}

function buildStatusLegend(): Table {
  const entries: [EquipmentStatusValue, string][] = [
    ['WON', STATUS_LABELS.WON],
    ['OPEN', STATUS_LABELS.OPEN],
    ['COMPETITOR', STATUS_LABELS.COMPETITOR],
    ['NO_CONTACT', STATUS_LABELS.NO_CONTACT],
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: entries.map(([status, label]) => new TableCell({
        shading: { type: ShadingType.SOLID, color: STATUS_COLORS[status], fill: STATUS_COLORS[status] },
        children: [new Paragraph({ children: [
          new TextRun({ text: label, size: 16, color: 'FFFFFF', bold: true }),
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
        headerCell('Unit Operation'),
        headerCell('Equipment Name'),
        headerCell(`Our Product (${vendor})`),
        headerCell('Competitive Threats'),
      ] }),
      ...steps.map(step => {
        const status = (step.status || 'NO_CONTACT') as EquipmentStatusValue;
        const statusColor = STATUS_COLORS[status];

        return new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: step.step, size: 18, bold: true })] }),
                new Paragraph({ children: [new TextRun({ text: ` ${status.replace('_', ' ')}`, size: 14, color: statusColor, bold: true })] }),
              ],
            }),
            cell(step.equipment),
            new TableCell({
              children: [new Paragraph({ children: [
                new TextRun({ text: step.product || '—', size: 18, bold: status === 'WON' || status === 'OPEN' }),
              ] })],
            }),
            cell(step.vendor || '—'),
          ],
        });
      }),
    ],
  });
}

function buildTreasureMapSection(steps: ProcessStep[], resolution: ModalityResolution): Table {
  const counts: Record<EquipmentStatusValue, number> = { WON: 0, OPEN: 0, COMPETITOR: 0, NO_CONTACT: 0 };
  for (const s of steps) {
    const status = (s.status || 'NO_CONTACT') as EquipmentStatusValue;
    counts[status]++;
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Process Template'), headerCell('Status Summary')] }),
      new TableRow({ children: [
        cell(`${resolution.modality} ${resolution.scale}`),
        cell(`WON: ${counts.WON}  |  OPEN: ${counts.OPEN}  |  COMPETITOR: ${counts.COMPETITOR}  |  NO CONTACT: ${counts.NO_CONTACT}`),
      ] }),
      new TableRow({ children: [
        cell('Refer to the interactive Process Treasure Map in the web application for the full visual equipment flow with color-coded status badges.'),
        cell(''),
      ] }),
    ],
  });
}

function buildStrategySection(strategy: string): Paragraph[] {
  return strategy.split('\n').filter(l => l.trim()).map(line => {
    const match = line.match(/^(Primary|Secondary|Expansion)\s*[:|]\s*(.*)/i);
    if (match) {
      return new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: match[1] + ': ', bold: true, size: 20 }),
          new TextRun({ text: match[2], size: 20 }),
        ],
      });
    }
    return new Paragraph({ children: [new TextRun({ text: line, size: 20 })] });
  });
}

function buildTalkingPointsSection(talkingPoints: string): Paragraph[] {
  return talkingPoints.split('\n').filter(l => l.trim()).map(line => {
    const match = line.match(/^(Opening|Value Proposition|Close)\s*[:|]\s*(.*)/i);
    if (match) {
      return new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: match[1] + ': ', bold: true, size: 20 }),
          new TextRun({ text: `"${match[2]}"`, italics: true, size: 20 }),
        ],
      });
    }
    return new Paragraph({ children: [new TextRun({ text: line, size: 20 })] });
  });
}

function buildChecklistSection(checklist: string, resolution: ModalityResolution): Paragraph[] {
  const standardItems = [
    `☐ Process flow diagram — ${resolution.modality} ${resolution.scale} BFD — confirm correct version`,
    `☐ Vendor equipment map — ${resolution.modality} ${resolution.scale} tab — reviewed and current`,
    `☐ Competitive landscape summary for top 2 OPEN opportunities from Section 2`,
    `☐ Process Treasure Map for this account — pre-populated from site intelligence query`,
  ];

  const items = [
    new Paragraph({
      spacing: { before: 120 },
      children: [new TextRun({ text: 'Standard items:', bold: true, size: 20 })],
    }),
    ...standardItems.map(item => new Paragraph({
      children: [new TextRun({ text: item, size: 20 })],
    })),
    new Paragraph({ text: '' }),
    new Paragraph({
      children: [new TextRun({ text: 'Account-specific items:', bold: true, size: 20 })],
    }),
    ...checklist.split('\n').filter(l => l.trim()).map(line =>
      new Paragraph({ children: [new TextRun({ text: `☐ ${line.replace(/^[-☐●]\s*/, '')}`, size: 20 })] })
    ),
  ];

  return items;
}

// ── LLM Generation ──

async function generateStrategy(
  input: SiteIntelligenceInput,
  enrichment: EnrichmentData,
  resolution: ModalityResolution,
  steps: ProcessStep[],
): Promise<string> {
  const openOps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT');
  const competitorOps = steps.filter(s => s.status === 'COMPETITOR');

  const prompt = `Write exactly 3 strategic plays for a ${input.vendor} salesperson approaching ${input.accountName}.

Account context:
- Modality: ${resolution.modality} ${resolution.scale}
- Phase: ${resolution.phase}
- Account type: ${resolution.accountType}
${input.salesGoal ? `- Sales goal: ${input.salesGoal}` : ''}
- Open opportunities: ${openOps.map(s => s.step).join(', ') || 'None identified'}
- Competitor positions: ${competitorOps.map(s => `${s.step} (${s.vendor})`).join(', ') || 'None identified'}
${enrichment.website?.partnerships.length ? `- Known partnerships: ${enrichment.website.partnerships.join(', ')}` : ''}

Format each as:
Primary: [two sentences max]
Secondary: [two sentences max]
Expansion: [two sentences max]

Be specific to this account. No generic statements.`;

  return await callLlm(prompt);
}

async function generateTalkingPoints(
  input: SiteIntelligenceInput,
  enrichment: EnrichmentData,
  resolution: ModalityResolution,
): Promise<string> {
  const prompt = `Write exactly 3 talking points for a ${input.vendor} salesperson meeting with ${input.accountName}.

Context: ${resolution.modality} ${resolution.scale}, ${resolution.phase}, ${resolution.accountType}
${enrichment.website?.partnerships.length ? `Known partnerships: ${enrichment.website.partnerships.join(', ')}` : ''}
${enrichment.edgar?.filings.length ? `Recent SEC filings mention this company` : ''}

Format as:
Opening: [one sentence, reference something specific to this account]
Value Proposition: [one sentence, core technical argument]
Close: [one sentence, specific next step to ask for]

Each must be account-specific. No generic lines.`;

  return await callLlm(prompt);
}

async function generateChecklist(
  input: SiteIntelligenceInput,
  enrichment: EnrichmentData,
  resolution: ModalityResolution,
  steps: ProcessStep[],
): Promise<string> {
  const openOps = steps.filter(s => s.status === 'OPEN' || s.status === 'NO_CONTACT').slice(0, 3);

  const prompt = `Write 2-4 account-specific meeting preparation items for ${input.accountName} (${resolution.modality} ${resolution.scale}).

Context:
- Vendor: ${input.vendor}
- Top opportunities: ${openOps.map(s => `${s.step}: ${s.product}`).join(', ')}
${enrichment.website?.partnerships.length ? `- Partnerships: ${enrichment.website.partnerships.join(', ')}` : ''}

Each item should be one line starting with an actionable instruction. Be specific to the account's modality and stage. No generic items.`;

  return await callLlm(prompt);
}

async function callLlm(prompt: string): Promise<string> {
  return llmComplete(prompt, { maxTokens: 500 });
}

function inferTemperature(enrichment: EnrichmentData): string {
  const hasTrials = (enrichment.clinicalTrials?.studies?.length || 0) > 0;
  const hasApprovals = (enrichment.openFda?.approvals?.length || 0) > 0;
  const hasEdgar = (enrichment.edgar?.totalMentions || 0) > 0;

  if (hasApprovals) return 'HOT — Approved products, active manufacturing';
  if (hasTrials) return 'WARM — Active clinical pipeline';
  if (hasEdgar) return 'WARM — SEC filing activity';
  return 'COLD — Limited public intelligence';
}
