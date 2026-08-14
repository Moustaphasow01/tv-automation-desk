CREATE TABLE IF NOT EXISTS agent_task_run_metrics (
  agent_task_run_metric_id uuid PRIMARY KEY,
  agent_task_id uuid NOT NULL REFERENCES agent_tasks(agent_task_id) ON DELETE CASCADE,
  agent_mission_id uuid NOT NULL REFERENCES agent_missions(agent_mission_id) ON DELETE CASCADE,
  agent_conversation_id uuid REFERENCES agent_conversations(agent_conversation_id) ON DELETE SET NULL,
  agent_execution_policy_snapshot_id uuid REFERENCES agent_execution_policy_snapshots(agent_execution_policy_snapshot_id) ON DELETE SET NULL,
  agent_task_dead_letter_id uuid REFERENCES agent_task_dead_letters(agent_task_dead_letter_id) ON DELETE SET NULL,
  worker_id text NOT NULL,
  lane text NOT NULL,
  task_type text NOT NULL,
  model text,
  reasoning_effort text,
  outcome text NOT NULL,
  queue_latency_ms integer,
  run_duration_ms integer,
  total_latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_micros_usd bigint,
  output_ref text,
  error_code text,
  metric jsonb NOT NULL,
  metric_hash text NOT NULL,
  started_at_utc timestamptz,
  finished_at_utc timestamptz NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_task_run_metrics_worker_not_blank CHECK (length(trim(worker_id)) > 0),
  CONSTRAINT agent_task_run_metrics_lane_not_blank CHECK (length(trim(lane)) > 0),
  CONSTRAINT agent_task_run_metrics_type_not_blank CHECK (length(trim(task_type)) > 0),
  CONSTRAINT agent_task_run_metrics_outcome_not_blank CHECK (length(trim(outcome)) > 0),
  CONSTRAINT agent_task_run_metrics_non_negative_latency CHECK (
    coalesce(queue_latency_ms, 0) >= 0
    AND coalesce(run_duration_ms, 0) >= 0
    AND coalesce(total_latency_ms, 0) >= 0
  ),
  CONSTRAINT agent_task_run_metrics_non_negative_tokens CHECK (
    coalesce(input_tokens, 0) >= 0
    AND coalesce(output_tokens, 0) >= 0
    AND coalesce(total_tokens, 0) >= 0
    AND coalesce(cost_micros_usd, 0) >= 0
  ),
  CONSTRAINT agent_task_run_metrics_metric_object CHECK (jsonb_typeof(metric) = 'object'),
  CONSTRAINT agent_task_run_metrics_hash_format CHECK (metric_hash ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (agent_task_id)
);

CREATE INDEX IF NOT EXISTS agent_task_run_metrics_mission_idx
  ON agent_task_run_metrics (agent_mission_id, finished_at_utc DESC);

CREATE INDEX IF NOT EXISTS agent_task_run_metrics_lane_outcome_idx
  ON agent_task_run_metrics (lane, outcome, finished_at_utc DESC);
