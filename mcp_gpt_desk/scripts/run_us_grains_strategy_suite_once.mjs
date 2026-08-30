#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { grainChicagoDate } from "../src/us-grains-data-quality.js";
import { replayUsGrainsStrategySuiteV1 } from "../src/us-grains-strategy-suite.js";
import {
  publishActionableGrainSignals,
  selectActionableGrainSignals,
} from "../src/us-grains-live-signal-publisher.js";

const DEFAULT_SYMBOLS = Object.freeze(["ZW1!", "ZC1!"]);

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asOfUtc = new Date(Date.parse(args["as-of"] || args.asOf || new Date().toISOString())).toISOString();
  const tradingDate = args["trading-date"] || grainChicagoDate(asOfUtc);
  const instruments = csv(args.instruments || args.instrument || "ZW,ZC");
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const catalogInstances = await loadGrainCatalogInstances(store, instruments);
    const runtimeHeartbeat = await markGrainRuntimeRunning(store.persistence.pool, {
      instruments,
      asOfUtc,
      reason: "us_grains_shadow_runtime_once",
    });
    const rowsBySymbol = await loadRowsBySymbol(store.persistence.pool, { tradingDate, asOfUtc });
    const agriEvents = await loadAgriEvents(store.persistence.pool, { tradingDate, asOfUtc });
    const replay = replayUsGrainsStrategySuiteV1({
      rowsBySymbol,
      agriEvents,
      instruments,
      startDate: tradingDate,
      endDate: tradingDate,
      asOfUtc,
    });
    const actionable = selectActionableGrainSignals({
      replay,
      asOfUtc,
      includeExpired: args["include-expired"] === true,
    });
    const runtimeEvaluations = await recordGrainRuntimeEvaluations(store, {
      catalogInstances,
      replay,
      actionable,
      asOfUtc,
      tradingDate,
    });
    const dryRunMode = args["dry-run"] === true || args["no-publish"] === true;
    const publish = dryRunMode
      ? dryRun(actionable, args)
      : await publishActionableGrainSignals({
          store,
          signals: actionable,
          sourceClass: args["source-class"] || "SHADOW",
          certificationRunId: args["certification-run-id"] || null,
        });
    console.log(JSON.stringify(summary({ asOfUtc, tradingDate, instruments, replay, actionable, publish, dryRunMode, runtimeHeartbeat, runtimeEvaluations }), null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

async function loadGrainCatalogInstances(store, instruments) {
  const result = await store.persistence.pool.query(
    `SELECT si.strategy_instance_id,
            si.strategy_version_id,
            si.instrument_scope,
            si.metadata,
            sv.strategy_definition_id,
            sd.name
       FROM strategy_instances si
       JOIN strategy_versions sv ON sv.strategy_version_id = si.strategy_version_id
       JOIN strategy_definitions sd ON sd.strategy_definition_id = sv.strategy_definition_id
      WHERE si.metadata->>'catalog_version' = 'us_grains_strategy_catalog_v1'
        AND si.execution_mode = 'shadow'
        AND si.instrument_scope && $1::text[]
      ORDER BY sd.name, si.strategy_instance_id`,
    [instruments],
  );
  if (result.rows.length < instruments.length) {
    throw new Error("US grains strategy catalog missing. Run `npm run grains:register-suite` first.");
  }
  return result.rows;
}

async function markGrainRuntimeRunning(pool, { instruments, asOfUtc, reason }) {
  const result = await pool.query(
    `UPDATE strategy_instances
        SET runtime_state = 'running'::strategy_instance_runtime_state,
            last_heartbeat_at = $2::timestamptz,
            started_at = COALESCE(started_at, $2::timestamptz),
            stopped_at = NULL,
            failed_at = NULL,
            metadata = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(COALESCE(metadata, '{}'::jsonb), '{live_runtime_hooked}', 'true'::jsonb, true),
                  '{runtime_owner}', to_jsonb('US_GRAINS_DETERMINISTIC_SUITE'::text), true
                ),
                '{last_runtime_reason}', to_jsonb($3::text), true
              ),
              '{last_runtime_as_of_utc}', to_jsonb($2::text), true
            ),
            updated_at = $2::timestamptz
      WHERE metadata->>'catalog_version' = 'us_grains_strategy_catalog_v1'
        AND execution_mode = 'shadow'::strategy_instance_execution_mode
        AND instrument_scope && $1::text[]
      RETURNING strategy_instance_id`,
    [instruments, asOfUtc, reason],
  );
  return {
    schema_version: "us_grains_runtime_heartbeat_v1",
    runtime_state: "RUNNING",
    heartbeat_at_utc: asOfUtc,
    instrument_count: instruments.length,
    updated_instance_count: result.rowCount,
  };
}

async function recordGrainRuntimeEvaluations(store, { catalogInstances, replay, actionable, asOfUtc, tradingDate }) {
  if (!store.strategyEvaluations?.record) {
    return {
      schema_version: "us_grains_runtime_evaluations_v1",
      status: "UNAVAILABLE",
      recorded_count: 0,
      reason: "strategy_evaluations_repository_unavailable",
    };
  }
  const acceptedByInstance = groupSignalsByInstance(replay.accepted_signals || []);
  const actionableByInstance = groupSignalsByInstance(actionable || []);
  const rawByInstance = groupSignalsByInstance(replay.raw_signals || []);
  const recorded = [];
  for (const instance of catalogInstances) {
    const instanceId = String(instance.strategy_instance_id);
    const rawSignals = rawByInstance.get(instanceId) || [];
    const acceptedSignals = acceptedByInstance.get(instanceId) || [];
    const actionableSignals = actionableByInstance.get(instanceId) || [];
    const signal = actionableSignals[0] || acceptedSignals[0] || null;
    const status = signal ? "SIGNAL_CREATED" : "NO_SIGNAL";
    const instrument = firstInstrument(instance.instrument_scope);
    const evaluation = await store.strategyEvaluations.record({
      strategy_instance_id: instance.strategy_instance_id,
      strategy_version_id: instance.strategy_version_id,
      source_class: "SHADOW",
      status,
      scheduler_run_key: `us-grains-shadow:${instanceId}:${asOfUtc}`,
      correlation_id: `corr_us_grains_runtime_${tradingDate}_${instanceId}_${asOfUtc}`,
      causation_id: signal?.signal_id || null,
      artifact_version: "us_grains_strategy_suite_v1",
      instrument,
      timeframe: "5",
      source_data_cutoff_utc: asOfUtc,
      started_at_utc: asOfUtc,
      completed_at_utc: asOfUtc,
      next_evaluation_at_utc: new Date(Date.parse(asOfUtc) + 60_000).toISOString(),
      signal_id: signal?.signal_id || null,
      reason_codes: signal
        ? ["US_GRAINS_RUNTIME_EVALUATED", "SIGNAL_CREATED"]
        : ["US_GRAINS_RUNTIME_EVALUATED", "NO_ACTIONABLE_SIGNAL"],
      payload: {
        schema_version: "us_grains_runtime_evaluation_payload_v1",
        strategy_name: instance.name || null,
        instrument,
        trading_date: tradingDate,
        raw_signal_count: rawSignals.length,
        accepted_signal_count: acceptedSignals.length,
        actionable_signal_count: actionableSignals.length,
      },
    });
    recorded.push({
      strategy_instance_id: instanceId,
      status: evaluation.status,
      completed_at_utc: new Date(evaluation.completed_at_utc).toISOString(),
      signal_id: evaluation.signal_id || null,
    });
  }
  return {
    schema_version: "us_grains_runtime_evaluations_v1",
    status: "RECORDED",
    recorded_count: recorded.length,
    recorded,
  };
}

async function loadRowsBySymbol(pool, { tradingDate, asOfUtc }) {
  const startUtc = addDaysIso(`${tradingDate}T00:00:00.000Z`, -8);
  const entries = [];
  for (const symbol of DEFAULT_SYMBOLS) {
    for (const timeframe of ["1", "5"]) {
      entries.push([`${symbol}:${timeframe}`, await loadCandles(pool, feedId(symbol, timeframe), startUtc, asOfUtc)]);
    }
  }
  return Object.fromEntries(entries);
}

async function loadCandles(pool, feedIdValue, startUtc, endUtc) {
  const result = await pool.query(
    `SELECT timestamp_utc, open, high, low, close, volume
       FROM market_candles
      WHERE feed_id = $1
        AND timestamp_utc >= $2::timestamptz
        AND timestamp_utc <= $3::timestamptz
        AND is_closed = true
      ORDER BY timestamp_utc ASC`,
    [feedIdValue, startUtc, endUtc],
  );
  return result.rows.map((row) => ({
    timestamp_utc: new Date(row.timestamp_utc).toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
  }));
}

async function loadAgriEvents(pool, { tradingDate, asOfUtc }) {
  const startUtc = addDaysIso(`${tradingDate}T00:00:00.000Z`, -8);
  const result = await pool.query(
    `SELECT event_kind, title, event_timestamp_utc, importance, actual_available_at_utc
       FROM market_agri_events
      WHERE universe_key = 'US_GRAINS_CBOT'
        AND event_timestamp_utc >= $1::timestamptz
        AND event_timestamp_utc <= $2::timestamptz
        AND (actual_available_at_utc IS NULL OR actual_available_at_utc <= $2::timestamptz)
      ORDER BY event_timestamp_utc ASC`,
    [startUtc, asOfUtc],
  );
  return result.rows.map((row) => ({
    event_kind: row.event_kind,
    title: row.title,
    event_timestamp_utc: new Date(row.event_timestamp_utc).toISOString(),
    actual_available_at_utc: row.actual_available_at_utc ? new Date(row.actual_available_at_utc).toISOString() : null,
    importance: row.importance,
  }));
}

function dryRun(signals, args) {
  return {
    schema_version: "us_grains_signal_publish_result_v1",
    source_class: args["source-class"] || "SHADOW",
    selected_count: signals.length,
    published_count: 0,
    dry_run: true,
    published: [],
  };
}

function summary({ asOfUtc, tradingDate, instruments, replay, actionable, publish, dryRunMode, runtimeHeartbeat, runtimeEvaluations }) {
  return {
    schema_version: "us_grains_strategy_suite_once_result_v1",
    as_of_utc: asOfUtc,
    trading_date: tradingDate,
    instruments,
    dry_run: dryRunMode,
    runtime_heartbeat: runtimeHeartbeat || null,
    runtime_evaluations: runtimeEvaluations || null,
    raw_signal_count: replay.raw_signal_count,
    context_accepted_count: replay.context_accepted_count,
    selected_signal_count: replay.selected_signal_count,
    actionable_signal_count: actionable.length,
    publish,
  };
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

function feedId(symbol, timeframe) {
  return `prod__tradingview__${String(symbol).toUpperCase()}__${String(timeframe).toUpperCase()}`;
}

function addDaysIso(iso, days) {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

function groupSignalsByInstance(signals = []) {
  const groups = new Map();
  for (const signal of signals) {
    const key = String(signal.strategy_instance_id || "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(signal);
  }
  return groups;
}

function firstInstrument(value) {
  if (Array.isArray(value) && value.length) return String(value[0]).toUpperCase();
  return String(value || "ZC").toUpperCase();
}
