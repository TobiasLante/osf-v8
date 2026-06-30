// sim-v5 Hackathon Routes — read-only proxy + OPC-UA REST shim. Mounted at /api/sim-v5/*.
import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../auth/middleware";
import { logger } from "../logger";
import { simV5 } from "./config";
import { CATALOG } from "./catalog";
import { erpProxy, qmsProxy, wmsProxy, windchillProxy, gatewayProxy, ppsProxy, mtconnectProxy } from "./rest-proxy";
import { handleAggregateOpenApi, handleSwaggerUI } from "./openapi-aggregator";
import { handlePpsSchema } from "./pps-schema";
import { opcuaRouter } from "./opcua-shim";

const router = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Method not allowed (read-only hackathon surface)" });
    return;
  }
  next();
});

// PUBLIC discovery
router.get("/openapi.json", handleAggregateOpenApi);
router.get("/docs", handleSwaggerUI);

router.use(requireAuth);

router.get("/ping", (req: any, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString(), who: req.user?.email || null, tier: req.user?.tier || null, backend: simV5.host });
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

// REST proxies
router.use("/erp",       erpProxy);
router.use("/qms",       qmsProxy);
router.use("/wms",       wmsProxy);
router.use("/windchill", windchillProxy);
router.use("/gateway",   gatewayProxy);

// PPS-Clone (BMW Steyr HX) — token-gated schema bundle + read-only PostgREST
router.get("/pps/_schema", handlePpsSchema);
router.use("/pps",       ppsProxy);

// MTConnect 1.7 agent (.154) — /mtconnect/probe, /mtconnect/current
router.use("/mtconnect", mtconnectProxy);

// OPC-UA REST shim
router.use("/opcua", opcuaRouter);

export default router;