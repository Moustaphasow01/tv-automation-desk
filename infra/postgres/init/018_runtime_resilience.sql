CREATE TABLE IF NOT EXISTS desk_maintenance_runs (
  maintenance_run_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desk_maintenance_runs_time_idx
  ON desk_maintenance_runs(started_at_utc DESC);

CREATE TABLE IF NOT EXISTS desk_deployment_runs (
  deployment_id text PRIMARY KEY,
  release_version text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'draining', 'drained', 'switching', 'verifying', 'verified', 'rolled_back', 'failed'
  )),
  previous_claim_controls jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_execution_lock jsonb,
  drain_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at_utc timestamptz NOT NULL DEFAULT now(),
  drained_at_utc timestamptz,
  completed_at_utc timestamptz,
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desk_deployment_runs_time_idx
  ON desk_deployment_runs(started_at_utc DESC);

ALTER TABLE desk_service_heartbeats
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_state text NOT NULL DEFAULT 'closed',
  ADD COLUMN IF NOT EXISTS next_retry_at_utc timestamptz;

DO $$
BEGIN
  ALTER TABLE desk_service_heartbeats
    ADD CONSTRAINT desk_service_heartbeats_circuit_state_check
    CHECK (circuit_state IN ('closed', 'open', 'half_open'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
