ALTER TABLE trade_policy_profiles
  ADD COLUMN IF NOT EXISTS risk_per_trade_pct numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS fallback_capital_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_capital numeric,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE trade_policy_profiles
    ADD CONSTRAINT trade_policy_profiles_risk_per_trade_pct_check
    CHECK (risk_per_trade_pct BETWEEN 0.01 AND 1.00);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE trade_policy_profiles
    ADD CONSTRAINT trade_policy_profiles_fallback_capital_check
    CHECK (fallback_capital IS NULL OR fallback_capital BETWEEN 100 AND 100000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE trade_policy_profiles
    ADD CONSTRAINT trade_policy_profiles_revision_check
    CHECK (revision >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS broker_policy_audit_events (
  broker_policy_audit_event_id text PRIMARY KEY,
  policy_profile_id text NOT NULL REFERENCES trade_policy_profiles(policy_profile_id),
  action text NOT NULL CHECK (action = 'configure_sizing'),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  applied_revision integer NOT NULL CHECK (applied_revision > expected_revision),
  actor text NOT NULL,
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  previous_values jsonb NOT NULL,
  next_values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_policy_audit_events_policy_time_idx
  ON broker_policy_audit_events(policy_profile_id, created_at DESC);

UPDATE trade_policy_profiles
SET risk_per_trade_pct = COALESCE(risk_per_trade_pct, 0.25),
    fallback_capital_enabled = COALESCE(fallback_capital_enabled, false),
    revision = COALESCE(revision, 0)
WHERE policy_profile_id = 'ninjatrader_sim101_local';
