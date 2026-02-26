import { callMcpTool } from '../chat/tool-executor';
import { logger } from '../logger';

export interface ConditionResult {
  met: boolean;
  reason: string;
}

type ConditionEvaluator = (previousResult?: string) => Promise<ConditionResult>;

const evaluators: Record<string, ConditionEvaluator> = {
  always: async () => ({ met: true, reason: 'Always runs' }),

  oee_below_85: async () => {
    try {
      const raw = await callMcpTool('factory_get_latest_oee', {});
      const data = JSON.parse(raw);
      const machines = data?.content?.[0]?.text
        ? JSON.parse(data.content[0].text)
        : data;
      const rows = Array.isArray(machines) ? machines : machines?.machines || [];
      const belowTarget = rows.filter((m: any) => (m.oee ?? m.oee_percent ?? 100) < 85);
      if (belowTarget.length > 0) {
        return { met: true, reason: `${belowTarget.length} machine(s) below 85% OEE` };
      }
      return { met: false, reason: 'All machines above 85% OEE' };
    } catch (err: any) {
      logger.warn({ err: err.message }, 'oee_below_85 condition check failed, defaulting to true');
      return { met: true, reason: 'Could not check OEE, running as precaution' };
    }
  },

  has_alarms: async () => {
    try {
      const raw = await callMcpTool('factory_get_spc_alarms', {});
      const data = JSON.parse(raw);
      const text = data?.content?.[0]?.text || raw;
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      const alarms = Array.isArray(parsed) ? parsed : parsed?.alarms || [];
      if (alarms.length > 0) {
        return { met: true, reason: `${alarms.length} active SPC alarm(s)` };
      }
      return { met: false, reason: 'No active SPC alarms' };
    } catch {
      return { met: true, reason: 'Could not check alarms, running as precaution' };
    }
  },

  orders_at_risk: async () => {
    try {
      const raw = await callMcpTool('factory_get_orders_at_risk', {});
      const data = JSON.parse(raw);
      const text = data?.content?.[0]?.text || raw;
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      const orders = Array.isArray(parsed) ? parsed : parsed?.orders || [];
      if (orders.length > 0) {
        return { met: true, reason: `${orders.length} order(s) at risk` };
      }
      return { met: false, reason: 'No orders at risk' };
    } catch {
      return { met: true, reason: 'Could not check orders, running as precaution' };
    }
  },

  low_stock: async () => {
    try {
      const raw = await callMcpTool('factory_get_low_stock_items', {});
      const data = JSON.parse(raw);
      const text = data?.content?.[0]?.text || raw;
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      const items = Array.isArray(parsed) ? parsed : parsed?.items || [];
      if (items.length > 0) {
        return { met: true, reason: `${items.length} low-stock item(s)` };
      }
      return { met: false, reason: 'No low stock items' };
    } catch {
      return { met: true, reason: 'Could not check stock, running as precaution' };
    }
  },

  previous_found_issues: async (previousResult?: string) => {
    if (!previousResult) {
      return { met: false, reason: 'No previous result to check' };
    }
    const lower = previousResult.toLowerCase();
    const issueKeywords = ['problem', 'issue', 'alarm', 'warning', 'risk', 'below', 'critical', 'urgent', 'action needed', 'attention'];
    const found = issueKeywords.some(kw => lower.includes(kw));
    if (found) {
      return { met: true, reason: 'Previous agent found issues' };
    }
    return { met: false, reason: 'Previous agent found no issues' };
  },
};

export const AVAILABLE_CONDITIONS = Object.keys(evaluators);

export async function evaluateCondition(
  conditionName: string,
  previousResult?: string
): Promise<ConditionResult> {
  const evaluator = evaluators[conditionName];
  if (!evaluator) {
    logger.warn({ condition: conditionName }, 'Unknown condition, defaulting to always');
    return { met: true, reason: `Unknown condition "${conditionName}", running anyway` };
  }
  return evaluator(previousResult);
}
