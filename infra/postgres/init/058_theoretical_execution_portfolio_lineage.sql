-- TD2 — Semi-manual canonical paper tracking.
-- The theoretical engine now follows post-risk Portfolio OrderIntents directly.
-- Legacy trade_order_intents remain supported; new canonical rows keep their
-- portfolio_order_intent_id instead of overloading the legacy FK.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trades_portfolio_order_intent_idx
  ON trades(portfolio_order_intent_id, updated_at DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

ALTER TABLE trade_theoretical_execution_events
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS theoretical_execution_events_portfolio_intent_idx
  ON trade_theoretical_execution_events(portfolio_order_intent_id, event_at_utc DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

ALTER TABLE trade_manual_execution_events
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS manual_execution_events_portfolio_intent_idx
  ON trade_manual_execution_events(portfolio_order_intent_id, occurred_at_utc DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

COMMENT ON COLUMN trades.portfolio_order_intent_id IS
  'Canonical post-risk OrderIntent followed by the deterministic theoretical execution engine. Legacy trades.order_intent_id remains for trade_order_intents only.';

COMMENT ON COLUMN trade_theoretical_execution_events.portfolio_order_intent_id IS
  'Canonical Portfolio OrderIntent source for deterministic paper entry/exit events. Confirmation or Telegram actions do not imply fill.';

COMMENT ON COLUMN trade_manual_execution_events.portfolio_order_intent_id IS
  'Operator-reported manual execution linkage for canonical Portfolio OrderIntents; observational only and never a theoretical fill authority.';
