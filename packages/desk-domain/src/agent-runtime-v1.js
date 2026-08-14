import { canonicalSha256 } from "./execution-scope.js";
import { planAgentTaskRetryV1 } from "./agent-runtime-retry-policy-v1.js";

export const AGENT_RUNTIME_VERSION_V1 = "1.0.0";
export const AGENT_RUNTIME_SCHEMA_VERSION_V1 = "agent_runtime_v1";
export const AGENT_SCHEMA_VERSION_V1 = "agent_v1";
export const AGENT_MISSION_SCHEMA_VERSION_V1 = "agent_mission_v1";
export const AGENT_CONVERSATION_SCHEMA_VERSION_V1 = "agent_conversation_v1";
export const AGENT_TASK_SCHEMA_VERSION_V1 = "agent_task_v1";
export const AGENT_LEASE_SCHEMA_VERSION_V1 = "agent_lease_v1";
export const AGENT_EVENT_SCHEMA_VERSION_V1 = "agent_event_v1";

export const AGENT_STATUSES_V1 = Object.freeze(["IDLE", "BUSY", "OFFLINE", "DISABLED"]);
export const AGENT_MISSION_STATUSES_V1 = Object.freeze(["CREATED", "ASSIGNED", "IN_PROGRESS", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]);
export const AGENT_CONVERSATION_STATUSES_V1 = Object.freeze(["OPEN", "ROTATING", "ARCHIVED", "FAILED"]);
export const AGENT_TASK_STATUSES_V1 = Object.freeze(["PENDING", "READY", "CLAIMED", "RUNNING", "WAITING_DEPENDENCY", "DONE", "ERROR", "CANCELLED", "EXPIRED"]);
export const AGENT_LEASE_STATUSES_V1 = Object.freeze(["ACTIVE", "EXPIRED", "RELEASED", "BROKEN"]);
export const AGENT_EVENT_TYPES_V1 = Object.freeze(["AGENT_REGISTERED", "MISSION_CREATED", "CONVERSATION_ATTACHED", "EXECUTION_POLICY_RESOLVED", "TASK_CREATED", "TASK_CLAIMED", "LEASE_EXTENDED", "TASK_COMPLETED", "TASK_FAILED", "TASK_EXPIRED", "TASK_DEAD_LETTERED", "TASK_REQUEUED", "TASK_CANCELLED"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z0-9][a-z0-9_.:-]{1,190}[a-z0-9]$/;
const FINAL_TASK_STATUSES = Object.freeze(["DONE", "ERROR", "CANCELLED", "EXPIRED"]);
const CLAIMABLE_TASK_STATUSES = Object.freeze(["PENDING", "READY"]);
const LEASED_TASK_STATUSES = Object.freeze(["CLAIMED", "RUNNING"]);

export function validateAgentV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: AGENT_SCHEMA_VERSION_V1,
    agent_id: requiredUuid(entity.agent_id ?? entity.id, "agent_id", issues),
    agent_key: optionalKey(entity.agent_key),
    agent_type: requiredText(entity.agent_type ?? entity.type, "agent_type", issues),
    status: enumValue(entity.status, AGENT_STATUSES_V1, "status", issues),
    worker_group: optionalText(entity.worker_group),
    capabilities: stringArray(entity.capabilities),
    model_policy: jsonObject(entity.model_policy),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(entity.created_at_utc ?? entity.created_at, "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(entity.updated_at_utc ?? entity.updated_at, "updated_at_utc", issues),
  };
  if (normalized.updated_at_utc) validateNotBefore("updated_at_utc", normalized.updated_at_utc, "created_at_utc", normalized.created_at_utc, issues);
  return validationResult("agent", normalized, issues);
}

export function validateAgentMissionV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: AGENT_MISSION_SCHEMA_VERSION_V1,
    mission_id: requiredUuid(entity.mission_id ?? entity.id, "mission_id", issues),
    mission_key: optionalKey(entity.mission_key),
    agent_id: nullableUuid(entity.agent_id, "agent_id", issues),
    mission_type: requiredText(entity.mission_type ?? entity.type, "mission_type", issues),
    lane: requiredText(entity.lane, "lane", issues),
    objective: requiredText(entity.objective, "objective", issues),
    context_ref: nullableText(entity.context_ref),
    correlation_id: requiredText(entity.correlation_id, "correlation_id", issues),
    status: enumValue(entity.status, AGENT_MISSION_STATUSES_V1, "status", issues),
    priority: integer(entity.priority, { fallback: 100 }),
    prompt_composition_id: nullableUuid(entity.prompt_composition_id, "prompt_composition_id", issues),
    model_policy: jsonObject(entity.model_policy),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(entity.created_at_utc ?? entity.created_at, "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(entity.updated_at_utc ?? entity.updated_at, "updated_at_utc", issues),
  };
  if (normalized.status !== "CREATED" && !normalized.agent_id) issues.push(issue("MISSION_AGENT_REQUIRED_AFTER_CREATED", "agent_id"));
  if (normalized.updated_at_utc) validateNotBefore("updated_at_utc", normalized.updated_at_utc, "created_at_utc", normalized.created_at_utc, issues);
  return validationResult("agent_mission", normalized, issues);
}

export function validateAgentConversationV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: AGENT_CONVERSATION_SCHEMA_VERSION_V1,
    conversation_id: requiredUuid(entity.conversation_id ?? entity.id, "conversation_id", issues),
    mission_id: requiredUuid(entity.mission_id, "mission_id", issues),
    provider: requiredText(entity.provider, "provider", issues),
    external_conversation_ref: nullableText(entity.external_conversation_ref ?? entity.thread_ref),
    status: enumValue(entity.status, AGENT_CONVERSATION_STATUSES_V1, "status", issues),
    affinity_key: nullableText(entity.affinity_key),
    turn_count: integer(entity.turn_count, { fallback: 0 }),
    last_used_at_utc: optionalTimestamp(entity.last_used_at_utc, "last_used_at_utc", issues),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(entity.created_at_utc ?? entity.created_at, "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(entity.updated_at_utc ?? entity.updated_at, "updated_at_utc", issues),
  };
  if (normalized.turn_count < 0) issues.push(issue("CONVERSATION_TURN_COUNT_NEGATIVE", "turn_count"));
  if (normalized.updated_at_utc) validateNotBefore("updated_at_utc", normalized.updated_at_utc, "created_at_utc", normalized.created_at_utc, issues);
  return validationResult("agent_conversation", normalized, issues);
}

export function validateAgentTaskV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = normalizeTask(entity, issues);
  validateTaskChronology(normalized, issues);
  return validationResult("agent_task", normalized, issues);
}

export function claimAgentTaskV1(taskInput = {}, commandInput = {}) {
  const command = object(commandInput);
  const issues = [];
  const task = normalizeTask(object(taskInput), issues);
  const now = requiredTimestamp(command.now_utc, "now_utc", issues);
  const workerId = requiredText(command.worker_id, "worker_id", issues);
  const leaseToken = requiredText(command.lease_token, "lease_token", issues);
  const leaseSeconds = integer(command.lease_seconds, { fallback: 900 });
  const validation = transitionPreflight("claim", task, issues);
  if (!validation.ok) return transitionRejected(validation.reasons, task);
  if (leaseSeconds <= 0) return transitionRejected(["LEASE_SECONDS_INVALID"], task);
  if (FINAL_TASK_STATUSES.includes(task.status)) return transitionRejected(["TASK_FINAL"], task);
  if (hasActiveLease(task, now) && LEASED_TASK_STATUSES.includes(task.status)) {
    return transitionRejected(["AGENT_TASK_ALREADY_LEASED"], task);
  }
  if (notBeforeInFuture(task, now)) return transitionRejected(["AGENT_TASK_NOT_READY_BEFORE"], task);
  if (!CLAIMABLE_TASK_STATUSES.includes(task.status) && !leaseExpired(task, now)) {
    return transitionRejected(["TASK_NOT_CLAIMABLE"], task);
  }

  const lease = buildLease(task, {
    worker_id: workerId,
    lease_token: leaseToken,
    acquired_at_utc: now,
    expires_at_utc: timestampPlusSeconds(now, leaseSeconds),
  });
  const nextTask = sealTask({
    ...task,
    status: "CLAIMED",
    assigned_worker_id: workerId,
    lease_token: leaseToken,
    lease_expires_at_utc: lease.expires_at_utc,
    claimed_at_utc: now,
    not_before_utc: null,
    attempt_count: task.attempt_count + 1,
    revision: task.revision + 1,
    updated_at_utc: now,
  });

  return transitionAccepted(nextTask, lease, buildAgentEventV1({
    event_type: "TASK_CLAIMED",
    task: nextTask,
    lease,
    actor: workerId,
    now_utc: now,
    payload: {
      previous_status: task.status,
      next_status: nextTask.status,
      attempt_count: nextTask.attempt_count,
    },
  }));
}

export function extendAgentLeaseV1(taskInput = {}, commandInput = {}) {
  const command = object(commandInput);
  const issues = [];
  const task = normalizeTask(object(taskInput), issues);
  const now = requiredTimestamp(command.now_utc, "now_utc", issues);
  const leaseSeconds = integer(command.lease_seconds, { fallback: 900 });
  const validation = leasePreflight("extend", task, command, issues);
  if (!validation.ok) return transitionRejected(validation.reasons, task);
  if (leaseSeconds <= 0) return transitionRejected(["LEASE_SECONDS_INVALID"], task);
  if (leaseExpired(task, now)) return transitionRejected(["AGENT_TASK_LEASE_EXPIRED"], task);

  const lease = buildLease(task, {
    worker_id: task.assigned_worker_id,
    lease_token: task.lease_token,
    acquired_at_utc: task.claimed_at_utc || now,
    expires_at_utc: timestampPlusSeconds(now, leaseSeconds),
    heartbeat_at_utc: now,
  });
  const nextTask = sealTask({
    ...task,
    lease_expires_at_utc: lease.expires_at_utc,
    revision: task.revision + 1,
    updated_at_utc: now,
  });
  return transitionAccepted(nextTask, lease, buildAgentEventV1({
    event_type: "LEASE_EXTENDED",
    task: nextTask,
    lease,
    actor: task.assigned_worker_id,
    now_utc: now,
    payload: { next_lease_expires_at_utc: lease.expires_at_utc },
  }));
}

export function completeAgentTaskV1(taskInput = {}, commandInput = {}) {
  const command = object(commandInput);
  const issues = [];
  const task = normalizeTask(object(taskInput), issues);
  const now = requiredTimestamp(command.now_utc, "now_utc", issues);
  const validation = leasePreflight("complete", task, command, issues);
  if (!validation.ok) return transitionRejected(validation.reasons, task);
  if (leaseExpired(task, now)) return transitionRejected(["AGENT_TASK_LEASE_EXPIRED"], task);

  const nextTask = sealTask({
    ...task,
    status: "DONE",
    output_ref: nullableText(command.output_ref) || task.output_ref,
    completed_at_utc: now,
    lease_token: null,
    lease_expires_at_utc: null,
    revision: task.revision + 1,
    updated_at_utc: now,
  });
  const lease = buildLease(task, {
    worker_id: task.assigned_worker_id,
    lease_token: task.lease_token,
    acquired_at_utc: task.claimed_at_utc || now,
    expires_at_utc: task.lease_expires_at_utc,
    released_at_utc: now,
    status: "RELEASED",
  });
  return transitionAccepted(nextTask, lease, buildAgentEventV1({
    event_type: "TASK_COMPLETED",
    task: nextTask,
    lease,
    actor: task.assigned_worker_id,
    now_utc: now,
    payload: { output_ref: nextTask.output_ref },
  }));
}

export function failAgentTaskV1(taskInput = {}, commandInput = {}) {
  const command = object(commandInput);
  const issues = [];
  const task = normalizeTask(object(taskInput), issues);
  const now = requiredTimestamp(command.now_utc, "now_utc", issues);
  const validation = leasePreflight("fail", task, command, issues);
  if (!validation.ok) return transitionRejected(validation.reasons, task);

  const retryable = command.retryable === true;
  const maxAttempts = task.max_attempts || 1;
  const nextStatus = retryable && task.attempt_count < maxAttempts ? "READY" : "ERROR";
  const retryPlan = planAgentTaskRetryV1(task, command, now, nextStatus);
  const nextTask = sealTask({
    ...task,
    status: nextStatus,
    lease_token: null,
    lease_expires_at_utc: null,
    not_before_utc: retryPlan.next_retry_at_utc,
    failed_at_utc: now,
    last_error: {
      error_code: requiredText(command.error_code, "error_code", issues) || "AGENT_TASK_FAILED",
      error_message: nullableText(command.error_message),
      retryable,
      retry_after_seconds: retryPlan.retry_after_seconds,
      next_retry_at_utc: retryPlan.next_retry_at_utc,
      failed_at_utc: now,
    },
    revision: task.revision + 1,
    updated_at_utc: now,
  });
  if (issues.length) return transitionRejected(issues.map((item) => item.code), task);

  const lease = buildLease(task, {
    worker_id: task.assigned_worker_id,
    lease_token: task.lease_token,
    acquired_at_utc: task.claimed_at_utc || now,
    expires_at_utc: task.lease_expires_at_utc,
    released_at_utc: now,
    status: "RELEASED",
  });
  return transitionAccepted(nextTask, lease, buildAgentEventV1({
    event_type: "TASK_FAILED",
    task: nextTask,
    lease,
    actor: task.assigned_worker_id,
    now_utc: now,
    payload: {
      next_status: nextStatus,
      error_code: nextTask.last_error.error_code,
      retryable,
      retry_after_seconds: retryPlan.retry_after_seconds,
      next_retry_at_utc: retryPlan.next_retry_at_utc,
    },
  }));
}

export function expireAgentTaskLeaseV1(taskInput = {}, commandInput = {}) {
  const command = object(commandInput);
  const issues = [];
  const task = normalizeTask(object(taskInput), issues);
  const now = requiredTimestamp(command.now_utc, "now_utc", issues);
  const validation = transitionPreflight("expire", task, issues);
  if (!validation.ok) return transitionRejected(validation.reasons, task);
  if (!task.lease_token || !task.lease_expires_at_utc) return transitionRejected(["AGENT_TASK_LEASE_REQUIRED"], task);
  if (!leaseExpired(task, now)) return transitionRejected(["AGENT_TASK_LEASE_NOT_EXPIRED"], task);

  const nextStatus = task.attempt_count < task.max_attempts ? "READY" : "EXPIRED";
  const nextTask = sealTask({
    ...task,
    status: nextStatus,
    lease_token: null,
    lease_expires_at_utc: null,
    revision: task.revision + 1,
    updated_at_utc: now,
  });
  const lease = buildLease(task, {
    worker_id: task.assigned_worker_id,
    lease_token: task.lease_token,
    acquired_at_utc: task.claimed_at_utc || now,
    expires_at_utc: task.lease_expires_at_utc,
    status: "EXPIRED",
  });
  return transitionAccepted(nextTask, lease, buildAgentEventV1({
    event_type: "TASK_EXPIRED",
    task: nextTask,
    lease,
    actor: nullableText(command.actor) || "agent-runtime",
    now_utc: now,
    payload: {
      previous_lease_expires_at_utc: task.lease_expires_at_utc,
      next_status: nextStatus,
    },
  }));
}

export function buildAgentEventV1(input = {}) {
  const eventType = upper(input.event_type);
  const task = object(input.task);
  const lease = object(input.lease);
  const event = {
    schema_version: AGENT_EVENT_SCHEMA_VERSION_V1,
    event_type: AGENT_EVENT_TYPES_V1.includes(eventType) ? eventType : null,
    mission_id: nullableText(input.mission_id ?? task.mission_id),
    task_id: nullableText(input.task_id ?? task.task_id),
    conversation_id: nullableText(input.conversation_id ?? task.conversation_id),
    lease_token: nullableText(input.lease_token ?? lease.lease_token),
    correlation_id: nullableText(input.correlation_id ?? task.correlation_id),
    causation_id: nullableText(input.causation_id),
    actor: nullableText(input.actor),
    payload: jsonObject(input.payload),
    created_at_utc: nullableText(input.now_utc ?? input.created_at_utc),
  };
  return {
    ...event,
    event_hash: `sha256:${canonicalSha256(event)}`,
  };
}

export function agentRuntimeHashV1(input = {}) {
  return `sha256:${canonicalSha256(input)}`;
}

function normalizeTask(entity, issues) {
  const maxAttempts = integer(entity.max_attempts, { fallback: 1 });
  return {
    schema_version: AGENT_TASK_SCHEMA_VERSION_V1,
    task_id: requiredUuid(entity.task_id ?? entity.id, "task_id", issues),
    mission_id: requiredUuid(entity.mission_id, "mission_id", issues),
    conversation_id: nullableUuid(entity.conversation_id, "conversation_id", issues),
    task_key: optionalKey(entity.task_key),
    task_type: requiredText(entity.task_type ?? entity.type, "task_type", issues),
    lane: requiredText(entity.lane, "lane", issues),
    input_ref: nullableText(entity.input_ref),
    output_ref: nullableText(entity.output_ref),
    status: enumValue(entity.status, AGENT_TASK_STATUSES_V1, "status", issues),
    priority: integer(entity.priority, { fallback: 100 }),
    payload: jsonObject(entity.payload),
    idempotency_key: nullableText(entity.idempotency_key),
    prompt_render_snapshot_id: nullableUuid(entity.prompt_render_snapshot_id, "prompt_render_snapshot_id", issues),
    depends_on_task_id: nullableUuid(entity.depends_on_task_id, "depends_on_task_id", issues),
    assigned_worker_id: nullableText(entity.assigned_worker_id),
    attempt_count: integer(entity.attempt_count, { fallback: 0 }),
    max_attempts: maxAttempts > 0 ? maxAttempts : 1,
    not_before_utc: optionalTimestamp(entity.not_before_utc, "not_before_utc", issues),
    lease_token: nullableText(entity.lease_token),
    lease_expires_at_utc: optionalTimestamp(entity.lease_expires_at_utc, "lease_expires_at_utc", issues),
    claimed_at_utc: optionalTimestamp(entity.claimed_at_utc, "claimed_at_utc", issues),
    completed_at_utc: optionalTimestamp(entity.completed_at_utc, "completed_at_utc", issues),
    failed_at_utc: optionalTimestamp(entity.failed_at_utc, "failed_at_utc", issues),
    last_error: nullableJsonObject(entity.last_error),
    correlation_id: nullableText(entity.correlation_id),
    revision: integer(entity.revision, { fallback: 0 }),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(entity.created_at_utc ?? entity.created_at, "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(entity.updated_at_utc ?? entity.updated_at, "updated_at_utc", issues),
  };
}

function validateTaskChronology(task, issues) {
  validateNotBefore("updated_at_utc", task.updated_at_utc, "created_at_utc", task.created_at_utc, issues);
  validateNotBefore("claimed_at_utc", task.claimed_at_utc, "created_at_utc", task.created_at_utc, issues);
  validateNotBefore("completed_at_utc", task.completed_at_utc, "created_at_utc", task.created_at_utc, issues);
  validateNotBefore("failed_at_utc", task.failed_at_utc, "created_at_utc", task.created_at_utc, issues);
  if (task.attempt_count < 0) issues.push(issue("TASK_ATTEMPT_COUNT_NEGATIVE", "attempt_count"));
  if (task.revision < 0) issues.push(issue("TASK_REVISION_NEGATIVE", "revision"));
  if (LEASED_TASK_STATUSES.includes(task.status) && (!task.assigned_worker_id || !task.lease_token)) {
    issues.push(issue("TASK_LEASE_REQUIRED_FOR_LEASED_STATUS", "lease_token"));
  }
  if (task.status === "DONE" && !task.completed_at_utc) issues.push(issue("TASK_COMPLETED_AT_REQUIRED", "completed_at_utc"));
  if (task.status === "ERROR" && !task.last_error) issues.push(issue("TASK_ERROR_REQUIRED", "last_error"));
}

function transitionPreflight(action, task, issues) {
  validateTaskChronology(task, issues);
  if (issues.length) return { ok: false, reasons: issues.map((item) => item.code) };
  if (!task.task_id) return { ok: false, reasons: ["TASK_ID_REQUIRED"] };
  if (!task.mission_id) return { ok: false, reasons: ["MISSION_ID_REQUIRED"] };
  if (!task.status) return { ok: false, reasons: [`TASK_${upper(action)}_STATUS_REQUIRED`] };
  return { ok: true, reasons: [] };
}

function leasePreflight(action, task, command, issues) {
  const workerId = requiredText(command.worker_id, "worker_id", issues);
  const leaseToken = requiredText(command.lease_token, "lease_token", issues);
  const validation = transitionPreflight(action, task, issues);
  if (!validation.ok) return validation;
  if (!LEASED_TASK_STATUSES.includes(task.status)) return { ok: false, reasons: ["TASK_NOT_LEASED"] };
  if (!task.lease_token || !task.assigned_worker_id) return { ok: false, reasons: ["AGENT_TASK_LEASE_REQUIRED"] };
  if (task.assigned_worker_id !== workerId || task.lease_token !== leaseToken) {
    return { ok: false, reasons: ["AGENT_TASK_LEASE_MISMATCH"] };
  }
  return { ok: true, reasons: [] };
}

function buildLease(task, overrides = {}) {
  const lease = {
    schema_version: AGENT_LEASE_SCHEMA_VERSION_V1,
    task_id: task.task_id,
    mission_id: task.mission_id,
    worker_id: nullableText(overrides.worker_id),
    lease_token: nullableText(overrides.lease_token),
    status: enumOrDefault(overrides.status, AGENT_LEASE_STATUSES_V1, "ACTIVE"),
    acquired_at_utc: nullableText(overrides.acquired_at_utc),
    expires_at_utc: nullableText(overrides.expires_at_utc),
    released_at_utc: nullableText(overrides.released_at_utc),
    heartbeat_at_utc: nullableText(overrides.heartbeat_at_utc),
    metadata: jsonObject(overrides.metadata),
  };
  return {
    ...lease,
    lease_hash: `sha256:${canonicalSha256(lease)}`,
  };
}

function transitionAccepted(task, lease, event) {
  return {
    ok: true,
    reasons: [],
    task,
    lease,
    event,
  };
}

function transitionRejected(reasons, task = null) {
  return {
    ok: false,
    reasons: [...new Set(reasons.filter(Boolean))],
    task,
    lease: null,
    event: null,
  };
}

function sealTask(task) {
  return {
    ...task,
    task_hash: `sha256:${canonicalSha256(task)}`,
  };
}

function validationResult(entity, normalized, issues) {
  return {
    ok: issues.length === 0,
    reasons: [...new Set(issues.map((item) => item.code))],
    entity,
    schema_version: AGENT_RUNTIME_SCHEMA_VERSION_V1,
    issues,
    normalized,
  };
}

function hasActiveLease(task, now) {
  return Boolean(task.lease_token && task.lease_expires_at_utc && !leaseExpired(task, now));
}

function leaseExpired(task, now) {
  const expiresAt = Date.parse(task.lease_expires_at_utc || "");
  const nowTime = Date.parse(now || "");
  return Number.isFinite(expiresAt) && Number.isFinite(nowTime) && expiresAt <= nowTime;
}

function notBeforeInFuture(task, now) {
  const notBefore = Date.parse(task.not_before_utc || "");
  const nowTime = Date.parse(now || "");
  return Number.isFinite(notBefore) && Number.isFinite(nowTime) && notBefore > nowTime;
}


function timestampPlusSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1000).toISOString();
}

function validateNotBefore(leftName, leftValue, rightName, rightValue, issues) {
  if (!leftValue || !rightValue) return;
  if (Date.parse(leftValue) < Date.parse(rightValue)) {
    issues.push(issue("AGENT_RUNTIME_TIMESTAMP_ORDER_INVALID", leftName, { left: leftName, right: rightName }));
  }
}

function requiredUuid(value, path, issues) {
  const normalized = nullableText(value);
  if (!normalized) {
    issues.push(issue("AGENT_RUNTIME_UUID_REQUIRED", path));
    return null;
  }
  if (!UUID_RE.test(normalized)) issues.push(issue("AGENT_RUNTIME_UUID_INVALID", path, { value: normalized }));
  return normalized;
}

function nullableUuid(value, path, issues) {
  const normalized = nullableText(value);
  if (!normalized) return null;
  if (!UUID_RE.test(normalized)) issues.push(issue("AGENT_RUNTIME_UUID_INVALID", path, { value: normalized }));
  return normalized;
}

function requiredText(value, path, issues) {
  const normalized = nullableText(value);
  if (!normalized) issues.push(issue("AGENT_RUNTIME_TEXT_REQUIRED", path));
  return normalized;
}

function optionalText(value) {
  return nullableText(value);
}

function optionalKey(value) {
  const normalized = nullableText(value);
  return normalized && KEY_RE.test(normalized) ? normalized : normalized;
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function enumValue(value, values, path, issues) {
  const normalized = upper(value);
  if (!values.includes(normalized)) issues.push(issue("AGENT_RUNTIME_ENUM_INVALID", path, { value }));
  return normalized || null;
}

function enumOrDefault(value, values, fallback) {
  const normalized = upper(value);
  return values.includes(normalized) ? normalized : fallback;
}

function upper(value) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function requiredTimestamp(value, path, issues) {
  const normalized = nullableText(value);
  if (!normalized) {
    issues.push(issue("AGENT_RUNTIME_TIMESTAMP_REQUIRED", path));
    return null;
  }
  if (!Number.isFinite(Date.parse(normalized))) issues.push(issue("AGENT_RUNTIME_TIMESTAMP_INVALID", path, { value }));
  return normalized;
}

function optionalTimestamp(value, path, issues) {
  const normalized = nullableText(value);
  if (!normalized) return null;
  if (!Number.isFinite(Date.parse(normalized))) issues.push(issue("AGENT_RUNTIME_TIMESTAMP_INVALID", path, { value }));
  return normalized;
}

function integer(value, options = {}) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : options.fallback;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function jsonObject(value) {
  return object(value);
}

function nullableJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function issue(code, path, metadata = {}) {
  return { code, path, ...metadata };
}
