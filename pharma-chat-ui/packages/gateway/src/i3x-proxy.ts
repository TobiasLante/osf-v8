import { Router, Request, Response } from 'express';
import type { IRouter } from 'express';
import {
  getObjectTypes,
  getObjects,
  getObjectValues,
  getRelatedObjects,
} from './i3x-client';

export const i3xRouter: IRouter = Router();

// ── Concurrency-limited Promise.all ──
const CONCURRENCY_LIMIT = 5;

async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function safeError(err: any): string {
  console.error('[i3x-proxy]', err.message || err);
  return 'Upstream service error';
}

// ── GET /api/stats — object type inventory ──

i3xRouter.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const types = await getObjectTypes();
    res.json(types);
  } catch (err: any) {
    res.status(502).json({ error: safeError(err) });
  }
});

// ── GET /api/accounts — all Account nodes with properties ──

i3xRouter.get('/api/accounts', async (_req: Request, res: Response) => {
  try {
    const objects = await getObjects('type:Account', 500);
    if (objects.length === 0) {
      res.json([]);
      return;
    }
    const ids = objects.map(o => o.elementId);
    const values = await getObjectValues(ids);

    const accounts = values.map(v => ({
      elementId: v.elementId,
      displayName: v.displayName,
      properties: Object.fromEntries(
        Object.entries(v.properties).map(([k, vqt]) => [k, vqt.value]),
      ),
    }));

    res.json(accounts);
  } catch (err: any) {
    res.status(502).json({ error: safeError(err) });
  }
});

// ── GET /api/accounts/:id — single account with related objects ──

i3xRouter.get('/api/accounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [values, related] = await Promise.all([
      getObjectValues([id]),
      getRelatedObjects([id]),
    ]);

    if (values.length === 0) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const account = values[0];
    const props = Object.fromEntries(
      Object.entries(account.properties).map(([k, vqt]) => [k, vqt.value]),
    );

    res.json({
      elementId: account.elementId,
      displayName: account.displayName,
      properties: props,
      related: related.map(r => ({
        elementId: r.elementId,
        displayName: r.displayName,
        typeId: r.typeId,
        relationships: r.relationships,
      })),
    });
  } catch (err: any) {
    res.status(502).json({ error: safeError(err) });
  }
});

// ── GET /api/vendors — all Vendor nodes with properties ──

i3xRouter.get('/api/vendors', async (_req: Request, res: Response) => {
  try {
    const objects = await getObjects('type:Vendor', 500);
    if (objects.length === 0) {
      res.json([]);
      return;
    }
    const ids = objects.map(o => o.elementId);
    const values = await getObjectValues(ids);

    const vendors = values.map(v => ({
      elementId: v.elementId,
      displayName: v.displayName,
      properties: Object.fromEntries(
        Object.entries(v.properties).map(([k, vqt]) => [k, vqt.value]),
      ),
    }));

    res.json(vendors);
  } catch (err: any) {
    res.status(502).json({ error: safeError(err) });
  }
});

// ── GET /api/process-templates — all ProcessTemplate nodes ──

i3xRouter.get('/api/process-templates', async (_req: Request, res: Response) => {
  try {
    const objects = await getObjects('type:ProcessTemplate', 200);
    if (objects.length === 0) {
      res.json([]);
      return;
    }

    // Fetch related UnitOperations with concurrency limit
    const templates = await mapConcurrent(objects, async t => {
      const related = await getRelatedObjects([t.elementId]);
      return {
        elementId: t.elementId,
        displayName: t.displayName,
        steps: related
          .filter(r => r.typeId === 'type:UnitOperation')
          .map(r => ({
            elementId: r.elementId,
            displayName: r.displayName,
          })),
      };
    });

    res.json(templates);
  } catch (err: any) {
    res.status(502).json({ error: safeError(err) });
  }
});
