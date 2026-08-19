#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";

const input = parseArgs(process.argv.slice(2));
const batchId = input.batchId || input.batch_id;
const datasetKey = input.datasetKey || input.dataset_key;

if (!batchId && !datasetKey) {
  console.error("Usage: node scripts/inspect_data_driven_mega_research_batch.mjs --batch-id <id> [--dataset-key <key>]");
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const pool = store.persistence.pool;
    const params = { batchId: batchId || null, datasetKey: datasetKey || null };
    const [
      candidates,
      reports,
      simulations,
      tasks,
      brokerCommands,
      topCandidates,
      taskByCandidateBatch,
      reportKinds,
      robustnessPassCandidates,
      promotionFailureSamples,
    ] = await Promise.all([
      query(pool, candidateSql(), [params.batchId]),
      query(pool, reportSql(), [params.batchId, params.datasetKey]),
      query(pool, simulationSql(), [params.batchId, params.datasetKey]),
      query(pool, taskSql(), [params.datasetKey]),
      query(pool, brokerCommandSql(), [params.batchId, params.datasetKey]),
      query(pool, topCandidateSql(), [params.batchId], true),
      query(pool, taskByCandidateBatchSql(), [params.batchId]),
      query(pool, reportKindSql(), [params.batchId]),
      query(pool, robustnessPassCandidatesSql(), [params.batchId], true),
      query(pool, promotionFailureSamplesSql(), [params.batchId], true),
    ]);
    console.log(JSON.stringify({
      inspected_at_utc: new Date().toISOString(),
      batch_id: batchId || null,
      dataset_key: datasetKey || null,
      candidates,
      evaluation_reports: reports,
      simulation_runs: simulations,
      review_tasks: tasks,
      broker_provider_commands_matching_batch: brokerCommands,
      all_tasks_for_batch_candidates: taskByCandidateBatch,
      evaluation_report_kinds_for_batch_candidates: reportKinds,
      robustness_pass_candidates: robustnessPassCandidates,
      promotion_failure_samples: promotionFailureSamples,
      top_candidates: topCandidates,
    }, null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

function candidateSql() {
  return `SELECT status::text, COALESCE(last_evaluation_verdict::text,'NONE') AS verdict,
                 promotion_blocked, count(*)::int AS count
            FROM research_candidates
           WHERE metadata->>'batch_id' = $1
           GROUP BY status, verdict, promotion_blocked
           ORDER BY status, verdict, promotion_blocked`;
}

function reportSql() {
  return `SELECT verdict::text, count(*)::int AS count
            FROM research_evaluation_reports
           WHERE ($1::text IS NULL OR metadata->>'batch_id' = $1)
             AND ($2::text IS NULL OR metadata->>'dataset_key' = $2)
           GROUP BY verdict
           ORDER BY verdict`;
}

function simulationSql() {
  return `SELECT status::text, count(*)::int AS count
            FROM simulation_runs
           WHERE ($1::text IS NULL OR metadata->>'batch_id' = $1)
             AND ($2::text IS NULL OR metadata->>'dataset_key' = $2)
           GROUP BY status
           ORDER BY status`;
}

function taskSql() {
  return `SELECT lane, task_type, status::text, count(*)::int AS count
            FROM agent_tasks
           WHERE payload->>'dataset_key' = $1
           GROUP BY lane, task_type, status
           ORDER BY lane, task_type, status`;
}

function brokerCommandSql() {
  return `SELECT count(*)::int AS count
            FROM broker_provider_commands
           WHERE ($1::text IS NOT NULL AND payload::text ILIKE '%' || $1::text || '%')
              OR ($2::text IS NOT NULL AND payload::text ILIKE '%' || $2::text || '%')`;
}

function topCandidateSql() {
  return `SELECT research_candidate_id, candidate_key, last_evaluation_verdict::text AS verdict,
                 evaluation_score, metadata->>'family_id' AS family_id,
                 metadata->>'variant_index' AS variant_index
            FROM research_candidates
           WHERE metadata->>'batch_id' = $1
           ORDER BY evaluation_score DESC NULLS LAST
           LIMIT 20`;
}

function taskByCandidateBatchSql() {
  return `SELECT t.lane, t.task_type, t.status::text, count(*)::int AS count
            FROM agent_tasks t
           WHERE t.payload->>'research_candidate_id' IN (
             SELECT research_candidate_id::text
               FROM research_candidates
              WHERE metadata->>'batch_id' = $1
           )
           GROUP BY t.lane, t.task_type, t.status
           ORDER BY t.lane, t.task_type, t.status`;
}

function reportKindSql() {
  return `SELECT r.report_kind::text, r.verdict::text, count(*)::int AS count
            FROM research_evaluation_reports r
           WHERE r.research_candidate_id IN (
             SELECT research_candidate_id
               FROM research_candidates
              WHERE metadata->>'batch_id' = $1
           )
           GROUP BY r.report_kind, r.verdict
           ORDER BY r.report_kind, r.verdict`;
}

function robustnessPassCandidatesSql() {
  return `WITH latest_robustness AS (
           SELECT DISTINCT ON (r.research_candidate_id)
                  r.research_candidate_id,
                  r.simulation_run_id,
                  r.score,
                  r.metric_snapshot,
                  r.criteria_snapshot,
                  r.created_at_utc
             FROM research_evaluation_reports r
            WHERE r.report_kind = 'ROBUSTNESS'
              AND r.verdict = 'PASS'
            ORDER BY r.research_candidate_id, r.created_at_utc DESC
         ),
         latest_oos AS (
           SELECT DISTINCT ON (r.research_candidate_id)
                  r.research_candidate_id,
                  r.verdict::text AS oos_verdict,
                  r.score AS oos_score,
                  r.metric_snapshot AS oos_metrics
             FROM research_evaluation_reports r
            WHERE r.report_kind = 'OUT_OF_SAMPLE'
            ORDER BY r.research_candidate_id, r.created_at_utc DESC
         ),
         latest_matrix AS (
           SELECT DISTINCT ON (r.research_candidate_id)
                  r.research_candidate_id,
                  r.verdict::text AS promotion_verdict,
                  r.score AS promotion_score,
                  r.criteria_snapshot AS promotion_criteria
             FROM research_evaluation_reports r
            WHERE r.report_kind = 'PROMOTION_MATRIX'
            ORDER BY r.research_candidate_id, r.created_at_utc DESC
         )
         SELECT c.research_candidate_id,
                c.candidate_key,
                c.strategy_version_id,
                c.metadata->>'family_id' AS family_id,
                c.metadata->>'variant_index' AS variant_index,
                lr.simulation_run_id,
                lr.score AS robustness_score,
                lr.metric_snapshot->>'total_r' AS robustness_total_r,
                lr.metric_snapshot->>'trade_count' AS robustness_trade_count,
                lr.metric_snapshot->>'profit_factor' AS robustness_profit_factor,
                lr.metric_snapshot->>'max_drawdown_r' AS robustness_max_drawdown_r,
                lr.metric_snapshot->>'walk_forward_pass_rate' AS walk_forward_pass_rate,
                lr.metric_snapshot->>'cost_stress_pass_rate' AS cost_stress_pass_rate,
                lr.metric_snapshot->>'bootstrap_loss_probability' AS bootstrap_loss_probability,
                lo.oos_verdict,
                lo.oos_score,
                lo.oos_metrics->>'total_r' AS oos_total_r,
                lo.oos_metrics->>'trade_count' AS oos_trade_count,
                lo.oos_metrics->>'max_drawdown_r' AS oos_max_drawdown_r,
                lm.promotion_verdict,
                lm.promotion_score,
                lm.promotion_criteria->>'decision' AS promotion_decision,
                lm.promotion_criteria->'reasons' AS promotion_reasons,
                lm.promotion_criteria->'gates'->'G4_PORTFOLIO_FIT'->'detail' AS portfolio_fit_reasons
           FROM latest_robustness lr
           JOIN research_candidates c ON c.research_candidate_id = lr.research_candidate_id
           LEFT JOIN latest_oos lo ON lo.research_candidate_id = c.research_candidate_id
           LEFT JOIN latest_matrix lm ON lm.research_candidate_id = c.research_candidate_id
          WHERE c.metadata->>'batch_id' = $1
          ORDER BY lr.score DESC NULLS LAST, c.candidate_key
          LIMIT 200`;
}

function promotionFailureSamplesSql() {
  return `SELECT c.research_candidate_id,
                c.candidate_key,
                c.metadata->>'family_id' AS family_id,
                c.metadata->>'variant_index' AS variant_index,
                r.verdict::text AS verdict,
                r.score,
                r.criteria_snapshot->>'decision' AS decision,
                r.criteria_snapshot->'reasons' AS reasons,
                r.criteria_snapshot->'gates'->'G4_PORTFOLIO_FIT'->'detail' AS portfolio_fit_reasons
           FROM research_evaluation_reports r
           JOIN research_candidates c ON c.research_candidate_id = r.research_candidate_id
          WHERE c.metadata->>'batch_id' = $1
            AND r.report_kind = 'PROMOTION_MATRIX'
            AND r.verdict = 'FAIL'
          ORDER BY r.score DESC NULLS LAST, r.created_at_utc DESC
          LIMIT 10`;
}

async function query(pool, sql, params, raw = false) {
  const result = await pool.query(sql, params);
  return raw ? result.rows : result.rows;
}

function parseArgs(args) {
  const input = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) input[key] = true;
    else {
      input[key] = next;
      index += 1;
    }
  }
  return input;
}
