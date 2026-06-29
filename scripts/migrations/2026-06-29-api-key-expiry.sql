-- Add per-user API-key expiry.
-- NULL = never expires (default for existing keys, and for sales/owner keys).
-- timestamptz > NOW() required for the key to authenticate (enforced in osf-gateway middleware).

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_expires_at timestamptz;
COMMENT ON COLUMN users.api_key_expires_at IS 'When the api_key stops working. NULL = never expires.';

-- Optional helper: index for cheap expiry-sweeps. Partial: only rows with an expiry.
CREATE INDEX IF NOT EXISTS users_api_key_expires_at_idx
  ON users (api_key_expires_at)
  WHERE api_key_expires_at IS NOT NULL;
