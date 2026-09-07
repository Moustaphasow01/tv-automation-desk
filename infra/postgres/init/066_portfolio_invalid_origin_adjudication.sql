CREATE TABLE IF NOT EXISTS portfolio_invalid_origin_adjudications (
  portfolio_invalid_origin_adjudication_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  portfolio_order_intent_id text NOT NULL
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id),
  historical_intent_qualification_id text NOT NULL
    REFERENCES portfolio_historical_intent_qualifications(historical_intent_qualification_id),
  revision integer NOT NULL CHECK (revision > 0),
  expected_previous_revision integer NOT NULL CHECK (expected_previous_revision >= 0),
  expected_qualification_revision integer NOT NULL CHECK (expected_qualification_revision > 0),
  expected_qualification_manifest_hash text NOT NULL
    CHECK (expected_qualification_manifest_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status = 'CANCELLED_INVALID_ORIGIN'),
  reservation_disposition text NOT NULL
    CHECK (reservation_disposition = 'ADMINISTRATIVELY_RELEASED'),
  effective_at_utc timestamptz NOT NULL,
  adjudicated_by text NOT NULL CHECK (length(trim(adjudicated_by)) > 0),
  adjudication_reason text NOT NULL CHECK (length(trim(adjudication_reason)) > 0),
  operator_attestation jsonb NOT NULL,
  operator_attestation_hash text NOT NULL CHECK (operator_attestation_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_order_intent_id, revision),
  CHECK (revision = expected_previous_revision + 1),
  CHECK (jsonb_typeof(operator_attestation) = 'object'),
  CHECK (operator_attestation ?& ARRAY['schema_version','no_open_orders','no_open_positions']),
  CHECK ((operator_attestation - ARRAY['schema_version','no_open_orders','no_open_positions'] = '{}'::jsonb) IS TRUE),
  CHECK ((operator_attestation->>'schema_version' = 'operator_no_open_exposure_attestation_v1') IS TRUE),
  CHECK ((operator_attestation->'no_open_orders' = 'true'::jsonb) IS TRUE),
  CHECK ((operator_attestation->'no_open_positions' = 'true'::jsonb) IS TRUE)
);

CREATE INDEX IF NOT EXISTS portfolio_invalid_origin_adjudications_intent_idx
  ON portfolio_invalid_origin_adjudications(portfolio_order_intent_id, effective_at_utc DESC);

COMMENT ON TABLE portfolio_invalid_origin_adjudications IS
  'Append-only Portfolio/Risk audit. Effective cancellation releases only theoretical reservation exposure and never creates execution, fill, expiry, R, or PnL evidence.';

CREATE OR REPLACE FUNCTION prevent_invalid_origin_adjudication_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'portfolio_invalid_origin_adjudications are append-only';
END;
$$;

DROP TRIGGER IF EXISTS portfolio_invalid_origin_adjudications_append_only
  ON portfolio_invalid_origin_adjudications;
CREATE TRIGGER portfolio_invalid_origin_adjudications_append_only
  BEFORE UPDATE OR DELETE ON portfolio_invalid_origin_adjudications
  FOR EACH ROW EXECUTE FUNCTION prevent_invalid_origin_adjudication_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE portfolio_invalid_origin_adjudications TO desk_runtime;
  END IF;
END $$;
