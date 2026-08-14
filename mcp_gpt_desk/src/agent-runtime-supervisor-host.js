export const AGENT_RUNTIME_SUPERVISOR_HOST_SCHEMA = "agent_runtime_supervisor_host_v1";
export const AGENT_RUNTIME_SUPERVISOR_HOST_PLATFORMS = Object.freeze([
  "node-process",
  "windows-service",
  "systemd",
  "container",
]);

export function buildAgentRuntimeSupervisorHostConfig({
  env = {},
  argv = [],
  pid = 0,
  cwd = ".",
} = {}) {
  const lane = lower(env.DESK_AGENT_SUPERVISOR_LANE, "live");
  const workerPool = lower(env.DESK_AGENT_WORKER_POOL, lane);
  const config = {
    schema: AGENT_RUNTIME_SUPERVISOR_HOST_SCHEMA,
    host_platform: normalizeHostPlatform(env.DESK_AGENT_SUPERVISOR_HOST_PLATFORM),
    once: array(argv).includes("--once"),
    lane,
    mode: lower(env.DESK_AGENT_SUPERVISOR_MODE, "shadow"),
    worker_pool: workerPool,
    worker_id: text(env.DESK_AGENT_SUPERVISOR_ID) || `agent-runtime-${lane}-${pid}`,
    poll_ms: boundedInteger(env.DESK_AGENT_SUPERVISOR_POLL_MS, 15_000, 1_000, 300_000),
    lease_seconds: boundedInteger(env.DESK_AGENT_SUPERVISOR_LEASE_SECONDS, 900, 30, 7200),
    conversation_provider: text(env.DESK_AGENT_CONVERSATION_PROVIDER) || "codex",
    conversation_max_turns: boundedInteger(env.DESK_AGENT_CONVERSATION_MAX_TURNS, 12, 1, 1000),
    execution_defaults: {
      model: text(env.DESK_AGENT_MODEL) || "codex",
      reasoning_effort: text(env.DESK_AGENT_REASONING_EFFORT) || "xhigh",
      timeout_ms: boundedInteger(env.DESK_AGENT_TIMEOUT_MS, 780_000, 5_000, 1_800_000),
      token_budget: boundedInteger(env.DESK_AGENT_TOKEN_BUDGET, 0, 0, 10_000_000),
      max_output_tokens: boundedInteger(env.DESK_AGENT_MAX_OUTPUT_TOKENS, 0, 0, 10_000_000),
    },
    retry_policy: {
      base_delay_seconds: boundedInteger(env.DESK_AGENT_RETRY_BASE_DELAY_SECONDS, 60, 0, 86_400),
      max_delay_seconds: boundedInteger(env.DESK_AGENT_RETRY_MAX_DELAY_SECONDS, 900, 0, 86_400),
      multiplier: boundedInteger(env.DESK_AGENT_RETRY_MULTIPLIER, 2, 1, 16),
      jitter_seconds: boundedInteger(env.DESK_AGENT_RETRY_JITTER_SECONDS, 0, 0, 3_600),
    },
    scheduler_mode: normalizeSchedulerMode(env.DESK_AGENT_SCHEDULER_MODE),
    pool_policy: parseJsonObject(env.DESK_AGENT_POOL_POLICY_JSON),
    release_version: text(env.DESK_RELEASE_VERSION) || "unversioned",
    service_id: text(env.DESK_AGENT_SUPERVISOR_SERVICE_ID) || `agent_runtime_supervisor_${lane}`,
    runner_command: text(env.DESK_AGENT_SUPERVISOR_RUNNER_COMMAND),
    runner_args: splitArgs(env.DESK_AGENT_SUPERVISOR_RUNNER_ARGS),
    runner_timeout_ms: boundedInteger(env.DESK_AGENT_SUPERVISOR_RUNNER_TIMEOUT_MS, 780_000, 5_000, 1_800_000),
    project_root: text(env.DESK_AGENT_SUPERVISOR_PROJECT_ROOT) || cwd,
  };
  return {
    ...config,
    runner_configured: Boolean(config.runner_command),
    pool_policy_configured: Object.keys(config.pool_policy).length > 0,
  };
}

export function buildAgentRuntimeSupervisorHeartbeatDetails(config = {}, extra = {}) {
  return {
    host_platform: config.host_platform,
    lane: config.lane,
    worker_pool: config.worker_pool,
    mode: config.mode,
    poll_ms: config.poll_ms,
    runner_configured: config.runner_configured === true,
    conversation_provider: config.conversation_provider,
    conversation_max_turns: config.conversation_max_turns,
    execution_defaults: config.execution_defaults || {},
    retry_policy: config.retry_policy || {},
    scheduler_mode: config.scheduler_mode,
    pool_policy_configured: config.pool_policy_configured === true,
    ...object(extra),
  };
}

export function normalizeSchedulerMode(value) {
  const normalized = lower(value, "disabled");
  return ["disabled", "shadow", "enforce"].includes(normalized) ? normalized : "disabled";
}

export function normalizeHostPlatform(value) {
  const normalized = lower(value, "node-process");
  return AGENT_RUNTIME_SUPERVISOR_HOST_PLATFORMS.includes(normalized) ? normalized : "node-process";
}

function splitArgs(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function parseJsonObject(value) {
  if (!String(value || "").trim()) return {};
  try {
    const parsed = JSON.parse(String(value));
    return object(parsed);
  } catch {
    return {};
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function lower(value, fallback) {
  return String(value || fallback).trim().toLowerCase();
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
