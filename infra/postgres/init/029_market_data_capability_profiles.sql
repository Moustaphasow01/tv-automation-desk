DO $$
BEGIN
  CREATE TYPE market_data_capability_status AS ENUM ('MEASURED', 'PARTIAL', 'MISSING', 'UNAVAILABLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_data_blocking_classification AS ENUM ('BLOCKING', 'NON_BLOCKING', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_data_storage_recommendation AS ENUM ('HOT_SERIES', 'COLD_RAW', 'HOT_AND_COLD', 'IGNORE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS market_data_capability_profile_runs (
  capability_profile_run_id uuid PRIMARY KEY,
  run_key text NOT NULL UNIQUE,
  as_of_utc timestamptz NOT NULL,
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  provider desk_source_provider NOT NULL DEFAULT 'tradingview',
  profile_schema_version text NOT NULL,
  source_profile_ref text,
  profile_count integer NOT NULL DEFAULT 0 CHECK (profile_count >= 0),
  blocking_count integer NOT NULL DEFAULT 0 CHECK (blocking_count >= 0),
  missing_count integer NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_capability_runs_run_key_not_blank CHECK (length(trim(run_key)) > 0),
  CONSTRAINT market_capability_runs_schema_not_blank CHECK (length(trim(profile_schema_version)) > 0)
);

CREATE INDEX IF NOT EXISTS market_capability_runs_scope_idx
  ON market_data_capability_profile_runs (environment, provider, as_of_utc DESC);

CREATE TABLE IF NOT EXISTS market_data_capability_profiles (
  market_data_capability_profile_id uuid PRIMARY KEY,
  capability_profile_run_id uuid REFERENCES market_data_capability_profile_runs(capability_profile_run_id) ON DELETE SET NULL,
  data_source_id uuid REFERENCES data_sources(data_source_id) ON DELETE SET NULL,
  source_key text NOT NULL,
  feed_id text,
  instrument_code text NOT NULL,
  symbol_code text,
  provider desk_source_provider NOT NULL DEFAULT 'tradingview',
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  timeframe text NOT NULL,
  timeframe_seconds integer CHECK (timeframe_seconds IS NULL OR timeframe_seconds > 0),
  status market_data_capability_status NOT NULL,
  blocking_classification market_data_blocking_classification NOT NULL DEFAULT 'UNKNOWN',
  storage_recommendation market_data_storage_recommendation NOT NULL DEFAULT 'HOT_SERIES',
  historical_start_utc timestamptz,
  historical_end_utc timestamptz,
  observed_row_count integer NOT NULL DEFAULT 0 CHECK (observed_row_count >= 0),
  closed_row_count integer NOT NULL DEFAULT 0 CHECK (closed_row_count >= 0),
  volume_row_count integer NOT NULL DEFAULT 0 CHECK (volume_row_count >= 0),
  missing_bar_count integer NOT NULL DEFAULT 0 CHECK (missing_bar_count >= 0),
  largest_gap_seconds integer CHECK (largest_gap_seconds IS NULL OR largest_gap_seconds >= 0),
  has_ohlcv boolean NOT NULL DEFAULT false,
  has_volume boolean NOT NULL DEFAULT false,
  has_tick boolean NOT NULL DEFAULT false,
  has_bid boolean NOT NULL DEFAULT false,
  has_ask boolean NOT NULL DEFAULT false,
  has_open_interest boolean NOT NULL DEFAULT false,
  measured_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  missing_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  blocking_missing_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  non_blocking_missing_capabilities text[] NOT NULL DEFAULT '{}'::text[],
  cost_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  profiled_at_utc timestamptz NOT NULL DEFAULT now(),
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, instrument_code, timeframe, environment, provider),
  CONSTRAINT market_capability_source_key_not_blank CHECK (length(trim(source_key)) > 0),
  CONSTRAINT market_capability_instrument_not_blank CHECK (length(trim(instrument_code)) > 0),
  CONSTRAINT market_capability_timeframe_not_blank CHECK (length(trim(timeframe)) > 0),
  CONSTRAINT market_capability_history_order CHECK (
    historical_start_utc IS NULL
    OR historical_end_utc IS NULL
    OR historical_end_utc >= historical_start_utc
  ),
  CONSTRAINT market_capability_measured_has_history CHECK (
    status <> 'MEASURED'
    OR (
      observed_row_count > 0
      AND historical_start_utc IS NOT NULL
      AND historical_end_utc IS NOT NULL
      AND has_ohlcv = true
    )
  ),
  CONSTRAINT market_capability_missing_has_no_rows CHECK (
    status <> 'MISSING'
    OR observed_row_count = 0
  ),
  CONSTRAINT market_capability_bid_ask_pair CHECK (
    has_bid = has_ask
    OR has_bid = false
    OR has_ask = false
  )
);

CREATE INDEX IF NOT EXISTS market_capability_profiles_scope_idx
  ON market_data_capability_profiles (environment, provider, instrument_code, timeframe);

CREATE INDEX IF NOT EXISTS market_capability_profiles_status_idx
  ON market_data_capability_profiles (status, blocking_classification, profiled_at_utc DESC);

CREATE INDEX IF NOT EXISTS market_capability_profiles_run_idx
  ON market_data_capability_profiles (capability_profile_run_id);

CREATE INDEX IF NOT EXISTS market_capability_profiles_missing_gin_idx
  ON market_data_capability_profiles USING gin (missing_capabilities);
