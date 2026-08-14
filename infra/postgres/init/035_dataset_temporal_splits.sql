DO $$
BEGIN
  CREATE TYPE dataset_split_role AS ENUM ('TRAIN', 'VALIDATION', 'OUT_OF_SAMPLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE dataset_split_leakage_status AS ENUM ('PASS', 'FAIL', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS dataset_temporal_splits (
  dataset_temporal_split_id uuid PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES datasets(dataset_id) ON DELETE RESTRICT,
  split_key text NOT NULL UNIQUE,
  split_schema_version text NOT NULL,
  split_policy_id text NOT NULL,
  split_policy_version text NOT NULL,
  split_policy_hash text NOT NULL,
  split_hash text NOT NULL UNIQUE,
  train_start_utc timestamptz NOT NULL,
  train_end_utc timestamptz NOT NULL,
  validation_start_utc timestamptz NOT NULL,
  validation_end_utc timestamptz NOT NULL,
  out_of_sample_start_utc timestamptz NOT NULL,
  out_of_sample_end_utc timestamptz NOT NULL,
  split_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_temporal_splits_key_not_blank CHECK (length(trim(split_key)) > 0),
  CONSTRAINT dataset_temporal_splits_schema_not_blank CHECK (length(trim(split_schema_version)) > 0),
  CONSTRAINT dataset_temporal_splits_policy_id_not_blank CHECK (length(trim(split_policy_id)) > 0),
  CONSTRAINT dataset_temporal_splits_policy_version_not_blank CHECK (length(trim(split_policy_version)) > 0),
  CONSTRAINT dataset_temporal_splits_policy_hash_format CHECK (split_policy_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT dataset_temporal_splits_hash_format CHECK (split_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT dataset_temporal_splits_time_order CHECK (
    train_start_utc < train_end_utc
    AND train_end_utc <= validation_start_utc
    AND validation_start_utc < validation_end_utc
    AND validation_end_utc <= out_of_sample_start_utc
    AND out_of_sample_start_utc < out_of_sample_end_utc
  )
);

CREATE INDEX IF NOT EXISTS dataset_temporal_splits_dataset_idx
  ON dataset_temporal_splits (dataset_id, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS dataset_temporal_splits_hash_idx
  ON dataset_temporal_splits (split_hash);

CREATE INDEX IF NOT EXISTS dataset_temporal_splits_ranges_idx
  ON dataset_temporal_splits (train_start_utc, out_of_sample_end_utc);

CREATE TABLE IF NOT EXISTS simulation_run_split_usage (
  simulation_run_id uuid PRIMARY KEY REFERENCES simulation_runs(simulation_run_id) ON DELETE CASCADE,
  dataset_temporal_split_id uuid NOT NULL REFERENCES dataset_temporal_splits(dataset_temporal_split_id) ON DELETE RESTRICT,
  split_role dataset_split_role NOT NULL,
  split_hash text NOT NULL,
  cutoff_utc timestamptz NOT NULL,
  source_data_end_utc timestamptz NOT NULL,
  training_cutoff_utc timestamptz,
  candidate_selection_cutoff_utc timestamptz,
  leakage_status dataset_split_leakage_status NOT NULL,
  leakage_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_run_split_usage_hash_format CHECK (split_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT simulation_run_split_usage_source_lte_cutoff CHECK (source_data_end_utc <= cutoff_utc)
);

CREATE INDEX IF NOT EXISTS simulation_run_split_usage_split_idx
  ON simulation_run_split_usage (dataset_temporal_split_id, split_role);

CREATE INDEX IF NOT EXISTS simulation_run_split_usage_leakage_idx
  ON simulation_run_split_usage (leakage_status, created_at_utc DESC);
