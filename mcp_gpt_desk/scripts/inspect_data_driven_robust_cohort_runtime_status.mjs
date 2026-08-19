#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";

const input = parseArgs(process.argv.slice(2));
const cohortPath = input.cohort || input.cohortPath || "reports/research/mega-1000-mnq-m5-20260817b-robust-pass-cohort.json";

const cohort = JSON.parse(await readFile(cohortPath, "utf8"));
const strategyVersionIds = (cohort.retained_candidates || []).map((candidate) => candidate.strategy_version_id).filter(Boolean);

if (!strategyVersionIds.length) {
  console.error(`No strategy_version_id found in cohort: ${cohortPath}`);
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const pool = store.persistence.pool;
    const [
      versionSummary,
      instanceSummary,
      instanceSamples,
      signalSummary,
      evaluationSummary,
      recentSignals,
    ] = await Promise.all([
      pool.query(
        `SELECT status::text, count(*)::int AS count
           FROM strategy_versions
          WHERE strategy_version_id = ANY($1::uuid[])
          GROUP BY status
          ORDER BY status`,
        [strategyVersionIds],
      ),
      pool.query(
        `SELECT execution_mode::text, runtime_state::text, count(*)::int AS count
           FROM strategy_instances
          WHERE strategy_version_id = ANY($1::uuid[])
          GROUP BY execution_mode, runtime_state
          ORDER BY execution_mode, runtime_state`,
        [strategyVersionIds],
      ),
      pool.query(
        `SELECT strategy_instance_id, strategy_version_id, execution_mode::text,
                runtime_state::text, metadata->'scheduler' AS scheduler,
                instrument_scope, last_heartbeat_at
           FROM strategy_instances
          WHERE strategy_version_id = ANY($1::uuid[])
          ORDER BY created_at DESC
          LIMIT 20`,
        [strategyVersionIds],
      ),
      pool.query(
        `SELECT status::text, source_class, execution_mode_origin::text, count(*)::int AS count
           FROM strategy_signal_outbox
          WHERE strategy_version_id = ANY($1::uuid[])
          GROUP BY status, source_class, execution_mode_origin
          ORDER BY status, source_class, execution_mode_origin`,
        [strategyVersionIds],
      ),
      pool.query(
        `SELECT status::text, source_class, count(*)::int AS count
           FROM strategy_runtime_evaluations
          WHERE strategy_version_id = ANY($1::uuid[])
          GROUP BY status, source_class
          ORDER BY status, source_class`,
        [strategyVersionIds],
      ),
      pool.query(
        `SELECT signal_id, strategy_instance_id, strategy_version_id, instrument,
                direction, confidence, timeframe, source_class, execution_mode_origin::text,
                generated_at_utc, expires_at_utc, availability, proposed_trade_plan,
                trade_plan_economics, reason_codes, status::text
           FROM strategy_signal_outbox
          WHERE strategy_version_id = ANY($1::uuid[])
          ORDER BY generated_at_utc DESC
          LIMIT 10`,
        [strategyVersionIds],
      ),
    ]);
    console.log(JSON.stringify({
      inspected_at_utc: new Date().toISOString(),
      cohort_path: cohortPath,
      strategy_versions_in_cohort: strategyVersionIds.length,
      version_summary: versionSummary.rows,
      instance_summary: instanceSummary.rows,
      instance_samples: instanceSamples.rows,
      signal_summary: signalSummary.rows,
      evaluation_summary: evaluationSummary.rows,
      recent_signals: recentSignals.rows,
    }, null, 2));
  } finally {
    await store.persistence.close?.();
  }
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
