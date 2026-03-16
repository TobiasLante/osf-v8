const str = (key: string, fallback: string): string => process.env[key] || fallback;
const int = (key: string, fallback: number): number => parseInt(process.env[key] || '', 10) || fallback;

export const config = {
  port: int('PORT', 8035),
  llm: {
    url: str('LLM_URL', 'http://192.168.178.120:5001'),
    model: str('LLM_MODEL', 'qwen2.5-32b-instruct'),
    maxTokens: int('LLM_MAX_TOKENS', 4096),
    maxRetries: int('LLM_MAX_RETRIES', 3),
    timeoutMs: int('LLM_TIMEOUT_MS', 120_000),
  },
  mcpProxy: {
    url: str('MCP_PROXY_URL', 'http://osf-mcp-proxy:8034'),
  },
  db: {
    host: str('ERP_DB_HOST', '192.168.178.150'),
    port: int('ERP_DB_PORT', 30432),
    name: str('ERP_DB_NAME', 'erpdb'),
    user: str('ERP_DB_USER', 'admin'),
    password: str('ERP_DB_PASSWORD', 'Kohlgrub.123'),
    schema: str('DB_SCHEMA', 'llm_test_v3'),
  },
  graph: {
    name: str('GRAPH_NAME', 'factory_graph'),
  },
  batchSize: int('BATCH_SIZE', 200),
  chunkSize: int('CHUNK_SIZE', 500),
  smProfileUrl: process.env.SM_PROFILE_URL || '',
  domain: str('DOMAIN', 'manufacturing'),  // manufacturing, pharma, chemical, medtech
  domainConfigPath: process.env.DOMAIN_CONFIG_PATH || '',  // optional custom JSON
  i3x: {
    endpoints: (process.env.I3X_ENDPOINTS || '').split(',').filter(Boolean),
    // e.g. ['https://customer-smip.cesmii.net/v0']
  },
  mtp: {
    urls: (process.env.MTP_URLS || '').split(',').filter(Boolean),
    // e.g. ['https://example.com/reaktor.aml', '/data/filter.aml']
  },
};
