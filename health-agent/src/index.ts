// Health Agent — Main entry point
// LLM-powered health monitoring for OpenShopFloor K8s cluster

import { callLlm, checkLlmAvailability, type ChatMessage, type ToolCall } from './llm.js';
import { getAllTools } from './tools.js';
import { executeTool } from './executor.js';
import { buildSystemPrompt } from './prompt.js';
import { sendAlert } from './alert.js';
import { saveReport } from './db.js';

// ─── CLI args ─────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const autoFix = args.includes('--auto-fix');
const llmUrlArg = args.find(a => a.startsWith('--llm-url='))?.split('=')[1]
  || args[args.indexOf('--llm-url') + 1];

const LLM_PRIMARY = llmUrlArg || process.env.LLM_URL || 'http://192.168.178.120:5002';
const LLM_FALLBACK = process.env.LLM_FALLBACK_URL || 'http://192.168.178.120:5001';
const MAX_ITERATIONS = 15;

function log(msg: string): void {
  console.log(`[health-agent] ${msg}`);
}

async function resolveLlmUrl(): Promise<string> {
  log(`Checking LLM at ${LLM_PRIMARY}...`);
  if (await checkLlmAvailability(LLM_PRIMARY)) {
    log(`Using primary LLM: ${LLM_PRIMARY}`);
    return LLM_PRIMARY;
  }

  log(`Primary unavailable, trying fallback ${LLM_FALLBACK}...`);
  if (await checkLlmAvailability(LLM_FALLBACK)) {
    log(`Using fallback LLM: ${LLM_FALLBACK}`);
    return LLM_FALLBACK;
  }

  throw new Error(`LLM unavailable at ${LLM_PRIMARY} and ${LLM_FALLBACK}`);
}

async function run(): Promise<void> {
  const startTime = Date.now();
  log(`Starting health check — dry-run=${dryRun}, auto-fix=${autoFix}`);
  log(`Date: ${new Date().toISOString()}`);

  // 1. Resolve LLM
  let llmUrl: string;
  try {
    llmUrl = await resolveLlmUrl();
  } catch (err: any) {
    log(`FATAL: ${err.message}`);
    await saveReport('error', `LLM unavailable: ${err.message}`, 0, Date.now() - startTime);
    process.exit(1);
  }

  // 2. Build messages
  const tools = getAllTools();
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: `Fuehre einen vollstaendigen Health Check durch.\nDatum: ${new Date().toISOString()}\nModus: ${dryRun ? 'dry-run (Test)' : 'production'}${autoFix ? ', auto-fix enabled' : ''}`,
    },
  ];

  // 3. Agent loop
  let totalToolCalls = 0;
  let finalContent = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    log(`Iteration ${i + 1}/${MAX_ITERATIONS}...`);

    let response;
    try {
      response = await callLlm(messages, tools, llmUrl);
    } catch (err: any) {
      log(`LLM call failed: ${err.message}`);
      finalContent = `ERROR: LLM call failed at iteration ${i + 1}: ${err.message}`;
      break;
    }

    // Tool calls?
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Push assistant message with tool_calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        totalToolCalls++;
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        log(`  Tool: ${tc.function.name}(${JSON.stringify(toolArgs).slice(0, 100)})`);
        const result = executeTool(tc.function.name, toolArgs, autoFix);
        log(`  Result: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);

        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        });
      }
      continue;
    }

    // No tool calls = final response
    finalContent = response.content || 'ERROR: empty response from LLM';
    break;
  }

  if (!finalContent) {
    finalContent = 'ERROR: Agent loop exhausted max iterations without final response';
  }

  const durationMs = Date.now() - startTime;

  // 4. Output report
  console.log('\n' + '='.repeat(60));
  console.log('HEALTH AGENT REPORT');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Tool calls: ${totalToolCalls}`);
  console.log(`Mode: ${dryRun ? 'dry-run' : 'production'}${autoFix ? ' + auto-fix' : ''}`);
  console.log('-'.repeat(60));
  console.log(finalContent);
  console.log('='.repeat(60) + '\n');

  // 5. Determine status
  const isAlert = finalContent.toUpperCase().startsWith('ALERT');
  const isError = finalContent.toUpperCase().startsWith('ERROR');
  const status = isAlert ? 'alert' : isError ? 'error' : 'ok';

  // 6. Save to DB
  await saveReport(status, finalContent, totalToolCalls, durationMs);

  // 7. Send alert if needed
  if (isAlert) {
    await sendAlert(finalContent, dryRun);
  }

  // 8. Exit
  if (isAlert || isError) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(`[health-agent] Unhandled error: ${err.message}`);
  process.exit(1);
});
