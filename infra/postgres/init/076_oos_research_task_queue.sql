-- Owner: research. Durable technical leases, isolated from historical OOS commands.
BEGIN;
CREATE TABLE IF NOT EXISTS research_state.t3_tasks (
  task_id text PRIMARY KEY CHECK(task_id ~ '^[a-f0-9]{64}$'),
  cycle_id text NOT NULL UNIQUE REFERENCES research_state.t3_cycles(cycle_id),
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','RUNNING','COMPLETED','BLOCKED','FAILED')),
  worker_id text, lease_token text, lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  maximum_attempts integer NOT NULL DEFAULT 5 CHECK(maximum_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error text, heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((status='RUNNING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS t3_tasks_ready_idx ON research_state.t3_tasks(status,available_at,priority DESC,created_at);
CREATE TABLE IF NOT EXISTS research_state.t3_workers (
  worker_id text PRIMARY KEY, state text NOT NULL CHECK(state IN('IDLE','WORKING','STOPPED')),
  task_id text REFERENCES research_state.t3_tasks(task_id), heartbeat_at timestamptz NOT NULL,
  capabilities jsonb NOT NULL CHECK(jsonb_typeof(capabilities)='object')
);
CREATE TABLE IF NOT EXISTS research_state.t3_incidents (
  incident_id text PRIMARY KEY, task_id text NOT NULL REFERENCES research_state.t3_tasks(task_id),
  severity text NOT NULL CHECK(severity IN('SIGNIFICANT','CRITICAL')),
  code text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS t3_incidents_task_time_idx ON research_state.t3_incidents(task_id,created_at);
COMMIT;
