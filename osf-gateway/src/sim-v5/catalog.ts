// sim-v5 machine catalog — static map of OPC-UA endpoints on PROD (.154).
// Generated from `docker ps` 2026-06-26 — 16 services, 211 port slots, up to 50+ machines active.
// Re-generate if container layout changes (rare).

export interface MachineDef {
  machineId: string;     // e.g. "cnc-01"
  service: string;       // docker container name
  hostPort: number;      // .154 external port
  containerPort: number; // 4840 + idx
  idx: number;           // 0-based instance index in its service
  type: string;          // "cnc" | "sgm" | "press" | ...
  companions: string[];  // V1-A always; plus type-specific (V1-B for cnc, V1-C for sgm, etc.)
}

const COMPANION_MAP: Record<string, string[]> = {
  "cnc":              ["V1-A-Machinery", "V1-B-ISA95"],
  "sgm":              ["V1-A-Machinery", "V1-C-Euromap77"],
  "press":            ["V1-A-Machinery", "V1-G-PLCopen"],
  "hmi":              ["V1-A-Machinery"],
  "feeder-stopper":   ["V1-A-Machinery", "V1-E-PackML40050"],
  "mobile-cobot":     ["V1-A-Machinery", "V1-D-Robotics40010", "V1-H-MobileVehicle"],
  "tms":              ["V1-A-Machinery", "V1-H-MobileVehicle"],
  "tms-montage":      ["V1-A-Machinery", "V1-H-MobileVehicle"],
  "wms-robot":        ["V1-A-Machinery", "Y5-MC2-WMS-Carousel"],
  "qms-inspector":    ["V1-A-Machinery", "V1-F-Vision30070"],
  "prueffeld":        ["V1-A-Machinery", "V1-E-PackML40050"],
  "vormontage":       ["V1-A-Machinery", "V1-E-PackML40050"],
  "assembly-station": ["V1-A-Machinery", "V1-E-PackML40050"],
  "assembly-line":    ["V1-A-Machinery"],
  "assembly-rework":  ["V1-A-Machinery"],
  "fremdbearbeitung": ["V1-A-Machinery"],
};

// Service → [type, idStem, hostPortBase, count]
const SERVICES: Array<[string, string, string, number, number]> = [
  ["sim-v5-machines-cnc",              "cnc",              "cnc",              36000, 20],
  ["sim-v5-machines-hmi",              "hmi",              "hmi",              36020, 10],
  ["sim-v5-machines-press",            "press",            "press",            36040, 3],
  ["sim-v5-machines-sgm",              "sgm",              "sgm",              36060, 22],
  ["sim-v5-machines-tms",              "tms",              "tms",              36120, 10],
  ["sim-v5-machines-tms-montage",      "tms-montage",      "tms-mtg",          36140, 10],
  ["sim-v5-machines-mobile-cobot",     "mobile-cobot",     "cobot",            36160, 10],
  ["sim-v5-machines-wms-robot",        "wms-robot",        "wms",              36200, 10],
  ["sim-v5-machines-feeder-stopper",   "feeder-stopper",   "feeder",           36220, 10],
  ["sim-v5-machines-qms-inspector",    "qms-inspector",    "qms",              36260, 10],
  ["sim-v5-machines-prueffeld",        "prueffeld",        "prf",              36280, 10],
  ["sim-v5-machines-vormontage",       "vormontage",       "vmtg",             36320, 10],
  ["sim-v5-machines-assembly-station", "assembly-station", "asm-stn",          36340, 36],
  ["sim-v5-machines-assembly-line",    "assembly-line",    "asm-line",         36380, 20],
  ["sim-v5-machines-assembly-rework",  "assembly-rework",  "asm-rew",          36420, 10],
  ["sim-v5-machines-fremdbearbeitung", "fremdbearbeitung", "fremd",            36460, 10],
];

function buildCatalog(): MachineDef[] {
  const out: MachineDef[] = [];
  for (const [service, type, idStem, basePort, count] of SERVICES) {
    for (let idx = 0; idx < count; idx++) {
      out.push({
        machineId: `${idStem}-${String(idx + 1).padStart(2, "0")}`,
        service,
        hostPort: basePort + idx,
        containerPort: 4840 + idx,
        idx,
        type,
        companions: COMPANION_MAP[type] || ["V1-A-Machinery"],
      });
    }
  }
  return out;
}

export const CATALOG: MachineDef[] = buildCatalog();

export function getMachine(machineId: string): MachineDef | undefined {
  return CATALOG.find((m) => m.machineId === machineId);
}
