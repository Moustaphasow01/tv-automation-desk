import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_WORKER_POOL_POLICY_VERSION_V1 = "1.0.0";
export const AGENT_WORKER_POOL_SCHEMA_VERSION_V1 = "agent_worker_pool_policy_v1";
export const AGENT_WORKER_POOL_RESOLUTION_SCHEMA_VERSION_V1 = "agent_worker_pool_resolution_v1";
export const AGENT_WORKER_POOL_OVERVIEW_SCHEMA_VERSION_V1 = "agent_worker_pool_overview_v1";

export const AGENT_WORKER_POOL_IDS_V1 = Object.freeze([
  "live",
  "safety",
  "operations",
  "replay",
  "validation",
  "research",
  "default",
]);

const DEFAULT_POOLS = Object.freeze({
  live: Object.freeze({
    pool_id: "live",
    label: "Live decisions",
    lane: "live",
    scheduler_lane: "live",
    enabled: true,
    rank: 0,
    max_concurrent_workers: 4,
    worker_id_prefixes: Object.freeze(["agent-runtime-live-", "agent-supervisor-live-", "codex-live-", "gpt-live-pool-"]),
    task_type_patterns: Object.freeze(["LIVE_*"]),
    responsibilities: Object.freeze([
      "LIVE_MASTER",
      "LIVE_MONITOR",
      "LIVE_SETUP_DECISION",
    ]),
    failure_scope: "pool_only",
  }),
  safety: Object.freeze({
    pool_id: "safety",
    label: "Safety and broker gates",
    lane: "safety",
    scheduler_lane: "safety",
    enabled: true,
    rank: 5,
    max_concurrent_workers: 2,
    worker_id_prefixes: Object.freeze(["agent-runtime-safety-", "agent-supervisor-safety-", "codex-safety-"]),
    task_type_patterns: Object.freeze(["SAFETY_*", "RISK_*", "BROKER_*"]),
    responsibilities: Object.freeze([
      "RISK_GATE",
      "BROKER_SAFETY_CHECK",
      "OPERATOR_ESCALATION",
    ]),
    failure_scope: "pool_only",
  }),
  operations: Object.freeze({
    pool_id: "operations",
    label: "Operations recovery",
    lane: "operations",
    scheduler_lane: "operations",
    enabled: true,
    rank: 10,
    max_concurrent_workers: 2,
    worker_id_prefixes: Object.freeze(["agent-runtime-ops-", "agent-runtime-operations-", "agent-supervisor-operations-", "codex-ops-"]),
    task_type_patterns: Object.freeze(["OPS_*", "OPERATIONS_*", "RECOVERY_*", "DLQ_*"]),
    responsibilities: Object.freeze([
      "DLQ_RECOVERY",
      "OPERATOR_RUNBOOK",
      "OBSERVABILITY_REPAIR",
    ]),
    failure_scope: "pool_only",
  }),
  replay: Object.freeze({
    pool_id: "replay",
    label: "Replay and backtest analysis",
    lane: "replay",
    scheduler_lane: "replay",
    enabled: true,
    rank: 20,
    max_concurrent_workers: 6,
    worker_id_prefixes: Object.freeze(["agent-runtime-replay-", "agent-supervisor-replay-", "codex-replay-", "gpt-replay-pool-"]),
    task_type_patterns: Object.freeze(["REPLAY_*", "BACKTEST_*"]),
    responsibilities: Object.freeze([
      "REPLAY_MASTER",
      "REPLAY_MONITOR",
      "REPLAY_RESULT_RECONCILIATION",
    ]),
    failure_scope: "pool_only",
  }),
  validation: Object.freeze({
    pool_id: "validation",
    label: "Validation and robustness",
    lane: "validation",
    scheduler_lane: "validation",
    enabled: true,
    rank: 30,
    max_concurrent_workers: 2,
    worker_id_prefixes: Object.freeze(["agent-runtime-validation-", "agent-supervisor-validation-", "codex-validation-"]),
    task_type_patterns: Object.freeze(["VALIDATION_*", "SIMULATION_*", "ROBUSTNESS_*"]),
    responsibilities: Object.freeze([
      "STRATEGY_VALIDATION",
      "ROBUSTNESS_REPORT",
      "OUT_OF_SAMPLE_CHECK",
    ]),
    failure_scope: "pool_only",
  }),
  research: Object.freeze({
    pool_id: "research",
    label: "Research and strategy discovery",
    lane: "research",
    scheduler_lane: "research",
    enabled: true,
    rank: 40,
    max_concurrent_workers: 1,
    worker_id_prefixes: Object.freeze(["agent-runtime-research-", "agent-supervisor-research-", "codex-research-"]),
    task_type_patterns: Object.freeze(["RESEARCH_*", "EXPERIMENT_*", "STRATEGY_*"]),
    responsibilities: Object.freeze([
      "HYPOTHESIS_DISCOVERY",
      "STRATEGY_CANDIDATE_PROPOSAL",
      "FEATURE_RESEARCH",
    ]),
    failure_scope: "pool_only",
  }),
  default: Object.freeze({
    pool_id: "default",
    label: "Default fallback",
    lane: "default",
    scheduler_lane: "default",
    enabled: true,
    rank: 50,
    max_concurrent_workers: 1,
    worker_id_prefixes: Object.freeze(["agent-runtime-default-"]),
    task_type_patterns: Object.freeze(["*"]),
    responsibilities: Object.freeze(["UNCLASSIFIED_AGENT_TASK"]),
    failure_scope: "pool_only",
  }),
});

export function buildAgentWorkerPoolPolicyV1(input = {}) {
  const overrides = object(input.pools);
  const pools = {};
  for (const [poolId, defaults] of Object.entries(DEFAULT_POOLS)) {
    pools[poolId] = normalizePool({ ...defaults, ...object(overrides[poolId]) }, poolId);
  }
  for (const [poolId, override] of Object.entries(overrides)) {
    if (pools[poolId]) continue;
    pools[poolId] = normalizePool({ ...object(override), pool_id: poolId }, poolId);
  }
  const policy = {
    schema_version: AGENT_WORKER_POOL_SCHEMA_VERSION_V1,
    policy_version: AGENT_WORKER_POOL_POLICY_VERSION_V1,
    default_pool_id: poolId(input.default_pool_id || "default"),
    pools: Object.fromEntries(Object.entries(pools).sort(([left], [right]) => left.localeCompare(right))),
  };
  return { ...policy, policy_hash: `sha256:${canonicalSha256(policy)}` };
}

export function listAgentWorkerPoolsV1(input = {}) {
  const policy = buildAgentWorkerPoolPolicyV1(input.policy || input);
  return {
    schema_version: AGENT_WORKER_POOL_OVERVIEW_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    pools: Object.values(policy.pools).sort((left, right) => compareNumber(left.rank, right.rank) || left.pool_id.localeCompare(right.pool_id)),
    policy_hash: policy.policy_hash,
  };
}

export function resolveAgentWorkerPoolV1(input = {}) {
  const policy = buildAgentWorkerPoolPolicyV1(input.policy);
  const requestedPoolId = nullablePoolId(input.pool_id || input.poolId);
  const workerId = text(input.worker_id || input.workerId);
  const lane = nullableText(input.lane);
  const workerPoolId = inferPoolIdFromWorker(policy, workerId);
  const lanePoolId = inferPoolIdFromLane(policy, lane);
  const inferredPoolId = firstPoolId([requestedPoolId, workerPoolId, lanePoolId, policy.default_pool_id]);
  const pool = policy.pools[inferredPoolId];
  const resolution = {
    schema_version: AGENT_WORKER_POOL_RESOLUTION_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    ok: Boolean(pool),
    pool_id: inferredPoolId,
    requested_pool_id: requestedPoolId,
    inferred_from: poolInferenceSource({ requestedPoolId, workerPoolId, lanePoolId }),
    reason: pool ? "POOL_RESOLVED" : "POOL_NOT_FOUND",
    pool: pool || null,
    allowed_task_type_patterns: pool?.task_type_patterns || [],
    policy_hash: policy.policy_hash,
  };
  return applyPoolResolutionDenial(resolution, { pool, lane, workerId });
}

export function evaluateAgentWorkerPoolTaskAccessV1(input = {}) {
  const task = object(input.task);
  const resolution = resolveAgentWorkerPoolV1({
    policy: input.policy,
    pool_id: input.pool_id || input.poolId,
    worker_id: input.worker_id || input.workerId,
    lane: input.lane || task.lane,
  });
  if (!resolution.ok) return accessResult(false, resolution.reason, resolution, task);
  const pool = resolution.pool;
  const denial = poolAccessDenial(pool, task);
  if (denial) return accessResult(false, denial, resolution, task);
  return accessResult(true, "TASK_ACCESS_ALLOWED", resolution, task);
}

export function taskTypePatternsForAgentWorkerPoolV1(input = {}) {
  const resolution = resolveAgentWorkerPoolV1(input);
  return resolution.ok ? [...resolution.pool.task_type_patterns] : [];
}

export function summarizeAgentWorkerPoolsV1(input = {}) {
  const policy = buildAgentWorkerPoolPolicyV1(input.policy);
  const summaries = new Map();
  for (const pool of Object.values(policy.pools)) {
    summaries.set(pool.pool_id, {
      pool_id: pool.pool_id,
      label: pool.label,
      lane: pool.lane,
      scheduler_lane: pool.scheduler_lane,
      enabled: pool.enabled,
      rank: pool.rank,
      max_concurrent_workers: pool.max_concurrent_workers,
      responsibilities: [...pool.responsibilities],
      task_status: {},
      task_count: 0,
      active_count: 0,
      failed_count: 0,
      metrics: {
        run_count: 0,
        completed_count: 0,
        failed_count: 0,
        total_tokens: 0,
        cost_micros_usd: 0,
      },
    });
  }
  for (const task of array(input.tasks)) {
    const pool = poolForTask(policy, task);
    const summary = summaries.get(pool.pool_id);
    const status = String(task.status || "UNKNOWN").toUpperCase();
    summary.task_count += integer(task.count, 1);
    summary.task_status[status] = (summary.task_status[status] || 0) + integer(task.count, 1);
    if (["CLAIMED", "RUNNING"].includes(status)) summary.active_count += integer(task.count, 1);
    if (["ERROR", "EXPIRED"].includes(status)) summary.failed_count += integer(task.count, 1);
  }
  for (const metric of array(input.metrics)) {
    const pool = poolForTask(policy, metric);
    const summary = summaries.get(pool.pool_id);
    const count = integer(metric.count, 1);
    summary.metrics.run_count += count;
    const outcome = String(metric.outcome || "").toUpperCase();
    if (outcome === "COMPLETED") summary.metrics.completed_count += count;
    if (outcome.startsWith("FAILED") || outcome === "DEAD_LETTERED") summary.metrics.failed_count += count;
    summary.metrics.total_tokens += integer(metric.total_tokens, 0);
    summary.metrics.cost_micros_usd += integer(metric.cost_micros_usd, 0);
  }
  const overview = {
    schema_version: AGENT_WORKER_POOL_OVERVIEW_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    pools: [...summaries.values()].sort((left, right) => compareNumber(left.rank, right.rank) || left.pool_id.localeCompare(right.pool_id)),
    policy_hash: policy.policy_hash,
  };
  return { ...overview, overview_hash: `sha256:${canonicalSha256(overview)}` };
}

function poolForTask(policy, task = {}) {
  const boundPool = boundPoolForTask(policy, task);
  if (boundPool) return boundPool;
  const lanePool = lanePoolForTask(policy, task);
  if (lanePool) return lanePool;
  return typedPoolForTask(policy, task) || defaultPool(policy);
}

function firstPoolId(candidates) {
  return candidates.find((candidate) => Boolean(candidate)) || "default";
}

function poolInferenceSource({ requestedPoolId, workerPoolId, lanePoolId }) {
  if (requestedPoolId) return "explicit";
  if (workerPoolId) return "worker_id";
  if (lanePoolId) return "lane";
  return "default";
}

function applyPoolResolutionDenial(resolution, { pool, lane, workerId }) {
  if (!pool) return resolution;
  if (laneMismatch(pool, lane)) {
    return {
      ...resolution,
      ok: false,
      reason: "POOL_LANE_MISMATCH",
      expected_lane: pool.lane,
      actual_lane: normalizedLane(lane),
    };
  }
  if (workerMismatch(pool, workerId)) {
    return {
      ...resolution,
      ok: false,
      reason: "WORKER_NOT_IN_POOL",
      worker_id: workerId,
    };
  }
  return resolution;
}

function laneMismatch(pool, lane) {
  if (!lane) return false;
  return normalizedLane(pool.lane) !== normalizedLane(lane);
}

function workerMismatch(pool, workerId) {
  if (!workerId) return false;
  return !workerMatchesPool(workerId, pool);
}

function poolAccessDenial(pool, task) {
  if (pool.enabled === false) return "POOL_DISABLED";
  if (boundToOtherPool(pool, task)) return "TASK_BOUND_TO_OTHER_POOL";
  if (normalizedLane(task.lane) !== normalizedLane(pool.lane)) return "TASK_LANE_NOT_ALLOWED";
  if (!matchesAnyPattern(task.task_type || task.taskType, pool.task_type_patterns)) return "TASK_TYPE_NOT_ALLOWED";
  return null;
}

function boundToOtherPool(pool, task) {
  const taskBoundPoolId = taskBoundPool(task);
  return Boolean(taskBoundPoolId) && taskBoundPoolId !== pool.pool_id;
}

function taskBoundPool(task) {
  const metadata = object(task.metadata);
  const payload = object(task.payload);
  return nullablePoolId(task.pool_id || task.poolId || metadata.pool_id || metadata.poolId || payload.pool_id || payload.poolId);
}

function boundPoolForTask(policy, task) {
  const boundPoolId = taskBoundPool(task);
  return boundPoolId ? policy.pools[boundPoolId] : null;
}

function lanePoolForTask(policy, task) {
  const lanePoolId = inferPoolIdFromLane(policy, task.lane);
  if (!lanePoolId) return null;
  const pool = policy.pools[lanePoolId];
  return matchesAnyPattern(task.task_type || task.taskType, pool.task_type_patterns) ? pool : null;
}

function typedPoolForTask(policy, task) {
  return Object.values(policy.pools)
    .sort((left, right) => compareNumber(left.rank, right.rank))
    .find((pool) => matchesAnyPattern(task.task_type || task.taskType, pool.task_type_patterns)) || null;
}

function defaultPool(policy) {
  return policy.pools[policy.default_pool_id] || policy.pools.default;
}

function accessResult(allowed, reason, resolution, task) {
  const result = {
    schema_version: AGENT_WORKER_POOL_RESOLUTION_SCHEMA_VERSION_V1,
    policy_version: resolution.policy_version,
    ok: allowed,
    allowed,
    reason,
    pool_id: resolution.pool_id,
    lane: normalizedLane(task.lane),
    task_type: text(task.task_type || task.taskType),
    allowed_task_type_patterns: resolution.allowed_task_type_patterns || [],
    policy_hash: resolution.policy_hash,
  };
  return { ...result, access_hash: `sha256:${canonicalSha256(result)}` };
}

function inferPoolIdFromWorker(policy, workerId) {
  if (!workerId) return null;
  return Object.values(policy.pools)
    .sort((left, right) => compareNumber(left.rank, right.rank))
    .find((pool) => workerMatchesPool(workerId, pool))?.pool_id || null;
}

function inferPoolIdFromLane(policy, lane) {
  if (!lane) return null;
  const normalized = normalizedLane(lane);
  return Object.values(policy.pools)
    .sort((left, right) => compareNumber(left.rank, right.rank))
    .find((pool) => normalizedLane(pool.lane) === normalized)?.pool_id || null;
}

function workerMatchesPool(workerId, pool) {
  const prefixes = array(pool.worker_id_prefixes);
  if (!prefixes.length) return true;
  return prefixes.some((prefix) => String(workerId).startsWith(String(prefix)));
}

function matchesAnyPattern(value, patterns) {
  const textValue = text(value).toUpperCase();
  return array(patterns).some((pattern) => matchesPattern(textValue, String(pattern || "").toUpperCase()));
}

function matchesPattern(value, pattern) {
  if (!pattern || pattern === "*") return true;
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function normalizePool(input, fallbackPoolId) {
  const pool = object(input);
  const id = poolId(pool.pool_id || fallbackPoolId);
  return {
    pool_id: id,
    label: nullableText(pool.label) || id,
    lane: normalizedLane(pool.lane || id),
    scheduler_lane: normalizedLane(pool.scheduler_lane || pool.lane || id),
    enabled: pool.enabled !== false,
    rank: integer(pool.rank, 50),
    max_concurrent_workers: Math.max(0, integer(pool.max_concurrent_workers, 1)),
    worker_id_prefixes: stringArray(pool.worker_id_prefixes),
    task_type_patterns: stringArray(pool.task_type_patterns, ["*"]).map((pattern) => pattern.toUpperCase()),
    responsibilities: stringArray(pool.responsibilities),
    failure_scope: nullableText(pool.failure_scope) || "pool_only",
    metadata: object(pool.metadata),
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value, fallback = []) {
  const items = Array.isArray(value) ? value : fallback;
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function poolId(value) {
  return String(value || "default").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_") || "default";
}

function nullablePoolId(value) {
  const normalized = poolId(value);
  return normalized === "default" && !String(value || "").trim() ? null : normalized;
}

function normalizedLane(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function compareNumber(left, right) {
  return Number(left) - Number(right);
}
