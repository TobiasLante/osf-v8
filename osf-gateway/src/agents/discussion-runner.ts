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

  // Extract graph
  const { nodes, edges } = extractKgGraph(toolResults, entityId);

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
): Promise<SpecialistReport> {
  const systemPrompt = `Du bist der ${specialist.displayName}. Dein Fokus: ${specialist.focus}.
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
    { role: 'user', content: `Analysiere folgende Daten:\n\n${context}` },
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
        const context = `SZENARIO-KONTEXT:\n${kgData}\n\nFABRIK-DATEN:\n${factoryData}`;
        const report = await runSpecialistLlm(spec, context, freeLlmConfig, userId, signal);
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
): Promise<{ readyForSynthesis: boolean; followUpTranscript: string }> {
  emitSSE(res, { type: 'discussion_round_start', discussionRound: round });

  // Compress all reports for moderator context
  const compressed = Array.from(reports.entries())
    .map(([name, report]) => compressReport(name, report))
    .join('\n\n');

  const moderatorPrompt = `Du bist der Moderator einer Impact-Analyse-Diskussion mit 4 Spezialisten.

SPEZIALISTEN-BERICHTE:
${compressed}

${previousAnswers ? `BISHERIGE DISKUSSION:\n${previousAnswers}\n` : ''}

Analysiere die Berichte und identifiziere:
1. Lücken (fehlende Informationen)
2. Widersprüche zwischen Spezialisten
3. Follow-Up-Fragen (max 3) an spezifische Spezialisten

ANTWORT-FORMAT: Reines JSON.
{
  "gaps": ["..."],
  "contradictions": ["..."],
  "followUpQuestions": [
    { "targetSpecialist": "oee-impact|otd-impact|cost-impact|quality-impact", "question": "...", "context": "..." }
  ],
  "preliminaryInsights": ["..."],
  "readyForSynthesis": false
}`;

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);

  let review: any;
  try {
    review = await callLlmJson<any>(
      [
        { role: 'system', content: 'Du bist ein erfahrener Moderator für Impact-Analysen in der Fertigung.' },
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

  // Process follow-up questions
  let transcript = previousAnswers;
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
    const specContext = specReport ? compressReport(target, specReport) : 'Keine Daten verfügbar.';

    const heartbeat2 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
    let answer: string;
    try {
      const answerResponse = await callLlm(
        [
          { role: 'system', content: `Du bist der Spezialist für ${target}. Beantworte die Frage basierend auf deiner Analyse.` },
          { role: 'user', content: `Deine bisherige Analyse:\n${specContext}\n\nFrage des Moderators: ${question}\n\nAntworte in 2-3 Sätzen, präzise und faktisch.` },
        ],
        undefined,
        freeLlmConfig,
        userId,
        signal,
      );
      answer = answerResponse.content || 'Keine Antwort.';
    } catch {
      answer = 'Spezialist konnte nicht antworten.';
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
): Promise<string> {
  // 3a: Moderator drafts answer
  emitSSE(res, { type: 'debate_start' });
  emitSSE(res, { type: 'discussion_synthesis_start' });

  const compressed = Array.from(reports.entries())
    .map(([name, report]) => compressReport(name, report))
    .join('\n\n');

  const questionContext = userMessage
    ? `\nURSPRÜNGLICHE USER-FRAGE: "${userMessage}"\nDeine Antwort MUSS diese Frage DIREKT beantworten. Nenne konkrete Daten, Zahlen, Namen aus den Berichten.\n`
    : '';

  const draftPrompt = `${questionContext}
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

Antworte als strukturierter Text (Markdown). Antworte in derselben Sprache wie die User-Frage.`;

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let draftText: string;
  try {
    const draftResponse = await callLlm(
      [
        { role: 'system', content: 'Du bist ein erfahrener Fertigungsexperte. Beantworte Fragen direkt und datenbasiert. Erfinde KEINE Namen oder Fakten.' },
        { role: 'user', content: draftPrompt },
      ],
      undefined,
      premiumLlmConfig,
      userId,
      signal,
    );
    draftText = draftResponse.content || 'Entwurf konnte nicht erstellt werden.';
  } catch (err: any) {
    logger.error({ err: err.message }, 'Draft mitigation failed');
    draftText = 'Entwurf-Erstellung fehlgeschlagen.';
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

        const critiquePrompt = `Du bist der ${displayName}. Kritisiere folgenden Mitigation-Plan aus deiner Fachperspektive.

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
              { role: 'system', content: `Du bist ein kritischer ${displayName}. Sei konstruktiv aber ehrlich.` },
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
            debateCritiqueItems: [{ type: 'critic', text: 'Konnte keine Kritik erstellen' }],
            debateCritiqueAssessment: 'Fehler bei der Bewertung',
          });
        } finally {
          clearInterval(heartbeat2);
        }
      })
    );
  }

  // 3c: Final synthesis incorporating critiques
  const finalQuestionContext = userMessage ? `\nURSPRÜNGLICHE USER-FRAGE: "${userMessage}"\nDie Antwort MUSS diese Frage DIREKT beantworten.\n` : '';
  const finalPrompt = `Finalisiere die Antwort nach der Spezialisten-Debatte.
${finalQuestionContext}
URSPRÜNGLICHER ENTWURF:
${draftText.substring(0, 3000)}

SPEZIALISTEN-KRITIK:
${allCritiques.join('\n\n')}

Erstelle die FINALE Antwort. Arbeite berechtigte Kritikpunkte ein.
- Beginne mit der DIREKTEN ANTWORT auf die User-Frage
- Nenne konkrete Zahlen, Maschinen-IDs, Artikel-Nummern aus den Daten
- Erfinde KEINE Personennamen oder Organisationseinheiten
- Format: Strukturierter Markdown-Text. Antworte in derselben Sprache wie die Frage.`;

  const heartbeat3 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let finalText: string;
  try {
    const finalResponse = await callLlm(
      [
        { role: 'system', content: 'Du bist ein erfahrener Fertigungsexperte. Beantworte die Frage direkt, präzise und datenbasiert. Erfinde KEINE Namen oder Fakten.' },
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
): string {
  const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const entityId = esc(String(params.entityId || params.machineId || 'unknown'));
  const scenario = esc(String(params.scenario || 'Impact-Analyse'));
  const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

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
      ${recsHtml ? `<h4>Empfehlungen</h4><ul>${recsHtml}</ul>` : ''}
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

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Impact-Analyse: ${scenario} — ${now}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0a0a0f; color: #e2e8f0; line-height: 1.6; }
  .slide { min-height: 100vh; padding: 3rem; display: flex; flex-direction: column; border-bottom: 1px solid #1e293b; }
  h1 { font-size: 2.5rem; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  h2 { font-size: 1.8rem; color: #a78bfa; margin-bottom: 1.5rem; }
  h3 { font-size: 1.2rem; color: #60a5fa; margin: 1rem 0 0.5rem; }
  h4 { font-size: 0.95rem; color: #94a3b8; margin: 0.8rem 0 0.3rem; }
  .card { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1.5rem; margin: 0.5rem 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  .badge { display: inline-block; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; margin-right: 4px; }
  .badge-sofort { background: #f8717122; color: #f87171; border: 1px solid #f8717133; }
  .badge-heute { background: #fbbf2422; color: #fbbf24; border: 1px solid #fbbf2433; }
  .badge-woche { background: #60a5fa22; color: #60a5fa; border: 1px solid #60a5fa33; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
  th { color: #94a3b8; font-weight: 600; }
  ul { padding-left: 1.5rem; margin: 0.5rem 0; }
  li { margin: 0.3rem 0; font-size: 0.9rem; }
  .subtitle { color: #94a3b8; font-size: 1rem; margin-top: 0.5rem; }
  .summary { background: #1e293b; border-left: 3px solid #a78bfa; padding: 1rem 1.5rem; border-radius: 0 8px 8px 0; margin: 0.5rem 0; font-size: 0.9rem; }
  .sev-badge { display: inline-block; font-size: 0.8rem; font-weight: 700; padding: 4px 12px; border-radius: 4px; color: ${sevColor}; background: ${sevColor}22; border: 1px solid ${sevColor}44; }
  .footer { text-align: center; color: #64748b; font-size: 0.8rem; padding: 2rem; }
  @media print { .slide { min-height: auto; page-break-after: always; } body { background: white; color: #1e293b; } .card { border-color: #e2e8f0; } }
</style>
</head>
<body>

<!-- Slide 1: Title -->
<div class="slide" style="justify-content:center;align-items:center;text-align:center;">
  <h1>Impact-Analyse</h1>
  <p class="subtitle">${scenario} &mdash; Entity: ${entityId}</p>
  <p class="subtitle">${now}</p>
  <div style="margin-top:2rem;"><span class="sev-badge">Severity: ${severity}</span></div>
</div>

<!-- Slide 2: Overview -->
<div class="slide">
  <h2>Ueberblick</h2>
  <div class="grid">
    <div class="card"><h3>${kgNodes.length}</h3><p class="subtitle">Knowledge-Graph Knoten</p></div>
    <div class="card"><h3>${kgEdges.length}</h3><p class="subtitle">Knowledge-Graph Kanten</p></div>
    <div class="card"><h3>${affectedOrders}</h3><p class="subtitle">Betroffene Auftraege</p></div>
    <div class="card"><h3>${totalFindings}</h3><p class="subtitle">Findings</p></div>
    <div class="card"><h3>${totalRecs}</h3><p class="subtitle">Empfehlungen</p></div>
    <div class="card"><h3>${reports.size}</h3><p class="subtitle">Spezialisten</p></div>
  </div>
</div>

<!-- Slide 3: Specialist Analysis -->
<div class="slide">
  <h2>Spezialisten-Analyse</h2>
  ${specialistHtml}
</div>

${discussionHtml ? `
<!-- Slide 4: Discussion -->
<div class="slide">
  <h2>Moderator-Diskussion</h2>
  <div class="card">${discussionHtml}</div>
</div>
` : ''}

<!-- Slide 5: Mitigation Plan -->
<div class="slide">
  <h2>Finaler Mitigation-Plan</h2>
  <div class="card">${finalHtml}</div>
</div>

<div class="footer">
  Impact-Analyse generiert am ${now} | ${kgNodes.length} KG-Knoten | ${reports.size} Spezialisten | Severity: ${severity}<br>
  OpenShopFloor &mdash; ZeroGuess AI
</div>

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
  // Create run record
  const runResult = await pool.query(
    `INSERT INTO agent_runs (user_id, agent_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, agent.id],
  );
  const runId = runResult.rows[0].id;

  emitSSE(res, { type: 'run_start', runId, agent: agent.id });

  try {
    // Resolve LLM configs — premium for moderator, free for specialists
    const [premiumLlmConfig, freeLlmConfig] = await Promise.all([
      getLlmConfig(userId, 'premium'),
      getLlmConfig(userId, 'free'),
    ]);

    // Parse params
    const params = options?.params || {};

    // Build KG context string from user message + params
    const userMsg = options?.userMessage || '';

    // ── Phase 0: KG ──
    const { kgNodes, kgEdges, kgToolResults } = await runKgPhase(agent, res, params);

    const kgContext = kgToolResults.length > 0
      ? `KG-DATEN (${kgNodes.length} Knoten, ${kgEdges.length} Kanten):\n` +
        kgToolResults.map(r => `[${r.name}]: ${r.result.substring(0, 1500)}`).join('\n\n')
      : 'Keine KG-Daten verfügbar.';

    // ── Load factory data via agent's non-KG tools ──
    const factoryTools = agent.tools.filter(t => !t.startsWith('kg_'));
    const factoryResults: string[] = [];

    if (factoryTools.length > 0) {
      const factoryPromises = factoryTools.map(async (toolName) => {
        try {
          const result = await callMcpTool(toolName, params);
          return `[${toolName}]: ${result.substring(0, 800)}`;
        } catch {
          return `[${toolName}]: Fehler`;
        }
      });
      const settled = await Promise.allSettled(factoryPromises);
      for (const r of settled) {
        if (r.status === 'fulfilled') factoryResults.push(r.value);
      }
    }

    const factoryContext = factoryResults.length > 0
      ? factoryResults.join('\n\n')
      : 'Keine Fabrikdaten verfügbar.';

    // ── Phase 1: Specialists ──
    const reports = await runSpecialistsParallel(
      `${userMsg}\n\n${kgContext}`,
      factoryContext,
      agent,
      freeLlmConfig,
      userId,
      res,
    );

    if (reports.size === 0) {
      emitSSE(res, { type: 'content', text: 'Keine Spezialisten-Berichte verfügbar. Die Analyse konnte nicht durchgeführt werden.' });
      emitSSE(res, { type: 'done', runId });
      await pool.query(
        `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
        [JSON.stringify({ error: 'No specialist reports' }), runId],
      );
      return;
    }

    // ── Phase 2: Moderator Discussion (max 2 rounds) ──
    let readyForSynthesis = false;
    let transcript = '';

    for (let round = 1; round <= 2 && !readyForSynthesis; round++) {
      const result = await runModeratorReview(
        reports, round, transcript,
        premiumLlmConfig, freeLlmConfig,
        userId, res,
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
      userMsg || undefined,
    );

    // ── Phase 4: Generate HTML Report ──
    const htmlReport = generateHtmlReport(
      finalMitigation, reports,
      kgNodes, kgEdges,
      transcript, params,
    );

    // Save report to DB — embed HTML in result JSON (no extra column needed)
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
    await pool.query(
      `UPDATE agent_runs SET status = 'failed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({ error: err.message }), runId],
    );
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
): Promise<{ specialists: SpecialistDef[]; relevantTools: string[] }> {
  const prompt = `Du bist ein Manufacturing-Experte. Analysiere die User-Frage und plane 3-5 Spezialisten für eine Multi-Agent-Diskussion.

VERFÜGBARE MCP-TOOLS: ${toolNames.join(', ')}

USER-FRAGE: "${userQuestion}"

Bestimme welche Spezialisten benötigt werden und welche Tools relevant sind.

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
        { role: 'system', content: 'Du bist ein strategischer Fertigungsplaner.' },
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
        displayName: s.displayName || s.name || 'Spezialist',
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
): Promise<string> {
  const [premiumLlmConfig, freeLlmConfig, tools] = await Promise.all([
    getLlmConfig(userId, 'premium'),
    getLlmConfig(userId, 'free'),
    getMcpTools(),
  ]);

  const toolNames = tools.map((t: any) => t.function?.name || t.name).filter(Boolean);

  // ── Phase 0: Plan specialists dynamically ──
  emitSSE(res, { type: 'intent_classification', result: 'complex', message: 'Strategische Frage erkannt — starte Multi-Agent-Diskussion' });

  const { specialists, relevantTools } = await planSpecialists(
    userMessage, toolNames, premiumLlmConfig, userId, signal,
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
    description: `Dynamische Analyse: ${userMessage.slice(0, 80)}`,
    systemPrompt: '',
    tools: relevantTools,
    difficulty: 'Expert',
    icon: '🧠',
  };

  // ── Phase 0b: KG traversal ──
  const params: Record<string, unknown> = { scenario: userMessage.slice(0, 100) };
  const { kgNodes, kgEdges, kgToolResults } = await runKgPhase(dynamicAgent, res, params);

  const kgContext = kgToolResults.length > 0
    ? `KG-DATEN (${kgNodes.length} Knoten, ${kgEdges.length} Kanten):\n` +
      kgToolResults.map(r => `[${r.name}]: ${r.result.substring(0, 1500)}`).join('\n\n')
    : 'Keine KG-Daten verfügbar.';

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
          return `[${toolName}]: Fehler`;
        }
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') factoryResults.push(r.value);
    }
  }

  const factoryContext = factoryResults.length > 0
    ? factoryResults.join('\n\n')
    : 'Keine Fabrikdaten verfügbar.';

  // ── Phase 1: Specialists (with dynamic list) ──
  const reports = await runSpecialistsParallel(
    `USER-FRAGE: ${userMessage}\n\n${kgContext}`,
    factoryContext,
    dynamicAgent,
    freeLlmConfig,
    userId,
    res,
    specialists,
    signal,
  );

  if (reports.size === 0) {
    const fallback = 'Die Multi-Agent-Analyse konnte keine Spezialisten-Berichte erzeugen. Bitte stelle die Frage anders oder versuche es erneut.';
    emitSSE(res, { type: 'done' });
    return fallback;
  }

  // ── Phase 2: Moderator Discussion ──
  let readyForSynthesis = false;
  let transcript = '';

  for (let round = 1; round <= 2 && !readyForSynthesis; round++) {
    const result = await runModeratorReview(
      reports, round, transcript,
      premiumLlmConfig, freeLlmConfig,
      userId, res, signal,
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
    userMessage,
  );

  // ── Phase 4: Generate HTML Report ──
  const htmlReport = generateHtmlReport(
    finalText, reports,
    kgNodes, kgEdges,
    transcript, params,
    specialists,
  );

  // Save to agent_runs for report download
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
  const runId = runResult.rows[0].id;

  const reportUrl = `/agents/impact-analysis/runs/${runId}/report`;
  emitSSE(res, { type: 'report_ready', reportUrl });

  return finalText;
}
