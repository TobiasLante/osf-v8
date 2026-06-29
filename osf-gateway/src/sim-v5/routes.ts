// sim-v5 Hackathon Routes — read-only proxy + OPC-UA REST shim.
// Mounted at /api/sim-v5/* by index.ts.
//
// Auth model:
//   - /docs, /openapi.json: PUBLIC (Swagger UI + raw OpenAPI). Contains no live data.
//   - everything else: requireAuth (JWT or X-API-Key osf_*). Method GET/HEAD/OPTIONS only.
// Audit: logger.info per request with userId + path (rest-proxy + opcua-shim).

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../auth/middleware";
import { logger } from "../logger";
import { simV5 } from "./config";
import { CATALOG } from "./catalog";
import { erpProxy, qmsProxy, wmsProxy, windchillProxy, gatewayProxy, ppsProxy } from "./rest-proxy";
import { handleAggregateOpenApi, handleSwaggerUI } from "./openapi-aggregator";
import { opcuaRouter } from "./opcua-shim";

const router = Router();

// -- Method whitelist: GET + HEAD + OPTIONS only --
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Method not allowed (read-only hackathon surface)" });
    return;
  }
  next();
});

// -- PUBLIC: Discovery / OpenAPI / Swagger UI (must load without key) --
router.get("/openapi.json", handleAggregateOpenApi);
router.get("/docs", handleSwaggerUI);

// -- All remaining endpoints require auth --
router.use(requireAuth);

// -- Health/Smoke --
router.get("/ping", (req: any, res: Response) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    who: req.user?.email || null,
    tier: req.user?.tier || null,
    backend: simV5.host,
  });
});

router.get("/info", (_req: Request, res: Response) => {
  res.json({
    surface: "sim-v5 hackathon",
    rest: Object.keys(simV5.rest),
    opcua: { machines: CATALOG.length, portRange: [simV5.opcua.portBase, simV5.opcua.portMax] },
    docs: "/api/sim-v5/docs",
    openapi: "/api/sim-v5/openapi.json",
  });
});

// -- REST proxies --
router.use("/erp",       erpProxy);
router.use("/qms",       qmsProxy);
router.use("/wms",       wmsProxy);
router.use("/windchill", windchillProxy);
router.use("/gateway",   gatewayProxy);

// -- PPS-Clone (BMW Steyr HX) -- read-only via PostgREST --
router.use("/pps",       ppsProxy);

// -- OPC-UA REST shim --
router.use("/opcua", opcuaRouter);

export default router;