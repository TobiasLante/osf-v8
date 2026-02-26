/**
 * Gateway Bridge — Singleton providing access to gateway services
 * from Node-RED node runtime handlers.
 *
 * Two modes:
 * - Direct mode: Initialized by gateway (src/nodered/init.ts) with JS function refs.
 *   Used when NR runs embedded in the gateway process.
 * - HTTP mode: Initialized by NR pod (server.js) with gateway URL.
 *   Used when NR runs in a separate pod and calls gateway via HTTP.
 */

let _services = null;
let _editorUserId = null;
let _httpMode = false;
let _gatewayUrl = null;
let _podSecret = null;

/**
 * Create a local executeSandbox function using isolated-vm.
 * This runs in the NR pod; callbacks proxy to gateway via HTTP bridge.
 */
function createLocalSandbox() {
  let ivm;
  try {
    ivm = require('isolated-vm');
  } catch {
    // isolated-vm not available — return a stub that reports the error
    return async function executeSandbox() {
      return { result: null, error: 'isolated-vm not available in this pod' };
    };
  }

  const MEMORY_LIMIT_MB = 128;

  return async function executeSandbox(bundledCode, callbacks, timeoutSeconds) {
    const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set('global', jail.derefInto());

      // Inject async host functions as References
      await jail.set('__hostCallMcpTool', new ivm.Reference(
        async (name, argsJson) => {
          const args = JSON.parse(argsJson);
          return await callbacks.callMcpTool(name, args);
        }
      ));
      await jail.set('__hostCallLlm', new ivm.Reference(
        async (prompt) => await callbacks.callLlm(prompt)
      ));
      await jail.set('__hostCallLlmJson', new ivm.Reference(
        async (prompt) => await callbacks.callLlmJson(prompt)
      ));
      await jail.set('__hostListTools', new ivm.Reference(
        async () => await callbacks.listTools()
      ));
      await jail.set('__hostStorageGet', new ivm.Reference(
        async (key) => {
          const val = await callbacks.storageGet(key);
          return val === null ? '__null__' : val;
        }
      ));
      await jail.set('__hostStorageSet', new ivm.Reference(
        async (key, value) => { await callbacks.storageSet(key, value); return 'ok'; }
      ));
      await jail.set('__hostStorageDelete', new ivm.Reference(
        async (key) => { await callbacks.storageDelete(key); return 'ok'; }
      ));
      await jail.set('__hostLog', new ivm.Reference(
        (message) => { callbacks.log(message); }
      ));

      const sdkWrapper = `
        const ctx = {
          mcp: {
            call(name, args) {
              const result = __hostCallMcpTool.applySyncPromise(undefined, [name, JSON.stringify(args || {})]);
              try { return JSON.parse(result); } catch { return result; }
            },
            listTools() {
              const result = __hostListTools.applySyncPromise(undefined, []);
              return JSON.parse(result);
            }
          },
          llm: {
            chat(prompt) {
              return __hostCallLlm.applySyncPromise(undefined, [String(prompt)]);
            },
            chatJson(prompt) {
              const raw = __hostCallLlmJson.applySyncPromise(undefined, [String(prompt)]);
              try { return JSON.parse(raw); } catch { return raw; }
            }
          },
          storage: {
            get(key) {
              const val = __hostStorageGet.applySyncPromise(undefined, [String(key)]);
              if (val === '__null__') return null;
              try { return JSON.parse(val); } catch { return val; }
            },
            set(key, value) {
              __hostStorageSet.applySyncPromise(undefined, [String(key), JSON.stringify(value)]);
            },
            delete(key) {
              __hostStorageDelete.applySyncPromise(undefined, [String(key)]);
            }
          },
          log(message) {
            __hostLog.applySync(undefined, [String(message)]);
          }
        };
      `;

      // Transform ES module syntax to CJS (isolated-vm runs in Script mode, not Module)
      const safeCode = bundledCode.replace(/^export\s+default\s+/m, 'module.exports.default = ');

      const fullCode = `
        ${sdkWrapper}
        const __userModule = { exports: {} };
        (function(module, exports) {
          ${safeCode}
        })(__userModule, __userModule.exports);
        const __mainFn = __userModule.exports.default || __userModule.default || __userModule.exports.main || __userModule.main;
        if (typeof __mainFn !== 'function') {
          throw new Error('Agent must export a default async function main(ctx)');
        }
        const __result = __mainFn(ctx);
        __result === undefined ? null : JSON.stringify(__result);
      `;

      const script = await isolate.compileScript(fullCode);
      const resultRef = await script.run(context, { timeout: timeoutSeconds * 1000 });

      let result = null;
      if (resultRef && typeof resultRef === 'string') {
        try { result = JSON.parse(resultRef); } catch { result = resultRef; }
      }
      return { result };
    } catch (err) {
      const message = err.message || 'Sandbox execution failed';
      if (message.includes('Script execution timed out')) {
        return { result: null, error: `Timeout: exceeded ${timeoutSeconds}s limit` };
      }
      if (message.includes('memory')) {
        return { result: null, error: `Memory limit exceeded (${MEMORY_LIMIT_MB}MB)` };
      }
      return { result: null, error: message };
    } finally {
      isolate.dispose();
    }
  };
}

/**
 * Make an HTTP call to the gateway internal API.
 * @param {string} path - e.g. '/internal/llm'
 * @param {object} options - fetch options
 * @returns {Promise<any>}
 */
async function gatewayFetch(path, options = {}) {
  const url = `${_gatewayUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-NR-Pod-Secret': _podSecret,
    ...(options.headers || {}),
  };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Gateway ${options.method || 'GET'} ${path} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

module.exports = {
  /**
   * Direct mode: Initialize with gateway services. Called once at startup.
   * @param {object} services
   * @param {function} services.callLlm - (messages, tools, config) => Promise<{content, tool_calls}>
   * @param {function} services.getLlmConfig - (userId, tier) => Promise<LlmConfig>
   * @param {function} services.callMcpTool - (name, args) => Promise<string>
   * @param {function} services.getMcpTools - () => Promise<tools[]>
   * @param {function} services.executeSandbox - (code, callbacks, timeout) => Promise<{result, error}>
   * @param {object}   services.pool - pg Pool instance
   * @param {object}   services.logger - pino logger
   */
  init(services) {
    _services = services;
    _httpMode = false;
  },

  /**
   * HTTP mode: Initialize with gateway URL for cross-pod communication.
   * Called by NR pod server.js after pod assignment.
   * @param {string} gatewayUrl - e.g. 'http://osf-gateway:8080'
   * @param {string} userId - assigned user UUID
   * @param {string} podSecret - shared secret for auth
   */
  initHttp(gatewayUrl, userId, podSecret) {
    _gatewayUrl = gatewayUrl;
    _editorUserId = userId;
    _podSecret = podSecret || process.env.NR_POD_SECRET;
    _httpMode = true;

    _services = {
      callLlm: async (messages, tools, config) => {
        return gatewayFetch('/internal/llm', {
          method: 'POST',
          body: JSON.stringify({ messages, tools, config, userId: _editorUserId }),
        });
      },

      getLlmConfig: async (uid, tier) => {
        return gatewayFetch(`/internal/llm-config?userId=${encodeURIComponent(uid)}&tier=${encodeURIComponent(tier)}`);
      },

      callMcpTool: async (name, args) => {
        const data = await gatewayFetch('/internal/mcp-tool', {
          method: 'POST',
          body: JSON.stringify({ name, args, userId: _editorUserId }),
        });
        return data.result;
      },

      getMcpTools: async () => {
        const data = await gatewayFetch('/internal/mcp-tools');
        return data.tools;
      },

      // Specific DB queries via dedicated endpoints (no generic SQL proxy)
      pool: {
        query: async (sql, params) => {
          // Route agent lookups
          const agentMatch = sql.match(/SELECT.*FROM\s+agents\s+WHERE\s+id\s*=/i);
          if (agentMatch && params && params[0]) {
            const agent = await gatewayFetch(`/internal/agents/${encodeURIComponent(params[0])}`);
            return { rows: agent ? [agent] : [], rowCount: agent ? 1 : 0 };
          }
          // Route storage SELECT
          const storageGet = sql.match(/SELECT.*FROM\s+code_agent_storage\s+WHERE/i);
          if (storageGet && params && params.length >= 3) {
            const data = await gatewayFetch(`/internal/storage?agentId=${encodeURIComponent(params[0])}&userId=${encodeURIComponent(params[1])}&key=${encodeURIComponent(params[2])}`);
            return { rows: data.value != null ? [{ value: data.value }] : [], rowCount: data.value != null ? 1 : 0 };
          }
          // Route storage INSERT/UPSERT
          const storageSet = sql.match(/INSERT\s+INTO\s+code_agent_storage/i);
          if (storageSet && params && params.length >= 4) {
            await gatewayFetch('/internal/storage', {
              method: 'POST',
              body: JSON.stringify({ agentId: params[0], userId: params[1], key: params[2], value: params[3] }),
            });
            return { rows: [], rowCount: 1 };
          }
          // Route storage DELETE
          const storageDel = sql.match(/DELETE\s+FROM\s+code_agent_storage/i);
          if (storageDel && params && params.length >= 3) {
            await gatewayFetch(`/internal/storage?agentId=${encodeURIComponent(params[0])}&userId=${encodeURIComponent(params[1])}&key=${encodeURIComponent(params[2])}`, {
              method: 'DELETE',
            });
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`[Bridge HTTP] Unsupported query in HTTP mode: ${sql.substring(0, 80)}`);
        },
      },

      // Sandbox runs locally in the NR pod using isolated-vm.
      // Callbacks go through bridge HTTP services above.
      executeSandbox: createLocalSandbox(),

      logger: console,
    };
  },

  /** Set the current editor user (called when user loads editor) */
  setEditorUserId(userId) {
    _editorUserId = userId;
  },

  /** Get the current editor userId (real UUID from auth) */
  get editorUserId() {
    return _editorUserId;
  },

  /** @returns {object|null} Gateway services or null if not initialized */
  get services() {
    return _services;
  },

  /** @returns {boolean} Whether the bridge has been initialized */
  get ready() {
    return _services !== null;
  },

  /** @returns {boolean} Whether running in HTTP mode (separate NR pod) */
  get isHttpMode() {
    return _httpMode;
  },
};
