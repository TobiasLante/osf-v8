import { Router, Request, Response } from 'express';
import type { IRouter } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LlmConfig, McpTool } from '@p1/shared';
import { mcpListTools, mcpCallTool } from './mcp-proxy';

export const llmRouter: IRouter = Router();

const SYSTEM_PROMPT = `You are Process1st, a bioprocess sales intelligence assistant. You help salespeople prepare for customer meetings by analyzing the equipment landscape.

You have access to a knowledge graph with:
- Accounts (pharma/biotech companies with molecule types, development phases, warmth ratings)
- Vendors (Sartorius, ThermoFisher, Cytiva, MilliporeSigma, Repligen, etc.)
- Vendor Products (specific equipment mapped to unit operations)
- Unit Operations (process steps: bioreactors, chromatography, filtration, etc.)
- Process Templates (standard processes for mAb, AAV, mRNA, etc.)

Use the pharma_* tools to answer questions. Always be specific about opportunities, competitor positions, and recommended talking points for sales meetings.

When showing account details, highlight:
- OPEN items (opportunities to sell)
- COMPETITOR items (where a competitor has won — know the landscape)
- WON items (installed base to protect/expand)`;

const MAX_TOOL_LOOPS = 10;

llmRouter.post('/api/chat', async (req: Request, res: Response) => {
  const { messages, config, tools: providedTools } = req.body as {
    messages: Array<{ role: string; content: string }>;
    config: LlmConfig;
    tools?: McpTool[];
  };

  if (!config?.apiKey && config?.provider !== 'custom') {
    res.status(400).json({ error: 'No API key provided' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // SSE keepalive — Cloudflare Tunnel drops idle connections after 100s.
  // Send a comment ping every 15s to keep the stream alive during slow LLM calls.
  const keepalive = setInterval(() => { res.write(': keepalive\n\n'); }, 15_000);

  try {
    // Get tools if not provided
    let tools: McpTool[] = providedTools || [];
    if (tools.length === 0) {
      try {
        tools = await mcpListTools();
      } catch (err: any) {
        console.warn('[llm-proxy] Could not fetch MCP tools:', err.message);
      }
    }

    if (config.provider === 'anthropic') {
      await chatAnthropic(messages, tools, config, sendEvent);
    } else {
      await chatOpenAI(messages, tools, config, sendEvent);
    }

    sendEvent({ type: 'done' });
  } catch (err: any) {
    console.error('[llm-proxy] error:', err.message);
    sendEvent({ type: 'error', message: err.message });
  }

  clearInterval(keepalive);
  res.end();
});

// ── Anthropic ──

async function chatAnthropic(
  messages: Array<{ role: string; content: string }>,
  tools: McpTool[],
  config: LlmConfig,
  sendEvent: (data: Record<string, any>) => void,
) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description || '',
    input_schema: (t.inputSchema || { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
  }));

  let llmMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: llmMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    let hasToolUse = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        sendEvent({ type: 'content', text: block.text });
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        sendEvent({ type: 'tool_start', name: block.name, args: block.input });

        try {
          const resultText = await mcpCallTool(block.name, block.input as Record<string, any>);
          sendEvent({ type: 'tool_result', name: block.name, content: resultText });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
          });
        } catch (err: any) {
          const errMsg = err.message || 'Tool call failed';
          sendEvent({ type: 'tool_result', name: block.name, content: `Error: ${errMsg}` });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${errMsg}`,
            is_error: true,
          });
        }
      }
    }

    if (!hasToolUse) return;

    // Append assistant turn + tool results and loop
    llmMessages.push({ role: 'assistant', content: response.content });
    llmMessages.push({ role: 'user', content: toolResults });
  }

  sendEvent({ type: 'warning', message: `Tool loop limit reached (${MAX_TOOL_LOOPS})` });
}

// ── OpenAI ──

async function chatOpenAI(
  messages: Array<{ role: string; content: string }>,
  tools: McpTool[],
  config: LlmConfig,
  sendEvent: (data: Record<string, any>) => void,
) {
  const client = new OpenAI({
    apiKey: config.apiKey || 'not-needed',
    baseURL: config.baseUrl || process.env.LLM_BASE_URL || undefined,
  });

  const oaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));

  let oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await client.chat.completions.create({
      model: config.model || process.env.LLM_DEFAULT_MODEL || 'gpt-4o',
      messages: oaiMessages,
      ...(oaiTools.length > 0 ? { tools: oaiTools } : {}),
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    const msg = choice.message;

    if (msg.content) {
      sendEvent({ type: 'content', text: msg.content });
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) return;

    // Append the assistant message with tool_calls
    oaiMessages.push(msg);

    for (const tc of msg.tool_calls) {
      let args: Record<string, any>;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        sendEvent({ type: 'tool_result', name: tc.function.name, content: 'Error: Malformed tool arguments' });
        oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: Malformed tool arguments' });
        continue;
      }
      sendEvent({ type: 'tool_start', name: tc.function.name, args });

      try {
        const resultText = await mcpCallTool(tc.function.name, args);
        sendEvent({ type: 'tool_result', name: tc.function.name, content: resultText });
        oaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText,
        });
      } catch (err: any) {
        const errMsg = err.message || 'Tool call failed';
        sendEvent({ type: 'tool_result', name: tc.function.name, content: `Error: ${errMsg}` });
        oaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errMsg}`,
        });
      }
    }
  }

  sendEvent({ type: 'warning', message: `Tool loop limit reached (${MAX_TOOL_LOOPS})` });
}
