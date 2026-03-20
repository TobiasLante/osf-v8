/**
 * API Versioning — mount all route modules under /v1/ prefix.
 * Existing unversioned routes remain for backward compatibility.
 */

import { Router, RequestHandler } from 'express';

interface RouteMount {
  path: string;
  handler: RequestHandler | Router;
}

/**
 * Creates a versioned router that mounts the given route modules
 * and sets the X-API-Version response header.
 */
export function createVersionedRouter(mounts: RouteMount[]): Router {
  const router = Router();

  // Set version header on all responses through this router
  router.use((_req, res, next) => {
    res.setHeader('X-API-Version', 'v1');
    next();
  });

  for (const { path, handler } of mounts) {
    router.use(path, handler);
  }

  return router;
}
