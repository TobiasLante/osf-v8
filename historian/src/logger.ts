// Historian v2 — Structured Logger (lightweight, no external deps)

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = {
  info: (...args: any[]) => console.log(new Date().toISOString(), 'INFO', ...args),
  warn: (...args: any[]) => console.warn(new Date().toISOString(), 'WARN', ...args),
  error: (...args: any[]) => console.error(new Date().toISOString(), 'ERROR', ...args),
};
