ALTER TYPE execution_provider_command_status ADD VALUE IF NOT EXISTS 'unknown';
ALTER TYPE execution_provider_command_status ADD VALUE IF NOT EXISTS 'reconciliation_required';

CREATE TABLE IF NOT EXISTS human_execution_gates (
  human_execution_gate_id text PRIMARY KEY,
  portfolio_order_intent_id text NOT NULL UNIQUE
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'AWAITING_MANUAL_CONFIRMATION',
    'CONFIRMED',
    'REJECTED',
    'EXPIRED',
    'INVALIDATED',
    'EXECUTION_BLOCKED',
    'CERTIFICATION_AUTO_APPROVED'
  )),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  operator_id text,
  idempotency_key text UNIQUE,
  confirmed_at_utc timestamptz,
  rejected_at_utc timestamptz,
  expires_at_utc timestamptz,
  terms_hash text CHECK (terms_hash IS NULL OR terms_hash ~ '^sha256:[a-f0-9]{64}$'),
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT human_execution_gate_confirmed_terms_check CHECK (
    status NOT IN ('CONFIRMED', 'CERTIFICATION_AUTO_APPROVED')
    OR (operator_id IS NOT NULL AND confirmed_at_utc IS NOT NULL AND terms_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS human_execution_gates_status_idx
  ON human_execution_gates(status, expires_at_utc, updated_at_utc DESC);

CREATE TABLE IF NOT EXISTS human_execution_gate_events (
  human_execution_gate_event_id text PRIMARY KEY,
  human_execution_gate_id text NOT NULL REFERENCES human_execution_gates(human_execution_gate_id) ON DELETE CASCADE,
  portfolio_order_intent_id text NOT NULL REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'OPENED',
    'CONFIRM_REQUESTED',
    'CONFIRMED',
    'REJECTED',
    'EXPIRED',
    'INVALIDATED',
    'REFUSED'
  )),
  operator_id text,
  idempotency_key text,
  occurred_at_utc timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS human_execution_gate_events_idempotency_idx
  ON human_execution_gate_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS human_execution_gate_events_intent_time_idx
  ON human_execution_gate_events(portfolio_order_intent_id, occurred_at_utc DESC);

CREATE TABLE IF NOT EXISTS portfolio_order_intent_execution_states (
  portfolio_order_intent_id text PRIMARY KEY
    REFERENCES portfolio_order_intent_lineage(portfolio_order_intent_id) ON DELETE CASCADE,
  execution_provider_command_id text
    REFERENCES broker_provider_commands(execution_provider_command_id) ON DELETE SET NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN (
    'AWAITING_MANUAL_CONFIRMATION',
    'PROVIDER_COMMAND_READY',
    'LEASED',
    'SENT',
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
    'FILLED',
    'REJECTED',
    'CANCELLED',
    'EXPIRED',
    'UNKNOWN',
    'RECONCILIATION_REQUIRED',
    'BLOCKED'
  )),
  provider_order_ref text,
  filled_quantity numeric NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  average_fill_price numeric,
  last_event_id text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_order_intent_execution_states_status_idx
  ON portfolio_order_intent_execution_states(lifecycle_status, updated_at_utc DESC);

CREATE INDEX IF NOT EXISTS broker_provider_commands_portfolio_status_idx
  ON broker_provider_commands(portfolio_order_intent_id, status, updated_at DESC)
  WHERE portfolio_order_intent_id IS NOT NULL;
