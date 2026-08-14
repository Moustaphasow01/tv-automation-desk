-- TD2-105 / ADR-0004
-- Additive link from execution trades to Strategy Kernel instances.
-- Important invariant: legacy trades.strategy_id is not reinterpreted and no
-- historical backfill is performed from strategy_id to strategy_instance_id.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS strategy_instance_id uuid;

DO $$
BEGIN
  ALTER TABLE trades
    ADD CONSTRAINT trades_strategy_instance_fk
    FOREIGN KEY (strategy_instance_id)
    REFERENCES strategy_instances(strategy_instance_id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS trades_strategy_instance_idx
  ON trades(strategy_instance_id)
  WHERE strategy_instance_id IS NOT NULL;

COMMENT ON COLUMN trades.strategy_instance_id IS
  'Nullable Strategy Kernel instance FK for new trades only. Do not backfill from legacy trades.strategy_id.';
