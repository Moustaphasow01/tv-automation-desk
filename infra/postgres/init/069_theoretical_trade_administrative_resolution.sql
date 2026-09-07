CREATE TABLE IF NOT EXISTS trade_theoretical_administrative_resolutions (
  theoretical_trade_administrative_resolution_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  trade_id text NOT NULL REFERENCES trades(trade_id),
  portfolio_order_intent_id text NOT NULL
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id),
  expected_trade_revision integer NOT NULL CHECK (expected_trade_revision >= 0),
  expected_trade_status text NOT NULL CHECK (expected_trade_status = 'open'),
  expected_quantity_open numeric NOT NULL CHECK (expected_quantity_open > 0),
  expected_lineage_payload_hash text NOT NULL
    CHECK (expected_lineage_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status = 'ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE'),
  exposure_disposition text NOT NULL CHECK (exposure_disposition = 'ADMINISTRATIVELY_RELEASED'),
  historical_outcome_disposition text NOT NULL CHECK (historical_outcome_disposition = 'UNDETERMINED_PRESERVED'),
  effective_at_utc timestamptz NOT NULL,
  resolved_by text NOT NULL CHECK (length(trim(resolved_by)) > 0),
  resolution_reason text NOT NULL CHECK (length(trim(resolution_reason)) > 0),
  operator_attestation jsonb NOT NULL,
  operator_attestation_hash text NOT NULL CHECK (operator_attestation_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id),
  CHECK (jsonb_typeof(operator_attestation) = 'object'),
  CHECK (operator_attestation ?& ARRAY['schema_version','no_open_orders','no_open_positions']),
  CHECK ((operator_attestation - ARRAY['schema_version','no_open_orders','no_open_positions'] = '{}'::jsonb) IS TRUE),
  CHECK ((operator_attestation->>'schema_version' = 'operator_no_open_exposure_attestation_v1') IS TRUE),
  CHECK ((operator_attestation->'no_open_orders' = 'true'::jsonb) IS TRUE),
  CHECK ((operator_attestation->'no_open_positions' = 'true'::jsonb) IS TRUE),
  CHECK (jsonb_typeof(evidence) = 'object'),
  CHECK (evidence ?& ARRAY['schema_version','provider_command_count','provider_event_count',
    'broker_order_count','broker_order_event_count','manual_execution_event_count','physical_fill_count',
    'theoretical_fill_count','theoretical_entry_fill_count','theoretical_review_count',
    'other_theoretical_event_count','outcome_count','physical_third_party_reference_count',
    'market_execution_effect']),
  CHECK ((evidence - ARRAY['schema_version','provider_command_count','provider_event_count',
    'broker_order_count','broker_order_event_count','manual_execution_event_count','physical_fill_count',
    'theoretical_fill_count','theoretical_entry_fill_count','theoretical_review_count',
    'other_theoretical_event_count','outcome_count','physical_third_party_reference_count',
    'market_execution_effect'] = '{}'::jsonb) IS TRUE),
  CHECK ((evidence->>'schema_version' = 'theoretical_trade_administrative_resolution_evidence_v1') IS TRUE),
  CHECK ((evidence->>'market_execution_effect' = 'NONE') IS TRUE),
  CHECK ((evidence->'provider_command_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'provider_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'broker_order_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'broker_order_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'manual_execution_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'physical_fill_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'theoretical_fill_count' = '1'::jsonb) IS TRUE),
  CHECK ((evidence->'theoretical_entry_fill_count' = '1'::jsonb) IS TRUE),
  CHECK ((evidence->'theoretical_review_count' = '1'::jsonb) IS TRUE),
  CHECK ((evidence->'other_theoretical_event_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'outcome_count' = '0'::jsonb) IS TRUE),
  CHECK ((evidence->'physical_third_party_reference_count' = '0'::jsonb) IS TRUE)
);

CREATE INDEX IF NOT EXISTS theoretical_trade_admin_resolution_intent_idx
  ON trade_theoretical_administrative_resolutions(portfolio_order_intent_id, effective_at_utc DESC);

COMMENT ON TABLE trade_theoretical_administrative_resolutions IS
  'Append-only resolution of an ambiguous theoretical trade after operator no-real-exposure attestation. It releases current exposure without creating a fill, exit price, R or PnL.';

CREATE OR REPLACE FUNCTION prevent_theoretical_trade_administrative_resolution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trade_theoretical_administrative_resolutions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS theoretical_trade_administrative_resolutions_append_only
  ON trade_theoretical_administrative_resolutions;
CREATE TRIGGER theoretical_trade_administrative_resolutions_append_only
  BEFORE UPDATE OR DELETE ON trade_theoretical_administrative_resolutions
  FOR EACH ROW EXECUTE FUNCTION prevent_theoretical_trade_administrative_resolution_mutation();

CREATE OR REPLACE FUNCTION prevent_execution_after_theoretical_trade_administrative_resolution()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate_trade_id text := NULLIF(to_jsonb(NEW)->>'trade_id','');
  candidate_intent_id text := NULLIF(to_jsonb(NEW)->>'portfolio_order_intent_id','');
BEGIN
  IF candidate_trade_id IS NOT NULL THEN
    PERFORM 1 FROM trades WHERE trade_id=candidate_trade_id FOR KEY SHARE;
    SELECT portfolio_order_intent_id INTO candidate_intent_id
      FROM trades WHERE trade_id=candidate_trade_id;
  END IF;
  IF candidate_intent_id IS NOT NULL THEN
    PERFORM 1 FROM portfolio_order_intent_lineage
      WHERE portfolio_order_intent_id=candidate_intent_id FOR KEY SHARE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM trade_theoretical_administrative_resolutions resolution
    WHERE (candidate_trade_id IS NOT NULL AND resolution.trade_id=candidate_trade_id)
       OR (candidate_intent_id IS NOT NULL AND resolution.portfolio_order_intent_id=candidate_intent_id)
  ) THEN
    RAISE EXCEPTION 'execution evidence refused after theoretical trade administrative resolution'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE guarded_table text;
BEGIN
  FOREACH guarded_table IN ARRAY ARRAY[
    'trades','trade_fills','trade_manual_execution_events','trade_theoretical_execution_events',
    'broker_provider_commands','broker_provider_events','portfolio_order_intent_execution_states'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS theoretical_trade_admin_resolution_execution_guard ON %I', guarded_table);
    EXECUTE format('CREATE TRIGGER theoretical_trade_admin_resolution_execution_guard
      BEFORE INSERT OR UPDATE ON %I FOR EACH ROW
      EXECUTE FUNCTION prevent_execution_after_theoretical_trade_administrative_resolution()', guarded_table);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT ON TABLE trade_theoretical_administrative_resolutions TO desk_runtime;
  END IF;
END $$;
