CREATE TABLE IF NOT EXISTS strategy_runtime_evaluations (
  strategy_evaluation_id text PRIMARY KEY,
  strategy_instance_id uuid NOT NULL REFERENCES strategy_instances(strategy_instance_id) ON DELETE CASCADE,
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(strategy_version_id) ON DELETE RESTRICT,
  certification_run_id text,
  source_class text NOT NULL CHECK (source_class IN ('LIVE', 'SHADOW', 'CERTIFICATION_REPLAY')),
  status text NOT NULL CHECK (status IN ('NO_SIGNAL', 'SIGNAL_CREATED', 'FAILED')),
  scheduler_run_key text NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  causation_id text,
  artifact_version text,
  instrument text NOT NULL,
  timeframe text NOT NULL,
  source_data_cutoff_utc timestamptz NOT NULL,
  started_at_utc timestamptz NOT NULL,
  completed_at_utc timestamptz NOT NULL,
  next_evaluation_at_utc timestamptz,
  signal_id text,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE strategy_signal_outbox
  ADD COLUMN IF NOT EXISTS source_class text NOT NULL DEFAULT 'LIVE',
  ADD COLUMN IF NOT EXISTS certification_run_id text;

ALTER TABLE strategy_signal_outbox
  DROP CONSTRAINT IF EXISTS strategy_signal_outbox_source_class_check;

ALTER TABLE strategy_signal_outbox
  ADD CONSTRAINT strategy_signal_outbox_source_class_check
  CHECK (source_class IN ('LIVE', 'SHADOW', 'CERTIFICATION_REPLAY'));

CREATE INDEX IF NOT EXISTS strategy_signal_outbox_certification_idx
  ON strategy_signal_outbox(certification_run_id, generated_at_utc DESC)
  WHERE certification_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS strategy_runtime_evaluations_instance_time_idx
  ON strategy_runtime_evaluations(strategy_instance_id, completed_at_utc DESC);

CREATE INDEX IF NOT EXISTS strategy_runtime_evaluations_certification_idx
  ON strategy_runtime_evaluations(certification_run_id, completed_at_utc DESC)
  WHERE certification_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS domain_event_outbox (
  domain_event_id text PRIMARY KEY,
  aggregate_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_sequence bigint NOT NULL CHECK (aggregate_sequence >= 1),
  event_type text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  occurred_at_utc timestamptz NOT NULL,
  received_at_utc timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  schema_version text NOT NULL DEFAULT '1.0.0',
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, aggregate_sequence)
);

CREATE INDEX IF NOT EXISTS domain_event_outbox_stream_idx
  ON domain_event_outbox(created_at_utc, domain_event_id);

CREATE INDEX IF NOT EXISTS domain_event_outbox_correlation_idx
  ON domain_event_outbox(correlation_id, created_at_utc);
