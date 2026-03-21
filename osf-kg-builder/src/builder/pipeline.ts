import { v4 as uuidv4 } from 'uuid';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import { loadDomainConfig, loadSchemaTemplate } from '../shared/domain-config';
import { initializeGraph, closeGraph } from '../shared/cypher-utils';
import { initVectorStore } from '../shared/vector-store';
import { SchemaProposal, SchemaRun, NodeTypeSpec } from '../shared/types';
import { i3xToSchemaProposal, importI3xToGraph } from '../parsers/i3x-client';
import { parseMTP, fetchMTPFromUrl, mtpToNodeTypes, mtpToEdgeTypes, MTPSchema } from '../parsers/mtp-parser';
import { fetchSMProfileFromUrl, parseSMProfile, SMProfileSchema } from '../parsers/sm-profile-parser';
import { discoverAndSample } from './tool-discovery';
import { planSchema, saveSchemaRun } from './schema-planner';
import { deterministicExtract } from './deterministic-extractor';
import { llmExtractNodes } from './llm-extractor';
import { executeRelationshipBuilding } from './relationship-builder';
import { runValidation, formatValidationReport } from './validator';

export type ProgressCallback = (event: { phase: number; step: string; detail?: string }) => void;

export interface PipelineOptions {
  domain: string;
  smProfileUrl?: string;
  authToken?: string;
  mtpUrls?: string[];
  i3xEndpoints?: string[];
  skipDiscovery?: boolean;
  onProgress?: ProgressCallback;
}

export interface PipelineResult {
  runId: string;
  status: 'complete' | 'failed';
  totalNodes: number;
  totalEdges: number;
  accuracy: number;
  error?: string;
}

/**
 * Run the full KG build pipeline as a CLI batch job.
 * Phases: 0 (imports) → 1 (schema) → 2 (extraction) → 3 (relationships) → 4 (validation)
 */
export async function runBuildPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const runId = uuidv4();
  const domain = loadDomainConfig();
  logger.info({ runId, domain: domain.domain }, 'Starting KG build pipeline');

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

  const emit = options.onProgress || (() => {});

  try {
    // ── Initialize Graph ──────────────────────────────────────────
    emit({ phase: 0, step: 'Connecting to Neo4j...' });
    const graphOk = await initializeGraph();
    if (!graphOk) throw new Error('Neo4j not available');

    await initVectorStore();
    emit({ phase: 0, step: 'Neo4j + Vector Store ready' });

    // ── Phase 0: External Imports (SM Profile, MTP, i3X) ─────────
    logger.info('Phase 0: External imports...');
    emit({ phase: 0, step: 'External imports...' });

    let smProfile: SMProfileSchema | undefined;
    const smUrl = options.smProfileUrl || config.smProfileUrl;
    if (smUrl) {
      try {
        const xml = await fetchSMProfileFromUrl(smUrl);
        smProfile = parseSMProfile(xml);
        logger.info({ types: smProfile.types.length }, 'SM Profile loaded');
      } catch (e: any) {
        logger.warn({ err: e.message }, 'SM Profile import failed, continuing');
      }
    }

    const mtpModules: MTPSchema[] = [];
    const mtpUrlList = options.mtpUrls || config.mtp.urls;
    for (const url of mtpUrlList) {
      try {
        const xml = await fetchMTPFromUrl(url);
        const schema = parseMTP(xml);
        mtpModules.push(schema);
        logger.info({ url, modules: schema.modules.length }, 'MTP loaded');
      } catch (e: any) {
        logger.warn({ url, err: e.message }, 'MTP import failed');
      }
    }
    const allMtpNodeTypes = mtpModules.flatMap(m => mtpToNodeTypes(m));
    const allMtpEdgeTypes = mtpModules.flatMap(m => mtpToEdgeTypes(m));

    let i3xProposal: SchemaProposal | undefined;
    const i3xEndpointList = options.i3xEndpoints || config.i3x.endpoints;
    for (const endpoint of i3xEndpointList) {
      try {
        const result = await importI3xToGraph(endpoint, msg => logger.info(msg));
        logger.info({ endpoint, nodes: result.nodes, edges: result.edges }, 'i3X imported');
      } catch (e: any) {
        logger.warn({ endpoint, err: e.message }, 'i3X import failed');
      }
    }
    if (i3xEndpointList.length > 0) {
      try {
        i3xProposal = await i3xToSchemaProposal(i3xEndpointList[0]);
      } catch {}
    }

    // ── Phase 1: Schema Planning ──────────────────────────────────
    emit({ phase: 1, step: 'Discovering MCP tools...' });

    const discovery = options.skipDiscovery
      ? { tools: [], discoveredAt: new Date().toISOString() }
      : await discoverAndSample(options.authToken);

    emit({ phase: 1, step: `Discovered ${discovery.tools.length} tools. Planning schema...` });

    const proposal = await planSchema(discovery, smProfile, i3xProposal, allMtpNodeTypes, allMtpEdgeTypes);
    run.proposal = proposal;
    run.confirmedSchema = proposal;
    run.status = 'extracting';
    await saveSchemaRun(run);

    emit({ phase: 1, step: `Schema: ${proposal.nodeTypes.length} node types, ${proposal.edgeTypes.length} edge types` });

    // ── Phase 2: Entity Extraction (deterministic first, LLM fallback) ──
    emit({ phase: 2, step: `Extracting ${proposal.nodeTypes.length} node types...` });

    const llmFallbackTypes: NodeTypeSpec[] = [];

    for (const nt of proposal.nodeTypes) {
      emit({ phase: 2, step: `Extracting ${nt.label} from ${nt.sourceTool}...`, detail: nt.label });
      const result = await deterministicExtract(nt, options.authToken, (msg, detail) => {
        logger.info({ ...detail }, msg);
      });

      if (result === null) {
        // Deterministic extraction failed → queue for LLM fallback
        logger.info({ label: nt.label }, 'Deterministic extraction failed, queuing for LLM fallback');
        llmFallbackTypes.push(nt);
      }
    }

    // LLM fallback for types that couldn't be parsed deterministically
    if (llmFallbackTypes.length > 0) {
      logger.info({ count: llmFallbackTypes.length }, 'Running LLM fallback extraction');
      const llmReport = await llmExtractNodes(llmFallbackTypes, options.authToken, (msg, detail) => {
        logger.info({ ...detail }, msg);
      });
      run.extractionReport = llmReport;
    }

    run.status = 'building';
    await saveSchemaRun(run);

    // ── Phase 3: Relationship Building ────────────────────────────
    emit({ phase: 3, step: `Building ${proposal.edgeTypes.length} edge types...` });

    await executeRelationshipBuilding(proposal.edgeTypes, proposal.nodeTypes, options.authToken, (msg, detail) => {
      emit({ phase: 3, step: msg, detail: detail?.edgeType });
      logger.info({ ...detail }, msg);
    });

    run.status = 'validating';
    await saveSchemaRun(run);

    // ── Phase 4: Validation ───────────────────────────────────────
    emit({ phase: 4, step: 'Validating graph...' });

    const validationReport = await runValidation(proposal);
    run.validationReport = validationReport;
    run.status = 'complete';
    await saveSchemaRun(run);

    const totalNodes = Object.values(validationReport.nodeCounts).reduce((a, b) => a + b, 0);
    const totalEdges = Object.values(validationReport.edgeCounts).reduce((a, b) => a + b, 0);

    logger.info({
      totalNodes,
      totalEdges,
      accuracy: validationReport.accuracy,
      issues: validationReport.issues.length,
    }, 'Pipeline complete');

    console.log(formatValidationReport(validationReport));

    return { runId, status: 'complete', totalNodes, totalEdges, accuracy: validationReport.accuracy };
  } catch (e: any) {
    logger.error({ err: e.message, runId }, 'Pipeline failed');
    run.status = 'failed';
    await saveSchemaRun(run).catch(() => {});
    return { runId, status: 'failed', totalNodes: 0, totalEdges: 0, accuracy: 0, error: e.message };
  } finally {
    await closeGraph();
  }
}
