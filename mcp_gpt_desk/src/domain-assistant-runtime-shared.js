import { canonicalSha256 } from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";

const ASSISTANT_REPOSITORY_CLOCK = new SystemClock();

export function normalizeProfile(input = {}) {
  return {
    assistant_profile_id: text(input.assistant_profile_id || input.assistantId),
    assistant_type: upper(input.assistant_type || input.type),
    display_name: text(input.display_name || input.name),
    enabled: input.enabled !== false,
    model_policy_version: text(input.model_policy_version || input.modelPolicyVersion || "domain-assistant.default.v1"),
    model_policy: object(input.model_policy || input.modelPolicy || { model: "low-cost", reasoning_effort: "low" }),
    wake_policy: object(input.wake_policy || input.wakePolicy || { on_demand: true, periodic_minutes: 60, event_triggered: true }),
    allowed_tools: array(input.allowed_tools || input.allowedTools),
    permissions: object(input.permissions || { mode: "READ_ONLY" }),
    context_builder: text(input.context_builder || input.contextBuilder || `${text(input.assistant_profile_id || input.assistantId)}.snapshot.v1`),
    metadata: object(input.metadata),
  };
}

export function normalizeConversation(input = {}) {
  return {
    assistant_conversation_id: text(input.assistant_conversation_id || input.conversationId),
    assistant_profile_id: text(input.assistant_profile_id || input.assistantId),
    operator_id: text(input.operator_id || input.operatorId || "operator"),
    status: upper(input.status || "OPEN"),
    conversation_summary: text(input.conversation_summary || input.summary),
    last_message_at_utc: text(input.last_message_at_utc || input.lastMessageAtUtc) || null,
    metadata: object(input.metadata),
  };
}

export function normalizeMessage(input = {}) {
  const content = text(input.content);
  const createdAt = text(input.created_at_utc || input.createdAtUtc) || nowIso();
  return {
    assistant_message_id: text(input.assistant_message_id || input.message_id || input.messageId),
    assistant_conversation_id: text(input.assistant_conversation_id || input.conversation_id || input.conversationId),
    role: text(input.role || "operator"),
    content,
    citation_refs: array(input.citation_refs || input.citationRefs),
    message_hash: hash({ role: input.role, content, created_at_utc: createdAt }),
    metadata: object(input.metadata),
    created_at_utc: createdAt,
  };
}

export function normalizeSnapshot(input = {}) {
  const boundedContext = object(input.bounded_context || input.boundedContext);
  return {
    assistant_context_snapshot_id: text(input.assistant_context_snapshot_id || input.snapshotId),
    assistant_profile_id: text(input.assistant_profile_id || input.assistantId),
    assistant_conversation_id: text(input.assistant_conversation_id || input.conversationId) || null,
    context_builder: text(input.context_builder || input.contextBuilder),
    source_refs: array(input.source_refs || input.sourceRefs),
    bounded_context: boundedContext,
    snapshot_hash: hash({ context_builder: input.context_builder || input.contextBuilder, bounded_context: boundedContext }),
    max_messages: integer(input.max_messages ?? input.maxMessages, 8),
    max_events: integer(input.max_events ?? input.maxEvents, 20),
    created_at_utc: text(input.created_at_utc || input.createdAtUtc) || nowIso(),
  };
}

export function normalizeTask(input = {}) {
  const now = firstText(input, ["created_at_utc", "createdAtUtc"], nowIso());
  return {
    assistant_task_id: firstText(input, ["assistant_task_id", "taskId"]),
    assistant_profile_id: firstText(input, ["assistant_profile_id", "assistantId"]),
    assistant_conversation_id: firstText(input, ["assistant_conversation_id", "conversationId"]),
    triggering_message_id: firstText(input, ["triggering_message_id", "triggeringMessageId"], null),
    input_snapshot_id: firstText(input, ["input_snapshot_id", "inputSnapshotId"]),
    answer_message_id: firstText(input, ["answer_message_id", "answerMessageId"], null),
    task_type: upper(firstValue(input, ["task_type", "taskType"], "QUESTION")),
    wake_type: upper(firstValue(input, ["wake_type", "wakeType"], "ON_DEMAND")),
    status: upper(firstValue(input, ["status"], "QUEUED")),
    priority: integer(input.priority, 100),
    idempotency_key: firstText(input, ["idempotency_key", "idempotencyKey"]),
    model_policy_version: firstText(input, ["model_policy_version", "modelPolicyVersion"]),
    payload: object(input.payload),
    assigned_worker_id: firstText(input, ["assigned_worker_id", "assignedWorkerId"], null),
    lease_token: firstText(input, ["lease_token", "leaseToken"], null),
    lease_expires_at_utc: firstText(input, ["lease_expires_at_utc", "leaseExpiresAtUtc"], null),
    attempt_count: integer(firstValue(input, ["attempt_count", "attemptCount"], 0), 0),
    max_attempts: integer(firstValue(input, ["max_attempts", "maxAttempts"], 3), 3),
    not_before_utc: firstText(input, ["not_before_utc", "notBeforeUtc"], null),
    last_error: firstValue(input, ["last_error", "lastError"], null),
    metrics: object(input.metrics),
    correlation_id: firstText(input, ["correlation_id", "correlationId"], id("corr_assistant", input)),
    created_at_utc: now,
    updated_at_utc: firstText(input, ["updated_at_utc", "updatedAtUtc"], now),
  };
}

export function normalizeAnswer(input = {}) {
  const metrics = object(input.metrics);
  return {
    assistant_answer_id: firstText(input, ["assistant_answer_id", "answerId"], id("asst_answer", { task: input.assistant_task_id, message: input.assistant_message_id })),
    assistant_task_id: firstText(input, ["assistant_task_id", "taskId"]),
    assistant_message_id: firstText(input, ["assistant_message_id", "messageId"]),
    model_policy_version: firstText(input, ["model_policy_version", "modelPolicyVersion"]),
    answer_hash: hash({ content: input.content, citation_refs: firstValue(input, ["citation_refs", "citationRefs"], []) }),
    citation_refs: array(firstValue(input, ["citation_refs", "citationRefs"], [])),
    token_input: integer(firstValue(metrics, ["token_input", "input_tokens", "inputTokens"], 0), 0),
    token_output: integer(firstValue(metrics, ["token_output", "output_tokens", "outputTokens"], 0), 0),
    latency_ms: integer(firstValue(metrics, ["latency_ms", "latencyMs"], 0), 0),
    metrics,
    created_at_utc: firstText(input, ["created_at_utc", "createdAtUtc"], nowIso()),
  };
}

export function taskEvent(eventType, task, payload = {}, nowUtc = nowIso()) {
  const body = { task_id: task.assistant_task_id, event_type: eventType, ...payload };
  return {
    assistant_event_id: id("asst_evt", body),
    assistant_profile_id: task.assistant_profile_id,
    assistant_conversation_id: task.assistant_conversation_id,
    assistant_task_id: task.assistant_task_id,
    event_type: eventType,
    occurred_at_utc: nowUtc,
    payload_hash: hash(body),
    payload: body,
  };
}

export function outboxFromEvent(event, channel = "ASSISTANT_RUNTIME") {
  return {
    assistant_outbox_id: id("asst_outbox", { event: event.assistant_event_id, channel }),
    assistant_event_id: event.assistant_event_id,
    channel,
    status: "PENDING",
    idempotency_key: `${channel}:${event.assistant_event_id}`,
    payload: event.payload,
    created_at_utc: event.occurred_at_utc,
    published_at_utc: null,
  };
}

export function normalizeDeadLetter(task, input, nowUtc) {
  return {
    assistant_task_dead_letter_id: id("asst_dlq", { task: task.assistant_task_id, error_code: input.errorCode || input.error_code }),
    assistant_task_id: task.assistant_task_id,
    assistant_profile_id: task.assistant_profile_id,
    status: "OPEN",
    error_code: text(input.errorCode || input.error_code || "ASSISTANT_TASK_FAILED"),
    error_message: text(input.errorMessage || input.error_message || "Assistant task failed."),
    retryable: input.retryable === true,
    payload: errorPayload(input),
    created_at_utc: nowUtc,
    updated_at_utc: nowUtc,
  };
}

export function errorPayload(input) {
  return {
    error_code: text(input.errorCode || input.error_code || "ASSISTANT_TASK_FAILED"),
    error_message: text(input.errorMessage || input.error_message || "Assistant task failed."),
    retryable: input.retryable === true,
  };
}

export async function insertConversation(client, conversation) {
  await client.query(
    `INSERT INTO assistant_conversations (
       assistant_conversation_id, assistant_profile_id, operator_id, status,
       conversation_summary, last_message_at_utc, metadata, created_at_utc, updated_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())
     ON CONFLICT (assistant_conversation_id) DO UPDATE SET
       last_message_at_utc = COALESCE(EXCLUDED.last_message_at_utc, assistant_conversations.last_message_at_utc),
       updated_at_utc = now()`,
    [
      conversation.assistant_conversation_id,
      conversation.assistant_profile_id,
      conversation.operator_id,
      conversation.status,
      conversation.conversation_summary,
      conversation.last_message_at_utc,
      json(conversation.metadata),
    ],
  );
}

export async function insertMessage(client, message) {
  await client.query(
    `INSERT INTO assistant_messages (
       assistant_message_id, assistant_conversation_id, role, content, citation_refs,
       message_hash, metadata, created_at_utc
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)
     ON CONFLICT (assistant_message_id) DO NOTHING`,
    [
      message.assistant_message_id,
      message.assistant_conversation_id,
      message.role,
      message.content,
      json(message.citation_refs),
      message.message_hash,
      json(message.metadata),
      message.created_at_utc,
    ],
  );
}

export async function insertSnapshot(client, snapshot) {
  await client.query(
    `INSERT INTO assistant_context_snapshots (
       assistant_context_snapshot_id, assistant_profile_id, assistant_conversation_id,
       context_builder, source_refs, bounded_context, snapshot_hash, max_messages,
       max_events, created_at_utc
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
     ON CONFLICT (assistant_context_snapshot_id) DO NOTHING`,
    [
      snapshot.assistant_context_snapshot_id,
      snapshot.assistant_profile_id,
      snapshot.assistant_conversation_id,
      snapshot.context_builder,
      json(snapshot.source_refs),
      json(snapshot.bounded_context),
      snapshot.snapshot_hash,
      snapshot.max_messages,
      snapshot.max_events,
      snapshot.created_at_utc,
    ],
  );
}

export async function insertTask(client, task) {
  await client.query(
    `INSERT INTO assistant_tasks (
       assistant_task_id, assistant_profile_id, assistant_conversation_id, triggering_message_id,
       input_snapshot_id, answer_message_id, task_type, wake_type, status, priority,
       idempotency_key, model_policy_version, payload, assigned_worker_id, lease_token,
       lease_expires_at_utc, attempt_count, max_attempts, not_before_utc, last_error,
       metrics, correlation_id, created_at_utc, updated_at_utc
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20::jsonb,
       $21::jsonb,$22,$23,$24
     )`,
    [
      task.assistant_task_id,
      task.assistant_profile_id,
      task.assistant_conversation_id,
      task.triggering_message_id,
      task.input_snapshot_id,
      task.answer_message_id,
      task.task_type,
      task.wake_type,
      task.status,
      task.priority,
      task.idempotency_key,
      task.model_policy_version,
      json(task.payload),
      task.assigned_worker_id,
      task.lease_token,
      task.lease_expires_at_utc,
      task.attempt_count,
      task.max_attempts,
      task.not_before_utc,
      task.last_error ? json(task.last_error) : null,
      json(task.metrics),
      task.correlation_id,
      task.created_at_utc,
      task.updated_at_utc,
    ],
  );
}

export async function insertLease(client, lease) {
  await client.query(
    `INSERT INTO assistant_task_leases (
       assistant_task_lease_id, assistant_task_id, worker_id, lease_token,
       status, acquired_at_utc, expires_at_utc, released_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (assistant_task_id, lease_token) DO UPDATE SET
       status = EXCLUDED.status,
       released_at_utc = EXCLUDED.released_at_utc`,
    [
      lease.assistant_task_lease_id,
      lease.assistant_task_id,
      lease.worker_id,
      lease.lease_token,
      lease.status,
      lease.acquired_at_utc,
      lease.expires_at_utc,
      lease.released_at_utc || null,
    ],
  );
}

export async function insertAnswer(client, answer) {
  await client.query(
    `INSERT INTO assistant_answers (
       assistant_answer_id, assistant_task_id, assistant_message_id, model_policy_version,
       answer_hash, citation_refs, token_input, token_output, latency_ms, created_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
     ON CONFLICT (assistant_answer_id) DO NOTHING`,
    [
      answer.assistant_answer_id,
      answer.assistant_task_id,
      answer.assistant_message_id,
      answer.model_policy_version,
      answer.answer_hash,
      json(answer.citation_refs),
      answer.token_input,
      answer.token_output,
      answer.latency_ms,
      answer.created_at_utc,
    ],
  );
}

export async function insertDeadLetter(client, deadLetter) {
  await client.query(
    `INSERT INTO assistant_task_dead_letters (
       assistant_task_dead_letter_id, assistant_task_id, assistant_profile_id,
       status, error_code, error_message, retryable, payload, created_at_utc, updated_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (assistant_task_dead_letter_id) DO NOTHING`,
    [
      deadLetter.assistant_task_dead_letter_id,
      deadLetter.assistant_task_id,
      deadLetter.assistant_profile_id,
      deadLetter.status,
      deadLetter.error_code,
      deadLetter.error_message,
      deadLetter.retryable,
      json(deadLetter.payload),
      deadLetter.created_at_utc,
      deadLetter.updated_at_utc,
    ],
  );
}

export async function insertEvent(client, event) {
  const payload = object(event.payload);
  await client.query(
    `INSERT INTO assistant_events (
       assistant_event_id, assistant_profile_id, assistant_conversation_id,
       assistant_task_id, event_type, occurred_at_utc, payload_hash, payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (assistant_event_id) DO NOTHING`,
    [
      event.assistant_event_id,
      event.assistant_profile_id || null,
      event.assistant_conversation_id || null,
      event.assistant_task_id || null,
      event.event_type,
      event.occurred_at_utc,
      event.payload_hash || hash(payload),
      json(payload),
    ],
  );
}

export async function insertOutbox(client, outbox) {
  await client.query(
    `INSERT INTO assistant_outbox (
       assistant_outbox_id, assistant_event_id, channel, status,
       idempotency_key, payload, created_at_utc, published_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      outbox.assistant_outbox_id,
      outbox.assistant_event_id,
      outbox.channel,
      outbox.status,
      outbox.idempotency_key,
      json(outbox.payload),
      outbox.created_at_utc,
      outbox.published_at_utc,
    ],
  );
}

export async function releaseLease(client, taskId, leaseToken, nowUtc, status = "RELEASED") {
  await client.query(
    `UPDATE assistant_task_leases
        SET status = $3,
            released_at_utc = $4
      WHERE assistant_task_id = $1
        AND lease_token = $2`,
    [taskId, leaseToken, status, nowUtc],
  );
}

export async function taskForUpdate(client, taskId) {
  const row = await one(client, "SELECT * FROM assistant_tasks WHERE assistant_task_id = $1 FOR UPDATE", [taskId]);
  if (!row) throw repositoryError("ASSISTANT_TASK_NOT_FOUND", "Assistant task not found.");
  return row;
}

export function assertLease(task, input = {}) {
  if (!task) throw repositoryError("ASSISTANT_TASK_NOT_FOUND", "Assistant task not found.");
  if (task.assigned_worker_id !== input.workerId || task.lease_token !== input.leaseToken) {
    throw repositoryError("ASSISTANT_TASK_LEASE_MISMATCH", "Assistant task lease does not match the worker handle.");
  }
}

export async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
export async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }

export function projectProfileRow(row) { return normalizeProfile(row); }
export function projectConversationRow(row) { return normalizeConversation(row); }
export function projectMessageRow(row) { return normalizeMessage(row); }
export function projectTaskRow(row) { return normalizeTask(row); }
export function projectDeadLetterRow(row) { return { ...row, payload: object(row.payload) }; }

export function repositoryError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
export function id(prefix, value) { return `${prefix}_${canonicalSha256(value).slice(0, 24)}`; }
export function hash(value) { return `sha256:${canonicalSha256(value)}`; }
export function json(value) { return JSON.stringify(value ?? {}); }
export function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
export function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
export function array(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
export function text(value) { return String(value ?? "").trim(); }
export function upper(value) { return text(value).toUpperCase(); }
export function integer(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback; }
export function nowIso() { return ASSISTANT_REPOSITORY_CLOCK.now().utc; }
export function addSeconds(iso, seconds) { return new Date(Date.parse(iso) + Math.max(0, Number(seconds) || 0) * 1000).toISOString(); }
function firstText(source, keys, fallback = "") {
  const selected = firstValue(source, keys, fallback);
  const normalized = text(selected);
  if (normalized) return normalized;
  return fallback;
}
function firstValue(source, keys, fallback = undefined) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return fallback;
}
