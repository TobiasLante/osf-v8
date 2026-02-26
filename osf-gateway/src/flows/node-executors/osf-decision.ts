import { NodeExecutor } from './types';
import { callLlm } from '../../chat/llm-client';
import { logger } from '../../logger';

/** Traverse a dot-path like "result.ok" or "status" */
function getNestedField(obj: any, path: string): any {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Match a field value to the closest label index. Boolean/yes/no → 0/1, else substring match. */
function matchValueToLabel(value: any, labels: string[]): number {
  const str = String(value).toLowerCase().trim();
  // Boolean mapping: true/yes/1/ok → first label, false/no/0 → second label
  if (['true', 'yes', '1', 'ok', 'ja'].includes(str)) return 0;
  if (['false', 'no', '0', 'nein'].includes(str)) return labels.length > 1 ? 1 : 0;
  // Substring match against labels
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].toLowerCase().includes(str) || str.includes(labels[i].toLowerCase())) {
      return i;
    }
  }
  return 0; // default to first output
}

export const executeOsfDecision: NodeExecutor = async (input) => {
  const labels: string[] = input.config.outputLabels || ['Yes', 'No'];

  // Fast path: field-based routing without LLM
  if (input.config.field) {
    try {
      const parsed = typeof input.previousOutput === 'string'
        ? JSON.parse(input.previousOutput)
        : (input.previousOutput || {});
      const value = getNestedField(parsed, input.config.field);
      if (value !== undefined) {
        const port = matchValueToLabel(value, labels);
        logger.info({ nodeId: input.config.id, field: input.config.field, value, matchedPort: port, matchedLabel: labels[port] }, 'osf-decision: field-based routing (no LLM)');
        return { output: String(value), outputPort: port };
      }
    } catch {
      // JSON parse failed or field not found — fall through to LLM
    }
    logger.info({ nodeId: input.config.id, field: input.config.field }, 'osf-decision: field not found, falling back to LLM');
  }

  const promptTemplate = input.config.prompt || 'Classify the following input. Respond with ONLY the category name.\n\nCategories: {{labels}}\n\nInput:\n{{input}}';

  // Truncate input to avoid token limits — decision only needs key fields
  let inputText = input.previousOutput || '';
  if (inputText.length > 4000) {
    inputText = inputText.slice(0, 4000) + '\n...[truncated]';
  }

  const prompt = promptTemplate
    .replace(/\{\{input\}\}/g, inputText)
    .replace(/\{\{labels\}\}/g, labels.join(', '));

  logger.info({ nodeId: input.config.id, labels, promptLength: prompt.length }, 'osf-decision: calling LLM');

  const response = await callLlm(
    [{ role: 'user', content: prompt }],
    undefined,
    input.llmConfig,
    input.userId
  );

  const answer = (response.content || '').trim().toLowerCase();

  logger.info({ nodeId: input.config.id, answer, labels }, 'osf-decision: LLM responded');

  // Match the LLM's answer to the closest label — check short keywords first
  let matchedPort = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i].toLowerCase();
    // Check both the full label and the first word (keyword) of the label
    const keyword = label.split(/[\s→\-:]/)[0].trim();
    if (answer.includes(label) || (keyword && answer.includes(keyword))) {
      matchedPort = i;
      break;
    }
  }

  logger.info({ nodeId: input.config.id, matchedPort, matchedLabel: labels[matchedPort] }, 'osf-decision: routing');

  return {
    output: response.content || labels[matchedPort],
    outputPort: matchedPort,
  };
};
