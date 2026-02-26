import { logger } from '../logger';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'OpenShopFloor <noreply@zeroguess.ai>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://openshopfloor.zeroguess.ai';

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    logger.warn({ to, subject }, '[Email] No RESEND_API_KEY — logging email instead of sending');
    logger.info({ to, subject, html }, '[Email] Would have sent');
    return true;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, '[Email] Resend API error');
      return false;
    }

    logger.info({ to, subject }, '[Email] Sent successfully');
    return true;
  } catch (err: any) {
    logger.error({ err: err.message }, '[Email] Send failed');
    return false;
  }
}

export async function sendVerificationEmail(email: string, name: string | null, token: string): Promise<boolean> {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
  const greeting = name ? `Hi ${name}` : 'Hi';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #e2e8f0; margin-bottom: 24px;">Verify your email</h2>
      <p style="color: #a0aec0; line-height: 1.6;">${greeting},</p>
      <p style="color: #a0aec0; line-height: 1.6;">Welcome to OpenShopFloor! Please verify your email address to activate your account.</p>
      <a href="${verifyUrl}" style="display: inline-block; background: #22d3ee; color: #0f172a; padding: 12px 32px; border-radius: 4px; text-decoration: none; font-weight: 600; margin: 24px 0;">Verify Email</a>
      <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Or copy this link: <a href="${verifyUrl}" style="color: #22d3ee;">${verifyUrl}</a></p>
      <p style="color: #64748b; font-size: 13px; margin-top: 32px;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
    </div>
  `;

  return sendEmail(email, 'Verify your OpenShopFloor account', html);
}

export async function sendPasswordResetEmail(email: string, name: string | null, token: string): Promise<boolean> {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
  const greeting = name ? `Hi ${name}` : 'Hi';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #e2e8f0; margin-bottom: 24px;">Reset your password</h2>
      <p style="color: #a0aec0; line-height: 1.6;">${greeting},</p>
      <p style="color: #a0aec0; line-height: 1.6;">We received a request to reset your password. Click the button below to choose a new one.</p>
      <a href="${resetUrl}" style="display: inline-block; background: #22d3ee; color: #0f172a; padding: 12px 32px; border-radius: 4px; text-decoration: none; font-weight: 600; margin: 24px 0;">Reset Password</a>
      <p style="color: #64748b; font-size: 14px; margin-top: 24px;">Or copy this link: <a href="${resetUrl}" style="color: #22d3ee;">${resetUrl}</a></p>
      <p style="color: #64748b; font-size: 13px; margin-top: 32px;">This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>
    </div>
  `;

  return sendEmail(email, 'Reset your OpenShopFloor password', html);
}
