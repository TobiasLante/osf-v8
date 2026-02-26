import { NodeExecutor, tryParseJson, msgToOutput } from './types';

/**
 * Executor for native Node-RED 'change' node.
 * Supports set, change (replace), delete, and move operations on the msg object.
 */
export const executeNativeChange: NodeExecutor = async (input) => {
  const rules: Array<{ t: string; p: string; pt?: string; to?: any; tot?: string; from?: any; fromt?: string }> =
    input.config.rules || [];

  // Use upstream msg if available
  const msg: any = input.msg
    ? { ...input.msg }
    : { payload: tryParseJson(input.previousOutput) };

  function setNested(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  function getNested(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[p];
    }
    return current;
  }

  function deleteNested(obj: any, path: string): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) return;
      current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
  }

  function resolveValue(val: any, valType?: string): any {
    if (valType === 'num') return Number(val);
    if (valType === 'bool') return val === 'true';
    if (valType === 'json') { try { return JSON.parse(val); } catch { return val; } }
    if (valType === 'date') return Date.now();
    if (valType === 'msg') return getNested(msg, val);
    return val;
  }

  for (const rule of rules) {
    const prop = rule.p || 'payload';

    switch (rule.t) {
      case 'set':
        setNested(msg, prop, resolveValue(rule.to, rule.tot));
        break;
      case 'change': {
        const current = getNested(msg, prop);
        if (typeof current === 'string') {
          const from = String(resolveValue(rule.from, rule.fromt));
          const to = String(resolveValue(rule.to, rule.tot));
          setNested(msg, prop, current.split(from).join(to));
        }
        break;
      }
      case 'delete':
        deleteNested(msg, prop);
        break;
      case 'move': {
        const val = getNested(msg, prop);
        deleteNested(msg, prop);
        if (rule.to) setNested(msg, rule.to, val);
        break;
      }
    }
  }

  return { output: msgToOutput(msg), msg };
};
