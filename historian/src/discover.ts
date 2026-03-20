// Historian v2 — Topic Auto-Discovery
// MQTT sampling + LLM analysis + heuristic fallback

import mqtt from 'mqtt';

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const LLM_URL = process.env.LOCAL_LLM_URL || 'http://localhost:5001';
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'default';

// Prefixes to ignore during discovery
const IGNORE_PREFIXES = ['$SYS', 'homeassistant', 'zigbee2mqtt', 'tasmota'];

export interface DiscoverySuggestion {
  prefix: string;
  subscription: string;
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  confidence: number;
  reasoning: string;
  sample_topics: string[];
  segment_stats: { index: number; unique_count: number; samples: string[] }[];
}

export interface DiscoveryResult {
  duration_s: number;
  total_topics: number;
  suggestions: DiscoverySuggestion[];
  errors: string[];
}

// ─── MQTT Sampling ───────────────────────────────────────────────────────────

async function sampleTopics(durationS: number): Promise<Set<string>> {
  const topics = new Set<string>();
  const maxTopics = 10_000;

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_BROKER, {
      clientId: `osf-discover-${Date.now()}`,
      reconnectPeriod: 0, // No reconnect for sampling
      connectTimeout: 10_000,
      clean: true,
    });

    const timer = setTimeout(() => {
      client.end(true);
      resolve(topics);
    }, durationS * 1000);

    client.on('connect', () => {
      client.subscribe('#', { qos: 0 }, (err) => {
        if (err) {
          clearTimeout(timer);
          client.end(true);
          reject(new Error(`Subscribe failed: ${err.message}`));
        }
      });
    });

    client.on('message', (topic) => {
      if (topics.size >= maxTopics) return;
      // Filter ignored prefixes
      const firstSeg = topic.split('/')[0];
      if (IGNORE_PREFIXES.some(p => firstSeg.startsWith(p))) return;
      topics.add(topic);
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      client.end(true);
      reject(err);
    });
  });
}

// ─── Grouping by Prefix ─────────────────────────────────────────────────────

interface TopicGroup {
  prefix: string;
  topics: string[];
  segmentStats: { index: number; unique_count: number; samples: string[] }[];
}

function groupTopics(topics: Set<string>): TopicGroup[] {
  const groups = new Map<string, string[]>();

  for (const topic of topics) {
    const prefix = topic.split('/')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(topic);
  }

  const result: TopicGroup[] = [];

  for (const [prefix, topicList] of groups) {
    if (topicList.length < 3) continue; // Skip tiny groups

    // Compute segment stats
    const maxSegs = Math.max(...topicList.map(t => t.split('/').length));
    const segmentStats: TopicGroup['segmentStats'] = [];

    for (let i = 0; i < maxSegs; i++) {
      const values = new Set<string>();
      for (const t of topicList) {
        const parts = t.split('/');
        if (i < parts.length) values.add(parts[i]);
      }
      segmentStats.push({
        index: i,
        unique_count: values.size,
        samples: [...values].slice(0, 10),
      });
    }

    result.push({ prefix, topics: topicList, segmentStats });
  }

  return result.sort((a, b) => b.topics.length - a.topics.length);
}

// ─── LLM Analysis ───────────────────────────────────────────────────────────

function buildPrompt(group: TopicGroup): string {
  const sampleTopics = group.topics.slice(0, 20).map(t => `  ${t}`).join('\n');
  const segStats = group.segmentStats.map(s =>
    `  Seg ${s.index}: ${s.unique_count} unique ${JSON.stringify(s.samples.slice(0, 8))}`
  ).join('\n');

  return `Du bist ein ISA-95 / UNS (Unified Namespace) Experte.

Analysiere diese MQTT-Topics aus einem Fertigungsbetrieb.
Bestimme fuer jede Topic-Gruppe welches Segment welche Bedeutung hat.

Topics (Prefix: "${group.prefix}"):
${sampleTopics}

Segment-Statistik:
${segStats}

Antworte NUR als JSON:
{
  "seg_machine": <index oder null>,
  "seg_work_order": <index oder null>,
  "seg_tool_id": <index oder null>,
  "seg_category": <index oder null>,
  "seg_variable_start": <index>,
  "null_marker": "<Platzhalter fuer leere Felder oder null>",
  "confidence": <0.0-1.0>,
  "reasoning": "<kurze Begruendung>"
}`;
}

async function analyzWithLlm(group: TopicGroup): Promise<{
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  confidence: number;
  reasoning: string;
}> {
  const prompt = buildPrompt(group);

  const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) throw new Error(`LLM API returned ${resp.status}`);

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Extract JSON from response (may be wrapped in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in LLM response');

  return JSON.parse(jsonMatch[0]);
}

// ─── Heuristic Fallback ─────────────────────────────────────────────────────

function heuristicAnalysis(group: TopicGroup): {
  seg_machine: number | null;
  seg_work_order: number | null;
  seg_tool_id: number | null;
  seg_category: number | null;
  seg_variable_start: number;
  null_marker: string | null;
  confidence: number;
  reasoning: string;
} {
  const stats = group.segmentStats;
  if (stats.length < 2) {
    return {
      seg_machine: null, seg_work_order: null, seg_tool_id: null,
      seg_category: null, seg_variable_start: 1,
      null_marker: null, confidence: 0.1, reasoning: 'Too few segments for analysis',
    };
  }

  let seg_machine: number | null = null;
  let seg_category: number | null = null;
  let seg_variable_start = stats.length - 1;

  // Skip segment 0 (prefix)
  for (let i = 1; i < stats.length; i++) {
    const u = stats[i].unique_count;
    // Machine: 5-50 unique values near the start
    if (seg_machine === null && u >= 3 && u <= 50 && i <= 3) {
      seg_machine = i;
    }
    // Category: 2-15 unique values, after machine
    else if (seg_category === null && u >= 2 && u <= 15 && i > (seg_machine ?? 0)) {
      seg_category = i;
    }
  }

  // Variable start: after category (or last segment)
  if (seg_category !== null) {
    seg_variable_start = seg_category + 1;
  } else if (seg_machine !== null) {
    seg_variable_start = seg_machine + 1;
  }

  // Detect null marker
  let null_marker: string | null = null;
  for (const s of stats) {
    if (s.samples.includes('---')) { null_marker = '---'; break; }
    if (s.samples.includes('null')) { null_marker = 'null'; break; }
    if (s.samples.includes('_')) { null_marker = '_'; break; }
  }

  return {
    seg_machine,
    seg_work_order: null,
    seg_tool_id: null,
    seg_category,
    seg_variable_start,
    null_marker,
    confidence: 0.3,
    reasoning: 'Heuristic fallback — kein LLM erreichbar',
  };
}

// ─── Main Discovery Function ─────────────────────────────────────────────────

export async function runDiscovery(durationS: number = 30): Promise<DiscoveryResult> {
  const clampedDuration = Math.max(10, Math.min(120, durationS));
  const errors: string[] = [];
  const startTime = Date.now();

  // 1. Sample MQTT topics
  let topics: Set<string>;
  try {
    topics = await sampleTopics(clampedDuration);
  } catch (err: any) {
    return {
      duration_s: (Date.now() - startTime) / 1000,
      total_topics: 0,
      suggestions: [],
      errors: [`MQTT sampling failed: ${err.message}`],
    };
  }

  if (topics.size === 0) {
    return {
      duration_s: (Date.now() - startTime) / 1000,
      total_topics: 0,
      suggestions: [],
      errors: ['No topics received during sampling period'],
    };
  }

  // 2. Group by prefix
  const groups = groupTopics(topics);

  // 3. Analyze each group
  const suggestions: DiscoverySuggestion[] = [];

  for (const group of groups) {
    let analysis;
    try {
      analysis = await analyzWithLlm(group);
    } catch (err: any) {
      errors.push(`LLM analysis failed for "${group.prefix}": ${err.message}`);
      analysis = heuristicAnalysis(group);
    }

    suggestions.push({
      prefix: group.prefix,
      subscription: `${group.prefix}/#`,
      seg_machine: analysis.seg_machine,
      seg_work_order: analysis.seg_work_order,
      seg_tool_id: analysis.seg_tool_id,
      seg_category: analysis.seg_category,
      seg_variable_start: analysis.seg_variable_start,
      null_marker: analysis.null_marker,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      sample_topics: group.topics.slice(0, 10),
      segment_stats: group.segmentStats,
    });
  }

  return {
    duration_s: (Date.now() - startTime) / 1000,
    total_topics: topics.size,
    suggestions: suggestions.sort((a, b) => b.confidence - a.confidence),
    errors,
  };
}
