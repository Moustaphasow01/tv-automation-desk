#!/usr/bin/env node
import process from "node:process";
import { SystemClock } from "@tv-automation/desk-time";
import { createDeskStoreFromEnv } from "../src/store.js";
import {
  enqueueRobustnessReviewTaskIfRequired,
  RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
} from "../src/research/research-backtest-review-runner.js";
import { RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION } from "../src/research/research-strategy-iteration-common.js";

const args = parseArgs(process.argv.slice(2));
const store = createDeskStoreFromEnv();
if (!store.clock) store.clock = new SystemClock();

try {
  await store.persistence.initialized;
  const result = await backfillMissingResearchRobustnessTasks({
    store,
    apply: args.apply,
    limit: args.limit,
    nowUtc: store.clock.now().utc,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: "FAILED",
    error_code: error?.code || "RESEARCH_ROBUSTNESS_BACKFILL_FAILED",
    error_message: String(error?.message || error),
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}

export async function backfillMissingResearchRobustnessTasks({ store, apply = false, limit = 100, nowUtc } = {}) {
  if (!store?.persistence?.pool) throw coded("POSTGRES_POOL_REQUIRED", "PostgreSQL pool is required.");
  const resolvedNowUtc = text(nowUtc);
  if (apply && !resolvedNowUtc) throw coded("MAINTENANCE_CLOCK_REQUIRED", "nowUtc is required when applying maintenance changes.");
  const rows = await findMissingRobustnessReviews(store.persistence.pool, { limit });
  const summary = {
    ok: true,
    status: apply ? "APPLIED" : "DRY_RUN",
    matched_count: rows.length,
    enqueued_count: 0,
    current_generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
    tasks: rows.map(rowProjection),
  };
  if (!apply || rows.length === 0) return summary;
  for (const row of rows) {
    const enqueued = await enqueueRobustnessReviewTaskIfRequired({
      store,
      review: {
        assessment: { decision: "READY_FOR_ROBUSTNESS_REVIEW" },
        report: reportFromRow(row),
      },
      saved: { report: reportFromRow(row) },
      runnerInput: {
        task: {
          task_id: `backfill-${row.research_evaluation_report_id}`,
          task_key: `backfill-research-robustness-${row.research_candidate_id}-${row.simulation_run_id}`,
          task_type: "RESEARCH_BACKTEST_REVIEW",
          lane: "research",
          correlation_id: `corr_research_robustness_backfill_${row.research_candidate_id}`,
          payload: payloadFromRow(row),
          created_at_utc: resolvedNowUtc,
        },
      },
      nowUtc: resolvedNowUtc,
    });
    if (enqueued) summary.enqueued_count += 1;
  }
  return summary;
}

async function findMissingRobustnessReviews(pool, { limit }) {
  const result = await pool.query(
    `SELECT
       report.research_evaluation_report_id,
       report.research_experiment_id,
       report.research_candidate_id,
       report.simulation_run_id,
       report.report_kind,
       report.verdict,
       report.score,
       report.metric_snapshot,
       report.criteria_snapshot,
       report.artifact_refs,
       report.reviewer_ref,
       report.metadata,
       report.created_at_utc,
       candidate.strategy_version_id AS candidate_strategy_version_id
     FROM research_evaluation_reports report
     JOIN research_candidates candidate
       ON candidate.research_candidate_id = report.research_candidate_id
     WHERE report.report_kind = 'CONTRADICTORY_REVIEW'
       AND report.verdict = 'PASS'
       AND NOT EXISTS (
         SELECT 1
           FROM research_evaluation_reports robustness
          WHERE robustness.research_candidate_id = report.research_candidate_id
            AND robustness.simulation_run_id = report.simulation_run_id
            AND robustness.report_kind = 'ROBUSTNESS'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM agent_tasks task
          WHERE task.lane = 'research'
            AND task.task_type = 'RESEARCH_ROBUSTNESS_REVIEW'
            AND task.payload->>'research_candidate_id' = report.research_candidate_id::text
            AND task.payload->>'simulation_run_id' = report.simulation_run_id::text
            AND task.status IN ('PENDING','READY','CLAIMED','RUNNING','WAITING_DEPENDENCY')
       )
     ORDER BY report.created_at_utc ASC
     LIMIT $1`,
    [bounded(limit)],
  );
  return result.rows || [];
}

function reportFromRow(row = {}) {
  return {
    research_evaluation_report_id: row.research_evaluation_report_id,
    research_experiment_id: row.research_experiment_id,
    research_candidate_id: row.research_candidate_id,
    simulation_run_id: row.simulation_run_id,
    report_kind: row.report_kind,
    verdict: row.verdict,
    score: Number(row.score),
    metric_snapshot: object(row.metric_snapshot),
    criteria_snapshot: object(row.criteria_snapshot),
    artifact_refs: Array.isArray(row.artifact_refs) ? row.artifact_refs : [],
    reviewer_ref: row.reviewer_ref,
    metadata: {
      ...object(row.metadata),
      source: object(row.metadata).source || RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
      strategy_version_id: object(row.metadata).strategy_version_id || row.candidate_strategy_version_id || null,
    },
    created_at_utc: text(row.created_at_utc),
  };
}

function payloadFromRow(row = {}) {
  const metadata = object(row.metadata);
  return {
    dataset_id: metadata.dataset_id || null,
    dataset_key: metadata.dataset_key || null,
    generator_version: metadata.generator_version || RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
    generator_slug: metadata.generator_slug || null,
    strategy_version_id: metadata.strategy_version_id || row.candidate_strategy_version_id || null,
    simulation_run_id: row.simulation_run_id,
    research_candidate_id: row.research_candidate_id,
    contradictory_review_report_id: row.research_evaluation_report_id,
    required_decision: "RUN_ROBUSTNESS_AND_OOS_GATES",
    iteration_index: bounded(metadata.iteration_index ?? metadata.parent_iteration_index, 0, 0, 20),
    metrics: object(row.metric_snapshot),
  };
}

function rowProjection(row = {}) {
  const metadata = object(row.metadata);
  return {
    research_candidate_id: row.research_candidate_id,
    simulation_run_id: row.simulation_run_id,
    contradictory_review_report_id: row.research_evaluation_report_id,
    score: Number(row.score),
    generator_version: metadata.generator_version || null,
    strategy_version_id: metadata.strategy_version_id || row.candidate_strategy_version_id || null,
  };
}

function parseArgs(argv = []) {
  const args = { apply: false, limit: 100 };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg.startsWith("--limit=")) args.limit = bounded(arg.slice("--limit=".length), 100);
  }
  return args;
}

function bounded(value, fallback = 100, min = 1, max = 5_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function coded(code, message) {
  return Object.assign(new Error(message || code), { code });
}
