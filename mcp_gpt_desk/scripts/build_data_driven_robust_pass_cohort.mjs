#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import {
  buildDataDrivenRobustPassCohort,
  renderDataDrivenRobustPassCohortMarkdown,
} from "../src/research/data-driven-robust-cohort.js";

const input = parseArgs(process.argv.slice(2));
const batchId = input.batchId || input.batch_id;
const datasetKey = input.datasetKey || input.dataset_key || null;

if (!batchId) {
  console.error("Usage: node scripts/build_data_driven_robust_pass_cohort.mjs --batch-id <id> [--dataset-key <key>] [--json-out <path>] [--markdown-out <path>] [--stdout]");
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const pool = store.persistence.pool;
    const [candidateRows, brokerCommands] = await Promise.all([
      fetchRobustPassCandidates(pool, { batchId, datasetKey }),
      fetchBrokerProviderCommandCount(pool, { batchId, datasetKey }),
    ]);
    const cohort = buildDataDrivenRobustPassCohort({
      batchId,
      datasetKey,
      candidates: candidateRows,
      brokerProviderCommandCount: brokerCommands,
    });
    const markdown = renderDataDrivenRobustPassCohortMarkdown(cohort);
    const jsonOut = input.jsonOut || input.json_out || defaultOutputPath(batchId, "json");
    const markdownOut = input.markdownOut || input.markdown_out || defaultOutputPath(batchId, "md");
    await writeOutput(jsonOut, JSON.stringify(cohort, null, 2));
    await writeOutput(markdownOut, markdown);
    const summary = {
      status: "DONE",
      batch_id: batchId,
      dataset_key: datasetKey,
      json_out: jsonOut,
      markdown_out: markdownOut,
      retained_count: cohort.selection.retained_count,
      oos_pass_count: cohort.selection.oos_pass_count,
      family_count: cohort.family_distribution.length,
      aggregate_total_r: cohort.aggregate.total_r,
      aggregate_closed_trade_count: cohort.aggregate.closed_trade_count,
      cohort_gate: cohort.cohort_gate.verdict,
      cohort_decision: cohort.cohort_gate.decision,
      broker_provider_commands_matching_batch: cohort.safety.broker_provider_commands_matching_batch,
      top_k_cap: cohort.selection.top_k_cap,
    };
    console.log(JSON.stringify(input.stdout ? cohort : summary, null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

async function fetchRobustPassCandidates(pool, { batchId, datasetKey }) {
  const result = await pool.query(
    `WITH latest_robustness AS (
       SELECT DISTINCT ON (r.research_candidate_id)
              r.research_candidate_id,
              r.simulation_run_id,
              r.verdict::text AS robustness_verdict,
              r.score AS robustness_score,
              r.metric_snapshot AS robustness_metrics,
              r.criteria_snapshot AS robustness_criteria,
              r.metadata AS robustness_metadata,
              r.created_at_utc
         FROM research_evaluation_reports r
         JOIN research_candidates c ON c.research_candidate_id = r.research_candidate_id
        WHERE c.metadata->>'batch_id' = $1
          AND ($2::text IS NULL OR c.metadata->>'dataset_key' = $2 OR r.metadata->>'dataset_key' = $2)
          AND r.report_kind = 'ROBUSTNESS'
          AND r.verdict = 'PASS'
        ORDER BY r.research_candidate_id, r.created_at_utc DESC
     ),
     latest_validation AS (
       SELECT DISTINCT ON (r.research_candidate_id)
              r.research_candidate_id,
              r.metric_snapshot AS validation_metrics
         FROM research_evaluation_reports r
        WHERE r.report_kind = 'VALIDATION'
        ORDER BY r.research_candidate_id, r.created_at_utc DESC
     ),
     latest_oos AS (
       SELECT DISTINCT ON (r.research_candidate_id)
              r.research_candidate_id,
              r.verdict::text AS oos_verdict,
              r.score AS oos_score,
              r.metric_snapshot AS oos_metrics,
              r.criteria_snapshot AS oos_criteria
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
            lr.robustness_verdict,
            lr.robustness_score,
            lr.robustness_metrics,
            lv.validation_metrics,
            lo.oos_verdict,
            lo.oos_score,
            lo.oos_metrics,
            lm.promotion_verdict,
            lm.promotion_score,
            lm.promotion_criteria->>'decision' AS promotion_decision,
            lm.promotion_criteria->'reasons' AS promotion_reasons,
            lm.promotion_criteria->'gates'->'G4_PORTFOLIO_FIT'->'detail' AS portfolio_fit_reasons,
            COALESCE(pos.payload->'items', '[]'::jsonb) AS positions
       FROM latest_robustness lr
       JOIN research_candidates c ON c.research_candidate_id = lr.research_candidate_id
       LEFT JOIN latest_validation lv ON lv.research_candidate_id = c.research_candidate_id
       LEFT JOIN latest_oos lo ON lo.research_candidate_id = c.research_candidate_id
       LEFT JOIN latest_matrix lm ON lm.research_candidate_id = c.research_candidate_id
       LEFT JOIN simulation_run_artifacts pos
              ON pos.simulation_run_id = lr.simulation_run_id
             AND pos.artifact_kind = 'POSITIONS'
      ORDER BY lr.robustness_score DESC NULLS LAST, c.candidate_key`,
    [batchId, datasetKey],
  );
  return result.rows;
}

async function fetchBrokerProviderCommandCount(pool, { batchId, datasetKey }) {
  const result = await pool.query(
    `SELECT count(*)::int AS count
       FROM broker_provider_commands
      WHERE ($1::text IS NOT NULL AND payload::text ILIKE '%' || $1::text || '%')
         OR ($2::text IS NOT NULL AND payload::text ILIKE '%' || $2::text || '%')`,
    [batchId, datasetKey],
  );
  return Number(result.rows[0]?.count || 0);
}

async function writeOutput(filePath, content) {
  const resolved = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf8");
}

function defaultOutputPath(batchId, extension) {
  const safe = String(batchId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `reports/research/${safe}-robust-pass-cohort.${extension}`;
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
