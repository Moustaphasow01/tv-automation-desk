DO $$
BEGIN
  CREATE TYPE desk_data_environment AS ENUM ('prod', 'preprod', 'local', 'replay', 'backtest', 'test');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_source_provider AS ENUM ('tradingview', 'ninjatrader', 'csv', 'manual', 'synthetic', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_asset_class AS ENUM (
    'futures_index',
    'equity',
    'etf',
    'fx',
    'rates',
    'volatility',
    'commodity',
    'crypto',
    'macro_fx',
    'cross_asset',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_timeframe_group AS ENUM ('intraday', 'higher_timeframe', 'daily', 'weekly', 'monthly', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_import_mode AS ENUM ('dry_run', 'import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_import_status AS ENUM ('planned', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_quarantine_severity AS ENUM ('info', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS market_instruments (
  instrument_code text PRIMARY KEY,
  display_name text NOT NULL,
  asset_class market_asset_class NOT NULL DEFAULT 'unknown',
  market_family text,
  currency text,
  tick_size numeric,
  point_value numeric,
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_symbols (
  symbol_id text PRIMARY KEY,
  instrument_code text NOT NULL REFERENCES market_instruments(instrument_code),
  provider desk_source_provider NOT NULL,
  symbol_code text NOT NULL,
  exchange text,
  provider_type text,
  primary_for_instrument boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, symbol_code)
);

CREATE INDEX IF NOT EXISTS market_symbols_instrument_provider_idx
  ON market_symbols(instrument_code, provider, active);

CREATE TABLE IF NOT EXISTS market_timeframes (
  timeframe text PRIMARY KEY,
  seconds integer NOT NULL CHECK (seconds > 0),
  group_name market_timeframe_group NOT NULL,
  intraday boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS market_feeds (
  feed_id text PRIMARY KEY,
  symbol_id text NOT NULL REFERENCES market_symbols(symbol_id),
  instrument_code text NOT NULL REFERENCES market_instruments(instrument_code),
  timeframe text NOT NULL REFERENCES market_timeframes(timeframe),
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  provider desk_source_provider NOT NULL DEFAULT 'tradingview',
  source_service text,
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  enabled boolean NOT NULL DEFAULT true,
  latest_timestamp_utc timestamptz,
  latest_candle_path text,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_feeds
  DROP CONSTRAINT IF EXISTS market_feeds_environment_provider_symbol_id_timeframe_key;

CREATE INDEX IF NOT EXISTS market_feeds_symbol_tf_idx
  ON market_feeds(symbol_id, timeframe, enabled);

CREATE INDEX IF NOT EXISTS market_feeds_instrument_tf_idx
  ON market_feeds(instrument_code, timeframe, enabled);

CREATE TABLE IF NOT EXISTS market_candles (
  feed_id text NOT NULL REFERENCES market_feeds(feed_id),
  timestamp_utc timestamptz NOT NULL,
  symbol_code text NOT NULL,
  timeframe text NOT NULL REFERENCES market_timeframes(timeframe),
  trading_date text,
  timestamp_paris text,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision,
  is_closed boolean NOT NULL DEFAULT true,
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  studies jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_collection text,
  source_document_id text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(feed_id, timestamp_utc)
);

CREATE INDEX IF NOT EXISTS market_candles_symbol_tf_time_idx
  ON market_candles(symbol_code, timeframe, timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS market_candles_feed_time_idx
  ON market_candles(feed_id, timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS market_candles_trading_date_idx
  ON market_candles(trading_date, symbol_code, timeframe);

CREATE INDEX IF NOT EXISTS market_candles_source_idx
  ON market_candles(source_collection, source_document_id);

CREATE TABLE IF NOT EXISTS market_feed_status (
  status_id text PRIMARY KEY,
  feed_id text REFERENCES market_feeds(feed_id) ON DELETE SET NULL,
  symbol_code text,
  timeframe text,
  timestamp_utc timestamptz,
  status text,
  latest_bar_age_seconds integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_feed_status_feed_time_idx
  ON market_feed_status(feed_id, timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS market_feed_status_status_idx
  ON market_feed_status(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tradingview_events (
  event_id text PRIMARY KEY,
  feed_id text REFERENCES market_feeds(feed_id) ON DELETE SET NULL,
  symbol_code text,
  timeframe text,
  timestamp_utc timestamptz,
  received_at timestamptz,
  alert_id text,
  status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tradingview_events_feed_time_idx
  ON tradingview_events(feed_id, timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS tradingview_events_received_idx
  ON tradingview_events(received_at DESC);

CREATE INDEX IF NOT EXISTS tradingview_events_alert_idx
  ON tradingview_events(alert_id);

CREATE TABLE IF NOT EXISTS desk_document_links (
  source_collection text NOT NULL,
  source_document_id text NOT NULL,
  relation_type text NOT NULL,
  target_collection text NOT NULL,
  target_document_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_collection, source_document_id, relation_type, target_collection, target_document_id)
);

CREATE INDEX IF NOT EXISTS desk_document_links_target_idx
  ON desk_document_links(target_collection, target_document_id);

CREATE TABLE IF NOT EXISTS desk_import_runs (
  import_id text PRIMARY KEY,
  source_project text,
  source_kind text NOT NULL DEFAULT 'firestore',
  mode desk_import_mode NOT NULL,
  status desk_import_status NOT NULL DEFAULT 'planned',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  requested_collections jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_collections jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE INDEX IF NOT EXISTS desk_import_runs_status_started_idx
  ON desk_import_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS desk_import_checkpoints (
  import_id text NOT NULL REFERENCES desk_import_runs(import_id) ON DELETE CASCADE,
  source_collection text NOT NULL,
  target_table text NOT NULL,
  last_document_id text,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(import_id, source_collection, target_table)
);

CREATE TABLE IF NOT EXISTS desk_document_quarantine (
  source_collection text NOT NULL,
  source_document_id text NOT NULL,
  target_table text,
  severity desk_quarantine_severity NOT NULL DEFAULT 'warning',
  reason text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  import_id text REFERENCES desk_import_runs(import_id) ON DELETE SET NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_collection, source_document_id, reason)
);

CREATE INDEX IF NOT EXISTS desk_document_quarantine_import_idx
  ON desk_document_quarantine(import_id, quarantined_at DESC);

CREATE INDEX IF NOT EXISTS desk_documents_collection_run_id_idx
  ON desk_documents (collection, ((data ->> 'run_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_replay_run_id_idx
  ON desk_documents (collection, ((data ->> 'replay_run_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_workflow_idx
  ON desk_documents (collection, ((data ->> 'workflow')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_step_id_idx
  ON desk_documents (collection, ((data ->> 'step_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_updated_at_utc_idx
  ON desk_documents (collection, ((data ->> 'updated_at_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_created_at_utc_idx
  ON desk_documents (collection, ((data ->> 'created_at_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_timestamp_utc_idx
  ON desk_documents (collection, ((data ->> 'timestamp_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_date_session_idx
  ON desk_documents (
    collection,
    ((data ->> 'trading_date')),
    ((data ->> 'session'))
  );
