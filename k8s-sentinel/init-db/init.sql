-- Reference SQL — schema is created by agent on startup

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  namespace TEXT,
  resource_kind TEXT,
  resource_name TEXT,
  description TEXT,
  diagnosis TEXT,
  proposed_fix TEXT,
  fix_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  pods_total INT,
  pods_healthy INT,
  nodes_total INT,
  nodes_ready INT,
  issues_found INT,
  fixes_applied INT
);

CREATE TABLE IF NOT EXISTS cluster_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
