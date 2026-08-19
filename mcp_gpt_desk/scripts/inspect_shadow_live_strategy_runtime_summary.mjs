#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const DEFAULT_COHORT_ID = "full-history-min8-shadow-live-20260817b";

const input = parseArgs(process.argv.slice(2));
const cohortId = input.cohortId || DEFAULT_COHORT_ID;
const minutes = Math.max(5, Number(input.minutes || 30));
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const pool = store.persistence.pool;
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  const [heartbeat] = await q(`
    SELECT service_id,
           status::text AS status,
           heartbeat_at_utc,
           details->'strategy_runtime' AS strategy_runtime,
           details->'strategy_signal_decision_pipeline' AS decision_pipeline
      FROM desk_service_heartbeats
     WHERE service_id = 'live_runtime_scheduler'
     ORDER BY heartbeat_at_utc DESC
     LIMIT 1
  `);
  const instances = await q(`
    SELECT strategy_instance_id::text AS strategy_instance_id,
           COALESCE(metadata->>'cohort_id','') AS cohort_id,
           execution_mode::text AS execution_mode,
           runtime_state::text AS runtime_state
      FROM strategy_instances
     ORDER BY runtime_state, execution_mode, cohort_id
  `);
  const cohortIds = new Set(instances.filter((item) => item.cohort_id === cohortId).map((item) => item.strategy_instance_id));
  const pausedIds = new Set(instances.filter((item) => item.runtime_state === "paused").map((item) => item.strategy_instance_id));
  const due = heartbeat?.strategy_runtime?.plan?.due || [];
  const dueByCohort = { cohort: 0, paused: 0, non_cohort: 0 };
  for (const item of due) {
    const id = String(item.strategy_instance_id || "");
    if (cohortIds.has(id)) dueByCohort.cohort += 1;
    else if (pausedIds.has(id)) dueByCohort.paused += 1;
    else dueByCohort.non_cohort += 1;
  }

  const [
    instanceGroups,
    evalGroups,
    signals,
    orderIntents,
    gates,
    providerCounts,
    marketFreshness,
  ] = await Promise.all([
    q(`
      SELECT COALESCE(metadata->>'cohort_id','') AS cohort_id,
             execution_mode::text AS execution_mode,
             runtime_state::text AS runtime_state,
             count(*)::int AS count
        FROM strategy_instances
       GROUP BY 1,2,3
       ORDER BY 2,3,1
    `),
    q(`
      SELECT status::text AS status,
             COALESCE(reason_codes::text, '') AS reason_codes,
             count(*)::int AS count,
             max(completed_at_utc) AS latest_completed_at_utc
        FROM strategy_runtime_evaluations
       WHERE completed_at_utc > now() - ($1::int * interval '1 minute')
         AND strategy_instance_id IN (
           SELECT strategy_instance_id FROM strategy_instances WHERE metadata->>'cohort_id' = $2
         )
       GROUP BY 1,2
       ORDER BY latest_completed_at_utc DESC
    `, [minutes, cohortId]),
    q(`
      SELECT status::text AS status,
             source_class::text AS source_class,
             count(*)::int AS count,
             max(created_at_utc) AS latest_created_at_utc
        FROM strategy_signal_outbox
       WHERE created_at_utc > now() - ($1::int * interval '1 minute')
         AND strategy_instance_id IN (
           SELECT strategy_instance_id FROM strategy_instances WHERE metadata->>'cohort_id' = $2
         )
       GROUP BY 1,2
       ORDER BY latest_created_at_utc DESC
    `, [minutes, cohortId]),
    q(`
      SELECT status::text AS status,
             count(*)::int AS count,
             max(created_at_utc) AS latest_created_at_utc
        FROM portfolio_order_intent_lineage
       WHERE created_at_utc > now() - ($1::int * interval '1 minute')
       GROUP BY 1
       ORDER BY latest_created_at_utc DESC
    `, [minutes]),
    q(`
      SELECT status::text AS status,
             count(*)::int AS count,
             max(created_at_utc) AS latest_created_at_utc
        FROM human_execution_gates
       WHERE created_at_utc > now() - ($1::int * interval '1 minute')
       GROUP BY 1
       ORDER BY latest_created_at_utc DESC
    `, [minutes]),
    q(`
      SELECT (SELECT count(*)::int FROM broker_provider_commands) AS commands,
             (SELECT count(*)::int FROM broker_provider_events) AS events
    `),
    q(`
      SELECT symbol_code,
             timeframe,
             max(timestamp_utc) AS latest_timestamp_utc,
             round(EXTRACT(EPOCH FROM (now() - max(timestamp_utc))) / 60.0, 1)::float AS age_minutes
        FROM market_candles
       WHERE symbol_code IN ('MNQ1!', 'MES1!')
         AND timeframe IN ('1', '5')
       GROUP BY 1,2
       ORDER BY 1,2
    `),
  ]);

  console.log(JSON.stringify({
    inspected_at_utc: new Date().toISOString(),
    cohort_id: cohortId,
    window_minutes: minutes,
    heartbeat: heartbeat ? {
      service_id: heartbeat.service_id,
      status: heartbeat.status,
      heartbeat_at_utc: heartbeat.heartbeat_at_utc,
      strategy_status: heartbeat.strategy_runtime?.status || null,
      due_count: due.length,
      due_by_cohort: dueByCohort,
      decision_pipeline: heartbeat.decision_pipeline || null,
    } : null,
    instance_groups: instanceGroups,
    eval_groups: evalGroups,
    strategy_signals: signals,
    order_intents: orderIntents,
    human_execution_gates: gates,
    provider_counts: providerCounts[0] || null,
    market_freshness: marketFreshness,
  }, null, 2));
} finally {
  await store.persistence.close?.();
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
