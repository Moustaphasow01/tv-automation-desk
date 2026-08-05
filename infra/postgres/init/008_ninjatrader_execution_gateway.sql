DO $$
BEGIN
  CREATE TYPE broker_bridge_mode AS ENUM (
    'disabled',
    'dry_run_file',
    'sim101_ati_manual_arm',
    'sim101_ati_approved_only',
    'sim101_addon_approved_only',
    'live_read_only_reconciliation',
    'live_limited_approved_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE broker_bridge_status AS ENUM ('offline', 'starting', 'healthy', 'degraded', 'read_only', 'armed', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE execution_outbox_status AS ENUM ('pending', 'leased', 'rendered', 'delivered', 'acknowledged', 'failed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS materialization_key text;
CREATE UNIQUE INDEX IF NOT EXISTS trade_decisions_materialization_key_idx
  ON trade_decisions(materialization_key)
  WHERE materialization_key IS NOT NULL;

ALTER TABLE trade_risk_checks ADD COLUMN IF NOT EXISTS policy_profile_id text;
ALTER TABLE trade_order_intents ADD COLUMN IF NOT EXISTS risk_check_id text REFERENCES trade_risk_checks(risk_check_id);

CREATE TABLE IF NOT EXISTS trade_policy_profiles (
  policy_profile_id text PRIMARY KEY,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  environment desk_data_environment NOT NULL DEFAULT 'preprod',
  allowed_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_instruments jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_contracts integer NOT NULL DEFAULT 0 CHECK (max_contracts >= 0),
  max_daily_loss numeric NOT NULL DEFAULT 0 CHECK (max_daily_loss >= 0),
  min_reward_risk numeric NOT NULL DEFAULT 1 CHECK (min_reward_risk > 0),
  require_operator_approval boolean NOT NULL DEFAULT true,
  order_ttl_seconds integer NOT NULL DEFAULT 60 CHECK (order_ttl_seconds BETWEEN 5 AND 3600),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_bridge_heartbeats (
  bridge_id text PRIMARY KEY,
  broker_provider_code text NOT NULL REFERENCES broker_providers(broker_provider_code),
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  mode broker_bridge_mode NOT NULL DEFAULT 'disabled',
  status broker_bridge_status NOT NULL DEFAULT 'offline',
  host_name text,
  process_id integer,
  ninja_connected boolean NOT NULL DEFAULT false,
  ati_enabled boolean NOT NULL DEFAULT false,
  account_name text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_bridge_heartbeats_health_idx
  ON broker_bridge_heartbeats(status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS broker_execution_locks (
  execution_lock_id text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('global', 'account', 'instrument', 'session')),
  scope_value text NOT NULL DEFAULT '*',
  locked boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(scope_type, scope_value)
);

CREATE INDEX IF NOT EXISTS broker_execution_locks_active_idx
  ON broker_execution_locks(locked, scope_type, scope_value);

CREATE TABLE IF NOT EXISTS broker_account_snapshots (
  broker_account_snapshot_id text PRIMARY KEY,
  broker_account_id text NOT NULL REFERENCES broker_accounts(broker_account_id),
  cash_value numeric,
  buying_power numeric,
  realized_pnl numeric,
  unrealized_pnl numeric,
  margin_used numeric,
  open_position_count integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS broker_account_snapshots_account_time_idx
  ON broker_account_snapshots(broker_account_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS broker_reconciliation_runs (
  reconciliation_run_id text PRIMARY KEY,
  bridge_id text REFERENCES broker_bridge_heartbeats(bridge_id),
  broker_account_id text REFERENCES broker_accounts(broker_account_id),
  status text NOT NULL CHECK (status IN ('running', 'matched', 'diverged', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
  broker_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  desk_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS broker_reconciliation_runs_account_time_idx
  ON broker_reconciliation_runs(broker_account_id, started_at DESC);

CREATE TABLE IF NOT EXISTS broker_execution_outbox (
  execution_outbox_id text PRIMARY KEY,
  order_intent_id text NOT NULL UNIQUE REFERENCES trade_order_intents(order_intent_id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS broker_execution_outbox_poll_idx
  ON broker_execution_outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'leased', 'rendered');

ALTER TABLE trade_approvals ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS trade_approvals_idempotency_key_idx
  ON trade_approvals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE broker_order_events ADD COLUMN IF NOT EXISTS external_event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS broker_order_events_external_event_key_idx
  ON broker_order_events(external_event_key)
  WHERE external_event_key IS NOT NULL;

INSERT INTO trade_policy_profiles (
  policy_profile_id,
  display_name,
  enabled,
  environment,
  allowed_accounts,
  allowed_instruments,
  allowed_sessions,
  max_contracts,
  max_daily_loss,
  min_reward_risk,
  require_operator_approval,
  order_ttl_seconds,
  metadata
) VALUES (
  'ninjatrader_sim101_local',
  'NinjaTrader Sim101 local — verrouillé',
  false,
  'preprod',
  '["ninjatrader_paper_local"]'::jsonb,
  '["MNQ", "MES"]'::jsonb,
  '["asia_open", "ny_open"]'::jsonb,
  0,
  0,
  1.5,
  true,
  60,
  '{"account_name_allowlist": ["Sim101"], "live_forbidden": true}'::jsonb
)
ON CONFLICT (policy_profile_id) DO NOTHING;

INSERT INTO broker_execution_locks (
  execution_lock_id,
  scope_type,
  scope_value,
  locked,
  reason,
  set_by,
  metadata
) VALUES (
  'global_default_kill_switch',
  'global',
  '*',
  true,
  'Default safety lock: broker execution is not armed.',
  'schema_seed',
  '{"requires_explicit_operator_unlock": true}'::jsonb
)
ON CONFLICT (execution_lock_id) DO NOTHING;
