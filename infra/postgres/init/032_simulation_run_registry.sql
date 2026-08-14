DO $$
BEGIN
  CREATE TYPE simulation_run_status AS ENUM (
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'REJECTED',
    'REVIEW_REQUIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE simulation_run_artifact_kind AS ENUM (
    'INPUT_MANIFEST',
    'ORDER_SIMULATION_POLICY',
    'RESULT',
    'METRICS',
    'EVENTS',
    'POSITIONS',
    'ROBUSTNESS_REPORT',
    'ERROR'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS simulation_runs (
  simulation_run_id uuid PRIMARY KEY,
  source_run_id text,
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(strategy_version_id) ON DELETE RESTRICT,
  dataset_id uuid NOT NULL REFERENCES datasets(dataset_id) ON DELETE RESTRICT,
  parameters_hash text NOT NULL,
  reproducibility_seed text NOT NULL,
  status simulation_run_status NOT NULL DEFAULT 'QUEUED',
  simulation_engine text NOT NULL DEFAULT 'desk-replay-engine',
  simulation_engine_version text NOT NULL,
  result_schema_version text NOT NULL,
  cutoff text NOT NULL,
  dataset_hash text NOT NULL,
  compiled_artifact_hash text,
  result_hash text,
  metrics_hash text,
  result_ref text,
  metrics_ref text,
  started_at_utc timestamptz,
  completed_at_utc timestamptz,
  failure_code text,
  failure_message text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_runs_seed_not_blank CHECK (length(trim(reproducibility_seed)) > 0),
  CONSTRAINT simulation_runs_engine_not_blank CHECK (length(trim(simulation_engine)) > 0),
  CONSTRAINT simulation_runs_engine_version_not_blank CHECK (length(trim(simulation_engine_version)) > 0),
  CONSTRAINT simulation_runs_schema_version_not_blank CHECK (length(trim(result_schema_version)) > 0),
  CONSTRAINT simulation_runs_cutoff_not_blank CHECK (length(trim(cutoff)) > 0),
  CONSTRAINT simulation_runs_parameters_hash_format CHECK (parameters_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT simulation_runs_dataset_hash_format CHECK (dataset_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT simulation_runs_compiled_artifact_hash_format CHECK (
    compiled_artifact_hash IS NULL
    OR compiled_artifact_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT simulation_runs_result_hash_format CHECK (
    result_hash IS NULL
    OR result_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT simulation_runs_metrics_hash_format CHECK (
    metrics_hash IS NULL
    OR metrics_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT simulation_runs_completed_has_hashes CHECK (
    status <> 'COMPLETED'
    OR (
      completed_at_utc IS NOT NULL
      AND result_hash IS NOT NULL
      AND metrics_hash IS NOT NULL
      AND result_ref IS NOT NULL
      AND metrics_ref IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  CONSTRAINT simulation_runs_failed_explained CHECK (
    status NOT IN ('FAILED', 'REJECTED')
    OR failure_code IS NOT NULL
    OR result_hash IS NOT NULL
  ),
  CONSTRAINT simulation_runs_terminal_closed CHECK (
    status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED', 'REVIEW_REQUIRED')
    OR completed_at_utc IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS simulation_runs_idempotency_idx
  ON simulation_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS simulation_runs_reproducibility_idx
  ON simulation_runs (strategy_version_id, dataset_id, parameters_hash, reproducibility_seed);

CREATE INDEX IF NOT EXISTS simulation_runs_status_started_idx
  ON simulation_runs (status, started_at_utc DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS simulation_runs_metrics_hash_idx
  ON simulation_runs (metrics_hash)
  WHERE metrics_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS simulation_run_artifacts (
  simulation_run_artifact_id uuid PRIMARY KEY,
  simulation_run_id uuid NOT NULL REFERENCES simulation_runs(simulation_run_id) ON DELETE CASCADE,
  artifact_kind simulation_run_artifact_kind NOT NULL,
  schema_version text NOT NULL,
  content_hash text NOT NULL,
  storage_ref text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (simulation_run_id, artifact_kind, content_hash),
  CONSTRAINT simulation_run_artifacts_schema_version_not_blank CHECK (length(trim(schema_version)) > 0),
  CONSTRAINT simulation_run_artifacts_storage_ref_not_blank CHECK (length(trim(storage_ref)) > 0),
  CONSTRAINT simulation_run_artifacts_content_hash_format CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS simulation_run_artifacts_run_kind_idx
  ON simulation_run_artifacts (simulation_run_id, artifact_kind);

CREATE INDEX IF NOT EXISTS simulation_run_artifacts_hash_idx
  ON simulation_run_artifacts (content_hash);

CREATE TABLE IF NOT EXISTS simulation_run_audit_events (
  simulation_run_audit_event_id uuid PRIMARY KEY,
  simulation_run_id uuid NOT NULL REFERENCES simulation_runs(simulation_run_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  idempotency_key text,
  actor text NOT NULL,
  reason text,
  previous_status simulation_run_status,
  next_status simulation_run_status,
  previous_hash text,
  next_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_run_audit_events_type_not_blank CHECK (length(trim(event_type)) > 0),
  CONSTRAINT simulation_run_audit_events_actor_not_blank CHECK (length(trim(actor)) > 0),
  CONSTRAINT simulation_run_audit_previous_hash_format CHECK (
    previous_hash IS NULL
    OR previous_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT simulation_run_audit_next_hash_format CHECK (
    next_hash IS NULL
    OR next_hash ~ '^sha256:[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS simulation_run_audit_events_idempotency_idx
  ON simulation_run_audit_events (simulation_run_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS simulation_run_audit_events_run_idx
  ON simulation_run_audit_events (simulation_run_id, created_at_utc DESC);

CREATE OR REPLACE FUNCTION prevent_terminal_simulation_run_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED', 'REVIEW_REQUIRED') THEN
    IF NEW.strategy_version_id IS DISTINCT FROM OLD.strategy_version_id
      OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
      OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
      OR NEW.reproducibility_seed IS DISTINCT FROM OLD.reproducibility_seed
      OR NEW.result_hash IS DISTINCT FROM OLD.result_hash
      OR NEW.metrics_hash IS DISTINCT FROM OLD.metrics_hash
      OR NEW.result_ref IS DISTINCT FROM OLD.result_ref
      OR NEW.metrics_ref IS DISTINCT FROM OLD.metrics_ref
      OR NEW.dataset_hash IS DISTINCT FROM OLD.dataset_hash THEN
      RAISE EXCEPTION 'TERMINAL_SIMULATION_RUN_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS simulation_runs_terminal_immutable_trg ON simulation_runs;
CREATE TRIGGER simulation_runs_terminal_immutable_trg
  BEFORE UPDATE ON simulation_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_terminal_simulation_run_mutation();

CREATE OR REPLACE FUNCTION prevent_simulation_artifact_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.simulation_run_id IS DISTINCT FROM OLD.simulation_run_id
    OR NEW.artifact_kind IS DISTINCT FROM OLD.artifact_kind
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'SIMULATION_RUN_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS simulation_run_artifacts_immutable_trg ON simulation_run_artifacts;
CREATE TRIGGER simulation_run_artifacts_immutable_trg
  BEFORE UPDATE ON simulation_run_artifacts
  FOR EACH ROW EXECUTE FUNCTION prevent_simulation_artifact_mutation();
