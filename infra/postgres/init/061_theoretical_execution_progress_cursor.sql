-- TD2 — Fair, durable progress for deterministic theoretical exits.
--
-- Theoretical tracking used to derive its cursor only from materialized events.
-- A candle that touched neither stop nor target therefore made no durable
-- progress and the same 500 candles were scanned forever. Combined with a
-- bounded oldest-updated trade list, this could starve recent trades.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS theoretical_cursor_at_utc timestamptz;

UPDATE trades t
SET theoretical_cursor_at_utc = COALESCE(
  (
    SELECT max(e.source_candle_timestamp_utc)
    FROM trade_theoretical_execution_events e
    WHERE e.trade_id = t.trade_id
  ),
  (
    SELECT max(e.event_at_utc)
    FROM trade_theoretical_execution_events e
    WHERE e.trade_id = t.trade_id
  ),
  t.opened_at
)
WHERE t.theoretical_cursor_at_utc IS NULL
  AND (
    t.portfolio_order_intent_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM trade_theoretical_execution_events e
      WHERE e.trade_id = t.trade_id
    )
  );

CREATE INDEX IF NOT EXISTS trades_theoretical_exit_progress_idx
  ON trades (
    COALESCE(theoretical_cursor_at_utc, opened_at),
    opened_at,
    trade_id
  )
  WHERE status IN ('open', 'scaling', 'protected')
    AND quantity_open > 0
    AND current_stop_price IS NOT NULL
    AND current_target_price IS NOT NULL;

COMMENT ON COLUMN trades.theoretical_cursor_at_utc IS
  'Last closed M1 candle durably evaluated by the deterministic theoretical exit engine. Monotone progress prevents repeated scans and bounded-batch starvation.';
