-- OOS-only technical probe. Never connected to a plan, order or trading event.
BEGIN;
CREATE TABLE IF NOT EXISTS oos_batch_write_probe (
  value_hash text PRIMARY KEY CHECK (value_hash ~ '^[a-f0-9]{64}$'),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
  written_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL DEFAULT 'mcp' CHECK (source = 'mcp')
);
-- One-time OAuth code redemption survives restarts of the isolated OOS host.
CREATE TABLE IF NOT EXISTS oos_batch_oauth_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
