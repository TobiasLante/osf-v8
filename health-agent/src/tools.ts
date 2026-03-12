// Health Agent — Tool definitions (OpenAI function calling schema)

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const k8sTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'kubectl_get_pods',
      description: 'List all pods across all namespaces with status, restarts, node, and age.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kubectl_get_pod_logs',
      description: 'Get the last 50 lines of logs from a specific pod.',
      parameters: {
        type: 'object',
        properties: {
          pod: { type: 'string', description: 'Pod name' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['pod', 'namespace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kubectl_describe_pod',
      description: 'Describe a pod to see events, conditions, container statuses.',
      parameters: {
        type: 'object',
        properties: {
          pod: { type: 'string', description: 'Pod name' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['pod', 'namespace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kubectl_restart_deployment',
      description: 'Rollout restart a deployment. Only works when --auto-fix is enabled.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string', description: 'Deployment name' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['deployment', 'namespace'],
      },
    },
  },
];

const dbTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'psql_query',
      description: 'Execute a read-only SQL query (SELECT only) against a database.',
      parameters: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            enum: ['erpdb', 'bigdata_homelab', 'qmsdb', 'osf'],
            description: 'Target database',
          },
          query: { type: 'string', description: 'SQL SELECT query' },
        },
        required: ['database', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'psql_stat_activity',
      description: 'Show active PostgreSQL connections and running queries across all databases.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'psql_kill_query',
      description: 'Terminate a stuck PostgreSQL backend by PID. Only works when --auto-fix is enabled.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Backend PID to terminate' },
        },
        required: ['pid'],
      },
    },
  },
];

const httpTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'http_get',
      description: 'HTTP GET request to an internal URL (10s timeout). Only whitelisted internal URLs allowed.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to GET (must be internal)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_tools_list',
      description: 'List available MCP tools from a server (POST tools/list).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'MCP server base URL' },
        },
        required: ['url'],
      },
    },
  },
];

const mqttTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'mqtt_check',
      description: 'Subscribe to Factory/# for 10 seconds and count incoming MQTT messages.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const systemTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'check_disk_usage',
      description: 'Show disk usage (df -h) for all mounted filesystems.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_memory',
      description: 'Show memory usage (free -m) including buffers and swap.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export function getAllTools(): ToolDef[] {
  return [...k8sTools, ...dbTools, ...httpTools, ...mqttTools, ...systemTools];
}
