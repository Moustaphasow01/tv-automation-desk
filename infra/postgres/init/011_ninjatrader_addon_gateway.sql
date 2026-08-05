ALTER TABLE broker_bridge_heartbeats
  ADD COLUMN IF NOT EXISTS adapter_kind text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS protocol_version text,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS command_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE broker_bridge_heartbeats
    ADD CONSTRAINT broker_bridge_heartbeats_adapter_kind_check
    CHECK (adapter_kind IN ('unknown', 'ati', 'addon'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE broker_bridge_heartbeats
SET adapter_kind = CASE
  WHEN mode::text = 'sim101_addon_approved_only' THEN 'addon'
  WHEN mode::text LIKE 'sim101_ati_%' OR mode::text = 'dry_run_file' THEN 'ati'
  ELSE 'unknown'
END
WHERE adapter_kind = 'unknown';

CREATE TABLE IF NOT EXISTS broker_addon_snapshots (
  addon_snapshot_id text PRIMARY KEY,
  bridge_id text NOT NULL REFERENCES broker_bridge_heartbeats(bridge_id) ON DELETE CASCADE,
  broker_account_id text NOT NULL REFERENCES broker_accounts(broker_account_id),
  account_name text NOT NULL,
  captured_at timestamptz NOT NULL,
  connection jsonb NOT NULL DEFAULT '{}'::jsonb,
  account jsonb NOT NULL DEFAULT '{}'::jsonb,
  orders jsonb NOT NULL DEFAULT '[]'::jsonb,
  positions jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS broker_addon_snapshots_account_time_idx
  ON broker_addon_snapshots(broker_account_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS broker_addon_snapshots_bridge_time_idx
  ON broker_addon_snapshots(bridge_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS broker_addon_events (
  addon_event_id text PRIMARY KEY,
  bridge_id text NOT NULL REFERENCES broker_bridge_heartbeats(bridge_id) ON DELETE CASCADE,
  broker_account_id text NOT NULL REFERENCES broker_accounts(broker_account_id),
  account_name text NOT NULL,
  external_event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('order', 'execution', 'position', 'account', 'connection', 'command')),
  intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  management_intent_id text REFERENCES trade_management_intents(management_intent_id) ON DELETE SET NULL,
  command_id text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_addon_events_account_time_idx
  ON broker_addon_events(broker_account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS broker_addon_events_intent_idx
  ON broker_addon_events(intent_id, management_intent_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS broker_adapter_parity_runs (
  adapter_parity_run_id text PRIMARY KEY,
  broker_account_id text NOT NULL REFERENCES broker_accounts(broker_account_id),
  left_adapter text NOT NULL CHECK (left_adapter IN ('ati', 'addon')),
  right_adapter text NOT NULL CHECK (right_adapter IN ('ati', 'addon')),
  status text NOT NULL CHECK (status IN ('matched', 'diverged', 'incomplete', 'failed')),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
  left_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  right_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  compared_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS broker_adapter_parity_runs_account_time_idx
  ON broker_adapter_parity_runs(broker_account_id, compared_at DESC);
