-- Simulation-owned technical progress only. Frozen identities/results are untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS oos_replay_progress (
  batch_id text NOT NULL,
  day text NOT NULL,
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  replay_current_time timestamptz NOT NULL,
  replay_target_time timestamptz NOT NULL,
  last_confirmed_bar_time timestamptz NOT NULL,
  steps_completed integer NOT NULL CHECK (steps_completed >= 0),
  last_success_at timestamptz NOT NULL,
  retry_count integer NOT NULL CHECK (retry_count >= 0),
  last_error jsonb,
  browser_session_id text,
  tv_replay_state jsonb NOT NULL,
  config_hash text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (batch_id,day),
  FOREIGN KEY (batch_id,day) REFERENCES oos_batch_days(batch_id,day)
);
COMMIT;
