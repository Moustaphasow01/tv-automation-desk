#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SystemClock } from "@tv-automation/desk-time";
import { createDeskStoreFromEnv } from "../src/store.js";
import { PostgresAgentRuntimeRepository } from "../src/agent-runtime-postgres-repository.js";
import { RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION } from "../src/research/research-strategy-iteration-common.js";

if (isDirectRun()) {
  await runCleanupLegacyResearchQueueCli(process.argv.slice(2));
}

export async function runCleanupLegacyResearchQueueCli(argv = []) {
  const args = parseArgs(argv);
  const store = createDeskStoreFromEnv();
  if (!store.clock) store.clock = new SystemClock();
  try {
    await store.persistence.initialized;
    const result = await cleanupLegacyResearchQueue({
      pool: store.persistence.pool,
      apply: args.apply,
      limit: args.limit,
      nowUtc: store.clock.now().utc,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      status: "FAILED",
      error_code: error?.code || "LEGACY_RESEARCH_QUEUE_CLEANUP_FAILED",
      error_message: String(error?.message || error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return result;
  } finally {
    await store.persistence.close?.();
  }
}

export async function cleanupLegacyResearchQueue({ pool, apply = false, limit = 500, nowUtc } = {}) {
  if (!pool?.query) throw coded("POSTGRES_POOL_REQUIRED", "PostgreSQL pool is required.");
  const resolvedNowUtc = text(nowUtc);
  if (apply && !resolvedNowUtc) throw coded("MAINTENANCE_CLOCK_REQUIRED", "nowUtc is required when applying maintenance changes.");
  const candidates = await findLegacyTasks(pool, { limit });
  const summary = {
    ok: true,
    status: apply ? "APPLIED" : "DRY_RUN",
    current_generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
    matched_count: candidates.length,
    cancelled_count: 0,
    tasks: candidates.map(taskProjection),
  };
  if (!apply || candidates.length === 0) return summary;
  const repository = new PostgresAgentRuntimeRepository({ pool, clock: { now: () => ({ utc: resolvedNowUtc }) } });
  for (const task of candidates) {
    await repository.cancelTask({
      taskId: task.agent_task_id,
      operatorId: "research-queue-maintenance",
      reason: `superseded_generator:${task.payload?.generator_version || "missing"} -> ${RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION}`,
      idempotencyKey: `cleanup-legacy-research-queue:${task.agent_task_id}:${RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION}`,
      nowUtc: resolvedNowUtc,
    });
    summary.cancelled_count += 1;
  }
  return summary;
}

async function findLegacyTasks(pool, { limit }) {
  const result = await pool.query(
    `SELECT agent_task_id, task_key, task_type, status, priority, payload, created_at_utc
       FROM agent_tasks
      WHERE lane = 'research'
        AND status IN ('PENDING', 'READY')
        AND task_type = 'RESEARCH_BACKTEST_REVIEW'
        AND COALESCE((payload->>'iteration_index')::int, COALESCE((payload->>'parent_iteration_index')::int, 0)) > 0
        AND COALESCE(payload->>'generator_version', '') <> $1
      ORDER BY priority ASC, created_at_utc ASC
      LIMIT $2`,
    [RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION, bounded(limit)],
  );
  return result.rows || [];
}

function taskProjection(row = {}) {
  return {
    task_id: row.agent_task_id,
    task_key: row.task_key,
    task_type: row.task_type,
    status: row.status,
    priority: row.priority,
    generator_version: row.payload?.generator_version || null,
    iteration_index: Number(row.payload?.iteration_index ?? row.payload?.parent_iteration_index ?? 0),
    created_at_utc: iso(row.created_at_utc),
  };
}

function parseArgs(argv = []) {
  const args = { apply: false, limit: 500 };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg.startsWith("--limit=")) args.limit = bounded(arg.slice("--limit=".length));
  }
  return args;
}

function bounded(value, fallback = 500) {
  const parsed = Math.trunc(Number(value));
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : fallback, 5_000));
}

function iso(value) {
  return value ? String(value) : null;
}

function text(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized;
}

function coded(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function isDirectRun() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
