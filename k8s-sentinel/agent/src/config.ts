export const config: {
  port: number;
  checkIntervalMs: number;
  remediationMode: 'auto' | 'hitl' | 'readonly';
  k8s: { kubeconfigPath: string; context: string };
  db: { host: string; port: number; database: string; user: string; password: string };
  llm: { url: string; model: string };
} = {
  port: parseInt(process.env.PORT || '8080'),
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '60000'),
  remediationMode: (process.env.REMEDIATION_MODE || 'readonly') as 'auto' | 'hitl' | 'readonly',

  k8s: {
    kubeconfigPath: process.env.KUBECONFIG_PATH || '/root/.kube/config',
    context: process.env.K8S_CONTEXT || 'microk8s',
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'sentinel',
    user: process.env.DB_USER || 'sentinel',
    password: process.env.DB_PASSWORD || 'sentinel123',
  },

  llm: {
    url: process.env.LLM_URL || 'http://192.168.178.120:5001',
    model: process.env.LLM_MODEL || 'qwen2.5-32b-instruct',
  },
};
