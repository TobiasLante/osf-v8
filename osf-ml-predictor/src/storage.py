"""
Neo4j storage for cached predictions and regression results.
"""

import json
import uuid
from datetime import datetime, timedelta
from neo4j import AsyncGraphDatabase
from .config import NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE

_driver = None

def get_driver():
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(NEO4J_URL, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _driver

async def close_driver():
    global _driver
    if _driver:
        await _driver.close()
        _driver = None

async def store_prediction(machine_id: str, field: str, horizon: str, result: dict) -> str:
    """Store a prediction result in Neo4j."""
    pred_id = str(uuid.uuid4())
    driver = get_driver()
    async with driver.session(database=NEO4J_DATABASE) as session:
        await session.run("""
            MERGE (p:Prediction {machineId: $machineId, fieldName: $field, horizon: $horizon})
            SET p.id = $id,
                p.predictions = $predictions,
                p.historical = $historical,
                p.metrics = $metrics,
                p.trainedAt = datetime(),
                p.dataPointsUsed = $dataPoints,
                p.expiresAt = datetime() + duration({hours: 24})
        """, {
            "id": pred_id,
            "machineId": machine_id,
            "field": field,
            "horizon": horizon,
            "predictions": json.dumps(result.get("predictions", [])),
            "historical": json.dumps(result.get("historical", [])),
            "metrics": json.dumps(result.get("metrics", {})),
            "dataPoints": result.get("metrics", {}).get("dataPoints", 0),
        })
    return pred_id

async def get_cached_prediction(machine_id: str, field: str, horizon: str) -> dict | None:
    """Get a cached prediction if it exists and hasn't expired."""
    driver = get_driver()
    async with driver.session(database=NEO4J_DATABASE) as session:
        result = await session.run("""
            MATCH (p:Prediction {machineId: $machineId, fieldName: $field, horizon: $horizon})
            WHERE p.expiresAt > datetime()
            RETURN p
        """, {"machineId": machine_id, "field": field, "horizon": horizon})
        record = await result.single()
        if not record:
            return None
        p = record["p"]
        return {
            "predictions": json.loads(p["predictions"]),
            "historical": json.loads(p["historical"]),
            "metrics": json.loads(p["metrics"]),
            "trainedAt": str(p["trainedAt"]),
        }

async def store_regression(machine_id: str, target: str, result: dict) -> str:
    """Store a regression result in Neo4j."""
    reg_id = str(uuid.uuid4())
    driver = get_driver()
    async with driver.session(database=NEO4J_DATABASE) as session:
        await session.run("""
            MERGE (r:Regression {machineId: $machineId, targetField: $target})
            SET r.id = $id,
                r.features = $features,
                r.rSquared = $rSquared,
                r.correlationMatrix = $corrMatrix,
                r.trainedAt = datetime(),
                r.dataPointsUsed = $dataPoints
        """, {
            "id": reg_id,
            "machineId": machine_id,
            "target": target,
            "features": json.dumps(result.get("features", [])),
            "rSquared": result.get("rSquared"),
            "corrMatrix": json.dumps(result.get("correlationMatrix", {})),
            "dataPoints": result.get("dataPoints", 0),
        })
    return reg_id
