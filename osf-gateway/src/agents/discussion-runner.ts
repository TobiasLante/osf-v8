/**
 * Discussion Runner — Multi-Agent Orchestration for Strategic Agents
 *
 * Flow: Phase 0 (KG) → Phase 1 (Specialists) → Phase 2 (Moderator Discussion) → Phase 3 (Debate + Synthesis)
 *
 * Ported from V7 impact-analysis.ts + specialists/runner.ts
 */
import { AgentDef } from './registry';
import { RunAgentOptions } from './runner';
import { callLlm, getLlmConfig, ChatMessage, LlmConfig, LlmResponse } from '../chat/llm-client';
import { callMcpTool, getMcpTools } from '../chat/tool-executor';
import { pool } from '../db/pool';
import { Response } from 'express';
import { logger } from '../logger';
import { loadPrompt } from '../prompt-loader';

// ─── Types ──────────────────────────────────────────────────────────────

interface SpecialistReport {
  domain: string;
  zahlenDatenFakten: string;
  kritischeFindings: Array<{
    finding: string;
    evidence: string;
    severity: 'hoch' | 'mittel' | 'niedrig';
    affectedMachines?: string[];
  }>;
  empfehlungen: Array<{
    maßnahme: string;
    priorität: 'sofort' | 'heute' | 'diese_woche';
    maschine?: string;
    erwarteteWirkung: string;
  }>;
  crossDomainHinweise: string[];
}

interface KgNode {
  id: string;
  type: string;      // 'machine' | 'order' | 'material' | 'customer' | 'tool' | 'article' | 'alternative'
  label: string;
  ring: number;       // 0=center, 1=direct, 2=indirect, 3=alternatives
}

interface KgEdge {
  from: string;
  to: string;
  label?: string;
}

export interface SpecialistDef {
  name: string;
  domain: string;
  displayName: string;
  focus: string;        // What to focus on
}

const IMPACT_SPECIALISTS: SpecialistDef[] = [
  { name: 'oee-impact', domain: 'IMPACT_OEE', displayName: 'OEE-Impact Analyst', focus: 'OEE, Verfügbarkeit, Maschinenauslastung, Stillstände' },
  { name: 'otd-impact', domain: 'IMPACT_OTD', displayName: 'OTD-Impact Analyst', focus: 'Liefertermintreue, gefährdete Aufträge, Kundenzufriedenheit' },
  { name: 'cost-impact', domain: 'IMPACT_KOSTEN', displayName: 'Kosten-Impact Analyst', focus: 'Kosten, Umsatzausfall, Nacharbeitskosten, Opportunitätskosten' },
  { name: 'quality-impact', domain: 'IMPACT_QUALITAET', displayName: 'Qualitäts-Impact Analyst', focus: 'Qualität, Cpk, SPC-Alarme, Ausschuss, Reklamationen' },
];

// ─── Language helper ─────────────────────────────────────────────────────

/** Returns DE or EN string based on language param */
function dl(language: string | undefined, de: string, en: string): string {
  return language === 'en' ? en : de;
}

/** Language instruction to append to LLM prompts for user-facing output */
function langInstr(language: string | undefined): string {
  if (language === 'en') return '\n\nIMPORTANT: Respond in English.';
  if (language === 'de') return '\n\nWICHTIG: Antworte auf Deutsch.';
  return '';
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function emitSSE(res: Response, event: Record<string, unknown>): void {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* connection closed */ }
}

function cleanLlmOutput<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.replace(/<[^>]*>/g, '') as unknown as T;
  if (Array.isArray(obj)) return obj.map(item => cleanLlmOutput(item)) as unknown as T;
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj as Record<string, any>)) {
      cleaned[key] = cleanLlmOutput(value);
    }
    return cleaned as T;
  }
  return obj;
}

function safeArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (val === null || val === undefined) return [];
  if (typeof val === 'string') return val.trim() ? [val] : [];
  if (typeof val === 'object') return [val];
  return [];
}

function compressReport(name: string, report: SpecialistReport): string {
  const findings = safeArray(report.kritischeFindings)
    .slice(0, 3)
    .map(f => {
      const finding = typeof f === 'string' ? f : (f?.finding || JSON.stringify(f));
      const severity = typeof f === 'object' ? f?.severity : '?';
      return `- [${severity}] ${finding}`;
    })
    .join('\n');

  const recs = safeArray(report.empfehlungen)
    .slice(0, 3)
    .map(r => typeof r === 'string' ? `- ${r}` : `- [${r?.priorität || '?'}] ${r?.maßnahme || JSON.stringify(r)}`)
    .join('\n');

  const kpis = typeof report.zahlenDatenFakten === 'string'
    ? (report.zahlenDatenFakten || '').substring(0, 300)
    : JSON.stringify(report.zahlenDatenFakten || '').substring(0, 300);

  return `=== ${name.toUpperCase()} (${report.domain || 'unknown'}) ===\nKPIs: ${kpis}\nFindings:\n${findings || 'Keine'}\nEmpfehlungen:\n${recs || 'Keine'}`;
}

function parseCritiqueItems(critique: any): Array<{ type: string; text: string }> {
  const items: Array<{ type: string; text: string }> = [];
  for (const s of safeArray(critique?.supported)) {
    items.push({ type: 'confirm', text: typeof s === 'string' ? s : (s?.text || s?.action || JSON.stringify(s)) });
  }
  for (const c of safeArray(critique?.concerns)) {
    const concern = typeof c === 'string' ? c : (c?.concern || c?.text || JSON.stringify(c));
    const alt = typeof c === 'object' && c?.alternative ? ` → ${c.alternative}` : '';
    items.push({ type: 'critic', text: `${concern}${alt}` });
  }
  for (const a of safeArray(critique?.additions)) {
    items.push({ type: 'add', text: typeof a === 'string' ? a : (a?.text || a?.action || JSON.stringify(a)) });
  }
  return items;
}

/** Call LLM expecting JSON response, parse + clean */
export async function callLlmJson<T>(
  messages: ChatMessage[],
  config: LlmConfig,
  userId?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await callLlm(messages, undefined, config, userId, signal);
  const text = (response.content || '').trim();
  // Extract JSON from markdown code blocks if needed
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonStr = jsonMatch ? jsonMatch[1].trim() : text;

  // Try parsing directly first
  try {
    return cleanLlmOutput(JSON.parse(jsonStr)) as T;
  } catch {
    // Attempt to repair truncated JSON — close open brackets/braces
    jsonStr = repairTruncatedJson(jsonStr);
    return cleanLlmOutput(JSON.parse(jsonStr)) as T;
  }
}

/** Attempt to close truncated JSON by balancing brackets/braces */
function repairTruncatedJson(input: string): string {
  let s = input.trim();
  // Remove trailing comma
  s = s.replace(/,\s*$/, '');
  // Remove incomplete key-value (e.g. trailing "key": or "key": "unfinished)
  s = s.replace(/,?\s*"[^"]*":\s*"?[^"}\]]*$/, '');
  // Count open/close brackets
  let braces = 0, brackets = 0;
  let inString = false, escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }
  // Close any unclosed strings
  if (inString) s += '"';
  // Close brackets then braces
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }
  return s;
}

// ─── Phase 0: KG Traversal ─────────────────────────────────────────────

function extractKgGraph(toolResults: Array<{ name: string; result: string }>, centerEntityId: string): { nodes: KgNode[]; edges: KgEdge[] } {
  const nodesMap = new Map<string, KgNode>();
  const edges: KgEdge[] = [];

  // Center node
  nodesMap.set(centerEntityId, { id: centerEntityId, type: 'machine', label: centerEntityId, ring: 0 });

  for (const { result } of toolResults) {
    let data: any;
    try { data = JSON.parse(result); } catch { continue; }
    if (!data || typeof data !== 'object') continue;

    // ── Strategy 1: KG tools return pre-built nodes/edges (source/target format) ──
    if (Array.isArray(data.nodes) && data.nodes.length > 0) {
      for (const n of data.nodes) {
        if (!n?.id) continue;
        const existing = nodesMap.get(n.id);
        if (!existing) {
          nodesMap.set(n.id, {
            id: n.id,
            type: (n.type || 'unknown').toLowerCase(),
            label: n.label || n.id,
            ring: n.ring ?? 1,
          });
        }
      }
    }
    if (Array.isArray(data.edges) && data.edges.length > 0) {
      for (const e of data.edges) {
        const from = e.source || e.from;
        const to = e.target || e.to;
        if (from && to) {
          edges.push({ from, to, label: e.relationship || e.label || '' });
        }
      }
    }

    // ── Strategy 2: Extract rerouting alternatives (nested object, not array) ──
    if (data.reroutingOptions && typeof data.reroutingOptions === 'object' && !Array.isArray(data.reroutingOptions)) {
      for (const [poolName, poolData] of Object.entries(data.reroutingOptions as Record<string, any>)) {
        for (const m of safeArray(poolData?.machines)) {
          const id = m?.id || m?.machineId || String(m);
          if (!id || nodesMap.has(id)) continue;
          nodesMap.set(id, { id, type: 'alternative', label: `${id} (${poolName})`, ring: 3 });
          edges.push({ from: centerEntityId, to: id, label: 'Alternative' });
        }
      }
    }

    // ── Strategy 3: Fallback — extract from common fields if no nodes array ──
    if (!Array.isArray(data.nodes)) {
      for (const order of safeArray(data.affectedOrders || data.affected_orders).slice(0, 30)) {
        const id = order?.id || order?.orderId || String(order);
        if (!id || nodesMap.has(id)) continue;
        nodesMap.set(id, { id, type: 'order', label: order?.label || order?.article || id, ring: 1 });
        edges.push({ from: centerEntityId, to: id, label: 'betrifft' });
      }

      for (const cust of safeArray(data.affectedCustomers || data.affected_customers).slice(0, 15)) {
        const id = cust?.id || cust?.name || String(cust);
        if (!id || nodesMap.has(id)) continue;
        nodesMap.set(id, { id, type: 'customer', label: cust?.label || cust?.name || id, ring: 2 });
        edges.push({ from: centerEntityId, to: id, label: 'Kunde' });
      }

      for (const alt of safeArray(data.alternatives).slice(0, 10)) {
        const id = alt?.id || alt?.machineId || String(alt);
        if (!id || nodesMap.has(id)) continue;
        nodesMap.set(id, { id, type: 'alternative', label: alt?.label || id, ring: 3 });
        edges.push({ from: centerEntityId, to: id, label: 'Alternative' });
      }
    }
  }

  // Deduplicate edges
  const edgeSet = new Set<string>();
  const uniqueEdges = edges.filter(e => {
    const key = `${e.from}→${e.to}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  logger.info({ mapSize: nodesMap.size, uniqueEdges: uniqueEdges.length, totalEdgesBeforeDedup: edges.length }, 'extractKgGraph: final counts');
  return { nodes: Array.from(nodesMap.values()), edges: uniqueEdges };
}

/** Map generic params to tool-specific arguments */
function mapKgToolArgs(toolName: string, params: Record<string, unknown>, entityId: string): Record<string, unknown> {
  switch (toolName) {
    case 'kg_what_if_machine_down':
      return { machineId: entityId };
    case 'kg_dependency_graph':
      return { machineId: entityId, depth: 2 };
    case 'kg_impact_analysis':
      return { entityType: 'Machine', entityId };
    case 'kg_bottleneck_analysis':
      return { limit: 10 };
    case 'kg_customer_delivery_risk':
      return {};
    case 'kg_critical_path_orders':
      return { limit: 10 };
    case 'kg_type_overview':
      return {};
    case 'kg_oee_vs_target':
    case 'kg_quality_impact':
    case 'kg_supply_chain_risk':
    case 'kg_pool_demand_forecast':
    case 'kg_procurement_status':
      return {};
    case 'kg_energy_efficiency':
    case 'kg_maintenance_risk':
      return { machineId: entityId };
    default:
      return { ...params, machineId: entityId, entityId };
  }
}

async function runKgPhase(
  agent: AgentDef,
  res: Response,
  params: Record<string, unknown>,
): Promise<{ kgNodes: KgNode[]; kgEdges: KgEdge[]; kgToolResults: Array<{ name: string; result: string }> }> {
  const kgTools = agent.tools.filter(t => t.startsWith('kg_'));
  if (kgTools.length === 0) {
    return { kgNodes: [], kgEdges: [], kgToolResults: [] };
  }

  const entityId = String(params.entityId || params.machineId || 'unknown');

  emitSSE(res, {
    type: 'kg_traversal_start',
    scenarioName: params.scenario || 'Impact Analysis',
    entityId,
  });

  // Call all KG tools in parallel — map params per tool
  const toolResults: Array<{ name: string; result: string }> = [];
  const kgPromises = kgTools.map(async (toolName) => {
    try {
      const args = mapKgToolArgs(toolName, params, entityId);
      const result = await callMcpTool(toolName, args);
      toolResults.push({ name: toolName, result });
    } catch (err: any) {
      logger.warn({ tool: toolName, err: err.message }, 'KG tool call failed');
    }
  });

  await Promise.allSettled(kgPromises);

  logger.info({ kgToolCount: kgTools.length, resultCount: toolResults.length, tools: toolResults.map(r => r.name), entityId }, 'KG phase: tools completed');

  // Extract graph
  const { nodes, edges } = extractKgGraph(toolResults, entityId);
  logger.info({ nodeCount: nodes.length, edgeCount: edges.length }, 'KG phase: graph extracted');

  emitSSE(res, {
    type: 'kg_nodes_discovered',
    nodes,
    edges,
    centerEntity: { id: entityId, type: 'machine' },
  });

  emitSSE(res, {
    type: 'kg_traversal_end',
    totalNodes: nodes.length,
    totalEdges: edges.length,
  });

  // Emit kg_summary for inline SVG diagram
  emitSSE(res, {
    type: 'kg_summary',
    centerEntity: entityId,
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      affectedOrders: nodes.filter(n => n.type === 'order').length,
      affectedCustomers: nodes.filter(n => n.type === 'customer').length,
      alternatives: nodes.filter(n => n.type === 'alternative').length,
    },
  });

  return { kgNodes: nodes, kgEdges: edges, kgToolResults: toolResults };
}

// ─── Phase 1: Specialists ───────────────────────────────────────────────

async function runSpecialistLlm(
  specialist: SpecialistDef,
  context: string,
  freeLlmConfig: LlmConfig,
  userId: string,
  signal?: AbortSignal,
  language?: string,
): Promise<SpecialistReport> {
  const isEn = language === 'en';
  const systemPrompt = isEn
    ? `You are the ${specialist.displayName}. Your focus: ${specialist.focus}.
Analyze the provided data and answer the user question from your domain perspective.
IMPORTANT: Only use data that is actually present in the provided data. Do NOT invent person names, job titles or organizational units.

RESPONSE FORMAT: Pure JSON, NO Markdown, NO code blocks. Use these EXACT field names (they are German by design):
{
  "domain": "${specialist.domain}",
  "zahlenDatenFakten": "Compact KPI summary (max 300 chars, in English)",
  "kritischeFindings": [
    { "finding": "...", "evidence": "...", "severity": "hoch|mittel|niedrig", "affectedMachines": [] }
  ],
  "empfehlungen": [
    { "maßnahme": "...", "priorität": "sofort|heute|diese_woche", "erwarteteWirkung": "..." }
  ],
  "crossDomainHinweise": ["Cross-domain hints"]
}

Max 3-5 findings and 3-5 recommendations. Write all VALUES in English but keep the JSON KEYS exactly as shown.`
    : `Du bist der ${specialist.displayName}. Dein Fokus: ${specialist.focus}.
Analysiere die bereitgestellten Daten und beantworte die User-Frage aus deiner Fachperspektive.
WICHTIG: Verwende NUR Daten die tatsächlich in den bereitgestellten Daten stehen. Erfinde KEINE Personennamen, Jobtitel oder Organisationseinheiten.

ANTWORT-FORMAT: Reines JSON, KEIN Markdown, KEINE Code-Blöcke.
{
  "domain": "${specialist.domain}",
  "zahlenDatenFakten": "Kompakte KPI-Zusammenfassung (max 300 Zeichen)",
  "kritischeFindings": [
    { "finding": "...", "evidence": "...", "severity": "hoch|mittel|niedrig", "affectedMachines": [] }
  ],
  "empfehlungen": [
    { "maßnahme": "...", "priorität": "sofort|heute|diese_woche", "erwarteteWirkung": "..." }
  ],
  "crossDomainHinweise": ["Hinweise für andere Bereiche"]
}

Maximal 3-5 Findings und 3-5 Empfehlungen. Präzise und kompakt.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: isEn ? `Analyze the following data:\n\n${context}` : `Analysiere folgende Daten:\n\n${context}` },
  ];

  return await callLlmJson<SpecialistReport>(messages, freeLlmConfig, userId, signal);
}

async function runSpecialistsParallel(
  kgData: string,
  factoryData: string,
  agent: AgentDef,
  freeLlmConfig: LlmConfig,
  userId: string,
  res: Response,
  specialists: SpecialistDef[] = IMPACT_SPECIALISTS,
  signal?: AbortSignal,
  language?: string,
): Promise<Map<string, SpecialistReport>> {
  const reports = new Map<string, SpecialistReport>();
  const specialistNames = specialists.map(s => s.name);

  emitSSE(res, {
    type: 'specialists_batch_start',
    specialistCount: specialists.length,
    specialistNames,
  });

  const startTime = Date.now();

  const results = await Promise.allSettled(
    specialists.map(async (spec) => {
      const specStart = Date.now();
      emitSSE(res, {
        type: 'specialist_start',
        specialistName: spec.name,
        specialistDomain: spec.domain,
        specialistDisplayName: spec.displayName,
      });

      try {
        const context = language === 'en'
          ? `SCENARIO CONTEXT:\n${kgData}\n\nFACTORY DATA:\n${factoryData}`
          : `SZENARIO-KONTEXT:\n${kgData}\n\nFABRIK-DATEN:\n${factoryData}`;
        const report = await runSpecialistLlm(spec, context, freeLlmConfig, userId, signal, language);
        reports.set(spec.name, report);

        emitSSE(res, {
          type: 'specialist_complete',
          specialistName: spec.name,
          specialistResult: {
            name: spec.name,
            domain: spec.domain,
            status: 'done',
            durationMs: Date.now() - specStart,
            report,
          },
        });

        return { name: spec.name, report };
      } catch (err: any) {
        logger.error({ specialist: spec.name, err: err.message }, 'Specialist failed');
        emitSSE(res, {
          type: 'specialist_error',
          specialistName: spec.name,
          error: err.message?.substring(0, 100),
        });
        return { name: spec.name, error: err.message };
      }
    })
  );

  // Emit batch complete with compressed results for discussion thread
  const specialistResults = results.map((r, i) => {
    const spec = specialists[i];
    if (r.status === 'fulfilled' && r.value.report) {
      const rpt = r.value.report as SpecialistReport;
      return {
        name: spec.name,
        domain: spec.domain,
        status: 'done' as const,
        report: {
          domain: rpt.domain,
          zahlenDatenFakten: (rpt.zahlenDatenFakten || '').substring(0, 250),
          findingsCount: safeArray(rpt.kritischeFindings).length,
        },
      };
    }
    return {
      name: spec.name,
      domain: spec.domain,
      status: 'error' as const,
      error: r.status === 'fulfilled' ? r.value.error : String(r.reason),
    };
  });

  emitSSE(res, {
    type: 'specialists_batch_complete',
    specialistCount: specialists.length,
    specialistResults,
    totalDurationMs: Date.now() - startTime,
  });

  return reports;
}

// ─── Phase 2: Moderator Discussion ─────────────────────────────────────

async function runModeratorReview(
  reports: Map<string, SpecialistReport>,
  round: number,
  previousAnswers: string,
  premiumLlmConfig: LlmConfig,
  freeLlmConfig: LlmConfig,
  userId: string,
  res: Response,
  signal?: AbortSignal,
  language?: string,
  existingSpecialists?: SpecialistDef[],
  kgContext?: string,
  factoryContext?: string,
): Promise<{ readyForSynthesis: boolean; followUpTranscript: string }> {
  emitSSE(res, { type: 'discussion_round_start', discussionRound: round });

  // Compress all reports for moderator context
  const compressed = Array.from(reports.entries())
    .map(([name, report]) => compressReport(name, report))
    .join('\n\n');

  const isEn = language === 'en';
  const skills = loadPrompt('skills');
  const currentSpecNames = existingSpecialists?.map(s => s.displayName).join(', ') || Array.from(reports.keys()).join(', ');

  const moderatorPrompt = isEn
    ? `You are the moderator of a multi-agent analysis discussion.

CURRENT SPECIALISTS: ${currentSpecNames}

SPECIALIST REPORTS:
${compressed}

${previousAnswers ? `PREVIOUS DISCUSSION:\n${previousAnswers}\n` : ''}

${skills ? `AVAILABLE TOOLS (you can request NEW specialists with these tools):\n${skills}\n` : ''}

Analyze the reports and decide:
1. Gaps — is critical information MISSING that the current specialists cannot provide?
2. Contradictions between specialists
3. Follow-up questions (max 3) to existing specialists
4. NEW SPECIALISTS — if a gap can ONLY be filled by bringing in a new specialist with different tools, request one! This is powerful — use it when you see a blind spot.

RESPONSE FORMAT: Pure JSON.
{
  "gaps": ["..."],
  "contradictions": ["..."],
  "followUpQuestions": [
    { "targetSpecialist": "specialist-name", "question": "...", "context": "..." }
  ],
  "newSpecialists": [
    { "name": "slug-name", "displayName": "Display Name", "domain": "DOMAIN_KEY", "focus": "What to investigate", "tools": ["tool_1", "tool_2"] }
  ],
  "preliminaryInsights": ["..."],
  "readyForSynthesis": false
}

Rules for newSpecialists:
- Only request if the current specialists genuinely CANNOT answer a critical question
- Pick tools from the available tools reference above
- Give a clear focus so the new specialist knows exactly what to investigate
- Max 2 new specialists per round`
    : `Du bist der Moderator einer Multi-Agent-Analyse-Diskussion.

AKTUELLE SPEZIALISTEN: ${currentSpecNames}

SPEZIALISTEN-BERICHTE:
${compressed}

${previousAnswers ? `BISHERIGE DISKUSSION:\n${previousAnswers}\n` : ''}

${skills ? `VERFÜGBARE TOOLS (du kannst NEUE Spezialisten mit diesen Tools anfordern):\n${skills}\n` : ''}

Analysiere die Berichte und entscheide:
1. Lücken — fehlen kritische Informationen die die aktuellen Spezialisten nicht liefern können?
2. Widersprüche zwischen Spezialisten
3. Follow-Up-Fragen (max 3) an bestehende Spezialisten
4. NEUE SPEZIALISTEN — wenn eine Lücke NUR durch einen neuen Spezialisten mit anderen Tools gefüllt werden kann, fordere einen an! Das ist mächtig — nutze es wenn du einen blinden Fleck siehst.

ANTWORT-FORMAT: Reines JSON.
{
  "gaps": ["..."],
  "contradictions": ["..."],
  "followUpQuestions": [
    { "targetSpecialist": "specialist-name", "question": "...", "context": "..." }
  ],
  "newSpecialists": [
    { "name": "slug-name", "displayName": "Anzeigename", "domain": "DOMAIN_KEY", "focus": "Was untersucht werden soll", "tools": ["tool_1", "tool_2"] }
  ],
  "preliminaryInsights": ["..."],
  "readyForSynthesis": false
}

Regeln für newSpecialists:
- Nur anfordern wenn die aktuellen Spezialisten eine kritische Frage wirklich NICHT beantworten können
- Tools aus der Tool-Referenz oben wählen
- Klaren Fokus geben damit der neue Spezialist weiß was er untersuchen soll
- Max 2 neue Spezialisten pro Runde`;

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);

  let review: any;
  try {
    review = await callLlmJson<any>(
      [
        { role: 'system', content: isEn
          ? 'You are an experienced moderator for impact analyses in manufacturing.'
          : 'Du bist ein erfahrener Moderator für Impact-Analysen in der Fertigung.' },
        { role: 'user', content: moderatorPrompt },
      ],
      premiumLlmConfig,
      userId,
      signal,
    );
  } catch (err: any) {
    logger.error({ err: err.message }, 'Moderator review LLM failed');
    review = { gaps: [], contradictions: [], followUpQuestions: [], preliminaryInsights: [], readyForSynthesis: true };
  } finally {
    clearInterval(heartbeat);
  }

  // ── Process NEW SPECIALISTS (dynamic recruitment) ──
  const newSpecs = safeArray(review.newSpecialists).slice(0, 2);
  let transcript = previousAnswers;

  if (newSpecs.length > 0 && kgContext && factoryContext) {
    for (const ns of newSpecs) {
      if (!ns.name || !ns.focus) continue;

      const newSpecDef: SpecialistDef = {
        name: ns.name,
        displayName: ns.displayName || ns.name,
        domain: ns.domain || 'ADDITIONAL',
        focus: ns.focus,
      };

      // ── BIG ANNOUNCEMENT in stream ──
      emitSSE(res, {
        type: 'discussion_recruit',
        discussionRound: round,
        recruitedSpecialistName: newSpecDef.displayName,
        recruitedSpecialistFocus: newSpecDef.focus,
        recruitedSpecialistTools: ns.tools || [],
        message: isEn
          ? `Moderator recruiting new specialist: ${newSpecDef.displayName} — "${newSpecDef.focus}"`
          : `Moderator zieht neuen Spezialisten hinzu: ${newSpecDef.displayName} — "${newSpecDef.focus}"`,
      });

      // Run the new specialist
      try {
        const newReport = await runSpecialistLlm(
          newSpecDef,
          `${kgContext}\n\n${factoryContext}`,
          freeLlmConfig,
          userId,
          signal,
          language,
        );

        if (newReport) {
          reports.set(ns.name, newReport);
          if (existingSpecialists) {
            existingSpecialists.push(newSpecDef);
          }

          // Compress the new report for display
          const reportSummary = newReport.zahlenDatenFakten
            ? String(newReport.zahlenDatenFakten).substring(0, 300)
            : (safeArray(newReport.kritischeFindings).slice(0, 3).map(f => typeof f === 'string' ? f : f?.finding || '').join('\n') || 'Analysis complete');

          emitSSE(res, {
            type: 'discussion_recruit_result',
            discussionRound: round,
            recruitedSpecialistName: newSpecDef.displayName,
            recruitedSpecialistReport: reportSummary,
            message: isEn
              ? `${newSpecDef.displayName} completed analysis — findings integrated`
              : `${newSpecDef.displayName} hat Analyse abgeschlossen — Ergebnisse integriert`,
          });

          transcript += `\n[New specialist ${newSpecDef.displayName} joined the discussion]\n`;
        }
      } catch (err: any) {
        logger.warn({ err: err.message, specialist: ns.name }, 'New specialist failed');
      }
    }
  }

  // ── Process follow-up questions ──
  const questions = safeArray(review.followUpQuestions).slice(0, 3);

  for (const q of questions) {
    const target = q.targetSpecialist || 'oee-impact';
    const question = q.question || q.context || '';
    if (!question) continue;

    emitSSE(res, {
      type: 'discussion_question',
      discussionRound: round,
      moderatorQuestion: question,
      targetSpecialist: target,
    });

    // Get specialist's answer
    const specReport = reports.get(target);
    const specContext = specReport ? compressReport(target, specReport) : dl(language, 'Keine Daten verfügbar.', 'No data available.');

    const heartbeat2 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
    let answer: string;
    try {
      const answerResponse = await callLlm(
        [
          { role: 'system', content: isEn
            ? `You are the specialist for ${target}. Answer the question based on your analysis.`
            : `Du bist der Spezialist für ${target}. Beantworte die Frage basierend auf deiner Analyse.` },
          { role: 'user', content: isEn
            ? `Your previous analysis:\n${specContext}\n\nModerator's question: ${question}\n\nAnswer in 2-3 sentences, precise and factual.`
            : `Deine bisherige Analyse:\n${specContext}\n\nFrage des Moderators: ${question}\n\nAntworte in 2-3 Sätzen, präzise und faktisch.` },
        ],
        undefined,
        freeLlmConfig,
        userId,
        signal,
      );
      answer = answerResponse.content || dl(language, 'Keine Antwort.', 'No answer.');
    } catch {
      answer = dl(language, 'Spezialist konnte nicht antworten.', 'Specialist could not respond.');
    } finally {
      clearInterval(heartbeat2);
    }

    emitSSE(res, {
      type: 'discussion_answer',
      discussionRound: round,
      targetSpecialist: target,
      discussionAnswer: answer,
    });

    transcript += `\nModerator → ${target}: ${question}\n${target}: ${answer}\n`;
  }

  emitSSE(res, { type: 'discussion_round_complete', discussionRound: round });

  return {
    readyForSynthesis: review.readyForSynthesis || round >= 2,
    followUpTranscript: transcript,
  };
}

// ─── Phase 3: Debate + Synthesis ────────────────────────────────────────

async function runDebate(
  reports: Map<string, SpecialistReport>,
  discussionTranscript: string,
  premiumLlmConfig: LlmConfig,
  freeLlmConfig: LlmConfig,
  userId: string,
  res: Response,
  specialists: SpecialistDef[] = IMPACT_SPECIALISTS,
  signal?: AbortSignal,
  userMessage?: string,
  language?: string,
): Promise<string> {
  // 3a: Moderator drafts answer
  emitSSE(res, { type: 'debate_start' });
  emitSSE(res, { type: 'discussion_synthesis_start' });

  const compressed = Array.from(reports.entries())
    .map(([name, report]) => compressReport(name, report))
    .join('\n\n');

  const isEn = language === 'en';
  const questionContext = userMessage
    ? (isEn
      ? `\nORIGINAL USER QUESTION: "${userMessage}"\nYour answer MUST directly answer this question. Cite specific data, numbers, names from the reports.\n`
      : `\nURSPRÜNGLICHE USER-FRAGE: "${userMessage}"\nDeine Antwort MUSS diese Frage DIREKT beantworten. Nenne konkrete Daten, Zahlen, Namen aus den Berichten.\n`)
    : '';

  const draftPrompt = isEn
    ? `${questionContext}
SPECIALIST REPORTS:
${compressed}

DISCUSSION:
${discussionTranscript || 'No further discussion points.'}

TASK: Answer the user question directly and precisely based on the specialist data.
- Start with the DIRECT ANSWER to the question (specific numbers, names, values)
- Then: Context and analysis (brief)
- Then: Recommended actions (only if relevant to the question)
- Do NOT invent person names, job titles or organizational units not in the data
- Use ONLY data that is actually contained in the specialist reports

Answer as structured text (Markdown). Respond in English.`
    : `${questionContext}
SPEZIALISTEN-BERICHTE:
${compressed}

DISKUSSION:
${discussionTranscript || 'Keine weiteren Diskussionspunkte.'}

AUFGABE: Beantworte die User-Frage direkt und präzise basierend auf den Daten der Spezialisten.
- Beginne mit der DIREKTEN ANTWORT auf die Frage (konkrete Zahlen, Namen, Werte)
- Dann: Kontext und Analyse (kurz)
- Dann: Empfohlene Maßnahmen (nur wenn relevant für die Frage)
- Erfinde KEINE Personennamen, Jobtitel oder Organisationseinheiten die nicht in den Daten stehen
- Verwende NUR Daten die tatsächlich in den Spezialisten-Berichten enthalten sind

Antworte als strukturierter Text (Markdown).`;

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let draftText: string;
  try {
    const draftResponse = await callLlm(
      [
        { role: 'system', content: language === 'en'
          ? 'You are an experienced manufacturing expert. Answer questions directly and data-driven. Do NOT invent names or facts.'
          : 'Du bist ein erfahrener Fertigungsexperte. Beantworte Fragen direkt und datenbasiert. Erfinde KEINE Namen oder Fakten.' },
        { role: 'user', content: draftPrompt },
      ],
      undefined,
      premiumLlmConfig,
      userId,
      signal,
    );
    draftText = draftResponse.content || dl(language, 'Entwurf konnte nicht erstellt werden.', 'Draft could not be created.');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Draft mitigation failed');
    draftText = dl(language, 'Entwurf-Erstellung fehlgeschlagen.', 'Draft creation failed.');
  } finally {
    clearInterval(heartbeat);
  }

  const draftSummary = draftText.length > 200 ? draftText.substring(0, 200) + '...' : draftText;
  emitSSE(res, { type: 'debate_draft', debateDraftSummary: draftSummary });

  // 3b: Specialists critique in batches of 2
  const allCritiques: string[] = [];
  const specEntries = Array.from(reports.entries());

  for (let batch = 0; batch < specEntries.length; batch += 2) {
    const batchEntries = specEntries.slice(batch, batch + 2);
    const batchResults = await Promise.allSettled(
      batchEntries.map(async ([name, report]) => {
        const specDef = specialists.find(s => s.name === name);
        const displayName = specDef?.displayName || name;

        const critiquePrompt = isEn
          ? `You are the ${displayName}. Critique the following plan from your domain perspective.

YOUR ANALYSIS:
${compressReport(name, report)}

PROPOSED PLAN:
${draftText.substring(0, 3000)}

Evaluate the plan:
RESPONSE FORMAT: Pure JSON.
{
  "supported": ["What you support"],
  "concerns": [{ "concern": "Problem", "alternative": "Better suggestion" }],
  "additions": ["What's missing"],
  "overallAssessment": "Overall assessment in 1 sentence"
}`
          : `Du bist der ${displayName}. Kritisiere folgenden Mitigation-Plan aus deiner Fachperspektive.

DEINE ANALYSE:
${compressReport(name, report)}

VORGESCHLAGENER PLAN:
${draftText.substring(0, 3000)}

Bewerte den Plan:
ANTWORT-FORMAT: Reines JSON.
{
  "supported": ["Was du unterstützt"],
  "concerns": [{ "concern": "Problem", "alternative": "Besserer Vorschlag" }],
  "additions": ["Was fehlt"],
  "overallAssessment": "Gesamtbewertung in 1 Satz"
}`;

        const heartbeat2 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
        try {
          const critique = await callLlmJson<any>(
            [
              { role: 'system', content: isEn
                ? `You are a critical ${displayName}. Be constructive but honest.`
                : `Du bist ein kritischer ${displayName}. Sei konstruktiv aber ehrlich.` },
              { role: 'user', content: critiquePrompt },
            ],
            freeLlmConfig,
            userId,
            signal,
          );

          const items = parseCritiqueItems(critique);
          emitSSE(res, {
            type: 'debate_critique',
            debateCritiqueFrom: displayName,
            debateCritiqueItems: items,
            debateCritiqueAssessment: critique.overallAssessment || '',
          });

          allCritiques.push(`${displayName}: ${critique.overallAssessment || ''}\n${items.map(i => `  [${i.type}] ${i.text}`).join('\n')}`);
        } catch (err: any) {
          logger.warn({ specialist: name, err: err.message }, 'Critique failed');
          emitSSE(res, {
            type: 'debate_critique',
            debateCritiqueFrom: displayName,
            debateCritiqueItems: [{ type: 'critic', text: dl(language, 'Konnte keine Kritik erstellen', 'Could not create critique') }],
            debateCritiqueAssessment: dl(language, 'Fehler bei der Bewertung', 'Error during evaluation'),
          });
        } finally {
          clearInterval(heartbeat2);
        }
      })
    );
  }

  // 3c: Final synthesis incorporating critiques
  const finalQuestionContext = userMessage
    ? (isEn
      ? `\nORIGINAL USER QUESTION: "${userMessage}"\nThe answer MUST directly answer this question.\n`
      : `\nURSPRÜNGLICHE USER-FRAGE: "${userMessage}"\nDie Antwort MUSS diese Frage DIREKT beantworten.\n`)
    : '';

  const finalPrompt = isEn
    ? `Finalize the answer after the specialist debate.
${finalQuestionContext}
ORIGINAL DRAFT:
${draftText.substring(0, 3000)}

SPECIALIST CRITIQUES:
${allCritiques.join('\n\n')}

Create the FINAL answer. Incorporate valid critique points.
- Start with the DIRECT ANSWER to the user question
- Cite specific numbers, machine IDs, article numbers from the data
- Do NOT invent person names or organizational units
- Format: Structured Markdown text. Respond in English.`
    : `Finalisiere die Antwort nach der Spezialisten-Debatte.
${finalQuestionContext}
URSPRÜNGLICHER ENTWURF:
${draftText.substring(0, 3000)}

SPEZIALISTEN-KRITIK:
${allCritiques.join('\n\n')}

Erstelle die FINALE Antwort. Arbeite berechtigte Kritikpunkte ein.
- Beginne mit der DIREKTEN ANTWORT auf die User-Frage
- Nenne konkrete Zahlen, Maschinen-IDs, Artikel-Nummern aus den Daten
- Erfinde KEINE Personennamen oder Organisationseinheiten
- Format: Strukturierter Markdown-Text.`;

  const heartbeat3 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let finalText: string;
  try {
    const finalResponse = await callLlm(
      [
        { role: 'system', content: language === 'en'
          ? 'You are an experienced manufacturing expert. Answer the question directly, precisely and data-driven. Do NOT invent names or facts.'
          : 'Du bist ein erfahrener Fertigungsexperte. Beantworte die Frage direkt, präzise und datenbasiert. Erfinde KEINE Namen oder Fakten.' },
        { role: 'user', content: finalPrompt },
      ],
      undefined,
      premiumLlmConfig,
      userId,
      signal,
    );
    finalText = finalResponse.content || draftText;
  } catch {
    finalText = draftText;
  } finally {
    clearInterval(heartbeat3);
  }

  const finalSummary = finalText.length > 200 ? finalText.substring(0, 200) + '...' : finalText;
  emitSSE(res, { type: 'debate_final', debateFinalSummary: finalSummary });

  return finalText;
}

// ─── Phase 4: Report Generation ─────────────────────────────────────────

function generateHtmlReport(
  finalText: string,
  reports: Map<string, SpecialistReport>,
  kgNodes: KgNode[],
  kgEdges: KgEdge[],
  transcript: string,
  params: Record<string, unknown>,
  specialists: SpecialistDef[] = IMPACT_SPECIALISTS,
  language?: string,
  userMessage?: string,
  reportTitle?: string,
): string {
  const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const entityId = esc(String(params.entityId || params.machineId || ''));
  const scenario = esc(reportTitle || String(params.scenario || (language === 'en' ? 'Analysis Report' : 'Analyse-Bericht')));
  const task = esc(userMessage || '');
  const now = new Date().toLocaleString(language === 'en' ? 'en-US' : 'de-DE', { timeZone: 'Europe/Berlin' });

  const severityMatch = finalText.match(/severity[:\s]*(critical|high|medium|low)/i)
    || finalText.match(/(CRITICAL|HIGH|MEDIUM|LOW)/);
  const severity = severityMatch ? severityMatch[1].toUpperCase() : 'HIGH';
  const sevColor = severity === 'CRITICAL' ? '#f87171' : severity === 'HIGH' ? '#fbbf24' : severity === 'MEDIUM' ? '#60a5fa' : '#34d399';

  const totalFindings = Array.from(reports.values()).reduce((sum, r) => sum + safeArray(r.kritischeFindings).length, 0);
  const totalRecs = Array.from(reports.values()).reduce((sum, r) => sum + safeArray(r.empfehlungen).length, 0);
  const affectedOrders = kgNodes.filter(n => n.type === 'order').length;

  // Build specialist cards HTML
  let specialistHtml = '';
  for (const [name, report] of reports.entries()) {
    const specDef = specialists.find(s => s.name === name);
    const displayName = esc(specDef?.displayName || name);
    const findings = safeArray(report.kritischeFindings);
    const recs = safeArray(report.empfehlungen);

    let findingsHtml = '';
    for (const f of findings.slice(0, 5)) {
      const finding = esc(typeof f === 'string' ? f : f?.finding || JSON.stringify(f));
      const sev = typeof f === 'object' ? (f?.severity || '') : '';
      const badge = sev === 'hoch' ? 'badge-sofort' : sev === 'mittel' ? 'badge-heute' : 'badge-woche';
      findingsHtml += `<li>${sev ? `<span class="badge ${badge}">${esc(sev)}</span> ` : ''}${finding}</li>`;
    }

    let recsHtml = '';
    for (const r of recs.slice(0, 5)) {
      const action = esc(typeof r === 'string' ? r : r?.maßnahme || JSON.stringify(r));
      const prio = typeof r === 'object' ? (r?.priorität || '') : '';
      const badge = prio === 'sofort' ? 'badge-sofort' : prio === 'heute' ? 'badge-heute' : 'badge-woche';
      recsHtml += `<li>${prio ? `<span class="badge ${badge}">${esc(String(prio))}</span> ` : ''}${action}</li>`;
    }

    specialistHtml += `
    <div class="card">
      <h3>${displayName}</h3>
      ${report.zahlenDatenFakten ? `<div class="summary">${esc(String(report.zahlenDatenFakten).substring(0, 400))}</div>` : ''}
      ${findingsHtml ? `<h4>Findings</h4><ul>${findingsHtml}</ul>` : ''}
      ${recsHtml ? `<h4>${language === 'en' ? 'Recommendations' : 'Empfehlungen'}</h4><ul>${recsHtml}</ul>` : ''}
    </div>`;
  }

  // Discussion transcript HTML
  let discussionHtml = '';
  if (transcript.trim()) {
    const lines = transcript.split('\n').filter(l => l.trim()).slice(0, 30);
    for (const line of lines) {
      if (line.includes('Moderator')) {
        discussionHtml += `<p><strong>${esc(line.trim())}</strong></p>`;
      } else {
        discussionHtml += `<p>${esc(line.trim())}</p>`;
      }
    }
  }

  // Final text — convert basic markdown bold/bullets to HTML
  const finalHtml = esc(finalText)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');

  const isEn = language === 'en';
  const t = (de: string, en: string) => isEn ? en : de;

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'de'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t('Impact-Analyse', 'Impact Analysis')}: ${scenario} — ${now}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── A4 page layout ─────────────────────────────── */
  @page {
    size: A4;
    margin: 20mm 15mm 25mm 15mm;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #e2e8f0;
    color: #1e293b;
    line-height: 1.65;
    font-size: 9.5pt;
  }

  /* On-screen A4 page simulation */
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 20px auto;
    background: #fff;
    box-shadow: 0 2px 16px rgba(0,0,0,0.10);
    padding: 20mm 18mm 28mm 18mm;
    position: relative;
  }

  /* Page header (repeats via table trick for print) */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 10px;
    border-bottom: 2px solid #2563eb;
    margin-bottom: 18px;
    font-size: 7.5pt;
    color: #64748b;
  }
  .page-header .logo { font-weight: 700; color: #2563eb; font-size: 8.5pt; }

  /* Page footer */
  .page-footer {
    position: absolute;
    bottom: 12mm;
    left: 18mm;
    right: 18mm;
    border-top: 1px solid #e2e8f0;
    padding-top: 6px;
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    color: #94a3b8;
  }

  /* ── Title page ─────────────────────────────────── */
  .title-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    min-height: calc(297mm - 48mm);
  }
  .title-page h1 { font-size: 26pt; font-weight: 700; color: #0f172a; letter-spacing: -0.03em; margin-bottom: 8px; }
  .title-page .subtitle { font-size: 12pt; color: #64748b; margin-bottom: 4px; }
  .sev-badge { display: inline-block; font-size: 8pt; font-weight: 700; padding: 5px 18px; border-radius: 20px; color: #fff; background: ${sevColor}; margin-top: 20px; letter-spacing: 0.06em; text-transform: uppercase; }

  /* PDF button — screen only */
  .pdf-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #0f172a;
    padding: 10px 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    z-index: 999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .pdf-bar .title { color: #94a3b8; font-size: 13px; }
  .pdf-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 20px; background: #2563eb; color: #fff; border: none; border-radius: 6px;
    font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .pdf-btn:hover { background: #1d4ed8; }
  .pdf-btn svg { width: 15px; height: 15px; fill: currentColor; }
  body { padding-top: 52px; }

  /* ── Content styles ─────────────────────────────── */
  .section-title {
    font-size: 13pt; font-weight: 700; color: #0f172a;
    margin: 0 0 12px 0; padding-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
  }

  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
  .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
  .kpi-card .value { font-size: 20pt; font-weight: 700; color: #2563eb; }
  .kpi-card .label { font-size: 7pt; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }

  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
  .card h3 { font-size: 10pt; font-weight: 600; color: #2563eb; margin-bottom: 8px; }
  .card h4 { font-size: 8pt; font-weight: 600; color: #475569; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.03em; }
  .summary { background: #eff6ff; border-left: 3px solid #2563eb; padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 6px 0 10px; font-size: 8.5pt; color: #334155; }

  .badge { display: inline-block; font-size: 6pt; font-weight: 700; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; margin-right: 3px; vertical-align: middle; }
  .badge-sofort { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .badge-heute { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
  .badge-woche { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }

  ul { padding-left: 16px; margin: 4px 0; }
  li { margin: 3px 0; font-size: 8.5pt; color: #334155; }

  .final-plan { font-size: 9pt; color: #1e293b; }
  .final-plan strong { color: #0f172a; }

  /* Task box on title page */
  .task-box {
    max-width: 80%;
    font-size: 11pt;
    color: #334155;
    line-height: 1.5;
    margin: 12px auto 4px;
    padding: 10px 16px;
    background: #f1f5f9;
    border-radius: 8px;
    border-left: 3px solid #2563eb;
    text-align: left;
  }

  /* ── Print overrides ────────────────────────────── */
  @media print {
    body { background: white !important; padding-top: 0 !important; }
    .pdf-bar { display: none !important; }

    .page {
      width: auto;
      min-height: auto;
      margin: 0;
      padding: 0;
      box-shadow: none;
      page-break-after: auto;
    }

    /* Title page gets its own page */
    .page:first-of-type { page-break-after: always; }

    /* Section titles start new pages (except the first one after title) */
    .section-title { page-break-before: auto; }

    /* Prevent cards/KPIs from splitting across pages */
    .card { break-inside: avoid; page-break-inside: avoid; }
    .kpi-grid { break-inside: avoid; page-break-inside: avoid; }
    .kpi-card { break-inside: avoid; }

    /* Headers and footers flow normally in print — browser @page handles margins */
    .page-header {
      position: static;
      margin-bottom: 12px;
    }
    .page-footer {
      position: static;
      margin-top: 20px;
    }

    /* Keep colors in print */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  }
</style>
</head>
<body>

<!-- Fixed PDF bar -->
<div class="pdf-bar">
  <span class="title">${t('Impact-Analyse', 'Impact Analysis')} &mdash; ${scenario}</span>
  <button class="pdf-btn" id="pdfBtn">
    <svg viewBox="0 0 24 24"><path d="M6 2a2 2 0 0 0-2 2v4h2V4h12v4h2V4a2 2 0 0 0-2-2H6zm-2 8a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4zm3 8v-2h10v4H7v-2zm10-5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
    ${t('PDF erzeugen', 'Generate PDF')}
  </button>
</div>

<!-- PAGE 1: Title -->
<div class="page">
  <div class="page-header">
    <span class="logo">OpenShopFloor</span>
    <span>${t('Impact-Analyse', 'Impact Analysis')} &mdash; ${scenario}</span>
  </div>
  <div class="title-page">
    <h1>${t('Impact-Analyse', 'Impact Analysis')}</h1>
    <div class="task-box">${task || scenario}</div>
    ${entityId ? `<div class="subtitle">Entity: ${entityId}</div>` : ''}
    <div class="subtitle" style="font-size:10pt;color:#94a3b8;">${now}</div>
    <div><span class="sev-badge">Severity: ${severity}</span></div>
  </div>
  <div class="page-footer">
    <span>OpenShopFloor &mdash; ZeroGuess AI</span>
    <span>${t('Seite', 'Page')} 1</span>
  </div>
</div>

<!-- PAGE 2: Overview + Specialists -->
<div class="page">
  <div class="page-header">
    <span class="logo">OpenShopFloor</span>
    <span>${t('Impact-Analyse', 'Impact Analysis')} &mdash; ${scenario}</span>
  </div>

  <h2 class="section-title">${t('Überblick', 'Overview')}</h2>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="value">${kgNodes.length}</div><div class="label">${t('KG-Knoten', 'KG Nodes')}</div></div>
    <div class="kpi-card"><div class="value">${kgEdges.length}</div><div class="label">${t('KG-Kanten', 'KG Edges')}</div></div>
    <div class="kpi-card"><div class="value">${affectedOrders}</div><div class="label">${t('Betr. Aufträge', 'Affected Orders')}</div></div>
    <div class="kpi-card"><div class="value">${totalFindings}</div><div class="label">Findings</div></div>
    <div class="kpi-card"><div class="value">${totalRecs}</div><div class="label">${t('Empfehlungen', 'Recommendations')}</div></div>
    <div class="kpi-card"><div class="value">${reports.size}</div><div class="label">${t('Spezialisten', 'Specialists')}</div></div>
  </div>

  <h2 class="section-title">${t('Spezialisten-Analyse', 'Specialist Analysis')}</h2>
  ${specialistHtml}

  <div class="page-footer">
    <span>OpenShopFloor &mdash; ZeroGuess AI</span>
    <span>${t('Seite', 'Page')} 2</span>
  </div>
</div>

${discussionHtml ? `
<!-- PAGE 3: Discussion -->
<div class="page">
  <div class="page-header">
    <span class="logo">OpenShopFloor</span>
    <span>${t('Impact-Analyse', 'Impact Analysis')} &mdash; ${scenario}</span>
  </div>

  <h2 class="section-title">${t('Moderator-Diskussion', 'Moderator Discussion')}</h2>
  <div class="card">${discussionHtml}</div>

  <div class="page-footer">
    <span>OpenShopFloor &mdash; ZeroGuess AI</span>
    <span>${t('Seite', 'Page')} 3</span>
  </div>
</div>
` : ''}

<!-- PAGE ${discussionHtml ? '4' : '3'}: Final Plan -->
<div class="page">
  <div class="page-header">
    <span class="logo">OpenShopFloor</span>
    <span>${t('Impact-Analyse', 'Impact Analysis')} &mdash; ${scenario}</span>
  </div>

  <h2 class="section-title">${t('Finaler Mitigation-Plan', 'Final Mitigation Plan')}</h2>
  <div class="card final-plan">${finalHtml}</div>

  <div style="margin-top:auto;"></div>
  <div class="page-footer">
    <span>${t('Impact-Analyse generiert am', 'Impact analysis generated on')} ${now} &middot; ${kgNodes.length} ${t('KG-Knoten', 'KG nodes')} &middot; ${reports.size} ${t('Spezialisten', 'specialists')} &middot; Severity: ${severity}</span>
    <span>${t('Seite', 'Page')} ${discussionHtml ? '4' : '3'}</span>
  </div>
</div>

<script>
document.getElementById('pdfBtn').addEventListener('click', function() {
  window.print();
});
</script>

</body>
</html>`;
}

// ─── Main: Run Discussion Agent ─────────────────────────────────────────

export async function runDiscussionAgent(
  agent: AgentDef,
  userId: string,
  tier: string,
  res: Response,
  options?: RunAgentOptions,
): Promise<void> {
  // Create run record (skip for anonymous/public runs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isAnonymous = !userId || !UUID_RE.test(userId) || userId === '00000000-0000-0000-0000-000000000000';
  let runId: string | null = null;
  if (!isAnonymous) {
    const runResult = await pool.query(
      `INSERT INTO agent_runs (user_id, agent_id, status) VALUES ($1, $2, 'running') RETURNING id`,
      [userId, agent.id],
    );
    runId = runResult.rows[0].id;
  }

  emitSSE(res, { type: 'run_start', runId, agent: agent.id });

  try {
    // Resolve LLM configs — premium for moderator, free for specialists
    const [premiumLlmConfig, freeLlmConfig] = await Promise.all([
      getLlmConfig(userId, 'premium'),
      getLlmConfig(userId, 'free'),
    ]);

    // Parse params
    const params = options?.params || {};
    const language = params.language as string | undefined;

    // Build KG context string from user message + params
    const userMsg = options?.userMessage || '';

    // ── Phase 0: KG ──
    const { kgNodes, kgEdges, kgToolResults } = await runKgPhase(agent, res, params);

    const isEn = language === 'en';
    const kgContext = kgToolResults.length > 0
      ? `${isEn ? 'KG DATA' : 'KG-DATEN'} (${kgNodes.length} ${isEn ? 'nodes' : 'Knoten'}, ${kgEdges.length} ${isEn ? 'edges' : 'Kanten'}):\n` +
        kgToolResults.map(r => `[${r.name}]: ${r.result.substring(0, 1500)}`).join('\n\n')
      : dl(language, 'Keine KG-Daten verfügbar.', 'No KG data available.');

    // ── Load factory data via agent's non-KG tools ──
    const factoryTools = agent.tools.filter(t => !t.startsWith('kg_'));
    const factoryResults: string[] = [];

    if (factoryTools.length > 0) {
      const factoryPromises = factoryTools.map(async (toolName) => {
        try {
          const result = await callMcpTool(toolName, params);
          return `[${toolName}]: ${result.substring(0, 800)}`;
        } catch {
          return `[${toolName}]: ${dl(language, 'Fehler', 'Error')}`;
        }
      });
      const settled = await Promise.allSettled(factoryPromises);
      for (const r of settled) {
        if (r.status === 'fulfilled') factoryResults.push(r.value);
      }
    }

    const factoryContext = factoryResults.length > 0
      ? factoryResults.join('\n\n')
      : dl(language, 'Keine Fabrikdaten verfügbar.', 'No factory data available.');

    // ── Phase 1: Specialists ──
    const reports = await runSpecialistsParallel(
      `${userMsg}\n\n${kgContext}`,
      factoryContext,
      agent,
      freeLlmConfig,
      userId,
      res,
      IMPACT_SPECIALISTS,
      undefined,
      language,
    );

    if (reports.size === 0) {
      emitSSE(res, { type: 'content', text: dl(language, 'Keine Spezialisten-Berichte verfügbar. Die Analyse konnte nicht durchgeführt werden.', 'No specialist reports available. Analysis could not be performed.') });
      emitSSE(res, { type: 'done', runId });
      if (runId) {
        await pool.query(
          `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
          [JSON.stringify({ error: 'No specialist reports' }), runId],
        );
      }
      return;
    }

    // ── Phase 2: Moderator Discussion (max 2 rounds) ──
    let readyForSynthesis = false;
    let transcript = '';

    const activeSpecialists = [...IMPACT_SPECIALISTS];
    for (let round = 1; round <= 2 && !readyForSynthesis; round++) {
      const result = await runModeratorReview(
        reports, round, transcript,
        premiumLlmConfig, freeLlmConfig,
        userId, res, undefined, language,
        activeSpecialists, kgContext, factoryContext,
      );
      readyForSynthesis = result.readyForSynthesis;
      transcript = result.followUpTranscript;
    }

    // ── Phase 3: Debate + Synthesis ──
    const finalMitigation = await runDebate(
      reports, transcript,
      premiumLlmConfig, freeLlmConfig,
      userId, res,
      IMPACT_SPECIALISTS, undefined,
      userMsg || undefined, language,
    );

    // ── Phase 4: Generate HTML Report ──
    const htmlReport = generateHtmlReport(
      finalMitigation, reports,
      kgNodes, kgEdges,
      transcript, params,
      IMPACT_SPECIALISTS, language,
      userMsg || undefined,
      agent.name,
    );

    // Save report to DB — embed HTML in result JSON (no extra column needed)
    if (runId) {
      await pool.query(
        `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({
          content: finalMitigation,
          reportHtml: htmlReport,
          specialists: Array.from(reports.keys()),
          kgNodes: kgNodes.length,
          kgEdges: kgEdges.length,
        }), runId],
      );
    }

    // Stream final mitigation text as content
    const chunkSize = 30;
    for (let i = 0; i < finalMitigation.length; i += chunkSize) {
      emitSSE(res, { type: 'content', text: finalMitigation.slice(i, i + chunkSize) });
    }

    // Send report download link
    const reportUrl = `/agents/impact-analysis/runs/${runId}/report`;
    emitSSE(res, { type: 'report_ready', reportUrl });

    emitSSE(res, { type: 'done', runId });
  } catch (err: any) {
    logger.error({ err: err.message, agentId: agent.id, userId }, 'Discussion agent error');
    if (runId) {
      await pool.query(
        `UPDATE agent_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: err.message }), runId],
      );
    }
    emitSSE(res, { type: 'error', message: 'Discussion agent execution failed' });
  }
}

// ─── Dynamic Discussion (triggered from chat intent classifier) ──────────

/** Phase 0 NEW: 32B plans which specialists are needed for a given question */
async function planSpecialists(
  userQuestion: string,
  toolNames: string[],
  premiumLlmConfig: LlmConfig,
  userId: string,
  signal?: AbortSignal,
  language?: string,
): Promise<{ specialists: SpecialistDef[]; relevantTools: string[] }> {
  const isEn = language === 'en';
  const skills = loadPrompt('skills');
  const toolRef = skills || `AVAILABLE MCP-TOOLS: ${toolNames.join(', ')}`;

  const prompt = isEn
    ? `You are a manufacturing expert. Analyze the user question and plan 3-5 specialists for a multi-agent discussion.

TOOL REFERENCE:
${toolRef}

USER QUESTION: "${userQuestion}"

Based on the skills reference above, determine which specialists are needed and which tools each specialist should use.

RESPONSE FORMAT: Pure JSON, NO Markdown.
{
  "specialists": [
    { "name": "slug-name", "domain": "DOMAIN_KEY", "displayName": "Display Name", "focus": "What this specialist should focus on" }
  ],
  "relevantTools": ["tool_name_1", "tool_name_2"]
}

Rules:
- 3-5 specialists, matching the question
- name: short slug (e.g. "inventory-optimizer", "production-planner")
- domain: uppercase key (e.g. "INVENTORY_OPTIMIZATION", "PRODUCTION_PLANNING")
- displayName: English display name
- relevantTools: only tools from the available list that match the question
- Be creative with specialists — they don't have to be the default 4`
    : `Du bist ein Manufacturing-Experte. Analysiere die User-Frage und plane 3-5 Spezialisten für eine Multi-Agent-Diskussion.

TOOL-REFERENZ:
${toolRef}

USER-FRAGE: "${userQuestion}"

Basierend auf der Tool-Referenz oben, bestimme welche Spezialisten benötigt werden und welche Tools jeder Spezialist nutzen sollte.

ANTWORT-FORMAT: Reines JSON, KEIN Markdown.
{
  "specialists": [
    { "name": "slug-name", "domain": "DOMAIN_KEY", "displayName": "Anzeigename", "focus": "Worauf dieser Spezialist achten soll" }
  ],
  "relevantTools": ["tool_name_1", "tool_name_2"]
}

Regeln:
- 3-5 Spezialisten, passend zur Frage
- name: kurzer slug (z.B. "inventory-optimizer", "production-planner")
- domain: Großbuchstaben-Key (z.B. "BESTANDSOPTIMIERUNG", "PRODUKTIONSPLANUNG")
- relevantTools: nur Tools aus der verfügbaren Liste die zur Frage passen
- Sei kreativ mit den Spezialisten — sie müssen nicht die Standard-4 sein`;

  try {
    const result = await callLlmJson<{ specialists: SpecialistDef[]; relevantTools: string[] }>(
      [
        { role: 'system', content: isEn
          ? 'You are a strategic manufacturing planner.'
          : 'Du bist ein strategischer Fertigungsplaner.' },
        { role: 'user', content: prompt },
      ],
      premiumLlmConfig,
      userId,
      signal,
    );

    // Validate: need at least 2 specialists
    if (!result.specialists || result.specialists.length < 2) {
      throw new Error('Too few specialists planned');
    }

    // Filter relevantTools to only those that actually exist
    const validTools = (result.relevantTools || []).filter(t => toolNames.includes(t));

    return {
      specialists: result.specialists.slice(0, 5).map(s => ({
        name: s.name || 'unknown',
        domain: s.domain || 'GENERAL',
        displayName: s.displayName || s.name || dl(language, 'Spezialist', 'Specialist'),
        focus: s.focus || '',
      })),
      relevantTools: validTools,
    };
  } catch (err: any) {
    logger.warn({ err: err.message }, 'planSpecialists failed, falling back to defaults');
    return {
      specialists: IMPACT_SPECIALISTS,
      relevantTools: toolNames.filter(t => t.startsWith('kg_') || t.startsWith('factory_')),
    };
  }
}

/** Run a full dynamic multi-agent discussion triggered by chat intent classifier */
export async function runDynamicDiscussion(
  userMessage: string,
  userId: string,
  tier: string,
  sessionId: string,
  res: Response,
  signal?: AbortSignal,
  language?: string,
): Promise<string> {
  const [premiumLlmConfig, freeLlmConfig, tools] = await Promise.all([
    getLlmConfig(userId, 'premium'),
    getLlmConfig(userId, 'free'),
    getMcpTools(),
  ]);

  const toolNames = tools.map((t: any) => t.function?.name || t.name).filter(Boolean);

  // ── Phase 0: Plan specialists dynamically ──
  emitSSE(res, { type: 'intent_classification', result: 'complex', message: dl(language, 'Strategische Frage erkannt — starte Multi-Agent-Diskussion', 'Strategic question detected — starting multi-agent discussion') });

  const { specialists, relevantTools } = await planSpecialists(
    userMessage, toolNames, premiumLlmConfig, userId, signal, language,
  );

  emitSSE(res, {
    type: 'specialists_planned',
    specialists: specialists.map(s => ({ name: s.name, displayName: s.displayName, domain: s.domain })),
    relevantTools,
  });

  // Build a dynamic agent definition
  const dynamicAgent: AgentDef = {
    id: 'dynamic-discussion',
    name: 'Dynamic Discussion',
    type: 'strategic',
    category: 'Strategic',
    description: `${dl(language, 'Dynamische Analyse', 'Dynamic Analysis')}: ${userMessage.slice(0, 80)}`,
    systemPrompt: '',
    tools: relevantTools,
    difficulty: 'Expert',
    icon: '🧠',
  };

  // ── Phase 0b: KG traversal ──
  // Extract entity IDs from user message for KG tool parameterization
  const machineMatch = userMessage.match(/(?:Maschine|Machine|machine)\s*(\d{4,5})/i)
    || userMessage.match(/\b(\d{4,5})\b/); // fallback: any 4-5 digit number
  const orderMatch = userMessage.match(/\b(FA\d{6,})\b/i);
  const extractedMachineId = machineMatch?.[1];
  const extractedEntityId = extractedMachineId || orderMatch?.[1];

  const params: Record<string, unknown> = {
    scenario: userMessage.slice(0, 100),
    ...(extractedMachineId && { machineId: extractedMachineId }),
    ...(extractedEntityId && { entityId: extractedEntityId }),
  };
  logger.info({ extractedMachineId, extractedEntityId, scenario: params.scenario }, 'KG phase: extracted entity from user message');
  const { kgNodes, kgEdges, kgToolResults } = await runKgPhase(dynamicAgent, res, params);

  const isEn = language === 'en';
  const kgContext = kgToolResults.length > 0
    ? `${isEn ? 'KG DATA' : 'KG-DATEN'} (${kgNodes.length} ${isEn ? 'nodes' : 'Knoten'}, ${kgEdges.length} ${isEn ? 'edges' : 'Kanten'}):\n` +
      kgToolResults.map(r => `[${r.name}]: ${r.result.substring(0, 1500)}`).join('\n\n')
    : dl(language, 'Keine KG-Daten verfügbar.', 'No KG data available.');

  // ── Load factory data via non-KG tools ──
  const factoryToolNames = relevantTools.filter(t => !t.startsWith('kg_'));
  const factoryResults: string[] = [];

  if (factoryToolNames.length > 0) {
    const settled = await Promise.allSettled(
      factoryToolNames.map(async (toolName) => {
        try {
          const result = await callMcpTool(toolName, {});
          return `[${toolName}]: ${result.substring(0, 800)}`;
        } catch {
          return `[${toolName}]: ${dl(language, 'Fehler', 'Error')}`;
        }
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') factoryResults.push(r.value);
    }
  }

  const factoryContext = factoryResults.length > 0
    ? factoryResults.join('\n\n')
    : dl(language, 'Keine Fabrikdaten verfügbar.', 'No factory data available.');

  // ── Phase 1: Specialists (with dynamic list) ──
  const reports = await runSpecialistsParallel(
    `${isEn ? 'USER QUESTION' : 'USER-FRAGE'}: ${userMessage}\n\n${kgContext}`,
    factoryContext,
    dynamicAgent,
    freeLlmConfig,
    userId,
    res,
    specialists,
    signal,
    language,
  );

  if (reports.size === 0) {
    const fallback = dl(language,
      'Die Multi-Agent-Analyse konnte keine Spezialisten-Berichte erzeugen. Bitte stelle die Frage anders oder versuche es erneut.',
      'The multi-agent analysis could not produce specialist reports. Please rephrase your question or try again.'
    );
    emitSSE(res, { type: 'done' });
    return fallback;
  }

  // ── Phase 2: Moderator Discussion ──
  let readyForSynthesis = false;
  let transcript = '';
  const activeSpecialists = [...specialists];

  for (let round = 1; round <= 2 && !readyForSynthesis; round++) {
    const result = await runModeratorReview(
      reports, round, transcript,
      premiumLlmConfig, freeLlmConfig,
      userId, res, signal, language,
      activeSpecialists, kgContext, factoryContext,
    );
    readyForSynthesis = result.readyForSynthesis;
    transcript = result.followUpTranscript;
  }

  // ── Phase 3: Debate + Synthesis ──
  const finalText = await runDebate(
    reports, transcript,
    premiumLlmConfig, freeLlmConfig,
    userId, res,
    specialists, signal,
    userMessage, language,
  );

  // ── Phase 4: Generate HTML Report ──
  // Derive a short report title from the user question (first 60 chars)
  const dynamicTitle = userMessage.length > 60
    ? userMessage.substring(0, 57) + '...'
    : userMessage;

  const htmlReport = generateHtmlReport(
    finalText, reports,
    kgNodes, kgEdges,
    transcript, params,
    specialists, language,
    userMessage,
    dl(language, 'Strategische Analyse', 'Strategic Analysis'),
  );

  // Save to agent_runs for report download (skip for anonymous users)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isAnon = !userId || !UUID_RE.test(userId) || userId === '00000000-0000-0000-0000-000000000000';
  if (!isAnon) {
    const runResult = await pool.query(
      `INSERT INTO agent_runs (user_id, agent_id, status, result, finished_at)
       VALUES ($1, 'dynamic-discussion', 'completed', $2, NOW()) RETURNING id`,
      [userId, JSON.stringify({
        content: finalText,
        reportHtml: htmlReport,
        specialists: specialists.map(s => s.name),
        kgNodes: kgNodes.length,
        kgEdges: kgEdges.length,
      })],
    );
    const reportUrl = `/agents/impact-analysis/runs/${runResult.rows[0].id}/report`;
    emitSSE(res, { type: 'report_ready', reportUrl });
  }

  return finalText;
}
