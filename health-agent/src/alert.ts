// Health Agent — Email alerts via Resend API

import pg from 'pg';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FALLBACK_EMAIL = 'tobias.lante74@gmail.com';

async function getAdminEmails(): Promise<string[]> {
  try {
    const client = new pg.Client({
      host: process.env.DB_HOST || 'osf-postgres.osf.svc.cluster.local',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'osf',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'osf',
      connectionTimeoutMillis: 5_000,
    });
    await client.connect();
    const result = await client.query("SELECT email FROM users WHERE role = 'admin'");
    await client.end();
    const emails = result.rows.map((r: any) => r.email).filter(Boolean);
    return emails.length > 0 ? emails : [FALLBACK_EMAIL];
  } catch (err: any) {
    console.error(`[alert] Failed to fetch admin emails: ${err.message}`);
    return [FALLBACK_EMAIL];
  }
}

function formatHtml(report: string): string {
  const escaped = report
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
  .header { color: #ff4444; font-size: 18px; font-weight: bold; margin-bottom: 16px; }
  .report { background: #16213e; padding: 16px; border-radius: 8px; white-space: pre-wrap; line-height: 1.5; }
  .footer { margin-top: 24px; color: #888; font-size: 12px; }
</style></head>
<body>
  <div class="header">🔴 Health Agent Alert</div>
  <div class="report">${escaped}</div>
  <div class="footer">OpenShopFloor Health Agent — ${new Date().toISOString()}</div>
</body>
</html>`;
}

export async function sendAlert(report: string, dryRun: boolean): Promise<void> {
  const firstLine = report.split('\n')[0].slice(0, 100);

  if (dryRun) {
    console.log('[alert] DRY RUN — would send email:');
    console.log(`  Subject: [Health Agent] ${firstLine}`);
    console.log(`  Report length: ${report.length} chars`);
    return;
  }

  if (!RESEND_API_KEY) {
    console.error('[alert] RESEND_API_KEY not set — cannot send email');
    return;
  }

  const recipients = await getAdminEmails();
  console.log(`[alert] Sending to: ${recipients.join(', ')}`);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'OpenShopFloor Health Agent <noreply@zeroguess.ai>',
        to: recipients,
        subject: `[Health Agent] ${firstLine}`,
        html: formatHtml(report),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[alert] Resend API error ${res.status}: ${text}`);
    } else {
      console.log('[alert] Email sent successfully');
    }
  } catch (err: any) {
    console.error(`[alert] Failed to send email: ${err.message}`);
  }
}
