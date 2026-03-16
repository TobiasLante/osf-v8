const str = (key: string, fallback: string): string => process.env[key] || fallback;
const int = (key: string, fallback: number): number => parseInt(process.env[key] || '', 10) || fallback;

export const config = {
  port: int('PORT', 8035),
  llm: {
    url: str('LLM_URL', 'http://llm:5001'),
    model: str('LLM_MODEL', 'qwen2.5-32b-instruct'),
    maxTokens: int('LLM_MAX_TOKENS', 4096),
    maxRetries: int('LLM_MAX_RETRIES', 3),
    timeoutMs: int('LLM_TIMEOUT_MS', 120_000),
  },
  mcpProxy: {
    url: str('MCP_PROXY_URL', 'http://osf-mcp-proxy:8034'),
  },
  db: {
    host: str('ERP_DB_HOST', 'postgres'),
    port: int('ERP_DB_PORT', 5432),
    name: str('ERP_DB_NAME', 'erpdb'),
    user: str('ERP_DB_USER', 'admin'),
    password: str('ERP_DB_PASSWORD', ''),
    schema: str('DB_SCHEMA', 'llm_test_v3'),
  },
  graph: {
    name: str('GRAPH_NAME', 'factory_graph'),  // legacy AGE ref
  },
  neo4j: {
    url: str('NEO4J_URL', 'bolt://neo4j:7687'),
    user: str('NEO4J_USER', 'neo4j'),
    password: str('NEO4J_PASSWORD', ''),
    database: str('NEO4J_DATABASE', 'neo4j'),
  },
  batchSize: int('BATCH_SIZE', 200),
  chunkSize: int('CHUNK_SIZE', 500),
  smProfileUrl: process.env.SM_PROFILE_URL || '',
  domain: str('DOMAIN', 'manufacturing'),
  domainConfigPath: process.env.DOMAIN_CONFIG_PATH || '',
  i3x: {
    endpoints: (process.env.I3X_ENDPOINTS || '').split(',').filter(Boolean),
  },
  mtp: {
    urls: (process.env.MTP_URLS || '').split(',').filter(Boolean),
  },
  embedding: {
    url: str('EMBEDDING_URL', 'http://llm:5002'),  // llama.cpp 14B — /v1/embeddings
    model: str('EMBEDDING_MODEL', 'nomic-embed-text'),
    dim: int('EMBEDDING_DIM', 384),
  },
  chart: {
    llmModel: str('CHART_LLM_MODEL', ''),
  },
  mqtt: {
    rawUrl: str('MQTT_RAW_URL', 'mqtt://mqtt-raw:1883'),
    curatedUrl: str('MQTT_CURATED_URL', 'mqtt://mqtt-curated:1883'),
    transformRules: parseTransformRules(process.env.MQTT_TRANSFORM_RULES || ''),
  },
};

function parseTransformRules(raw: string): Array<{
  topicPattern: string;
  validation: { min?: number; max?: number; requiredFields?: string[] };
  enrichment: { kgLookup?: boolean; addTimestamp?: boolean; addEmbedding?: boolean };
  republishTopic: string;
}> {
  if (!raw) {
    return [
      {
        topicPattern: 'Factory/#',
        validation: { requiredFields: [] },
        enrichment: { addTimestamp: true, kgLookup: false, addEmbedding: false },
        republishTopic: 'curated/Factory/#',
      },
    ];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
