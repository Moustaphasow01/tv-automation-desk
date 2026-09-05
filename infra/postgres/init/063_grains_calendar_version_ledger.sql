-- Immutable market-data evidence for the calendar that was actually known at a
-- runtime cutoff.  The current `market_agri_events` projection remains useful
-- operationally, but must not be used to reconstruct prior knowledge.

CREATE TABLE IF NOT EXISTS market_agri_calendar_versions (
  market_agri_calendar_version_id text PRIMARY KEY,
  source_id text NOT NULL,
  source_status text NOT NULL CHECK (source_status IN ('AVAILABLE','STALE','UNAVAILABLE','UNKNOWN_COVERAGE','OPTIONAL_UNAVAILABLE')),
  coverage_start_utc timestamptz,
  coverage_end_utc timestamptz,
  known_at_utc timestamptz NOT NULL,
  dataset_version text NOT NULL CHECK (dataset_version ~ '^sha256:[a-f0-9]{64}$'),
  source_version_hash text NOT NULL CHECK (source_version_hash ~ '^sha256:[a-f0-9]{64}$'),
  provider text,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end_utc IS NULL OR coverage_start_utc IS NULL OR coverage_end_utc >= coverage_start_utc),
  UNIQUE (source_id, source_version_hash)
);

CREATE INDEX IF NOT EXISTS market_agri_calendar_versions_cutoff_idx
  ON market_agri_calendar_versions(source_id, known_at_utc DESC);

CREATE TABLE IF NOT EXISTS market_agri_calendar_version_sources (
  market_agri_calendar_version_id text NOT NULL REFERENCES market_agri_calendar_versions(market_agri_calendar_version_id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  source_url text NOT NULL,
  source_document_sha256 text NOT NULL CHECK (source_document_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  retrieved_at_utc timestamptz NOT NULL,
  knowledge_status text NOT NULL CHECK (knowledge_status IN ('PROVEN_CURRENT','EXTERNAL_HISTORICAL_GAP')),
  historical_knowledge_status text NOT NULL CHECK (historical_knowledge_status IN ('PROVEN_HISTORICAL','EXTERNAL_HISTORICAL_GAP')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (market_agri_calendar_version_id, source_id)
);

CREATE INDEX IF NOT EXISTS market_agri_calendar_version_sources_source_idx
  ON market_agri_calendar_version_sources(source_id, retrieved_at_utc DESC);

CREATE TABLE IF NOT EXISTS market_agri_calendar_version_events (
  market_agri_calendar_version_id text NOT NULL REFERENCES market_agri_calendar_versions(market_agri_calendar_version_id) ON DELETE RESTRICT,
  market_agri_event_id text NOT NULL,
  event_kind market_agri_event_kind NOT NULL,
  title text NOT NULL,
  event_timestamp_utc timestamptz NOT NULL,
  importance market_agri_event_importance NOT NULL,
  source_provider text NOT NULL,
  source_url text,
  source_published_at_utc timestamptz NOT NULL,
  point_in_time_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (market_agri_calendar_version_id, market_agri_event_id),
  CHECK (jsonb_typeof(point_in_time_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS market_agri_calendar_version_events_time_idx
  ON market_agri_calendar_version_events(market_agri_calendar_version_id, event_timestamp_utc, market_agri_event_id);

CREATE OR REPLACE FUNCTION prevent_market_agri_calendar_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'market_agri_calendar_versions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_agri_calendar_versions_append_only ON market_agri_calendar_versions;
CREATE TRIGGER market_agri_calendar_versions_append_only
  BEFORE UPDATE OR DELETE ON market_agri_calendar_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_market_agri_calendar_version_mutation();

CREATE OR REPLACE FUNCTION prevent_market_agri_calendar_version_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'market_agri_calendar_version_sources are append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_agri_calendar_version_sources_append_only ON market_agri_calendar_version_sources;
CREATE TRIGGER market_agri_calendar_version_sources_append_only
  BEFORE UPDATE OR DELETE ON market_agri_calendar_version_sources
  FOR EACH ROW EXECUTE FUNCTION prevent_market_agri_calendar_version_source_mutation();

CREATE OR REPLACE FUNCTION prevent_market_agri_calendar_version_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'market_agri_calendar_version_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS market_agri_calendar_version_events_append_only ON market_agri_calendar_version_events;
CREATE TRIGGER market_agri_calendar_version_events_append_only
  BEFORE UPDATE OR DELETE ON market_agri_calendar_version_events
  FOR EACH ROW EXECUTE FUNCTION prevent_market_agri_calendar_version_event_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE market_agri_calendar_versions,
      market_agri_calendar_version_sources, market_agri_calendar_version_events TO desk_runtime;
  END IF;
END $$;
