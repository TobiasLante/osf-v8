// sim-v5 backend endpoint config (PROD = .154)
const SIM_V5_HOST = process.env.SIM_V5_HOST || "192.168.178.154";

export const simV5 = {
  host: SIM_V5_HOST,
  rest: {
    apiErp:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_ERP_PORT || "38260"}`,
    apiGateway:    `http://${SIM_V5_HOST}:${process.env.SIM_V5_GATEWAY_PORT || "38210"}`,
    apiQms:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_QMS_PORT || "38261"}`,
    apiWms:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_WMS_PORT || "38224"}`,
    apiWindchill:  `http://${SIM_V5_HOST}:${process.env.SIM_V5_WINDCHILL_PORT || "38222"}`,
    // PPS-Clone (BMW Steyr HX) — read-only via PostgREST in k8s ns hackathon-shared.
    apiPps:        process.env.SIM_V5_PPS_URL || "http://postgrest.hackathon-shared.svc.cluster.local:3000",
    // MTConnect 1.7 agent on .154 (host 35000 -> container 5000): /probe, /current.
    apiMtconnect:  `http://${SIM_V5_HOST}:${process.env.SIM_V5_MTCONNECT_PORT || "35000"}`,
  },
  opcua: {
    portBase: parseInt(process.env.SIM_V5_OPCUA_PORT_BASE || "36000", 10),
    portMax:  parseInt(process.env.SIM_V5_OPCUA_PORT_MAX || "36499", 10),
  },
  upstreamApiKey: process.env.SIM_V5_API_KEY || "",
};