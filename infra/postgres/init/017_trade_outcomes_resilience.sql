DO $$
BEGIN
  CREATE TYPE trade_outcome_status AS ENUM ('partial', 'final', 'void', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS initial_stop_price numeric,
  ADD COLUMN IF NOT EXISTS initial_risk_amount numeric,
  ADD COLUMN IF NOT EXISTS gross_realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS total_fees numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS result_r numeric,
  ADD COLUMN IF NOT EXISTS mfe_r numeric,
  ADD COLUMN IF NOT EXISTS mae_r numeric,
  ADD COLUMN IF NOT EXISTS outcome_schema_version text,
  ADD COLUMN IF NOT EXISTS outcome_evidence_hash text;

CREATE TABLE IF NOT EXISTS trade_outcomes (
  trade_outcome_id text PRIMARY KEY,
  trade_id text NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status trade_outcome_status NOT NULL,
  schema_version text NOT NULL,
  engine_version text NOT NULL,
  initial_risk_amount numeric NOT NULL CHECK (initial_risk_amount > 0),
  gross_realized_pnl numeric NOT NULL,
  total_fees numeric NOT NULL CHECK (total_fees >= 0),
  net_realized_pnl numeric NOT NULL,
  result_r numeric NOT NULL,
  mfe_r numeric,
  mae_r numeric,
  evidence_hash text NOT NULL,
  evidence jsonb NOT NULL,
  calculated_at_utc timestamptz NOT NULL,
  finalized_at_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_id, revision),
  UNIQUE(trade_id, evidence_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_outcomes_final_trade_idx
  ON trade_outcomes(trade_id)
  WHERE status = 'final';

CREATE INDEX IF NOT EXISTS trade_outcomes_result_idx
  ON trade_outcomes(status, calculated_at_utc DESC, result_r);

COMMENT ON TABLE trade_outcomes IS
  'Canonical deterministic PnL/R results. Initial risk is immutable; corrections require a new revision.';
