import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { logger } from './logger';
import { initializeGraph } from './cypher-utils';
import { discoverAndSample, ToolDiscoveryResult } from './tool-discovery';
import { fetchSMProfileFromUrl, parseSMProfile, SMProfileSchema } from './sm-profile-parser';
import { planSchema, formatProposalForChat, applyUserCorrections, SchemaProposal, SchemaRun, saveSchemaRun } from './schema-planner';
import { executeNodeExtraction } from './entity-extractor';
import { executeRelationshipBuilding } from './relationship-builder';
import { runValidation, formatValidationReport, answerGraphQuestion, ValidationReport } from './validator';
import { autoCorrect, userCorrect, identifyMissingTypes, formatCorrectionProposal } from './corrector';

// ── SSE helpers ────────────────────────────────────────────────────

function emitSSE(res: Response, event: Record<string, any>): boolean {
  if (res.writableEnded) return false;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch { return false; }
}

// ── HITL: pending input mechanism ──────────────────────────────────

const pendingInputs = new Map<string, { resolve: (msg: string) => void }>();
let activePipeline: string | null = null;

async function waitForUserInput(runId: string, prompt: string, res: Response): Promise<string> {
  emitSSE(res, { type: 'waiting_for_input', prompt });
  return new Promise(resolve => {
    pendingInputs.set(runId, { resolve });
  });
}

// ── Pipeline Orchestration ─────────────────────────────────────────

async function runPipeline(
  runId: string,
  res: Response,
  options: { smProfileUrl?: string; authToken?: string },
) {
  const run: SchemaRun = {
    id: runId,
    status: 'planning',
    proposal: null,
    confirmedSchema: null,
    extractionReport: null,
    validationReport: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const heartbeat = setInterval(() => emitSSE(res, { type: 'heartbeat' }), 15_000);

  try {
    // ── Phase 0: SM Profile Import (optional) ──────────────────
    let smProfile: SMProfileSchema | undefined;

    if (options.smProfileUrl) {
      emitSSE(res, { type: 'phase', phase: 0, description: 'Importing CESMII SM Profile...' });
      try {
        const xml = await fetchSMProfileFromUrl(options.smProfileUrl);
        smProfile = parseSMProfile(xml);
        emitSSE(res, { type: 'phase', phase: 0, description: `SM Profile loaded: ${smProfile.types.length} types` });
      } catch (e: any) {
        emitSSE(res, { type: 'error', message: `SM Profile import failed: ${e.message}. Continuing without it.` });
      }
    }

    // ── Phase 1: Tool Discovery + Schema Planning ──────────────
    emitSSE(res, { type: 'phase', phase: 1, description: 'Discovering MCP tools...' });

    const discovery = await discoverAndSample(options.authToken);
    emitSSE(res, { type: 'phase', phase: 1, description: `Discovered ${discovery.tools.length} tools. Planning schema...` });

    let proposal = await planSchema(discovery, smProfile);
    run.proposal = proposal;
    run.status = 'planning';
    await saveSchemaRun(run);

    // HITL: show proposal and wait for confirmation
    const markdown = formatProposalForChat(proposal);
    emitSSE(res, { type: 'schema_proposal', proposal, markdown });

    let confirmed = false;
    while (!confirmed) {
      const userMsg = await waitForUserInput(runId, 'Bestaetige Schema oder gib Korrektur an.', res);
      const lower = userMsg.toLowerCase().trim();

      if (['ok', 'ja', 'yes', 'confirm', 'proceed', 'passt', 'gut', 'weiter'].some(w => lower.includes(w))) {
        confirmed = true;
      } else {
        emitSSE(res, { type: 'phase', phase: 1, description: 'Ueberarbeite Schema...' });
        proposal = await applyUserCorrections(proposal, userMsg, discovery);
        const revisedMd = formatProposalForChat(proposal);
        emitSSE(res, { type: 'schema_proposal', proposal, markdown: revisedMd });
      }
    }

    run.confirmedSchema = proposal;
    run.status = 'extracting';
    await saveSchemaRun(run);

    // ── Phase 2: Entity Extraction ─────────────────────────────
    emitSSE(res, { type: 'phase', phase: 2, description: `Extracting ${proposal.nodeTypes.length} node types...` });

    const extractionReport = await executeNodeExtraction(
      proposal.nodeTypes,
      options.authToken,
      (msg, detail) => emitSSE(res, { type: 'extraction_progress', message: msg, ...detail }),
    );

    run.extractionReport = extractionReport;
    run.status = 'building';
    await saveSchemaRun(run);

    // ── Phase 3: Relationship Building ─────────────────────────
    emitSSE(res, { type: 'phase', phase: 3, description: `Building ${proposal.edgeTypes.length} edge types...` });

    const buildReport = await executeRelationshipBuilding(
      proposal.edgeTypes,
      options.authToken,
      (msg, detail) => emitSSE(res, { type: 'extraction_progress', message: msg, ...detail }),
    );

    run.status = 'validating';
    await saveSchemaRun(run);

    // ── Phase 4: Validation ────────────────────────────────────
    emitSSE(res, { type: 'phase', phase: 4, description: 'Validating graph...' });

    let validationReport = await runValidation();
    run.validationReport = validationReport;
    await saveSchemaRun(run);

    const valMd = formatValidationReport(validationReport);
    emitSSE(res, { type: 'validation_report', report: validationReport, markdown: valMd, accuracy: validationReport.accuracy });

    // ── Phase 5: Correction Loop ───────────────────────────────
    let correctionRound = 0;
    const MAX_CORRECTIONS = 3;

    while (correctionRound < MAX_CORRECTIONS) {
      // Check if auto-correction needed
      const { missingNodes, missingEdges } = identifyMissingTypes(proposal, validationReport);

      if (missingNodes.length > 0 || missingEdges.length > 0) {
        emitSSE(res, { type: 'phase', phase: 5, description: `Correction round ${correctionRound + 1}` });
        const correctionMd = formatCorrectionProposal('auto', missingNodes, missingEdges);
        emitSSE(res, { type: 'correction_proposal', corrections: { missingNodes, missingEdges }, markdown: correctionMd });
      }

      // Wait for user input (question, correction, or done)
      const userMsg = await waitForUserInput(runId, 'Frage stellen, Korrektur angeben, oder "fertig".', res);
      const lower = userMsg.toLowerCase().trim();

      if (['fertig', 'done', 'finish', 'ok', 'passt'].some(w => lower.includes(w))) {
        break;
      }

      if (lower === 'skip') {
        break;
      }

      // Check if it's a question about the graph
      if (userMsg.includes('?') || lower.startsWith('was') || lower.startsWith('wer') || lower.startsWith('wie') || lower.startsWith('welch')) {
        const answer = await answerGraphQuestion(userMsg, proposal);
        emitSSE(res, { type: 'answer', question: userMsg, answer });
        continue; // Don't count as correction round
      }

      // It's a correction request
      run.status = 'correcting';
      await saveSchemaRun(run);

      if ((missingNodes.length > 0 || missingEdges.length > 0) && lower.includes('ok')) {
        // Auto-correct
        const result = await autoCorrect(proposal, validationReport, options.authToken, (msg, detail) =>
          emitSSE(res, { type: 'extraction_progress', message: msg, ...detail })
        );
        validationReport = result.validationAfter;
      } else {
        // User-directed correction
        const result = await userCorrect(proposal, userMsg, discovery, options.authToken, (msg, detail) =>
          emitSSE(res, { type: 'extraction_progress', message: msg, ...detail })
        );
        proposal = result.updatedSchema;
        run.confirmedSchema = proposal;
        validationReport = result.validationAfter;
      }

      run.validationReport = validationReport;
      run.status = 'validating';
      await saveSchemaRun(run);

      const updatedValMd = formatValidationReport(validationReport);
      emitSSE(res, { type: 'validation_report', report: validationReport, markdown: updatedValMd, accuracy: validationReport.accuracy });

      correctionRound++;
    }

    // ── Done ───────────────────────────────────────────────────
    run.status = 'complete';
    await saveSchemaRun(run);

    const totalNodes = Object.values(validationReport.nodeCounts).reduce((a, b) => a + b, 0);
    const totalEdges = Object.values(validationReport.edgeCounts).reduce((a, b) => a + b, 0);

    emitSSE(res, {
      type: 'done',
      runId,
      summary: `KG built: ${totalNodes} nodes, ${totalEdges} edges, ${Object.keys(validationReport.nodeCounts).length} types. Accuracy: ${validationReport.accuracy}%`,
    });

  } catch (e: any) {
    logger.error({ err: e.message, runId }, 'Pipeline failed');
    run.status = 'failed';
    await saveSchemaRun(run).catch(() => {});
    emitSSE(res, { type: 'error', message: e.message });
  } finally {
    clearInterval(heartbeat);
    activePipeline = null;
    pendingInputs.delete(runId);
    if (!res.writableEnded) res.end();
  }
}

// ── Express Server ─────────────────────────────────────────────────

const app = express();
app.use(express.json());

let graphAvailable = false;

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'osf-kg-builder', graphAvailable });
});

// Start a new KG build run
app.post('/api/kg-builder/start', (req: Request, res: Response) => {
  if (activePipeline) {
    res.status(409).json({ error: 'A pipeline is already running', runId: activePipeline });
    return;
  }

  const runId = uuidv4();
  activePipeline = runId;

  const { smProfileUrl, authToken } = req.body || {};

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Run-Id': runId,
  });

  emitSSE(res, { type: 'run_start', runId });

  // Run pipeline in background
  runPipeline(runId, res, { smProfileUrl, authToken });
});

// Send user message to running pipeline (HITL)
app.post('/api/kg-builder/message/:runId', (req: Request, res: Response) => {
  const { runId } = req.params;
  const { message } = req.body || {};

  const pending = pendingInputs.get(runId);
  if (!pending) {
    res.status(404).json({ error: 'No pending input for this run' });
    return;
  }

  pending.resolve(message || '');
  pendingInputs.delete(runId);
  res.json({ ok: true });
});

// List past runs
app.get('/api/kg-builder/runs', async (_req: Request, res: Response) => {
  try {
    const { kgPool } = await import('./cypher-utils');
    const result = await kgPool.query(
      `SELECT id, status, created_at, updated_at FROM ${config.db.schema}.kg_builder_runs ORDER BY created_at DESC LIMIT 20`
    );
    res.json(result.rows);
  } catch (e: any) {
    res.json([]);
  }
});

// ── Startup ────────────────────────────────────────────────────────

async function main() {
  logger.info({ port: config.port, llm: config.llm.url, mcpProxy: config.mcpProxy.url }, 'Starting osf-kg-builder');

  graphAvailable = await initializeGraph();
  logger.info({ graphAvailable }, 'Graph status');

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'osf-kg-builder listening');
  });
}

main().catch(e => {
  logger.fatal({ err: e.message }, 'Failed to start');
  process.exit(1);
});
