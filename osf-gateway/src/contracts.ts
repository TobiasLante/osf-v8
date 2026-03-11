/**
 * Pipeline handoff contracts — Zod schemas for LLM JSON output validation.
 * Prevents LLM hallucination from crashing the pipeline.
 */

import { z } from 'zod';
import { logger } from './logger';

// ─── Specialist Report ───────────────────────────────────────────────────

const FindingSchema = z.object({
  finding: z.string().default(''),
  evidence: z.string().default(''),
  severity: z.enum(['hoch', 'mittel', 'niedrig']).default('mittel'),
  affectedMachines: z.array(z.string()).optional(),
}).passthrough();

const RecommendationSchema = z.object({
  maßnahme: z.string().default(''),
  priorität: z.enum(['sofort', 'heute', 'diese_woche']).default('heute'),
  maschine: z.string().optional(),
  erwarteteWirkung: z.string().default(''),
}).passthrough();

export const SpecialistReportSchema = z.object({
  domain: z.string().default('UNKNOWN'),
  zahlenDatenFakten: z.any().default(''),
  kritischeFindings: z.array(FindingSchema).default([]),
  empfehlungen: z.array(RecommendationSchema).default([]),
  crossDomainHinweise: z.array(z.string()).default([]),
}).passthrough();

// ─── Moderator Review ────────────────────────────────────────────────────

const FollowUpQuestionSchema = z.object({
  targetSpecialist: z.string().default(''),
  question: z.string().default(''),
  context: z.string().optional(),
  tools: z.array(z.string()).optional(),
}).passthrough();

const NewSpecialistSchema = z.object({
  name: z.string().default(''),
  displayName: z.string().optional(),
  domain: z.string().optional(),
  focus: z.string().default(''),
  tools: z.array(z.string()).optional(),
}).passthrough();

export const ModeratorReviewSchema = z.object({
  gaps: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  followUpQuestions: z.array(FollowUpQuestionSchema).default([]),
  newSpecialists: z.array(NewSpecialistSchema).default([]),
  preliminaryInsights: z.array(z.string()).default([]),
  readyForSynthesis: z.boolean().default(false),
}).passthrough();

// ─── Intent Classifier ───────────────────────────────────────────────────

export const IntentClassifierSchema = z.object({
  complex: z.boolean().default(false),
}).passthrough();

// ─── Plan Specialists (tool selector) ────────────────────────────────────

export const ToolSelectorSchema = z.object({
  tools: z.array(z.string()).default([]),
}).passthrough();

// ─── Critique ────────────────────────────────────────────────────────────

export const CritiqueSchema = z.object({
  supported: z.array(z.unknown()).default([]),
  concerns: z.array(z.unknown()).default([]),
  additions: z.array(z.unknown()).default([]),
  overallAssessment: z.string().default(''),
}).passthrough();

// ─── Safe Parse ──────────────────────────────────────────────────────────

/**
 * Parse data against a Zod schema. Returns fallback on failure instead of crashing.
 * Logs a warning with the schema name and error details.
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  fallback: T,
  label?: string,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  logger.warn(
    {
      schema: label || 'unknown',
      errors: result.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`),
      dataType: typeof data,
      dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 10) : undefined,
    },
    'Contract validation failed, using fallback',
  );
  return fallback;
}

// ─── Plan Specialists ───────────────────────────────────────────────────

export const PlanSpecialistsSchema = z.object({
  specialists: z.array(z.object({
    name: z.string().default('unknown'),
    domain: z.string().default('GENERAL'),
    displayName: z.string().optional(),
    focus: z.string().default(''),
  }).passthrough()).default([]),
  relevantTools: z.array(z.string()).default([]),
}).passthrough();

// ─── Default Fallbacks ───────────────────────────────────────────────────

export const FALLBACK_SPECIALIST_REPORT = {
  domain: 'UNKNOWN',
  zahlenDatenFakten: '',
  kritischeFindings: [],
  empfehlungen: [],
  crossDomainHinweise: [],
};

export const FALLBACK_MODERATOR_REVIEW = {
  gaps: [],
  contradictions: [],
  followUpQuestions: [],
  newSpecialists: [],
  preliminaryInsights: [],
  readyForSynthesis: true, // fail-open: proceed to synthesis instead of hanging
};

export const FALLBACK_CRITIQUE = {
  supported: [],
  concerns: [],
  additions: [],
  overallAssessment: '',
};

export const FALLBACK_PLAN_SPECIALISTS = null; // null → existing catch uses IMPACT_SPECIALISTS
