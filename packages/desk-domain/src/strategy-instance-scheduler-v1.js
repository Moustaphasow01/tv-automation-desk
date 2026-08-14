import { canonicalSha256 } from "./execution-scope.js";

export const STRATEGY_INSTANCE_SCHEDULER_SCHEMA_VERSION_V1 = "strategy_instance_scheduler_plan_v1";
export const STRATEGY_INSTANCE_SCHEDULER_STATUSES_V1 = Object.freeze([
  "DUE",
  "LATE",
  "WAITING",
  "PAUSED",
  "DISABLED",
  "NOT_RUNNABLE",
]);

const RUNNABLE_STATES = new Set(["RUNNING", "STARTING"]);
const MODE_PRIORITY = Object.freeze({ LIVE: 0, PAPER: 1, SHADOW: 2 });

export function evaluateStrategyInstanceScheduleV1({
  instance = {},
  now_utc = new Date().toISOString(),
  last_scheduled_at_utc = null,
  default_cadence_seconds = 60,
  default_max_lag_seconds = null,
} = {}) {
  const nowMs = epochMs(now_utc);
  const normalized = normalizeInstance(instance);
  const schedule = schedulerConfig(instance.metadata?.scheduler, default_cadence_seconds, default_max_lag_seconds);
  const base = baseEvaluation(normalized, schedule, now_utc);
  if (base) return base;
  const scheduledFor = nextScheduledAt({ instance: normalized, schedule, last_scheduled_at_utc });
  if (!scheduledFor || nowMs === null) return evaluation(normalized, "NOT_RUNNABLE", "SCHEDULE_TIME_INVALID", { now_utc });
  const latenessSeconds = Math.floor((nowMs - epochMs(scheduledFor)) / 1000);
  if (latenessSeconds < 0) return evaluation(normalized, "WAITING", "NOT_DUE_YET", { scheduled_for_utc: scheduledFor });
  const status = latenessSeconds > schedule.max_lag_seconds ? "LATE" : "DUE";
  return evaluation(normalized, status, status === "LATE" ? "SCHEDULE_LATE" : "SCHEDULE_DUE", {
    scheduled_for_utc: scheduledFor,
    cadence_seconds: schedule.cadence_seconds,
    lateness_seconds: Math.max(0, latenessSeconds),
    scheduler_run_key: schedulerRunKey(normalized.strategy_instance_id, scheduledFor),
  });
}

export function planStrategyInstanceSchedulerCycleV1({
  instances = [],
  now_utc = new Date().toISOString(),
  last_scheduled_at_by_instance = {},
  default_cadence_seconds = 60,
  default_max_lag_seconds = null,
} = {}) {
  const evaluations = instances.map((instance) => evaluateStrategyInstanceScheduleV1({
    instance,
    now_utc,
    last_scheduled_at_utc: last_scheduled_at_by_instance[instance.strategy_instance_id || instance.id] || null,
    default_cadence_seconds,
    default_max_lag_seconds,
  }));
  const due = evaluations.filter((item) => item.should_schedule).sort(compareDueEvaluations);
  const plan = {
    schema_version: STRATEGY_INSTANCE_SCHEDULER_SCHEMA_VERSION_V1,
    generated_at_utc: iso(now_utc),
    summary: summarize(evaluations),
    due,
    waiting: evaluations.filter((item) => item.status === "WAITING"),
    suppressed: evaluations.filter((item) => !item.should_schedule && item.status !== "WAITING"),
  };
  return { ...plan, scheduler_plan_hash: `sha256:${canonicalSha256(plan)}` };
}

function baseEvaluation(instance, schedule, nowUtc) {
  if (!schedule.enabled) return evaluation(instance, "DISABLED", "SCHEDULER_DISABLED", { now_utc: nowUtc });
  if (instance.runtime_state === "PAUSED") return evaluation(instance, "PAUSED", "INSTANCE_PAUSED", { now_utc: nowUtc });
  if (!RUNNABLE_STATES.has(instance.runtime_state)) {
    return evaluation(instance, "NOT_RUNNABLE", "RUNTIME_STATE_NOT_RUNNABLE", { now_utc: nowUtc });
  }
  if (!instance.strategy_instance_id || !instance.strategy_version_id) {
    return evaluation(instance, "NOT_RUNNABLE", "STRATEGY_INSTANCE_IDENTITY_MISSING", { now_utc: nowUtc });
  }
  return null;
}

function nextScheduledAt({ instance, schedule, last_scheduled_at_utc }) {
  const configured = isoOrNull(schedule.next_due_at_utc);
  const last = isoOrNull(last_scheduled_at_utc || schedule.last_scheduled_at_utc);
  const anchor = configured || last || isoOrNull(instance.started_at || instance.last_heartbeat_at || instance.created_at);
  if (!anchor) return null;
  if (last && epochMs(last) >= epochMs(anchor)) return addSeconds(last, schedule.cadence_seconds);
  return anchor;
}

function schedulerConfig(raw = {}, defaultCadenceSeconds, defaultMaxLagSeconds) {
  const cadence = boundedInteger(raw.cadence_seconds ?? raw.cadenceSeconds, defaultCadenceSeconds, 1, 86_400);
  return {
    enabled: raw.enabled !== false,
    cadence_seconds: cadence,
    max_lag_seconds: boundedInteger(raw.max_lag_seconds ?? raw.maxLagSeconds, defaultMaxLagSeconds ?? cadence * 2, 0, 86_400),
    next_due_at_utc: raw.next_due_at_utc || raw.nextDueAtUtc || null,
    last_scheduled_at_utc: raw.last_scheduled_at_utc || raw.lastScheduledAtUtc || null,
  };
}

function evaluation(instance, status, reason, extra = {}) {
  return {
    strategy_instance_id: instance.strategy_instance_id || null,
    strategy_version_id: instance.strategy_version_id || null,
    runtime_state: instance.runtime_state || null,
    execution_mode: instance.execution_mode || null,
    account_scope: instance.account_scope || null,
    status,
    reason,
    should_schedule: status === "DUE" || status === "LATE",
    priority: MODE_PRIORITY[instance.execution_mode] ?? 9,
    ...extra,
  };
}

function summarize(evaluations) {
  return {
    total: evaluations.length,
    due: evaluations.filter((item) => item.status === "DUE").length,
    late: evaluations.filter((item) => item.status === "LATE").length,
    waiting: evaluations.filter((item) => item.status === "WAITING").length,
    paused: evaluations.filter((item) => item.status === "PAUSED").length,
    suppressed: evaluations.filter((item) => !item.should_schedule && item.status !== "WAITING").length,
  };
}

function compareDueEvaluations(left, right) {
  return left.priority - right.priority
    || Date.parse(left.scheduled_for_utc) - Date.parse(right.scheduled_for_utc)
    || left.strategy_instance_id.localeCompare(right.strategy_instance_id);
}

function normalizeInstance(instance = {}) {
  return {
    strategy_instance_id: instance.strategy_instance_id || instance.id || null,
    strategy_version_id: instance.strategy_version_id || null,
    runtime_state: String(instance.runtime_state || "CREATED").toUpperCase(),
    execution_mode: String(instance.execution_mode || "SHADOW").toUpperCase(),
    account_scope: instance.account_scope || null,
    started_at: instance.started_at || null,
    last_heartbeat_at: instance.last_heartbeat_at || null,
    created_at: instance.created_at || null,
  };
}

function schedulerRunKey(strategyInstanceId, scheduledForUtc) {
  return `strategy_scheduler:${strategyInstanceId}:${scheduledForUtc.replace(/[:.]/g, "_")}`;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(Math.trunc(parsed), maximum)) : fallback;
}

function addSeconds(value, seconds) {
  return new Date(epochMs(value) + seconds * 1000).toISOString();
}

function iso(value) {
  return new Date(value).toISOString();
}

function isoOrNull(value) {
  const parsed = epochMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function epochMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}
