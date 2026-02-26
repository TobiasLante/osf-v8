import { NodeExecutor } from './types';
import { callLlm } from '../../chat/llm-client';
import { logger } from '../../logger';

/**
 * Execute an osf-output-parser node.
 * Validates LLM output against a JSON schema. Auto-retries with the LLM if parsing fails.
 */
export const executeOsfOutputParser: NodeExecutor = async (input) => {
  const schemaStr = input.config.schema || '{}';
  const maxRetries = parseInt(input.config.maxRetries, 10) || 2;

  let schema: any;
  try {
    schema = JSON.parse(schemaStr);
  } catch {
    throw new Error('osf-output-parser: invalid JSON schema in config');
  }

  let content = input.previousOutput || '';

  // Strip code fences if present
  content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Try to parse
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const parsed = JSON.parse(content);

      // Basic schema validation: check required fields exist
      if (schema.required && Array.isArray(schema.required)) {
        const missing = schema.required.filter((f: string) => !(f in parsed));
        if (missing.length > 0) {
          throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
      }

      // Check property types if schema.properties defined
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (key in parsed && (prop as any).type) {
            const expectedType = (prop as any).type;
            const actualType = Array.isArray(parsed[key]) ? 'array' : typeof parsed[key];
            if (expectedType !== actualType && !(expectedType === 'integer' && typeof parsed[key] === 'number')) {
              throw new Error(`Field '${key}' should be ${expectedType} but got ${actualType}`);
            }
          }
        }
      }

      return { output: JSON.stringify(parsed) };
    } catch (parseErr: any) {
      if (attempt < maxRetries) {
        logger.info({
          nodeId: input.config.id,
          attempt: attempt + 1,
          error: parseErr.message,
        }, 'osf-output-parser: retrying with LLM');

        // Ask LLM to fix the output
        const fixPrompt = `The following text should be valid JSON matching this schema:
${schemaStr}

But it has this error: ${parseErr.message}

Original text:
${content}

Fix the JSON and respond ONLY with the corrected valid JSON. No explanation, no code fences.`;

        const response = await callLlm(
          [{ role: 'user', content: fixPrompt }],
          undefined,
          input.llmConfig,
          input.userId
        );

        content = (response.content || '')
          .replace(/^```(?:json)?\s*\n?/i, '')
          .replace(/\n?```\s*$/i, '')
          .trim();
      } else {
        throw new Error(`osf-output-parser: failed after ${maxRetries + 1} attempts: ${parseErr.message}`);
      }
    }
  }

  return { output: content };
};
