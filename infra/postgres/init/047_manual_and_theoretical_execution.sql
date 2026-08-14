DO $$
BEGIN
  CREATE TYPE theoretical_execution_event_type AS ENUM (
    'entry_filled',
    'entry_expired',
    'stop_hit',
    'target_hit',
    'exit_review_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE manual_execution_event_type AS ENUM (
    'placed',
    'filled',
    'skipped',
    'closed',
    'modified',
    'note'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trade_theoretical_execution_events (
  theoretical_execution_event_id text PRIMARY KEY,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  trade_id text REFERENCES trades(trade_id) ON DELETE SET NULL,
  event_type theoretical_execution_event_type NOT NULL,
  event_at_utc timestamptz NOT NULL,
  source_candle_feed_id text,
  source_candle_timestamp_utc timestamptz,
  quantity numeric CHECK (quantity IS NULL OR quantity > 0),
  price numeric CHECK (price IS NULL OR price > 0),
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS theoretical_execution_events_idempotency_idx
  ON trade_theoretical_execution_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS theoretical_execution_events_intent_idx
  ON trade_theoretical_execution_events(order_intent_id, event_at_utc DESC);

CREATE INDEX IF NOT EXISTS theoretical_execution_events_trade_idx
  ON trade_theoretical_execution_events(trade_id, event_at_utc DESC);

CREATE INDEX IF NOT EXISTS theoretical_execution_events_candle_idx
  ON trade_theoretical_execution_events(source_candle_feed_id, source_candle_timestamp_utc DESC);

CREATE TABLE IF NOT EXISTS trade_manual_execution_events (
  manual_execution_event_id text PRIMARY KEY,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  trade_id text REFERENCES trades(trade_id) ON DELETE SET NULL,
  management_intent_id text REFERENCES trade_management_intents(management_intent_id) ON DELETE SET NULL,
  event_type manual_execution_event_type NOT NULL,
  source text NOT NULL DEFAULT 'front',
  actor text,
  quantity numeric CHECK (quantity IS NULL OR quantity > 0),
  price numeric CHECK (price IS NULL OR price > 0),
  reason text,
  occurred_at_utc timestamptz NOT NULL,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_execution_events_idempotency_idx
  ON trade_manual_execution_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS manual_execution_events_intent_idx
  ON trade_manual_execution_events(order_intent_id, occurred_at_utc DESC);

CREATE INDEX IF NOT EXISTS manual_execution_events_trade_idx
  ON trade_manual_execution_events(trade_id, occurred_at_utc DESC);

CREATE INDEX IF NOT EXISTS manual_execution_events_management_idx
  ON trade_manual_execution_events(management_intent_id, occurred_at_utc DESC);

COMMENT ON TABLE trade_theoretical_execution_events IS
  'Deterministic backend-only paper execution events. A Telegram/front alert never implies fill; order type and closed OHLC candles drive fills.';

COMMENT ON TABLE trade_manual_execution_events IS
  'Operator execution acknowledgements from front or Telegram. This ledger is observational and does not mutate theoretical fills.';
