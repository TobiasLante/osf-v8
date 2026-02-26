import ivm from 'isolated-vm';
import { SdkCallbacks } from './sdk-runtime';
import { logger } from '../logger';

const MEMORY_LIMIT_MB = 128;

/**
 * Execute user code in an isolated V8 sandbox.
 * The code must export a default async function main(ctx).
 * SDK callbacks (mcp, llm, storage, log) are provided as host function references.
 *
 * For async host functions we use ivm.Reference + applySyncPromise pattern:
 * The isolate calls ref.applySyncPromise() which blocks the isolate until the
 * host promise resolves, then returns the result as a transferable value.
 */
export async function executeSandbox(
  bundledCode: string,
  callbacks: SdkCallbacks,
  timeoutSeconds: number
): Promise<{ result: any; error?: string }> {
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });

  try {
    const context = await isolate.createContext();
    const jail = context.global;

    // Set up global reference
    await jail.set('global', jail.derefInto());

    // Inject async host functions as References
    // The isolate will call these with .applySyncPromise()
    await jail.set('__hostCallMcpTool', new ivm.Reference(
      async (name: string, argsJson: string) => {
        const args = JSON.parse(argsJson);
        return await callbacks.callMcpTool(name, args);
      }
    ));

    await jail.set('__hostCallLlm', new ivm.Reference(
      async (prompt: string) => {
        return await callbacks.callLlm(prompt);
      }
    ));

    await jail.set('__hostCallLlmJson', new ivm.Reference(
      async (prompt: string) => {
        return await callbacks.callLlmJson(prompt);
      }
    ));

    await jail.set('__hostListTools', new ivm.Reference(
      async () => {
        return await callbacks.listTools();
      }
    ));

    await jail.set('__hostStorageGet', new ivm.Reference(
      async (key: string) => {
        const val = await callbacks.storageGet(key);
        return val === null ? '__null__' : val;
      }
    ));

    await jail.set('__hostStorageSet', new ivm.Reference(
      async (key: string, value: string) => {
        await callbacks.storageSet(key, value);
        return 'ok';
      }
    ));

    await jail.set('__hostStorageDelete', new ivm.Reference(
      async (key: string) => {
        await callbacks.storageDelete(key);
        return 'ok';
      }
    ));

    // Sync callback for log (no async needed)
    await jail.set('__hostLog', new ivm.Reference(
      (message: string) => {
        callbacks.log(message);
      }
    ));

    // The SDK wrapper — uses applySyncPromise to call async host functions
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

    // Combine SDK wrapper + user code + invocation
    const fullCode = `
      ${sdkWrapper}

      // User code (bundled)
      const __userModule = {};
      (function(module, exports) {
        ${safeCode}
      })(__userModule, __userModule);

      // Find the default export
      const __mainFn = __userModule.default || __userModule.exports?.default || __userModule.main;
      if (typeof __mainFn !== 'function') {
        throw new Error('Agent must export a default async function main(ctx)');
      }

      // Run the user function synchronously (SDK calls are sync from isolate perspective)
      const __result = __mainFn(ctx);
      __result === undefined ? null : JSON.stringify(__result);
    `;

    const script = await isolate.compileScript(fullCode);
    const resultRef = await script.run(context, {
      timeout: timeoutSeconds * 1000,
    });

    let result = null;
    if (resultRef && typeof resultRef === 'string') {
      try {
        result = JSON.parse(resultRef);
      } catch {
        result = resultRef;
      }
    }

    return { result };
  } catch (err: any) {
    const message = err.message || 'Sandbox execution failed';
    logger.warn({ err: message }, 'Sandbox error');

    if (message.includes('Script execution timed out')) {
      return { result: null, error: `Timeout: Agent exceeded ${timeoutSeconds}s limit` };
    }
    if (message.includes('memory')) {
      return { result: null, error: `Memory limit exceeded (${MEMORY_LIMIT_MB}MB)` };
    }

    return { result: null, error: message };
  } finally {
    isolate.dispose();
  }
}
