"""
MCP JSON-RPC Handler — exposes ML tools to the Gateway.
"""

from .data_fetcher import fetch_oee_history, fetch_scrap_history, fetch_energy_history
from .predictor import predict_time_series, regression_analysis
from .storage import store_prediction, get_cached_prediction
from .config import PREDICTION_HORIZON_DAY, PREDICTION_HORIZON_WEEK, PREDICTION_HORIZON_MONTH

TOOLS = [
    {
        "name": "ml_predict_oee",
        "description": "Predict OEE trend for a machine over the next day/week/month using AutoGluon time-series forecasting. Returns historical data + forecast with confidence intervals. Result includes _chartConfig for visualization.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "machineId": {"type": "string", "description": "Machine ID (e.g. SGM-004, 7533)"},
                "horizon": {"type": "string", "enum": ["day", "week", "month"], "description": "Prediction horizon (default: week)"},
            },
            "required": ["machineId"],
        },
    },
    {
        "name": "ml_predict_scrap",
        "description": "Predict scrap rate trend using time-series forecasting. Returns forecast with confidence intervals.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "machineId": {"type": "string", "description": "Machine ID"},
                "horizon": {"type": "string", "enum": ["day", "week", "month"], "description": "Prediction horizon (default: week)"},
            },
            "required": ["machineId"],
        },
    },
    {
        "name": "ml_predict_energy",
        "description": "Predict energy consumption trend for a machine.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "machineId": {"type": "string", "description": "Machine ID"},
                "horizon": {"type": "string", "enum": ["day", "week", "month"], "description": "Prediction horizon (default: week)"},
            },
            "required": ["machineId"],
        },
    },
    {
        "name": "ml_regression_analysis",
        "description": "Analyze which factors drive a target metric (e.g. scrap rate). Returns feature importance, correlation matrix, and R² score. Use to answer 'what causes high scrap on SGM-004?'",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "Target metric to analyze (e.g. 'scrap_rate', 'oee', 'energy_kwh')"},
            },
            "required": ["target"],
        },
    },
]

HORIZON_MAP = {
    "day": PREDICTION_HORIZON_DAY,
    "week": PREDICTION_HORIZON_WEEK,
    "month": PREDICTION_HORIZON_MONTH,
}

def build_chart_config(result: dict, title: str, y_label: str) -> dict:
    """Build Chart.js config from prediction result."""
    hist = result.get("historical", [])
    preds = result.get("predictions", [])

    labels = [h["date"] for h in hist] + [p["date"] for p in preds]
    hist_values = [h["value"] for h in hist] + [None] * len(preds)
    pred_values = [None] * len(hist) + [p["value"] for p in preds]
    lower = [None] * len(hist) + [p.get("lower") for p in preds]
    upper = [None] * len(hist) + [p.get("upper") for p in preds]

    return {
        "type": "line",
        "title": title,
        "xAxis": "Time",
        "yAxis": y_label,
        "data": {
            "labels": labels,
            "datasets": [
                {"label": "Historical", "data": hist_values, "borderColor": "#3b82f6", "borderWidth": 2, "pointRadius": 0, "fill": False},
                {"label": "Forecast", "data": pred_values, "borderColor": "#ff9500", "borderDash": [5, 5], "borderWidth": 2, "pointRadius": 0, "fill": False},
                {"label": "Confidence Band", "data": upper, "borderColor": "rgba(255,149,0,0.2)", "backgroundColor": "rgba(255,149,0,0.1)", "fill": "+1", "pointRadius": 0, "borderWidth": 0},
                {"label": "_lower", "data": lower, "borderColor": "rgba(255,149,0,0.2)", "backgroundColor": "rgba(255,149,0,0.1)", "fill": False, "pointRadius": 0, "borderWidth": 0},
            ],
        },
    }


async def handle_tools_list() -> list:
    return TOOLS


async def handle_tool_call(name: str, args: dict) -> dict:
    machine_id = args.get("machineId", "")
    horizon = args.get("horizon", "week")
    prediction_length = HORIZON_MAP.get(horizon, PREDICTION_HORIZON_WEEK)

    if name == "ml_predict_oee":
        # Check cache
        cached = await get_cached_prediction(machine_id, "oee", horizon)
        if cached:
            return {"_chartConfig": build_chart_config(cached, f"OEE Forecast {machine_id} ({horizon})", "OEE"), **cached, "source": "cache"}

        df = await fetch_oee_history(machine_id, hours=prediction_length * 3)
        result = await predict_time_series(df, prediction_length=prediction_length, field_name="oee")
        await store_prediction(machine_id, "oee", horizon, result)
        return {"_chartConfig": build_chart_config(result, f"OEE Forecast {machine_id} ({horizon})", "OEE"), **result}

    elif name == "ml_predict_scrap":
        cached = await get_cached_prediction(machine_id, "scrap", horizon)
        if cached:
            return {"_chartConfig": build_chart_config(cached, f"Scrap Rate Forecast {machine_id} ({horizon})", "Scrap Rate"), **cached, "source": "cache"}

        df = await fetch_scrap_history(machine_id, hours=prediction_length * 3)
        result = await predict_time_series(df, prediction_length=prediction_length, field_name="scrap_rate")
        await store_prediction(machine_id, "scrap", horizon, result)
        return {"_chartConfig": build_chart_config(result, f"Scrap Rate Forecast {machine_id} ({horizon})", "Scrap Rate"), **result}

    elif name == "ml_predict_energy":
        cached = await get_cached_prediction(machine_id, "energy", horizon)
        if cached:
            return {"_chartConfig": build_chart_config(cached, f"Energy Forecast {machine_id} ({horizon})", "kWh"), **cached, "source": "cache"}

        df = await fetch_energy_history(machine_id, hours=prediction_length * 3)
        result = await predict_time_series(df, prediction_length=prediction_length, field_name="energy_kwh")
        await store_prediction(machine_id, "energy", horizon, result)
        return {"_chartConfig": build_chart_config(result, f"Energy Forecast {machine_id} ({horizon})", "kWh"), **result}

    elif name == "ml_regression_analysis":
        from .data_fetcher import fetch_production_history
        df = await fetch_production_history(hours=168)
        if df.empty:
            return {"error": "No production data available"}

        target = args.get("target", "defective_parts")
        feature_cols = [c for c in df.columns if c not in ["timestamp", target]]
        result = await regression_analysis(df, target, feature_cols)
        return result

    else:
        return {"error": f"Unknown tool: {name}"}
