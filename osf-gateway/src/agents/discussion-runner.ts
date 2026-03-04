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

interface SpecialistDef {
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

function emitSSE(res: Response, event: Record<string, unknown>): void {
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
async function callLlmJson<T>(
  messages: ChatMessage[],
  config: LlmConfig,
  userId?: string,
): Promise<T> {
  const response = await callLlm(messages, undefined, config, userId);
  const text = (response.content || '').trim();
  // Extract JSON from markdown code blocks if needed
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
  return cleanLlmOutput(JSON.parse(jsonStr)) as T;
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

  // Call all KG tools in parallel
  const toolResults: Array<{ name: string; result: string }> = [];
  const kgPromises = kgTools.map(async (toolName) => {
    try {
      const args: Record<string, unknown> = { ...params };
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
): Promise<SpecialistReport> {
  const systemPrompt = `Du bist der ${specialist.displayName}. Dein Fokus: ${specialist.focus}.
Analysiere die bereitgestellten Daten und erstelle eine Impact-Analyse für deinen Bereich.

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

  return await callLlmJson<SpecialistReport>(messages, freeLlmConfig, userId);
}

async function runSpecialistsParallel(
  kgData: string,
  factoryData: string,
  agent: AgentDef,
  freeLlmConfig: LlmConfig,
  userId: string,
  res: Response,
): Promise<Map<string, SpecialistReport>> {
  const reports = new Map<string, SpecialistReport>();
  const specialistNames = IMPACT_SPECIALISTS.map(s => s.name);

  emitSSE(res, {
    type: 'specialists_batch_start',
    specialistCount: IMPACT_SPECIALISTS.length,
    specialistNames,
  });

  const startTime = Date.now();

  const results = await Promise.allSettled(
    IMPACT_SPECIALISTS.map(async (spec) => {
      const specStart = Date.now();
      emitSSE(res, {
        type: 'specialist_start',
        specialistName: spec.name,
        specialistDomain: spec.domain,
        specialistDisplayName: spec.displayName,
      });

      try {
        const context = `SZENARIO-KONTEXT:\n${kgData}\n\nFABRIK-DATEN:\n${factoryData}`;
        const report = await runSpecialistLlm(spec, context, freeLlmConfig, userId);
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
    const spec = IMPACT_SPECIALISTS[i];
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
    specialistCount: IMPACT_SPECIALISTS.length,
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
): Promise<string> {
  // 3a: Moderator drafts mitigation plan
  emitSSE(res, { type: 'debate_start' });
  emitSSE(res, { type: 'discussion_synthesis_start' });

  const compressed = Array.from(reports.entries())
    .map(([name, report]) => compressReport(name, report))
    .join('\n\n');

  const draftPrompt = `Basierend auf den Spezialisten-Berichten und der Diskussion, erstelle einen Mitigation-Plan.

SPEZIALISTEN-BERICHTE:
${compressed}

DISKUSSION:
${discussionTranscript || 'Keine weiteren Diskussionspunkte.'}

Erstelle eine Zusammenfassung mit:
1. Executive Summary (2-3 Sätze)
2. Impact-Schweregrad (critical/high/medium/low)
3. Top 5 Maßnahmen mit Priorität und Verantwortlichkeit
4. Risiko-Bewertung

Antworte als strukturierter Text (Markdown).`;

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let draftText: string;
  try {
    const draftResponse = await callLlm(
      [
        { role: 'system', content: 'Du bist ein erfahrener Fertigungsleiter, der einen Impact-Mitigation-Plan erstellt.' },
        { role: 'user', content: draftPrompt },
      ],
      undefined,
      premiumLlmConfig,
      userId,
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
        const specDef = IMPACT_SPECIALISTS.find(s => s.name === name);
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
  const finalPrompt = `Finalisiere den Mitigation-Plan nach der Spezialisten-Debatte.

URSPRÜNGLICHER ENTWURF:
${draftText.substring(0, 3000)}

SPEZIALISTEN-KRITIK:
${allCritiques.join('\n\n')}

Erstelle den FINALEN Plan. Arbeite berechtigte Kritikpunkte ein.
Format: Strukturierter Markdown-Text mit Executive Summary, Maßnahmen, Risiken.`;

  const heartbeat3 = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);
  let finalText: string;
  try {
    const finalResponse = await callLlm(
      [
        { role: 'system', content: 'Du bist ein erfahrener Fertigungsleiter. Erstelle den finalen, optimierten Mitigation-Plan.' },
        { role: 'user', content: finalPrompt },
      ],
      undefined,
      premiumLlmConfig,
      userId,
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

function generateReport(
  finalText: string,
  reports: Map<string, SpecialistReport>,
  kgNodes: KgNode[],
  kgEdges: KgEdge[],
  transcript: string,
  params: Record<string, unknown>,
): string {
  const entityId = String(params.entityId || params.machineId || 'unknown');
  const scenario = String(params.scenario || 'Impact-Analyse');
  const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Extract severity from final text
  const severityMatch = finalText.match(/severity[:\s]*(critical|high|medium|low)/i)
    || finalText.match(/(CRITICAL|HIGH|MEDIUM|LOW)/);
  const severity = severityMatch ? severityMatch[1].toUpperCase() : 'HIGH';
  const severityEmoji = severity === 'CRITICAL' ? '\u{1F534}' : severity === 'HIGH' ? '\u{1F7E0}' : severity === 'MEDIUM' ? '\u{1F7E1}' : '\u{1F7E2}';

  // Count stats
  const totalFindings = Array.from(reports.values())
    .reduce((sum, r) => sum + safeArray(r.kritischeFindings).length, 0);
  const totalRecs = Array.from(reports.values())
    .reduce((sum, r) => sum + safeArray(r.empfehlungen).length, 0);
  const affectedOrders = kgNodes.filter(n => n.type === 'order').length;
  const affectedCustomers = kgNodes.filter(n => n.type === 'customer').length;
  const alternatives = kgNodes.filter(n => n.type === 'alternative').length;

  let md = '';

  // ── Header ──
  md += `## ${severityEmoji} Impact-Analyse: ${scenario}\n\n`;
  md += `**Entity:** ${entityId} | **Datum:** ${dateStr} | **Severity:** ${severity}\n\n`;

  // ── KPI Overview ──
  md += `### Ueberblick\n\n`;
  md += `| Metrik | Wert |\n|--------|------|\n`;
  md += `| KG-Knoten | ${kgNodes.length} |\n`;
  md += `| KG-Kanten | ${kgEdges.length} |\n`;
  md += `| Betroffene Auftraege | ${affectedOrders} |\n`;
  md += `| Betroffene Kunden | ${affectedCustomers} |\n`;
  md += `| Alternativen | ${alternatives} |\n`;
  md += `| Findings gesamt | ${totalFindings} |\n`;
  md += `| Empfehlungen gesamt | ${totalRecs} |\n\n`;

  // ── Specialist Summaries ──
  md += `### Spezialisten-Analyse\n\n`;
  for (const [name, report] of reports.entries()) {
    const specDef = IMPACT_SPECIALISTS.find(s => s.name === name);
    const displayName = specDef?.displayName || name;
    const findings = safeArray(report.kritischeFindings);
    const recs = safeArray(report.empfehlungen);

    md += `**${displayName}** (${report.domain || name})\n`;
    if (report.zahlenDatenFakten) {
      md += `> ${String(report.zahlenDatenFakten).substring(0, 300)}\n`;
    }
    md += `\n`;

    if (findings.length > 0) {
      md += `Findings:\n`;
      for (const f of findings.slice(0, 3)) {
        const finding = typeof f === 'string' ? f : f?.finding || JSON.stringify(f);
        const sev = typeof f === 'object' ? f?.severity || '' : '';
        md += `- ${sev ? `[${sev}] ` : ''}${finding}\n`;
      }
      md += `\n`;
    }

    if (recs.length > 0) {
      md += `Empfehlungen:\n`;
      for (const r of recs.slice(0, 3)) {
        const action = typeof r === 'string' ? r : r?.maßnahme || JSON.stringify(r);
        const prio = typeof r === 'object' ? r?.priorität || '' : '';
        md += `- ${prio ? `[${prio}] ` : ''}${action}\n`;
      }
      md += `\n`;
    }
  }

  // ── Discussion Summary ──
  if (transcript.trim()) {
    md += `### Diskussion\n\n`;
    const lines = transcript.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 20)) {
      if (line.includes('Moderator →') || line.includes('Moderator →')) {
        md += `**${line.trim()}**\n`;
      } else {
        md += `${line.trim()}\n`;
      }
    }
    md += `\n`;
  }

  // ── Final Mitigation Plan ──
  md += `### Finaler Mitigation-Plan\n\n`;
  md += finalText;
  md += `\n\n---\n`;
  md += `*Impact-Analyse generiert am ${dateStr} | ${kgNodes.length} KG-Knoten | ${reports.size} Spezialisten | Severity: ${severity}*\n`;

  return md;
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
    );

    // ── Phase 4: Generate Report ──
    const fullReport = generateReport(
      finalMitigation, reports,
      kgNodes, kgEdges,
      transcript, params,
    );

    // Stream final content
    const chunkSize = 30;
    for (let i = 0; i < fullReport.length; i += chunkSize) {
      emitSSE(res, { type: 'content', text: fullReport.slice(i, i + chunkSize) });
    }

    // Save run
    await pool.query(
      `UPDATE agent_runs SET status = 'completed', result = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify({
        content: fullReport,
        specialists: Array.from(reports.keys()),
        kgNodes: kgNodes.length,
        kgEdges: kgEdges.length,
      }), runId],
    );

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
