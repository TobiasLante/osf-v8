// OpenAPI aggregator — fetches sim-v5 backend specs and rewrites them
// so all paths get prefixed with /api/sim-v5/{backend}/ for unified browsing.

import { Request, Response } from "express";
import { simV5 } from "./config";
import { logger } from "../logger";

const TIMEOUT_MS = 8_000;

interface OpenAPI {
  openapi?: string;
  info?: any;
  paths?: Record<string, any>;
  components?: any;
  servers?: any[];
}

async function fetchSpec(url: string): Promise<OpenAPI | null> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return (await r.json()) as OpenAPI;
  } catch (err: any) {
    logger.warn({ err: err.message, url }, "[sim-v5] openapi fetch failed");
    return null;
  }
}

function prefixPaths(spec: OpenAPI, pathPrefix: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [p, v] of Object.entries(spec.paths || {})) {
    // strip leading /external/v1 or /api if present, then prefix
    let clean = p.startsWith("/") ? p : `/${p}`;
    out[`${pathPrefix}${clean}`] = v;
  }
  return out;
}

export async function handleAggregateOpenApi(_req: Request, res: Response): Promise<void> {
  const backends = [
    { key: "erp",       url: `${simV5.rest.apiErp}/openapi.json`,       prefix: "/api/sim-v5/erp" },
    { key: "qms",       url: `${simV5.rest.apiQms}/openapi.json`,       prefix: "/api/sim-v5/qms" },
    { key: "wms",       url: `${simV5.rest.apiWms}/openapi.json`,       prefix: "/api/sim-v5/wms" },
    { key: "windchill", url: `${simV5.rest.apiWindchill}/openapi.json`, prefix: "/api/sim-v5/windchill" },
  ];

  const specs = await Promise.all(backends.map((b) => fetchSpec(b.url)));

  const aggregated: OpenAPI = {
    openapi: "3.0.3",
    info: {
      title: "sim-v5 Hackathon API",
      version: "1.0.0",
      description: "Read-only proxy of sim-v5 PROD (192.168.178.154). All endpoints require authentication (JWT or X-API-Key). GET/HEAD/OPTIONS only.",
    },
    servers: [{ url: "https://osf-api.zeroguess.ai" }],
    paths: {},
    components: { securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      Bearer: { type: "http", scheme: "bearer" },
    }},
  };

  for (let i = 0; i < backends.length; i++) {
    const spec = specs[i];
    if (!spec) continue;
    Object.assign(aggregated.paths!, prefixPaths(spec, backends[i].prefix));
  }

  // Add OPC-UA shim endpoints manually
  aggregated.paths!["/api/sim-v5/opcua/machines"] = {
    get: {
      summary: "List all OPC-UA machine endpoints",
      tags: ["opcua"],
      security: [{ ApiKey: [] }, { Bearer: [] }],
      responses: { "200": { description: "Machine catalog", content: { "application/json": { schema: { type: "array" } } } } },
    },
  };
  aggregated.paths!["/api/sim-v5/opcua/{machineId}/browse"] = {
    get: {
      summary: "Browse OPC-UA address space (children of nodeId)",
      tags: ["opcua"],
      security: [{ ApiKey: [] }, { Bearer: [] }],
      parameters: [
        { in: "path", name: "machineId", required: true, schema: { type: "string" } },
        { in: "query", name: "nodeId", required: false, schema: { type: "string" } },
      ],
      responses: { "200": { description: "Browse result" } },
    },
  };
  aggregated.paths!["/api/sim-v5/opcua/{machineId}/read"] = {
    get: {
      summary: "Read OPC-UA node values",
      tags: ["opcua"],
      security: [{ ApiKey: [] }, { Bearer: [] }],
      parameters: [
        { in: "path", name: "machineId", required: true, schema: { type: "string" } },
        { in: "query", name: "nodeIds", required: true, schema: { type: "string" }, description: "Comma-separated nodeIds" },
      ],
      responses: { "200": { description: "Values + timestamps" } },
    },
  };
  aggregated.paths!["/api/sim-v5/opcua/{machineId}/stream"] = {
    get: {
      summary: "SSE stream of OPC-UA values (subscribe + push)",
      tags: ["opcua"],
      security: [{ ApiKey: [] }, { Bearer: [] }],
      parameters: [
        { in: "path", name: "machineId", required: true, schema: { type: "string" } },
        { in: "query", name: "nodeIds", required: true, schema: { type: "string" } },
        { in: "query", name: "intervalMs", required: false, schema: { type: "integer", default: 1000 } },
      ],
      responses: { "200": { description: "text/event-stream" } },
    },
  };

  res.setHeader("content-type", "application/json");
  res.json(aggregated);
}

export function handleSwaggerUI(_req: Request, res: Response): void {
  res.setHeader("content-type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>sim-v5 Hackathon API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body{margin:0;padding:0;font-family:system-ui}</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/sim-v5/openapi.json",
      dom_id: "#swagger",
      deepLinking: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`);
}
