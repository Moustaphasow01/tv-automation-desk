import {
  authorizeAgentRuntimeAdminActionV1,
  summarizeAgentWorkerPoolsV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { PostgresAgentRuntimeRepository } from "./agent-runtime-postgres-repository.js";

const TASK_SELECT = `
  SELECT t.*, m.mission_key, m.mission_type, m.status AS mission_status,
         r.outcome AS last_run_outcome, r.total_latency_ms, r.total_tokens, r.cost_micros_usd
    FROM agent_tasks t
    JOIN agent_missions m ON m.agent_mission_id = t.agent_mission_id
    LEFT JOIN agent_task_run_metrics r ON r.agent_task_id = t.agent_task_id`;

export function createAgentRuntimeAdminService({ persistence, clock = new SystemClock() } = {}) {
  if (!persistence?.pool) return new DisabledAgentRuntimeAdminService();
  const repository = new PostgresAgentRuntimeRepository({ pool: persistence.pool, clock });
  return new AgentRuntimeAdminService({ pool: persistence.pool, repository, clock });
}

export class AgentRuntimeAdminService {
  constructor({ pool, repository, clock = new SystemClock() } = {}) {
    if (!pool?.query) throw adminError("AGENT_ADMIN_POOL_REQUIRED", "PostgreSQL pool is required.");
    if (!repository) throw adminError("AGENT_ADMIN_REPOSITORY_REQUIRED", "Agent runtime repository is required.");
    this.pool = pool;
    this.repository = repository;
    this.clock = clock;
  }

  async getOverview(args = {}) {
    authorize("READ_OVERVIEW", args);
    const limit = boundedLimit(args.limit, 20, 100);
    const [taskStatus, deadLetterStatus, recentTasks, recentDeadLetters, recentMetrics] = await Promise.all([
      rows(this.pool, "SELECT lane, status::text, count(*)::int AS count FROM agent_tasks GROUP BY lane, status ORDER BY lane, status"),
      rows(this.pool, "SELECT status::text, count(*)::int AS count FROM agent_task_dead_letters GROUP BY status ORDER BY status"),
      this.listTasks({ lane: args.lane, limit }),
      this.listDeadLetters({ status: "OPEN", lane: args.lane, limit }),
      this.listMetrics({ lane: args.lane, limit }),
    ]);
    return {
      ok: true,
      schema: "agent_runtime_admin_overview_v1",
      generated_at_utc: this.clock.now().utc,
      summary: { task_status: taskStatus, dead_letter_status: deadLetterStatus },
      recent_tasks: recentTasks.items,
      open_dead_letters: recentDeadLetters.items,
      recent_metrics: recentMetrics.items,
    };
  }

  async listTasks(args = {}) {
    authorize("LIST_TASKS", args);
    const result = await this.pool.query(
      `${TASK_SELECT}
        WHERE ($1::text IS NULL OR t.lane = $1)
          AND ($2::text IS NULL OR t.status::text = $2)
          AND ($3::uuid IS NULL OR t.agent_mission_id = $3)
        ORDER BY t.priority ASC, t.created_at_utc DESC
        LIMIT $4`,
      [
        nullableText(args.lane),
        nullableUpper(args.status),
        nullableText(args.mission_id || args.missionId),
        boundedLimit(args.limit, 50, 500),
      ],
    );
    return { ok: true, count: result.rows.length, items: result.rows.map(projectTask) };
  }

  async getTask(args = {}) {
    authorize("READ_TASK", args);
    const result = await this.pool.query(`${TASK_SELECT} WHERE t.agent_task_id = $1`, [args.task_id || args.taskId]);
    if (!result.rows[0]) throw adminError("AGENT_ADMIN_TASK_NOT_FOUND", "Agent task not found.");
    return { ok: true, task: projectTask(result.rows[0], { includePayload: args.include_payload === true }) };
  }

  async listDeadLetters(args = {}) {
    authorize("LIST_DEAD_LETTERS", args);
    const result = await this.pool.query(
      `SELECT dlq.*, t.task_key, t.task_type, t.lane, t.status AS task_status
         FROM agent_task_dead_letters dlq
         JOIN agent_tasks t ON t.agent_task_id = dlq.agent_task_id
        WHERE ($1::text IS NULL OR dlq.status::text = $1)
          AND ($2::text IS NULL OR t.lane = $2)
        ORDER BY dlq.created_at_utc DESC
        LIMIT $3`,
      [nullableUpper(args.status), nullableText(args.lane), boundedLimit(args.limit, 50, 500)],
    );
    return { ok: true, count: result.rows.length, items: result.rows.map(projectDeadLetter) };
  }

  async listMetrics(args = {}) {
    authorize("LIST_METRICS", args);
    const result = await this.pool.query(
      `SELECT *
         FROM agent_task_run_metrics
        WHERE ($1::text IS NULL OR lane = $1)
          AND ($2::text IS NULL OR outcome = $2)
          AND ($3::uuid IS NULL OR agent_task_id = $3)
          AND ($4::uuid IS NULL OR agent_mission_id = $4)
        ORDER BY finished_at_utc DESC
        LIMIT $5`,
      [
        nullableText(args.lane),
        nullableUpper(args.outcome),
        nullableText(args.task_id || args.taskId),
        nullableText(args.mission_id || args.missionId),
        boundedLimit(args.limit, 50, 500),
      ],
    );
    return { ok: true, count: result.rows.length, items: result.rows.map(projectMetric) };
  }

  async getPoolOverview(args = {}) {
    authorize("LIST_POOLS", args);
    const metricsWindowMinutes = boundedInteger(args.metrics_window_minutes ?? args.metricsWindowMinutes, 60, 5, 1440);
    const [tasks, metrics] = await Promise.all([
      rows(this.pool, `
        SELECT lane, task_type, status::text, count(*)::int AS count
          FROM agent_tasks
         WHERE ($1::text IS NULL OR lane = $1)
         GROUP BY lane, task_type, status
         ORDER BY lane, task_type, status
      `, [nullableText(args.lane)]),
      rows(this.pool, `
        SELECT lane, task_type, outcome, count(*)::int AS count,
               coalesce(sum(total_tokens), 0)::bigint AS total_tokens,
               coalesce(sum(cost_micros_usd), 0)::bigint AS cost_micros_usd
          FROM agent_task_run_metrics
         WHERE finished_at_utc >= $2::timestamptz
           AND ($1::text IS NULL OR lane = $1)
         GROUP BY lane, task_type, outcome
         ORDER BY lane, task_type, outcome
      `, [nullableText(args.lane), minutesAgoIso(this.clock.now().utc, metricsWindowMinutes)]),
    ]);
    const overview = summarizeAgentWorkerPoolsV1({
      policy: args.policy || {},
      tasks: tasks.map(projectPoolTaskAggregate),
      metrics: metrics.map(projectPoolMetricAggregate),
    });
    return {
      ok: true,
      generated_at_utc: this.clock.now().utc,
      metrics_window_minutes: metricsWindowMinutes,
      ...overview,
    };
  }

  async requeueDeadLetter(args = {}) {
    const authorization = authorize("REQUEUE_DEAD_LETTER", args);
    const result = await this.repository.requeueDeadLetter({
      deadLetterId: authorization.command.dead_letter_id,
      operatorId: authorization.command.operator_id,
      reason: authorization.command.reason,
      idempotencyKey: authorization.command.idempotency_key,
      nowUtc: this.clock.now().utc,
    });
    return { ok: true, action: "REQUEUE_DEAD_LETTER", authorization: authorization.command, result };
  }

  async cancelTask(args = {}) {
    const authorization = authorize("CANCEL_TASK", args);
    const result = await this.repository.cancelTask({
      taskId: authorization.command.task_id,
      operatorId: authorization.command.operator_id,
      reason: authorization.command.reason,
      idempotencyKey: authorization.command.idempotency_key,
      nowUtc: this.clock.now().utc,
    });
    return { ok: true, action: "CANCEL_TASK", authorization: authorization.command, result };
  }
}

export class DisabledAgentRuntimeAdminService {
  unavailable() {
    throw adminError("AGENT_RUNTIME_ADMIN_POSTGRES_REQUIRED", "Agent runtime admin requires the PostgreSQL store.");
  }
  async getOverview() { this.unavailable(); }
  async listTasks() { this.unavailable(); }
  async getTask() { this.unavailable(); }
  async listDeadLetters() { this.unavailable(); }
  async listMetrics() { this.unavailable(); }
  async getPoolOverview() { this.unavailable(); }
  async requeueDeadLetter() { this.unavailable(); }
  async cancelTask() { this.unavailable(); }
}

function authorize(action, args) {
  const result = authorizeAgentRuntimeAdminActionV1({ ...args, action });
  if (!result.ok) throw adminError("AGENT_RUNTIME_ADMIN_REJECTED", result.reasons.join(","), { reasons: result.reasons });
  return result;
}

async function rows(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

function projectTask(row, { includePayload = false } = {}) {
  return stripNullish({
    task_id: row.agent_task_id,
    mission_id: row.agent_mission_id,
    mission_key: row.mission_key,
    mission_type: row.mission_type,
    task_key: row.task_key,
    task_type: row.task_type,
    lane: row.lane,
    status: row.status,
    priority: row.priority,
    assigned_worker_id: row.assigned_worker_id,
    lease_active: Boolean(row.lease_token),
    lease_expires_at_utc: toIso(row.lease_expires_at_utc),
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    not_before_utc: toIso(row.not_before_utc),
    input_ref: row.input_ref,
    output_ref: row.output_ref,
    payload_keys: Object.keys(row.payload || {}).sort(),
    payload: includePayload ? row.payload || {} : null,
    last_error: row.last_error,
    last_run: row.last_run_outcome ? {
      outcome: row.last_run_outcome,
      total_latency_ms: row.total_latency_ms,
      total_tokens: row.total_tokens,
      cost_micros_usd: row.cost_micros_usd,
    } : null,
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  });
}

function projectDeadLetter(row) {
  return stripNullish({
    dead_letter_id: row.agent_task_dead_letter_id,
    task_id: row.agent_task_id,
    mission_id: row.agent_mission_id,
    agent_id: row.agent_id,
    task_key: row.task_key,
    task_type: row.task_type,
    lane: row.lane,
    task_status: row.task_status,
    status: row.status,
    error_code: row.error_code,
    error_message: row.error_message,
    retryable: row.retryable,
    attempt_count: row.attempt_count,
    recovery_task_id: row.recovery_task_id,
    operator_action_ref: row.operator_action_ref,
    metadata: row.metadata || {},
    created_at_utc: toIso(row.created_at_utc),
    resolved_at_utc: toIso(row.resolved_at_utc),
  });
}

function projectMetric(row) {
  return stripNullish({
    metric_id: row.agent_task_run_metric_id,
    task_id: row.agent_task_id,
    mission_id: row.agent_mission_id,
    conversation_id: row.agent_conversation_id,
    execution_policy_snapshot_id: row.agent_execution_policy_snapshot_id,
    dead_letter_id: row.agent_task_dead_letter_id,
    worker_id: row.worker_id,
    lane: row.lane,
    task_type: row.task_type,
    model: row.model,
    reasoning_effort: row.reasoning_effort,
    outcome: row.outcome,
    queue_latency_ms: row.queue_latency_ms,
    run_duration_ms: row.run_duration_ms,
    total_latency_ms: row.total_latency_ms,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    cost_micros_usd: row.cost_micros_usd,
    output_ref: row.output_ref,
    error_code: row.error_code,
    metric_hash: row.metric_hash,
    finished_at_utc: toIso(row.finished_at_utc),
  });
}

function projectPoolTaskAggregate(row = {}) {
  return {
    lane: row.lane,
    task_type: row.task_type,
    status: row.status,
    count: Number(row.count) || 0,
  };
}

function projectPoolMetricAggregate(row = {}) {
  return {
    lane: row.lane,
    task_type: row.task_type,
    outcome: row.outcome,
    count: Number(row.count) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    cost_micros_usd: Number(row.cost_micros_usd) || 0,
  };
}

function boundedLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, parsed));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function minutesAgoIso(nowUtc, minutes) {
  return new Date(Date.parse(nowUtc) - minutes * 60_000).toISOString();
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableUpper(value) {
  const text = nullableText(value);
  return text ? text.toUpperCase() : null;
}

function toIso(value) {
  if (!value) return null;
  return typeof value.toISOString === "function" ? value.toISOString() : String(value);
}

function stripNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function adminError(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details, statusCode: code.endsWith("_NOT_FOUND") ? 404 : 400 });
}
