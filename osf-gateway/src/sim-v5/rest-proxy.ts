// REST/HTTP proxy for sim-v5 backends — read-only (GET/HEAD/OPTIONS).
import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { simV5 } from "./config";

const FETCH_TIMEOUT_MS = 20_000;
const PASSTHROUGH_HEADERS = ["accept-profile", "content-profile", "prefer", "range"];

function makeProxy(upstream: string, prefix: string) {
  const router = Router({ mergeParams: true });

  router.all("*", async (req: Request, res: Response) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const upstreamPath = req.originalUrl.replace(prefix, "") || "/";
    const url = `${upstream}${upstreamPath}`;

    const headers: Record<string, string> = {
      accept: req.headers.accept || "application/json",
    };
    for (const h of PASSTHROUGH_HEADERS) {
      const v = req.headers[h];
      if (typeof v === "string") headers[h] = v;
    }
    if (simV5.upstreamApiKey) {
      headers["x-api-key"] = simV5.upstreamApiKey;
    }

    try {
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const upstreamRes = await fetch(url, { method: req.method, headers, signal: ctl.signal });
      clearTimeout(tid);

      const ct = upstreamRes.headers.get("content-type") || "application/octet-stream";
      res.status(upstreamRes.status);
      res.setHeader("content-type", ct);
      res.setHeader("x-sim-v5-upstream", upstream.replace(/^https?:\/\//, ""));

      const body = await upstreamRes.arrayBuffer();
      res.send(Buffer.from(body));

      const user = (req as any).user;
      logger.info(
        { userId: user?.userId, email: user?.email, method: req.method, prefix, path: upstreamPath, status: upstreamRes.status },
        "[sim-v5] proxy"
      );
    } catch (err: any) {
      const isAbort = err.name === "AbortError";
      logger.warn({ err: err.message, url, isAbort }, "[sim-v5] proxy upstream error");
      res.status(isAbort ? 504 : 502).json({
        error: isAbort ? "Upstream timeout" : "Upstream unreachable",
        upstream: upstream.replace(/^https?:\/\//, ""),
      });
    }
  });

  return router;
}

export const erpProxy        = makeProxy(simV5.rest.apiErp,       "/api/sim-v5/erp");
export const qmsProxy        = makeProxy(simV5.rest.apiQms,       "/api/sim-v5/qms");
export const wmsProxy        = makeProxy(simV5.rest.apiWms,       "/api/sim-v5/wms");
export const windchillProxy  = makeProxy(simV5.rest.apiWindchill, "/api/sim-v5/windchill");
export const gatewayProxy    = makeProxy(simV5.rest.apiGateway,   "/api/sim-v5/gateway");
export const ppsProxy        = makeProxy(simV5.rest.apiPps,       "/api/sim-v5/pps");
export const mtconnectProxy  = makeProxy(simV5.rest.apiMtconnect, "/api/sim-v5/mtconnect");