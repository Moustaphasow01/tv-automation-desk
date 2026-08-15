-- Backend Domain Completeness & Front Contract Freeze closure.
-- Additive-only migration: no existing frozen field is renamed or removed.

ALTER TABLE strategy_signal_outbox
  ADD COLUMN IF NOT EXISTS strategy_definition_id uuid,
  ADD COLUMN IF NOT EXISTS timeframe text,
  ADD COLUMN IF NOT EXISTS session text,
  ADD COLUMN IF NOT EXISTS source_data_cutoff_utc timestamptz,
  ADD COLUMN IF NOT EXISTS setup jsonb,
  ADD COLUMN IF NOT EXISTS predicates jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb,
  ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS signal_quality jsonb,
  ADD COLUMN IF NOT EXISTS proposed_trade_plan jsonb,
  ADD COLUMN IF NOT EXISTS trade_plan_economics jsonb,
  ADD COLUMN IF NOT EXISTS availability text;

CREATE INDEX IF NOT EXISTS strategy_signal_outbox_trade_plan_gin_idx
  ON strategy_signal_outbox USING gin (proposed_trade_plan)
  WHERE proposed_trade_plan IS NOT NULL;

CREATE INDEX IF NOT EXISTS strategy_signal_outbox_cutoff_idx
  ON strategy_signal_outbox(source_data_cutoff_utc DESC)
  WHERE source_data_cutoff_utc IS NOT NULL;

ALTER TABLE portfolio_risk_decisions
  ADD COLUMN IF NOT EXISTS account_capital_reference jsonb,
  ADD COLUMN IF NOT EXISTS requested jsonb,
  ADD COLUMN IF NOT EXISTS authorized jsonb,
  ADD COLUMN IF NOT EXISTS trade_risk jsonb,
  ADD COLUMN IF NOT EXISTS portfolio_before jsonb,
  ADD COLUMN IF NOT EXISTS portfolio_after jsonb,
  ADD COLUMN IF NOT EXISTS limits jsonb,
  ADD COLUMN IF NOT EXISTS nearest_limit jsonb,
  ADD COLUMN IF NOT EXISTS breaches jsonb,
  ADD COLUMN IF NOT EXISTS risk_economics jsonb;

CREATE INDEX IF NOT EXISTS portfolio_risk_decisions_risk_economics_gin_idx
  ON portfolio_risk_decisions USING gin (risk_economics)
  WHERE risk_economics IS NOT NULL;

ALTER TABLE portfolio_target_positions
  ADD COLUMN IF NOT EXISTS approved_trade_plan jsonb,
  ADD COLUMN IF NOT EXISTS risk_allocation jsonb,
  ADD COLUMN IF NOT EXISTS expected_exposure jsonb,
  ADD COLUMN IF NOT EXISTS lineage jsonb;

CREATE INDEX IF NOT EXISTS portfolio_target_positions_lineage_gin_idx
  ON portfolio_target_positions USING gin (lineage)
  WHERE lineage IS NOT NULL;

ALTER TABLE portfolio_order_intent_lineage
  ADD COLUMN IF NOT EXISTS execution_terms jsonb,
  ADD COLUMN IF NOT EXISTS risk_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS lineage jsonb,
  ADD COLUMN IF NOT EXISTS policy jsonb,
  ADD COLUMN IF NOT EXISTS immutability jsonb,
  ADD COLUMN IF NOT EXISTS immutable_terms_hash text CHECK (immutable_terms_hash IS NULL OR immutable_terms_hash ~ '^sha256:[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS portfolio_order_intent_lineage_immutability_hash_idx
  ON portfolio_order_intent_lineage(immutable_terms_hash)
  WHERE immutable_terms_hash IS NOT NULL;
