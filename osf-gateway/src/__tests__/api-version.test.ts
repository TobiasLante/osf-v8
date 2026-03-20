import { describe, it, expect } from 'vitest';
import express from 'express';
import { createVersionedRouter } from '../api-version';

describe('api-version', () => {
  it('creates a router with version header middleware + mounts', () => {
    const mockRouter = express.Router();
    mockRouter.get('/test', (_req, res) => res.json({ ok: true }));

    const versioned = createVersionedRouter([
      { path: '/mock', handler: mockRouter },
    ]);

    // The router should be a function (Express router)
    expect(typeof versioned).toBe('function');
  });

  it('sets X-API-Version header on responses', async () => {
    const app = express();

    const mockRouter = express.Router();
    mockRouter.get('/ping', (_req, res) => res.json({ pong: true }));

    app.use('/v1', createVersionedRouter([
      { path: '/test', handler: mockRouter },
    ]));

    // Use Node's built-in http for a lightweight test
    const http = await import('http');
    const server = http.createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const addr = server.address() as { port: number };

    try {
      const resp = await fetch(`http://127.0.0.1:${addr.port}/v1/test/ping`);
      expect(resp.headers.get('x-api-version')).toBe('v1');
      const body = await resp.json();
      expect(body.pong).toBe(true);
    } finally {
      server.close();
    }
  });

  it('mounts multiple route handlers', () => {
    const r1 = express.Router();
    const r2 = express.Router();
    const r3 = express.Router();

    const versioned = createVersionedRouter([
      { path: '/a', handler: r1 },
      { path: '/b', handler: r2 },
      { path: '/c', handler: r3 },
    ]);

    // Express router stores layers internally
    // The version header middleware + 3 route mounts = 4 layers
    expect((versioned as any).stack.length).toBe(4);
  });
});
