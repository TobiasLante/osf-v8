import { SchemaProposal, NodeTypeSpec, EdgeTypeSpec, applyUserCorrections } from './schema-planner';
import { executeNodeExtraction } from './entity-extractor';
import { executeRelationshipBuilding } from './relationship-builder';
import { ValidationReport, runValidation, formatValidationReport } from './validator';
import { ToolDiscoveryResult } from './tool-discovery';
import { logger } from './logger';

export type CorrectionMode = 'auto' | 'user' | 'schema';

export interface CorrectionResult {
  mode: CorrectionMode;
  updatedSchema: SchemaProposal;
  reExtractedTypes: string[];
  reBuiltEdges: string[];
  validationAfter: ValidationReport;
}

// ── Auto Correction ────────────────────────────────────────────────
// Identifies missing/empty node or edge types and re-runs extraction

export function identifyMissingTypes(
  schema: SchemaProposal,
  report: ValidationReport,
): { missingNodes: string[]; missingEdges: string[] } {
  const missingNodes: string[] = [];
  const missingEdges: string[] = [];

  for (const nt of schema.nodeTypes) {
    if (!report.nodeCounts[nt.label] || report.nodeCounts[nt.label] === 0) {
      missingNodes.push(nt.label);
    }
  }

  for (const et of schema.edgeTypes) {
    if (!report.edgeCounts[et.label] || report.edgeCounts[et.label] === 0) {
      missingEdges.push(et.label);
    }
  }

  return { missingNodes, missingEdges };
}

export async function autoCorrect(
  schema: SchemaProposal,
  report: ValidationReport,
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<CorrectionResult> {
  const { missingNodes, missingEdges } = identifyMissingTypes(schema, report);

  onProgress(`Auto-correction: ${missingNodes.length} missing node types, ${missingEdges.length} missing edge types`);

  // Re-extract missing node types
  const nodeTypesToRetry = schema.nodeTypes.filter(nt => missingNodes.includes(nt.label));
  if (nodeTypesToRetry.length > 0) {
    onProgress(`Re-extracting: ${nodeTypesToRetry.map(n => n.label).join(', ')}`);
    await executeNodeExtraction(nodeTypesToRetry, authToken, onProgress);
  }

  // Re-build missing edge types
  const edgeTypesToRetry = schema.edgeTypes.filter(et => missingEdges.includes(et.label));
  if (edgeTypesToRetry.length > 0) {
    onProgress(`Re-building edges: ${edgeTypesToRetry.map(e => e.label).join(', ')}`);
    await executeRelationshipBuilding(edgeTypesToRetry, authToken, onProgress);
  }

  // Re-validate
  const validationAfter = await runValidation();

  return {
    mode: 'auto',
    updatedSchema: schema,
    reExtractedTypes: missingNodes,
    reBuiltEdges: missingEdges,
    validationAfter,
  };
}

// ── User-Directed Correction ───────────────────────────────────────
// User says "SGM-004 fehlt die Wartungshistorie" → agent figures out what to do

export async function userCorrect(
  schema: SchemaProposal,
  userMessage: string,
  discovery: ToolDiscoveryResult,
  authToken: string | undefined,
  onProgress: (msg: string, detail?: any) => void,
): Promise<CorrectionResult> {
  onProgress(`Applying user correction: "${userMessage}"`);

  // Use LLM to revise schema based on feedback
  const updatedSchema = await applyUserCorrections(schema, userMessage, discovery);

  // Find new types that weren't in the original schema
  const origNodeLabels = new Set(schema.nodeTypes.map(n => n.label));
  const origEdgeLabels = new Set(schema.edgeTypes.map(e => e.label));

  const newNodes = updatedSchema.nodeTypes.filter(n => !origNodeLabels.has(n.label));
  const newEdges = updatedSchema.edgeTypes.filter(e => !origEdgeLabels.has(e.label));

  // Also find modified types (same label but different source tool)
  const modifiedNodes = updatedSchema.nodeTypes.filter(n => {
    const orig = schema.nodeTypes.find(o => o.label === n.label);
    return orig && orig.sourceTool !== n.sourceTool;
  });

  const toExtract = [...newNodes, ...modifiedNodes];
  const toEdge = newEdges;

  if (toExtract.length > 0) {
    onProgress(`Extracting ${toExtract.length} new/modified node types`);
    await executeNodeExtraction(toExtract, authToken, onProgress);
  }

  if (toEdge.length > 0) {
    onProgress(`Building ${toEdge.length} new edge types`);
    await executeRelationshipBuilding(toEdge, authToken, onProgress);
  }

  const validationAfter = await runValidation();

  return {
    mode: 'user',
    updatedSchema,
    reExtractedTypes: toExtract.map(n => n.label),
    reBuiltEdges: toEdge.map(e => e.label),
    validationAfter,
  };
}

// ── Format correction proposal for chat ────────────────────────────

export function formatCorrectionProposal(
  mode: CorrectionMode,
  missingNodes: string[],
  missingEdges: string[],
): string {
  const lines: string[] = ['## Korrektur-Vorschlag\n'];

  if (mode === 'auto') {
    lines.push('Automatische Korrektur erkannt:');
    if (missingNodes.length > 0) lines.push(`- **Fehlende Nodes:** ${missingNodes.join(', ')}`);
    if (missingEdges.length > 0) lines.push(`- **Fehlende Edges:** ${missingEdges.join(', ')}`);
    lines.push('\nIch werde die betroffenen Types erneut extrahieren. Bestaetige mit "ok" oder sage "skip".');
  }

  return lines.join('\n');
}
