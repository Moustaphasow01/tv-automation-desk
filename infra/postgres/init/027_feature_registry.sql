DO $$
BEGIN
  CREATE TYPE feature_definition_status AS ENUM ('ACTIVE', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE feature_version_status AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE feature_output_kind AS ENUM ('SCALAR', 'SERIES', 'EVENT', 'MAP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE feature_computation_status AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE feature_value_quality AS ENUM ('OK', 'GAP', 'DEGRADED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS feature_definitions (
  feature_definition_id uuid PRIMARY KEY,
  feature_key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  output_kind feature_output_kind NOT NULL,
  status feature_definition_status NOT NULL DEFAULT 'ACTIVE',
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_definitions_key_not_blank CHECK (length(trim(feature_key)) > 0),
  CONSTRAINT feature_definitions_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT feature_definitions_category_not_blank CHECK (length(trim(category)) > 0)
);

CREATE INDEX IF NOT EXISTS feature_definitions_status_category_idx
  ON feature_definitions (status, category);

CREATE TABLE IF NOT EXISTS feature_versions (
  feature_version_id uuid PRIMARY KEY,
  feature_definition_id uuid NOT NULL REFERENCES feature_definitions(feature_definition_id) ON DELETE RESTRICT,
  version text NOT NULL,
  status feature_version_status NOT NULL DEFAULT 'DRAFT',
  formula_ref text NOT NULL,
  formula_hash text,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  parameters_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  deterministic boolean NOT NULL DEFAULT true,
  point_in_time_safe boolean NOT NULL DEFAULT true,
  min_dataset_schema_version text,
  published_at_utc timestamptz,
  deprecated_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_definition_id, version),
  CONSTRAINT feature_versions_version_not_blank CHECK (length(trim(version)) > 0),
  CONSTRAINT feature_versions_formula_ref_not_blank CHECK (length(trim(formula_ref)) > 0),
  CONSTRAINT feature_versions_formula_hash_format CHECK (
    formula_hash IS NULL
    OR formula_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT feature_versions_published_is_safe CHECK (
    status <> 'PUBLISHED'
    OR (
      formula_hash IS NOT NULL
      AND deterministic = true
      AND point_in_time_safe = true
      AND published_at_utc IS NOT NULL
    )
  ),
  CONSTRAINT feature_versions_deprecated_has_timestamp CHECK (
    status <> 'DEPRECATED'
    OR deprecated_at_utc IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_versions_one_published_idx
  ON feature_versions (feature_definition_id)
  WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS feature_versions_status_idx
  ON feature_versions (status, feature_definition_id);

CREATE TABLE IF NOT EXISTS feature_computation_runs (
  feature_computation_run_id uuid PRIMARY KEY,
  feature_version_id uuid NOT NULL REFERENCES feature_versions(feature_version_id) ON DELETE RESTRICT,
  dataset_id uuid NOT NULL REFERENCES datasets(dataset_id) ON DELETE RESTRICT,
  parameters_hash text NOT NULL,
  status feature_computation_status NOT NULL DEFAULT 'RUNNING',
  engine_version text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  output_hash text,
  provenance_hash text,
  storage_ref text,
  started_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_version_id, dataset_id, parameters_hash),
  CONSTRAINT feature_computation_parameters_hash_format CHECK (
    parameters_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT feature_computation_output_hash_format CHECK (
    output_hash IS NULL
    OR output_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT feature_computation_provenance_hash_format CHECK (
    provenance_hash IS NULL
    OR provenance_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT feature_computation_engine_version_not_blank CHECK (length(trim(engine_version)) > 0),
  CONSTRAINT feature_computation_running_open CHECK (
    status <> 'RUNNING'
    OR (completed_at_utc IS NULL AND failure_code IS NULL AND failure_message IS NULL)
  ),
  CONSTRAINT feature_computation_completed_sealed CHECK (
    status <> 'COMPLETED'
    OR (
      completed_at_utc IS NOT NULL
      AND output_hash IS NOT NULL
      AND provenance_hash IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  CONSTRAINT feature_computation_failed_explained CHECK (
    status <> 'FAILED'
    OR failure_code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS feature_computation_runs_dataset_idx
  ON feature_computation_runs (dataset_id, status, completed_at_utc DESC);

CREATE INDEX IF NOT EXISTS feature_computation_runs_feature_idx
  ON feature_computation_runs (feature_version_id, status, completed_at_utc DESC);

CREATE TABLE IF NOT EXISTS feature_value_points (
  feature_value_id uuid PRIMARY KEY,
  feature_computation_run_id uuid NOT NULL REFERENCES feature_computation_runs(feature_computation_run_id) ON DELETE CASCADE,
  entity_key text NOT NULL,
  instrument_code text,
  timeframe text,
  observed_at_utc timestamptz NOT NULL,
  available_at_utc timestamptz NOT NULL,
  quality feature_value_quality NOT NULL DEFAULT 'OK',
  value_numeric double precision,
  value_json jsonb,
  source_row_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_computation_run_id, entity_key, timeframe, observed_at_utc),
  CONSTRAINT feature_value_points_entity_key_not_blank CHECK (length(trim(entity_key)) > 0),
  CONSTRAINT feature_value_points_available_after_observed CHECK (available_at_utc >= observed_at_utc),
  CONSTRAINT feature_value_points_has_value CHECK (
    value_numeric IS NOT NULL
    OR value_json IS NOT NULL
    OR quality <> 'OK'
  ),
  CONSTRAINT feature_value_points_source_hash_format CHECK (
    source_row_hash IS NULL
    OR source_row_hash ~ '^sha256:[a-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS feature_value_points_entity_time_idx
  ON feature_value_points (entity_key, timeframe, observed_at_utc DESC);

CREATE INDEX IF NOT EXISTS feature_value_points_quality_idx
  ON feature_value_points (quality, observed_at_utc DESC);
