// sim-v5 Hackathon Routes — read-only proxy to sim-v5 REST + OPC-UA shim
// Mounted at /api/sim-v5/* by index.ts
//
// Auth: requireAuth (JWT or X-API-Key osf_*) — same as other osf-gateway routes.
// Method: GET-only enforced at router level (Hackathon = read-only).
// Audit: logger.info per request with userId + path.
//
// Skeleton (Tag 1): only /ping endpoint, full routes land in Tag 2-4.

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../auth/middleware";
import { logger } from "../logger";
import { simV5 } from "./config";

const router = Router();

// ── Method whitelist: GET + HEAD + OPTIONS only ─────────────────
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Method not allowed (read-only hackathon surface)" });
    return;
  }
  next();
});

// ── Smoke: /api/sim-v5/ping ─────────────────────────────────────
router.get("/ping", requireAuth, (req: any, res: Response) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    who: req.user?.email || null,
    backend: simV5.host,
  });
});

// ── Catalog stub: /api/sim-v5/info ──────────────────────────────
router.get("/info", requireAuth, (_req: Request, res: Response) => {
  res.json({
    surface: "sim-v5 hackathon",
    rest: Object.keys(simV5.rest),
    opcua: {
      portRange: [simV5.opcua.portBase, simV5.opcua.portMax],
      note: "individual machine endpoints addressable via /opcua/{machineId}/*",
    },
    todo: ["erp-proxy (Tag 2)", "opcua-shim (Tag 4)", "openapi-aggregator (Tag 2)"],
  });
});

export default router;
