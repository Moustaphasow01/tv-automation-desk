DO $$
BEGIN
  CREATE TYPE execution_provider_command_type AS ENUM (
    'submit_order',
    'cancel_order',
    'replace_order',
    'move_stop',
    'move_target',
    'sync_positions',
    'sync_orders'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE execution_provider_command_status AS ENUM (
    'pending',
    'leased',
    'sent',
    'acknowledged',
    'failed',
    'cancelled',
    'expired',
    'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE broker_provider_event_type AS ENUM (
    'order_accepted',
    'order_rejected',
    'order_working',
    'order_cancelled',
    'order_filled',
    'order_partially_filled',
    'position_updated',
    'account_updated',
    'protection_updated',
    'provider_heartbeat',
    'provider_error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS broker_provider_commands (
  execution_provider_command_id text PRIMARY KEY,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text REFERENCES broker_contracts(broker_contract_id),
  command_type execution_provider_command_type NOT NULL,
  status execution_provider_command_status NOT NULL DEFAULT 'pending',
  adapter_id text,
  idempotency_key text NOT NULL UNIQUE,
  command_hash text NOT NULL CHECK (command_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broker_provider_commands_lease_check CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS broker_provider_commands_poll_idx
  ON broker_provider_commands(status, available_at, created_at)
  WHERE status IN ('pending', 'leased');

CREATE INDEX IF NOT EXISTS broker_provider_commands_intent_idx
  ON broker_provider_commands(order_intent_id, created_at DESC)
  WHERE order_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS broker_provider_events (
  broker_provider_event_id text PRIMARY KEY,
  execution_provider_command_id text REFERENCES broker_provider_commands(execution_provider_command_id) ON DELETE SET NULL,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text REFERENCES broker_contracts(broker_contract_id),
  external_event_key text NOT NULL UNIQUE,
  event_type broker_provider_event_type NOT NULL,
  provider_order_ref text,
  event_status text,
  side order_side,
  quantity numeric CHECK (quantity IS NULL OR quantity >= 0),
  fill_quantity numeric CHECK (fill_quantity IS NULL OR fill_quantity >= 0),
  fill_price numeric,
  position_size numeric,
  occurred_at timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_provider_events_account_time_idx
  ON broker_provider_events(broker_account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS broker_provider_events_intent_time_idx
  ON broker_provider_events(order_intent_id, occurred_at DESC)
  WHERE order_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_provider_events_provider_ref_time_idx
  ON broker_provider_events(broker_provider_code, provider_order_ref, occurred_at DESC)
  WHERE provider_order_ref IS NOT NULL;
