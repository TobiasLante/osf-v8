import { Pool } from 'pg';
import { logger } from '../logger';

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = process.env.DB_PASSWORD;
  if (!pw) throw new Error('DB_PASSWORD environment variable is required');
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '30436';
  return `postgresql://osf_admin:${pw}@${host}:${port}/osf`;
}

export const pool = new Pool({
  connectionString: getDatabaseUrl(),
  max: 20,
  idleTimeoutMillis: 30000,
});

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
const MAX_CONSECUTIVE_ERRORS = 5;
let consecutiveErrors = 0;

pool.on('error', (err) => {
  consecutiveErrors++;
  logger.error({ err: err.message, consecutiveErrors }, 'Unexpected pool error');
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    logger.fatal({ consecutiveErrors }, 'DB circuit breaker tripped — too many consecutive errors, exiting');
    process.exit(1);
  }
});

/** Reset error counter on successful query (call after each successful pool.query) */
export function resetDbErrors(): void {
  if (consecutiveErrors > 0) {
    consecutiveErrors = 0;
  }
}

/** Check if DB is reachable (for readiness probes) */
export async function checkDbReady(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    resetDbErrors();
    return true;
  } catch {
    consecutiveErrors++;
    return false;
  }
}

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        tier TEXT DEFAULT 'free',
        api_key TEXT UNIQUE,
        api_key_hash TEXT,
        own_llm_key TEXT,
        locked_until TIMESTAMPTZ,
        failed_login_count INT DEFAULT 0,
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_id TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        result JSONB,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_id ON refresh_tokens(token_id);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'operational',
        category TEXT NOT NULL DEFAULT 'General',
        description TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        tools TEXT[] NOT NULL DEFAULT '{}',
        difficulty TEXT NOT NULL DEFAULT 'Beginner',
        icon TEXT DEFAULT '🤖',
        author_id UUID REFERENCES users(id),
        public BOOLEAN DEFAULT TRUE,
        open_source BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_chains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        steps JSONB NOT NULL DEFAULT '[]',
        icon TEXT DEFAULT '🔗',
        category TEXT DEFAULT 'General',
        difficulty TEXT DEFAULT 'Intermediate',
        author_id UUID REFERENCES users(id),
        open_source BOOLEAN DEFAULT FALSE,
        public BOOLEAN DEFAULT TRUE,
        featured BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chain_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        chain_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        result JSONB,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_chain_runs_user ON chain_runs(user_id);

      CREATE TABLE IF NOT EXISTS email_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);

      -- Node-RED internal flow storage (per user)
      CREATE TABLE IF NOT EXISTS nodered_flows (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        flow_json JSONB NOT NULL DEFAULT '[]',
        revision TEXT NOT NULL DEFAULT '1',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS nodered_credentials (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        credentials JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS nodered_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS nodered_library (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        meta JSONB DEFAULT '{}',
        body TEXT,
        UNIQUE(user_id, type, path)
      );

      -- User-visible flow metadata
      CREATE TABLE IF NOT EXISTS user_flows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        flow_tab_id TEXT NOT NULL,
        icon TEXT DEFAULT '🔀',
        flow_snapshot JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_flows_user ON user_flows(user_id);
      ALTER TABLE user_flows ADD COLUMN IF NOT EXISTS flow_snapshot JSONB;

      -- Flow execution runs
      CREATE TABLE IF NOT EXISTS flow_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        flow_id UUID REFERENCES user_flows(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'running',
        current_node TEXT,
        context JSONB DEFAULT '{}',
        result JSONB,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_flow_runs_user ON flow_runs(user_id);

      -- Persistent flow execution events (for polling)
      CREATE TABLE IF NOT EXISTS flow_run_events (
        id SERIAL PRIMARY KEY,
        run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
        seq INT NOT NULL,
        event JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_seq ON flow_run_events(run_id, seq);

      -- Human-in-the-loop pending inputs
      CREATE TABLE IF NOT EXISTS flow_pending_inputs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        prompt TEXT,
        options JSONB,
        response TEXT,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_flow_pending_user ON flow_pending_inputs(user_id);

      -- GitHub connections (OAuth tokens)
      CREATE TABLE IF NOT EXISTS github_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        github_username TEXT NOT NULL,
        github_id BIGINT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        scopes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_github_connections_user ON github_connections(user_id);

      -- Code agents (from GitHub repos)
      CREATE TABLE IF NOT EXISTS code_agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        repo_full_name TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '💻',
        entry TEXT DEFAULT 'src/main.ts',
        timeout_seconds INT DEFAULT 60,
        bundled_code TEXT,
        manifest JSONB,
        deploy_status TEXT DEFAULT 'pending',
        deploy_error TEXT,
        webhook_secret TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, repo_full_name)
      );
      CREATE INDEX IF NOT EXISTS idx_code_agents_user ON code_agents(user_id);
      CREATE INDEX IF NOT EXISTS idx_code_agents_repo ON code_agents(repo_full_name);

      -- Code agent execution runs
      CREATE TABLE IF NOT EXISTS code_agent_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES code_agents(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'running',
        logs JSONB DEFAULT '[]',
        result JSONB,
        execution_time_ms INT,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_code_agent_runs_agent ON code_agent_runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_code_agent_runs_user ON code_agent_runs(user_id);

      -- Code agent key-value storage (scoped per agent + user)
      CREATE TABLE IF NOT EXISTS code_agent_storage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES code_agents(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agent_id, user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_code_agent_storage_lookup ON code_agent_storage(agent_id, user_id);

      -- OAuth state tokens (short-lived, for CSRF protection across replicas)
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS news (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id UUID REFERENCES users(id),
        author_name TEXT,
        published BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_news_created ON news(created_at DESC);

      CREATE TABLE IF NOT EXISTS banner (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'news',
        active BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Node-RED pod management (multi-user per-pod architecture)
      CREATE TABLE IF NOT EXISTS nodered_pods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pod_name TEXT UNIQUE NOT NULL,
        pod_ip TEXT,
        status TEXT NOT NULL DEFAULT 'starting',
        assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        assigned_at TIMESTAMPTZ,
        last_activity TIMESTAMPTZ,
        nr_ready BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nodered_pods_status ON nodered_pods(status);
      CREATE INDEX IF NOT EXISTS idx_nodered_pods_user ON nodered_pods(assigned_user_id);

      -- Node-RED pod lifecycle events (for admin monitoring)
      CREATE TABLE IF NOT EXISTS nodered_pod_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pod_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        user_id UUID,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_nodered_pod_events_time ON nodered_pod_events(created_at);

      CREATE TABLE IF NOT EXISTS challenge_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL,
        status TEXT DEFAULT 'in_progress',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        score INT,
        metadata JSONB DEFAULT '{}',
        CONSTRAINT valid_status CHECK (status IN ('in_progress', 'completed', 'failed'))
      );
      CREATE INDEX IF NOT EXISTS idx_challenge_attempts_user ON challenge_attempts(user_id);
      CREATE INDEX IF NOT EXISTS idx_challenge_attempts_challenge ON challenge_attempts(challenge_id);
    `);

    // Add columns if they don't exist (for existing DBs)
    // Helper to run migration steps with proper logging
    const migrate = async (label: string, sql: string) => {
      try {
        await client.query(sql);
      } catch (err) {
        logger.warn({ migration: label, err: (err as Error).message }, 'Migration step failed (may be expected on fresh DB)');
      }
    };

    await migrate('users: security columns', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
    `);

    await migrate('agents: open_source column', `
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS open_source BOOLEAN DEFAULT FALSE;
    `);

    // Fix FK constraint on nodered_pods.assigned_user_id (add ON DELETE SET NULL)
    await migrate('nodered_pods: fix FK constraint', `
      DO $$ BEGIN
        ALTER TABLE nodered_pods DROP CONSTRAINT IF EXISTS nodered_pods_assigned_user_id_fkey;
        ALTER TABLE nodered_pods ADD CONSTRAINT nodered_pods_assigned_user_id_fkey
          FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    // LLM provider columns
    await migrate('users: LLM provider columns', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_provider TEXT DEFAULT 'platform';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_base_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_model TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_api_key_encrypted TEXT;
    `);

    // Avatar column
    await migrate('users: avatar column', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
    `);

    // Token quota columns
    await migrate('users: token quota columns', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_quota INT DEFAULT 100000;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_used INT DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_reset_at TIMESTAMPTZ DEFAULT NOW();
    `);

    // Role column
    await migrate('users: role column', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
    `);

    // Newsletter consent columns
    await migrate('users: marketing consent columns', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
    `);

    // Version columns on agent tables (marketplace)
    await migrate('agents/chains/code_agents: version columns', `
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
      ALTER TABLE agent_chains ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
      ALTER TABLE code_agents ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
    `);

    // User deployed agents (marketplace)
    await migrate('user_deployed_agents: create table', `
      CREATE TABLE IF NOT EXISTS user_deployed_agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version INT DEFAULT 1,
        deploy_mode TEXT NOT NULL,
        custom_name TEXT,
        custom_config JSONB,
        pinned_version INT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, source_type, source_id, deploy_mode)
      );
      CREATE INDEX IF NOT EXISTS idx_deployed_agents_user ON user_deployed_agents(user_id);
    `);

    // Flow publish columns
    await migrate('user_flows: publish columns', `
      ALTER TABLE user_flows ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
      ALTER TABLE user_flows ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
      ALTER TABLE user_flows ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'Beginner';
    `);

    // Missing index on flow_runs.flow_id (FK without index = slow cascading deletes)
    await migrate('flow_runs: add flow_id index', `
      CREATE INDEX IF NOT EXISTS idx_flow_runs_flow ON flow_runs(flow_id);
    `);

    // Hash all plaintext API keys and clear plaintext column
    try {
      const plaintext = await client.query(
        `SELECT id, api_key FROM users WHERE api_key IS NOT NULL AND (api_key_hash IS NULL OR api_key_hash = '')`
      );
      if (plaintext.rows.length > 0) {
        const crypto = await import('crypto');
        for (const row of plaintext.rows) {
          const hash = crypto.createHash('sha256').update(row.api_key).digest('hex');
          await client.query(`UPDATE users SET api_key_hash = $1, api_key = NULL WHERE id = $2`, [hash, row.id]);
        }
        logger.info({ count: plaintext.rows.length }, 'Migrated plaintext API keys to hashed');
      }
      // Clear any remaining plaintext keys
      await client.query(`UPDATE users SET api_key = NULL WHERE api_key IS NOT NULL`);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'API key hash migration failed (may be expected on fresh DB)');
    }

    // Set admin role for tobias.lante@ttpsc.com
    await migrate('admin: set admin role', `
      UPDATE users SET role = 'admin' WHERE email = 'tobias.lante@ttpsc.com' AND (role IS NULL OR role = 'user');
    `);

    logger.info('Schema initialized');
  } finally {
    client.release();
  }
}
