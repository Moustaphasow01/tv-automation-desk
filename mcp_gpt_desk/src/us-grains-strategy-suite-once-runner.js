import { grainChicagoDate, grainsRuntimeEvaluationDisposition, grainsTradingSessionState } from "./us-grains-data-quality.js";
import { replayUsGrainsStrategySuiteV1 } from "./us-grains-strategy-suite.js";
import { publishActionableGrainSignals, selectActionableGrainSignals } from "./us-grains-live-signal-publisher.js";

const DEFAULT_SYMBOLS = Object.freeze(["ZW1!", "ZC1!"]);

export async function runUsGrainsStrategySuiteOnce({ store, args = {}, nowUtc, replaySuite = replayUsGrainsStrategySuiteV1 } = {}) {
  if (!store?.persistence?.pool) throw new Error("US_GRAINS_RUNTIME_STORE_REQUIRED");
  const normalizedArgs = normalizeGrainRunArgs(args);
  const dryRunMode = isReadOnlyGrainRun(normalizedArgs);
  const asOfUtc = isoOrThrow(normalizedArgs["as-of"] || normalizedArgs.asOf || nowUtc);
  const tradingDate = normalizedArgs["trading-date"] || grainChicagoDate(asOfUtc);
  const tradingSession = grainsTradingSessionState(asOfUtc);
  const instruments = csv(normalizedArgs.instruments || normalizedArgs.instrument || "ZW,ZC");
  await store.persistence.initialized;

  const catalogInstances = await loadGrainCatalogInstances(store, instruments);
  const runningCatalogInstances = selectRunningGrainCatalogInstances(catalogInstances);
  const rowsBySymbol = await loadRowsBySymbol(store.persistence.pool, { tradingDate, asOfUtc });
  const agriEvents = await loadAgriEvents(store.persistence.pool, { tradingDate, asOfUtc });
  const replay = replaySuite({ rowsBySymbol, agriEvents, instruments, startDate: tradingDate, endDate: tradingDate, asOfUtc });
  const selectedActionable = tradingSession.state === "OPEN" ? selectActionableGrainSignals({
    replay, asOfUtc, includeExpired: normalizedArgs["include-expired"] === true,
  }) : [];
  const snapshotActionable = filterSignalsForRunningGrainInstances(selectedActionable, runningCatalogInstances);

  if (dryRunMode) {
    return summary({
      asOfUtc, tradingDate, instruments, replay, actionable: snapshotActionable,
      publish: dryRun(snapshotActionable, normalizedArgs), dryRunMode,
      runtimeHeartbeat: readOnlyHeartbeat(runningCatalogInstances, asOfUtc),
      runtimeEvaluations: readOnlyEvaluations(runningCatalogInstances), tradingSession,
    });
  }

  const runtimeHeartbeat = await heartbeatRunningGrainInstances(store.persistence.pool, {
    instanceIds: runningCatalogInstances.map((instance) => instance.strategy_instance_id),
    asOfUtc,
    reason: "us_grains_shadow_runtime_once",
  });
  const heartbeatedInstances = selectCatalogInstances(catalogInstances, runtimeHeartbeat.updated_instance_ids);
  const actionable = filterSignalsForRunningGrainInstances(selectedActionable, heartbeatedInstances);
  const runtimeEvaluations = await recordGrainRuntimeEvaluations(store, {
    catalogInstances: heartbeatedInstances, replay, actionable, asOfUtc, tradingDate, tradingSession,
  });
  const publish = await publishActionableGrainSignals({
    store, signals: actionable, sourceClass: normalizedArgs["source-class"] || "SHADOW",
    certificationRunId: normalizedArgs["certification-run-id"] || null, requireRunningInstance: true,
  });
  return summary({ asOfUtc, tradingDate, instruments, replay, actionable, publish, dryRunMode, runtimeHeartbeat, runtimeEvaluations, tradingSession });
}

export function isReadOnlyGrainRun(args = {}) {
  const normalized = normalizeGrainRunArgs(args);
  return normalized["dry-run"] || normalized["no-publish"];
}

export function normalizeGrainRunArgs(args = {}) {
  return {
    ...args,
    "dry-run": booleanFlag(args["dry-run"], "dry-run"),
    "no-publish": booleanFlag(args["no-publish"], "no-publish"),
    "include-expired": booleanFlag(args["include-expired"], "include-expired"),
  };
}

export function selectRunningGrainCatalogInstances(instances = []) {
  return instances.filter((instance) => String(instance.runtime_state || "").toUpperCase() === "RUNNING");
}

export function filterSignalsForRunningGrainInstances(signals = [], runningInstances = []) {
  const runningIds = new Set(runningInstances.map((instance) => String(instance.strategy_instance_id)));
  return signals.filter((signal) => runningIds.has(String(signal.strategy_instance_id)));
}

async function loadGrainCatalogInstances(store, instruments) {
  const result = await store.persistence.pool.query(
    `SELECT si.strategy_instance_id,
            si.strategy_version_id,
            si.runtime_state,
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

async function heartbeatRunningGrainInstances(pool, { instanceIds, asOfUtc, reason }) {
  if (!instanceIds.length) return heartbeatReport([], asOfUtc);
  const result = await pool.query(
    `UPDATE strategy_instances
        SET last_heartbeat_at = $2::timestamptz,
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
      WHERE strategy_instance_id = ANY($1::uuid[])
        AND runtime_state = 'running'::strategy_instance_runtime_state
      RETURNING strategy_instance_id`,
    [instanceIds, asOfUtc, reason],
  );
  return heartbeatReport(result.rows.map((row) => row.strategy_instance_id), asOfUtc);
}

function heartbeatReport(instanceIds, asOfUtc) {
  return {
    schema_version: "us_grains_runtime_heartbeat_v1", runtime_state: "RUNNING", heartbeat_at_utc: asOfUtc,
    updated_instance_count: instanceIds.length, updated_instance_ids: instanceIds,
  };
}

async function recordGrainRuntimeEvaluations(store, { catalogInstances, replay, actionable, asOfUtc, tradingDate, tradingSession }) {
  if (!store.strategyEvaluations?.record) {
    return { schema_version: "us_grains_runtime_evaluations_v1", status: "UNAVAILABLE", recorded_count: 0, reason: "strategy_evaluations_repository_unavailable" };
  }
  const signalsByInstance = {
    accepted: groupSignalsByInstance(replay.accepted_signals || []),
    actionable: groupSignalsByInstance(actionable || []),
    raw: groupSignalsByInstance(replay.raw_signals || []),
  };
  const recorded = [];
  for (const instance of catalogInstances) {
    const input = grainRuntimeEvaluationInput({ instance, signalsByInstance, asOfUtc, tradingDate, tradingSession });
    const evaluation = await store.strategyEvaluations.record(input);
    recorded.push(grainRuntimeEvaluationResult(input.strategy_instance_id, evaluation));
  }
  return { schema_version: "us_grains_runtime_evaluations_v1", status: "RECORDED", recorded_count: recorded.length, recorded };
}

function grainRuntimeEvaluationInput({ instance, signalsByInstance, asOfUtc, tradingDate, tradingSession }) {
  const signals = instanceSignals(signalsByInstance, instance.strategy_instance_id);
  const signal = evaluationSignal(signals, tradingSession);
  const disposition = grainsRuntimeEvaluationDisposition({ timestampUtc: asOfUtc, hasSignal: Boolean(signal) });
  const instrument = firstInstrument(instance.instrument_scope);
  return {
    strategy_instance_id: instance.strategy_instance_id, strategy_version_id: instance.strategy_version_id,
    source_class: "SHADOW", status: disposition.status,
    scheduler_run_key: `us-grains-shadow:${instance.strategy_instance_id}:${asOfUtc}`,
    correlation_id: `corr_us_grains_runtime_${tradingDate}_${instance.strategy_instance_id}_${asOfUtc}`,
    causation_id: signal?.signal_id || null, artifact_version: "us_grains_strategy_suite_v1", instrument, timeframe: "5",
    source_data_cutoff_utc: asOfUtc, started_at_utc: asOfUtc, completed_at_utc: asOfUtc,
    next_evaluation_at_utc: disposition.next_evaluation_at_utc, signal_id: signal?.signal_id || null,
    reason_codes: disposition.reason_codes,
    payload: grainRuntimeEvaluationPayload({ instance, signals, instrument, tradingDate, tradingSession, disposition }),
  };
}

function instanceSignals(signalsByInstance, strategyInstanceId) {
  const id = String(strategyInstanceId);
  return {
    raw: signalsByInstance.raw.get(id) || [],
    accepted: signalsByInstance.accepted.get(id) || [],
    actionable: signalsByInstance.actionable.get(id) || [],
  };
}

function evaluationSignal(signals, tradingSession) {
  return tradingSession?.state === "OPEN" ? signals.actionable[0] || signals.accepted[0] || null : null;
}

function grainRuntimeEvaluationPayload({ instance, signals, instrument, tradingDate, tradingSession, disposition }) {
  return {
    schema_version: "us_grains_runtime_evaluation_payload_v1", strategy_name: instance.name || null, instrument,
    trading_date: tradingDate, raw_signal_count: signals.raw.length, accepted_signal_count: signals.accepted.length,
    actionable_signal_count: signals.actionable.length, session_state: tradingSession?.state || "UNKNOWN",
    active_session: tradingSession?.active_session || null,
    next_eligible_at_utc: disposition.status === "WAITING_SESSION" ? tradingSession?.next_eligible_at_utc || null : null,
  };
}

function grainRuntimeEvaluationResult(strategyInstanceId, evaluation) {
  return {
    strategy_instance_id: String(strategyInstanceId), status: evaluation.status,
    completed_at_utc: new Date(evaluation.completed_at_utc).toISOString(), signal_id: evaluation.signal_id || null,
  };
}

async function loadRowsBySymbol(pool, { tradingDate, asOfUtc }) {
  const startUtc = addDaysIso(`${tradingDate}T00:00:00.000Z`, -8);
  const entries = [];
  for (const symbol of DEFAULT_SYMBOLS) {
    for (const timeframe of ["1", "5"]) entries.push([`${symbol}:${timeframe}`, await loadCandles(pool, feedId(symbol, timeframe), startUtc, asOfUtc)]);
  }
  return Object.fromEntries(entries);
}

async function loadCandles(pool, feedIdValue, startUtc, endUtc) {
  const result = await pool.query(
    `SELECT timestamp_utc, open, high, low, close, volume
       FROM market_candles
      WHERE feed_id = $1 AND timestamp_utc >= $2::timestamptz AND timestamp_utc <= $3::timestamptz AND is_closed = true
      ORDER BY timestamp_utc ASC`, [feedIdValue, startUtc, endUtc],
  );
  return result.rows.map((row) => ({
    timestamp_utc: new Date(row.timestamp_utc).toISOString(), open: Number(row.open), high: Number(row.high),
    low: Number(row.low), close: Number(row.close), volume: row.volume === null ? null : Number(row.volume),
  }));
}

async function loadAgriEvents(pool, { tradingDate, asOfUtc }) {
  const startUtc = addDaysIso(`${tradingDate}T00:00:00.000Z`, -8);
  const result = await pool.query(
    `SELECT event_kind, title, event_timestamp_utc, importance, actual_available_at_utc
       FROM market_agri_events
      WHERE universe_key = 'US_GRAINS_CBOT' AND event_timestamp_utc >= $1::timestamptz AND event_timestamp_utc <= $2::timestamptz
        AND (actual_available_at_utc IS NULL OR actual_available_at_utc <= $2::timestamptz)
      ORDER BY event_timestamp_utc ASC`, [startUtc, asOfUtc],
  );
  return result.rows.map((row) => ({
    event_kind: row.event_kind, title: row.title, event_timestamp_utc: new Date(row.event_timestamp_utc).toISOString(),
    actual_available_at_utc: row.actual_available_at_utc ? new Date(row.actual_available_at_utc).toISOString() : null, importance: row.importance,
  }));
}

function readOnlyHeartbeat(instances, asOfUtc) {
  return { ...heartbeatReport([], asOfUtc), status: "READ_ONLY", eligible_instance_count: instances.length };
}

function readOnlyEvaluations(instances) {
  return { schema_version: "us_grains_runtime_evaluations_v1", status: "READ_ONLY", recorded_count: 0, eligible_instance_count: instances.length };
}

function dryRun(signals, args) {
  return { schema_version: "us_grains_signal_publish_result_v1", source_class: args["source-class"] || "SHADOW", selected_count: signals.length, published_count: 0, dry_run: true, published: [] };
}

function summary({ asOfUtc, tradingDate, instruments, replay, actionable, publish, dryRunMode, runtimeHeartbeat, runtimeEvaluations, tradingSession }) {
  return {
    schema_version: "us_grains_strategy_suite_once_result_v1", as_of_utc: asOfUtc, trading_date: tradingDate, instruments,
    trading_session: tradingSession || null, dry_run: dryRunMode, runtime_heartbeat: runtimeHeartbeat || null,
    runtime_evaluations: runtimeEvaluations || null, raw_signal_count: replay.raw_signal_count,
    context_accepted_count: replay.context_accepted_count, selected_signal_count: replay.selected_signal_count,
    actionable_signal_count: actionable.length, publish,
  };
}

function selectCatalogInstances(instances, instanceIds) {
  const selectedIds = new Set(instanceIds.map(String));
  return instances.filter((instance) => selectedIds.has(String(instance.strategy_instance_id)));
}

function csv(value) { return String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean); }
function booleanFlag(value, name) {
  if (value === undefined || value === null || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new Error(`US_GRAINS_RUN_FLAG_INVALID:${name}`);
}
function feedId(symbol, timeframe) { return `prod__tradingview__${String(symbol).toUpperCase()}__${String(timeframe).toUpperCase()}`; }
function addDaysIso(iso, days) { return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString(); }
function firstInstrument(value) { return Array.isArray(value) && value.length ? String(value[0]).toUpperCase() : String(value || "ZC").toUpperCase(); }
function isoOrThrow(value) { const parsed = Date.parse(String(value || "")); if (!Number.isFinite(parsed)) throw new Error("Valid as-of timestamp is required."); return new Date(parsed).toISOString(); }
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
