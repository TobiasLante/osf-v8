import os

# MCP Server (Factory Sim) for fetching training data
MCP_URL = os.getenv("MCP_URL", "http://factory-v3-fertigung.factory.svc.cluster.local:8020/mcp")

# Neo4j for caching predictions
NEO4J_URL = os.getenv("NEO4J_URL", "bolt://osf-neo4j.osf.svc.cluster.local:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "zeroguess2026")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")

# ML Settings
TRAINING_TIME_LIMIT = int(os.getenv("TRAINING_TIME_LIMIT", "300"))  # 5 min per model
MIN_DATA_POINTS = int(os.getenv("MIN_DATA_POINTS", "10"))
PREDICTION_HORIZON_DAY = 24
PREDICTION_HORIZON_WEEK = 168
PREDICTION_HORIZON_MONTH = 720

# Server
PORT = int(os.getenv("PORT", "8040"))
