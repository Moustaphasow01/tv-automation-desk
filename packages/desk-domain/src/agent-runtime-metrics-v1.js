import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_TASK_RUN_METRIC_SCHEMA_VERSION_V1 = "agent_task_run_metric_v1";
export const AGENT_TASK_RUN_OUTCOMES_V1 = Object.freeze(["COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "DEAD_LETTERED", "CANCELLED"]);

export function buildAgentTaskRunMetricV1(input = {}) {
  const metric = {
    schema_version: AGENT_TASK_RUN_METRIC_SCHEMA_VERSION_V1,
    task_id: text(input.task_id),
    mission_id: text(input.mission_id),
    conversation_id: text(input.conversation_id),
    execution_policy_snapshot_id: text(input.execution_policy_snapshot_id),
    dead_letter_id: text(input.dead_letter_id),
    worker_id: text(input.worker_id),
    lane: text(input.lane),
    task_type: text(input.task_type),
    model: text(input.model),
    reasoning_effort: text(input.reasoning_effort),
    outcome: outcome(input.outcome),
    queue_latency_ms: nonNegativeInteger(input.queue_latency_ms),
    run_duration_ms: nonNegativeInteger(input.run_duration_ms),
    total_latency_ms: nonNegativeInteger(input.total_latency_ms),
    input_tokens: nonNegativeInteger(input.input_tokens),
    output_tokens: nonNegativeInteger(input.output_tokens),
    total_tokens: nonNegativeInteger(input.total_tokens),
    cost_micros_usd: nonNegativeInteger(input.cost_micros_usd),
    output_ref: text(input.output_ref),
    error_code: text(input.error_code),
    started_at_utc: text(input.started_at_utc),
    finished_at_utc: text(input.finished_at_utc),
    metadata: object(input.metadata),
  };
  return {
    ...metric,
    metric_hash: `sha256:${canonicalSha256(metric)}`,
  };
}

function outcome(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return AGENT_TASK_RUN_OUTCOMES_V1.includes(normalized) ? normalized : "FAILED_TERMINAL";
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
