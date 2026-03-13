"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { streamSSE, SSEEvent } from "@/lib/api";
import { KGCascadeInline, KGNode, KGEdge } from "@/components/chat/KGCascadeInline";
import { V7Event } from "@/components/chat/v7/types";
import { useV7Events } from "@/components/chat/v7/useV7Events";
import { SpecialistCard } from "@/components/chat/v7/SpecialistCard";
import { DiscussionThread } from "@/components/chat/v7/DiscussionThread";
import { SynthesisCard } from "@/components/chat/v7/SynthesisCard";
import { safeMarkdown } from "@/lib/markdown";
import { mdClasses } from "@/components/chat/v7/types";
import { LS_TOKEN } from "@/lib/constants";

/* ═══════════════════════════════════════════════════════════════════════
   i3X DATA SOURCE & SM PROFILE MAPPING
   ═══════════════════════════════════════════════════════════════════════ */

interface DataSource {
  id: string;
  label: string;
  icon: string;
  color: string;
}

const DATA_SOURCES: DataSource[] = [
  { id: "uns", label: "UNS / MQTT", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z", color: "#06b6d4" },
  { id: "erp", label: "ERP", icon: "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z", color: "#3b82f6" },
  { id: "bde", label: "BDE", icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H5V5h7v12zm7 0h-5V5h5v12z", color: "#f59e0b" },
  { id: "mrp", label: "MRP", icon: "M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z", color: "#10b981" },
];

interface SMProfile {
  id: string;
  label: string;
  color: string;
}

const SM_PROFILES: SMProfile[] = [
  { id: "asset", label: "Asset Profile", color: "#ff9500" },
  { id: "oee", label: "OEE Profile", color: "#f59e0b" },
  { id: "workorder", label: "Work Order Profile", color: "#3b82f6" },
  { id: "customer", label: "Customer Profile", color: "#06b6d4" },
  { id: "quality", label: "Quality Profile", color: "#a855f7" },
  { id: "energy", label: "Energy Profile", color: "#22c55e" },
];

function matchToolToSources(toolName: string): string[] {
  const t = toolName.toLowerCase();
  const sources: string[] = [];
  if (/oee|availability|machine|maschine|sensor|status/.test(t)) { sources.push("uns", "bde"); }
  if (/order|auftrag|schedule|kapazit|capacity/.test(t)) { sources.push("erp"); }
  if (/material|stock|bom|bestand|lager/.test(t)) { sources.push("erp", "mrp"); }
  if (/customer|kunde|delivery|liefertermin/.test(t)) { sources.push("erp"); }
  if (/quality|spc|scrap|ausschuss|qualit/.test(t)) { sources.push("bde"); }
  if (/kg_|graph|traversal/.test(t)) { sources.push("uns"); }
  if (sources.length === 0) sources.push("erp"); // default
  return [...new Set(sources)];
}

function matchToolToProfiles(toolName: string): string[] {
  const t = toolName.toLowerCase();
  const profiles: string[] = [];
  if (/machine|maschine|asset|anlage|sensor/.test(t)) profiles.push("asset");
  if (/oee|availability|performance|verfügbarkeit|leistung/.test(t)) profiles.push("oee");
  if (/order|auftrag|work.?order|fertigung/.test(t)) profiles.push("workorder");
  if (/customer|kunde|delivery|liefertermin/.test(t)) profiles.push("customer");
  if (/quality|spc|scrap|ausschuss|qualit/.test(t)) profiles.push("quality");
  if (/energy|energie|strom|power/.test(t)) profiles.push("energy");
  return [...new Set(profiles)];
}

/* ═══════════════════════════════════════════════════════════════════════
   FALLBACK DATA — Pre-recorded demo events for SGM-004 failure
   Triple-click logo to activate. Plays if live stream fails or on demand.
   ═══════════════════════════════════════════════════════════════════════ */

interface FallbackEvent extends SSEEvent {
  _delay: number; // ms before this event fires
}

const FALLBACK_CHAT_EVENTS: FallbackEvent[] = [
  { _delay: 800, type: "tool_start", name: "factory_get_machine_status", arguments: { machineId: "SGM-004" } },
  { _delay: 1600, type: "tool_result", name: "factory_get_machine_status", result: '{"id":"SGM-004","name":"Schleifmaschine 004","status":"running","oee":0.82,"currentOrder":"FA-4021"}' },
  { _delay: 2200, type: "tool_start", name: "factory_get_orders_for_machine", arguments: { machineId: "SGM-004" } },
  { _delay: 3400, type: "tool_result", name: "factory_get_orders_for_machine", result: '{"orders":["FA-4021","FA-4035","FA-4042","FA-4058"]}' },
  { _delay: 3800, type: "tool_start", name: "factory_get_customer_deliveries", arguments: { orderIds: ["FA-4021","FA-4035","FA-4042"] } },
  { _delay: 5000, type: "tool_result", name: "factory_get_customer_deliveries", result: '{"deliveries":[{"order":"FA-4021","customer":"KD-112","due":"2026-03-19"},{"order":"FA-4035","customer":"KD-108","due":"2026-03-20"},{"order":"FA-4042","customer":"KD-115","due":"2026-03-21"}]}' },
  { _delay: 5400, type: "tool_start", name: "kg_what_if_machine_down", arguments: { machineId: "SGM-004" } },
  { _delay: 5500, type: "kg_traversal_start", centerEntityId: "SGM-004" },
  { _delay: 6200, type: "kg_nodes_discovered", nodes: [
    { id: "SGM-004", label: "SGM-004", type: "Machine" },
    { id: "FA-4021", label: "FA-4021", type: "Order" },
    { id: "FA-4035", label: "FA-4035", type: "Order" },
    { id: "FA-4042", label: "FA-4042", type: "Order" },
    { id: "KD-112", label: "KD-112", type: "Customer" },
    { id: "KD-108", label: "KD-108", type: "Customer" },
    { id: "ART-2200", label: "ART-2200", type: "Article" },
    { id: "ART-3100", label: "ART-3100", type: "Article" },
  ], edges: [
    { from: "SGM-004", to: "FA-4021", label: "PRODUCES" },
    { from: "SGM-004", to: "FA-4035", label: "PRODUCES" },
    { from: "SGM-004", to: "FA-4042", label: "PRODUCES" },
    { from: "FA-4021", to: "KD-112", label: "ORDERED_BY" },
    { from: "FA-4035", to: "KD-108", label: "ORDERED_BY" },
    { from: "FA-4021", to: "ART-2200", label: "CONTAINS" },
    { from: "FA-4035", to: "ART-3100", label: "CONTAINS" },
  ]},
  { _delay: 7500, type: "kg_nodes_discovered", nodes: [
    { id: "SGM-007", label: "SGM-007", type: "Machine" },
    { id: "KD-115", label: "KD-115", type: "Customer" },
    { id: "FA-4058", label: "FA-4058", type: "Order" },
    { id: "WKZ-440", label: "WKZ-440", type: "Tool" },
  ], edges: [
    { from: "SGM-007", to: "SGM-004", label: "ALTERNATIVE" },
    { from: "FA-4042", to: "KD-115", label: "ORDERED_BY" },
    { from: "FA-4058", to: "SGM-004", label: "SCHEDULED_ON" },
    { from: "SGM-004", to: "WKZ-440", label: "USES_TOOL" },
  ]},
  { _delay: 8500, type: "kg_traversal_end" },
  { _delay: 8600, type: "tool_result", name: "kg_what_if_machine_down", result: '{"impact":"4 orders affected, 3 customers at risk"}' },
  { _delay: 9000, type: "content", text: "## Impact Analysis: SGM-004 Failure\n\n" },
  { _delay: 9400, type: "content", text: "If **SGM-004** (Schleifmaschine 004) goes down right now, the following impact occurs:\n\n" },
  { _delay: 9900, type: "content", text: "### Orders at Risk\n- **FA-4021** — ART-2200, due 2026-03-19 for KD-112\n- **FA-4035** — ART-3100, due 2026-03-20 for KD-108\n" },
  { _delay: 10400, type: "content", text: "- **FA-4042** — due 2026-03-21 for KD-115\n- **FA-4058** — scheduled but not yet started\n\n" },
  { _delay: 10900, type: "content", text: "### Customers Affected\n- **KD-112** — delivery tomorrow, **highest risk**\n- **KD-108** — delivery in 2 days\n- **KD-115** — delivery in 3 days\n\n" },
  { _delay: 11500, type: "content", text: "### Downtime Cost\nEstimated **850 €/h** based on current production value and machine utilization.\n\n" },
  { _delay: 12000, type: "content", text: "### Alternative\nThe Knowledge Graph shows **SGM-007** as a potential alternative machine. It currently has 15% free capacity and uses compatible tooling (WKZ-440).\n\n" },
  { _delay: 12500, type: "content", text: "**Recommendation:** Reroute FA-4021 (highest urgency) to SGM-007 immediately. FA-4035 and FA-4042 can tolerate a 24h delay if SGM-004 is repaired within that window." },
  { _delay: 13000, type: "done" },
];

const FALLBACK_DISCUSSION_EVENTS: FallbackEvent[] = [
  { _delay: 500, type: "init", message: "Starting multi-agent impact analysis..." },
  { _delay: 1000, type: "specialists_batch_start", message: "Launching 4 specialist agents in parallel" },
  { _delay: 1200, type: "specialist_start", data: { name: "oee-impact", displayName: "OEE Impact Analyst" }, title: "oee-impact" },
  { _delay: 1400, type: "specialist_start", data: { name: "otd-impact", displayName: "OTD Impact Analyst" }, title: "otd-impact" },
  { _delay: 1600, type: "specialist_start", data: { name: "cost-impact", displayName: "Cost Impact Analyst" }, title: "cost-impact" },
  { _delay: 1800, type: "specialist_start", data: { name: "quality-impact", displayName: "Quality Impact Analyst" }, title: "quality-impact" },
  { _delay: 5000, type: "specialist_complete", data: { name: "oee-impact", displayName: "OEE Impact Analyst", durationMs: 3800, report: {
    zahlenDatenFakten: "SGM-004 OEE drops from 82% to 0%. Line OEE drops from 78% to 61%. 4 orders blocked.",
    kritischeFindings: [
      { finding: "SGM-004 is the only precision grinder for ART-2200 tolerances", severity: "hoch" },
      { finding: "SGM-007 can handle 60% of SGM-004 workload with retooling", severity: "mittel" },
    ],
    empfehlungen: [
      { maßnahme: "Reroute FA-4021 to SGM-007", priorität: "sofort", erwarteteWirkung: "Saves KD-112 delivery" },
      { maßnahme: "Schedule maintenance window for SGM-004", priorität: "heute", erwarteteWirkung: "Minimize total downtime" },
    ],
    crossDomainHinweise: ["Quality team must verify SGM-007 can hold ART-2200 surface finish specs"],
  }}, title: "oee-impact" },
  { _delay: 6500, type: "specialist_complete", data: { name: "otd-impact", displayName: "OTD Impact Analyst", durationMs: 5100, report: {
    zahlenDatenFakten: "3 customers affected. KD-112 delivery at risk (tomorrow). OTD drops from 94% to 87%.",
    kritischeFindings: [
      { finding: "KD-112 has contractual penalty clause for late delivery (2% per day)", severity: "hoch" },
      { finding: "KD-108 and KD-115 have buffer in delivery window", severity: "niedrig" },
    ],
    empfehlungen: [
      { maßnahme: "Call KD-112 proactively to manage expectations", priorität: "sofort", erwarteteWirkung: "Relationship preservation" },
      { maßnahme: "Prioritize FA-4021 on alternative machine", priorität: "sofort", erwarteteWirkung: "Meet delivery deadline" },
    ],
    crossDomainHinweise: ["Cost team should calculate penalty exposure for KD-112"],
  }}, title: "otd-impact" },
  { _delay: 7500, type: "specialist_complete", data: { name: "cost-impact", displayName: "Cost Impact Analyst", durationMs: 5900, report: {
    zahlenDatenFakten: "Direct downtime cost: 850 €/h. Penalty risk KD-112: up to 4,200 €/day. Rerouting cost to SGM-007: ~320 € (retooling).",
    kritischeFindings: [
      { finding: "Total 24h exposure: 20,400 € (downtime) + 4,200 € (penalty) = 24,600 €", severity: "hoch" },
      { finding: "Rerouting FA-4021 to SGM-007 costs 320 € but saves 4,200 € penalty", severity: "mittel" },
    ],
    empfehlungen: [
      { maßnahme: "Approve emergency rerouting budget (320 €)", priorität: "sofort", erwarteteWirkung: "Net saving of 3,880 €" },
      { maßnahme: "File insurance claim if downtime exceeds 8h", priorität: "heute", erwarteteWirkung: "Recover up to 60% of costs" },
    ],
    crossDomainHinweise: ["OEE team confirms SGM-007 retooling takes ~45 minutes"],
  }}, title: "cost-impact" },
  { _delay: 8500, type: "specialist_complete", data: { name: "quality-impact", displayName: "Quality Impact Analyst", durationMs: 6700, report: {
    zahlenDatenFakten: "ART-2200 requires Ra 0.4 surface finish. SGM-007 certified for Ra 0.6. Deviation waiver needed.",
    kritischeFindings: [
      { finding: "SGM-007 last calibration 12 days ago — within spec but approaching limit", severity: "mittel" },
      { finding: "ART-3100 has no special surface requirements — safe to reroute", severity: "niedrig" },
    ],
    empfehlungen: [
      { maßnahme: "Run calibration check on SGM-007 before ART-2200 production", priorität: "sofort", erwarteteWirkung: "Ensure quality compliance" },
      { maßnahme: "Request customer waiver for Ra 0.5 on first batch if needed", priorität: "heute", erwarteteWirkung: "Avoid scrap risk" },
    ],
    crossDomainHinweise: ["OTD team: calibration check adds ~20 min to rerouting timeline"],
  }}, title: "quality-impact" },
  { _delay: 9000, type: "specialists_batch_complete", message: "All 4 specialists completed" },
  { _delay: 9500, type: "discussion_round_start", discussionRound: 1 },
  { _delay: 10000, type: "discussion_question", targetSpecialist: "OEE Impact Analyst", moderatorQuestion: "You suggest rerouting to SGM-007, but Quality flags a surface finish gap. How confident are you that SGM-007 can handle ART-2200?" },
  { _delay: 12000, type: "discussion_answer", targetSpecialist: "OEE Impact Analyst", discussionAnswer: "SGM-007 achieved Ra 0.45 on similar parts last month. With fresh calibration, I'm 85% confident it meets Ra 0.4. The risk is manageable given the alternative is a guaranteed missed delivery." },
  { _delay: 13000, type: "discussion_question", targetSpecialist: "Cost Impact Analyst", moderatorQuestion: "What's the break-even point? How many hours of SGM-004 downtime before rerouting becomes the cheaper option?" },
  { _delay: 15000, type: "discussion_answer", targetSpecialist: "Cost Impact Analyst", discussionAnswer: "Break-even is at 2.3 hours. After that, every hour of delay costs more than the 320 € rerouting investment. Given KD-112's penalty clause, rerouting is NPV-positive from hour 1." },
  { _delay: 16000, type: "discussion_round_complete", discussionRound: 1 },
  { _delay: 17000, type: "debate_start" },
  { _delay: 18000, type: "debate_draft", debateDraftSummary: "**Recommendation:** Immediately reroute FA-4021 to SGM-007 after a 20-minute calibration check. Proactively contact KD-112. Hold FA-4035 and FA-4042 for 24h pending SGM-004 repair assessment.\n\n**Expected outcome:** KD-112 delivery met, total cost limited to 320 € retooling vs. potential 24,600 € exposure." },
  { _delay: 20000, type: "debate_critique", debateCritiqueFrom: "Quality Impact Analyst", debateCritiqueItems: [
    { type: "concern", text: "Draft doesn't mention the calibration check as a hard gate. If SGM-007 fails calibration, we need a Plan B." },
    { type: "addition", text: "Add fallback: if calibration fails, negotiate 24h extension with KD-112 before attempting production." },
  ], debateCritiqueAssessment: "Strong recommendation overall. Adding the calibration gate makes it robust." },
  { _delay: 22000, type: "debate_final", debateFinalSummary: "**Final Recommendation:**\n1. **Immediately** run calibration check on SGM-007 (20 min)\n2. **If pass:** Reroute FA-4021 to SGM-007, start production within 1 hour\n3. **If fail:** Contact KD-112 for 24h extension, assess SGM-004 repair timeline\n4. **Parallel:** Proactively inform KD-112 sales rep, file maintenance ticket for SGM-004\n5. **Hold** FA-4035/FA-4042 for 24h — these customers have delivery buffer\n\n**Cost:** 320 € (rerouting) vs. 24,600 € (inaction). **ROI: 77x.**" },
  { _delay: 23000, type: "intermediate_result", title: "Executive Summary", data: {
    executiveSummary: "SGM-004 failure impacts 4 orders and 3 customers. Immediate rerouting of the highest-priority order (FA-4021) to SGM-007 is recommended after a calibration verification. This limits financial exposure from 24,600 € to 320 €, a 77x ROI. KD-112 delivery can be preserved if action is taken within 1 hour.",
    crossDomainCorrelations: [
      "OEE-Quality link: SGM-007 capacity exists but quality gate (calibration) must pass first",
      "Cost-OTD link: KD-112 penalty clause makes time-to-action the dominant cost driver",
      "Quality-Cost trade-off: 20min calibration delay saves potential 4,200 €/day penalty",
    ],
    actionPlan: [
      { action: "Run SGM-007 calibration check", priority: "sofort", responsible: "Quality Team", deadline: "Within 20 min" },
      { action: "Reroute FA-4021 to SGM-007", priority: "sofort", responsible: "Production Planning", deadline: "Within 1 hour" },
      { action: "Contact KD-112 proactively", priority: "sofort", responsible: "Sales / Account Manager", deadline: "Immediately" },
      { action: "Assess SGM-004 repair timeline", priority: "heute", responsible: "Maintenance", deadline: "Within 4 hours" },
      { action: "Review penalty clause exposure", priority: "heute", responsible: "Finance", deadline: "By EOD" },
    ],
    riskAssessment: "Primary risk: SGM-007 calibration failure (15% probability). Mitigated by pre-negotiated 24h extension with KD-112. Secondary risk: SGM-004 repair exceeds 24h, requiring full rescheduling of FA-4035 and FA-4042. Overall risk level: MEDIUM — manageable with proposed action plan.",
  }},
  { _delay: 24000, type: "done", message: "Impact analysis complete", duration: 24000 },
];

/** Play fallback events with realistic timing */
async function* playFallbackEvents(events: FallbackEvent[]): AsyncGenerator<SSEEvent> {
  let lastDelay = 0;
  for (const ev of events) {
    const wait = ev._delay - lastDelay;
    lastDelay = ev._delay;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { _delay, ...event } = ev;
    yield event;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SSE WITH AUTO-RECONNECT (Feature C)
   ═══════════════════════════════════════════════════════════════════════ */

async function* streamSSEWithRetry(
  path: string,
  body: any,
  maxRetries = 1
): AsyncGenerator<SSEEvent> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      for await (const event of streamSSE(path, body)) {
        yield event;
      }
      return; // stream ended normally
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      // Wait 1s before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   CHAT MESSAGE TYPE
   ═══════════════════════════════════════════════════════════════════════ */

interface ToolCall {
  name: string;
  arguments?: Record<string, any>;
  result?: string;
  status: "running" | "done" | "error";
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export default function FomiPage() {
  /* ── Act switching ─────────────────────────────────────────────────── */
  const [act, setAct] = useState<"impact" | "discussion">("impact");

  /* ── Fallback mode (Feature A) — triple-click logo ─────────────────── */
  const [fallbackMode, setFallbackMode] = useState(false);
  const logoClicks = useRef<number[]>([]);

  const handleLogoClick = useCallback(() => {
    const now = Date.now();
    logoClicks.current.push(now);
    // Keep only clicks within last 1 second
    logoClicks.current = logoClicks.current.filter((t) => now - t < 1000);
    if (logoClicks.current.length >= 3) {
      setFallbackMode((prev) => !prev); // toggle
      logoClicks.current = [];
    }
  }, []);

  /* ── Act 1: Chat ───────────────────────────────────────────────────── */
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatDone, setChatDone] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  /* ── No-dead-air status (Feature D) ────────────────────────────────── */
  const [activityHint, setActivityHint] = useState("");
  const lastEventTime = useRef(0);
  const deadAirTimer = useRef<NodeJS.Timeout | null>(null);

  const DEAD_AIR_HINTS = [
    "Analyzing factory data...",
    "Querying production database...",
    "Traversing knowledge graph...",
    "Evaluating order dependencies...",
    "Calculating impact metrics...",
    "Cross-referencing delivery schedules...",
  ];

  const startDeadAirWatch = useCallback(() => {
    let hintIdx = 0;
    const check = () => {
      const elapsed = Date.now() - lastEventTime.current;
      if (elapsed > 5000) {
        setActivityHint(DEAD_AIR_HINTS[hintIdx % DEAD_AIR_HINTS.length]);
        hintIdx++;
      } else {
        setActivityHint("");
      }
      deadAirTimer.current = setTimeout(check, 3000);
    };
    lastEventTime.current = Date.now();
    deadAirTimer.current = setTimeout(check, 5000);
  }, []);

  const stopDeadAirWatch = useCallback(() => {
    if (deadAirTimer.current) clearTimeout(deadAirTimer.current);
    deadAirTimer.current = null;
    setActivityHint("");
  }, []);

  const touchActivity = useCallback(() => {
    lastEventTime.current = Date.now();
    setActivityHint("");
  }, []);

  /* ── i3X Panel state ───────────────────────────────────────────────── */
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set());
  const [activeProfiles, setActiveProfiles] = useState<Set<string>>(new Set());
  const [kgNodes, setKgNodes] = useState<KGNode[]>([]);
  const [kgEdges, setKgEdges] = useState<KGEdge[]>([]);
  const [kgCenter, setKgCenter] = useState<string | undefined>();
  const [kgStatus, setKgStatus] = useState<"traversing" | "done">("done");
  const [impactOrders, setImpactOrders] = useState<string[]>([]);
  const [impactCustomers, setImpactCustomers] = useState<string[]>([]);
  const [impactCost, setImpactCost] = useState("");
  const sourceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /* ── Act 2: Discussion ─────────────────────────────────────────────── */
  const [v7Events, setV7Events] = useState<V7Event[]>([]);
  const [discussionRunning, setDiscussionRunning] = useState(false);
  const discussionRef = useRef<HTMLDivElement>(null);

  /* ── Derived V7 state ──────────────────────────────────────────────── */
  const v7State = useV7Events(v7Events);

  /* ── Auto-scroll ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (discussionRef.current) discussionRef.current.scrollTop = discussionRef.current.scrollHeight;
  }, [v7Events]);

  /* ── Activate a data source with glow timeout ──────────────────────── */
  const activateSource = useCallback((sourceId: string) => {
    setActiveSources((prev) => new Set(prev).add(sourceId));
    const existing = sourceTimers.current.get(sourceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setActiveSources((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }, 8000);
    sourceTimers.current.set(sourceId, timer);
  }, []);

  /* ── Process a tool call for i3X ───────────────────────────────────── */
  const processToolForI3X = useCallback((toolName: string) => {
    const sources = matchToolToSources(toolName);
    sources.forEach(activateSource);
    const profiles = matchToolToProfiles(toolName);
    profiles.forEach((p) => setActiveProfiles((prev) => new Set(prev).add(p)));
  }, [activateSource]);

  /* ── Extract impact stats from assistant content ───────────────────── */
  const extractImpactStats = useCallback((content: string) => {
    const orderMatches = content.match(/FA-\d{4,}/g);
    if (orderMatches) setImpactOrders((prev) => [...new Set([...prev, ...orderMatches])]);
    const custMatches = content.match(/KD-\d{3,}/g);
    if (custMatches) setImpactCustomers((prev) => [...new Set([...prev, ...custMatches])]);
    const costMatch = content.match(/(\d[\d.,]*)\s*€\s*\/?\s*h/i) || content.match(/€\s*(\d[\d.,]*)/);
    if (costMatch) setImpactCost(costMatch[0]);
  }, []);

  /* ═════════════════════════════════════════════════════════════════════
     PROCESS CHAT SSE EVENTS (shared between live and fallback)
     ═════════════════════════════════════════════════════════════════════ */
  const processChatStream = useCallback(async (eventSource: AsyncGenerator<SSEEvent>) => {
    const pendingToolCalls: ToolCall[] = [];
    let assistantContent = "";

    const upsert = (patch: Partial<ChatMsg>) => {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, ...patch };
        } else {
          updated.push({ role: "assistant", content: patch.content ?? "", toolCalls: patch.toolCalls });
        }
        return updated;
      });
    };

    for await (const event of eventSource) {
      touchActivity();

      switch (event.type) {
        case "tool_start":
          pendingToolCalls.push({ name: event.name, arguments: event.arguments, status: "running" });
          upsert({ toolCalls: [...pendingToolCalls] });
          processToolForI3X(event.name);
          break;

        case "tool_result": {
          const tc = pendingToolCalls.find((t) => t.name === event.name && t.status === "running");
          if (tc) { tc.result = event.result; tc.status = "done"; }
          upsert({ toolCalls: [...pendingToolCalls] });
          break;
        }

        case "content":
          assistantContent += event.text;
          upsert({ content: assistantContent, toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined });
          extractImpactStats(assistantContent);
          break;

        case "kg_traversal_start":
          setKgStatus("traversing");
          setKgCenter(event.centerEntityId || event.entityId);
          activateSource("uns");
          break;

        case "kg_nodes_discovered": {
          const newN: KGNode[] = (event.nodes || []).map((n: any) => ({ id: n.id, label: n.label || n.id, type: n.type || "Entity" }));
          const newE: KGEdge[] = (event.edges || []).map((e: any) => ({ from: e.from || e.source, to: e.to || e.target, label: e.label || e.type || "" }));
          setKgNodes((prev) => [...prev, ...newN]);
          setKgEdges((prev) => [...prev, ...newE]);
          break;
        }

        case "kg_traversal_end":
          setKgStatus("done");
          break;

        case "done":
          break;

        case "error":
          upsert({ content: `Error: ${event.message}` });
          break;
      }
    }
  }, [touchActivity, processToolForI3X, extractImpactStats, activateSource]);

  /* ═════════════════════════════════════════════════════════════════════
     ACT 1: Send question
     ═════════════════════════════════════════════════════════════════════ */
  const handleSend = async () => {
    const text = question.trim();
    if (!text || streaming) return;

    setQuestion("");
    setStreaming(true);
    setChatDone(false);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    startDeadAirWatch();

    try {
      if (fallbackMode) {
        // Feature A: Play pre-recorded events
        await processChatStream(playFallbackEvents(FALLBACK_CHAT_EVENTS));
      } else {
        // Live mode with auto-reconnect (Feature C)
        await processChatStream(streamSSEWithRetry("/chat/completions", { message: text }));
      }
    } catch (err: any) {
      // If live failed, auto-fallback
      if (!fallbackMode) {
        console.warn("Live stream failed, switching to fallback:", err.message);
        await processChatStream(playFallbackEvents(FALLBACK_CHAT_EVENTS));
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `Connection error: ${err.message}` }]);
      }
    }

    stopDeadAirWatch();
    setStreaming(false);
    setChatDone(true);
  };

  /* ═════════════════════════════════════════════════════════════════════
     ACT 2: Start agent discussion
     ═════════════════════════════════════════════════════════════════════ */
  const startDiscussion = async () => {
    setAct("discussion");
    setDiscussionRunning(true);
    setV7Events([]);
    startDeadAirWatch();

    try {
      const source = fallbackMode
        ? playFallbackEvents(FALLBACK_DISCUSSION_EVENTS)
        : streamSSEWithRetry("/agents/run/impact-analysis", {
            question: messages[0]?.content || "What happens if SGM-004 goes down right now?",
          });

      for await (const event of source) {
        touchActivity();
        setV7Events((prev) => [...prev, event as V7Event]);
        if (event.type === "done" || event.type === "error") break;
      }
    } catch (err: any) {
      // Auto-fallback on failure
      if (!fallbackMode) {
        console.warn("Live discussion failed, switching to fallback:", err.message);
        setV7Events([]);
        for await (const event of playFallbackEvents(FALLBACK_DISCUSSION_EVENTS)) {
          touchActivity();
          setV7Events((prev) => [...prev, event as V7Event]);
          if (event.type === "done") break;
        }
      } else {
        setV7Events((prev) => [...prev, { type: "error", message: err.message } as V7Event]);
      }
    }

    stopDeadAirWatch();
    setDiscussionRunning(false);
  };

  /* ═════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */

  return (
    <div className="fixed inset-0 bg-[#050507] text-white overflow-hidden flex flex-col">
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <header className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-4">
          {/* Logo — triple-click activates fallback (Feature A) */}
          <div className="flex items-center gap-2 select-none" onClick={handleLogoClick}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff9500] to-[#ff5722] grid place-items-center cursor-pointer">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">OpenShopFloor</span>
          </div>
          <span className="text-sm text-white/40">|</span>
          <span className="text-sm text-white/60 font-medium">FoMI 2026 Live Demo</span>
          {/* Fallback indicator — subtle, only visible to presenter */}
          {fallbackMode && (
            <span className="text-[9px] text-white/20 ml-1">SAFE</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Act indicator */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <button
              onClick={() => setAct("impact")}
              className={`px-4 py-1.5 text-xs font-semibold transition-all ${
                act === "impact" ? "bg-[#ff9500] text-black" : "text-white/50 hover:text-white/80"
              }`}
            >
              Impact Analysis
            </button>
            <button
              onClick={() => setAct("discussion")}
              className={`px-4 py-1.5 text-xs font-semibold transition-all ${
                act === "discussion" ? "bg-[#ff9500] text-black" : "text-white/50 hover:text-white/80"
              }`}
            >
              Expert Discussion
            </button>
          </div>

          {/* i3X badge */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03]">
            <span className="text-[10px] font-bold text-[#ff9500] tracking-wider">i3X</span>
            <span className="text-[10px] text-white/30">|</span>
            <span className="text-[10px] text-white/50">CESMII SM Profiles</span>
          </div>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {act === "impact" ? (
          /* ═══════════════════════════════════════════════════════════
             ACT 1: IMPACT ANALYSIS
             ═══════════════════════════════════════════════════════════ */
          <div className="h-full flex">
            {/* LEFT: Chat (40%) */}
            <div className="w-[40%] flex flex-col border-r border-white/[0.06]">
              {/* Chat messages */}
              <div ref={chatRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {messages.length === 0 && !streaming && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="relative w-24 h-24 mb-6">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#ff9500] to-[#ff5722] opacity-20 animate-pulse" />
                      <div className="absolute inset-2 rounded-full bg-[#050507]" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg className="w-10 h-10 text-[#ff9500]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                      </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">What-If Analysis</h2>
                    <p className="text-white/40 text-sm max-w-xs mb-6">
                      Ask about machine failures, order impacts, or production bottlenecks
                    </p>
                    <button
                      onClick={() => {
                        setQuestion("What happens if SGM-004 goes down right now?");
                        setTimeout(() => handleSend(), 100);
                      }}
                      className="px-5 py-3 rounded-lg bg-gradient-to-r from-[#ff9500] to-[#ff5722] text-black font-semibold text-sm hover:opacity-90 transition-opacity"
                    >
                      &quot;What happens if SGM-004 goes down?&quot;
                    </button>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`${msg.role === "user" ? "flex justify-end" : ""}`}>
                    {msg.role === "user" ? (
                      <div className="max-w-[90%] rounded-xl px-4 py-3 bg-gradient-to-r from-[#ff9500]/20 to-[#ff5722]/10 border border-[#ff9500]/20">
                        <p className="text-base font-medium">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="space-y-1">
                            {msg.toolCalls.map((tc, j) => (
                              <div key={j} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs">
                                {tc.status === "running" ? (
                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                ) : (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                )}
                                <span className="font-mono text-amber-400">{tc.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.content && (
                          <div
                            className={`text-sm leading-relaxed text-white/80 ${mdClasses}`}
                            dangerouslySetInnerHTML={{ __html: safeMarkdown(msg.content) }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Streaming indicator + Dead air hint (Feature D) */}
                {streaming && (
                  <div className="space-y-2">
                    {activityHint && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-white/30 animate-pulse">
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93" />
                        </svg>
                        {activityHint}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-2 py-3">
                      <div className="w-2 h-2 rounded-full bg-[#ff9500] animate-bounce [animation-delay:0ms]" />
                      <div className="w-2 h-2 rounded-full bg-[#ff9500] animate-bounce [animation-delay:200ms]" />
                      <div className="w-2 h-2 rounded-full bg-[#ff9500] animate-bounce [animation-delay:400ms]" />
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-white/[0.06]">
                {chatDone && !streaming ? (
                  <button
                    onClick={startDiscussion}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold text-base hover:opacity-90 transition-opacity flex items-center justify-center gap-3"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Start Expert Discussion
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSend()}
                      placeholder="What happens if SGM-004 goes down right now?"
                      className="flex-1 px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-base focus:outline-none focus:border-[#ff9500]/50 transition-colors placeholder:text-white/20"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!question.trim() || streaming}
                      className="px-5 py-3 rounded-xl bg-gradient-to-r from-[#ff9500] to-[#ff5722] text-black font-bold text-sm disabled:opacity-30 hover:opacity-90 transition-opacity"
                    >
                      Ask
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: i3X Insight Panel (60%) */}
            <div className="w-[60%] overflow-y-auto px-5 py-4 space-y-4">
              {/* ── Data Sources ──────────────────────────────────────── */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Interoperability</span>
                  <span className="text-[10px] text-white/20">-- Data Sources</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {DATA_SOURCES.map((src) => {
                    const isActive = activeSources.has(src.id);
                    return (
                      <div
                        key={src.id}
                        className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-500 ${
                          isActive
                            ? "border-white/20 bg-white/[0.05]"
                            : "border-white/[0.04] bg-white/[0.01]"
                        }`}
                      >
                        {isActive && (
                          <div
                            className="absolute inset-0 rounded-xl opacity-20 animate-pulse"
                            style={{ boxShadow: `inset 0 0 20px ${src.color}40, 0 0 30px ${src.color}20` }}
                          />
                        )}
                        <svg
                          className="w-8 h-8 transition-all duration-500"
                          style={{ color: isActive ? src.color : "rgba(255,255,255,0.15)" }}
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d={src.icon} />
                        </svg>
                        <span
                          className="text-xs font-semibold transition-all duration-500"
                          style={{ color: isActive ? src.color : "rgba(255,255,255,0.3)" }}
                        >
                          {src.label}
                        </span>
                        {isActive && (
                          <span className="absolute top-2 right-2 w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: src.color }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── SM Profiles ───────────────────────────────────────── */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Integration</span>
                  <span className="text-[10px] text-white/20">-- CESMII SM Profiles</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SM_PROFILES.map((p) => {
                    const isActive = activeProfiles.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-700 ${
                          isActive
                            ? "border-white/20 scale-100 opacity-100"
                            : "border-transparent scale-95 opacity-30"
                        }`}
                        style={{
                          color: isActive ? p.color : "rgba(255,255,255,0.3)",
                          backgroundColor: isActive ? `${p.color}15` : "transparent",
                          borderColor: isActive ? `${p.color}40` : "transparent",
                        }}
                      >
                        {p.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Knowledge Graph ────────────────────────────────────── */}
              {kgNodes.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Intelligence</span>
                    <span className="text-[10px] text-white/20">-- Knowledge Graph</span>
                    <span className="ml-auto text-[10px] text-white/30">{kgNodes.length} nodes, {kgEdges.length} edges</span>
                  </div>
                  <KGCascadeInline nodes={kgNodes} edges={kgEdges} centerEntityId={kgCenter} status={kgStatus} />
                </div>
              )}

              {/* ── Impact Summary Cards ───────────────────────────────── */}
              {(impactOrders.length > 0 || impactCustomers.length > 0 || impactCost) && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
                    <div className="text-xs text-red-400/70 uppercase tracking-wider font-bold mb-2">Orders at Risk</div>
                    <div className="text-4xl font-black text-red-400 mb-1">{impactOrders.length}</div>
                    <div className="text-[10px] text-white/30 space-y-0.5">
                      {impactOrders.slice(0, 4).map((o) => (
                        <div key={o} className="font-mono">{o}</div>
                      ))}
                      {impactOrders.length > 4 && <div>+{impactOrders.length - 4} more</div>}
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                    <div className="text-xs text-amber-400/70 uppercase tracking-wider font-bold mb-2">Customers Hit</div>
                    <div className="text-4xl font-black text-amber-400 mb-1">{impactCustomers.length}</div>
                    <div className="text-[10px] text-white/30 space-y-0.5">
                      {impactCustomers.slice(0, 4).map((c) => (
                        <div key={c} className="font-mono">{c}</div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#ff9500]/20 bg-[#ff9500]/[0.05] p-4">
                    <div className="text-xs text-[#ff9500]/70 uppercase tracking-wider font-bold mb-2">Downtime Cost</div>
                    <div className="text-3xl font-black text-[#ff9500]">{impactCost || "\u2014"}</div>
                  </div>
                </div>
              )}

              {/* Placeholder when no data yet */}
              {kgNodes.length === 0 && impactOrders.length === 0 && activeProfiles.size === 0 && (
                <div className="flex flex-col items-center justify-center h-[60%] text-center opacity-30">
                  <svg className="w-20 h-20 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                    <path d="M8 12l2 2 4-4" />
                  </svg>
                  <p className="text-sm">Ask a question to see i3X insights light up</p>
                  <p className="text-xs mt-1">Data sources, SM profiles, and the knowledge graph will activate in real-time</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════
             ACT 2: EXPERT DISCUSSION
             ═══════════════════════════════════════════════════════════ */
          <div ref={discussionRef} className="h-full overflow-y-auto px-6 py-5">
            <div className="max-w-6xl mx-auto space-y-5">
              {/* Discussion header */}
              <div className="flex items-center gap-4 mb-2">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold">
                    {messages[0]?.content || "SGM-004 is down \u2014 What do we do?"}
                  </h2>
                  <p className="text-sm text-white/40 mt-1">4 AI specialists analyzing impact across OEE, delivery, cost, and quality</p>
                </div>
                {discussionRunning && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10">
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                    <span className="text-xs text-violet-400 font-medium">Analysis in progress</span>
                  </div>
                )}
              </div>

              {/* Specialist Cards */}
              {v7State.specialists.size > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {Array.from(v7State.specialists.entries()).map(([key, spec]) => (
                    <SpecialistCard
                      key={key}
                      name={spec.name}
                      status={spec.status as any}
                      report={spec.report}
                      duration={spec.duration}
                    />
                  ))}
                </div>
              )}

              {/* Discussion Thread */}
              {v7State.discussionEvents.length > 0 && (
                <DiscussionThread events={v7State.discussionEvents} />
              )}

              {/* Synthesis */}
              {v7State.doneResult && <SynthesisCard data={v7State.doneResult} />}

              {/* Event bubbles for misc events */}
              {v7State.bubbles.map(({ key, event: ev }) => {
                if (ev.type === "tool_call_start") {
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="font-mono text-amber-400">{ev.toolName}</span>
                    </div>
                  );
                }
                if (ev.type === "tool_call_end" || ev.type === "step_start" || ev.type === "step_complete" || ev.type === "step_error") return null;
                if (ev.type === "thinking") {
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs">
                      <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                      <span className="text-violet-400">{ev.message}</span>
                    </div>
                  );
                }
                if (ev.type === "done") {
                  return (
                    <div key={key} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full bg-emerald-400" />
                      <span className="text-emerald-400 font-semibold">{ev.message || "Analysis Complete"}</span>
                      {ev.duration != null && (
                        <span className="text-sm text-white/30 ml-auto">{(ev.duration / 1000).toFixed(0)}s</span>
                      )}
                    </div>
                  );
                }
                if (ev.type === "init" || ev.type === "specialists_batch_start") {
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <span className="text-cyan-400">{ev.message || ev.type}</span>
                    </div>
                  );
                }
                return null;
              })}

              {/* Dead air hint (Feature D) */}
              {discussionRunning && activityHint && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-white/30 animate-pulse">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93" />
                  </svg>
                  {activityHint}
                </div>
              )}

              {/* Typing indicator */}
              {discussionRunning && (
                <div className="flex items-center gap-1.5 px-4 py-3">
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce [animation-delay:200ms]" />
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce [animation-delay:400ms]" />
                </div>
              )}

              {/* Back to impact button when done */}
              {!discussionRunning && v7Events.length > 0 && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => setAct("impact")}
                    className="px-6 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-all text-sm"
                  >
                    Back to Impact Analysis
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
