-- Additive, simulation-owned technical registry; no legacy signals or orders.
BEGIN;
CREATE TABLE IF NOT EXISTS oos_batch_days (
  batch_id text NOT NULL,
  day text NOT NULL CHECK (day ~ '^2026-(07|08)-[0-9]{2}$'),
  definition jsonb NOT NULL,
  state text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW','CAPTURING','PREMARKET_READY','WAITING_SCENARIO',
    'PLAN_RECEIVED','VALIDATING_PLAN','FROZEN','REPLAYING','CAPTURING_RESULTS','COMPLETED','FAILED_TECHNICAL','FAILED_PLAN_VALIDATION')),
  checkpoint text NOT NULL DEFAULT 'NEW' CHECK (checkpoint IN ('NEW','CAPTURING','PREMARKET_READY','WAITING_SCENARIO',
    'PLAN_RECEIVED','VALIDATING_PLAN','FROZEN','REPLAYING','CAPTURING_RESULTS','COMPLETED')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  candidate_attempt integer NOT NULL DEFAULT 1 CHECK (candidate_attempt > 0),
  capture_count integer NOT NULL DEFAULT 0 CHECK (capture_count BETWEEN 0 AND 8),
  manifest_sha256 text CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 text CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  audit jsonb,
  run_meta jsonb,
  error jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (batch_id,day),
  CHECK (checkpoint NOT IN ('FROZEN','REPLAYING','CAPTURING_RESULTS','COMPLETED')
    OR (plan_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND capture_count = 8))
);
CREATE TABLE IF NOT EXISTS oos_batch_events (
  batch_id text NOT NULL,
  day text NOT NULL,
  revision bigint NOT NULL,
  state text NOT NULL,
  checkpoint text NOT NULL,
  occurred_at timestamptz NOT NULL,
  error jsonb,
  PRIMARY KEY (batch_id,day,revision),
  FOREIGN KEY (batch_id,day) REFERENCES oos_batch_days(batch_id,day)
);
CREATE OR REPLACE FUNCTION protect_oos_frozen_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.definition IS DISTINCT FROM NEW.definition
    OR (OLD.plan_sha256 IS NOT NULL AND OLD.plan_sha256 IS DISTINCT FROM NEW.plan_sha256)
    OR (OLD.manifest_sha256 IS NOT NULL AND OLD.manifest_sha256 IS DISTINCT FROM NEW.manifest_sha256) THEN
    RAISE EXCEPTION 'OOS_IMMUTABLE_IDENTITY';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS oos_frozen_identity ON oos_batch_days;
CREATE TRIGGER oos_frozen_identity BEFORE UPDATE ON oos_batch_days
  FOR EACH ROW EXECUTE FUNCTION protect_oos_frozen_identity();
CREATE TABLE IF NOT EXISTS oos_batch_commands (
  command_id text PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED')),
  next_day integer NOT NULL DEFAULT 0 CHECK (next_day >= 0),
  receipts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS oos_batch_commands_pending ON oos_batch_commands(created_at,command_id)
  WHERE status IN ('QUEUED','RUNNING');
COMMIT;
