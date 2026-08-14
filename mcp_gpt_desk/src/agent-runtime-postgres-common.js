import { randomUUID } from "node:crypto";
import { buildAgentEventV1 } from "@tv-automation/desk-domain";

export function mapTaskRow(row = {}) {
  return {
    task_id: row.agent_task_id,
    mission_id: row.agent_mission_id,
    conversation_id: row.agent_conversation_id,
    task_key: row.task_key,
    task_type: row.task_type,
    lane: row.lane,
    input_ref: row.input_ref,
    output_ref: row.output_ref,
    status: row.status,
    priority: row.priority,
    payload: row.payload || {},
    idempotency_key: row.idempotency_key,
    prompt_render_snapshot_id: row.prompt_render_snapshot_id,
    depends_on_task_id: row.depends_on_task_id,
    assigned_worker_id: row.assigned_worker_id,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    not_before_utc: toIso(row.not_before_utc),
    lease_token: row.lease_token,
    lease_expires_at_utc: toIso(row.lease_expires_at_utc),
    claimed_at_utc: toIso(row.claimed_at_utc),
    completed_at_utc: toIso(row.completed_at_utc),
    failed_at_utc: toIso(row.failed_at_utc),
    last_error: row.last_error,
    correlation_id: row.correlation_id,
    revision: row.revision,
    metadata: row.metadata || {},
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  };
}

export async function selectTaskForUpdate(client, taskId) {
  const result = await client.query(
    `SELECT t.*, m.agent_id
       FROM agent_tasks t
       JOIN agent_missions m ON m.agent_mission_id = t.agent_mission_id
      WHERE t.agent_task_id = $1
      FOR UPDATE`,
    [taskId],
  );
  if (!result.rows[0]) throw repositoryError("AGENT_RUNTIME_TASK_NOT_FOUND", `Task not found: ${taskId}`);
  return result.rows[0];
}

export async function updateTask(client, task) {
  await client.query(
    `UPDATE agent_tasks
        SET status = $2, output_ref = $3, assigned_worker_id = $4, attempt_count = $5,
            not_before_utc = $6::timestamptz, lease_token = $7, lease_expires_at_utc = $8::timestamptz,
            claimed_at_utc = $9::timestamptz, completed_at_utc = $10::timestamptz, failed_at_utc = $11::timestamptz,
            last_error = $12::jsonb, revision = $13, updated_at_utc = $14::timestamptz
      WHERE agent_task_id = $1`,
    [
      task.task_id, task.status, task.output_ref, task.assigned_worker_id, task.attempt_count,
      task.not_before_utc, task.lease_token, task.lease_expires_at_utc, task.claimed_at_utc,
      task.completed_at_utc, task.failed_at_utc, JSON.stringify(task.last_error), task.revision, task.updated_at_utc,
    ],
  );
}

export async function insertLease(client, lease, { agentId = null } = {}) {
  const leaseId = randomUUID();
  const result = await client.query(
    `INSERT INTO agent_task_leases (
       agent_task_lease_id, agent_task_id, agent_id, worker_id, lease_token, status,
       acquired_at_utc, expires_at_utc, released_at_utc, heartbeat_at_utc, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::jsonb)
     ON CONFLICT (agent_task_id, lease_token) DO UPDATE
       SET status = EXCLUDED.status,
           expires_at_utc = EXCLUDED.expires_at_utc,
           released_at_utc = EXCLUDED.released_at_utc,
           heartbeat_at_utc = EXCLUDED.heartbeat_at_utc,
           metadata = EXCLUDED.metadata
     RETURNING agent_task_lease_id`,
    [leaseId, lease.task_id, agentId, lease.worker_id, lease.lease_token, lease.status, lease.acquired_at_utc, lease.expires_at_utc, lease.released_at_utc, lease.heartbeat_at_utc, JSON.stringify(lease.metadata || {})],
  );
  return result.rows[0]?.agent_task_lease_id || leaseId;
}

export async function insertEvent(client, event, { leaseId = null, agentId = null } = {}) {
  await client.query(
    `INSERT INTO agent_events (
       agent_event_id, event_type, agent_id, agent_mission_id, agent_conversation_id,
       agent_task_id, agent_task_lease_id, correlation_id, causation_id, actor,
       payload, event_hash, created_at_utc
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::timestamptz)`,
    [randomUUID(), event.event_type, agentId, event.mission_id, event.conversation_id, event.task_id, leaseId, event.correlation_id, event.causation_id, event.actor, JSON.stringify(event.payload || {}), event.event_hash || buildAgentEventV1(event).event_hash, event.created_at_utc],
  );
}

export function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toISOString === "function") return value.toISOString();
  return String(value);
}

export function repositoryError(code, message) {
  return Object.assign(new Error(message || code), { code, retryable: false });
}
