import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_RUNTIME_SCHEDULER_POLICY_VERSION_V1 = "1.0.0";
export const AGENT_RUNTIME_SCHEDULER_SCHEMA_VERSION_V1 = "agent_runtime_scheduler_policy_v1";
export const AGENT_RUNTIME_SCHEDULER_PLAN_SCHEMA_VERSION_V1 = "agent_runtime_scheduler_plan_v1";
export const AGENT_RUNTIME_SCHEDULER_LANES_V1 = Object.freeze(["live", "safety", "operations", "replay", "validation", "research", "default"]);

const CLAIMABLE_STATUSES = new Set(["PENDING", "READY"]);
const RUNNING_STATUSES = new Set(["CLAIMED", "RUNNING"]);

const DEFAULT_LANE_QUOTAS = Object.freeze({
  live: { rank: 0, max_selected_per_window: 4, max_running: 8 },
  safety: { rank: 5, max_selected_per_window: 2, max_running: 2 },
  operations: { rank: 10, max_selected_per_window: 2, max_running: 2 },
  replay: { rank: 20, max_selected_per_window: 2, max_running: 2 },
  validation: { rank: 30, max_selected_per_window: 1, max_running: 1 },
  research: { rank: 40, max_selected_per_window: 1, max_running: 1 },
  default: { rank: 50, max_selected_per_window: 1, max_running: 1 },
});

export function buildAgentRuntimeSchedulerPolicyV1(input = {}) {
  const lanes = mergeLaneQuotas(object(input.lane_quotas));
  return {
    schema_version: AGENT_RUNTIME_SCHEDULER_SCHEMA_VERSION_V1,
    policy_version: AGENT_RUNTIME_SCHEDULER_POLICY_VERSION_V1,
    window_seconds: integer(input.window_seconds, 900, 60, 86_400),
    max_selected_tasks: integer(input.max_selected_tasks, 1, 1, 100),
    stale_promotion_after_seconds: integer(input.stale_promotion_after_seconds, 3600, 60, 86_400),
    stale_rank_boost: integer(input.stale_rank_boost, 30, 0, 100),
    lane_quotas: normalizeLaneQuotas(lanes),
  };
}

export function planAgentRuntimeScheduleV1(input = {}) {
  const nowUtc = timestamp(input.now_utc);
  const policy = buildAgentRuntimeSchedulerPolicyV1(input.policy);
  const candidates = normalizeTasks(input.tasks, nowUtc, policy);
  const usage = normalizeUsage(input.usage);
  const liveReady = candidates.some((task) => task.eligible && task.lane === "live" && !quotaReason(task, usage, policy));
  const ordered = [...candidates].sort((left, right) => compareCandidates(left, right, { liveReady, policy }));
  const decision = selectCandidates(ordered, usage, policy);
  const plan = {
    schema_version: AGENT_RUNTIME_SCHEDULER_PLAN_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    now_utc: nowUtc,
    selected_tasks: decision.selected,
    deferred_tasks: decision.deferred,
    rejected_tasks: decision.rejected,
    quota_state: projectQuotaState(decision.usage, policy),
    summary: {
      selected_count: decision.selected.length,
      deferred_count: decision.deferred.length,
      rejected_count: decision.rejected.length,
      live_ready: liveReady,
    },
  };
  return { ...plan, plan_hash: `sha256:${canonicalSha256(plan)}` };
}

export function evaluateAgentRuntimeLaneGateV1(input = {}) {
  const lane = normalizedLane(input.lane);
  const plan = object(input.plan);
  const selected = Array.isArray(plan.selected_tasks) ? plan.selected_tasks : [];
  const selectedLane = selected.find((task) => normalizedLane(task.lane) === lane);
  return {
    ok: true,
    lane,
    allowed: Boolean(selectedLane) || selected.length === 0,
    reason: selectedLane || selected.length === 0 ? "LANE_SELECTED_OR_IDLE" : "HIGHER_PRIORITY_LANE_SELECTED",
    selected_task_id: selectedLane?.task_id || null,
    blocking_lanes: [...new Set(selected.map((task) => normalizedLane(task.lane)).filter((value) => value !== lane))],
    plan_hash: typeof plan.plan_hash === "string" ? plan.plan_hash : null,
  };
}

function selectCandidates(ordered, usage, policy) {
  const selected = [];
  const deferred = [];
  const rejected = [];
  const mutableUsage = cloneUsage(usage);
  for (const task of ordered) {
    const normalized = projectTaskDecision(task);
    if (!task.eligible) {
      rejected.push({ ...normalized, reason: task.ineligible_reason });
      continue;
    }
    if (selected.length >= policy.max_selected_tasks) {
      deferred.push({ ...normalized, reason: "GLOBAL_SELECTED_QUOTA_EXCEEDED" });
      continue;
    }
    const reason = quotaReason(task, mutableUsage, policy);
    if (reason) {
      deferred.push({ ...normalized, reason });
      continue;
    }
    selected.push({ ...normalized, reason: "SELECTED" });
    consumeQuota(task, mutableUsage);
  }
  return { selected, deferred, rejected, usage: mutableUsage };
}

function normalizeTasks(tasks, nowUtc, policy) {
  return array(tasks).map((task) => {
    const createdAt = timestamp(task.created_at_utc || task.created_at, nowUtc);
    const notBefore = timestamp(task.not_before_utc, null);
    const status = String(task.status || "").toUpperCase();
    const eligible = isEligible({ status, notBefore, task, nowUtc });
    return {
      task_id: text(task.task_id || task.id),
      task_key: text(task.task_key),
      task_type: text(task.task_type || task.type),
      lane: normalizedLane(task.lane),
      status,
      priority: integer(task.priority, 100, 0, 9999),
      created_at_utc: createdAt,
      not_before_utc: notBefore,
      estimated_tokens: computeBudgetInteger(task, "estimated_tokens"),
      estimated_cost_micros_usd: computeBudgetInteger(task, "estimated_cost_micros_usd"),
      eligible,
      ineligible_reason: eligible ? null : ineligibleReason({ status, notBefore, task, nowUtc }),
      age_seconds: Math.max(0, Math.floor((Date.parse(nowUtc) - Date.parse(createdAt)) / 1000)),
      lane_rank: laneQuota(policy, task.lane).rank,
    };
  });
}

function compareCandidates(left, right, context) {
  return compareNumber(effectiveRank(left, context), effectiveRank(right, context))
    || compareNumber(left.priority, right.priority)
    || String(left.not_before_utc || left.created_at_utc).localeCompare(String(right.not_before_utc || right.created_at_utc))
    || String(left.task_id || left.task_key).localeCompare(String(right.task_id || right.task_key));
}

function effectiveRank(task, { liveReady, policy }) {
  if (task.lane_rank === 0) return 0;
  if (liveReady) return task.lane_rank;
  if (task.age_seconds < policy.stale_promotion_after_seconds) return task.lane_rank;
  return Math.max(1, task.lane_rank - policy.stale_rank_boost);
}

function quotaReason(task, usage, policy) {
  const quota = laneQuota(policy, task.lane);
  const state = laneUsage(usage, task.lane);
  if (state.running_count >= quota.max_running) return "LANE_RUNNING_QUOTA_EXCEEDED";
  if (state.selected_count >= quota.max_selected_per_window) return "LANE_SELECTED_QUOTA_EXCEEDED";
  if (exceeds(task.estimated_tokens, state.total_tokens, quota.max_tokens_per_window)) return "LANE_TOKEN_QUOTA_EXCEEDED";
  if (exceeds(task.estimated_cost_micros_usd, state.cost_micros_usd, quota.max_cost_micros_per_window)) {
    return "LANE_COST_QUOTA_EXCEEDED";
  }
  return null;
}

function laneUsage(usage, lane) {
  return usage.lanes[normalizedLane(lane)] || {
    running_count: 0,
    selected_count: 0,
    total_tokens: 0,
    cost_micros_usd: 0,
  };
}

function normalizeLaneQuotas(lanes) {
  return Object.fromEntries(Object.entries(lanes).map(([lane, quota]) => [
    normalizedLane(lane),
    {
      rank: integer(quota.rank, DEFAULT_LANE_QUOTAS.default.rank, 0, 999),
      max_selected_per_window: integer(quota.max_selected_per_window, 1, 0, 100),
      max_running: integer(quota.max_running, 1, 0, 100),
      max_tokens_per_window: nullableInteger(quota.max_tokens_per_window),
      max_cost_micros_per_window: nullableInteger(quota.max_cost_micros_per_window),
    },
  ]));
}

function mergeLaneQuotas(overrides) {
  const lanes = { ...DEFAULT_LANE_QUOTAS };
  for (const [lane, quota] of Object.entries(overrides)) {
    const normalized = normalizedLane(lane);
    lanes[normalized] = { ...(lanes[normalized] || DEFAULT_LANE_QUOTAS.default), ...object(quota) };
  }
  return lanes;
}

function normalizeUsage(usageInput = {}) {
  const usage = { lanes: {} };
  for (const item of array(usageInput.lanes || usageInput)) {
    const lane = normalizedLane(item.lane);
    usage.lanes[lane] = {
      running_count: integer(item.running_count, 0, 0, 1000),
      selected_count: integer(item.selected_count, 0, 0, 1000),
      total_tokens: integer(item.total_tokens, 0, 0, Number.MAX_SAFE_INTEGER),
      cost_micros_usd: integer(item.cost_micros_usd, 0, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  return usage;
}

function cloneUsage(usage) {
  return { lanes: Object.fromEntries(Object.entries(usage.lanes).map(([lane, state]) => [lane, { ...state }])) };
}

function consumeQuota(task, usage) {
  const state = usage.lanes[task.lane] || { running_count: 0, selected_count: 0, total_tokens: 0, cost_micros_usd: 0 };
  usage.lanes[task.lane] = {
    ...state,
    selected_count: state.selected_count + 1,
    total_tokens: state.total_tokens + task.estimated_tokens,
    cost_micros_usd: state.cost_micros_usd + task.estimated_cost_micros_usd,
  };
}

function projectQuotaState(usage, policy) {
  return Object.fromEntries(Object.entries(policy.lane_quotas).map(([lane, quota]) => [lane, {
    ...quota,
    ...(usage.lanes[lane] || { running_count: 0, selected_count: 0, total_tokens: 0, cost_micros_usd: 0 }),
  }]));
}

function projectTaskDecision(task) {
  return {
    task_id: task.task_id,
    task_key: task.task_key,
    task_type: task.task_type,
    lane: task.lane,
    status: task.status,
    priority: task.priority,
    created_at_utc: task.created_at_utc,
    not_before_utc: task.not_before_utc,
  };
}

function isEligible({ status, notBefore, task, nowUtc }) {
  if (CLAIMABLE_STATUSES.has(status)) return !notBefore || Date.parse(notBefore) <= Date.parse(nowUtc);
  return RUNNING_STATUSES.has(status) && Date.parse(task.lease_expires_at_utc || "") <= Date.parse(nowUtc);
}

function ineligibleReason({ status, notBefore, task, nowUtc }) {
  if (CLAIMABLE_STATUSES.has(status) && notBefore && Date.parse(notBefore) > Date.parse(nowUtc)) return "TASK_NOT_BEFORE_IN_FUTURE";
  if (RUNNING_STATUSES.has(status) && Date.parse(task.lease_expires_at_utc || "") > Date.parse(nowUtc)) return "TASK_ALREADY_LEASED";
  return "TASK_STATUS_NOT_CLAIMABLE";
}

function laneQuota(policy, lane) {
  return policy.lane_quotas[normalizedLane(lane)] || policy.lane_quotas.default;
}

function computeBudgetInteger(task, field) {
  return integer(object(task.compute_budget)[field] ?? object(task.payload?.compute_budget)[field] ?? object(task.metadata?.compute_budget)[field], 0, 0, Number.MAX_SAFE_INTEGER);
}

function exceeds(nextValue, currentValue, maximum) {
  return Number.isInteger(maximum) && currentValue + nextValue > maximum;
}

function compareNumber(left, right) {
  return left === right ? 0 : left - right;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  return integer(value, 0, 0, Number.MAX_SAFE_INTEGER);
}

function timestamp(value, fallback = new Date(0).toISOString()) {
  const textValue = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const millis = Date.parse(textValue || "");
  return Number.isFinite(millis) ? new Date(millis).toISOString() : fallback;
}

function normalizedLane(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
