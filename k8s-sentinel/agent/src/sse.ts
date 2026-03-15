import { Response } from 'express';
import { logger } from './logger';

const clients = new Set<Response>();

export function addClient(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('\n');

  clients.add(res);
  logger.info({ clientCount: clients.size }, 'SSE client connected');

  res.on('close', () => {
    clients.delete(res);
    logger.info({ clientCount: clients.size }, 'SSE client disconnected');
  });
}

export function broadcast(event: string, data: any): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// Heartbeat every 15s
setInterval(() => {
  broadcast('heartbeat', { ts: new Date().toISOString() });
}, 15_000);
