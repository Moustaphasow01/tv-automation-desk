import {
  buildAgentRuntimeSchedulerPolicyV1,
  evaluateAgentRuntimeLaneGateV1,
  planAgentRuntimeScheduleV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { toIso } from "./agent-runtime-postgres-common.js";

const TASK_CANDIDATE_SQL = `
  SELECT agent_task_id, task_key, task_type, lane, status::text, priority,
         payload, metadata, not_before_utc, lease_expires_at_utc, created_at_utc, updated_at_utc
   FROM agent_tasks
   WHERE status IN ('PENDING', 'READY', 'CLAIMED', 'RUNNING')
     AND ($2::text IS NULL OR task_key LIKE $2 || '%')
   ORDER BY priority ASC, created_at_utc ASC
   LIMIT $1
`;

const METRICS_WINDOW_SQL = `
  SELECT lane,
         coalesce(sum(total_tokens), 0)::bigint AS total_tokens,
         coalesce(sum(cost_micros_usd), 0)::bigint AS cost_micros_usd
    FROM agent_task_run_metrics
   WHERE finished_at_utc >= $1::timestamptz
   GROUP BY lane
`;

export function createAgentRuntimeSchedulerService({ persistence, clock = new SystemClock() } = {}) {
  if (!persistence?.pool) return new DisabledAgentRuntimeSchedulerService();
  return new AgentRuntimeSchedulerService({ pool: persistence.pool, clock });
}

export class AgentRuntimeSchedulerService {
  constructor({ pool, clock = new SystemClock() } = {}) {
    if (!pool?.query) throw new Error("AGENT_RUNTIME_SCHEDULER_POOL_REQUIRED");
    this.pool = pool;
    this.clock = clock;
  }

  async previewSchedule(args = {}) {
    const nowUtc = args.now_utc || this.clock.now().utc;
    const policy = buildAgentRuntimeSchedulerPolicyV1(args.policy);
    const windowStartUtc = windowStart(nowUtc, policy);
    const [taskRows, metricRows] = await Promise.all([
      rows(this.pool, TASK_CANDIDATE_SQL, [boundedLimit(args.limit, 200, 1000), nullableText(args.task_key_prefix)]),
      rows(this.pool, METRICS_WINDOW_SQL, [windowStartUtc]),
    ]);
    const tasks = taskRows.map(projectSchedulerTask);
    const usage = mergeUsage(metricRows, runningUsage(tasks, nowUtc));
    const plan = planAgentRuntimeScheduleV1({ now_utc: nowUtc, policy, usage, tasks });
    return {
      ok: true,
      status: "PLANNED",
      generated_at_utc: nowUtc,
      window_start_utc: windowStartUtc,
      policy,
      plan,
    };
  }

  async evaluateLaneClaimGate(args = {}) {
    const preview = await this.previewSchedule(args);
    const gate = evaluateAgentRuntimeLaneGateV1({ lane: args.lane, plan: preview.plan });
    return {
      ...gate,
      status: gate.allowed ? "ALLOWED" : "DEFERRED",
      generated_at_utc: preview.generated_at_utc,
      selected_tasks: preview.plan.selected_tasks,
    };
  }
}

export class DisabledAgentRuntimeSchedulerService {
  unavailable() {
    throw Object.assign(new Error("Agent runtime scheduler is unavailable without PostgreSQL."), {
      code: "AGENT_RUNTIME_SCHEDULER_UNAVAILABLE",
      retryable: false,
    });
  }
  async previewSchedule() { this.unavailable(); }
  async evaluateLaneClaimGate() { this.unavailable(); }
}

function projectSchedulerTask(row = {}) {
  return {
    task_id: row.agent_task_id,
    task_key: row.task_key,
    task_type: row.task_type,
    lane: row.lane,
    status: row.status,
    priority: row.priority,
    payload: row.payload || {},
    metadata: row.metadata || {},
    not_before_utc: toIso(row.not_before_utc),
    lease_expires_at_utc: toIso(row.lease_expires_at_utc),
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  };
}

function mergeUsage(metricRows, runningRows) {
  const lanes = new Map();
  for (const row of metricRows) lanes.set(normalizedLane(row.lane), metricUsage(row));
  for (const row of runningRows) {
    const lane = normalizedLane(row.lane);
    lanes.set(lane, { ...metricUsage(lanes.get(lane)), running_count: row.running_count });
  }
  return { lanes: [...lanes.values()] };
}

function runningUsage(tasks, nowUtc) {
  const counts = new Map();
  for (const task of tasks) {
    if (!isActiveLease(task, nowUtc)) continue;
    const lane = normalizedLane(task.lane);
    counts.set(lane, (counts.get(lane) || 0) + 1);
  }
  return [...counts.entries()].map(([lane, running_count]) => ({ lane, running_count }));
}

function isActiveLease(task, nowUtc) {
  const status = String(task.status || "").toUpperCase();
  if (!["CLAIMED", "RUNNING"].includes(status)) return false;
  return Date.parse(task.lease_expires_at_utc || "") > Date.parse(nowUtc);
}

function metricUsage(row = {}) {
  return {
    lane: normalizedLane(row.lane),
    running_count: integer(row.running_count, 0),
    total_tokens: integer(row.total_tokens, 0),
    cost_micros_usd: integer(row.cost_micros_usd, 0),
  };
}

function windowStart(nowUtc, policy) {
  const millis = Date.parse(nowUtc) - integer(policy.window_seconds, 900) * 1000;
  return new Date(millis).toISOString();
}

function boundedLimit(value, fallback, maximum) {
  const parsed = integer(value, fallback);
  return Math.max(1, Math.min(maximum, parsed));
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizedLane(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function rows(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows || [];
}
