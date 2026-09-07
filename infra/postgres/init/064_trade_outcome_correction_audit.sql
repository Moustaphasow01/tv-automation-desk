CREATE TABLE IF NOT EXISTS trade_outcome_correction_events (
  trade_outcome_correction_event_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  trade_id text NOT NULL REFERENCES trades(trade_id),
  previous_trade_outcome_id text NOT NULL REFERENCES trade_outcomes(trade_outcome_id),
  corrected_trade_outcome_id text NOT NULL REFERENCES trade_outcomes(trade_outcome_id),
  expected_previous_revision integer NOT NULL CHECK (expected_previous_revision > 0),
  expected_previous_evidence_hash text NOT NULL CHECK (expected_previous_evidence_hash ~ '^[a-f0-9]{64}$'),
  canonical_point_value numeric NOT NULL CHECK (canonical_point_value > 0),
  economic_finalized_at_utc timestamptz NOT NULL,
  correction_known_at_utc timestamptz NOT NULL,
  correction_reason text NOT NULL CHECK (length(trim(correction_reason)) > 0),
  corrected_by text NOT NULL CHECK (length(trim(corrected_by)) > 0),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (correction_known_at_utc >= economic_finalized_at_utc)
);

CREATE INDEX IF NOT EXISTS trade_outcome_correction_events_trade_idx
  ON trade_outcome_correction_events(trade_id, correction_known_at_utc DESC);

COMMENT ON TABLE trade_outcome_correction_events IS
  'Append-only execution audit linking superseded monetary outcome evidence to a corrected revision.';

CREATE OR REPLACE FUNCTION prevent_trade_outcome_correction_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trade_outcome_correction_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trade_outcome_correction_events_append_only ON trade_outcome_correction_events;
CREATE TRIGGER trade_outcome_correction_events_append_only
  BEFORE UPDATE OR DELETE ON trade_outcome_correction_events
  FOR EACH ROW EXECUTE FUNCTION prevent_trade_outcome_correction_event_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE trade_outcome_correction_events TO desk_runtime;
  END IF;
END $$;
