"""
Fetch training data from Factory Simulator via MCP tool calls.
Inspired by Flexware ProveIT data_fetcher.py pattern.
"""

import httpx
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
from .config import MCP_URL

async def call_mcp_tool(tool_name: str, args: dict = {}) -> dict:
    """Call an MCP tool on the Factory Simulator."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(MCP_URL, json={
            "jsonrpc": "2.0",
            "id": f"ml-{tool_name}-{datetime.now().timestamp()}",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": args}
        })
        data = resp.json()
        if "error" in data:
            raise Exception(f"MCP error: {data['error']}")
        # Extract text content from MCP result
        content = data.get("result", {}).get("content", [])
        text = next((c["text"] for c in content if c.get("type") == "text"), None)
        if text:
            import json
            return json.loads(text)
        return data.get("result", {})


async def fetch_oee_history(machine_id: str, hours: int = 168) -> pd.DataFrame:
    """Fetch OEE history for a machine. Returns DataFrame with timestamp + oee columns."""
    data = await call_mcp_tool("factory_get_machine_oee", {"machineNo": machine_id, "daysBack": max(1, hours // 24)})

    rows = data.get("verlauf", data.get("maschinen", []))
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    # Normalize column names
    if "stunde" in df.columns:
        df["timestamp"] = pd.to_datetime(df["stunde"])
    elif "zeitpunkt" in df.columns:
        df["timestamp"] = pd.to_datetime(df["zeitpunkt"])
    else:
        return pd.DataFrame()

    # Parse OEE — handle both "85.2%" string and 0.852 float
    if "oee" in df.columns:
        df["value"] = df["oee"].apply(lambda x: float(str(x).replace("%", "")) / 100 if "%" in str(x) else float(x))
    elif "avgOee" in df.columns:
        df["value"] = df["avgOee"].apply(lambda x: float(str(x).replace("%", "")) / 100 if "%" in str(x) else float(x))
    else:
        return pd.DataFrame()

    return df[["timestamp", "value"]].dropna().sort_values("timestamp").reset_index(drop=True)


async def fetch_scrap_history(machine_id: str, hours: int = 168) -> pd.DataFrame:
    """Fetch scrap rate history for a machine."""
    data = await call_mcp_tool("factory_get_scrap_history", {"hours": hours})

    machines = data.get("maschinen", [])
    machine_data = next((m for m in machines if m.get("machineNo") == machine_id or m.get("maschine") == machine_id), None)
    if not machine_data:
        return pd.DataFrame()

    rate_str = machine_data.get("ausschussRate", machine_data.get("scrapRate", "0"))
    rate = float(str(rate_str).replace("%", "")) / 100 if "%" in str(rate_str) else float(rate_str)

    # Single data point — not enough for time series
    # Fallback: use production history which has hourly data
    prod_data = await call_mcp_tool("factory_get_production_history", {"hours": hours})
    verlauf = prod_data.get("verlauf", [])
    if not verlauf:
        return pd.DataFrame()

    rows = []
    for entry in verlauf:
        ts = entry.get("stunde") or entry.get("zeitpunkt")
        good = float(entry.get("gutTeile", entry.get("good_parts", 0)))
        bad = float(entry.get("ausschuss", entry.get("defective_parts", 0)))
        total = good + bad
        scrap_rate = bad / total if total > 0 else 0
        rows.append({"timestamp": pd.to_datetime(ts), "value": scrap_rate})

    return pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)


async def fetch_energy_history(machine_id: str, hours: int = 168) -> pd.DataFrame:
    """Fetch energy consumption history for a machine."""
    data = await call_mcp_tool("factory_get_energy_trend", {"machineNo": machine_id, "hours": hours})

    verlauf = data.get("verlauf", data.get("trend", []))
    if not verlauf:
        return pd.DataFrame()

    rows = []
    for entry in verlauf:
        ts = entry.get("stunde") or entry.get("zeitpunkt") or entry.get("time")
        kwh = float(entry.get("sumKwh", entry.get("kwh", entry.get("avgLeistungKw", 0))))
        rows.append({"timestamp": pd.to_datetime(ts), "value": kwh})

    return pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)


async def fetch_production_history(hours: int = 168) -> pd.DataFrame:
    """Fetch overall production history (good parts + defects per hour)."""
    data = await call_mcp_tool("factory_get_production_history", {"hours": hours})

    verlauf = data.get("verlauf", [])
    if not verlauf:
        return pd.DataFrame()

    rows = []
    for entry in verlauf:
        ts = entry.get("stunde") or entry.get("zeitpunkt")
        rows.append({
            "timestamp": pd.to_datetime(ts),
            "good_parts": float(entry.get("gutTeile", entry.get("good_parts", 0))),
            "defective_parts": float(entry.get("ausschuss", entry.get("defective_parts", 0))),
        })

    return pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)
