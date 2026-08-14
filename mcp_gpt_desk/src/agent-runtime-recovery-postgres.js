import { randomUUID } from "node:crypto";
import {
  buildAgentEventV1,
  failAgentTaskV1,
} from "@tv-automation/desk-domain";
import {
  insertEvent,
  insertLease,
  mapTaskRow,
  repositoryError,
  selectTaskForUpdate,
  toIso,
  updateTask,
} from "./agent-runtime-postgres-common.js";

const FINAL_STATUSES = new Set(["DONE", "ERROR", "CANCELLED", "EXPIRED"]);

export async function failTaskWithRecovery(repository, {
  taskId,
  workerId,
  leaseToken,
  errorCode,
  errorMessage,
  retryable = false,
  retryPolicy = {},
  nowUtc = repository.clock.now().utc,
} = {}) {
  return repository.withTransaction(async (client) => {
    const row = await selectTaskForUpdate(client, taskId);
    const transition = failAgentTaskV1(mapTaskRow(row), {
      worker_id: workerId,
      lease_token: leaseToken,
      error_code: errorCode,
      error_message: errorMessage,
      retryable,
      retry_policy: retryPolicy,
      now_utc: nowUtc,
    });
    if (!transition.ok) throw repositoryError("AGENT_RUNTIME_FAIL_REJECTED", transition.reasons.join(","));
    await updateTask(client, transition.task);
    const leaseId = await insertLease(client, transition.lease, { agentId: row.agent_id });
    await insertEvent(client, transition.event, { leaseId, agentId: row.agent_id });
    const deadLetter = transition.task.status === "ERROR"
      ? await recordDeadLetter(client, transition.task, row.agent_id, nowUtc)
      : null;
    return { ...transition, dead_letter: deadLetter };
  });
}

export async function requeueDeadLetter(repository, {
  deadLetterId,
  operatorId = "operator",
  reason = "operator_requeue",
  idempotencyKey = null,
  nowUtc = repository.clock.now().utc,
} = {}) {
  return repository.withTransaction(async (client) => {
    const deadLetter = await selectDeadLetterForUpdate(client, deadLetterId);
    if (deadLetter.status !== "OPEN") return existingRecovery(client, deadLetter);
    const source = await selectTaskForUpdate(client, deadLetter.agent_task_id);
    const task = await insertRecoveryTask(client, source, deadLetter, { operatorId, reason, idempotencyKey, nowUtc });
    await resolveDeadLetter(client, deadLetterId, "REQUEUED", task.agent_task_id, idempotencyKey || operatorId, nowUtc);
    const event = buildAgentEventV1({
      event_type: "TASK_REQUEUED",
      task: mapTaskRow(task),
      actor: operatorId,
      now_utc: nowUtc,
      payload: {
        source_task_id: source.agent_task_id,
        dead_letter_id: deadLetterId,
        reason,
        idempotency_key: idempotencyKey,
      },
    });
    await insertEvent(client, event, { agentId: source.agent_id });
    return { ok: true, status: "REQUEUED", task: mapTaskRow(task), dead_letter: { ...deadLetter, status: "REQUEUED" }, event };
  });
}

export async function cancelAgentTask(repository, {
  taskId,
  operatorId = "operator",
  reason = "operator_cancel",
  idempotencyKey = null,
  nowUtc = repository.clock.now().utc,
} = {}) {
  return repository.withTransaction(async (client) => {
    const row = await selectTaskForUpdate(client, taskId);
    if (row.status === "CANCELLED") return { ok: true, status: "CANCELLED", task: mapTaskRow(row), event: null };
    if (FINAL_STATUSES.has(row.status)) throw repositoryError("AGENT_TASK_CANCEL_FINAL", `Cannot cancel final task ${taskId}`);
    const next = { ...mapTaskRow(row), status: "CANCELLED", lease_token: null, lease_expires_at_utc: null, not_before_utc: null, revision: row.revision + 1, updated_at_utc: nowUtc };
    await updateTask(client, next);
    const event = buildAgentEventV1({
      event_type: "TASK_CANCELLED",
      task: next,
      actor: operatorId,
      now_utc: nowUtc,
      payload: { previous_status: row.status, reason, idempotency_key: idempotencyKey },
    });
    await insertEvent(client, event, { agentId: row.agent_id });
    return { ok: true, status: "CANCELLED", task: next, event };
  });
}

async function recordDeadLetter(client, task, agentId, nowUtc) {
  const deadLetterId = randomUUID();
  const result = await client.query(
    `INSERT INTO agent_task_dead_letters (
       agent_task_dead_letter_id, agent_task_id, agent_mission_id, agent_id, status,
       error_code, error_message, retryable, attempt_count, task_snapshot, metadata, created_at_utc
     ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::timestamptz)
     ON CONFLICT (agent_task_id, error_code, attempt_count) DO UPDATE
       SET metadata = agent_task_dead_letters.metadata
     RETURNING *`,
    [
      deadLetterId,
      task.task_id,
      task.mission_id,
      agentId,
      task.last_error.error_code,
      task.last_error.error_message,
      task.last_error.retryable === true,
      task.attempt_count,
      JSON.stringify(task),
      JSON.stringify({ task_hash: task.task_hash }),
      nowUtc,
    ],
  );
  const deadLetter = result.rows[0];
  const event = buildAgentEventV1({
    event_type: "TASK_DEAD_LETTERED",
    task,
    actor: task.assigned_worker_id || "agent-runtime",
    now_utc: nowUtc,
    payload: {
      dead_letter_id: deadLetter.agent_task_dead_letter_id,
      error_code: deadLetter.error_code,
      attempt_count: deadLetter.attempt_count,
    },
  });
  await insertEvent(client, event, { agentId });
  return mapDeadLetter(deadLetter);
}

async function insertRecoveryTask(client, source, deadLetter, { operatorId, reason, idempotencyKey, nowUtc }) {
  const taskId = randomUUID();
  const payload = { ...source.payload, recovered_from_task_id: source.agent_task_id, dead_letter_id: deadLetter.agent_task_dead_letter_id };
  const metadata = {
    ...source.metadata,
    recovery_reason: reason,
    recovery_operator_id: operatorId,
    operator_action_idempotency_key: idempotencyKey,
    recovered_at_utc: nowUtc,
  };
  const result = await client.query(
    `INSERT INTO agent_tasks (
       agent_task_id, agent_mission_id, agent_conversation_id, task_key, task_type, lane,
       input_ref, status, priority, payload, idempotency_key, prompt_render_snapshot_id,
       depends_on_task_id, attempt_count, max_attempts, not_before_utc, correlation_id,
       metadata, created_at_utc, updated_at_utc
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'READY', $8, $9::jsonb, $10, $11, $12, 0, $13, $14::timestamptz, $15, $16::jsonb, $14::timestamptz, $14::timestamptz)
     ON CONFLICT (task_key) DO UPDATE
       SET updated_at_utc = agent_tasks.updated_at_utc
     RETURNING *`,
    [
      taskId,
      source.agent_mission_id,
      source.agent_conversation_id,
      `${source.task_key}.recovery.${deadLetter.agent_task_dead_letter_id}`,
      source.task_type,
      source.lane,
      source.input_ref,
      source.priority,
      JSON.stringify(payload),
      `recovery:${deadLetter.agent_task_dead_letter_id}`,
      source.prompt_render_snapshot_id,
      source.agent_task_id,
      source.max_attempts,
      nowUtc,
      source.correlation_id,
      JSON.stringify(metadata),
    ],
  );
  return result.rows[0];
}

async function existingRecovery(client, deadLetter) {
  const task = deadLetter.recovery_task_id ? await selectTaskForUpdate(client, deadLetter.recovery_task_id) : null;
  return { ok: true, status: deadLetter.status, task: task ? mapTaskRow(task) : null, dead_letter: mapDeadLetter(deadLetter), event: null };
}

async function selectDeadLetterForUpdate(client, deadLetterId) {
  const result = await client.query("SELECT * FROM agent_task_dead_letters WHERE agent_task_dead_letter_id = $1 FOR UPDATE", [deadLetterId]);
  if (!result.rows[0]) throw repositoryError("AGENT_DEAD_LETTER_NOT_FOUND", `Dead letter not found: ${deadLetterId}`);
  return result.rows[0];
}

async function resolveDeadLetter(client, deadLetterId, status, recoveryTaskId, operatorId, nowUtc) {
  await client.query(
    `UPDATE agent_task_dead_letters
        SET status = $2,
            recovery_task_id = $3,
            operator_action_ref = $4,
            resolved_at_utc = $5::timestamptz
      WHERE agent_task_dead_letter_id = $1`,
    [deadLetterId, status, recoveryTaskId, operatorId, nowUtc],
  );
}

function mapDeadLetter(row = {}) {
  return {
    dead_letter_id: row.agent_task_dead_letter_id,
    task_id: row.agent_task_id,
    mission_id: row.agent_mission_id,
    agent_id: row.agent_id,
    status: row.status,
    error_code: row.error_code,
    error_message: row.error_message,
    retryable: row.retryable,
    attempt_count: row.attempt_count,
    recovery_task_id: row.recovery_task_id,
    operator_action_ref: row.operator_action_ref,
    created_at_utc: toIso(row.created_at_utc),
    resolved_at_utc: toIso(row.resolved_at_utc),
    metadata: row.metadata || {},
  };
}
