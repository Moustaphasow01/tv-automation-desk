#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const DEFAULT_COHORT_ID = "full-history-min8-shadow-live-20260817b";

const input = parseArgs(process.argv.slice(2));
const cohortId = input.cohortId || DEFAULT_COHORT_ID;
const minutes = Math.max(5, Number(input.minutes || 90));

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const pool = store.persistence.pool;
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  const [
    evalGroups,
    latestEvals,
    candles,
    instances,
    signals,
    intents,
    gates,
    provider,
    heartbeat,
  ] = await Promise.all([
    q(
      `
        SELECT status::text AS status,
               COALESCE(source_class::text, '') AS source_class,
               COALESCE(reason_codes::text, '') AS reason_codes,
               COALESCE(payload->>'errorCode', '') AS error_code,
               left(COALESCE(payload->>'errorMessage', ''), 220) AS error_message,
               count(*)::int AS count,
               max(completed_at_utc) AS last_completed_at_utc
          FROM strategy_runtime_evaluations
         WHERE completed_at_utc > now() - ($1::int * interval '1 minute')
           AND strategy_instance_id IN (
             SELECT strategy_instance_id
               FROM strategy_instances
              WHERE metadata->>'cohort_id' = $2
           )
         GROUP BY 1, 2, 3, 4, 5
         ORDER BY count DESC, last_completed_at_utc DESC
         LIMIT 20
      `,
      [minutes, cohortId],
    ),
    q(
      `
        SELECT strategy_instance_id::text AS instance_id,
               strategy_version_id::text AS version_id,
               status::text AS status,
               source_class::text AS source_class,
               source_data_cutoff_utc,
               reason_codes,
               payload->>'errorCode' AS error_code,
               left(COALESCE(payload->>'errorMessage', ''), 180) AS error_message,
               completed_at_utc
          FROM strategy_runtime_evaluations
         WHERE strategy_instance_id IN (
             SELECT strategy_instance_id
               FROM strategy_instances
              WHERE metadata->>'cohort_id' = $1
           )
         ORDER BY completed_at_utc DESC
         LIMIT 10
      `,
      [cohortId],
    ),
    q(
      `
        SELECT symbol_code,
               timeframe,
               max(timestamp_utc) AS latest_timestamp_utc,
               count(*)::int AS rows
          FROM market_candles
         WHERE symbol_code IN ('MNQ1!', 'MES1!', 'NQ1!', 'ES1!')
         GROUP BY symbol_code, timeframe
         ORDER BY symbol_code, timeframe
      `,
    ),
    q(
      `
        SELECT execution_mode::text AS execution_mode,
               runtime_state::text AS runtime_state,
               count(*)::int AS count
          FROM strategy_instances
         WHERE metadata->>'cohort_id' = $1
         GROUP BY 1, 2
         ORDER BY 1, 2
      `,
      [cohortId],
    ),
    q(
      `
        SELECT status::text AS status,
               source_class::text AS source_class,
               count(*)::int AS count,
               max(created_at_utc) AS latest_created_at_utc
          FROM strategy_signal_outbox
         WHERE created_at_utc > now() - ($1::int * interval '1 minute')
           AND strategy_instance_id IN (
             SELECT strategy_instance_id
               FROM strategy_instances
              WHERE metadata->>'cohort_id' = $2
           )
         GROUP BY 1, 2
         ORDER BY 1, 2
      `,
      [minutes, cohortId],
    ),
    q(
      `
        SELECT status::text AS status,
               count(*)::int AS count,
               max(created_at_utc) AS latest_created_at_utc
          FROM portfolio_order_intent_lineage
         WHERE created_at_utc > now() - ($1::int * interval '1 minute')
         GROUP BY 1
         ORDER BY 1
      `,
      [minutes],
    ),
    q(
      `
        SELECT status::text AS status,
               count(*)::int AS count,
               max(created_at_utc) AS latest_created_at_utc
          FROM human_execution_gates
         WHERE created_at_utc > now() - ($1::int * interval '1 minute')
         GROUP BY 1
         ORDER BY 1
      `,
      [minutes],
    ),
    q(
      `
        SELECT (SELECT count(*)::int FROM broker_provider_commands) AS commands,
               (SELECT count(*)::int FROM broker_provider_events) AS events
      `,
    ),
    q(
      `
        SELECT service_id,
               status::text AS status,
               heartbeat_at_utc,
               details->'strategy_runtime' AS strategy_runtime,
               details->'strategy_signal_decision_pipeline' AS decision_pipeline
          FROM desk_service_heartbeats
         WHERE service_id = 'live_runtime_scheduler'
         ORDER BY heartbeat_at_utc DESC
         LIMIT 1
      `,
    ),
  ]);

  console.log(JSON.stringify({
    inspected_at_utc: new Date().toISOString(),
    cohort_id: cohortId,
    window_minutes: minutes,
    eval_groups: evalGroups,
    latest_evaluations: latestEvals,
    market_candles: candles,
    strategy_instances: instances,
    strategy_signals: signals,
    order_intents: intents,
    human_execution_gates: gates,
    provider_counts: provider[0] || null,
    live_runtime_scheduler_heartbeat: heartbeat[0] || null,
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
    if (!next || next.startsWith("--")) {
      input[key] = true;
      continue;
    }
    input[key] = next;
    index += 1;
  }
  return input;
}
