DO $$
BEGIN
  CREATE TYPE market_calendar_status AS ENUM ('ACTIVE', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_calendar_day_status AS ENUM ('TRADING_DAY', 'HOLIDAY', 'CLOSED', 'EARLY_CLOSE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_rollover_status AS ENUM ('PLANNED', 'ACTIVE', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE market_rollover_method AS ENUM ('VOLUME_OPEN_INTEREST', 'CALENDAR', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS market_calendars (
  market_calendar_id uuid PRIMARY KEY,
  calendar_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  venue text NOT NULL,
  timezone text NOT NULL,
  status market_calendar_status NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_calendars_key_not_blank CHECK (length(trim(calendar_key)) > 0),
  CONSTRAINT market_calendars_name_not_blank CHECK (length(trim(display_name)) > 0),
  CONSTRAINT market_calendars_venue_not_blank CHECK (length(trim(venue)) > 0),
  CONSTRAINT market_calendars_timezone_not_blank CHECK (length(trim(timezone)) > 0)
);

CREATE INDEX IF NOT EXISTS market_calendars_status_venue_idx
  ON market_calendars (status, venue);

CREATE TABLE IF NOT EXISTS market_calendar_days (
  market_calendar_day_id uuid PRIMARY KEY,
  market_calendar_id uuid NOT NULL REFERENCES market_calendars(market_calendar_id) ON DELETE RESTRICT,
  trading_date date NOT NULL,
  status market_calendar_day_status NOT NULL DEFAULT 'TRADING_DAY',
  timezone text NOT NULL,
  open_at_utc timestamptz,
  close_at_utc timestamptz,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_calendar_id, trading_date),
  CONSTRAINT market_calendar_days_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT market_calendar_days_window_order CHECK (
    open_at_utc IS NULL
    OR close_at_utc IS NULL
    OR close_at_utc > open_at_utc
  ),
  CONSTRAINT market_calendar_days_closed_has_no_full_window CHECK (
    status NOT IN ('HOLIDAY', 'CLOSED')
    OR (open_at_utc IS NULL AND close_at_utc IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS market_calendar_days_status_idx
  ON market_calendar_days (market_calendar_id, status, trading_date DESC);

CREATE TABLE IF NOT EXISTS market_session_templates (
  market_session_template_id uuid PRIMARY KEY,
  market_calendar_id uuid NOT NULL REFERENCES market_calendars(market_calendar_id) ON DELETE RESTRICT,
  session_key text NOT NULL,
  display_name text NOT NULL,
  timezone text NOT NULL,
  start_local_time time NOT NULL,
  end_local_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  default_cutoff_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_calendar_id, session_key),
  CONSTRAINT market_session_templates_key_not_blank CHECK (length(trim(session_key)) > 0),
  CONSTRAINT market_session_templates_name_not_blank CHECK (length(trim(display_name)) > 0),
  CONSTRAINT market_session_templates_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT market_session_templates_intraday_order CHECK (
    crosses_midnight = true
    OR end_local_time > start_local_time
  )
);

CREATE INDEX IF NOT EXISTS market_session_templates_enabled_idx
  ON market_session_templates (market_calendar_id, enabled, session_key);

CREATE TABLE IF NOT EXISTS market_session_occurrences (
  market_session_occurrence_id uuid PRIMARY KEY,
  market_calendar_day_id uuid NOT NULL REFERENCES market_calendar_days(market_calendar_day_id) ON DELETE RESTRICT,
  market_session_template_id uuid REFERENCES market_session_templates(market_session_template_id) ON DELETE SET NULL,
  session_key text NOT NULL,
  trading_date date NOT NULL,
  timezone text NOT NULL,
  start_at_utc timestamptz NOT NULL,
  end_at_utc timestamptz NOT NULL,
  start_local text NOT NULL,
  end_local text NOT NULL,
  cutoff_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_calendar_day_id, session_key),
  CONSTRAINT market_session_occurrences_key_not_blank CHECK (length(trim(session_key)) > 0),
  CONSTRAINT market_session_occurrences_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT market_session_occurrences_local_not_blank CHECK (
    length(trim(start_local)) > 0
    AND length(trim(end_local)) > 0
  ),
  CONSTRAINT market_session_occurrences_window_order CHECK (end_at_utc > start_at_utc)
);

CREATE INDEX IF NOT EXISTS market_session_occurrences_date_idx
  ON market_session_occurrences (trading_date, session_key);

CREATE INDEX IF NOT EXISTS market_session_occurrences_window_idx
  ON market_session_occurrences (start_at_utc, end_at_utc);

CREATE TABLE IF NOT EXISTS market_futures_rollovers (
  market_futures_rollover_id uuid PRIMARY KEY,
  root_symbol text NOT NULL,
  instrument_code text REFERENCES market_instruments(instrument_code) ON DELETE SET NULL,
  from_contract_symbol text NOT NULL,
  to_contract_symbol text NOT NULL,
  effective_trading_date date NOT NULL,
  rollover_at_utc timestamptz NOT NULL,
  method market_rollover_method NOT NULL,
  status market_rollover_status NOT NULL DEFAULT 'PLANNED',
  evidence_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (root_symbol, effective_trading_date, to_contract_symbol),
  CONSTRAINT market_futures_rollovers_root_not_blank CHECK (length(trim(root_symbol)) > 0),
  CONSTRAINT market_futures_rollovers_from_not_blank CHECK (length(trim(from_contract_symbol)) > 0),
  CONSTRAINT market_futures_rollovers_to_not_blank CHECK (length(trim(to_contract_symbol)) > 0),
  CONSTRAINT market_futures_rollovers_contracts_differ CHECK (from_contract_symbol <> to_contract_symbol)
);

CREATE INDEX IF NOT EXISTS market_futures_rollovers_instrument_idx
  ON market_futures_rollovers (instrument_code, effective_trading_date DESC);

CREATE INDEX IF NOT EXISTS market_futures_rollovers_status_idx
  ON market_futures_rollovers (status, rollover_at_utc DESC);
