// sim-v5 backend endpoint config (PROD = .154)
// External ports on .154 verified via `docker ps` 2026-06-26.
// REST = 38xxx (PROD offset +10000 from internal 18xxx)
// OPC-UA = 36xxx (no offset on PROD; 50 machines, port = 36000 + idx)

const SIM_V5_HOST = process.env.SIM_V5_HOST || "192.168.178.154";

export const simV5 = {
  host: SIM_V5_HOST,
  rest: {
    apiErp:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_ERP_PORT || "38260"}`,
    apiGateway:    `http://${SIM_V5_HOST}:${process.env.SIM_V5_GATEWAY_PORT || "38210"}`,
    apiQms:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_QMS_PORT || "38261"}`,
    apiWms:        `http://${SIM_V5_HOST}:${process.env.SIM_V5_WMS_PORT || "38224"}`,
    apiWindchill:  `http://${SIM_V5_HOST}:${process.env.SIM_V5_WINDCHILL_PORT || "38222"}`,
  },
  opcua: {
    portBase: parseInt(process.env.SIM_V5_OPCUA_PORT_BASE || "36000", 10),
    portMax:  parseInt(process.env.SIM_V5_OPCUA_PORT_MAX || "36499", 10),
  },
  upstreamApiKey: process.env.SIM_V5_API_KEY || "",
};
