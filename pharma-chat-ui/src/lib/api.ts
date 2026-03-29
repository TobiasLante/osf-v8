const MCP_BASE = process.env.NEXT_PUBLIC_MCP_URL || 'http://192.168.178.150:30900';

// ── localStorage keys ──
const LS_PROVIDER = 'p1_provider';
const LS_API_KEY = 'p1_apiKey';
const LS_MODEL = 'p1_model';

export type Provider = 'anthropic' | 'openai' | 'custom';

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
}

export function loadLlmConfig(): LlmConfig {
  if (typeof window === 'undefined') return { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-4-20250514' };
  return {
    provider: (localStorage.getItem(LS_PROVIDER) as Provider) || 'anthropic',
    apiKey: localStorage.getItem(LS_API_KEY) || '',
    model: localStorage.getItem(LS_MODEL) || 'claude-sonnet-4-20250514',
    customBaseUrl: localStorage.getItem('p1_customBaseUrl') || undefined,
  };
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(LS_PROVIDER, cfg.provider);
  localStorage.setItem(LS_API_KEY, cfg.apiKey);
  localStorage.setItem(LS_MODEL, cfg.model);
  if (cfg.customBaseUrl) localStorage.setItem('p1_customBaseUrl', cfg.customBaseUrl);
}

// ── MCP JSON-RPC ──

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export async function mcpListTools(): Promise<McpTool[]> {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  if (!res.ok) throw new Error(`MCP error: ${res.status}`);
  const data = await res.json();
  return data.result?.tools || [];
}

export async function mcpCallTool(name: string, args: Record<string, any>): Promise<any> {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP tool call error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'MCP tool error');
  return data.result;
}

// ── LLM calls (direct from browser) ──

interface LlmMessage {
  role: 'user' | 'assistant';
  content: any;
}

// Convert MCP tools → Anthropic tool format
function mcpToAnthropicTools(tools: McpTool[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

// Convert MCP tools → OpenAI tool format
function mcpToOpenAITools(tools: McpTool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

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

export interface StreamCallbacks {
  onToolStart: (name: string, args: Record<string, any>) => void;
  onToolResult: (name: string, result: string) => void;
  onContent: (text: string) => void;
  onError: (msg: string) => void;
}

export async function chatWithLlm(
  messages: { role: 'user' | 'assistant'; content: string }[],
  tools: McpTool[],
  config: LlmConfig,
  callbacks: StreamCallbacks,
): Promise<void> {
  if (config.provider === 'anthropic') {
    await chatAnthropic(messages, tools, config, callbacks);
  } else {
    await chatOpenAI(messages, tools, config, callbacks);
  }
}

async function chatAnthropic(
  messages: { role: 'user' | 'assistant'; content: string }[],
  tools: McpTool[],
  config: LlmConfig,
  cb: StreamCallbacks,
) {
  let llmMessages: any[] = messages.map(m => ({ role: m.role, content: m.content }));
  const anthropicTools = mcpToAnthropicTools(tools);

  // Tool-use loop (max 10 iterations)
  for (let i = 0; i < 10; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        system: SYSTEM_PROMPT,
        messages: llmMessages,
        tools: anthropicTools,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      cb.onError(`Anthropic API error ${res.status}: ${err}`);
      return;
    }

    const data = await res.json();
    let hasToolUse = false;
    let textContent = '';
    const toolResults: any[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text;
        cb.onContent(block.text);
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        cb.onToolStart(block.name, block.input);
        try {
          const result = await mcpCallTool(block.name, block.input);
          const resultText = typeof result === 'string' ? result : JSON.stringify(result);
          cb.onToolResult(block.name, resultText);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
          });
        } catch (err: any) {
          const errMsg = err.message || 'Tool call failed';
          cb.onToolResult(block.name, `Error: ${errMsg}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${errMsg}`,
            is_error: true,
          });
        }
      }
    }

    if (!hasToolUse) return; // Final text response — done

    // Append assistant turn + tool results and loop
    llmMessages.push({ role: 'assistant', content: data.content });
    llmMessages.push({ role: 'user', content: toolResults });
  }
}

async function chatOpenAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  tools: McpTool[],
  config: LlmConfig,
  cb: StreamCallbacks,
) {
  const baseUrl = config.customBaseUrl || 'https://api.openai.com';
  let oaiMessages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];
  const oaiTools = mcpToOpenAITools(tools);

  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: oaiMessages,
        tools: oaiTools.length > 0 ? oaiTools : undefined,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      cb.onError(`OpenAI API error ${res.status}: ${err}`);
      return;
    }

    const data = await res.json();
    const choice = data.choices[0];
    const msg = choice.message;

    if (msg.content) {
      cb.onContent(msg.content);
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) return;

    // Process tool calls
    oaiMessages.push(msg);

    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments || '{}');
      cb.onToolStart(tc.function.name, args);
      try {
        const result = await mcpCallTool(tc.function.name, args);
        const resultText = typeof result === 'string' ? result : JSON.stringify(result);
        cb.onToolResult(tc.function.name, resultText);
        oaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText,
        });
      } catch (err: any) {
        const errMsg = err.message || 'Tool call failed';
        cb.onToolResult(tc.function.name, `Error: ${errMsg}`);
        oaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errMsg}`,
        });
      }
    }
  }
}
