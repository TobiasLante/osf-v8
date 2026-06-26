// OPC-UA REST shim — exposes node-opcua-client operations as HTTP.
// One persistent client per machine, lazy-init on first request, idle-close after IDLE_MS.
//
// Endpoints (mounted at /api/sim-v5/opcua):
//   GET /machines                              — full catalog
//   GET /:machineId/browse?nodeId=<id>        — children of node (default: ObjectsFolder)
//   GET /:machineId/read?nodeIds=<csv>         — read values for comma-separated nodeIds
//   GET /:machineId/stream?nodeIds=<csv>&intervalMs=1000 — SSE polling stream
//
// All require auth (handled by parent router).

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { CATALOG, getMachine } from "./catalog";
import { simV5 } from "./config";
import {
  OPCUAClient,
  ClientSession,
  AttributeIds,
  BrowseDirection,
  NodeClassMask,
  MessageSecurityMode,
  SecurityPolicy,
} from "node-opcua";

const IDLE_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 8_000;

interface PooledClient {
  client: OPCUAClient;
  session: ClientSession;
  lastUsed: number;
  closeTimer: NodeJS.Timeout | null;
}

const pool = new Map<string, PooledClient>();

async function getSession(machineId: string): Promise<ClientSession> {
  const machine = getMachine(machineId);
  if (!machine) throw new Error(`unknown machine: ${machineId}`);

  const existing = pool.get(machineId);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.closeTimer) { clearTimeout(existing.closeTimer); existing.closeTimer = null; }
    armIdleClose(machineId);
    return existing.session;
  }

  const endpoint = `opc.tcp://${simV5.host}:${machine.hostPort}`;
  const client = OPCUAClient.create({
    applicationName: "osf-gateway-hackathon-shim",
    connectionStrategy: { initialDelay: 200, maxRetry: 1 },
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
    requestedSessionTimeout: 60_000,
  });

  await Promise.race([
    client.connect(endpoint),
    new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), CONNECT_TIMEOUT_MS)),
  ]);
  const session = await client.createSession();

  const entry: PooledClient = { client, session, lastUsed: Date.now(), closeTimer: null };
  pool.set(machineId, entry);
  armIdleClose(machineId);
  logger.info({ machineId, endpoint }, "[opcua-shim] connected");
  return session;
}

function armIdleClose(machineId: string): void {
  const entry = pool.get(machineId);
  if (!entry) return;
  entry.closeTimer = setTimeout(async () => {
    try { await entry.session.close(); await entry.client.disconnect(); } catch { /* ignore */ }
    pool.delete(machineId);
    logger.info({ machineId }, "[opcua-shim] idle-closed");
  }, IDLE_MS);
}

export const opcuaRouter = Router();

// ── GET /machines — catalog ─────────────────────────────────────
opcuaRouter.get("/machines", (_req: Request, res: Response) => {
  res.json({
    count: CATALOG.length,
    host: simV5.host,
    machines: CATALOG.map((m) => ({
      machineId: m.machineId,
      type: m.type,
      endpoint: `opc.tcp://${simV5.host}:${m.hostPort}`,
      hostPort: m.hostPort,
      companions: m.companions,
    })),
  });
});

// ── GET /:machineId/browse?nodeId=<id> ──────────────────────────
opcuaRouter.get("/:machineId/browse", async (req: Request, res: Response) => {
  const machineId = req.params.machineId;
  const nodeId = (req.query.nodeId as string) || "ObjectsFolder";
  try {
    const session = await getSession(machineId);
    const browse = await session.browse({
      nodeId,
      browseDirection: BrowseDirection.Forward,
      nodeClassMask: NodeClassMask.Object | NodeClassMask.Variable | NodeClassMask.Method,
      resultMask: 63,
    });
    const refs = (browse.references || []).map((r: any) => ({
      browseName: r.browseName?.toString(),
      displayName: r.displayName?.text,
      nodeId: r.nodeId?.toString(),
      nodeClass: r.nodeClass,
      typeDefinition: r.typeDefinition?.toString(),
    }));
    res.json({ machineId, nodeId, count: refs.length, references: refs });
  } catch (err: any) {
    logger.warn({ err: err.message, machineId, nodeId }, "[opcua-shim] browse failed");
    res.status(502).json({ error: err.message, machineId, nodeId });
  }
});

// ── GET /:machineId/read?nodeIds=csv ────────────────────────────
opcuaRouter.get("/:machineId/read", async (req: Request, res: Response) => {
  const machineId = req.params.machineId;
  const csv = (req.query.nodeIds as string) || "";
  if (!csv) { res.status(400).json({ error: "nodeIds query param required" }); return; }
  const nodeIds = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (nodeIds.length > 100) { res.status(400).json({ error: "max 100 nodeIds per request" }); return; }

  try {
    const session = await getSession(machineId);
    const values = await session.read(nodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })));
    const result = nodeIds.map((nodeId, i) => {
      const dv = values[i];
      return {
        nodeId,
        value: dv?.value?.value ?? null,
        dataType: dv?.value?.dataType ? String(dv.value.dataType) : null,
        statusCode: dv?.statusCode?.toString(),
        sourceTimestamp: dv?.sourceTimestamp?.toISOString?.() ?? null,
        serverTimestamp: dv?.serverTimestamp?.toISOString?.() ?? null,
      };
    });
    res.json({ machineId, count: result.length, values: result });
  } catch (err: any) {
    logger.warn({ err: err.message, machineId }, "[opcua-shim] read failed");
    res.status(502).json({ error: err.message, machineId });
  }
});

// ── GET /:machineId/stream?nodeIds=csv&intervalMs=1000 — SSE ────
opcuaRouter.get("/:machineId/stream", async (req: Request, res: Response) => {
  const machineId = req.params.machineId;
  const csv = (req.query.nodeIds as string) || "";
  const intervalMs = Math.max(250, Math.min(60_000, parseInt((req.query.intervalMs as string) || "1000", 10)));
  if (!csv) { res.status(400).json({ error: "nodeIds required" }); return; }
  const nodeIds = csv.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);

  res.status(200);
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();
  res.write(`event: open\ndata: ${JSON.stringify({ machineId, intervalMs, nodeIds })}\n\n`);

  let active = true;
  req.on("close", () => { active = false; });

  let session: ClientSession;
  try {
    session = await getSession(machineId);
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
    return;
  }

  while (active) {
    try {
      const values = await session.read(nodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })));
      const payload = nodeIds.map((nodeId, i) => ({
        nodeId,
        value: values[i]?.value?.value ?? null,
        ts: values[i]?.sourceTimestamp?.toISOString?.() ?? new Date().toISOString(),
        status: values[i]?.statusCode?.toString(),
      }));
      res.write(`event: tick\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      break;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  res.end();
});
