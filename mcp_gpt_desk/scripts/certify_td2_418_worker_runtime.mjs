#!/usr/bin/env node
import process from "node:process";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";

import { PostgresAgentRuntimeRepository } from "../src/agent-runtime-postgres-repository.js";

const ORDER_SIDE_EFFECT_TABLES = Object.freeze([
  "broker_provider_commands",
  "broker_provider_events",
  "broker_execution_outbox",
  "broker_management_outbox",
  "broker_orders",
  "trade_order_intents",
  "portfolio_order_intent_lineage",
]);

const REQUIRED_AGENT_RUNTIME_TABLES = Object.freeze([
  "agents",
  "agent_missions",
  "agent_conversations",
  "agent_tasks",
  "agent_task_leases",
  "agent_events",
  "agent_task_dead_letters",
  "agent_task_run_metrics",
  "agent_execution_policy_snapshots",
  "desk_service_heartbeats",
]);

const EXPECTED_RUNTIME_HEARTBEATS = Object.freeze([
  "agent_runtime_supervisor_live",
  "agent_runtime_supervisor_research",
  "broker_management",
  "codex_live_worker_01",
  "codex_live_worker_02",
  "codex_replay_worker_01",
  "live_runtime_scheduler",
  "replay_preparation_worker",
  "telegram_alert_worker",
]);

const DEFAULT_HEARTBEAT_MAX_AGE_SECONDS = 180;
const CERTIFICATION_LANE = "td2_418_certification";
const CERTIFICATION_TASK_TYPE = "TD2_418_CERTIFICATION_TASK";

const report = await certifyTd2418WorkerRuntime(parseArgs(process.argv.slice(2)));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

export async function certifyTd2418WorkerRuntime({
  databaseUrl = process.env.DATABASE_URL || "",
  heartbeatMaxAgeSeconds = DEFAULT_HEARTBEAT_MAX_AGE_SECONDS,
  notificationTimeoutMs = 2_000,
} = {}) {
  const checkedAtUtc = new Date().toISOString();
  const runId = `td2-418-worker-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const checks = [];
  const blockers = [];
  const artifacts = { runId, lane: CERTIFICATION_LANE };
  const push = (id, ok, detail = {}) => {
    checks.push({ id, ok: Boolean(ok), detail });
    if (!ok) blockers.push({ id, detail });
  };

  if (!String(databaseUrl || "").trim()) {
    push("database.url", false, { reason: "DATABASE_URL required in process environment." });
    return finalReport({ checkedAtUtc, checks, blockers, artifacts });
  }

  const pool = new Pool({ connectionString: databaseUrl, application_name: "td2-418-worker-runtime-proof" });
  const listener = new Client({ connectionString: databaseUrl, application_name: "td2-418-worker-runtime-listener" });
  try {
    await pool.query("SELECT 1");
    push("database.connect", true, { connected: true });

    const schema = await schemaProof(pool);
    artifacts.schema = schema;
    push("agent_runtime.schema", schema.missing.length === 0, schema);

    const heartbeats = await heartbeatProof(pool, heartbeatMaxAgeSeconds);
    artifacts.heartbeats = heartbeats;
    push("runtime.heartbeats", heartbeats.missing.length === 0 && heartbeats.stale_expected.length === 0, heartbeats.public);

    const beforeCounts = await orderSideEffectCounts(pool);
    artifacts.sideEffectsBefore = beforeCounts;

    await listener.connect();
    await listener.query("LISTEN desk_agent_runtime_ready");
    const notification = waitForNotification(listener, {
      lane: CERTIFICATION_LANE,
      timeoutMs: notificationTimeoutMs,
    });

    const seed = await seedCertificationTask(pool, { runId });
    artifacts.seed = publicSeed(seed);
    const readyNotification = await notification;
    push("agent_runtime.eventing_notify", readyNotification?.lane === CERTIFICATION_LANE, {
      received: Boolean(readyNotification),
      payload: readyNotification,
    });

    const repository = new PostgresAgentRuntimeRepository({ pool });
    const claimed = await repository.claimNextTask({
      lane: CERTIFICATION_LANE,
      workerId: "td2-418-proof-worker-01",
      leaseSeconds: 300,
      taskTypePatterns: ["TD2_418_*"],
    });
    artifacts.claim = publicTransition(claimed);
    push("agent_runtime.claim_lease", claimed?.task?.status === "CLAIMED" && Boolean(claimed?.task?.lease_token), {
      task_id: claimed?.task?.task_id || null,
      status: claimed?.task?.status || null,
      assigned_worker_id: claimed?.task?.assigned_worker_id || null,
      lease_token_redacted: Boolean(claimed?.task?.lease_token),
      event_type: claimed?.event?.event_type || null,
    });

    const duplicateClaim = await repository.claimNextTask({
      lane: CERTIFICATION_LANE,
      workerId: "td2-418-proof-worker-02",
      leaseSeconds: 300,
      taskTypePatterns: ["TD2_418_*"],
    });
    push("agent_runtime.double_claim_blocked", duplicateClaim === null, {
      second_claim_returned_task: Boolean(duplicateClaim?.task),
    });

    const failed = await repository.failTask({
      taskId: claimed.task.task_id,
      workerId: "td2-418-proof-worker-01",
      leaseToken: claimed.task.lease_token,
      errorCode: "TD2_418_CERTIFICATION_TERMINAL",
      errorMessage: "TD2-418 certification exercises DLQ/recovery without LLM or broker side effect.",
      retryable: true,
      retryPolicy: { base_delay_seconds: 1, max_delay_seconds: 1, multiplier: 1, jitter_seconds: 0 },
    });
    artifacts.failure = publicTransition(failed);
    push("agent_runtime.dead_letter", failed?.task?.status === "ERROR" && failed?.dead_letter?.status === "OPEN", {
      task_id: failed?.task?.task_id || null,
      status: failed?.task?.status || null,
      dead_letter_id: failed?.dead_letter?.dead_letter_id || null,
      dead_letter_status: failed?.dead_letter?.status || null,
      error_code: failed?.dead_letter?.error_code || null,
    });

    const requeue = await repository.requeueDeadLetter({
      deadLetterId: failed.dead_letter.dead_letter_id,
      operatorId: "td2-418-certifier",
      reason: "TD2-418 certification requeues a controlled dead letter.",
      idempotencyKey: `td2-418-requeue:${failed.dead_letter.dead_letter_id}`,
    });
    const requeueReplay = await repository.requeueDeadLetter({
      deadLetterId: failed.dead_letter.dead_letter_id,
      operatorId: "td2-418-certifier",
      reason: "TD2-418 certification replays the same requeue idempotently.",
      idempotencyKey: `td2-418-requeue:${failed.dead_letter.dead_letter_id}`,
    });
    artifacts.requeue = {
      first: publicTransition(requeue),
      replay: publicTransition(requeueReplay),
    };
    push("agent_runtime.dlq_requeue_idempotent", requeue?.task?.task_id && requeueReplay?.task?.task_id === requeue.task.task_id, {
      first_status: requeue?.status || null,
      replay_status: requeueReplay?.status || null,
      recovery_task_id: requeue?.task?.task_id || null,
      same_recovery_task: requeueReplay?.task?.task_id === requeue?.task?.task_id,
    });

    const recoveryClaim = await repository.claimNextTask({
      lane: CERTIFICATION_LANE,
      workerId: "td2-418-proof-worker-03",
      leaseSeconds: 300,
      taskTypePatterns: ["TD2_418_*"],
    });
    const completed = await repository.completeTask({
      taskId: recoveryClaim.task.task_id,
      workerId: "td2-418-proof-worker-03",
      leaseToken: recoveryClaim.task.lease_token,
      outputRef: `artifact://td2-418/${runId}/recovered-task-complete.json`,
    });
    await repository.recordTaskRunMetrics({
      task_id: completed.task.task_id,
      mission_id: completed.task.mission_id,
      conversation_id: completed.task.conversation_id || null,
      execution_policy_snapshot_id: null,
      dead_letter_id: failed.dead_letter.dead_letter_id,
      worker_id: "td2-418-proof-worker-03",
      lane: CERTIFICATION_LANE,
      task_type: completed.task.task_type,
      model: "none",
      reasoning_effort: "none",
      outcome: "COMPLETED",
      queue_latency_ms: 0,
      run_duration_ms: 1,
      total_latency_ms: 1,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_micros_usd: 0,
      output_ref: completed.task.output_ref,
      error_code: null,
      started_at_utc: checkedAtUtc,
      finished_at_utc: new Date().toISOString(),
    });
    artifacts.recoveryComplete = publicTransition(completed);
    push("agent_runtime.recovery_complete", completed?.task?.status === "DONE", {
      task_id: completed?.task?.task_id || null,
      output_ref: completed?.task?.output_ref || null,
      event_type: completed?.event?.event_type || null,
    });

    const expiredSeed = await seedExpiredLeaseTask(pool, { runId });
    const reclaimed = await repository.claimNextTask({
      lane: CERTIFICATION_LANE,
      workerId: "td2-418-proof-worker-04",
      leaseSeconds: 300,
      taskTypePatterns: ["TD2_418_*"],
    });
    const completedExpired = await repository.completeTask({
      taskId: reclaimed.task.task_id,
      workerId: "td2-418-proof-worker-04",
      leaseToken: reclaimed.task.lease_token,
      outputRef: `artifact://td2-418/${runId}/expired-lease-reclaimed.json`,
    });
    artifacts.expiredLeaseRecovery = {
      seed: publicSeed(expiredSeed),
      claim: publicTransition(reclaimed),
      complete: publicTransition(completedExpired),
    };
    push("agent_runtime.expired_lease_recovery", reclaimed?.task?.assigned_worker_id === "td2-418-proof-worker-04" && completedExpired?.task?.status === "DONE", {
      task_id: reclaimed?.task?.task_id || null,
      original_worker: "td2-418-dead-worker",
      reclaim_worker: reclaimed?.task?.assigned_worker_id || null,
      attempt_count: reclaimed?.task?.attempt_count || null,
      final_status: completedExpired?.task?.status || null,
    });

    const persistence = await persistenceProof(pool, seed.missionId, [
      seed.taskId,
      requeue.task.task_id,
      expiredSeed.taskId,
    ]);
    artifacts.persistence = persistence;
    push("agent_runtime.persistence_audit", persistence.tasks === 3 && persistence.leases >= 3 && persistence.events >= 7 && persistence.metrics >= 1, persistence);

    const afterCounts = await orderSideEffectCounts(pool);
    artifacts.sideEffectsAfter = afterCounts;
    push("order_side_effects.zero_delta", sameCounts(beforeCounts, afterCounts), {
      before: beforeCounts,
      after: afterCounts,
    });
  } catch (error) {
    push("certification.exception", false, {
      error_code: error?.code || "TD2_418_WORKER_CERTIFICATION_FAILED",
      message: String(error?.message || error).slice(0, 500),
    });
  } finally {
    await listener.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }

  return finalReport({ checkedAtUtc, checks, blockers, artifacts });
}

async function seedCertificationTask(pool, { runId }) {
  const agentId = randomUUID();
  const missionId = randomUUID();
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents (
         agent_id, agent_key, agent_type, status, worker_group, capabilities, model_policy, metadata,
         last_heartbeat_at_utc, created_at_utc, updated_at_utc
       ) VALUES ($1, $2, 'td2_418_certifier', 'IDLE', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz, $7::timestamptz, $7::timestamptz)`,
      [
        agentId,
        `${runId}.agent`,
        CERTIFICATION_LANE,
        JSON.stringify(["claim", "fail", "dead_letter", "requeue", "complete"]),
        JSON.stringify({ model: "none", reasoning_effort: "none", policy_version: "td2-418-certification-v1" }),
        JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO agent_missions (
         agent_mission_id, mission_key, agent_id, mission_type, lane, objective, context_ref,
         correlation_id, status, priority, model_policy, metadata, created_at_utc, updated_at_utc
       ) VALUES ($1, $2, $3, 'TD2_418_RUNTIME_CERTIFICATION', $4, $5, $6, $7, 'ASSIGNED', 1, $8::jsonb, $9::jsonb, $10::timestamptz, $10::timestamptz)`,
      [
        missionId,
        `${runId}.mission`,
        agentId,
        CERTIFICATION_LANE,
        "Certify durable agent runtime lifecycle without broker side effects.",
        `artifact://td2-418/${runId}/context.json`,
        `${runId}.correlation`,
        JSON.stringify({ model: "none", reasoning_effort: "none" }),
        JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO agent_tasks (
         agent_task_id, agent_mission_id, task_key, task_type, lane, input_ref, status,
         priority, payload, idempotency_key, attempt_count, max_attempts, correlation_id,
         metadata, created_at_utc, updated_at_utc
       ) VALUES ($1, $2, $3, $4, $5, $6, 'READY', 1, $7::jsonb, $8, 0, 1, $9, $10::jsonb, $11::timestamptz, $11::timestamptz)`,
      [
        taskId,
        missionId,
        `${runId}.task.initial`,
        CERTIFICATION_TASK_TYPE,
        CERTIFICATION_LANE,
        `artifact://td2-418/${runId}/initial-input.json`,
        JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId, step: "initial_dlq_recovery" }),
        `${runId}.task.initial`,
        `${runId}.correlation`,
        JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId }),
        now,
      ],
    );
    await client.query("COMMIT");
    return { agentId, missionId, taskId, runId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seedExpiredLeaseTask(pool, { runId }) {
  const missionId = randomUUID();
  const taskId = randomUUID();
  const now = new Date();
  const created = new Date(now.getTime() - 30 * 60_000).toISOString();
  const claimed = new Date(now.getTime() - 20 * 60_000).toISOString();
  const expired = new Date(now.getTime() - 10 * 60_000).toISOString();
  await pool.query(
    `INSERT INTO agent_missions (
       agent_mission_id, mission_key, mission_type, lane, objective, context_ref,
       correlation_id, status, priority, model_policy, metadata, created_at_utc, updated_at_utc
     ) VALUES ($1, $2, 'TD2_418_EXPIRED_LEASE_CERTIFICATION', $3, $4, $5, $6, 'CREATED', 1, $7::jsonb, $8::jsonb, $9::timestamptz, $9::timestamptz)`,
    [
      missionId,
      `${runId}.expired-lease.mission`,
      CERTIFICATION_LANE,
      "Certify expired lease reclaim after worker crash.",
      `artifact://td2-418/${runId}/expired-lease-context.json`,
      `${runId}.expired.correlation`,
      JSON.stringify({ model: "none", reasoning_effort: "none" }),
      JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId, scenario: "expired_lease" }),
      created,
    ],
  );
  await pool.query(
    `INSERT INTO agent_tasks (
       agent_task_id, agent_mission_id, task_key, task_type, lane, input_ref, status,
       priority, payload, idempotency_key, assigned_worker_id, attempt_count, max_attempts,
       lease_token, lease_expires_at_utc, claimed_at_utc, correlation_id,
       metadata, created_at_utc, updated_at_utc
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', 1, $7::jsonb, $8, 'td2-418-dead-worker', 1, 3,
       'td2-418-expired-lease-token', $9::timestamptz, $10::timestamptz, $11, $12::jsonb, $13::timestamptz, $10::timestamptz)`,
    [
      taskId,
      missionId,
      `${runId}.task.expired-lease`,
      CERTIFICATION_TASK_TYPE,
      CERTIFICATION_LANE,
      `artifact://td2-418/${runId}/expired-lease-input.json`,
      JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId, step: "expired_lease_recovery" }),
      `${runId}.task.expired-lease`,
      expired,
      claimed,
      `${runId}.expired.correlation`,
      JSON.stringify({ proof: "td2-418-worker-runtime", run_id: runId, scenario: "expired_lease" }),
      created,
    ],
  );
  return { missionId, taskId, runId };
}

async function schemaProof(pool) {
  const result = await pool.query(
    "SELECT name, to_regclass(name) IS NOT NULL AS exists FROM unnest($1::text[]) AS name ORDER BY name",
    [REQUIRED_AGENT_RUNTIME_TABLES],
  );
  const items = result.rows.map((row) => ({ table: row.name, exists: row.exists === true }));
  return {
    items,
    missing: items.filter((item) => !item.exists).map((item) => item.table),
  };
}

async function heartbeatProof(pool, maxAgeSeconds) {
  const result = await pool.query(
    `SELECT service_id, service_kind, status, heartbeat_at_utc,
            round(extract(epoch from (now() - heartbeat_at_utc)))::int AS age_seconds,
            release_version
       FROM desk_service_heartbeats
      WHERE service_id = ANY($1::text[])
      ORDER BY service_id`,
    [EXPECTED_RUNTIME_HEARTBEATS],
  );
  const byId = new Map(result.rows.map((row) => [row.service_id, row]));
  const items = EXPECTED_RUNTIME_HEARTBEATS.map((serviceId) => {
    const row = byId.get(serviceId);
    return {
      service_id: serviceId,
      present: Boolean(row),
      status: row?.status || null,
      age_seconds: row?.age_seconds ?? null,
      release_version: row?.release_version || null,
    };
  });
  return {
    items,
    missing: items.filter((item) => !item.present).map((item) => item.service_id),
    stale_expected: items.filter((item) => item.present && Number(item.age_seconds) > maxAgeSeconds).map((item) => item.service_id),
    public: {
      expected_count: EXPECTED_RUNTIME_HEARTBEATS.length,
      observed_count: result.rows.length,
      max_age_seconds: maxAgeSeconds,
      max_observed_age_seconds: Math.max(...items.map((item) => Number(item.age_seconds || 0))),
      missing: items.filter((item) => !item.present).map((item) => item.service_id),
      stale_expected: items.filter((item) => item.present && Number(item.age_seconds) > maxAgeSeconds).map((item) => item.service_id),
    },
  };
}

function waitForNotification(listener, { lane, timeoutMs }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.off("notification", handler);
      resolve(null);
    }, timeoutMs);
    const handler = (message) => {
      if (message.channel !== "desk_agent_runtime_ready") return;
      const payload = parseJson(message.payload);
      if (payload?.lane !== lane) return;
      clearTimeout(timer);
      listener.off("notification", handler);
      resolve(payload);
    };
    listener.on("notification", handler);
  });
}

async function persistenceProof(pool, missionId, taskIds) {
  const [tasks, leases, events, metrics] = await Promise.all([
    count(pool, "SELECT count(*)::int AS count FROM agent_tasks WHERE agent_task_id = ANY($1::uuid[])", [taskIds]),
    count(pool, "SELECT count(*)::int AS count FROM agent_task_leases WHERE agent_task_id = ANY($1::uuid[])", [taskIds]),
    count(pool, "SELECT count(*)::int AS count FROM agent_events WHERE agent_task_id = ANY($1::uuid[]) OR agent_mission_id = $2::uuid", [taskIds, missionId]),
    count(pool, "SELECT count(*)::int AS count FROM agent_task_run_metrics WHERE agent_task_id = ANY($1::uuid[])", [taskIds]),
  ]);
  return { tasks, leases, events, metrics, taskIds };
}

async function orderSideEffectCounts(pool) {
  const counts = {};
  for (const table of ORDER_SIDE_EFFECT_TABLES) counts[table] = await safeCount(pool, table);
  return counts;
}

async function count(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0]?.count ?? 0;
}

async function safeCount(pool, table) {
  try {
    return await count(pool, `SELECT count(*)::int AS count FROM ${table}`);
  } catch {
    return null;
  }
}

function sameCounts(before, after) {
  if (!before || !after) return false;
  return Object.keys(before).every((key) => before[key] === after[key]);
}

function publicSeed(seed = {}) {
  return {
    run_id: seed.runId,
    mission_id: seed.missionId,
    task_id: seed.taskId,
  };
}

function publicTransition(value = {}) {
  return {
    ok: value?.ok ?? null,
    status: value?.status || value?.task?.status || null,
    task_id: value?.task?.task_id || null,
    mission_id: value?.task?.mission_id || null,
    assigned_worker_id: value?.task?.assigned_worker_id || null,
    lease_token_redacted: Boolean(value?.task?.lease_token),
    lease_status: value?.lease?.status || null,
    event_type: value?.event?.event_type || null,
    dead_letter_id: value?.dead_letter?.dead_letter_id || null,
    output_ref: value?.task?.output_ref || null,
  };
}

function finalReport({ checkedAtUtc, checks, blockers, artifacts }) {
  return {
    schema: "td2_418_worker_runtime_certification_v1",
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "PASSED" : "FAILED",
    checked_at_utc: checkedAtUtc,
    checks,
    blockers,
    artifacts,
    safety: {
      secrets_redacted: true,
      broker_provider_side_effect_expected: "ZERO",
      llm_tokens_expected: "ZERO",
      live_auto_execution_expected: "DISABLED",
    },
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    databaseUrl: process.env.DATABASE_URL || "",
    heartbeatMaxAgeSeconds: DEFAULT_HEARTBEAT_MAX_AGE_SECONDS,
    notificationTimeoutMs: 2_000,
  };
  for (const arg of argv) {
    if (arg.startsWith("--heartbeat-max-age-seconds=")) {
      options.heartbeatMaxAgeSeconds = Number(arg.slice("--heartbeat-max-age-seconds=".length));
    } else if (arg.startsWith("--notification-timeout-ms=")) {
      options.notificationTimeoutMs = Number(arg.slice("--notification-timeout-ms=".length));
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/certify_td2_418_worker_runtime.mjs [--heartbeat-max-age-seconds=180] [--notification-timeout-ms=2000]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}
