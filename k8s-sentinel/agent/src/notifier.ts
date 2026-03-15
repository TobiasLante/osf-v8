import { config } from './config';
import { logger } from './logger';
import { getNotificationConfigs } from './db';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc3545',
  medium: '#ffc107',
  harmless: '#28a745',
};

function formatSlackMessage(event: string, payload: any): any {
  const severity = payload?.severity || 'medium';
  const color = SEVERITY_COLORS[severity] || '#6c757d';
  const title = payload?.description || event;
  const fields: any[] = [];

  if (payload?.namespace) {
    fields.push({ type: 'mrkdwn', text: `*Namespace:* ${payload.namespace}` });
  }
  if (payload?.resource_name) {
    fields.push({ type: 'mrkdwn', text: `*Resource:* ${payload.resource_name}` });
  }
  if (payload?.cluster_name) {
    fields.push({ type: 'mrkdwn', text: `*Cluster:* ${payload.cluster_name}` });
  }
  if (payload?.diagnosis) {
    fields.push({ type: 'mrkdwn', text: `*Diagnosis:* ${payload.diagnosis}` });
  }

  return {
    attachments: [{
      color,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `K8s Sentinel: ${event}`, emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: title },
        },
        ...(fields.length > 0 ? [{
          type: 'section',
          fields,
        }] : []),
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `Severity: *${severity}* | ${new Date().toISOString()}` }],
        },
      ],
    }],
  };
}

async function sendSlack(url: string, event: string, payload: any): Promise<void> {
  const body = formatSlackMessage(event, payload);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
  }
}

async function sendWebhook(url: string, event: string, payload: any): Promise<void> {
  const body = { event, payload, timestamp: new Date().toISOString() };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
  }
}

function eventMatches(configEvents: string[], event: string): boolean {
  if (!configEvents || configEvents.length === 0) return true; // empty = all events
  return configEvents.some(e => e === '*' || e === event || event.startsWith(e));
}

export async function notify(event: string, payload: any): Promise<void> {
  let configs: { type: string; url: string; events: string[] }[] = [];

  try {
    configs = await getNotificationConfigs();
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to load notification configs from DB');
  }

  // Also check env-based Slack webhook
  if (config.notifications.slackWebhookUrl) {
    const alreadyHasSlack = configs.some(c => c.type === 'slack' && c.url === config.notifications.slackWebhookUrl);
    if (!alreadyHasSlack) {
      configs.push({ type: 'slack', url: config.notifications.slackWebhookUrl, events: [] });
    }
  }

  for (const nc of configs) {
    if (!eventMatches(nc.events, event)) continue;

    try {
      if (nc.type === 'slack') {
        await sendSlack(nc.url, event, payload);
        logger.info({ event, type: 'slack' }, 'Notification sent');
      } else if (nc.type === 'webhook') {
        await sendWebhook(nc.url, event, payload);
        logger.info({ event, type: 'webhook' }, 'Notification sent');
      } else {
        logger.warn({ type: nc.type }, 'Unknown notification type, skipping');
      }
    } catch (err: any) {
      logger.error({ err: err.message, event, type: nc.type }, 'Failed to send notification');
    }
  }
}
