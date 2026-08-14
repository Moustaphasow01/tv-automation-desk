DO $$
BEGIN
  CREATE TYPE data_source_status AS ENUM ('ACTIVE', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE data_source_kind AS ENUM (
    'MARKET_OHLCV',
    'MARKET_TICK',
    'MACRO_CALENDAR',
    'NEWS',
    'BROKER_EXECUTION',
    'ALTERNATIVE',
    'MANUAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE ingestion_batch_status AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS data_sources (
  data_source_id uuid PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  name text NOT NULL,
  kind data_source_kind NOT NULL,
  provider text NOT NULL,
  format text NOT NULL,
  frequency text NOT NULL,
  freshness_sla_seconds integer NOT NULL CHECK (freshness_sla_seconds > 0),
  status data_source_status NOT NULL DEFAULT 'ACTIVE',
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_sources_source_key_not_blank CHECK (length(trim(source_key)) > 0),
  CONSTRAINT data_sources_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT data_sources_provider_not_blank CHECK (length(trim(provider)) > 0),
  CONSTRAINT data_sources_format_not_blank CHECK (length(trim(format)) > 0),
  CONSTRAINT data_sources_frequency_not_blank CHECK (length(trim(frequency)) > 0)
);

CREATE INDEX IF NOT EXISTS data_sources_status_kind_idx
  ON data_sources (status, kind);

CREATE INDEX IF NOT EXISTS data_sources_provider_environment_idx
  ON data_sources (provider, environment, status);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  ingestion_batch_id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES data_sources(data_source_id) ON DELETE RESTRICT,
  batch_key text NOT NULL UNIQUE,
  status ingestion_batch_status NOT NULL DEFAULT 'RUNNING',
  source_window_start_utc timestamptz,
  source_window_end_utc timestamptz,
  ingested_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  schema_version text NOT NULL,
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  content_hash text,
  provenance_hash text,
  storage_ref text,
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_batches_batch_key_not_blank CHECK (length(trim(batch_key)) > 0),
  CONSTRAINT ingestion_batches_schema_version_not_blank CHECK (length(trim(schema_version)) > 0),
  CONSTRAINT ingestion_batches_window_order CHECK (
    source_window_start_utc IS NULL
    OR source_window_end_utc IS NULL
    OR source_window_end_utc >= source_window_start_utc
  ),
  CONSTRAINT ingestion_batches_content_hash_format CHECK (
    content_hash IS NULL
    OR content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT ingestion_batches_provenance_hash_format CHECK (
    provenance_hash IS NULL
    OR provenance_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT ingestion_batches_running_open CHECK (
    status <> 'RUNNING'
    OR (completed_at_utc IS NULL AND failure_code IS NULL AND failure_message IS NULL)
  ),
  CONSTRAINT ingestion_batches_completed_sealed CHECK (
    status <> 'COMPLETED'
    OR (
      source_window_start_utc IS NOT NULL
      AND source_window_end_utc IS NOT NULL
      AND completed_at_utc IS NOT NULL
      AND content_hash IS NOT NULL
      AND provenance_hash IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  CONSTRAINT ingestion_batches_failed_explained CHECK (
    status <> 'FAILED'
    OR failure_code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ingestion_batches_source_status_idx
  ON ingestion_batches (data_source_id, status, ingested_at_utc DESC);

CREATE INDEX IF NOT EXISTS ingestion_batches_window_idx
  ON ingestion_batches (source_window_start_utc, source_window_end_utc);

CREATE INDEX IF NOT EXISTS ingestion_batches_provenance_hash_idx
  ON ingestion_batches (provenance_hash);
