import {
  canonicalJson,
  canonicalSha256,
  compileStrategyVersionToDeterministicPlanV1,
} from "@tv-automation/desk-domain";
import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import {
  strategyRuntimeSimulationParameters,
  strategySignalFromRuntimePosition,
} from "./canonical-strategy-evaluation-scheduler.js";
import { buildDataDrivenLiveRuntimeBindings } from "./research/data-driven-live-runtime-bindings.js";
import { createStrategySignalDecisionPipelineService } from "./strategy-signal-decision-pipeline-service.js";

export const STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION = "strategy_runtime_window_replay_v1";

const SYMBOL_BY_INSTRUMENT = Object.freeze({ MNQ: "MNQ1!", MES: "MES1!" });
const DEFAULT_SOURCE_CLASS = "CERTIFICATION_REPLAY";
const DEFAULT_EXECUTION_MODE = "SHADOW";
const DEFAULT_RUNTIME_STATE = "RUNNING";
const DEFAULT_CONTEXT_DAYS = 15;
const STRATEGY_SIGNAL_TTL_MS = 30 * 60_000;

export async function runStrategyRuntimeWindowReplay({ store, input = {} } = {}) {
  if (!store?.persistence?.pool || !store?.strategyKernel) {
    throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_DEPENDENCY_MISSING", "Strategy runtime window replay requires PostgreSQL and Strategy Kernel.");
  }
  const config = normalizeWindowReplayInput(input);
  await store.persistence.initialized;
  const instances = await loadScopedInstances(store, config);
  const caches = new Map();
  const definitions = new Map();
  const versions = new Map();
  const outcomes = [];
  const signals = [];
  let replayedInstanceWindows = 0;
  let totalCutoffs = 0;
  let totalSetups = 0;

  for (const instance of instances) {
    const version = await cached(versions, instance.strategy_version_id, (id) => store.strategyKernel.getVersion(id));
    const definition = await cached(definitions, version.strategy_definition_id, (id) => store.strategyKernel.getDefinition(id));
    const dsl = strategyVersionDsl(version);
    const instrument = scopedInstrument(instance, definition, config);
    const timeframe = templateTimeframe(dsl) || config.timeframe;
    const cacheKey = `${instrument}:${timeframe}`;
    const market = await cached(caches, cacheKey, () => loadWindowMarketData(store.persistence.pool, {
      instrument,
      timeframe,
      startUtc: config.startUtc,
      endUtc: config.endUtc,
      contextDays: config.contextDays,
    }));

    if (!dsl) {
      outcomes.push(skippedOutcome(instance, version, definition, instrument, timeframe, "STRATEGY_DSL_SOURCE_MISSING"));
      continue;
    }
    if (!market.days.length) {
      outcomes.push(skippedOutcome(instance, version, definition, instrument, timeframe, "MARKET_WINDOW_EMPTY"));
      continue;
    }

    for (const sourceDay of market.days) {
      if (!sourceDay.cutoffs.length) continue;
      for (const day of windowDayChunks(sourceDay, config)) {
      const startedAtUtc = new Date().toISOString();
      const compilation = compileWindowRuntimeArtifact({
        config,
        definition,
        version,
        dsl,
        instance,
        day,
        instrument,
        timeframe,
      });
      totalCutoffs += day.cutoffs.length;
      totalSetups += compilation.setups.length;
      if (!compilation.ok) {
        outcomes.push({
          status: "FAILED",
          reasonCodes: ["STRATEGY_RUNTIME_WINDOW_COMPILATION_FAILED", ...array(compilation.reasons)],
          strategyInstanceId: instance.strategy_instance_id,
          strategyVersionId: version.strategy_version_id,
          instrument,
          timeframe,
          tradingDate: day.tradingDate,
          cutoffs: day.cutoffs.length,
          setupCount: compilation.setups.length,
        });
        await maybeRecordWindowEvaluation({ store, config, instance, version, instrument, timeframe, day, startedAtUtc, status: "FAILED", signalCount: 0, positionCount: 0, payload: { compilationIssues: compilation.reasons } });
        continue;
      }

      const simulation = runCanonicalSimulationV1({
        run_id: `window-replay:${config.runId}:${instance.strategy_instance_id}:${day.tradingDate}:chunk-${day.chunkIndex || 0}`,
        strategy_version_id: version.strategy_version_id,
        compiled_artifact: compilation.compiled_artifact,
        dataset: day.dataset,
        rows: day.rows,
        parameters: strategyRuntimeSimulationParameters(),
        reproducibility_seed: `window-replay:${version.strategy_version_id}:${config.runId}`,
        cutoff_utc: day.cutoffUtc,
        cutoff_paris: toParisIso(Date.parse(day.cutoffUtc)),
        run_started_at_utc: day.rows[0]?.timestamp_utc,
      });
      replayedInstanceWindows += 1;
      const instanceSignals = simulation.status === "COMPLETED"
        ? signalsFromWindowPositions({
          config,
          definition,
          version,
          instance,
          simulation,
          day,
          instrument,
          timeframe,
          setupById: compilation.setupById,
        })
        : [];
      signals.push(...instanceSignals);
      outcomes.push({
        status: simulation.status === "COMPLETED" ? "EVALUATED" : "FAILED",
        reasonCodes: simulation.status === "COMPLETED" ? ["WINDOW_REPLAY_EVALUATED"] : ["STRATEGY_RUNTIME_WINDOW_SIMULATION_FAILED", ...array(simulation.reasons)],
        strategyInstanceId: instance.strategy_instance_id,
        strategyVersionId: version.strategy_version_id,
        instrument,
        timeframe,
        tradingDate: day.tradingDate,
        cutoffs: day.cutoffs.length,
        setupCount: compilation.setups.length,
        positionCount: array(simulation.positions).length,
        signalCount: instanceSignals.length,
        metrics: simulation.metrics,
      });
      await maybeRecordWindowEvaluation({
        store,
        config,
        instance,
        version,
        instrument,
        timeframe,
        day,
        startedAtUtc,
        status: simulation.status === "COMPLETED" ? (instanceSignals.length ? "SIGNAL_CREATED" : "NO_SIGNAL") : "FAILED",
        signalCount: instanceSignals.length,
        positionCount: array(simulation.positions).length,
        payload: {
          simulationStatus: simulation.status,
          simulationRunId: simulation.run_id,
          metric: simulation.metrics,
          signalIds: instanceSignals.map((item) => item.signal_id),
          reasonCodes: simulation.reasons || [],
        },
      });
      }
    }
  }

  const published = config.persistSignals ? await publishWindowReplaySignals({ store, config, signals }) : [];
  const pipelineRuns = config.runPipeline ? await runWindowReplayPipeline({ store, config, signals }) : [];
  return summarizeWindowReplay({
    config,
    instances,
    outcomes,
    signals,
    published,
    pipelineRuns,
    replayedInstanceWindows,
    totalCutoffs,
    totalSetups,
  });
}

export function normalizeWindowReplayInput(input = {}) {
  const startUtc = requiredIso(firstDefined(input.start_utc, input.startUtc, input.from_utc, input.fromUtc), "start_utc");
  const endUtc = requiredIso(firstDefined(input.end_utc, input.endUtc, input.to_utc, input.toUtc), "end_utc");
  if (Date.parse(endUtc) <= Date.parse(startUtc)) throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_RANGE_INVALID", "Window replay end must be after start.");
  const sourceClass = String(firstDefined(input.source_class, input.sourceClass, DEFAULT_SOURCE_CLASS)).toUpperCase();
  if (sourceClass !== "CERTIFICATION_REPLAY") throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_SOURCE_CLASS_INVALID", "Window replay is only allowed as CERTIFICATION_REPLAY.");
  return {
    runId: String(firstDefined(input.run_id, input.runId, `window-cert-${new Date().toISOString().replace(/[:.]/g, "")}`)),
    startUtc,
    endUtc,
    sourceClass,
    executionModes: upperList(firstDefined(input.execution_modes, input.executionModes, DEFAULT_EXECUTION_MODE)),
    runtimeStates: upperList(firstDefined(input.runtime_states, input.runtimeStates, DEFAULT_RUNTIME_STATE)),
    instruments: upperList(firstDefined(input.instruments, input.instrument, input.instrument_scope, input.instrumentScope, "")),
    strategyInstanceIds: stringSet(firstDefined(input.strategy_instance_ids, input.strategyInstanceIds, "")),
    strategyVersionIds: stringSet(firstDefined(input.strategy_version_ids, input.strategyVersionIds, "")),
    timeframe: String(firstDefined(input.timeframe, "5")).replace(/^M/i, ""),
    limit: bounded(input.limit, 500, 1, 10_000),
    contextDays: bounded(input.context_days || input.contextDays, DEFAULT_CONTEXT_DAYS, 1, 45),
    persistSignals: bool(input.persist_signals ?? input.persistSignals, false),
    runPipeline: bool(input.run_pipeline ?? input.runPipeline, false),
    runTheoretical: bool(input.run_theoretical ?? input.runTheoretical, false),
    recordEvaluations: bool(input.record_evaluations ?? input.recordEvaluations, true),
    accountId: String(firstDefined(input.account_id, input.accountId, process.env.DESK_SHADOW_RUNTIME_ACCOUNT_ID, "shadow_live")),
    pipelineLimit: bounded(input.pipeline_limit || input.pipelineLimit, 500, 1, 500),
    maxSetupsPerPlan: bounded(input.max_setups_per_plan || input.maxSetupsPerPlan, 5, 1, 5),
  };
}

export function buildWindowRuntimeBindings({ config, baseBindings, cutoff, previousCutoff, cutoffIndex, runId = config?.runId } = {}) {
  const sourceSetup = array(baseBindings?.setups)[0];
  if (!sourceSetup) return null;
  const suffix = windowReplayCutoffSuffix(cutoff.timestamp_utc);
  const setupId = `${sourceSetup.setup_id || "runtime_setup"}__w${suffix}`;
  const setup = {
    ...sourceSetup,
    setup_id: setupId,
    rank: cutoffIndex + 1,
    metadata: {
      ...(sourceSetup.metadata || {}),
      window_replay_version: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
      window_replay_run_id: runId || null,
      window_replay_cutoff_utc: cutoff.timestamp_utc,
      window_replay_previous_cutoff_utc: previousCutoff?.timestamp_utc || null,
      window_replay_source_setup_id: sourceSetup.setup_id || null,
    },
  };
  return setup;
}

export function windowReplayCutoffSuffix(value) {
  return requiredIso(value, "cutoff_utc").replaceAll("-", "").replaceAll(":", "").replaceAll(".", "").replace("T", "t").replace("Z", "z");
}

export function deterministicWindowReplayUuid(seed) {
  const hex = canonicalSha256(seed).slice(0, 32);
  const variant = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function loadScopedInstances(store, config) {
  const items = await store.strategyKernel.listInstances({
    executionMode: config.executionModes.length === 1 ? config.executionModes[0] : null,
    runtimeState: config.runtimeStates.length === 1 ? config.runtimeStates[0] : null,
    limit: config.limit,
  });
  return items.filter((instance) => {
    const mode = String(instance.execution_mode || "").toUpperCase();
    const state = String(instance.runtime_state || "").toUpperCase();
    if (config.executionModes.length && !config.executionModes.includes(mode)) return false;
    if (config.runtimeStates.length && !config.runtimeStates.includes(state)) return false;
    if (config.strategyInstanceIds.size && !config.strategyInstanceIds.has(String(instance.strategy_instance_id))) return false;
    if (config.strategyVersionIds.size && !config.strategyVersionIds.has(String(instance.strategy_version_id))) return false;
    if (config.instruments.length) {
      const scope = array(instance.instrument_scope).map((item) => String(item).toUpperCase());
      if (!scope.some((instrument) => config.instruments.includes(instrument))) return false;
    }
    return true;
  });
}

async function loadWindowMarketData(pool, { instrument, timeframe, startUtc, endUtc, contextDays }) {
  const symbol = SYMBOL_BY_INSTRUMENT[instrument] || `${instrument}1!`;
  const result = await pool.query(`SELECT timestamp_utc,timestamp_paris,trading_date,open,high,low,close,volume,is_closed
    FROM market_candles
    WHERE symbol_code=$1
      AND timeframe=$2
      AND is_closed=true
      AND timestamp_utc >= $3::timestamptz - ($5::int || ' days')::interval
      AND timestamp_utc <= $4::timestamptz
    ORDER BY timestamp_utc`, [symbol, timeframe, startUtc, endUtc, contextDays]);
  const rows = result.rows.map((row) => marketRow(row, { instrument, symbol, timeframe }));
  const grouped = groupByTradingDate(rows);
  const targetDays = [...grouped.keys()].filter((date) => grouped.get(date).some((row) => inRange(row.timestamp_utc, startUtc, endUtc))).sort();
  return {
    instrument,
    symbol,
    timeframe,
    startUtc,
    endUtc,
    rowCount: rows.length,
    days: targetDays.map((tradingDate) => windowDay({ tradingDate, grouped, rows, instrument, symbol, timeframe, startUtc, endUtc, contextDays })),
  };
}

function windowDay({ tradingDate, grouped, rows, instrument, symbol, timeframe, startUtc, endUtc, contextDays }) {
  const dayRows = [...(grouped.get(tradingDate) || [])].filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(endUtc));
  const cutoffs = dayRows.filter((row) => inRange(row.timestamp_utc, startUtc, endUtc));
  const cutoffUtc = cutoffs.at(-1)?.timestamp_utc || dayRows.at(-1)?.timestamp_utc || endUtc;
  const firstDayMs = Date.parse(`${tradingDate}T00:00:00.000Z`) - contextDays * 86_400_000;
  const contextRows = rows.filter((row) => {
    const rowDateMs = Date.parse(`${row.trading_date}T00:00:00.000Z`);
    return rowDateMs >= firstDayMs && rowDateMs <= Date.parse(`${tradingDate}T00:00:00.000Z`) && Date.parse(row.timestamp_utc) <= Date.parse(cutoffUtc);
  });
  const identity = { symbol, timeframe, tradingDate, cutoffUtc, rows: dayRows.length, version: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION };
  const dataset = datasetForRows({ identity, rows: dayRows, cutoffUtc });
  return { tradingDate, instrument, symbol, timeframe, rows: dayRows, contextRows, cutoffs, cutoffUtc, dataset };
}

function windowDayChunks(day, config) {
  const chunks = [];
  for (let index = 0; index < day.cutoffs.length; index += config.maxSetupsPerPlan) {
    const cutoffs = day.cutoffs.slice(index, index + config.maxSetupsPerPlan);
    const cutoffUtc = cutoffs.at(-1)?.timestamp_utc || day.cutoffUtc;
    const rows = day.rows.filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(cutoffUtc));
    const contextRows = day.contextRows.filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(cutoffUtc));
    const identity = {
      symbol: day.symbol,
      timeframe: day.timeframe,
      tradingDate: day.tradingDate,
      cutoffUtc,
      rows: rows.length,
      chunkIndex: chunks.length,
      version: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
    };
    chunks.push({
      ...day,
      rows,
      contextRows,
      cutoffs,
      cutoffUtc,
      chunkIndex: chunks.length,
      chunkCount: Math.ceil(day.cutoffs.length / config.maxSetupsPerPlan),
      dataset: datasetForRows({ identity, rows, cutoffUtc }),
    });
  }
  return chunks;
}

function compileWindowRuntimeArtifact({ config, definition, version, dsl, instance, day, instrument, timeframe }) {
  const setups = [];
  const setupById = new Map();
  const cutoffRows = new Map(day.rows.map((row, index) => [row.timestamp_utc, { row, index }]));
  for (const [index, cutoff] of day.cutoffs.entries()) {
    const dayIndex = cutoffRows.get(cutoff.timestamp_utc)?.index ?? 0;
    const previousCutoff = day.rows[Math.max(0, dayIndex - 1)] || null;
    const marketAtCutoff = marketAtCutoffForDay(day, cutoff.timestamp_utc);
    const dataDrivenBindings = buildDataDrivenLiveRuntimeBindings({ version, dsl, instance, market: marketAtCutoff, instrument });
    if (!dataDrivenBindings.ok) continue;
    const setup = buildWindowRuntimeBindings({
      config,
      baseBindings: dataDrivenBindings.runtime_bindings,
      cutoff,
      previousCutoff,
      cutoffIndex: index,
      runId: config.runId,
    });
    if (!setup) continue;
    setups.push(setup);
    setupById.set(setup.setup_id, { setup, cutoff: cutoff.timestamp_utc, previousCutoff: previousCutoff?.timestamp_utc || null, market: marketAtCutoff });
  }
  if (!setups.length) return { ok: false, reasons: ["WINDOW_RUNTIME_NO_COMPILABLE_SETUPS"], setups, setupById };
  const runtimeBindings = {
    valid_from_paris: setups[0].valid_from_paris || day.rows[0]?.timestamp_paris,
    expires_at_paris: setups.at(-1).expires_at_paris || toParisIso(Date.parse(day.cutoffUtc)),
    cutoff_paris: toParisIso(Date.parse(day.cutoffUtc)),
    pack_id: day.dataset.dataset_id,
    pack_build_id: day.dataset.dataset_hash,
    plan_id: `window_runtime_plan_${instance.strategy_instance_id}_${day.tradingDate}_${canonicalSha256({ runId: config.runId, setups: setups.length }).slice(0, 10)}`,
    session: "canonical_strategy_runtime_window_replay",
    trading_date: day.tradingDate,
    setup_id_prefix: `window_runtime_${instance.strategy_instance_id}`,
    setups,
    metadata: {
      window_replay_version: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
      window_replay_run_id: config.runId,
      source_class: config.sourceClass,
      setup_count: setups.length,
    },
  };
  const compilation = compileStrategyVersionToDeterministicPlanV1({
    strategy_definition: definition,
    strategy_version: { ...version, dsl_source: canonicalJson(dsl) },
    dsl_source: dsl,
    runtime_bindings: runtimeBindings,
    scope: {
      trading_date: day.tradingDate,
      session: "canonical_strategy_runtime_window_replay",
      cutoff_utc: day.cutoffUtc,
      cutoff_paris: toParisIso(Date.parse(day.cutoffUtc)),
      strategy_id: definition.external_key,
      pack_id: day.dataset.dataset_id,
      pack_build_id: day.dataset.dataset_hash,
    },
    source_mode: String(instance.execution_mode || DEFAULT_EXECUTION_MODE).toUpperCase(),
  });
  return {
    ok: compilation.ok,
    reasons: compilation.reasons,
    setups,
    setupById,
    runtimeBindings,
    compiled_artifact: compilation.compiled_artifact,
    compilation,
  };
}

export function signalsFromWindowPositions({ config, definition, version, instance, simulation, day, instrument, timeframe, setupById }) {
  const result = [];
  for (const position of array(simulation.positions)) {
    const metadata = setupById.get(position.setup_id);
    if (!metadata) continue;
    const publicationUtc = iso(metadata.cutoff);
    const entryUtc = iso(firstDefined(position.entry_row?.timestamp_utc, position.entry_time));
    if (!publicationUtc || !entryUtc) continue;
    if (!inRange(entryUtc, config.startUtc, config.endUtc)) continue;
    const publicationMs = Date.parse(publicationUtc);
    const entryMs = Date.parse(entryUtc);
    if (entryMs < publicationMs) continue;
    if (entryMs >= publicationMs + STRATEGY_SIGNAL_TTL_MS) continue;
    const signalId = deterministicWindowReplayUuid({
      run_id: config.runId,
      strategy_instance_id: instance.strategy_instance_id,
      setup_id: position.setup_id,
      entry_utc: entryUtc,
    });
    const evaluationId = `strategy_eval_window_${canonicalSha256({ run_id: config.runId, signal_id: signalId }).slice(0, 24)}`;
    const correlationId = `window-replay:${config.runId}:${instance.strategy_instance_id}:${windowReplayCutoffSuffix(metadata.cutoff)}`;
    const signal = strategySignalFromRuntimePosition({
      signalId,
      correlationId,
      definition,
      version,
      instance,
      candidate: position,
      market: metadata.market,
      timeframe,
      evaluationId,
      sourceClass: config.sourceClass,
      certificationRunId: config.runId,
    });
    result.push({
      ...signal,
      signal_outbox_id: deterministicWindowReplayUuid({ run_id: config.runId, signal_id: signalId, outbox: true }),
      causation_id: evaluationId,
      window_replay: {
        run_id: config.runId,
        trading_date: day.tradingDate,
        cutoff_utc: metadata.cutoff,
        previous_cutoff_utc: metadata.previousCutoff,
        position_id: position.position_id,
        position_status: position.status,
        exit_reason: position.exit_reason || null,
        r_result: position.r_result ?? position.unrealized_r ?? null,
      },
    });
  }
  return result;
}

async function publishWindowReplaySignals({ store, config, signals }) {
  const published = [];
  for (const signal of signals) {
    const result = await store.publishStrategyV2Signal({
      input: {
        ...signal,
        source_class: config.sourceClass,
        certification_run_id: config.runId,
        idempotency_key: `window-replay-signal:${config.runId}:${signal.signal_id}`,
      },
      actor: { kind: "strategy-runtime-window-replay" },
    });
    published.push({
      signal_id: result.signal?.signal_id || signal.signal_id,
      outbox_id: result.outbox?.signal_outbox_id || signal.signal_outbox_id || null,
      status: result.status,
    });
  }
  return published;
}

async function runWindowReplayPipeline({ store, config, signals }) {
  if (!signals.length) return [];
  const service = createStrategySignalDecisionPipelineService({ store });
  const cutoffs = [...new Set(signals.map((signal) => signal.window_replay?.cutoff_utc || signal.source_data_cutoff_utc).filter(Boolean))].sort();
  const runs = [];
  for (const cutoff of cutoffs) {
    const result = await service.runOnce({
      now_utc: cutoff,
      limit: config.pipelineLimit,
      account_id: config.accountId,
      source_classes: [config.sourceClass],
      execution_modes: config.executionModes,
      certification_run_id: config.runId,
      consumer_id: `strategy-runtime-window-replay:${config.runId}`,
      idempotency_key: `strategy-runtime-window-replay:${config.runId}:${cutoff}`,
    });
    const theoretical = config.runTheoretical && typeof store.execution?.processTheoreticalExecution === "function"
      ? await store.execution.processTheoreticalExecution({
        entryLimit: config.pipelineLimit,
        exitLimit: config.pipelineLimit,
        nowUtc: cutoff,
        portfolioOrderIntentIds: result.order_intent_ids || [],
      })
      : null;
    runs.push({ ...result, theoretical });
  }
  return runs;
}

async function maybeRecordWindowEvaluation({ store, config, instance, version, instrument, timeframe, day, startedAtUtc, status, signalCount, positionCount, payload }) {
  if (!config.recordEvaluations || !store.strategyEvaluations) return null;
  return store.strategyEvaluations.record({
    strategy_instance_id: instance.strategy_instance_id,
    strategy_version_id: version.strategy_version_id || instance.strategy_version_id,
    source_class: config.sourceClass,
    certification_run_id: config.runId,
    status,
    scheduler_run_key: `window-replay:${config.runId}:${instance.strategy_instance_id}:${day.tradingDate}:chunk-${day.chunkIndex || 0}`,
    correlation_id: `window-replay:${config.runId}:${instance.strategy_instance_id}:${day.tradingDate}:chunk-${day.chunkIndex || 0}`,
    causation_id: null,
    artifact_version: version.compiled_artifact_hash || version.runtime_contract_bundle_version || null,
    instrument,
    timeframe,
    source_data_cutoff_utc: day.cutoffUtc,
    started_at_utc: startedAtUtc,
    completed_at_utc: new Date().toISOString(),
    next_evaluation_at_utc: null,
    signal_id: signalCount === 1 ? payload?.signalIds?.[0] || null : null,
    reason_codes: status === "SIGNAL_CREATED" ? ["WINDOW_REPLAY_SIGNAL_CREATED"] : status === "NO_SIGNAL" ? ["WINDOW_REPLAY_NO_SIGNAL"] : ["WINDOW_REPLAY_FAILED"],
    payload: {
      availability: status === "FAILED" ? "DEGRADED" : "KNOWN",
      windowReplayVersion: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
      runId: config.runId,
      tradingDate: day.tradingDate,
      chunkIndex: day.chunkIndex || 0,
      chunkCount: day.chunkCount || 1,
      cutoffs: day.cutoffs.length,
      signalCount,
      positionCount,
      ...payload,
    },
  });
}

function summarizeWindowReplay({ config, instances, outcomes, signals, published, pipelineRuns, replayedInstanceWindows, totalCutoffs, totalSetups }) {
  const byInstrument = {};
  const byDay = {};
  let totalR = 0;
  for (const signal of signals) {
    const instrument = signal.instrument || "UNKNOWN";
    const day = signal.window_replay?.trading_date || "UNKNOWN";
    byInstrument[instrument] ||= { signal_count: 0, total_r: 0 };
    byDay[day] ||= { signal_count: 0, total_r: 0 };
    const r = finite(signal.window_replay?.r_result) || 0;
    byInstrument[instrument].signal_count += 1;
    byInstrument[instrument].total_r = round(byInstrument[instrument].total_r + r);
    byDay[day].signal_count += 1;
    byDay[day].total_r = round(byDay[day].total_r + r);
    totalR = round(totalR + r);
  }
  return {
    status: outcomes.some((item) => item.status === "FAILED") ? "DEGRADED" : "DONE",
    schema_version: "strategy_runtime_window_replay_result_v1",
    replay_version: STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
    run_id: config.runId,
    window: { start_utc: config.startUtc, end_utc: config.endUtc },
    source_class: config.sourceClass,
    execution_modes: config.executionModes,
    instruments: config.instruments,
    instances_seen: instances.length,
    replayed_instance_days: replayedInstanceWindows,
    replayed_instance_windows: replayedInstanceWindows,
    cutoff_evaluations_virtual: totalCutoffs,
    setup_count: totalSetups,
    signal_count: signals.length,
    published_signal_count: published.length,
    pipeline_run_count: pipelineRuns.length,
    pipeline_human_gate_count: pipelineRuns.reduce((sum, item) => sum + Number(item.human_gate_count || 0), 0),
    theoretical_materialized_count: pipelineRuns.reduce((sum, item) => sum + Number(item.theoretical?.materialized || 0), 0),
    total_r: round(totalR),
    by_instrument: byInstrument,
    by_day: byDay,
    outcomes,
    signals,
    published,
    pipeline_runs: pipelineRuns,
  };
}

function marketAtCutoffForDay(day, cutoffUtc) {
  const rows = day.rows.filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(cutoffUtc));
  const contextRows = day.contextRows.filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(cutoffUtc));
  const identity = { symbol: day.symbol, timeframe: day.timeframe, tradingDate: day.tradingDate, cutoffUtc, rows: rows.length };
  return {
    rows,
    contextRows,
    cutoffUtc,
    tradingDate: day.tradingDate,
    dataset: {
      dataset_id: `window_runtime_cutoff_dataset_${canonicalSha256(identity).slice(0, 24)}`,
      dataset_hash: `sha256:${canonicalSha256({ identity, first: rows[0], last: rows.at(-1) })}`,
      sealed: true,
      sealed_at_utc: cutoffUtc,
      cutoff_utc: cutoffUtc,
      cutoff_paris: toParisIso(Date.parse(cutoffUtc)),
      time_range: {
        from_utc: rows[0]?.timestamp_utc || null,
        to_utc: cutoffUtc,
        to_paris: toParisIso(Date.parse(cutoffUtc)),
      },
      rows,
    },
  };
}

function datasetForRows({ identity, rows, cutoffUtc }) {
  return {
    dataset_id: `window_runtime_dataset_${canonicalSha256(identity).slice(0, 24)}`,
    dataset_hash: `sha256:${canonicalSha256({ identity, first: rows[0], last: rows.at(-1) })}`,
    sealed: true,
    sealed_at_utc: cutoffUtc,
    cutoff_utc: cutoffUtc,
    cutoff_paris: toParisIso(Date.parse(cutoffUtc)),
    time_range: {
      from_utc: rows[0]?.timestamp_utc || null,
      to_utc: cutoffUtc,
      to_paris: toParisIso(Date.parse(cutoffUtc)),
    },
    rows,
  };
}

function strategyVersionDsl(version = {}) {
  const source = firstDefined(version.metadata?.dsl_source, version.dsl_source);
  if (!source) return null;
  if (source && typeof source === "object" && !Array.isArray(source)) return source;
  try {
    const parsed = JSON.parse(String(source));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function skippedOutcome(instance, version, definition, instrument, timeframe, reason) {
  return {
    status: "SKIPPED",
    reasonCodes: [reason],
    strategyInstanceId: instance.strategy_instance_id,
    strategyVersionId: version?.strategy_version_id || instance.strategy_version_id,
    strategyDefinitionId: definition?.strategy_definition_id || version?.strategy_definition_id || null,
    instrument,
    timeframe,
    tradingDate: null,
    cutoffs: 0,
    setupCount: 0,
    positionCount: 0,
    signalCount: 0,
  };
}

function scopedInstrument(instance, definition, config) {
  const scope = array(instance.instrument_scope).map((item) => String(item).toUpperCase());
  if (config.instruments.length) return scope.find((item) => config.instruments.includes(item)) || config.instruments[0];
  return scope[0] || String(definition.default_instruments?.[0] || "MNQ").toUpperCase();
}

function marketRow(row, { instrument, symbol, timeframe }) {
  return {
    instrument,
    symbol,
    timeframe: `M${timeframe}`,
    trading_date: row.trading_date,
    time: row.timestamp_paris || toParisIso(Date.parse(row.timestamp_utc)),
    timestamp_utc: requiredIso(row.timestamp_utc, "timestamp_utc"),
    timestamp_paris: row.timestamp_paris || toParisIso(Date.parse(row.timestamp_utc)),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
    is_closed: true,
  };
}

function groupByTradingDate(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.timestamp_utc.slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for (const [key, items] of grouped.entries()) grouped.set(key, items.sort((left, right) => Date.parse(left.timestamp_utc) - Date.parse(right.timestamp_utc)));
  return grouped;
}

async function cached(map, key, loader) {
  if (!map.has(key)) map.set(key, await loader(key));
  return map.get(key);
}

function templateTimeframe(dsl) {
  const value = String(array(dsl?.setup_templates)[0]?.timeframe || "M5").toUpperCase();
  return value.replace(/^M/, "");
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function array(value) { return Array.isArray(value) ? value : []; }
function finite(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function round(value) { return Math.round(Number(value || 0) * 10_000) / 10_000; }
function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}
function bounded(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}
function upperList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}
function stringSet(value) {
  return new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((item) => String(item).trim()).filter(Boolean));
}
function inRange(value, startUtc, endUtc) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(startUtc) && time <= Date.parse(endUtc);
}
function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function requiredIso(value, field) {
  const normalized = iso(value);
  if (!normalized) throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_TIMESTAMP_INVALID", `Invalid timestamp: ${field}.`);
  return normalized;
}
function coded(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.retryable = false;
  return error;
}
