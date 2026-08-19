#!/usr/bin/env node
import process from "node:process";
import { SystemClock } from "@tv-automation/desk-time";
import { createDeskStoreFromEnv } from "../src/store.js";
import { runResearchBacktestReviewTask } from "../src/research/research-backtest-review-runner.js";
import { DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION } from "../src/research/data-driven-mega-research-batch.js";

const args = parseArgs(process.argv.slice(2));
const store = createDeskStoreFromEnv();
if (!store.clock) store.clock = new SystemClock();

try {
  await store.persistence.initialized;
  const result = await backfillDataDrivenPassReviewsAndRobustness({
    store,
    batchId: args.batchId,
    datasetKey: args.datasetKey,
    apply: args.apply,
    limit: args.limit,
    nowUtc: store.clock.now().utc,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: "FAILED",
    error_code: error?.code || "DATA_DRIVEN_PASS_REVIEW_BACKFILL_FAILED",
    error_message: String(error?.message || error),
    details: error?.details || null,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}

export async function backfillDataDrivenPassReviewsAndRobustness({
  store,
  batchId,
  datasetKey = null,
  apply = false,
  limit = 500,
  nowUtc,
} = {}) {
  const normalizedBatchId = text(batchId);
  if (!normalizedBatchId) throw coded("BATCH_ID_REQUIRED", "batchId is required.");
  if (!store?.persistence?.pool) throw coded("POSTGRES_POOL_REQUIRED", "PostgreSQL pool is required.");
  const rows = await findValidationPassWithoutContradictoryReview(store.persistence.pool, {
    batchId: normalizedBatchId,
    datasetKey: text(datasetKey) || null,
    limit,
  });
  const summary = {
    ok: true,
    status: apply ? "APPLIED" : "DRY_RUN",
    batch_id: normalizedBatchId,
    dataset_key: datasetKey || null,
    matched_count: rows.length,
    contradictory_reviews_recorded: 0,
    robustness_tasks_enqueued: 0,
    outputs: [],
  };
  if (!apply) {
    summary.outputs = rows.slice(0, 25).map(rowProjection);
    return summary;
  }
  for (const row of rows) {
    const output = await runResearchBacktestReviewTask({
      store,
      nowUtc,
      runnerInput: {
        task: backtestReviewTaskFromRow(row, nowUtc),
        lease: { worker_id: "data-driven-pass-backfill" },
      },
    });
    if (output?.research_evaluation_report_id) summary.contradictory_reviews_recorded += 1;
    if (output?.enqueued_next_task?.task_type === "RESEARCH_ROBUSTNESS_REVIEW") summary.robustness_tasks_enqueued += 1;
    summary.outputs.push({
      research_candidate_id: row.research_candidate_id,
      simulation_run_id: row.simulation_run_id,
      status: output?.status || null,
      verdict: output?.verdict || null,
      enqueued_next_task_type: output?.enqueued_next_task?.task_type || null,
      enqueued_next_task_status: output?.enqueued_next_task?.status || null,
    });
  }
  return summary;
}

async function findValidationPassWithoutContradictoryReview(pool, { batchId, datasetKey, limit }) {
  const result = await pool.query(
    `SELECT
       report.research_evaluation_report_id AS validation_report_id,
       report.research_experiment_id,
       report.research_candidate_id,
       report.simulation_run_id,
       report.score,
       report.metric_snapshot,
       report.criteria_snapshot,
       report.artifact_refs,
       report.metadata,
       report.created_at_utc,
       candidate.strategy_version_id AS candidate_strategy_version_id
     FROM research_evaluation_reports report
     JOIN research_candidates candidate
       ON candidate.research_candidate_id = report.research_candidate_id
     WHERE candidate.metadata->>'batch_id' = $1
       AND ($2::text IS NULL OR report.metadata->>'dataset_key' = $2 OR candidate.metadata->>'dataset_key' = $2)
       AND report.report_kind = 'VALIDATION'
       AND report.verdict = 'PASS'
       AND NOT EXISTS (
         SELECT 1
           FROM research_evaluation_reports contradictory
          WHERE contradictory.research_candidate_id = report.research_candidate_id
            AND contradictory.simulation_run_id = report.simulation_run_id
            AND contradictory.report_kind = 'CONTRADICTORY_REVIEW'
       )
     ORDER BY report.score DESC NULLS LAST, report.created_at_utc ASC
     LIMIT $3`,
    [batchId, datasetKey, bounded(limit, 500, 1, 5_000)],
  );
  return result.rows || [];
}

function backtestReviewTaskFromRow(row, nowUtc) {
  const payload = payloadFromRow(row);
  return {
    task_id: `backfill-pass-review-${row.research_candidate_id}-${row.simulation_run_id}`,
    task_key: `backfill-pass-review-${row.research_candidate_id}-${row.simulation_run_id}`,
    task_type: "RESEARCH_BACKTEST_REVIEW",
    lane: "research",
    input_ref: `research-evaluation-report://${row.validation_report_id}`,
    priority: 31,
    payload,
    not_before_utc: nowUtc,
    correlation_id: `corr_data_driven_pass_review_${row.research_candidate_id}`,
    created_at_utc: nowUtc,
    updated_at_utc: nowUtc,
  };
}

function payloadFromRow(row = {}) {
  const metadata = object(row.metadata);
  return {
    dataset_id: metadata.dataset_id || null,
    dataset_key: metadata.dataset_key || null,
    generator_version: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
    generator_slug: "mega-data-driven-v1",
    strategy_version_id: metadata.strategy_version_id || row.candidate_strategy_version_id || null,
    simulation_run_id: row.simulation_run_id,
    research_candidate_id: row.research_candidate_id,
    validation_report_id: row.validation_report_id,
    required_decision: "RUN_CONTRADICTORY_REVIEW_THEN_ROBUSTNESS",
    iteration_index: 0,
    max_iterations: 0,
    max_variants: 0,
    metrics: object(row.metric_snapshot),
  };
}

function rowProjection(row = {}) {
  const metadata = object(row.metadata);
  return {
    research_candidate_id: row.research_candidate_id,
    simulation_run_id: row.simulation_run_id,
    validation_report_id: row.validation_report_id,
    score: Number(row.score),
    family_id: metadata.family_id || null,
    strategy_version_id: metadata.strategy_version_id || row.candidate_strategy_version_id || null,
  };
}

function parseArgs(argv = []) {
  const args = { apply: false, limit: 500, batchId: "", datasetKey: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--batch-id") args.batchId = argv[++index] || "";
    else if (arg.startsWith("--batch-id=")) args.batchId = arg.slice("--batch-id=".length);
    else if (arg === "--dataset-key") args.datasetKey = argv[++index] || "";
    else if (arg.startsWith("--dataset-key=")) args.datasetKey = arg.slice("--dataset-key=".length);
    else if (arg === "--limit") args.limit = bounded(argv[++index], 500);
    else if (arg.startsWith("--limit=")) args.limit = bounded(arg.slice("--limit=".length), 500);
  }
  return args;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function bounded(value, fallback = 500, min = 1, max = 5_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function coded(code, message) {
  return Object.assign(new Error(message || code), { code });
}
