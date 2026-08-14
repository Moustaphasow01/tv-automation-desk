CREATE TABLE IF NOT EXISTS portfolio_arbitration_runs (
  portfolio_arbitration_run_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  portfolio_scope text NOT NULL,
  account_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'ORDER_INTENTS_READY',
    'TARGETS_READY',
    'RISK_BLOCKED',
    'NO_TARGETS',
    'NO_ORDER_INTENTS'
  )),
  as_of_utc timestamptz NOT NULL,
  correlation_id text,
  signal_ids text[] NOT NULL DEFAULT '{}',
  plan_hash text NOT NULL CHECK (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_arbitration_runs_time_idx
  ON portfolio_arbitration_runs(as_of_utc DESC, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS portfolio_arbitration_runs_status_idx
  ON portfolio_arbitration_runs(status, as_of_utc DESC);

CREATE TABLE IF NOT EXISTS portfolio_candidate_allocations (
  candidate_allocation_id text PRIMARY KEY,
  portfolio_arbitration_run_id text NOT NULL REFERENCES portfolio_arbitration_runs(portfolio_arbitration_run_id) ON DELETE CASCADE,
  portfolio_scope text NOT NULL,
  instrument text NOT NULL,
  net_direction text NOT NULL CHECK (net_direction IN ('LONG', 'SHORT', 'FLAT')),
  proposed_size numeric NOT NULL CHECK (proposed_size >= 0),
  long_size numeric NOT NULL DEFAULT 0 CHECK (long_size >= 0),
  short_size numeric NOT NULL DEFAULT 0 CHECK (short_size >= 0),
  net_size numeric NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('PROPOSED', 'NEUTRALIZED')),
  strategy_instance_count integer NOT NULL DEFAULT 0 CHECK (strategy_instance_count >= 0),
  signal_ids text[] NOT NULL DEFAULT '{}',
  as_of_utc timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_candidate_allocations_run_idx
  ON portfolio_candidate_allocations(portfolio_arbitration_run_id, instrument);

CREATE INDEX IF NOT EXISTS portfolio_candidate_allocations_instrument_time_idx
  ON portfolio_candidate_allocations(instrument, as_of_utc DESC);

CREATE TABLE IF NOT EXISTS portfolio_risk_decisions (
  risk_decision_id text PRIMARY KEY,
  candidate_allocation_id text NOT NULL REFERENCES portfolio_candidate_allocations(candidate_allocation_id) ON DELETE CASCADE,
  account_id text NOT NULL,
  instrument text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS', 'REDUCE', 'BLOCK')),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REDUCED', 'REJECTED')),
  requested_size numeric NOT NULL CHECK (requested_size >= 0),
  approved_size numeric NOT NULL CHECK (approved_size >= 0),
  reason_codes text[] NOT NULL DEFAULT '{}',
  limits_applied text[] NOT NULL DEFAULT '{}',
  risk_budget_id text,
  risk_rule_set_version text,
  risk_evaluation_hash text CHECK (risk_evaluation_hash IS NULL OR risk_evaluation_hash ~ '^sha256:[a-f0-9]{64}$'),
  decided_at_utc timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_risk_decisions_allocation_idx
  ON portfolio_risk_decisions(candidate_allocation_id);

CREATE INDEX IF NOT EXISTS portfolio_risk_decisions_status_time_idx
  ON portfolio_risk_decisions(status, decided_at_utc DESC);

CREATE TABLE IF NOT EXISTS portfolio_target_positions (
  target_position_id text PRIMARY KEY,
  portfolio_arbitration_run_id text NOT NULL REFERENCES portfolio_arbitration_runs(portfolio_arbitration_run_id) ON DELETE CASCADE,
  account_id text NOT NULL,
  instrument text NOT NULL,
  net_direction text NOT NULL CHECK (net_direction IN ('LONG', 'SHORT', 'FLAT')),
  current_net_size numeric NOT NULL DEFAULT 0,
  net_target_size numeric NOT NULL DEFAULT 0,
  delta_size numeric NOT NULL DEFAULT 0,
  risk_approved_net_size numeric NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('TARGETED', 'FLAT', 'NO_APPROVED_SIZE')),
  computed_at_utc timestamptz NOT NULL,
  target_hash text NOT NULL CHECK (target_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_target_positions_account_instrument_idx
  ON portfolio_target_positions(account_id, instrument, computed_at_utc DESC);

CREATE INDEX IF NOT EXISTS portfolio_target_positions_run_idx
  ON portfolio_target_positions(portfolio_arbitration_run_id, status);

CREATE TABLE IF NOT EXISTS portfolio_target_position_allocations (
  target_position_id text NOT NULL REFERENCES portfolio_target_positions(target_position_id) ON DELETE CASCADE,
  candidate_allocation_id text NOT NULL REFERENCES portfolio_candidate_allocations(candidate_allocation_id) ON DELETE RESTRICT,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_position_id, candidate_allocation_id)
);

CREATE INDEX IF NOT EXISTS portfolio_target_position_allocations_allocation_idx
  ON portfolio_target_position_allocations(candidate_allocation_id);

CREATE TABLE IF NOT EXISTS portfolio_target_position_risk_decisions (
  target_position_id text NOT NULL REFERENCES portfolio_target_positions(target_position_id) ON DELETE CASCADE,
  risk_decision_id text NOT NULL REFERENCES portfolio_risk_decisions(risk_decision_id) ON DELETE RESTRICT,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_position_id, risk_decision_id)
);

CREATE INDEX IF NOT EXISTS portfolio_target_position_risk_decisions_decision_idx
  ON portfolio_target_position_risk_decisions(risk_decision_id);

CREATE TABLE IF NOT EXISTS portfolio_order_intent_lineage (
  portfolio_order_intent_id text PRIMARY KEY,
  target_position_id text NOT NULL REFERENCES portfolio_target_positions(target_position_id) ON DELETE RESTRICT,
  trade_order_intent_id text REFERENCES trade_order_intents(order_intent_id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  broker_submission_allowed boolean NOT NULL DEFAULT false,
  quantity numeric NOT NULL CHECK (quantity > 0),
  order_intent_hash text NOT NULL CHECK (order_intent_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_order_intent_lineage_target_idx
  ON portfolio_order_intent_lineage(target_position_id);

CREATE INDEX IF NOT EXISTS portfolio_order_intent_lineage_trade_intent_idx
  ON portfolio_order_intent_lineage(trade_order_intent_id)
  WHERE trade_order_intent_id IS NOT NULL;
