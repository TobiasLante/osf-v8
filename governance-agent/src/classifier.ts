/**
 * LLM-based tool classifier for factory governance.
 * Sends tool name + description to LLM, gets back category + sensitivity.
 */

const logger = {
  info: (...args: any[]) => console.log(new Date().toISOString(), 'INFO', ...args),
  warn: (...args: any[]) => console.warn(new Date().toISOString(), 'WARN', ...args),
  error: (...args: any[]) => console.error(new Date().toISOString(), 'ERROR', ...args),
};

const LLM_URL = process.env.LLM_URL || process.env.LLM_URL_FREE || 'http://localhost:5002';
const LLM_MODEL = process.env.LLM_MODEL || process.env.LLM_MODEL_FREE || 'qwen2.5-14b-instruct';

const CATEGORIES = [
  'production', 'materials', 'mrp', 'procurement', 'quality',
  'maintenance', 'tms', 'customer', 'energy', 'assembly',
  'subcontracting', 'kg_analytics', 'historian', 'kg_sensors',
  'sgm', 'actions',
] as const;

const SENSITIVITIES = ['low', 'medium', 'high', 'critical'] as const;

export type Category = typeof CATEGORIES[number];
export type Sensitivity = typeof SENSITIVITIES[number];

export interface ClassificationResult {
  category: Category;
  sensitivity: Sensitivity;
}

export interface ToolInput {
  name: string;
  description: string;
}

const SYSTEM_PROMPT = `Du bist ein Klassifizierungs-Agent fuer Fabrik-Software-Tools.

Gegeben: Tool-Name und Beschreibung.
Aufgabe: Ordne das Tool einer Kategorie zu und bewerte die Datensensitivitaet.

Kategorien:
- production: Kapazitaet, OEE, Maschinenauslastung, Auftraege
- materials: Lagerbestand, Materialverfuegbarkeit
- mrp: Disposition, Engpaesse, Bedarfsplanung
- procurement: Einkauf, Lieferanten, Preise, Bestellungen
- quality: SPC, Kalibrierung, Cpk, Qualitaetsmeldungen
- maintenance: Wartung, MTBF, Stillstaende
- tms: Werkzeugverwaltung, Verschleiss
- customer: Kundenauftraege, Liefertreue, Umsatz
- energy: Energieverbrauch, Kosten
- assembly: Montage, Vormontage, Prueffeld
- subcontracting: Fremdbearbeitung
- kg_analytics: Knowledge-Graph Analysen, Impact, Risk
- historian: Zeitreihen, Trends, Anomalien
- kg_sensors: Sensordaten, Maschinenentdeckung
- sgm: Spritzguss-Prozessdaten
- actions: Schreibende Operationen (replace, create, update, delete)

Sensitivitaet:
- low: Oeffentliche Produktionsdaten
- medium: Interne Planungsdaten
- high: Finanzen, Preise, Lieferantenbewertungen
- critical: Schreibzugriffe, Personalien

Antwort als JSON: { "category": "...", "sensitivity": "..." }`;

async function callLlm(userPrompt: string): Promise<string> {
  const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 100,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`LLM returned ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

function parseClassification(raw: string): ClassificationResult {
  // Extract JSON from potential markdown wrapping
  const jsonMatch = raw.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in LLM response: ${raw}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'production';
  const sensitivity = SENSITIVITIES.includes(parsed.sensitivity) ? parsed.sensitivity : 'low';

  return { category, sensitivity };
}

export async function classifyTool(tool: ToolInput): Promise<ClassificationResult> {
  const prompt = `Tool-Name: ${tool.name}\nBeschreibung: ${tool.description || 'Keine Beschreibung'}`;
  const raw = await callLlm(prompt);
  return parseClassification(raw);
}

export async function classifyBatch(tools: ToolInput[]): Promise<ClassificationResult[]> {
  // Classify tools in parallel batches of 5 to avoid overwhelming LLM
  const results: ClassificationResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < tools.length; i += batchSize) {
    const batch = tools.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(tool => classifyTool(tool))
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        // Fallback: unknown tool gets production/low
        logger.error(`Classification failed: ${r.reason}`);
        results.push({ category: 'production', sensitivity: 'low' });
      }
    }
  }

  return results;
}
