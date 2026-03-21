import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { callLlm, getLlmConfig, ChatMessage, ToolCall, LlmConfig, isLlmCircuitOpen } from './llm-client';
import { getMcpTools, getMcpToolsForUser, callMcpTool } from './tool-executor';
import {
  createSession,
  getUserSessions,
  getSessionMessages,
  saveMessage,
  deleteSession,
  verifySessionOwnership,
} from './session-store';
import { checkRateLimit } from '../rate-limit';
import { logger, logSecurity } from '../logger';
import { callLlmJson, runDynamicDiscussion, emitSSE } from '../agents/discussion-runner';
import { loadPrompt } from '../prompt-loader';
import { config } from '../config';
import { ff } from '../feature-flags';
import { pool } from '../db/pool';

const router = Router();

// Per-session pipeline lock — prevents concurrent pipelines on the same session
const activePipelines = new Set<string>();

// ─── Category-based Tool Selector (v9) ──────────────────────────────────
// Uses governance tool_categories from DB instead of static skills.md.
// LLM picks relevant categories → all approved tools in those categories are returned.

let cachedCategories: { id: string; name: string; description: string }[] | null = null;
let categoryCacheTime = 0;
const CATEGORY_CACHE_TTL = 60_000;

async function loadCategories(): Promise<{ id: string; name: string; description: string }[]> {
  const now = Date.now();
  if (cachedCategories && now - categoryCacheTime < CATEGORY_CACHE_TTL) {
    return cachedCategories;
  }
  const result = await pool.query('SELECT id, name, description FROM tool_categories ORDER BY name');
  cachedCategories = result.rows;
  categoryCacheTime = now;
  return cachedCategories;
}

async function selectToolsByCategory(
  message: string,
  allTools: any[],
  llmConfig: LlmConfig,
  userId: string,
): Promise<any[]> {
  const categories = await loadCategories();
  if (categories.length === 0) {
    logger.warn('No tool_categories in DB, using all tools');
    return allTools;
  }

  const catRef = categories.map(c => `- ${c.id}: ${c.name} — ${c.description}`).join('\n');

  try {
    const result = await callLlmJson<{ categories: string[] }>(
      [
        { role: 'system', content: 'Du bist ein Kategorie-Selektor fuer eine Manufacturing-AI. Waehle ALLE relevanten Kategorien fuer die Frage. Antwort als JSON.' },
        { role: 'user', content: `KATEGORIEN:\n${catRef}\n\nFRAGE: "${message}"\n\nWaehle die relevanten Kategorien. Lieber eine Kategorie zu viel als eine zu wenig.\n\n{"categories": ["cat_id_1", "cat_id_2", ...]}` },
      ],
      llmConfig,
      userId,
    );

    const selectedCats = (result.categories || []).filter(
      (id: string) => categories.some(c => c.id === id)
    );

    if (selectedCats.length === 0) {
      logger.warn({ message: message.slice(0, 80) }, 'Category selector returned empty, using all tools');
      return allTools;
    }

    // Get approved tool names in selected categories
    const toolResult = await pool.query(
      `SELECT tool_name FROM tool_classifications
       WHERE status = 'approved' AND category_id = ANY($1)`,
      [selectedCats]
    );
    const allowedNames = new Set(toolResult.rows.map((r: any) => r.tool_name));

    const filtered = allTools.filter((t: any) => allowedNames.has(t.function.name));

    if (filtered.length < 2) {
      logger.warn({ selectedCats, filteredCount: filtered.length, message: message.slice(0, 80) },
        'Category selection returned too few tools, using all');
      return allTools;
    }

    logger.info({ count: filtered.length, categories: selectedCats, message: message.slice(0, 80) },
      'Category-based tool selection');
    return filtered;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Category selector failed, using all tools');
    return allTools;
  }
}

function getSystemPrompt(language?: string): string {
  const langInstruction = language === 'en'
    ? '\n\nIMPORTANT: Always respond in English.'
    : language === 'de'
    ? '\n\nWICHTIG: Antworte immer auf Deutsch.'
    : '\n\nAlways respond in the same language as the user\'s message.';

  const skills = loadPrompt('chat-skills');
  return skills + langInstruction;
}

// ─── Intent Classifier ──────────────────────────────────────────────────

async function classifyIntent(
  message: string,
  freeLlmConfig: LlmConfig,
  userId: string,
): Promise<boolean> {
  const classifierPrompt = `Klassifiziere die folgende User-Frage:

"${message}"

EINFACH (complex=false): Fragen die mit 1-3 Tool-Aufrufen beantwortet werden können. Konkrete Datenpunkte, Status-Abfragen, einfache Vergleiche zweier Werte, Auflistungen.
Beispiele EINFACH:
- "Wie ist der Status/OEE von Maschine X?" → 1 Tool-Aufruf
- "Wie viel Bestand haben wir von Artikel X?" → 1 Tool-Aufruf
- "Gibt es SPC-Alarme?" → 1 Tool-Aufruf
- "Welche 5 Materialien haben die geringste Reichweite?" → 1 Tool-Aufruf
- "Welche Kunden haben die schlechteste OTD?" → 1 Tool-Aufruf
- "Vergleiche OEE von Maschine 1001 und 1002" → 2 Tool-Aufrufe
- "Gibt es Aufträge die hinter dem Zeitplan liegen?" → 1-2 Tool-Aufrufe
- "Hallo", "Was kannst du?" → kein Tool nötig

KOMPLEX (complex=true): NUR wenn die Frage eine TIEFGEHENDE ANALYSE über MEHRERE BEREICHE erfordert — Ursachenforschung, strategische Optimierung, Cross-Domain-Zusammenhänge, What-If-Szenarien, Schichtberichte.
Beispiele KOMPLEX:
- "Erstelle einen kompletten Schichtbericht" → braucht 10+ Tools, Synthese
- "Was passiert wenn Maschine X ausfällt?" → Impact-Analyse über alle Bereiche
- "Wo sind die 3 größten Risiken und wie bewerten wir sie?" → strategische Analyse
- "Wie können wir die Liefertreue von 70% auf 95% steigern?" → Optimierungsstrategie
- "Erstelle ein Executive Summary der Fabrik" → Cross-Domain-Synthese

ANTWORT-FORMAT: Reines JSON, KEIN Markdown.
{"complex": true}  oder  {"complex": false}

WICHTIG: Im Zweifel eher EINFACH. Nur echte Cross-Domain-Analysen und strategische Fragen sind komplex.`;

  try {
    const result = await callLlmJson<{ complex: boolean }>(
      [
        { role: 'system', content: 'Du bist ein Intent-Classifier für eine Manufacturing-AI. Antworte nur mit JSON.' },
        { role: 'user', content: classifierPrompt },
      ],
      freeLlmConfig,
      userId,
    );
    return result.complex === true;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Intent classifier failed, defaulting to simple');
    return false;
  }
}

// GET /chat/sessions — list user sessions
router.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessions = await getUserSessions(req.user!.userId);
    res.json({ sessions });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat sessions error');
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// POST /chat/sessions — create new session
router.post('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = await createSession(req.user!.userId, req.body.title);
    res.status(201).json({ sessionId });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Create session error');
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// UUID format check for path params
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /chat/sessions/:id/messages — get session messages (ownership enforced)
router.get('/sessions/:id/messages', requireAuth, async (req: Request, res: Response) => {
  if (!SESSION_UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }
  try {
    const messages = await getSessionMessages(req.params.id, req.user!.userId);
    res.json({ messages });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Messages error');
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// DELETE /chat/sessions/:id (ownership enforced)
router.delete('/sessions/:id', requireAuth, async (req: Request, res: Response) => {
  if (!SESSION_UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: 'Invalid session ID format' });
    return;
  }
  try {
    const deleted = await deleteSession(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// POST /chat/completions — SSE streaming chat with tool loop
router.post('/completions', requireAuth, async (req: Request, res: Response) => {
  const { message, sessionId: reqSessionId, language, llmProvider } = req.body;
  if (!message || typeof message !== 'string' || message.length > 10000) {
    res.status(400).json({ error: 'Message required (max 10000 chars)' });
    return;
  }

  const tier = req.user!.tier || 'free';

  // Rate limit check
  const rateLimitKey = `llm:${req.user!.userId}`;
  const limits: Record<string, number> = { free: 5, premium: 20, 'own-key': 50 };
  if (!checkRateLimit(rateLimitKey, limits[tier] || 5)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
    return;
  }

  // UUID format validation on sessionId (prevents pod crash from malformed IDs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (reqSessionId && !UUID_RE.test(reqSessionId)) {
    res.status(400).json({ error: 'Invalid sessionId format' });
    return;
  }

  // LLM circuit breaker pre-check — immediate error instead of 15min hang
  const circuitMsg = isLlmCircuitOpen();
  if (circuitMsg) {
    res.status(503).json({ error: circuitMsg });
    return;
  }

  // Per-session pipeline lock — reject concurrent requests to same session
  if (reqSessionId && activePipelines.has(reqSessionId)) {
    res.status(409).json({ error: 'A pipeline is already active for this session' });
    return;
  }

  // Verify session ownership if sessionId provided
  if (reqSessionId) {
    const owns = await verifySessionOwnership(reqSessionId, req.user!.userId);
    if (!owns) {
      res.status(403).json({ error: 'Session not found or access denied' });
      return;
    }
  }

  // SSE headers (explicit CORS — validate origin against whitelist)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const origin = req.headers.origin;
  const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
  const SSE_ALLOWED_ORIGINS = new Set([
    'https://openshopfloor.zeroguess.ai',
    'https://osf-api.zeroguess.ai',
    'https://demo.zeroguess.ai',
    'http://localhost:3000',
    'http://localhost:3001',
    ...EXTRA_ORIGINS,
  ]);
  if (origin && SSE_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.flushHeaders();

  // ── Abort controller: cancelled when client disconnects or pipeline times out ──
  const pipelineAbort = new AbortController();
  const pipelineTimer = setTimeout(() => {
    logger.warn({ userId: req.user!.userId }, 'Chat pipeline timeout');
    pipelineAbort.abort();
  }, config.pipeline.timeoutMs);

  res.on('close', () => {
    if (!res.writableEnded) {
      logger.info({ userId: req.user!.userId }, 'Client disconnected, aborting pipeline');
      pipelineAbort.abort();
    }
  });

  // Heartbeat to keep Cloudflare alive during long-running discussions (CF drops idle SSE after ~100s)
  const cfHeartbeat = setInterval(() => {
    if (pipelineAbort.signal.aborted || res.writableEnded) {
      clearInterval(cfHeartbeat);
      return;
    }
    try { res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`); } catch {
      logger.debug('Heartbeat write to closed connection');
    }
  }, config.pipeline.heartbeatIntervalMs);

  // Track active pipeline for session lock
  let pipelineSessionId: string | undefined;

  try {
    // Create or use session
    let sessionId = reqSessionId;
    if (!sessionId) {
      sessionId = await createSession(req.user!.userId, message.slice(0, 80));
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);
    }

    // Lock the session
    pipelineSessionId = sessionId;
    activePipelines.add(sessionId);

    // Save user message
    await saveMessage(sessionId, 'user', message);

    // Load all tools (filtered by user governance permissions), history, and LLM configs in parallel
    let freeLlmConfig = await getLlmConfig(req.user!.userId, 'free');
    const [allTools, history, llmConfigBase] = await Promise.all([
      getMcpToolsForUser(req.user!.userId),
      getSessionMessages(sessionId, req.user!.userId, 20),
      getLlmConfig(req.user!.userId, tier),
    ]);
    let llmConfig = llmConfigBase;

    // Override ALL LLM calls with Anthropic Haiku when requested from frontend
    if (llmProvider === 'haiku' && config.llm.anthropicApiKey) {
      const haikuConfig: LlmConfig = {
        baseUrl: config.llm.anthropicUrl,
        model: config.llm.anthropicModel,
        apiKey: config.llm.anthropicApiKey,
      };
      freeLlmConfig = haikuConfig;
      llmConfig = haikuConfig;
      logger.info({ model: haikuConfig.model }, 'LLM override: all calls using Anthropic Haiku');
    }

    // Warn user if no tools are available (all MCP servers down)
    if (allTools.length === 0 && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'warning', message: 'Keine MCP-Server erreichbar — Antwort ohne Tool-Zugriff.' })}\n\n`);
    }

    // Category-based tool selection: LLM picks relevant categories from governance DB
    const tools = await selectToolsByCategory(message, allTools, freeLlmConfig, req.user!.userId);

    // Build messages
    const messages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt(language) },
      ...history.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      })),
    ];

    // ── Intent Classification: simple vs complex ──
    // Feature flags can override intent classification
    let isComplex: boolean;
    if (ff.forceSimple) {
      isComplex = false;
    } else if (ff.forceDiscussion || llmProvider === 'haiku') {
      // Haiku always goes to discussion — avoids tool role format issues in simple pipeline
      isComplex = true;
    } else {
      // Always use free tier (14B) for classification — fast, consistent, independent of user tier
      isComplex = await classifyIntent(message, freeLlmConfig, req.user!.userId);
    }

    if (isComplex) {
      logger.info({ userId: req.user!.userId, message: message.slice(0, 80) }, 'Complex intent → dynamic discussion');

      try {
        const finalText = await runDynamicDiscussion(
          message,
          req.user!.userId,
          tier,
          sessionId,
          res,
          pipelineAbort.signal,
          language,
          llmProvider,
        );

        // Stream final text as content chunks
        if (!pipelineAbort.signal.aborted) {
          const chunkSize = 20;
          for (let i = 0; i < finalText.length; i += chunkSize) {
            const chunk = finalText.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
          }

          // Save assistant message
          await saveMessage(sessionId, 'assistant', finalText);

          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        }
        clearTimeout(pipelineTimer);
        clearInterval(cfHeartbeat);
        if (!res.writableEnded) res.end();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Dynamic discussion error');
        if (!res.writableEnded) {
          const msg = pipelineAbort.signal.aborted
            ? (language === 'en' ? 'Pipeline aborted (timeout or connection lost).' : 'Pipeline abgebrochen (Timeout oder Verbindung getrennt).')
            : (language === 'en' ? 'Multi-agent discussion failed. Please try again.' : 'Multi-Agent-Diskussion fehlgeschlagen. Versuche es erneut.');
          res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        }
        clearTimeout(pipelineTimer);
        clearInterval(cfHeartbeat);
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // ── Simple intent → normal tool-loop flow ──

    // Tool loop (max 5 iterations)
    let fullContent = '';
    const allToolCalls: any[] = [];

    for (let i = 0; i < 5; i++) {
      if (pipelineAbort.signal.aborted) break;
      const response = await callLlm(messages, tools, llmConfig, req.user!.userId, pipelineAbort.signal);

      // If LLM returns tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
        });

        // Execute each tool call
        for (const tc of response.tool_calls) {
          if (pipelineAbort.signal.aborted) break;
          const toolName = tc.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch { logger.debug({ toolName: tc.function.name }, 'Failed to parse tool arguments'); }

          // Rate limit tools
          const toolLimitKey = `tool:${req.user!.userId}`;
          const toolLimits: Record<string, number> = { free: 30, premium: 100, 'own-key': 100 };
          if (!checkRateLimit(toolLimitKey, toolLimits[tier] || 30)) {
            const errResult = JSON.stringify({ error: 'Tool rate limit exceeded' });
            messages.push({ role: 'tool', content: errResult, tool_call_id: tc.id });
            allToolCalls.push({ name: toolName, arguments: toolArgs, result: errResult, error: true });
            continue;
          }

          res.write(`data: ${JSON.stringify({ type: 'tool_start', name: toolName, arguments: toolArgs })}\n\n`);

          // Emit KG traversal start for knowledge graph tools
          if (toolName.startsWith('kg_')) {
            res.write(`data: ${JSON.stringify({
              type: 'kg_traversal_start',
              timestamp: new Date().toISOString(),
              scenarioName: toolName.replace('kg_', '').replace(/_/g, ' '),
              entityId: (toolArgs as any).entity_id || (toolArgs as any).machine_id || (toolArgs as any).order_id || '',
            })}\n\n`);
          }

          const result = await callMcpTool(toolName, toolArgs, req.user!.userId, req.user!.email);

          // Emit KG traversal results for knowledge graph tools
          if (toolName.startsWith('kg_')) {
            try {
              const parsed = JSON.parse(result);
              const nodes = parsed.nodes || parsed.affected_nodes || parsed.path || [];
              const edges = parsed.edges || parsed.relationships || parsed.connections || [];
              if (nodes.length > 0 || edges.length > 0) {
                res.write(`data: ${JSON.stringify({
                  type: 'kg_nodes_discovered',
                  timestamp: new Date().toISOString(),
                  nodes: Array.isArray(nodes) ? nodes.map((n: any) => ({ id: n.id || n.node_id || n, type: n.type || n.label || 'node', label: n.name || n.label || n.id || String(n) })) : [],
                  edges: Array.isArray(edges) ? edges.map((e: any) => ({ source: e.source || e.from, target: e.target || e.to, type: e.type || e.relation || 'related' })) : [],
                  centerEntity: { id: (toolArgs as any).entity_id || (toolArgs as any).machine_id || (toolArgs as any).order_id || toolName },
                })}\n\n`);
              }
              res.write(`data: ${JSON.stringify({
                type: 'kg_traversal_end',
                timestamp: new Date().toISOString(),
                totalNodes: Array.isArray(nodes) ? nodes.length : 0,
                totalEdges: Array.isArray(edges) ? edges.length : 0,
              })}\n\n`);
            } catch { logger.debug({ toolName }, 'KG result not JSON, skip KG events'); }
          }

          res.write(`data: ${JSON.stringify({ type: 'tool_result', name: toolName, result })}\n\n`);

          // Truncate large tool results to avoid LLM context overflow
          const truncatedResult = result.length > config.truncation.toolResult
            ? result.substring(0, config.truncation.toolResult) + `\n... (${result.length} chars total, truncated)`
            : result;
          messages.push({ role: 'tool', content: truncatedResult, tool_call_id: tc.id });
          allToolCalls.push({ name: toolName, arguments: toolArgs, result });
        }

        // Continue loop — LLM will process tool results
        continue;
      }

      // No tool calls — we have final content
      fullContent = response.content || '';
      break;
    }

    // Stream the final text content
    if (fullContent) {
      const chunkSize = 20;
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        const chunk = fullContent.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
      }
    }

    // Save assistant message
    await saveMessage(sessionId, 'assistant', fullContent, allToolCalls.length > 0 ? allToolCalls : undefined);

    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    clearTimeout(pipelineTimer);
    clearInterval(cfHeartbeat);
    if (!res.writableEnded) res.end();
  } catch (err: any) {
    logger.error({ err: err.message }, 'Chat completion error');
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred processing your request' })}\n\n`);
    }
    clearTimeout(pipelineTimer);
    clearInterval(cfHeartbeat);
    if (!res.writableEnded) res.end();
  } finally {
    if (pipelineSessionId) activePipelines.delete(pipelineSessionId);
  }
});

// ─── GET /chat/entities ─ autocomplete data for frontend ──────────────────
// Fetches machines, articles, orders, partners from factory-sim and returns
// a compact list the frontend caches for client-side autocomplete.

const FACTORY_SIM_URL_ENTITIES = process.env.FACTORY_SIM_URL || 'http://factory-v3-fertigung.factory.svc.cluster.local:8888';

interface EntityItem {
  id: string;
  label: string;
  type: 'Machine' | 'Article' | 'Order' | 'Customer' | 'Material';
}

let entitiesCache: { data: EntityItem[]; ts: number } | null = null;
const ENTITIES_TTL_MS = 5 * 60 * 1000; // 5 min

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

router.get('/entities', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Return cache if fresh
    if (entitiesCache && Date.now() - entitiesCache.ts < ENTITIES_TTL_MS) {
      res.json({ entities: entitiesCache.data });
      return;
    }

    const base = FACTORY_SIM_URL_ENTITIES;

    const [machines, articles, orders, partners, materials] = await Promise.all([
      fetchJson<any[]>(`${base}/api/machines`, []),
      fetchJson<any[]>(`${base}/api/articles`, []),
      fetchJson<any[]>(`${base}/api/workorders`, []),
      fetchJson<any[]>(`${base}/api/partners`, []),
      fetchJson<any[]>(`${base}/api/materials`, []),
    ]);

    const entities: EntityItem[] = [];

    for (const m of machines) {
      entities.push({ id: m.machine_no || m.machineNo || m.id, label: m.machine_no || m.machineNo || m.name || m.id, type: 'Machine' });
    }
    for (const a of articles) {
      const id = a.artikel_nr || a.artikelNr || a.id;
      entities.push({ id, label: a.bezeichnung || a.name || id, type: 'Article' });
    }
    for (const o of orders) {
      const id = o.order_no || o.orderNo || o.auftrag_nr || o.id;
      entities.push({ id, label: id, type: 'Order' });
    }
    for (const p of partners) {
      const id = p.partner_nr || p.partnerNr || p.id;
      entities.push({ id, label: p.name || p.firma || id, type: 'Customer' });
    }
    for (const m of materials) {
      const id = m.teil_id || m.teilId || m.id;
      entities.push({ id, label: m.bezeichnung || m.name || id, type: 'Material' });
    }

    entitiesCache = { data: entities, ts: Date.now() };
    res.json({ entities });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Entities endpoint error');
    res.status(500).json({ error: 'Failed to fetch entities' });
  }
});

export default router;
