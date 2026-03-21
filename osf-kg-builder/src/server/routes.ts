import { Router, Request, Response } from 'express';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { kgPool } from '../shared/cypher-utils';
import { generateEmbedding } from '../shared/embedding-service';
import { semanticSearch, getEmbeddingStats } from '../shared/vector-store';
import { SchemaProposal, SchemaRun } from '../shared/types';
import { generateChart } from './chart-engine';
import { getBridgeStats, getRawMessages, getEnrichedMessages } from './mqtt-bridge';
import { handleMcpRequest } from './mcp-handler';
import { cypherQuery, getDriver, validateLabel } from '../shared/cypher-utils';
import { callLlm, ChatMessage } from '../shared/llm-client';
import { deterministicExtract } from '../builder/deterministic-extractor';
import { executeRelationshipBuilding } from '../builder/relationship-builder';
import { runValidation, formatValidationReport } from '../builder/validator';
import { saveSchemaRun } from '../builder/schema-planner';
import { loadAllProfiles, loadAllSources, loadAllSyncs, validateSchemaRefs } from '../builder/schema-loader';
import { buildFromSchemas } from '../builder/schema-kg-builder';
import { SchemaSync } from '../builder/schema-sync';

// ── SSE helpers ────────────────────────────────────────────────────

function emitSSE(res: Response, event: Record<string, any>): boolean {
  if (res.writableEnded) return false;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch { return false; }
}

let _schemaSync: SchemaSync | null = null;

/** Called from index.ts to inject the SchemaSync instance. */
export function setSchemaSync(sync: SchemaSync): void {
  _schemaSync = sync;
}

export function createRouter(graphAvailable: boolean, vectorAvailable: boolean): Router {
  const router = Router();

  // ── Health ──────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'osf-kg-server',
      graphAvailable,
      vectorAvailable,
      mqtt: getBridgeStats(),
    });
  });

  // ── MCP JSON-RPC ───────────────────────────────────────────────
  router.post('/mcp', handleMcpRequest);

  // ── Semantic Search ────────────────────────────────────────────
  router.post('/api/kg/semantic-search', async (req: Request, res: Response) => {
    const { query, limit = 10, minSimilarity = 0.3, labelFilter } = req.body || {};
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const embedding = await generateEmbedding(query);
      const results = await semanticSearch(embedding, limit, minSimilarity, labelFilter);
      res.json({ query, results, count: results.length });
    } catch (e: any) {
      logger.error({ err: e.message }, 'Semantic search failed');
      res.status(500).json({ error: e.message });
    }
  });

  // ── Chart Engine ───────────────────────────────────────────────
  router.post('/api/kg/chart', async (req: Request, res: Response) => {
    const { question, schema: schemaOverride } = req.body || {};
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    let schema: SchemaProposal | null = schemaOverride || null;
    if (!schema) {
      try {
        const result = await kgPool.query(
          `SELECT confirmed_schema FROM ${config.db.schema}.kg_builder_runs WHERE status = 'complete' AND confirmed_schema IS NOT NULL ORDER BY updated_at DESC LIMIT 1`
        );
        if (result.rows[0]?.confirmed_schema) {
          schema = result.rows[0].confirmed_schema;
        }
      } catch (e: any) { logger.debug({ err: e.message }, 'Schema lookup from saved runs failed'); }
    }

    if (!schema) {
      res.status(400).json({ error: 'No schema available. Run the builder first or provide schema in request body.' });
      return;
    }

    // SSE response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      emitSSE(res, { type: 'chart_status', message: 'Generating Cypher query...' });
      const result = await generateChart(question, schema);

      emitSSE(res, { type: 'chart_status', message: 'Chart generated' });
      emitSSE(res, {
        type: 'chart_data',
        question: result.question,
        cypher: result.cypher,
        chart: result.chart,
        semanticContext: result.semanticContext,
      });
      emitSSE(res, { type: 'done' });
    } catch (e: any) {
      emitSSE(res, { type: 'error', message: e.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ── Embedding Stats ────────────────────────────────────────────
  router.get('/api/kg/embeddings/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await getEmbeddingStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── MQTT Status ────────────────────────────────────────────────
  router.get('/api/kg/mqtt/status', (_req: Request, res: Response) => {
    res.json(getBridgeStats());
  });

  router.get('/api/kg/mqtt/messages', (_req: Request, res: Response) => {
    res.json({ raw: getRawMessages(), enriched: getEnrichedMessages() });
  });

  // ── Builder Runs (read-only) ───────────────────────────────────
  router.get('/api/kg/runs', async (_req: Request, res: Response) => {
    try {
      const result = await kgPool.query(
        `SELECT id, status, created_at, updated_at FROM ${config.db.schema}.kg_builder_runs ORDER BY created_at DESC LIMIT 20`
      );
      res.json(result.rows);
    } catch (e: any) {
      logger.debug({ err: e.message }, 'Failed to load runs');
      res.json([]);
    }
  });

  // ── Graph QA (question answering) ──────────────────────────────
  router.post('/api/kg/ask', async (req: Request, res: Response) => {
    const { question } = req.body || {};
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    try {
      // Get schema from latest run
      let schema: SchemaProposal | null = null;
      try {
        const result = await kgPool.query(
          `SELECT confirmed_schema FROM ${config.db.schema}.kg_builder_runs WHERE status = 'complete' AND confirmed_schema IS NOT NULL ORDER BY updated_at DESC LIMIT 1`
        );
        if (result.rows[0]?.confirmed_schema) schema = result.rows[0].confirmed_schema;
      } catch (e: any) { logger.debug({ err: e.message }, 'Schema lookup failed'); }

      if (!schema) {
        res.status(400).json({ error: 'No schema available' });
        return;
      }

      const schemaDesc = schema.nodeTypes.map(n => `${n.label}(${n.properties.map(p => p.name).join(',')})`).join(', ');
      const edgeDesc = schema.edgeTypes.map(e => `(${e.fromType})-[${e.label}]->(${e.toType})`).join(', ');

      // Semantic boost
      let semanticHint = '';
      try {
        const queryEmb = await generateEmbedding(question);
        const similar = await semanticSearch(queryEmb, 5, 0.4);
        if (similar.length > 0) {
          semanticHint = `\nSemantisch relevante Nodes: ${similar.map(s => `${s.node_label}:${s.node_id} (similarity: ${s.similarity?.toFixed(2)})`).join(', ')}`;
        }
      } catch (e: any) { logger.debug({ err: e.message }, 'Semantic boost failed'); }

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are a Neo4j Cypher expert. Generate a single Cypher query to answer the user's question.
Graph schema — Nodes: ${schemaDesc}. Edges: ${edgeDesc}.${semanticHint}
Return ONLY the Cypher query, nothing else. Use RETURN with explicit property access (e.g. n.id, n.name).`,
        },
        { role: 'user', content: question },
      ];

      const cypher = (await callLlm(messages, { maxTokens: 500 })).trim().replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

      // Guard: only allow read-only Cypher from LLM
      if (/\b(DELETE|REMOVE|CREATE|DROP|SET|MERGE|DETACH|FOREACH|CALL)\b/i.test(cypher)) {
        res.status(400).json({ error: 'LLM generated a write query — blocked for safety', cypher });
        return;
      }

      // Execute as read-only transaction for safety
      const neo4jDriver = getDriver();
      const session = neo4jDriver.session({ database: config.neo4j.database });
      let rows: any[];
      try {
        const result = await session.executeRead(tx => tx.run(cypher));
        rows = result.records.map(record => {
          if (record.keys.length === 1) return record.get(0);
          const obj: Record<string, any> = {};
          for (const key of record.keys) obj[key as string] = record.get(key);
          return obj;
        });
      } finally {
        await session.close();
      }

      res.json({
        question,
        cypher,
        results: rows.slice(0, 10),
        summary: `${rows.length} rows returned`,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Run Detail ─────────────────────────────────────────────────
  router.get('/api/kg/runs/:id', async (req: Request, res: Response) => {
    try {
      const result = await kgPool.query(
        `SELECT * FROM ${config.db.schema}.kg_builder_runs WHERE id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const row = result.rows[0];
      res.json({
        id: row.id,
        status: row.status,
        proposal: row.proposal,
        confirmedSchema: row.confirmed_schema,
        extractionReport: row.extraction_report,
        validationReport: row.validation_report,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Run Validation Report (Markdown) ──────────────────────────
  router.get('/api/kg/runs/:id/report', async (req: Request, res: Response) => {
    try {
      const result = await kgPool.query(
        `SELECT validation_report FROM ${config.db.schema}.kg_builder_runs WHERE id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const vr = result.rows[0].validation_report;
      if (!vr) {
        res.status(400).json({ error: 'No validation report for this run' });
        return;
      }
      const markdown = formatValidationReport(vr);
      res.type('text/markdown').send(markdown);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Review (selective re-extraction) ──────────────────────────
  router.post('/api/kg/review', async (req: Request, res: Response) => {
    const { runId, corrections } = req.body || {};
    if (!runId || !corrections || !Array.isArray(corrections)) {
      res.status(400).json({ error: 'runId and corrections[] required' });
      return;
    }

    try {
      const result = await kgPool.query(
        `SELECT * FROM ${config.db.schema}.kg_builder_runs WHERE id = $1`,
        [runId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const row = result.rows[0];
      const schema: SchemaProposal = row.confirmed_schema;
      if (!schema) {
        res.status(400).json({ error: 'Run has no confirmed schema' });
        return;
      }

      const run: SchemaRun = {
        id: row.id, status: 'correcting',
        proposal: row.proposal, confirmedSchema: schema,
        extractionReport: row.extraction_report, validationReport: row.validation_report,
        createdAt: row.created_at, updatedAt: new Date().toISOString(),
      };

      const results: Array<{ correction: any; result: string }> = [];

      for (const corr of corrections) {
        try { validateLabel(corr.label); } catch { results.push({ correction: corr, result: 'Invalid label' }); continue; }
        const safeLabel = corr.label;

        if (corr.type === 'reextract_node') {
          const nodeType = schema.nodeTypes.find((n: any) => n.label === safeLabel);
          if (!nodeType) { results.push({ correction: corr, result: `Label ${safeLabel} not in schema` }); continue; }
          await cypherQuery(`MATCH (n:${safeLabel}) DETACH DELETE n`);
          const extractResult = await deterministicExtract(nodeType, undefined, (msg) => logger.info(msg));
          results.push({ correction: corr, result: extractResult ? `Re-extracted ${extractResult.committed} nodes` : 'Deterministic extraction returned null' });
        } else if (corr.type === 'reextract_edge') {
          const edgeType = schema.edgeTypes.find((e: any) => e.label === safeLabel);
          if (!edgeType) { results.push({ correction: corr, result: `Edge ${safeLabel} not in schema` }); continue; }
          await cypherQuery(`MATCH ()-[r:${safeLabel}]->() DELETE r`);
          const buildReport = await executeRelationshipBuilding([edgeType], undefined, (msg) => logger.info(msg));
          results.push({ correction: corr, result: `Re-built ${buildReport.totalSuccess} edges` });
        } else if (corr.type === 'delete_type') {
          await cypherQuery(`MATCH (n:${safeLabel}) DETACH DELETE n`);
          results.push({ correction: corr, result: `Deleted all ${safeLabel} nodes` });
        } else {
          results.push({ correction: corr, result: `Unknown correction type: ${corr.type}` });
        }
      }

      // Re-validate
      const validationReport = await runValidation(schema);
      run.validationReport = validationReport;
      run.status = 'complete';
      await saveSchemaRun(run);

      res.json({ runId, corrections: results, validationReport });
    } catch (e: any) {
      logger.error({ err: e.message }, 'Review failed');
      res.status(500).json({ error: e.message });
    }
  });

  // ── Build KG from GitHub schemas (trigger from UI, SSE streaming) ──
  let buildRunning = false;

  router.post('/api/kg/build', async (req: Request, res: Response) => {
    if (buildRunning) {
      res.status(409).json({ error: 'A build is already running' });
      return;
    }

    buildRunning = true;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);

    try {
      // Phase 0: Pull latest schemas from GitHub (ALWAYS fresh)
      emitSSE(res, { type: 'progress', phase: 0, step: 'Pulling latest schemas from GitHub...' });

      if (!_schemaSync) {
        throw new Error('SchemaSync not initialized — server misconfigured');
      }
      await _schemaSync.start(); // re-clone or pull latest
      const basePath = _schemaSync.getLocalPath();
      const commit = _schemaSync.getLastCommit().substring(0, 7);
      emitSSE(res, { type: 'progress', phase: 0, step: `Schemas loaded (commit ${commit})` });

      // Phase 1: Load and validate schemas
      emitSSE(res, { type: 'progress', phase: 1, step: 'Loading profiles, sources, syncs...' });
      const profiles = loadAllProfiles(basePath);
      const sources = loadAllSources(basePath);
      const syncs = loadAllSyncs(basePath);

      if (profiles.length === 0) {
        throw new Error('No profiles found in schema repo. Check osf-schemas repository.');
      }

      const validationErrors = validateSchemaRefs(profiles, sources, syncs);
      if (validationErrors.length > 0) {
        emitSSE(res, { type: 'progress', phase: 1, step: `${validationErrors.length} validation warnings` });
        for (const err of validationErrors) {
          logger.warn({ err }, '[Build] Schema validation warning');
        }
      }

      emitSSE(res, { type: 'progress', phase: 1, step: `${profiles.length} profiles, ${sources.length} sources, ${syncs.length} syncs` });

      // Phase 2: Build type system + instances
      emitSSE(res, { type: 'progress', phase: 2, step: 'Building type system and extracting instances...' });

      const report = await buildFromSchemas(profiles, sources, syncs);

      emitSSE(res, { type: 'progress', phase: 2, step: `${report.nodesMerged} nodes, ${report.edgesCreated} edges` });

      // Phase 3: Syncs started (MQTT + polling)
      emitSSE(res, { type: 'progress', phase: 3, step: `Live syncs: ${report.mqttSubscriptions} MQTT, ${report.pollingJobs} polling` });

      // Phase 4: Done
      emitSSE(res, {
        type: 'done',
        runId: commit,
        totalNodes: report.nodesMerged,
        totalEdges: report.edgesCreated,
        accuracy: report.errors.length === 0 ? 100 : Math.round((1 - report.errors.length / (profiles.length + sources.length)) * 100),
        summary: `${report.nodesMerged} nodes, ${report.edgesCreated} edges from ${profiles.length} profiles (${report.errors.length} errors)`,
      });
    } catch (e: any) {
      logger.error({ err: e.message }, 'Schema build failed');
      emitSSE(res, { type: 'error', message: e.message });
    } finally {
      buildRunning = false;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  });

  router.get('/api/kg/build/status', (_req: Request, res: Response) => {
    res.json({ running: buildRunning });
  });

  return router;
}
