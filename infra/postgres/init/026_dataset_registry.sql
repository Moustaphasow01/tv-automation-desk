DO $$
BEGIN
  CREATE TYPE dataset_status AS ENUM ('BUILDING', 'READY', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS datasets (
  dataset_id uuid PRIMARY KEY,
  dataset_key text NOT NULL UNIQUE,
  name text NOT NULL,
  status dataset_status NOT NULL DEFAULT 'BUILDING',
  time_range_start_utc timestamptz,
  time_range_end_utc timestamptz,
  cutoff_utc timestamptz,
  cutoff_paris text,
  cutoff_timezone text NOT NULL DEFAULT 'Europe/Paris',
  schema_version text NOT NULL,
  source_batch_count integer NOT NULL DEFAULT 0 CHECK (source_batch_count >= 0),
  content_hash text,
  provenance_hash text,
  build_parameters_hash text,
  rebuilt_from_dataset_id uuid REFERENCES datasets(dataset_id) ON DELETE SET NULL,
  archived_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT datasets_dataset_key_not_blank CHECK (length(trim(dataset_key)) > 0),
  CONSTRAINT datasets_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT datasets_schema_version_not_blank CHECK (length(trim(schema_version)) > 0),
  CONSTRAINT datasets_time_range_order CHECK (
    time_range_start_utc IS NULL
    OR time_range_end_utc IS NULL
    OR time_range_end_utc >= time_range_start_utc
  ),
  CONSTRAINT datasets_cutoff_within_or_after_range CHECK (
    cutoff_utc IS NULL
    OR time_range_end_utc IS NULL
    OR cutoff_utc >= time_range_end_utc
  ),
  CONSTRAINT datasets_content_hash_format CHECK (
    content_hash IS NULL
    OR content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT datasets_provenance_hash_format CHECK (
    provenance_hash IS NULL
    OR provenance_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT datasets_build_parameters_hash_format CHECK (
    build_parameters_hash IS NULL
    OR build_parameters_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT datasets_ready_is_sealed CHECK (
    status <> 'READY'
    OR (
      time_range_start_utc IS NOT NULL
      AND time_range_end_utc IS NOT NULL
      AND cutoff_utc IS NOT NULL
      AND cutoff_paris IS NOT NULL
      AND source_batch_count > 0
      AND content_hash IS NOT NULL
      AND provenance_hash IS NOT NULL
    )
  ),
  CONSTRAINT datasets_archived_has_timestamp CHECK (
    status <> 'ARCHIVED'
    OR archived_at_utc IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS datasets_provenance_hash_unique_idx
  ON datasets (provenance_hash)
  WHERE provenance_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS datasets_status_cutoff_idx
  ON datasets (status, cutoff_utc DESC);

CREATE INDEX IF NOT EXISTS datasets_time_range_idx
  ON datasets (time_range_start_utc, time_range_end_utc);

CREATE TABLE IF NOT EXISTS dataset_ingestion_batches (
  dataset_id uuid NOT NULL REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  ingestion_batch_id uuid NOT NULL REFERENCES ingestion_batches(ingestion_batch_id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  role text NOT NULL DEFAULT 'source',
  included_record_count integer NOT NULL DEFAULT 0 CHECK (included_record_count >= 0),
  source_provenance_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, ingestion_batch_id),
  UNIQUE (dataset_id, ordinal),
  CONSTRAINT dataset_ingestion_batches_role_not_blank CHECK (length(trim(role)) > 0),
  CONSTRAINT dataset_ingestion_batches_source_hash_format CHECK (
    source_provenance_hash IS NULL
    OR source_provenance_hash ~ '^sha256:[a-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS dataset_ingestion_batches_batch_idx
  ON dataset_ingestion_batches (ingestion_batch_id);

CREATE INDEX IF NOT EXISTS dataset_ingestion_batches_role_idx
  ON dataset_ingestion_batches (dataset_id, role);
