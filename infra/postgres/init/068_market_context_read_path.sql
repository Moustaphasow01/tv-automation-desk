CREATE INDEX IF NOT EXISTS market_desk_briefs_snapshot_time_idx
  ON market_desk_briefs(market_context_snapshot_id, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS market_context_prefilter_universe_time_idx
  ON market_context_prefilter_decisions(universe, decided_at_utc DESC);

COMMENT ON INDEX market_desk_briefs_snapshot_time_idx IS
  'Supports the atomic current snapshot and linked brief read used by the operator BFF.';

COMMENT ON INDEX market_context_prefilter_universe_time_idx IS
  'Bounds the current-universe prefilter window without scanning historical decisions.';
