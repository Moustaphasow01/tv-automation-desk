DO $$
BEGIN
  CREATE TYPE market_data_storage_tier AS ENUM ('HOT_SERIES', 'COLD_PARQUET', 'RAW_ARCHIVE', 'HOT_AND_COLD', 'IGNORE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_data_storage_format AS ENUM ('POSTGRES_SERIES', 'PARQUET', 'JSONL', 'CSV');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_data_storage_object_status AS ENUM ('PLANNED', 'ACTIVE', 'ARCHIVED', 'MISSING', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS market_data_storage_objects (
  market_data_storage_object_id uuid PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  storage_tier market_data_storage_tier NOT NULL,
  storage_format market_data_storage_format NOT NULL,
  status market_data_storage_object_status NOT NULL DEFAULT 'PLANNED',
  uri text NOT NULL,
  dataset_id uuid REFERENCES datasets(dataset_id) ON DELETE SET NULL,
  ingestion_batch_id uuid REFERENCES ingestion_batches(ingestion_batch_id) ON DELETE SET NULL,
  market_data_capability_profile_id uuid REFERENCES market_data_capability_profiles(market_data_capability_profile_id) ON DELETE SET NULL,
  source_key text NOT NULL,
  provider desk_source_provider NOT NULL DEFAULT 'tradingview',
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  instrument_code text NOT NULL,
  timeframe text NOT NULL,
  time_range_start_utc timestamptz,
  time_range_end_utc timestamptz,
  partition_grain text NOT NULL DEFAULT 'day',
  partition_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version text NOT NULL,
  compression text,
  record_count bigint NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  content_hash text,
  provenance_hash text,
  retention_days integer CHECK (retention_days IS NULL OR retention_days > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_storage_object_key_not_blank CHECK (length(trim(object_key)) > 0),
  CONSTRAINT market_storage_uri_not_blank CHECK (length(trim(uri)) > 0),
  CONSTRAINT market_storage_source_key_not_blank CHECK (length(trim(source_key)) > 0),
  CONSTRAINT market_storage_instrument_not_blank CHECK (length(trim(instrument_code)) > 0),
  CONSTRAINT market_storage_timeframe_not_blank CHECK (length(trim(timeframe)) > 0),
  CONSTRAINT market_storage_schema_not_blank CHECK (length(trim(schema_version)) > 0),
  CONSTRAINT market_storage_window_order CHECK (
    time_range_start_utc IS NULL
    OR time_range_end_utc IS NULL
    OR time_range_end_utc >= time_range_start_utc
  ),
  CONSTRAINT market_storage_content_hash_format CHECK (
    content_hash IS NULL
    OR content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT market_storage_provenance_hash_format CHECK (
    provenance_hash IS NULL
    OR provenance_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT market_storage_active_is_sealed CHECK (
    status <> 'ACTIVE'
    OR (
      time_range_start_utc IS NOT NULL
      AND time_range_end_utc IS NOT NULL
      AND record_count > 0
      AND content_hash IS NOT NULL
      AND provenance_hash IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS market_storage_objects_scope_idx
  ON market_data_storage_objects (environment, provider, instrument_code, timeframe, storage_tier, status);

CREATE INDEX IF NOT EXISTS market_storage_objects_dataset_idx
  ON market_data_storage_objects (dataset_id);

CREATE INDEX IF NOT EXISTS market_storage_objects_batch_idx
  ON market_data_storage_objects (ingestion_batch_id);

CREATE INDEX IF NOT EXISTS market_storage_objects_window_idx
  ON market_data_storage_objects (time_range_start_utc, time_range_end_utc);

CREATE TABLE IF NOT EXISTS market_data_hot_series_windows (
  hot_series_window_id uuid PRIMARY KEY,
  source_key text NOT NULL,
  provider desk_source_provider NOT NULL DEFAULT 'tradingview',
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  instrument_code text NOT NULL,
  timeframe text NOT NULL,
  hot_table text NOT NULL DEFAULT 'market_candles',
  market_data_storage_object_id uuid REFERENCES market_data_storage_objects(market_data_storage_object_id) ON DELETE SET NULL,
  market_data_capability_profile_id uuid REFERENCES market_data_capability_profiles(market_data_capability_profile_id) ON DELETE SET NULL,
  window_start_utc timestamptz NOT NULL,
  window_end_utc timestamptz NOT NULL,
  latest_timestamp_utc timestamptz,
  retention_days integer NOT NULL CHECK (retention_days > 0),
  row_count bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  status market_data_storage_object_status NOT NULL DEFAULT 'PLANNED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, instrument_code, timeframe, environment, provider, window_start_utc, window_end_utc),
  CONSTRAINT market_hot_series_source_key_not_blank CHECK (length(trim(source_key)) > 0),
  CONSTRAINT market_hot_series_instrument_not_blank CHECK (length(trim(instrument_code)) > 0),
  CONSTRAINT market_hot_series_timeframe_not_blank CHECK (length(trim(timeframe)) > 0),
  CONSTRAINT market_hot_series_table_not_blank CHECK (length(trim(hot_table)) > 0),
  CONSTRAINT market_hot_series_window_order CHECK (window_end_utc >= window_start_utc),
  CONSTRAINT market_hot_series_latest_within_window CHECK (
    latest_timestamp_utc IS NULL
    OR (latest_timestamp_utc >= window_start_utc AND latest_timestamp_utc <= window_end_utc)
  )
);

CREATE INDEX IF NOT EXISTS market_hot_series_scope_idx
  ON market_data_hot_series_windows (environment, provider, instrument_code, timeframe, status);

CREATE INDEX IF NOT EXISTS market_hot_series_latest_idx
  ON market_data_hot_series_windows (latest_timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS market_hot_series_storage_object_idx
  ON market_data_hot_series_windows (market_data_storage_object_id);
