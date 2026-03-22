"""
OSF ML Predictor — AutoGluon-based forecasting + regression MCP server.
Exposes ml_predict_oee, ml_predict_scrap, ml_predict_energy, ml_regression_analysis.
"""

import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from .config import PORT
from .storage import close_driver
from .mcp_handler import handle_tools_list, handle_tool_call

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[ML Predictor] Starting on port {PORT}")
    yield
    await close_driver()
    print("[ML Predictor] Shutdown complete")

app = FastAPI(title="OSF ML Predictor", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ml-predictor"}

@app.post("/mcp")
async def mcp_handler(request: Request):
    """MCP JSON-RPC endpoint — compatible with OSF Gateway tool-executor."""
    body = await request.json()
    method = body.get("method", "")
    req_id = body.get("id")
    params = body.get("params", {})

    if method == "tools/list":
        tools = await handle_tools_list()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": [{"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]} for t in tools]},
        }

    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        try:
            result = await handle_tool_call(tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(result)}]},
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            }

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, reload=False)
