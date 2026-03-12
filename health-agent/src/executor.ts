// Health Agent — Tool executor (shell commands)

import { execSync } from 'child_process';

const MAX_OUTPUT = 4000;
const EXEC_TIMEOUT = 30_000;
const EXEC_MAX_BUFFER = 100_000;

// DB connection strings for psql
const DB_MAP: Record<string, { host: string; port: number; user: string; password: string }> = {
  erpdb: {
    host: process.env.ERP_DB_HOST || '192.168.178.150',
    port: parseInt(process.env.ERP_DB_PORT || '30431'),
    user: process.env.ERP_DB_USER || 'admin',
    password: process.env.ERP_DB_PASSWORD || '',
  },
  bigdata_homelab: {
    host: process.env.FACTORY_DB_HOST || '192.168.178.150',
    port: parseInt(process.env.FACTORY_DB_PORT || '30432'),
    user: process.env.FACTORY_DB_USER || 'admin',
    password: process.env.FACTORY_DB_PASSWORD || '',
  },
  qmsdb: {
    host: process.env.QMS_DB_HOST || '192.168.178.150',
    port: parseInt(process.env.QMS_DB_PORT || '30433'),
    user: process.env.QMS_DB_USER || 'admin',
    password: process.env.QMS_DB_PASSWORD || '',
  },
  osf: {
    host: process.env.DB_HOST || 'osf-postgres.osf.svc.cluster.local',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'osf',
    password: process.env.DB_PASSWORD || '',
  },
};

const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://192.168.178.150:31883';

// URL whitelist for http_get
function isAllowedUrl(url: string): boolean {
  return (
    url.startsWith('http://192.168.') ||
    url.startsWith('http://factory-') ||
    url.startsWith('http://osf-') ||
    url.startsWith('http://redis') ||
    url.startsWith('http://cloudflared') ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://osf-api.zeroguess.ai')
  );
}

// Sanitize shell args — only allow alphanumeric, dash, underscore, dot, slash, colon, space
function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9\-_./:= @*#,()]/g, '');
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  return output.slice(0, MAX_OUTPUT) + `\n... (truncated, ${output.length} chars total)`;
}

function runCmd(cmd: string): string {
  try {
    const result = execSync(cmd, {
      timeout: EXEC_TIMEOUT,
      maxBuffer: EXEC_MAX_BUFFER,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return truncate(result);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    return truncate(`ERROR: ${err.message}\n${stderr}\n${stdout}`.trim());
  }
}

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  autoFix: boolean
): string {
  switch (name) {
    // ─── K8s ──────────────────────────────────────────
    case 'kubectl_get_pods':
      return runCmd('kubectl get pods -A -o wide --no-headers');

    case 'kubectl_get_pod_logs': {
      const pod = sanitize(String(args.pod || ''));
      const ns = sanitize(String(args.namespace || ''));
      if (!pod || !ns) return 'ERROR: pod and namespace required';
      return runCmd(`kubectl logs ${pod} -n ${ns} --tail=50`);
    }

    case 'kubectl_describe_pod': {
      const pod = sanitize(String(args.pod || ''));
      const ns = sanitize(String(args.namespace || ''));
      if (!pod || !ns) return 'ERROR: pod and namespace required';
      return runCmd(`kubectl describe pod ${pod} -n ${ns}`);
    }

    case 'kubectl_restart_deployment': {
      if (!autoFix) return 'BLOCKED: --auto-fix not enabled. Report only.';
      const dep = sanitize(String(args.deployment || ''));
      const ns = sanitize(String(args.namespace || ''));
      if (!dep || !ns) return 'ERROR: deployment and namespace required';
      return runCmd(`kubectl rollout restart deployment/${dep} -n ${ns}`);
    }

    // ─── Database ─────────────────────────────────────
    case 'psql_query': {
      const dbName = String(args.database || '');
      const query = String(args.query || '');
      const db = DB_MAP[dbName];
      if (!db) return `ERROR: unknown database "${dbName}". Use: ${Object.keys(DB_MAP).join(', ')}`;
      // Only allow SELECT (and WITH ... SELECT)
      const normalized = query.trim().toUpperCase();
      if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH') && !normalized.startsWith('EXPLAIN')) {
        return 'ERROR: only SELECT/WITH/EXPLAIN queries allowed (read-only)';
      }
      const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
      for (const kw of forbidden) {
        // Check for keyword as whole word (not inside identifiers)
        if (new RegExp(`\\b${kw}\\b`, 'i').test(query)) {
          return `ERROR: ${kw} not allowed (read-only)`;
        }
      }
      const connStr = `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/${dbName}`;
      // Use psql with connection string, set statement_timeout
      return runCmd(`psql "${connStr}" -c "SET statement_timeout = '10s'; ${query.replace(/"/g, '\\"')}" --no-psqlrc -P pager=off`);
    }

    case 'psql_stat_activity': {
      const db = DB_MAP.osf;
      const connStr = `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/osf`;
      const q = `SELECT pid, datname, usename, state, wait_event_type, query_start, LEFT(query, 100) as query FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start`;
      return runCmd(`psql "${connStr}" -c "${q}" --no-psqlrc -P pager=off`);
    }

    case 'psql_kill_query': {
      if (!autoFix) return 'BLOCKED: --auto-fix not enabled. Report only.';
      const pid = Number(args.pid);
      if (!pid || pid < 1) return 'ERROR: valid PID required';
      const db = DB_MAP.osf;
      const connStr = `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/osf`;
      return runCmd(`psql "${connStr}" -c "SELECT pg_terminate_backend(${pid})" --no-psqlrc`);
    }

    // ─── HTTP ─────────────────────────────────────────
    case 'http_get': {
      const url = String(args.url || '');
      if (!isAllowedUrl(url)) return `ERROR: URL not whitelisted. Must start with http://192.168., http://factory-, http://osf-, or https://osf-api.zeroguess.ai`;
      return runCmd(`curl -sS --max-time 10 "${sanitize(url)}"`);
    }

    case 'mcp_tools_list': {
      const url = String(args.url || '');
      if (!isAllowedUrl(url)) return 'ERROR: URL not whitelisted';
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
      return runCmd(`curl -sS --max-time 10 -X POST -H "Content-Type: application/json" -d '${body}' "${sanitize(url)}"`);
    }

    // ─── MQTT ─────────────────────────────────────────
    case 'mqtt_check': {
      // Parse broker URL: mqtt://host:port -> host port
      const match = MQTT_BROKER.match(/mqtt:\/\/([^:]+):(\d+)/);
      const host = match?.[1] || '192.168.178.150';
      const port = match?.[2] || '31883';
      // Subscribe for 10s, count messages
      return runCmd(
        `timeout 10 mosquitto_sub -h ${host} -p ${port} -t "Factory/#" -v 2>/dev/null | wc -l || echo "0 messages (broker may be down)"`
      );
    }

    // ─── System ───────────────────────────────────────
    case 'check_disk_usage':
      return runCmd('df -h');

    case 'check_memory':
      return runCmd('free -m');

    default:
      return `ERROR: unknown tool "${name}"`;
  }
}
