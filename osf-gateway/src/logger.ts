import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'password', 'password_hash', 'token'],
    censor: '[REDACTED]',
  },
});

// Security event types
export type SecurityEvent =
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.register.success'
  | 'auth.register.failed'
  | 'auth.token.refresh'
  | 'auth.token.invalid'
  | 'auth.apikey.invalid'
  | 'auth.apikey.ratelimit'
  | 'auth.lockout'
  | 'auth.email.verified'
  | 'auth.verification.resent'
  | 'auth.password.reset_requested'
  | 'auth.password.reset_completed'
  | 'rate_limit.exceeded'
  | 'cors.blocked'
  | 'mcp.method.blocked'
  | 'auth.cookie.invalid';

export function logSecurity(event: SecurityEvent, details: Record<string, unknown>) {
  logger.warn({ event, ...details }, `security: ${event}`);
}
