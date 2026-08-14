ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'EXECUTION_POLICY_RESOLVED';

CREATE TABLE IF NOT EXISTS agent_execution_policy_snapshots (
  agent_execution_policy_snapshot_id uuid PRIMARY KEY,
  agent_task_id uuid NOT NULL REFERENCES agent_tasks(agent_task_id) ON DELETE CASCADE,
  agent_mission_id uuid NOT NULL REFERENCES agent_missions(agent_mission_id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(agent_id) ON DELETE SET NULL,
  policy_schema_version text NOT NULL,
  policy_version text NOT NULL,
  policy jsonb NOT NULL,
  policy_hash text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_execution_policy_snapshots_policy_object CHECK (jsonb_typeof(policy) = 'object'),
  CONSTRAINT agent_execution_policy_snapshots_hash_format CHECK (policy_hash ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (agent_task_id, policy_hash)
);

CREATE INDEX IF NOT EXISTS agent_execution_policy_snapshots_task_idx
  ON agent_execution_policy_snapshots (agent_task_id, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS agent_execution_policy_snapshots_mission_idx
  ON agent_execution_policy_snapshots (agent_mission_id, created_at_utc DESC);
