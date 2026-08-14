DO $$
BEGIN
  CREATE TYPE agent_status AS ENUM ('IDLE', 'BUSY', 'OFFLINE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE agent_mission_status AS ENUM (
    'CREATED',
    'ASSIGNED',
    'IN_PROGRESS',
    'PAUSED',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE agent_conversation_status AS ENUM ('OPEN', 'ROTATING', 'ARCHIVED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE agent_task_status AS ENUM (
    'PENDING',
    'READY',
    'CLAIMED',
    'RUNNING',
    'WAITING_DEPENDENCY',
    'DONE',
    'ERROR',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE agent_lease_status AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'BROKEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE agent_event_type AS ENUM (
    'AGENT_REGISTERED',
    'MISSION_CREATED',
    'CONVERSATION_ATTACHED',
    'TASK_CREATED',
    'TASK_CLAIMED',
    'LEASE_EXTENDED',
    'TASK_COMPLETED',
    'TASK_FAILED',
    'TASK_EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agents (
  agent_id uuid PRIMARY KEY,
  agent_key text NOT NULL UNIQUE,
  agent_type text NOT NULL,
  status agent_status NOT NULL DEFAULT 'IDLE',
  worker_group text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_key_not_blank CHECK (length(trim(agent_key)) > 0),
  CONSTRAINT agents_type_not_blank CHECK (length(trim(agent_type)) > 0),
  CONSTRAINT agents_capabilities_array CHECK (jsonb_typeof(capabilities) = 'array'),
  CONSTRAINT agents_model_policy_object CHECK (jsonb_typeof(model_policy) = 'object'),
  CONSTRAINT agents_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS agents_type_status_idx
  ON agents (agent_type, status, worker_group);

CREATE TABLE IF NOT EXISTS agent_missions (
  agent_mission_id uuid PRIMARY KEY,
  mission_key text NOT NULL UNIQUE,
  agent_id uuid REFERENCES agents(agent_id) ON DELETE SET NULL,
  mission_type text NOT NULL,
  lane text NOT NULL,
  objective text NOT NULL,
  context_ref text,
  correlation_id text NOT NULL,
  status agent_mission_status NOT NULL DEFAULT 'CREATED',
  priority integer NOT NULL DEFAULT 100,
  prompt_composition_id uuid REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  model_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at_utc timestamptz,
  completed_at_utc timestamptz,
  failed_at_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_missions_key_not_blank CHECK (length(trim(mission_key)) > 0),
  CONSTRAINT agent_missions_type_not_blank CHECK (length(trim(mission_type)) > 0),
  CONSTRAINT agent_missions_lane_not_blank CHECK (length(trim(lane)) > 0),
  CONSTRAINT agent_missions_objective_not_blank CHECK (length(trim(objective)) > 0),
  CONSTRAINT agent_missions_correlation_not_blank CHECK (length(trim(correlation_id)) > 0),
  CONSTRAINT agent_missions_priority_positive CHECK (priority >= 0),
  CONSTRAINT agent_missions_model_policy_object CHECK (jsonb_typeof(model_policy) = 'object'),
  CONSTRAINT agent_missions_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT agent_missions_assigned_has_agent CHECK (status = 'CREATED' OR agent_id IS NOT NULL),
  CONSTRAINT agent_missions_completed_has_time CHECK (status <> 'COMPLETED' OR completed_at_utc IS NOT NULL),
  CONSTRAINT agent_missions_failed_has_time CHECK (status <> 'FAILED' OR failed_at_utc IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_missions_status_lane_idx
  ON agent_missions (status, lane, priority, created_at_utc);

CREATE INDEX IF NOT EXISTS agent_missions_agent_idx
  ON agent_missions (agent_id, status, updated_at_utc DESC);

CREATE TABLE IF NOT EXISTS agent_conversations (
  agent_conversation_id uuid PRIMARY KEY,
  agent_mission_id uuid NOT NULL REFERENCES agent_missions(agent_mission_id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_conversation_ref text,
  status agent_conversation_status NOT NULL DEFAULT 'OPEN',
  affinity_key text,
  turn_count integer NOT NULL DEFAULT 0,
  last_used_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_conversations_provider_not_blank CHECK (length(trim(provider)) > 0),
  CONSTRAINT agent_conversations_turn_count_positive CHECK (turn_count >= 0),
  CONSTRAINT agent_conversations_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_external_ref_idx
  ON agent_conversations (provider, external_conversation_ref)
  WHERE external_conversation_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_conversations_mission_status_idx
  ON agent_conversations (agent_mission_id, status, last_used_at_utc DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS agent_conversations_affinity_idx
  ON agent_conversations (affinity_key, status, last_used_at_utc DESC NULLS LAST)
  WHERE affinity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_tasks (
  agent_task_id uuid PRIMARY KEY,
  agent_mission_id uuid NOT NULL REFERENCES agent_missions(agent_mission_id) ON DELETE CASCADE,
  agent_conversation_id uuid REFERENCES agent_conversations(agent_conversation_id) ON DELETE SET NULL,
  task_key text NOT NULL UNIQUE,
  task_type text NOT NULL,
  lane text NOT NULL,
  input_ref text,
  output_ref text,
  status agent_task_status NOT NULL DEFAULT 'PENDING',
  priority integer NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  prompt_render_snapshot_id uuid REFERENCES prompt_render_snapshots(prompt_render_snapshot_id) ON DELETE SET NULL,
  depends_on_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  assigned_worker_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 1,
  not_before_utc timestamptz,
  lease_token text,
  lease_expires_at_utc timestamptz,
  claimed_at_utc timestamptz,
  completed_at_utc timestamptz,
  failed_at_utc timestamptz,
  last_error jsonb,
  correlation_id text,
  revision integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tasks_key_not_blank CHECK (length(trim(task_key)) > 0),
  CONSTRAINT agent_tasks_type_not_blank CHECK (length(trim(task_type)) > 0),
  CONSTRAINT agent_tasks_lane_not_blank CHECK (length(trim(lane)) > 0),
  CONSTRAINT agent_tasks_priority_positive CHECK (priority >= 0),
  CONSTRAINT agent_tasks_attempt_count_positive CHECK (attempt_count >= 0),
  CONSTRAINT agent_tasks_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT agent_tasks_revision_positive CHECK (revision >= 0),
  CONSTRAINT agent_tasks_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT agent_tasks_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT agent_tasks_input_or_payload CHECK (input_ref IS NOT NULL OR payload <> '{}'::jsonb),
  CONSTRAINT agent_tasks_leased_has_handle CHECK (
    status NOT IN ('CLAIMED', 'RUNNING')
    OR (assigned_worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at_utc IS NOT NULL)
  ),
  CONSTRAINT agent_tasks_done_has_time CHECK (status <> 'DONE' OR completed_at_utc IS NOT NULL),
  CONSTRAINT agent_tasks_error_has_error CHECK (status <> 'ERROR' OR last_error IS NOT NULL),
  CONSTRAINT agent_tasks_lease_range CHECK (
    lease_expires_at_utc IS NULL
    OR claimed_at_utc IS NULL
    OR lease_expires_at_utc > claimed_at_utc
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_idempotency_idx
  ON agent_tasks (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_tasks_claim_idx
  ON agent_tasks (lane, status, priority, not_before_utc, created_at_utc)
  WHERE status IN ('PENDING', 'READY');

CREATE INDEX IF NOT EXISTS agent_tasks_mission_status_idx
  ON agent_tasks (agent_mission_id, status, created_at_utc);

CREATE INDEX IF NOT EXISTS agent_tasks_lease_expiry_idx
  ON agent_tasks (lease_expires_at_utc)
  WHERE status IN ('CLAIMED', 'RUNNING') AND lease_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_task_leases (
  agent_task_lease_id uuid PRIMARY KEY,
  agent_task_id uuid NOT NULL REFERENCES agent_tasks(agent_task_id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(agent_id) ON DELETE SET NULL,
  worker_id text NOT NULL,
  lease_token text NOT NULL,
  status agent_lease_status NOT NULL DEFAULT 'ACTIVE',
  acquired_at_utc timestamptz NOT NULL DEFAULT now(),
  expires_at_utc timestamptz NOT NULL,
  released_at_utc timestamptz,
  heartbeat_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_task_leases_worker_not_blank CHECK (length(trim(worker_id)) > 0),
  CONSTRAINT agent_task_leases_token_not_blank CHECK (length(trim(lease_token)) > 0),
  CONSTRAINT agent_task_leases_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT agent_task_leases_expiry_after_acquire CHECK (expires_at_utc > acquired_at_utc),
  CONSTRAINT agent_task_leases_release_after_acquire CHECK (
    released_at_utc IS NULL
    OR released_at_utc >= acquired_at_utc
  ),
  UNIQUE (agent_task_id, lease_token)
);

CREATE INDEX IF NOT EXISTS agent_task_leases_active_expiry_idx
  ON agent_task_leases (expires_at_utc, worker_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS agent_task_leases_task_idx
  ON agent_task_leases (agent_task_id, acquired_at_utc DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  agent_event_id uuid PRIMARY KEY,
  event_type agent_event_type NOT NULL,
  agent_id uuid REFERENCES agents(agent_id) ON DELETE SET NULL,
  agent_mission_id uuid REFERENCES agent_missions(agent_mission_id) ON DELETE SET NULL,
  agent_conversation_id uuid REFERENCES agent_conversations(agent_conversation_id) ON DELETE SET NULL,
  agent_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  agent_task_lease_id uuid REFERENCES agent_task_leases(agent_task_lease_id) ON DELETE SET NULL,
  correlation_id text,
  causation_id text,
  actor text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_hash text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_events_actor_not_blank CHECK (length(trim(actor)) > 0),
  CONSTRAINT agent_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT agent_events_hash_format CHECK (event_hash ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS agent_events_mission_timeline_idx
  ON agent_events (agent_mission_id, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS agent_events_task_timeline_idx
  ON agent_events (agent_task_id, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS agent_events_correlation_idx
  ON agent_events (correlation_id, created_at_utc DESC)
  WHERE correlation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_agent_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AGENT_EVENT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_events_append_only_trg ON agent_events;
CREATE TRIGGER agent_events_append_only_trg
  BEFORE UPDATE ON agent_events
  FOR EACH ROW EXECUTE FUNCTION prevent_agent_event_mutation();
