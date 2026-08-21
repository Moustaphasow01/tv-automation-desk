export const AGENT_RUNTIME_ADMIN_POLICY_VERSION_V1 = "1.0.0";
export const AGENT_RUNTIME_ADMIN_ACTIONS_V1 = Object.freeze([
  "READ_OVERVIEW",
  "READ_TASK",
  "LIST_TASKS",
  "LIST_DEAD_LETTERS",
  "LIST_METRICS",
  "LIST_POOLS",
  "LIST_EVENTS",
  "REQUEUE_DEAD_LETTER",
  "CANCEL_TASK",
]);

const MUTATING_ACTIONS = new Set(["REQUEUE_DEAD_LETTER", "CANCEL_TASK"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authorizeAgentRuntimeAdminActionV1(input = {}) {
  const issues = [];
  const action = enumValue(input.action, AGENT_RUNTIME_ADMIN_ACTIONS_V1, "action", issues);
  const command = {
    policy_version: AGENT_RUNTIME_ADMIN_POLICY_VERSION_V1,
    action,
    task_id: optionalUuid(input.task_id ?? input.taskId, "task_id", issues),
    dead_letter_id: optionalUuid(input.dead_letter_id ?? input.deadLetterId, "dead_letter_id", issues),
    operator_id: optionalText(input.operator_id ?? input.operatorId),
    reason: optionalText(input.reason),
    idempotency_key: optionalText(input.idempotency_key ?? input.idempotencyKey),
  };
  validateTarget(command, issues);
  validateMutation(command, issues);
  return {
    ok: issues.length === 0,
    status: issues.length ? "rejected" : "accepted",
    reasons: issues,
    command,
  };
}

function validateTarget(command, issues) {
  if (command.action === "READ_TASK" && !command.task_id) issues.push("AGENT_ADMIN_TASK_ID_REQUIRED");
  if (command.action === "CANCEL_TASK" && !command.task_id) issues.push("AGENT_ADMIN_TASK_ID_REQUIRED");
  if (command.action === "REQUEUE_DEAD_LETTER" && !command.dead_letter_id) {
    issues.push("AGENT_ADMIN_DEAD_LETTER_ID_REQUIRED");
  }
}

function validateMutation(command, issues) {
  if (!MUTATING_ACTIONS.has(command.action)) return;
  if (!command.operator_id) issues.push("AGENT_ADMIN_OPERATOR_REQUIRED");
  if (!command.reason || command.reason.length < 8) issues.push("AGENT_ADMIN_REASON_REQUIRED");
  if (!command.idempotency_key || command.idempotency_key.length < 8) {
    issues.push("AGENT_ADMIN_IDEMPOTENCY_KEY_REQUIRED");
  }
}

function enumValue(value, allowed, field, issues) {
  const normalized = String(value || "").trim().toUpperCase();
  if (allowed.includes(normalized)) return normalized;
  issues.push(`${field.toUpperCase()}_INVALID`);
  return normalized || null;
}

function optionalUuid(value, field, issues) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (!UUID_RE.test(normalized)) issues.push(`${field.toUpperCase()}_INVALID`);
  return normalized;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
