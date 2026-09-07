CREATE TABLE IF NOT EXISTS portfolio_administrative_reservation_cancellations (
  portfolio_administrative_reservation_cancellation_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  portfolio_order_intent_id text NOT NULL
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id),
  revision integer NOT NULL CHECK (revision > 0),
  expected_previous_revision integer NOT NULL CHECK (expected_previous_revision >= 0),
  expected_lineage_payload_hash text NOT NULL
    CHECK (expected_lineage_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  expected_lineage_status text NOT NULL CHECK (expected_lineage_status = 'EXPIRED'),
  status text NOT NULL CHECK (status = 'CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE'),
  reservation_disposition text NOT NULL CHECK (reservation_disposition = 'ADMINISTRATIVELY_RELEASED'),
  historical_outcome_disposition text NOT NULL CHECK (historical_outcome_disposition = 'UNDETERMINED_PRESERVED'),
  effective_at_utc timestamptz NOT NULL,
  cancelled_by text NOT NULL CHECK (length(trim(cancelled_by)) > 0),
  cancellation_reason text NOT NULL CHECK (length(trim(cancellation_reason)) > 0),
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
  CHECK ((operator_attestation->'no_open_positions' = 'true'::jsonb) IS TRUE),
  CHECK (jsonb_typeof(evidence) = 'object'),
  CHECK (evidence ?& ARRAY['schema_version','provider_command_count','provider_event_count',
    'broker_order_count','broker_order_event_count','trade_count','fill_count',
    'manual_execution_event_count','theoretical_entry_fill_count','unexpected_theoretical_event_count',
    'third_party_reference_count','filled_quantity','lifecycle_status','market_execution_effect']),
  CHECK ((evidence - ARRAY['schema_version','provider_command_count','provider_event_count',
    'broker_order_count','broker_order_event_count','trade_count','fill_count',
    'manual_execution_event_count','theoretical_entry_fill_count','unexpected_theoretical_event_count',
    'third_party_reference_count','filled_quantity','lifecycle_status','market_execution_effect'] = '{}'::jsonb) IS TRUE),
  CHECK ((evidence->>'schema_version' = 'portfolio_administrative_reservation_cancellation_evidence_v1') IS TRUE),
  CHECK ((evidence->>'market_execution_effect' = 'NONE') IS TRUE),
  CHECK ((evidence->'provider_command_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'provider_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'broker_order_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'broker_order_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'trade_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'fill_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'manual_execution_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'theoretical_entry_fill_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'unexpected_theoretical_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'third_party_reference_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'filled_quantity' = '0'::jsonb) IS TRUE),
  CHECK (((evidence->'lifecycle_status' = 'null'::jsonb)
    OR (evidence->>'lifecycle_status' = 'EXPIRED')) IS TRUE)
);

CREATE INDEX IF NOT EXISTS portfolio_admin_reservation_cancellations_intent_idx
  ON portfolio_administrative_reservation_cancellations(portfolio_order_intent_id, effective_at_utc DESC);

COMMENT ON TABLE portfolio_administrative_reservation_cancellations IS
  'Append-only Portfolio/Risk audit for prospective reservation release after exact CAS and no-open-exposure proof. Historical fill, expiry, R and PnL remain undetermined and unchanged.';

CREATE OR REPLACE FUNCTION prevent_administrative_reservation_cancellation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'portfolio_administrative_reservation_cancellations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS portfolio_administrative_reservation_cancellations_append_only
  ON portfolio_administrative_reservation_cancellations;
CREATE TRIGGER portfolio_administrative_reservation_cancellations_append_only
  BEFORE UPDATE OR DELETE ON portfolio_administrative_reservation_cancellations
  FOR EACH ROW EXECUTE FUNCTION prevent_administrative_reservation_cancellation_mutation();

CREATE OR REPLACE FUNCTION prevent_execution_after_administrative_reservation_release()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate_id text;
  candidate_ids text[] := ARRAY[
    NULLIF(to_jsonb(NEW)->>'portfolio_order_intent_id',''),
    CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(to_jsonb(OLD)->>'portfolio_order_intent_id','') ELSE NULL END
  ];
BEGIN
  FOREACH candidate_id IN ARRAY candidate_ids LOOP
    IF candidate_id IS NULL THEN CONTINUE; END IF;
    -- This lock deliberately happens before the audit lookup. If an APPLY
    -- transaction owns the lineage row, the writer waits; the following SPI
    -- statement then observes the committed release under READ COMMITTED.
    PERFORM 1 FROM portfolio_order_intent_lineage
      WHERE portfolio_order_intent_id=candidate_id FOR KEY SHARE;
    IF EXISTS (
      SELECT 1 FROM portfolio_invalid_origin_adjudications adjudication
      WHERE adjudication.portfolio_order_intent_id=candidate_id
        AND adjudication.status='CANCELLED_INVALID_ORIGIN'
        AND adjudication.reservation_disposition='ADMINISTRATIVELY_RELEASED'
        AND adjudication.effective_at_utc <= clock_timestamp()
        AND adjudication.created_at_utc <= clock_timestamp()
      UNION ALL
      SELECT 1 FROM portfolio_administrative_reservation_cancellations cancellation
      WHERE cancellation.portfolio_order_intent_id=candidate_id
        AND cancellation.status='CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE'
        AND cancellation.reservation_disposition='ADMINISTRATIVELY_RELEASED'
        AND cancellation.historical_outcome_disposition='UNDETERMINED_PRESERVED'
        AND cancellation.effective_at_utc <= clock_timestamp()
        AND cancellation.created_at_utc <= clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'execution evidence refused after administrative reservation release: %', candidate_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE guarded_table text;
BEGIN
  FOREACH guarded_table IN ARRAY ARRAY[
    'broker_provider_commands','broker_provider_events','portfolio_order_intent_execution_states',
    'trades','trade_manual_execution_events','trade_theoretical_execution_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS administrative_reservation_release_execution_guard ON %I', guarded_table);
    EXECUTE format('CREATE TRIGGER administrative_reservation_release_execution_guard
      BEFORE INSERT OR UPDATE ON %I FOR EACH ROW
      EXECUTE FUNCTION prevent_execution_after_administrative_reservation_release()', guarded_table);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE portfolio_administrative_reservation_cancellations TO desk_runtime;
  END IF;
END $$;
