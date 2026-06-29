// sim-v5 — PPS schema bundle (token-gated). Serves the BMW-Steyr-HX PPS source
// descriptor + worked example as a read-only reference for hackathon teams.
// No internal/infra details — connection uses the public osf-api endpoint.
// The canonical, customer-neutral framework lives in the public osf-schemas repo.
import { Request, Response } from "express";

const FRAMEWORK = "https://github.com/TobiasLante/osf-schemas/tree/main/next";

const PPS_MACHINE_SOURCE = {
  sourceId: "pps-machine",
  version: "2.0.0",
  sourceType: "rest",
  syncType: "polling",
  profileRef: "SMProfile-Machine",
  transport: ["nats"],
  connection: {
    baseUrl: "https://osf-api.zeroguess.ai/api/sim-v5/pps",
    path: "/machine_map?is_machine=is.true&opcua_machine_id=not.is.null",
    method: "GET",
    auth: "header X-API-Key: <your osf_hk_ key>",
    headers: { "Accept-Profile": "osf_map" },
    timeoutMs: 10000
  },
  response: { format: "json", rootPath: "$", idProperty: "opcua_machine_id" },
  columnMappings: [{ column: "opcua_machine_id", smAttribute: "machine_id", isId: true }],
  edges: [],
  description: "PPS-Clone machine-identity bridge: maps each real PPS machine (AFO/Zelle/BAZ via osf_map.machine_map) onto the canonical SMProfile-Machine machine_id (aligned sim-v5 machineId, e.g. cnc-07). The transactional PPS (IT) lane and the OPC-UA (OT) lane thus name the SAME Machine — identity alignment, not a data join."
};

const PPS_MACHINE_EXAMPLE = {
  _example: true,
  _comment: "One machine_map row projects onto a canonical Machine node keyed by machine_id = the aligned sim-v5 machineId. The OPC-UA telemetry source for the same machineId resolves to the same Machine identity. IT and OT name one factory WITHOUT a data join.",
  profileRef: "SMProfile-Machine",
  input_row_pps: { afo: "AFO160", zelle: "1", baz: "003", is_machine: true, opcua_machine_id: "cnc-07", element_id: "bmw-steyr.hx.cnc-07" },
  kg_node: { kgNodeLabel: "Machine", machine_id: "cnc-07" }
};

const README = [
  "# PPS schema bundle (read-only reference)",
  "",
  "Concept: source -> profile -> sync -> KG. Two lanes (IT transactional = PPS, OT telemetry = OPC-UA) modelled in parallel via ISA-95/88 profiles, never row-joined.",
  "",
  "- sources/rest/pps-machine.json  — machine-identity bridge (PPS -> canonical Machine.machine_id).",
  "- examples/pps-machine-bridge.example.json — worked example.",
  "",
  "Canonical, customer-neutral framework (all profiles/sources/sync): " + FRAMEWORK,
  "Author your own profiles for the richer PPS entities (Stoerung, StueckzahlProSchicht, ...) following this pattern."
].join("\n");

export function handlePpsSchema(_req: Request, res: Response): void {
  res.setHeader("content-type", "application/json");
  res.json({
    info: "OSF schema bundle for the PPS hackathon source — read-only reference + worked example. The canonical framework is public on GitHub (see 'framework').",
    framework: FRAMEWORK,
    files: {
      "sources/rest/pps-machine.json": PPS_MACHINE_SOURCE,
      "examples/pps-machine-bridge.example.json": PPS_MACHINE_EXAMPLE,
      "README.md": README
    }
  });
}