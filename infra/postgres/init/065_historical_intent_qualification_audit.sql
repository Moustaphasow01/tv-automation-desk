CREATE TABLE IF NOT EXISTS portfolio_historical_intent_qualifications (
  historical_intent_qualification_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  portfolio_order_intent_id text NOT NULL REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id),
  revision integer NOT NULL CHECK (revision > 0),
  expected_previous_revision integer NOT NULL CHECK (expected_previous_revision >= 0),
  expected_lineage_payload_hash text NOT NULL CHECK (expected_lineage_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  expected_target_payload_hash text NOT NULL CHECK (expected_target_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  expected_signal_payload_hash text NOT NULL CHECK (expected_signal_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  origin_classification text NOT NULL CHECK (origin_classification = 'INVALID_ORIGIN_PLAN'),
  reconstruction_status text NOT NULL CHECK (reconstruction_status = 'UNQUALIFIABLE'),
  provider_evidence_status text NOT NULL CHECK (provider_evidence_status = 'ABSENT'),
  reservation_disposition text NOT NULL CHECK (reservation_disposition = 'RETAINED'),
  qualified_at_utc timestamptz NOT NULL,
  qualified_by text NOT NULL CHECK (length(trim(qualified_by)) > 0),
  qualification_reason text NOT NULL CHECK (length(trim(qualification_reason)) > 0),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_order_intent_id, revision)
);

CREATE INDEX IF NOT EXISTS portfolio_historical_intent_qualifications_intent_idx
  ON portfolio_historical_intent_qualifications(portfolio_order_intent_id, revision DESC);

COMMENT ON TABLE portfolio_historical_intent_qualifications IS
  'Append-only Portfolio/Risk audit. Qualification never creates execution evidence or releases a monetary reservation.';

CREATE OR REPLACE FUNCTION prevent_historical_intent_qualification_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'portfolio_historical_intent_qualifications are append-only';
END;
$$;

DROP TRIGGER IF EXISTS portfolio_historical_intent_qualifications_append_only
  ON portfolio_historical_intent_qualifications;
CREATE TRIGGER portfolio_historical_intent_qualifications_append_only
  BEFORE UPDATE OR DELETE ON portfolio_historical_intent_qualifications
  FOR EACH ROW EXECUTE FUNCTION prevent_historical_intent_qualification_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE portfolio_historical_intent_qualifications TO desk_runtime;
  END IF;
END $$;
