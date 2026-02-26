import { NodeExecutor, tryParseJson, msgToOutput } from './types';

/**
 * Executor for native Node-RED 'switch' node.
 * Evaluates rules against the msg and routes to the matching output port.
 */
export const executeNativeSwitch: NodeExecutor = async (input) => {
  const rules: Array<{ t: string; v: any; vt?: string; v2?: any; v2t?: string }> = input.config.rules || [];
  const property = input.config.property || 'payload';

  // Use upstream msg if available
  const msg: any = input.msg
    ? { ...input.msg }
    : { payload: tryParseJson(input.previousOutput) };

  // Extract the value to test from msg
  let testValue: any;
  const parts = property.split('.');
  let v: any = msg;
  for (const p of parts) {
    if (v && typeof v === 'object') v = v[p];
    else { v = undefined; break; }
  }
  testValue = v;

  function coerce(val: any, vt?: string): any {
    if (vt === 'num') return Number(val);
    if (vt === 'bool') return val === 'true' || val === true;
    if (vt === 'json') { try { return JSON.parse(val); } catch { return val; } }
    return String(val ?? '');
  }

  function evaluate(rule: typeof rules[0]): boolean {
    const rv = coerce(rule.v, rule.vt);
    const v2 = rule.v2 !== undefined ? coerce(rule.v2, rule.v2t) : undefined;
    const tv = typeof rv === 'number' ? Number(testValue) : testValue;

    switch (rule.t) {
      case 'eq':   return tv == rv;
      case 'neq':  return tv != rv;
      case 'lt':   return tv < rv;
      case 'lte':  return tv <= rv;
      case 'gt':   return tv > rv;
      case 'gte':  return tv >= rv;
      case 'btwn': return tv >= rv && tv <= v2;
      case 'cont': return String(tv).includes(String(rv));
      case 'regex': return new RegExp(String(rv), rule.vt === 'prev' ? '' : 'i').test(String(tv));
      case 'true':  return tv === true || tv === 'true';
      case 'false': return tv === false || tv === 'false';
      case 'null':  return tv === null || tv === undefined;
      case 'nnull': return tv !== null && tv !== undefined;
      case 'empty': return tv === '' || tv === undefined || tv === null || (Array.isArray(tv) && tv.length === 0);
      case 'nempty': return tv !== '' && tv !== undefined && tv !== null && !(Array.isArray(tv) && tv.length === 0);
      case 'istype': return typeof tv === String(rv);
      case 'else':  return true;
      default:      return false;
    }
  }

  for (let i = 0; i < rules.length; i++) {
    if (evaluate(rules[i])) {
      return { output: msgToOutput(msg), msg, outputPort: i };
    }
  }

  return { output: msgToOutput(msg), msg, outputPort: 0 };
};
