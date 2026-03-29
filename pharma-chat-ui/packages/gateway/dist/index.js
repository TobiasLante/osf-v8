"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const llm_proxy_1 = require("./llm-proxy");
const mcp_proxy_1 = require("./mcp-proxy");
const fda_api_1 = require("./fda-api");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3101', 10);
// CORS
const allowedOrigins = [
    'http://localhost:3100',
    ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
];
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    else if (!origin) {
        // Allow non-browser requests (curl, etc.)
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
});
// Body parser
app.use(express_1.default.json({ limit: '10mb' }));
// Health
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.2.0', timestamp: new Date().toISOString() });
});
// Routes
app.use(llm_proxy_1.llmRouter);
app.use(mcp_proxy_1.mcpRouter);
app.use(fda_api_1.fdaRouter);
// Start
const server = app.listen(PORT, () => {
    console.log(`[gateway] listening on http://localhost:${PORT}`);
    console.log(`[gateway] MCP_URL = ${process.env.MCP_URL || 'http://192.168.178.150:30900'}`);
});
// Graceful shutdown
function shutdown(signal) {
    console.log(`[gateway] ${signal} received, shutting down...`);
    server.close(() => {
        console.log('[gateway] closed');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
