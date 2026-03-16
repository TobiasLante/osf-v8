import { callLlm, callLlmJson, ChatMessage } from '../shared/llm-client';
import { cypherQuery } from '../shared/cypher-utils';
import { semanticSearch } from '../shared/vector-store';
import { generateEmbedding } from '../shared/embedding-service';
import { SchemaProposal } from '../shared/types';
import { config } from '../shared/config';
import { logger } from '../shared/logger';

/**
 * Chart Engine — LLM-powered chart generation from Knowledge Graph data.
 * Flow: natural language → Cypher query → data → chart config (recharts JSON)
 */

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  title: string;
  xAxis: string;
  yAxis: string;
  data: Record<string, any>[];
  colors?: string[];
  stacked?: boolean;
}

export interface ChartResult {
  question: string;
  cypher: string;
  rawData: any[];
  chart: ChartConfig;
  semanticContext?: string[];
}

/**
 * Generate a chart from a natural language question.
 */
export async function generateChart(
  question: string,
  schema: SchemaProposal,
): Promise<ChartResult> {
  // Step 0: Semantic boost
  let semanticContext: string[] = [];
  try {
    const queryEmb = await generateEmbedding(question);
    const similar = await semanticSearch(queryEmb, 5, 0.4);
    semanticContext = similar.map(s => `${s.node_label}:${s.node_id} (${s.text_content})`);
  } catch (e: any) {
    logger.debug({ err: e.message }, 'Semantic boost unavailable, continuing without');
  }

  // Step 1: LLM generates Cypher query
  const cypher = await generateCypherForChart(question, schema, semanticContext);

  // Step 2: Execute Cypher
  let rawData: any[];
  try {
    rawData = await cypherQuery(cypher);
  } catch (e: any) {
    logger.warn({ cypher, err: e.message }, 'Chart Cypher query failed');
    throw new Error(`Cypher query failed: ${e.message}\nQuery: ${cypher}`);
  }

  if (rawData.length === 0) {
    throw new Error('Query returned no data — cannot generate chart');
  }

  // Step 3: LLM generates chart config
  const chart = await generateChartConfig(question, rawData);

  return { question, cypher, rawData, chart, semanticContext };
}

async function generateCypherForChart(
  question: string,
  schema: SchemaProposal,
  semanticContext: string[],
): Promise<string> {
  const schemaDesc = schema.nodeTypes
    .map(n => `${n.label}(${n.properties.map(p => `${p.name}:${p.type}`).join(', ')})`)
    .join('\n  ');
  const edgeDesc = schema.edgeTypes
    .map(e => `(${e.fromType})-[${e.label}]->(${e.toType})`)
    .join('\n  ');

  const contextHint = semanticContext.length > 0
    ? `\nRelevante Nodes (semantisch gefunden): ${semanticContext.join('; ')}`
    : '';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a Neo4j Cypher expert. Generate a single Cypher query that returns data for chart visualization.

Graph Schema:
  Nodes: ${schemaDesc}
  Edges: ${edgeDesc}
${contextHint}

Rules:
- Return ONLY the Cypher query, no markdown, no explanation
- Use RETURN with explicit property access (e.g. n.name, n.oee)
- Alias return values meaningfully (AS machine, AS value, etc.)
- For aggregations use count(), avg(), sum() etc.
- Limit to max 50 results`,
    },
    { role: 'user', content: question },
  ];

  const model = config.chart.llmModel || undefined;
  const raw = await callLlm(messages, { maxTokens: 500, model });
  const cypher = raw.trim().replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

  // Guard: only allow read-only Cypher
  const upper = cypher.toUpperCase();
  if (['DELETE', 'REMOVE', 'CREATE', 'DROP', 'SET '].some(kw => upper.includes(kw) && !upper.includes('OFFSET'))) {
    throw new Error(`Chart Cypher query contains write operation — blocked: ${cypher.substring(0, 100)}`);
  }

  return cypher;
}

async function generateChartConfig(
  question: string,
  data: any[],
): Promise<ChartConfig> {
  const sampleData = JSON.stringify(data.slice(0, 10), null, 2);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a data visualization expert. Generate a recharts-compatible chart configuration as JSON.

Output format (JSON only):
{
  "type": "bar|line|pie|area|scatter",
  "title": "Chart Title",
  "xAxis": "key_name_for_x",
  "yAxis": "key_name_for_y",
  "data": [{"x_key": "value", "y_key": 42}, ...],
  "colors": ["#hex1", "#hex2"],
  "stacked": false
}

Rules:
- Choose the appropriate chart type based on the data
- data must contain actual values from the query results
- Use sensible colors (not too bright)
- Title should answer the question`,
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nQuery results:\n${sampleData}`,
    },
  ];

  const chart = await callLlmJson<ChartConfig>(messages);

  const validTypes = ['bar', 'line', 'pie', 'area', 'scatter'];
  if (!chart.type || !validTypes.includes(chart.type) || !chart.data || !Array.isArray(chart.data)) {
    throw new Error(`LLM generated invalid chart config (type: ${chart.type})`);
  }

  if (!chart.colors || chart.colors.length === 0) {
    chart.colors = ['#d03a8c', '#7b2d85', '#4a90d9', '#2ecc71', '#e67e22', '#e74c3c'];
  }

  return chart;
}
