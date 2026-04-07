/**
 * LLM Client Abstraction — supports both Anthropic API and local llama.cpp (OpenAI-compatible).
 *
 * Priority:
 * 1. If ANTHROPIC_API_KEY is set → use Anthropic SDK (better quality)
 * 2. If LLM_BASE_URL is set → use OpenAI-compatible endpoint (llama.cpp / Qwen)
 * 3. Neither → return fallback text
 */

import Anthropic from '@anthropic-ai/sdk';

const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_MODEL = process.env.LLM_DEFAULT_MODEL || 'Qwen2.5-32B-Instruct-Q4_K_M.gguf';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const TIMEOUT_MS = 30_000;

type LlmProvider = 'anthropic' | 'openai-compat' | 'none';

function getProvider(): LlmProvider {
  if (ANTHROPIC_KEY) return 'anthropic';
  if (LLM_BASE_URL) return 'openai-compat';
  return 'none';
}

/**
 * Send a prompt to the configured LLM and return the text response.
 * Uses Anthropic Haiku if API key is available, otherwise falls back to llama.cpp.
 */
export async function llmComplete(prompt: string, opts?: {
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const provider = getProvider();
  const maxTokens = opts?.maxTokens || 1000;

  if (provider === 'anthropic') {
    return anthropicComplete(prompt, maxTokens, opts?.model);
  }
  if (provider === 'openai-compat') {
    return openaiCompatComplete(prompt, maxTokens);
  }

  console.warn('[llm-client] No LLM provider configured (set ANTHROPIC_API_KEY or LLM_BASE_URL)');
  return '(LLM not configured)';
}

/**
 * Extract structured JSON from text using the LLM.
 * Retries once if JSON parsing fails.
 */
export async function llmExtractJson<T = any>(prompt: string): Promise<T | null> {
  const text = await llmComplete(prompt, { maxTokens: 1500 });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[llm-client] No JSON found in LLM response');
    return null;
  }
  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    console.warn('[llm-client] Failed to parse JSON from LLM response');
    return null;
  }
}

// ── Anthropic ──

async function anthropicComplete(prompt: string, maxTokens: number, model?: string): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (err: any) {
    console.warn('[llm-client] Anthropic call failed:', err.message);
    // Fallback to llama.cpp if available
    if (LLM_BASE_URL) {
      console.log('[llm-client] Falling back to llama.cpp');
      return openaiCompatComplete(prompt, maxTokens);
    }
    return '(LLM call failed)';
  }
}

// ── OpenAI-compatible (llama.cpp) ──

async function openaiCompatComplete(prompt: string, maxTokens: number): Promise<string> {
  try {
    const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.warn(`[llm-client] llama.cpp HTTP ${resp.status}`);
      return '(LLM call failed)';
    }

    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err: any) {
    console.warn('[llm-client] llama.cpp call failed:', err.message);
    return '(LLM call failed)';
  }
}

// Log which provider is active on import
const provider = getProvider();
console.log(`[llm-client] Provider: ${provider}${provider === 'anthropic' ? ' (Haiku)' : provider === 'openai-compat' ? ` (${LLM_MODEL})` : ''}`);
