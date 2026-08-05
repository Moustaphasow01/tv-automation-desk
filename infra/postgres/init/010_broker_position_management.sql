DO $$
BEGIN
  CREATE TYPE trade_management_action AS ENUM ('move_stop', 'reduce_position', 'close_position');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE trade_management_status AS ENUM (
    'draft',
    'blocked',
    'pending_approval',
    'approved',
    'queued',
    'leased',
    'rendered',
    'delivered',
    'acknowledged',
    'rejected',
    'cancelled',
    'expired',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_stop_price numeric,
  ADD COLUMN IF NOT EXISTS current_target_price numeric,
  ADD COLUMN IF NOT EXISTS atm_strategy_id text;

DO $$
BEGIN
  ALTER TABLE trades
    ADD CONSTRAINT trades_revision_check CHECK (revision >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trade_management_intents (
  management_intent_id text PRIMARY KEY,
  trade_id text NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  source_collection text NOT NULL,
  source_document_id text NOT NULL,
  source_action text NOT NULL,
  action trade_management_action NOT NULL,
  status trade_management_status NOT NULL DEFAULT 'draft',
  approval_status approval_status NOT NULL DEFAULT 'required',
  expected_trade_revision integer NOT NULL CHECK (expected_trade_revision >= 0),
  requested_quantity integer CHECK (requested_quantity IS NULL OR requested_quantity > 0),
  requested_stop_price numeric,
  reason text NOT NULL,
  risk_reducing boolean NOT NULL DEFAULT true,
  guard_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  command_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_id, source_collection, source_document_id, action)
);

CREATE INDEX IF NOT EXISTS trade_management_intents_queue_idx
  ON trade_management_intents(status, approval_status, requested_at DESC);

CREATE INDEX IF NOT EXISTS trade_management_intents_trade_idx
  ON trade_management_intents(trade_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS trade_management_approvals (
  management_approval_id text PRIMARY KEY,
  management_intent_id text NOT NULL REFERENCES trade_management_intents(management_intent_id) ON DELETE CASCADE,
  status approval_status NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_management_outbox (
  management_outbox_id text PRIMARY KEY,
  management_intent_id text NOT NULL UNIQUE REFERENCES trade_management_intents(management_intent_id) ON DELETE CASCADE,
  bridge_id text REFERENCES broker_bridge_heartbeats(bridge_id),
  status execution_outbox_status NOT NULL DEFAULT 'pending',
  command_payload jsonb NOT NULL,
  rendered_command text,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_management_outbox_poll_idx
  ON broker_management_outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'leased', 'rendered');

ALTER TABLE broker_orders
  ADD COLUMN IF NOT EXISTS management_intent_id text REFERENCES trade_management_intents(management_intent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS broker_orders_management_intent_idx
  ON broker_orders(management_intent_id, created_at DESC)
  WHERE management_intent_id IS NOT NULL;
