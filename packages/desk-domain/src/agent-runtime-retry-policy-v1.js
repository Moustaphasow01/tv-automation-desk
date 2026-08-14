import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_TASK_RETRY_POLICY_VERSION_V1 = "1.0.0";

export function planAgentTaskRetryV1(task = {}, command = {}, nowUtc = null, nextStatus = "ERROR") {
  if (nextStatus !== "READY") return { retry_after_seconds: null, next_retry_at_utc: null };
  const policy = object(command.retry_policy);
  const base = integer(policy.base_delay_seconds, 60);
  const max = integer(policy.max_delay_seconds, 900);
  const multiplier = integer(policy.multiplier, 2);
  const jitter = integer(policy.jitter_seconds, 0);
  const exponent = Math.max(0, (task.attempt_count || 1) - 1);
  const rawDelay = Math.max(0, base) * Math.max(1, multiplier) ** exponent;
  const retryAfterSeconds = Math.min(Math.max(0, max), rawDelay) + boundedJitter(task, command, jitter);
  return {
    retry_after_seconds: retryAfterSeconds,
    next_retry_at_utc: timestampPlusSeconds(nowUtc, retryAfterSeconds),
  };
}

function boundedJitter(task, command, jitterSeconds) {
  const maxJitter = Math.max(0, jitterSeconds);
  if (maxJitter === 0) return 0;
  const hash = `sha256:${canonicalSha256({
    task_id: task.task_id,
    attempt_count: task.attempt_count,
    error_code: command.error_code,
  })}`.slice(-8);
  return Number.parseInt(hash, 16) % (maxJitter + 1);
}

function timestampPlusSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1000).toISOString();
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
