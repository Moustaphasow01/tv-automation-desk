CREATE TABLE IF NOT EXISTS strategy_kernel_audit_events (
  strategy_kernel_audit_event_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text,
  actor text NOT NULL,
  reason text,
  previous_hash text,
  next_hash text,
  previous_status text,
  next_status text,
  previous_runtime_state text,
  next_runtime_state text,
  previous_execution_mode text,
  next_execution_mode text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (aggregate_type IN ('strategy_definition', 'strategy_version', 'strategy_instance')),
  CHECK (length(trim(event_type)) >= 3),
  CHECK (length(trim(actor)) >= 3),
  CHECK (previous_hash IS NULL OR previous_hash ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (next_hash IS NULL OR next_hash ~ '^sha256:[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_kernel_audit_events_idempotency_idx
  ON strategy_kernel_audit_events(aggregate_type, aggregate_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS strategy_kernel_audit_events_aggregate_idx
  ON strategy_kernel_audit_events(aggregate_type, aggregate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS strategy_kernel_audit_events_event_type_idx
  ON strategy_kernel_audit_events(event_type, created_at DESC);
