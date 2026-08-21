-- 058_portfolio_order_intent_theoretical_execution.sql
-- Connect VNext Portfolio OrderIntent lineage to the deterministic theoretical
-- execution tracker. SEMI_MANUAL operator actions remain observational only:
-- these columns let the backend track entry/expiry/TP/SL theoretically without
-- creating provider or broker orders.

ALTER TABLE trade_theoretical_execution_events
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

ALTER TABLE trade_manual_execution_events
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

ALTER TABLE trades
  ALTER COLUMN trade_decision_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS trade_theoretical_events_portfolio_intent_idx
  ON trade_theoretical_execution_events(portfolio_order_intent_id, event_at_utc DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trade_manual_events_portfolio_intent_idx
  ON trade_manual_execution_events(portfolio_order_intent_id, occurred_at_utc DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trades_portfolio_intent_idx
  ON trades(portfolio_order_intent_id, updated_at DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

COMMENT ON COLUMN trade_theoretical_execution_events.portfolio_order_intent_id
  IS 'Canonical VNext Portfolio OrderIntent tracked by deterministic theoretical execution; never a provider/broker fill proof.';

COMMENT ON COLUMN trade_manual_execution_events.portfolio_order_intent_id
  IS 'Optional operator-reported VNext OrderIntent reference; observational only and never authoritative for theoretical fills.';

COMMENT ON COLUMN trades.portfolio_order_intent_id
  IS 'Canonical VNext Portfolio OrderIntent that opened this theoretical or broker trade lifecycle.';

COMMENT ON COLUMN trades.trade_decision_id
  IS 'Legacy trade decision reference. Nullable for VNext portfolio OrderIntent lifecycles, which are linked by portfolio_order_intent_id.';
