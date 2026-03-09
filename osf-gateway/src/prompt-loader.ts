import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

// ─── Prompt Loader (v7 pattern) ─────────────────────────────────────────
// Loads .md prompt files from config/prompts/ with {{variable}} replacement.
// Production: cached after first load. Dev: reloads every time.

const PROMPTS_DIR = join(__dirname, '../../config/prompts');
const cache = new Map<string, string>();
const isProd = process.env.NODE_ENV === 'production';

/**
 * Load a prompt file and replace {{variable}} placeholders.
 * @param name - Path relative to config/prompts/ without .md extension (e.g. "agents/oee-monitor")
 * @param variables - Key-value pairs to replace {{key}} with value
 */
export function loadPrompt(name: string, variables?: Record<string, string>): string {
  // Check cache in production
  if (isProd && !variables && cache.has(name)) {
    return cache.get(name)!;
  }

  const filePath = join(PROMPTS_DIR, `${name}.md`);

  if (!existsSync(filePath)) {
    logger.warn({ name, filePath }, 'Prompt file not found');
    return '';
  }

  let content = readFileSync(filePath, 'utf-8').trim();

  // Replace {{variable}} placeholders
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  // Cache raw (no-variables) version in production
  if (isProd && !variables) {
    cache.set(name, content);
  }

  return content;
}

/**
 * Load an agent prompt by agent ID.
 * Shorthand for loadPrompt('agents/<id>').
 */
export function loadAgentPrompt(agentId: string, variables?: Record<string, string>): string {
  return loadPrompt(`agents/${agentId}`, variables);
}

/**
 * Validate that all required prompt files exist. Call at startup.
 */
export function validatePrompts(requiredPrompts: string[]): void {
  const missing: string[] = [];
  for (const name of requiredPrompts) {
    const filePath = join(PROMPTS_DIR, `${name}.md`);
    if (!existsSync(filePath)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    logger.error({ missing }, `Missing ${missing.length} required prompt files`);
    throw new Error(`Missing prompt files: ${missing.join(', ')}`);
  }
  logger.info({ count: requiredPrompts.length }, 'All required prompt files validated');
}

/**
 * Clear the prompt cache (useful for testing or hot-reload).
 */
export function clearPromptCache(): void {
  cache.clear();
}
