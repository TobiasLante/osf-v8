export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ProcessStep {
  process: string;
  step: string;
  category: string;
  stepOrder: number;
  equipment: string;
  status?: 'WON' | 'OPEN' | 'COMPETITOR' | 'NO_CONTACT';
  vendor?: string;
  product?: string;
}

export interface EnrichmentResult {
  source: 'clinicaltrials' | 'fda';
  companyName: string;
  results: any[];
  summary?: string;
}
