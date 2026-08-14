DO $$
BEGIN
  CREATE TYPE agent_dead_letter_status AS ENUM ('OPEN', 'REQUEUED', 'CANCELLED', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_DEAD_LETTERED';
ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_REQUEUED';
ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_CANCELLED';

CREATE TABLE IF NOT EXISTS agent_task_dead_letters (
  agent_task_dead_letter_id uuid PRIMARY KEY,
  agent_task_id uuid NOT NULL REFERENCES agent_tasks(agent_task_id) ON DELETE CASCADE,
  agent_mission_id uuid NOT NULL REFERENCES agent_missions(agent_mission_id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(agent_id) ON DELETE SET NULL,
  status agent_dead_letter_status NOT NULL DEFAULT 'OPEN',
  error_code text NOT NULL,
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL,
  task_snapshot jsonb NOT NULL,
  recovery_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  operator_action_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  resolved_at_utc timestamptz,
  CONSTRAINT agent_task_dead_letters_error_code_not_blank CHECK (length(trim(error_code)) > 0),
  CONSTRAINT agent_task_dead_letters_attempt_count_positive CHECK (attempt_count >= 0),
  CONSTRAINT agent_task_dead_letters_snapshot_object CHECK (jsonb_typeof(task_snapshot) = 'object'),
  CONSTRAINT agent_task_dead_letters_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT agent_task_dead_letters_resolved_has_time CHECK (status = 'OPEN' OR resolved_at_utc IS NOT NULL),
  UNIQUE (agent_task_id, error_code, attempt_count)
);

CREATE INDEX IF NOT EXISTS agent_task_dead_letters_open_idx
  ON agent_task_dead_letters (status, created_at_utc DESC)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS agent_task_dead_letters_mission_idx
  ON agent_task_dead_letters (agent_mission_id, status, created_at_utc DESC);
