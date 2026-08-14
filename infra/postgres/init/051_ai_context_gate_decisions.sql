CREATE TABLE IF NOT EXISTS ai_context_gate_decisions (
  ai_context_gate_decision_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  agent_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  signal_id text,
  candidate_allocation_id text,
  position_id text,
  mode text NOT NULL CHECK (mode IN ('SHADOW', 'ADVISORY', 'ENFORCED')),
  status text NOT NULL CHECK (status IN (
    'SHADOW_RECORDED',
    'ADVISORY_READY',
    'ENFORCED_DECISION_READY',
    'ENFORCED_BLOCKED',
    'FALLBACK_WAIT',
    'DISABLED'
  )),
  recommendation text NOT NULL CHECK (recommendation IN ('TAKE', 'TAKE_REDUCED', 'WAIT', 'REJECT')),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  risk_multiplier numeric NOT NULL CHECK (risk_multiplier >= 0 AND risk_multiplier <= 1),
  fallback_applied boolean NOT NULL DEFAULT false,
  fallback_reason text CHECK (
    fallback_reason IS NULL OR fallback_reason IN (
      'AI_CONTEXT_TIMEOUT',
      'AI_CONTEXT_MODEL_UNAVAILABLE',
      'AI_CONTEXT_INVALID_ADVISORY',
      'AI_CONTEXT_DISABLED',
      'AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED'
    )
  ),
  retry_allowed boolean NOT NULL DEFAULT false,
  retry_attempt integer NOT NULL DEFAULT 0 CHECK (retry_attempt >= 0),
  max_retry_attempts integer NOT NULL DEFAULT 0 CHECK (max_retry_attempts >= 0),
  policy_version text NOT NULL,
  model_policy_version text,
  model_ref text,
  advisory_hash text CHECK (advisory_hash IS NULL OR advisory_hash ~ '^sha256:[a-f0-9]{64}$'),
  execution_hash text NOT NULL CHECK (execution_hash ~ '^sha256:[a-f0-9]{64}$'),
  isolation_proof_hash text CHECK (isolation_proof_hash IS NULL OR isolation_proof_hash ~ '^sha256:[a-f0-9]{64}$'),
  reason_codes text[] NOT NULL DEFAULT '{}',
  anomalies text[] NOT NULL DEFAULT '{}',
  rationale text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at_utc timestamptz NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_context_gate_decisions_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ai_context_gate_decisions_no_direct_execution CHECK (
    COALESCE(jsonb_array_length(payload #> '{execution_side_effects,order_intents_created}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,target_positions_created}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,candidate_allocations_created}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,human_confirmations_created}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,provider_commands_created}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,post_risk_mutations}'), 0) = 0
    AND COALESCE(jsonb_array_length(payload #> '{execution_side_effects,broker_writes}'), 0) = 0
  )
);

CREATE INDEX IF NOT EXISTS ai_context_gate_decisions_subject_time_idx
  ON ai_context_gate_decisions(candidate_allocation_id, signal_id, position_id, decided_at_utc DESC);

CREATE INDEX IF NOT EXISTS ai_context_gate_decisions_status_time_idx
  ON ai_context_gate_decisions(status, fallback_applied, decided_at_utc DESC);

CREATE TABLE IF NOT EXISTS ai_context_gate_events (
  ai_context_gate_event_id text PRIMARY KEY,
  ai_context_gate_decision_id text NOT NULL REFERENCES ai_context_gate_decisions(ai_context_gate_decision_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'DECISION_RECORDED',
    'FALLBACK_APPLIED',
    'RETRY_PLANNED',
    'ENFORCEMENT_BLOCKED'
  )),
  occurred_at_utc timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_context_gate_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS ai_context_gate_events_decision_time_idx
  ON ai_context_gate_events(ai_context_gate_decision_id, occurred_at_utc DESC);
