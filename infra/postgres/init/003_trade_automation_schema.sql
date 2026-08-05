DO $$
BEGIN
  CREATE TYPE execution_mode AS ENUM ('live', 'paper', 'replay', 'backtest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE trade_side AS ENUM ('long', 'short');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE order_side AS ENUM ('buy', 'sell');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop_market', 'stop_limit', 'bracket', 'oco', 'cancel', 'modify');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE decision_status AS ENUM ('draft', 'candidate', 'validated', 'rejected', 'expired', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE risk_check_status AS ENUM ('pass', 'fail', 'warning', 'skipped', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE approval_status AS ENUM ('not_required', 'required', 'approved', 'rejected', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE order_intent_status AS ENUM (
    'draft',
    'blocked',
    'pending_approval',
    'approved',
    'queued',
    'sent',
    'acknowledged',
    'rejected',
    'cancelled',
    'expired',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE broker_order_status AS ENUM (
    'created',
    'submitted',
    'accepted',
    'working',
    'partially_filled',
    'filled',
    'cancel_requested',
    'cancelled',
    'rejected',
    'expired',
    'error',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE trade_status AS ENUM (
    'planned',
    'armed',
    'submitted',
    'open',
    'scaling',
    'protected',
    'closing',
    'closed',
    'cancelled',
    'rejected',
    'expired',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fill_liquidity AS ENUM ('maker', 'taker', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE lifecycle_event_type AS ENUM (
    'decision_created',
    'risk_checked',
    'approval_requested',
    'approval_granted',
    'approval_rejected',
    'intent_created',
    'intent_queued',
    'intent_sent',
    'broker_ack',
    'broker_reject',
    'order_working',
    'order_filled',
    'partial_fill',
    'stop_moved',
    'target_hit',
    'manual_intervention',
    'trade_closed',
    'trade_cancelled',
    'sync_reconciled',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS broker_providers (
  broker_provider_code text PRIMARY KEY,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_accounts (
  broker_account_id text PRIMARY KEY,
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  account_label text NOT NULL,
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  mode execution_mode NOT NULL DEFAULT 'paper',
  currency text,
  read_only boolean NOT NULL DEFAULT true,
  order_submission_enabled boolean NOT NULL DEFAULT false,
  max_contracts integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_contracts IS NULL OR max_contracts >= 0)
);

CREATE INDEX IF NOT EXISTS broker_accounts_provider_enabled_idx
  ON broker_accounts(broker_provider_code, order_submission_enabled, read_only);

CREATE TABLE IF NOT EXISTS broker_contracts (
  broker_contract_id text PRIMARY KEY,
  instrument_code text NOT NULL REFERENCES market_instruments(instrument_code),
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  broker_symbol text NOT NULL,
  exchange text,
  currency text,
  expiry_date date,
  multiplier numeric,
  tick_size numeric,
  point_value numeric,
  active boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(broker_provider_code, broker_symbol, expiry_date)
);

CREATE INDEX IF NOT EXISTS broker_contracts_instrument_active_idx
  ON broker_contracts(instrument_code, active, expiry_date);

CREATE TABLE IF NOT EXISTS trade_decisions (
  trade_decision_id text PRIMARY KEY,
  source_collection text,
  source_document_id text,
  mode execution_mode NOT NULL DEFAULT 'paper',
  status decision_status NOT NULL DEFAULT 'draft',
  instrument_code text REFERENCES market_instruments(instrument_code),
  symbol_id text REFERENCES market_symbols(symbol_id),
  side trade_side,
  strategy_id text,
  trading_date text,
  session text,
  decided_at timestamptz,
  valid_until timestamptz,
  entry_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  thesis_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  rationale text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS trade_decisions_scope_idx
  ON trade_decisions(mode, trading_date, session, strategy_id);

CREATE INDEX IF NOT EXISTS trade_decisions_source_idx
  ON trade_decisions(source_collection, source_document_id);

CREATE INDEX IF NOT EXISTS trade_decisions_status_idx
  ON trade_decisions(status, decided_at DESC);

CREATE TABLE IF NOT EXISTS trade_risk_checks (
  risk_check_id text PRIMARY KEY,
  trade_decision_id text NOT NULL REFERENCES trade_decisions(trade_decision_id) ON DELETE CASCADE,
  status risk_check_status NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by text,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS trade_risk_checks_decision_idx
  ON trade_risk_checks(trade_decision_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS trade_order_intents (
  order_intent_id text PRIMARY KEY,
  trade_decision_id text NOT NULL REFERENCES trade_decisions(trade_decision_id) ON DELETE CASCADE,
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text NOT NULL REFERENCES broker_contracts(broker_contract_id),
  status order_intent_status NOT NULL DEFAULT 'draft',
  approval_status approval_status NOT NULL DEFAULT 'required',
  side order_side NOT NULL,
  order_type order_type NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  limit_price numeric,
  stop_price numeric,
  time_in_force text,
  bracket jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS trade_order_intents_decision_idx
  ON trade_order_intents(trade_decision_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS trade_order_intents_status_idx
  ON trade_order_intents(status, approval_status, requested_at DESC);

CREATE TABLE IF NOT EXISTS trade_approvals (
  trade_approval_id text PRIMARY KEY,
  order_intent_id text NOT NULL REFERENCES trade_order_intents(order_intent_id) ON DELETE CASCADE,
  status approval_status NOT NULL,
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_approvals_intent_idx
  ON trade_approvals(order_intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broker_orders (
  broker_order_id text PRIMARY KEY,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text REFERENCES broker_contracts(broker_contract_id),
  broker_order_ref text,
  parent_broker_order_ref text,
  status broker_order_status NOT NULL DEFAULT 'created',
  side order_side NOT NULL,
  order_type order_type NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  limit_price numeric,
  stop_price numeric,
  submitted_at timestamptz,
  last_broker_update_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_orders_provider_ref_idx
  ON broker_orders(broker_provider_code, broker_order_ref)
  WHERE broker_order_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_orders_status_idx
  ON broker_orders(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS broker_order_events (
  broker_order_event_id text PRIMARY KEY,
  broker_order_id text REFERENCES broker_orders(broker_order_id) ON DELETE CASCADE,
  event_type lifecycle_event_type,
  status broker_order_status,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_order_events_order_time_idx
  ON broker_order_events(broker_order_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS trades (
  trade_id text PRIMARY KEY,
  trade_decision_id text REFERENCES trade_decisions(trade_decision_id) ON DELETE SET NULL,
  order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text REFERENCES broker_contracts(broker_contract_id),
  status trade_status NOT NULL DEFAULT 'planned',
  side trade_side NOT NULL,
  quantity_planned numeric,
  quantity_open numeric NOT NULL DEFAULT 0,
  quantity_closed numeric NOT NULL DEFAULT 0,
  avg_entry_price numeric,
  avg_exit_price numeric,
  realized_pnl numeric,
  unrealized_pnl numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  trading_date text,
  session text,
  strategy_id text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trades_status_idx
  ON trades(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS trades_scope_idx
  ON trades(trading_date, session, strategy_id);

CREATE TABLE IF NOT EXISTS trade_fills (
  trade_fill_id text PRIMARY KEY,
  trade_id text REFERENCES trades(trade_id) ON DELETE SET NULL,
  broker_order_id text REFERENCES broker_orders(broker_order_id) ON DELETE SET NULL,
  broker_fill_ref text,
  side order_side NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  price numeric NOT NULL,
  commission numeric,
  filled_at timestamptz NOT NULL,
  liquidity fill_liquidity NOT NULL DEFAULT 'unknown',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_fills_broker_ref_idx
  ON trade_fills(broker_order_id, broker_fill_ref)
  WHERE broker_fill_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS trade_fills_trade_time_idx
  ON trade_fills(trade_id, filled_at DESC);

CREATE TABLE IF NOT EXISTS trade_events (
  trade_event_id text PRIMARY KEY,
  trade_id text REFERENCES trades(trade_id) ON DELETE CASCADE,
  event_type lifecycle_event_type NOT NULL,
  status trade_status,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_events_trade_time_idx
  ON trade_events(trade_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS trade_position_snapshots (
  trade_position_snapshot_id text PRIMARY KEY,
  trade_id text REFERENCES trades(trade_id) ON DELETE CASCADE,
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  broker_contract_id text REFERENCES broker_contracts(broker_contract_id),
  status trade_status NOT NULL,
  quantity_open numeric NOT NULL DEFAULT 0,
  avg_entry_price numeric,
  stop_price numeric,
  target_price numeric,
  unrealized_pnl numeric,
  captured_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS trade_position_snapshots_trade_time_idx
  ON trade_position_snapshots(trade_id, captured_at DESC);
