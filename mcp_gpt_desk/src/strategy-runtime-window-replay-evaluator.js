import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { strategyRuntimeSimulationParameters } from "./canonical-strategy-evaluation-scheduler.js";
import {
  cached,
  compileWindowRuntimeArtifact,
  loadWindowMarketData,
  maybeRecordWindowEvaluation,
  scopedInstrument,
  signalsFromWindowPositions,
  skippedOutcome,
  strategyVersionDsl,
  windowDayChunks,
} from "./strategy-runtime-window-replay-workflow.js";

export async function evaluateWindowReplayInstances({ store, config, instances }) {
  const state = emptyReplayEvaluation();
  const caches = new Map();
  const definitions = new Map();
  const versions = new Map();
  for (const instance of instances) {
    await evaluateReplayInstance({
      caches,
      config,
      definitions,
      instance,
      state,
      store,
      versions,
    });
  }
  return state;
}

async function evaluateReplayInstance({ caches, config, definitions, instance, state, store, versions }) {
  const version = await cached(versions, instance.strategy_version_id, (id) => store.strategyKernel.getVersion(id));
  const definition = await cached(definitions, version.strategy_definition_id, (id) => store.strategyKernel.getDefinition(id));
  const dsl = strategyVersionDsl(version);
  const instrument = scopedInstrument(instance, definition, config);
  const timeframe = templateTimeframe(dsl) || config.timeframe;
  const market = await cached(caches, `${instrument}:${timeframe}`, () => loadWindowMarketData(store.persistence.pool, {
    instrument,
    timeframe,
    startUtc: config.startUtc,
    endUtc: config.endUtc,
    contextDays: config.contextDays,
  }));
  if (!dsl) return skipReplayInstance(state, instance, version, definition, instrument, timeframe, "STRATEGY_DSL_SOURCE_MISSING");
  if (!market.days.length) return skipReplayInstance(state, instance, version, definition, instrument, timeframe, "MARKET_WINDOW_EMPTY");
  for (const sourceDay of market.days) {
    if (!sourceDay.cutoffs.length) continue;
    await evaluateReplayDay({ config, definition, dsl, instance, marketDay: sourceDay, state, store, timeframe, version, instrument });
  }
}

function skipReplayInstance(state, instance, version, definition, instrument, timeframe, reason) {
  state.outcomes.push(skippedOutcome(instance, version, definition, instrument, timeframe, reason));
}

async function evaluateReplayDay({ config, definition, dsl, instance, instrument, marketDay, state, store, timeframe, version }) {
  for (const day of windowDayChunks(marketDay, config)) {
    const result = await evaluateReplayChunk({ config, definition, dsl, instance, day, instrument, store, timeframe, version });
    state.totalCutoffs += result.cutoffs;
    state.totalSetups += result.setups;
    state.replayedInstanceWindows += result.replayed;
    state.outcomes.push(result.outcome);
    state.signals.push(...result.signals);
  }
}

async function evaluateReplayChunk({ config, definition, dsl, instance, day, instrument, store, timeframe, version }) {
  const startedAtUtc = new Date().toISOString();
  const compilation = compileWindowRuntimeArtifact({ config, definition, version, dsl, instance, day, instrument, timeframe });
  if (!compilation.ok) {
    const outcome = failedCompilationOutcome({ compilation, day, instance, instrument, timeframe, version });
    await recordFailedCompilation({ compilation, config, day, instance, instrument, startedAtUtc, store, timeframe, version });
    return { cutoffs: day.cutoffs.length, setups: compilation.setups.length, replayed: 0, outcome, signals: [] };
  }
  return evaluateCompiledReplayChunk({
    compilation,
    config,
    day,
    definition,
    instance,
    instrument,
    startedAtUtc,
    store,
    timeframe,
    version,
  });
}

function failedCompilationOutcome({ compilation, day, instance, instrument, timeframe, version }) {
  return {
    status: "FAILED",
    reasonCodes: ["STRATEGY_RUNTIME_WINDOW_COMPILATION_FAILED", ...array(compilation.reasons)],
    strategyInstanceId: instance.strategy_instance_id,
    strategyVersionId: version.strategy_version_id,
    instrument,
    timeframe,
    tradingDate: day.tradingDate,
    cutoffs: day.cutoffs.length,
    setupCount: compilation.setups.length,
  };
}

async function recordFailedCompilation({ compilation, config, day, instance, instrument, startedAtUtc, store, timeframe, version }) {
  await maybeRecordWindowEvaluation({
    store,
    config,
    instance,
    version,
    instrument,
    timeframe,
    day,
    startedAtUtc,
    status: "FAILED",
    signalCount: 0,
    positionCount: 0,
    payload: { compilationIssues: compilation.reasons },
  });
}

async function evaluateCompiledReplayChunk({ compilation, config, day, definition, instance, instrument, startedAtUtc, store, timeframe, version }) {
  const simulation = simulateReplayChunk({ compilation, config, day, instance, version });
  const signals = simulation.status === "COMPLETED"
    ? signalsFromWindowPositions({ config, definition, version, instance, simulation, day, instrument, timeframe, setupById: compilation.setupById })
    : [];
  const outcome = simulationOutcome({ compilation, day, instance, instrument, signals, simulation, timeframe, version });
  await recordSimulationEvaluation({ config, day, instance, instrument, outcome, signals, simulation, startedAtUtc, store, timeframe, version });
  return { cutoffs: day.cutoffs.length, setups: compilation.setups.length, replayed: 1, outcome, signals };
}

function simulateReplayChunk({ compilation, config, day, instance, version }) {
  return runCanonicalSimulationV1({
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
}

function simulationOutcome({ compilation, day, instance, instrument, signals, simulation, timeframe, version }) {
  const completed = simulation.status === "COMPLETED";
  return {
    status: completed ? "EVALUATED" : "FAILED",
    reasonCodes: completed ? ["WINDOW_REPLAY_EVALUATED"] : ["STRATEGY_RUNTIME_WINDOW_SIMULATION_FAILED", ...array(simulation.reasons)],
    strategyInstanceId: instance.strategy_instance_id,
    strategyVersionId: version.strategy_version_id,
    instrument,
    timeframe,
    tradingDate: day.tradingDate,
    cutoffs: day.cutoffs.length,
    setupCount: compilation.setups.length,
    positionCount: array(simulation.positions).length,
    signalCount: signals.length,
    metrics: simulation.metrics,
  };
}

async function recordSimulationEvaluation({ config, day, instance, instrument, outcome, signals, simulation, startedAtUtc, store, timeframe, version }) {
  await maybeRecordWindowEvaluation({
    store,
    config,
    instance,
    version,
    instrument,
    timeframe,
    day,
    startedAtUtc,
    status: simulation.status === "COMPLETED" ? (signals.length ? "SIGNAL_CREATED" : "NO_SIGNAL") : "FAILED",
    signalCount: signals.length,
    positionCount: outcome.positionCount,
    payload: {
      simulationStatus: simulation.status,
      simulationRunId: simulation.run_id,
      metric: simulation.metrics,
      signalIds: signals.map((item) => item.signal_id),
      reasonCodes: simulation.reasons || [],
    },
  });
}

function emptyReplayEvaluation() {
  return {
    outcomes: [],
    replayedInstanceWindows: 0,
    signals: [],
    totalCutoffs: 0,
    totalSetups: 0,
  };
}

function templateTimeframe(dsl) {
  return String(array(dsl?.setup_templates)[0]?.timeframe || "M5").toUpperCase().replace(/^M/, "");
}

function array(value) { return Array.isArray(value) ? value : []; }
