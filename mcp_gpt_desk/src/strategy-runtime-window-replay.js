import {
  STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
  loadScopedInstances,
  publishWindowReplaySignals,
  runWindowReplayPipeline,
  summarizeWindowReplay,
} from "./strategy-runtime-window-replay-workflow.js";
import { evaluateWindowReplayInstances } from "./strategy-runtime-window-replay-evaluator.js";
import {
  bool,
  bounded,
  coded,
  firstDefined,
  requiredIso,
  stringSet,
  upperList,
} from "./strategy-runtime-window-replay-values.js";

export {
  STRATEGY_RUNTIME_WINDOW_REPLAY_VERSION,
  buildWindowRuntimeBindings,
  deterministicWindowReplayUuid,
  signalsFromWindowPositions,
  windowReplayCutoffSuffix,
} from "./strategy-runtime-window-replay-workflow.js";

const DEFAULT_SOURCE_CLASS = "CERTIFICATION_REPLAY";
const DEFAULT_EXECUTION_MODE = "SHADOW";
const DEFAULT_RUNTIME_STATE = "RUNNING";
const DEFAULT_CONTEXT_DAYS = 15;

export async function runStrategyRuntimeWindowReplay({ store, input = {} } = {}) {
  if (!store?.persistence?.pool || !store?.strategyKernel) {
    throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_DEPENDENCY_MISSING", "Strategy runtime window replay requires PostgreSQL and Strategy Kernel.");
  }
  const config = normalizeWindowReplayInput(input);
  await store.persistence.initialized;
  const instances = await loadScopedInstances(store, config);
  const evaluation = await evaluateWindowReplayInstances({ store, config, instances });
  const published = config.persistSignals
    ? await publishWindowReplaySignals({ store, config, signals: evaluation.signals })
    : [];
  const pipelineRuns = config.runPipeline
    ? await runWindowReplayPipeline({ store, config, signals: evaluation.signals })
    : [];
  return summarizeWindowReplay({
    config,
    instances,
    outcomes: evaluation.outcomes,
    signals: evaluation.signals,
    published,
    pipelineRuns,
    replayedInstanceWindows: evaluation.replayedInstanceWindows,
    totalCutoffs: evaluation.totalCutoffs,
    totalSetups: evaluation.totalSetups,
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
