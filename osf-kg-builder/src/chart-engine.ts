import { callLlm, callLlmJson, ChatMessage } from './llm-client';
import { cypherQuery } from './cypher-utils';
import { semanticSearch } from './vector-store';
import { generateEmbedding } from './embedding-service';
import { SchemaProposal } from './schema-planner';
import { config } from './config';
import { logger } from './logger';

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
  // Step 0: Semantic boost — find relevant nodes via embeddings
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

/**
 * Step 1: Generate Cypher query from question + schema.
 */
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
      content: `Du bist ein Apache AGE Cypher-Experte. Generiere einen einzelnen Cypher-Query der Daten fuer eine Chart-Visualisierung liefert.

Graph Schema:
  Nodes: ${schemaDesc}
  Edges: ${edgeDesc}
${contextHint}

Regeln:
- Gib NUR den Cypher-Query zurueck, kein Markdown, keine Erklaerung
- Verwende RETURN mit explizitem Property-Zugriff (z.B. n.name, n.oee)
- Aliase die Return-Werte sinnvoll (AS machine, AS value, etc.)
- Bei Aggregationen verwende count(), avg(), sum() etc.
- Limitiere auf max 50 Ergebnisse`,
    },
    { role: 'user', content: question },
  ];

  const model = config.chart.llmModel || undefined;
  const raw = await callLlm(messages, { maxTokens: 500, model });
  const cypher = raw.trim().replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

  // Guard: only allow read-only Cypher (MATCH/RETURN)
  const upper = cypher.toUpperCase();
  if (['DELETE', 'REMOVE', 'CREATE', 'DROP', 'SET '].some(kw => upper.includes(kw) && !upper.includes('OFFSET'))) {
    throw new Error(`Chart Cypher query contains write operation — blocked: ${cypher.substring(0, 100)}`);
  }

  return cypher;
}

/**
 * Step 3: Generate recharts-compatible chart config from data.
 */
async function generateChartConfig(
  question: string,
  data: any[],
): Promise<ChartConfig> {
  const sampleData = JSON.stringify(data.slice(0, 10), null, 2);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Du bist ein Datenvisualisierungs-Experte. Generiere eine recharts-kompatible Chart-Konfiguration als JSON.

Ausgabe-Format (NUR JSON):
{
  "type": "bar|line|pie|area|scatter",
  "title": "Chart Titel",
  "xAxis": "key_name_for_x",
  "yAxis": "key_name_for_y",
  "data": [{"x_key": "value", "y_key": 42}, ...],
  "colors": ["#hex1", "#hex2"],
  "stacked": false
}

Regeln:
- Waehle den passenden Chart-Typ basierend auf den Daten
- data muss die tatsaechlichen Werte aus den Query-Ergebnissen enthalten
- Verwende sinnvolle Farben (nicht zu grell)
- Titel sollte die Frage beantworten`,
    },
    {
      role: 'user',
      content: `Frage: ${question}\n\nQuery-Ergebnisse:\n${sampleData}`,
    },
  ];

  const chart = await callLlmJson<ChartConfig>(messages);

  // Validate minimum fields
  const validTypes = ['bar', 'line', 'pie', 'area', 'scatter'];
  if (!chart.type || !validTypes.includes(chart.type) || !chart.data || !Array.isArray(chart.data)) {
    throw new Error(`LLM generated invalid chart config (type: ${chart.type})`);
  }

  // Default colors if missing
  if (!chart.colors || chart.colors.length === 0) {
    chart.colors = ['#d03a8c', '#7b2d85', '#4a90d9', '#2ecc71', '#e67e22', '#e74c3c'];
  }

  return chart;
}
