CREATE TABLE IF NOT EXISTS assistant_profiles (
  assistant_profile_id text PRIMARY KEY,
  assistant_type text NOT NULL CHECK (assistant_type IN ('RESEARCH', 'LIVE_RUNTIME', 'PORTFOLIO_RISK', 'EXECUTION', 'DATA', 'PLATFORM_OPS', 'JARVIS')),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  model_policy_version text NOT NULL,
  model_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  wake_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_builder text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_profiles_name_not_blank CHECK (length(trim(display_name)) > 0),
  CONSTRAINT assistant_profiles_policy_object CHECK (jsonb_typeof(model_policy) = 'object'),
  CONSTRAINT assistant_profiles_wake_object CHECK (jsonb_typeof(wake_policy) = 'object'),
  CONSTRAINT assistant_profiles_allowed_tools_array CHECK (jsonb_typeof(allowed_tools) = 'array'),
  CONSTRAINT assistant_profiles_permissions_object CHECK (jsonb_typeof(permissions) = 'object'),
  CONSTRAINT assistant_profiles_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT assistant_profiles_read_only_default CHECK (
    COALESCE(permissions->>'mode', 'READ_ONLY') = 'READ_ONLY'
    AND COALESCE((permissions->>'can_confirm_human_gate')::boolean, false) = false
    AND COALESCE((permissions->>'can_create_provider_command')::boolean, false) = false
    AND COALESCE((permissions->>'can_activate_live')::boolean, false) = false
    AND COALESCE((permissions->>'can_activate_auto_execution')::boolean, false) = false
  )
);

CREATE INDEX IF NOT EXISTS assistant_profiles_type_enabled_idx
  ON assistant_profiles (assistant_type, enabled, updated_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_conversations (
  assistant_conversation_id text PRIMARY KEY,
  assistant_profile_id text NOT NULL REFERENCES assistant_profiles(assistant_profile_id) ON DELETE RESTRICT,
  operator_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'ARCHIVED', 'FAILED')) DEFAULT 'OPEN',
  conversation_summary text NOT NULL DEFAULT '',
  last_message_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_conversations_operator_not_blank CHECK (length(trim(operator_id)) > 0),
  CONSTRAINT assistant_conversations_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_conversations_profile_time_idx
  ON assistant_conversations (assistant_profile_id, status, last_message_at_utc DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS assistant_messages (
  assistant_message_id text PRIMARY KEY,
  assistant_conversation_id text NOT NULL REFERENCES assistant_conversations(assistant_conversation_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('operator', 'assistant', 'system')),
  content text NOT NULL,
  citation_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_hash text NOT NULL CHECK (message_hash ~ '^sha256:[a-f0-9]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL,
  CONSTRAINT assistant_messages_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT assistant_messages_citations_array CHECK (jsonb_typeof(citation_refs) = 'array'),
  CONSTRAINT assistant_messages_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_time_idx
  ON assistant_messages (assistant_conversation_id, created_at_utc, assistant_message_id);

CREATE TABLE IF NOT EXISTS assistant_context_snapshots (
  assistant_context_snapshot_id text PRIMARY KEY,
  assistant_profile_id text NOT NULL REFERENCES assistant_profiles(assistant_profile_id) ON DELETE RESTRICT,
  assistant_conversation_id text REFERENCES assistant_conversations(assistant_conversation_id) ON DELETE SET NULL,
  context_builder text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  bounded_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  max_messages integer NOT NULL DEFAULT 8 CHECK (max_messages >= 0 AND max_messages <= 20),
  max_events integer NOT NULL DEFAULT 20 CHECK (max_events >= 0 AND max_events <= 100),
  created_at_utc timestamptz NOT NULL,
  CONSTRAINT assistant_context_source_refs_array CHECK (jsonb_typeof(source_refs) = 'array'),
  CONSTRAINT assistant_context_bounded_context_object CHECK (jsonb_typeof(bounded_context) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_context_profile_time_idx
  ON assistant_context_snapshots (assistant_profile_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_tasks (
  assistant_task_id text PRIMARY KEY,
  assistant_profile_id text NOT NULL REFERENCES assistant_profiles(assistant_profile_id) ON DELETE RESTRICT,
  assistant_conversation_id text NOT NULL REFERENCES assistant_conversations(assistant_conversation_id) ON DELETE CASCADE,
  triggering_message_id text REFERENCES assistant_messages(assistant_message_id) ON DELETE SET NULL,
  input_snapshot_id text NOT NULL REFERENCES assistant_context_snapshots(assistant_context_snapshot_id) ON DELETE RESTRICT,
  answer_message_id text REFERENCES assistant_messages(assistant_message_id) ON DELETE SET NULL,
  task_type text NOT NULL CHECK (task_type IN ('QUESTION', 'PERIODIC_SNAPSHOT', 'EVENT_SUMMARY')),
  wake_type text NOT NULL CHECK (wake_type IN ('ON_DEMAND', 'PERIODIC', 'EVENT_TRIGGERED')),
  status text NOT NULL CHECK (status IN ('QUEUED', 'CLAIMED', 'RUNNING', 'DONE', 'FAILED', 'DLQ', 'CANCELLED')) DEFAULT 'QUEUED',
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  idempotency_key text NOT NULL UNIQUE,
  model_policy_version text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_worker_id text,
  lease_token text,
  lease_expires_at_utc timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  not_before_utc timestamptz,
  last_error jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  CONSTRAINT assistant_tasks_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT assistant_tasks_last_error_object CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
  CONSTRAINT assistant_tasks_metrics_object CHECK (jsonb_typeof(metrics) = 'object'),
  CONSTRAINT assistant_tasks_leased_has_handle CHECK (
    status NOT IN ('CLAIMED', 'RUNNING')
    OR (assigned_worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at_utc IS NOT NULL)
  ),
  CONSTRAINT assistant_tasks_no_sensitive_bypass CHECK (
    COALESCE((payload #>> '{requested_action,activate_live}')::boolean, false) = false
    AND COALESCE((payload #>> '{requested_action,activate_auto_execution}')::boolean, false) = false
    AND COALESCE((payload #>> '{requested_action,confirm_human_gate}')::boolean, false) = false
    AND COALESCE((payload #>> '{requested_action,create_provider_command}')::boolean, false) = false
  )
);

CREATE INDEX IF NOT EXISTS assistant_tasks_claim_idx
  ON assistant_tasks (assistant_profile_id, status, priority, not_before_utc, created_at_utc)
  WHERE status IN ('QUEUED', 'FAILED');

CREATE INDEX IF NOT EXISTS assistant_tasks_conversation_time_idx
  ON assistant_tasks (assistant_conversation_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_task_leases (
  assistant_task_lease_id text PRIMARY KEY,
  assistant_task_id text NOT NULL REFERENCES assistant_tasks(assistant_task_id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  lease_token text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'EXPIRED', 'BROKEN')),
  acquired_at_utc timestamptz NOT NULL,
  expires_at_utc timestamptz NOT NULL,
  released_at_utc timestamptz,
  UNIQUE (assistant_task_id, lease_token)
);

CREATE INDEX IF NOT EXISTS assistant_task_leases_active_idx
  ON assistant_task_leases (status, expires_at_utc)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS assistant_answers (
  assistant_answer_id text PRIMARY KEY,
  assistant_task_id text NOT NULL REFERENCES assistant_tasks(assistant_task_id) ON DELETE CASCADE,
  assistant_message_id text NOT NULL REFERENCES assistant_messages(assistant_message_id) ON DELETE CASCADE,
  model_policy_version text NOT NULL,
  answer_hash text NOT NULL CHECK (answer_hash ~ '^sha256:[a-f0-9]{64}$'),
  citation_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_input integer NOT NULL DEFAULT 0 CHECK (token_input >= 0),
  token_output integer NOT NULL DEFAULT 0 CHECK (token_output >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  created_at_utc timestamptz NOT NULL,
  CONSTRAINT assistant_answers_citations_array CHECK (jsonb_typeof(citation_refs) = 'array')
);

CREATE INDEX IF NOT EXISTS assistant_answers_task_time_idx
  ON assistant_answers (assistant_task_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_task_dead_letters (
  assistant_task_dead_letter_id text PRIMARY KEY,
  assistant_task_id text NOT NULL REFERENCES assistant_tasks(assistant_task_id) ON DELETE CASCADE,
  assistant_profile_id text NOT NULL REFERENCES assistant_profiles(assistant_profile_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('OPEN', 'REQUEUED', 'CLOSED')) DEFAULT 'OPEN',
  error_code text NOT NULL,
  error_message text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  CONSTRAINT assistant_dlq_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_task_dead_letters_status_idx
  ON assistant_task_dead_letters (status, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_events (
  assistant_event_id text PRIMARY KEY,
  assistant_profile_id text REFERENCES assistant_profiles(assistant_profile_id) ON DELETE SET NULL,
  assistant_conversation_id text REFERENCES assistant_conversations(assistant_conversation_id) ON DELETE SET NULL,
  assistant_task_id text REFERENCES assistant_tasks(assistant_task_id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'QUESTION_SUBMITTED',
    'TASK_READY',
    'TASK_CLAIMED',
    'ANSWER_PERSISTED',
    'TASK_FAILED',
    'TASK_REQUEUED',
    'DLQ_CREATED',
    'SNAPSHOT_REFRESHED',
    'EVENT_TRIGGERED',
    'READ_ONLY_REJECTED'
  )),
  occurred_at_utc timestamptz NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_events_profile_time_idx
  ON assistant_events (assistant_profile_id, occurred_at_utc DESC);

CREATE TABLE IF NOT EXISTS assistant_outbox (
  assistant_outbox_id text PRIMARY KEY,
  assistant_event_id text NOT NULL REFERENCES assistant_events(assistant_event_id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('ASSISTANT_RUNTIME', 'FRONT_REALTIME', 'JARVIS_FEDERATION')),
  status text NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')) DEFAULT 'PENDING',
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL,
  published_at_utc timestamptz,
  CONSTRAINT assistant_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_outbox_status_time_idx
  ON assistant_outbox (status, created_at_utc);
