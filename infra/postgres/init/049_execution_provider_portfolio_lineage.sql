ALTER TABLE broker_provider_commands
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

ALTER TABLE broker_provider_events
  ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS broker_provider_commands_portfolio_intent_idx
  ON broker_provider_commands(portfolio_order_intent_id, created_at DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_provider_events_portfolio_intent_time_idx
  ON broker_provider_events(portfolio_order_intent_id, occurred_at DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE broker_provider_commands
    ADD CONSTRAINT broker_provider_commands_order_intent_source_check
    CHECK (
      command_type IN ('sync_positions', 'sync_orders')
      OR order_intent_id IS NOT NULL
      OR portfolio_order_intent_id IS NOT NULL
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE broker_provider_events
    ADD CONSTRAINT broker_provider_events_order_intent_source_check
    CHECK (
      event_type NOT IN (
        'order_accepted',
        'order_rejected',
        'order_working',
        'order_cancelled',
        'order_filled',
        'order_partially_filled'
      )
      OR order_intent_id IS NOT NULL
      OR portfolio_order_intent_id IS NOT NULL
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
