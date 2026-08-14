import {
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
  canonicalJson,
} from "@tv-automation/desk-domain";
import { buildMetrics, finalizeResult, runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { buildResearchEvaluation } from "./demo-paper-autonomous-records.js";
import { enqueueResearchAgentTask, stableResearchTaskIds } from "./research-agent-task-queue.js";
import {
  RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
  RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
  canonicalTaskId,
  coded,
  number,
  object,
  requiredText,
  researchStrategyIterationGeneratorSlug,
  sha256Text,
  text,
} from "./research-strategy-iteration-common.js";

const CURRENT_GENERATOR_REVIEW_PRIORITY = 34;

export async function materializeResearchStrategyIterationVariant({ store, context, variant, sourceCandidate, task, nowUtc }) {
  const seed = buildVariantSeed({ context, variant, sourceCandidate, nowUtc });
  const command = commandContext({ seed, task, nowUtc });
  await registerDefinition(store, seed, command);
  await registerVersion(store, seed, command);
  const simulation = await runVariantSimulation({ store, seed, context, command });
  const compilation = simulation.primaryCompilation;
  const registered = await registerSimulation(store, seed, context.dataset, simulation, compilation, command);
  const research = await registerResearch(store, seed, registered.run, simulation, command);
  const agentTask = await enqueueReviewTask(store.persistence.pool, { seed, registered, research, task, nowUtc });
  return variantResult({ variant, seed, registered, simulation, agentTask });
}

function buildVariantSeed({ context, variant, sourceCandidate, nowUtc }) {
  const dsl = variantStrategyDsl({ scope: context.scope, variant });
  const timestamp = variant.created_at_utc || nowUtc;
  return {
    ids: {
      definitionId: variant.strategy_definition_id,
      versionId: variant.strategy_version_id,
      instanceId: variant.strategy_instance_id,
      simulationRunId: variant.simulation_run_id,
      experimentId: variant.research_experiment_id,
      hypothesisId: variant.research_hypothesis_id,
      candidateId: variant.research_candidate_id,
      reportId: variant.research_evaluation_report_id,
    },
    scope: context.scope,
    dataset: context.dataset,
    sourceCandidate,
    variant,
    timestamp,
    dsl,
    dslText: canonicalJson(dsl),
    runtimeBindings: variantRuntimeBindings({ dataset: context.dataset, scope: context.scope, variant }),
    parameters: simulationParameters(),
  };
}

function variantStrategyDsl({ scope, variant }) {
  const base = {
    instrument: scope.instrument,
    timeframe: "M5",
    rr_minimum: variant.parameters.rr_minimum,
    risk_pct: 0.25,
    order_type: variant.parameters.order_type || "LIMIT",
    tolerance_points: variant.parameters.tolerance_points,
    max_bars: variant.parameters.max_bars,
    require_rejection_confirmation: false,
  };
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [
      { ...base, template_id: `${variant.variant_label}_long_retest`, direction: "long", rank: 1 },
      { ...base, template_id: `${variant.variant_label}_short_retest`, direction: "short", rank: 2 },
    ],
    metadata: { source: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION, variant_id: variant.variant_id },
  };
}

function variantRuntimeBindings({ dataset, scope, variant }) {
  const runtimeSetups = Array.isArray(variant.runtime_setups) && variant.runtime_setups.length
    ? variant.runtime_setups
    : [
      { template_id: `${variant.variant_label}_long_retest`, instrument: scope.instrument, ...variant.levels.long },
      { template_id: `${variant.variant_label}_short_retest`, instrument: scope.instrument, ...variant.levels.short },
    ];
  return {
    valid_from_paris: toParisIso(Date.parse(scope.start_utc)),
    expires_at_paris: dataset.cutoff_paris,
    cutoff_paris: dataset.cutoff_paris,
    pack_id: dataset.dataset_key,
    pack_build_id: dataset.dataset_id,
    plan_id: `plan__${variant.strategy_version_id}`,
    session: "demo_paper_research",
    trading_date: scope.start_utc.slice(0, 10),
    setup_id_prefix: `demo_paper_iter_${variant.iteration_index}`,
    setups: runtimeSetups,
  };
}

async function registerDefinition(store, seed, command) {
  const existing = await findExistingDefinition(store, seed.ids.definitionId);
  if (existing) {
    return { status: "EXISTING_SOURCE_DEFINITION", definition: existing };
  }
  return store.strategyKernel.registerDefinition({
    strategy_definition_id: seed.ids.definitionId,
    external_key: strategyExternalKey(seed),
    name: `Demo Paper ${seed.scope.instrument} Iteration ${seed.variant.iteration_index} ${seed.variant.variant_label}`,
    description: "Variante déterministe générée par la boucle autonome research demo-paper.",
    owner: "desk-research",
    asset_class: "FUTURES",
    default_instruments: [seed.scope.instrument],
    tags: ["demo-paper", "research-iteration", "breakout-retest"],
    metadata: { ...seed.variant.metadata, dataset_key: seed.dataset.dataset_key },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function findExistingDefinition(store, strategyDefinitionId) {
  if (!store.strategyKernel.getDefinition) return null;
  try {
    return await store.strategyKernel.getDefinition(strategyDefinitionId);
  } catch (error) {
    if (error?.code === "STRATEGY_DEFINITION_NOT_FOUND") return null;
    throw error;
  }
}

async function registerVersion(store, seed, command) {
  return store.strategyKernel.registerVersion({
    strategy_version_id: seed.ids.versionId,
    strategy_definition_id: seed.ids.definitionId,
    version_label: `${seed.variant.iteration_index}.${variantOrdinal(seed.variant.variant_label)}.0`,
    status: "VALIDATED",
    dsl_source_hash: sha256Text(seed.dslText),
    compiled_artifact_ref: `strategy://demo-paper/${seed.ids.versionId}/compiled-artifact`,
    compiled_artifact_hash: null,
    validated_metrics_ref: seed.ids.simulationRunId,
    runtime_contract_bundle_version: "deterministic_execution_plan_v1_4",
    metadata: {
      dsl_source: seed.dsl,
      validation_scope: "one_month_cumulative_demo_paper",
      research_candidate_id: seed.ids.candidateId,
    },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function compileVersion(store, seed, command, runtimeBindings = seed.runtimeBindings, scope = compileScope(seed)) {
  const result = await store.strategyKernel.compileVersion({
    strategy_version_id: seed.ids.versionId,
    dsl_source: seed.dslText,
    runtime_bindings: runtimeBindings,
    scope,
    source_mode: "PAPER",
  }, command);
  if (result.status !== "COMPILED") {
    throw coded("RESEARCH_ITERATION_STRATEGY_COMPILE_REJECTED", "Strategy iteration cannot compile.", false, {
      reasons: result.compilation?.reasons,
    });
  }
  return result;
}

async function runVariantSimulation({ store, seed, context, command }) {
  const shards = variantSimulationShards(seed, context);
  if (shards.length <= 1) {
    const runtimeBindings = shards[0]?.runtimeBindings || seed.runtimeBindings;
    const compilation = await compileVersion(store, seed, command, runtimeBindings, compileScope(seed, shards[0]));
    const simulation = runShardSimulation({ seed, context, compilation, shard: shards[0] || null });
    return simulationWithResearchMetadata(simulation, { primaryCompilation: compilation, shardCount: 1 });
  }
  const shardResults = [];
  let primaryCompilation = null;
  for (const shard of shards) {
    const compilation = await compileVersion(store, seed, command, shard.runtimeBindings, compileScope(seed, shard));
    if (!primaryCompilation) primaryCompilation = compilation;
    shardResults.push(runShardSimulation({ seed, context, compilation, shard }));
  }
  return aggregateShardSimulations({ seed, context, shardResults, primaryCompilation });
}

function runShardSimulation({ seed, context, compilation, shard }) {
  return runCanonicalSimulationV1({
    run_id: variantRunKey(seed, shard),
    strategy_version_id: seed.ids.versionId,
    compiled_artifact: compilation.compilation.compiled_artifact,
    dataset: simulationDataset(context.dataset, context.rows),
    rows: context.rows,
    parameters: seed.parameters,
    reproducibility_seed: `${RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION}:${seed.variant.variant_id}:${shard?.shard_id || "single"}`,
    cutoff_utc: shard?.cutoff_utc || context.dataset.cutoff_utc,
    cutoff_paris: shard?.cutoff_paris || context.dataset.cutoff_paris,
    run_started_at_utc: shard?.start_utc || context.dataset.time_range_start_utc,
  });
}

function aggregateShardSimulations({ seed, context, shardResults, primaryCompilation }) {
  const positions = shardResults.flatMap((result) => Array.isArray(result.positions) ? result.positions : []);
  const events = [
    { event_id: `evt_research_sharded_started_${seed.ids.simulationRunId.slice(0, 8)}`, type: "RESEARCH_SHARDED_SIMULATION_STARTED", payload: { shard_count: shardResults.length } },
    ...shardResults.flatMap((result, index) => (Array.isArray(result.events) ? result.events : []).map((item) => ({
      ...item,
      payload: { ...(item.payload || {}), research_shard_index: index + 1 },
    }))),
  ];
  return simulationWithResearchMetadata(finalizeResult({
    schema_version: shardResults[0]?.schema_version || "canonical_simulation_result_v1",
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: shardResults[0]?.simulation_engine_version || "1.0.0",
    run_id: variantRunKey(seed),
    strategy_version_id: seed.ids.versionId,
    dataset_id: context.dataset.dataset_id,
    dataset_hash: context.dataset.content_hash,
    parameters_hash: shardResults[0]?.parameters_hash || `sha256:${sha256Text(JSON.stringify(seed.parameters)).replace(/^sha256:/, "")}`,
    reproducibility_seed: `${RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION}:${seed.variant.variant_id}:sharded`,
    cutoff: context.dataset.cutoff_paris,
    run_started_at_utc: context.dataset.time_range_start_utc,
    status: shardResults.some((item) => item.status === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : "COMPLETED",
    data_quality: {
      input_rows: context.rows.length,
      consumed_rows: Math.max(...shardResults.map((item) => item.data_quality?.consumed_rows || 0), 0),
      ignored_post_cutoff_rows: 0,
      cutoff_enforced: true,
      shard_count: shardResults.length,
    },
    order_simulator_version: shardResults[0]?.order_simulator_version || "1.0.0",
    order_simulation_policy: shardResults[0]?.order_simulation_policy || {},
    events,
    positions,
    metrics: buildMetrics(positions, { rows: context.rows }),
  }), {
    primaryCompilation,
    shardCount: shardResults.length,
  });
}

function simulationWithResearchMetadata(simulation, { primaryCompilation, shardCount }) {
  return {
    ...simulation,
    primaryCompilation,
    shard_count: shardCount,
  };
}

async function registerSimulation(store, seed, dataset, simulation, compilation, command) {
  return store.simulationRuns.recordSimulationResult({
    simulation_run_id: seed.ids.simulationRunId,
    strategy_version_id: seed.ids.versionId,
    dataset_id: dataset.dataset_id,
    compiled_artifact_hash: compilation.compilation.evidence.compiled_artifact_hash,
    result: simulation,
    metadata: {
      source: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
      dataset_key: dataset.dataset_key,
      research_experiment_id: seed.variant.research_experiment_id,
      research_candidate_id: seed.ids.candidateId,
      parent_research_candidate_id: seed.variant.source_research_candidate_id,
      iteration_index: seed.variant.iteration_index,
      variant_id: seed.variant.variant_id,
      generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
      shard_count: simulation.shard_count || 1,
      total_rows: simulation?.data_quality?.consumed_rows || 0,
      metrics: simulation.metrics || {},
    },
    created_at_utc: seed.timestamp,
  }, command);
}

async function registerResearch(store, seed, run, simulation, command) {
  const registry = store.researchRegistry;
  await ensureResearchCandidate(registry, seed, command);
  const report = await recordValidationReportOrReuseExisting({
    registry,
    report: buildResearchEvaluation(seedForEvaluation(seed), seed.ids, run, simulation.metrics || {}),
    command,
  });
  return {
    experiment_id: seed.variant.research_experiment_id,
    hypothesis_id: seed.variant.research_hypothesis_id,
    candidate_id: seed.ids.candidateId,
    report_id: seed.ids.reportId,
    report,
  };
}

async function ensureResearchCandidate(registry, seed, command) {
  try {
    return await registry.getCandidate(seed.ids.candidateId);
  } catch (error) {
    if (error?.code !== "RESEARCH_CANDIDATE_NOT_FOUND") throw error;
  }
  return registry.registerCandidate({
    research_candidate_id: seed.ids.candidateId,
    research_experiment_id: seed.variant.research_experiment_id,
    research_hypothesis_id: seed.variant.research_hypothesis_id,
    candidate_key: candidateKey(seed),
    source_type: "DERIVED",
    status: "UNDER_REVIEW",
    strategy_definition_id: seed.ids.definitionId,
    strategy_version_id: seed.ids.versionId,
    primary_change_summary: seed.variant.primary_change_summary,
    deterministic_plan_ref: `strategy-version://${seed.ids.versionId}`,
    novelty_score: noveltyScore(seed.variant),
    promotion_blocked: true,
    promotion_block_reason: "Attente review agent après backtest d'itération.",
    metadata: seed.variant.metadata,
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  }, command);
}

async function recordValidationReportOrReuseExisting({ registry, report, command }) {
  try {
    return await registry.recordEvaluationReport(report, command);
  } catch (error) {
    if (error?.code !== "RESEARCH_AGGREGATE_CONFLICT" || !registry.listEvaluationReports) throw error;
    const existing = (await registry.listEvaluationReports({
      researchCandidateId: report.research_candidate_id,
      reportKind: report.report_kind,
      limit: 100,
    })).find((item) => item.simulation_run_id === report.simulation_run_id);
    if (!existing) throw error;
    return { status: "IDEMPOTENT_EXISTING_BUSINESS_KEY", report: existing };
  }
}

async function enqueueReviewTask(pool, { seed, registered, research, task, nowUtc }) {
  const taskKey = `research-review-${seed.dataset.dataset_key}-iter-${seed.variant.iteration_index}-${researchStrategyIterationGeneratorSlug()}-${seed.variant.variant_label}`;
  const missionKey = `research-demo-paper-${seed.dataset.dataset_key}-iter-${seed.variant.iteration_index}-${researchStrategyIterationGeneratorSlug()}`;
  const missionIds = stableResearchTaskIds({ key: missionKey, kind: "RESEARCH_STRATEGY_VALIDATION" });
  const taskIds = stableResearchTaskIds({ key: taskKey, kind: "RESEARCH_BACKTEST_REVIEW" });
  return enqueueResearchAgentTask(pool, {
    mission: reviewMission({ ids: missionIds, seed, nowUtc, missionKey }),
    task: reviewTask({ ids: taskIds, missionIds, seed, registered, research, task, nowUtc, taskKey }),
  });
}

function reviewMission({ ids, seed, nowUtc, missionKey }) {
  return {
    agent_mission_id: ids.missionId,
    mission_key: missionKey,
    mission_type: "RESEARCH_STRATEGY_VALIDATION",
    lane: "research",
    objective: "Relire le backtest d'une variante générée et décider promotion, robustesse ou nouvelle itération.",
    context_ref: `research://${seed.variant.research_experiment_id}`,
    correlation_id: correlationId(seed),
    priority: CURRENT_GENERATOR_REVIEW_PRIORITY,
    model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-review" },
    metadata: { source: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION, iteration_index: seed.variant.iteration_index },
    created_at_utc: nowUtc,
  };
}

function reviewTask({ ids, missionIds, seed, registered, research, task, nowUtc, taskKey }) {
  return {
    agent_task_id: ids.taskId,
    agent_mission_id: missionIds.missionId,
    task_key: taskKey,
    task_type: "RESEARCH_BACKTEST_REVIEW",
    lane: "research",
    input_ref: `simulation-run://${registered.run.simulation_run_id}`,
    priority: CURRENT_GENERATOR_REVIEW_PRIORITY,
    payload: reviewPayload({ seed, registered, research }),
    idempotency_key: `idem_research_review_${ids.taskId}`,
    max_attempts: 3,
    not_before_utc: nowUtc,
    correlation_id: correlationId(seed),
    metadata: { source: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION, parent_task_id: canonicalTaskId(task) },
    created_at_utc: nowUtc,
  };
}

function reviewPayload({ seed, registered, research }) {
  return {
    dataset_id: seed.dataset.dataset_id,
    dataset_key: seed.dataset.dataset_key,
    generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
    generator_slug: researchStrategyIterationGeneratorSlug(),
    strategy_version_id: seed.ids.versionId,
    simulation_run_id: registered.run.simulation_run_id,
    research_candidate_id: research.candidate_id,
    required_decision: "REVIEW_OR_ITERATE",
    iteration_index: seed.variant.iteration_index,
    parent_research_candidate_id: seed.variant.source_research_candidate_id,
    metrics: registered.run.metadata?.metrics || {},
  };
}

function simulationDataset(dataset, rows) {
  return {
    ...dataset,
    dataset_hash: dataset.content_hash,
    sealed: true,
    sealed_at_utc: dataset.cutoff_utc,
    time_range: {
      from_utc: dataset.time_range_start_utc,
      to_utc: dataset.time_range_end_utc,
      to_paris: dataset.cutoff_paris,
    },
    rows,
  };
}

function simulationParameters() {
  return {
    simulation_policy: {
      position_at_cutoff: "MARK_TO_MARKET_CLOSE",
    },
    simulation_telemetry: {
      record_condition_evaluations: false,
    },
    order_simulation_policy: {
      ambiguous_intrabar_policy: "CONSERVATIVE_STOP",
      spread_points: 0.25,
      slippage_points: 0.25,
      commission_r_per_contract: 0.01,
    },
    validation_scope: "one_month_cumulative_demo_paper",
  };
}

function seedForEvaluation(seed) {
  return { dataset: seed.dataset, scope: seed.scope, timestamp: seed.timestamp };
}

function compileScope(seed, shard = null) {
  return {
    trading_date: shard?.trading_date || seed.scope.start_utc.slice(0, 10),
    session: "demo_paper_research",
    cutoff_utc: shard?.cutoff_utc || seed.dataset.cutoff_utc,
    cutoff_paris: shard?.cutoff_paris || seed.dataset.cutoff_paris,
    strategy_id: shard ? `${strategyExternalKey(seed)}.${shard.shard_id}` : strategyExternalKey(seed),
    pack_id: seed.dataset.dataset_key,
    pack_build_id: seed.dataset.dataset_id,
  };
}

function commandContext({ seed, task, nowUtc }) {
  return {
    idempotency_key: `idem_research_iteration_${seed.ids.simulationRunId}`,
    correlation_id: correlationId(seed),
    actor: "research_strategy_iteration_runner",
    reason: `Autonomous research iteration from ${canonicalTaskId(task)} at ${nowUtc}.`,
  };
}

function variantResult({ variant, seed, registered, simulation, agentTask }) {
  return {
    variant_id: variant.variant_id,
    research_candidate_id: seed.ids.candidateId,
    strategy_version_id: seed.ids.versionId,
    simulation_run_id: registered.run.simulation_run_id,
    review_task_id: agentTask.task_id,
    metrics: registered.run.metadata?.metrics || simulation.metrics || {},
  };
}

function candidateKey(seed) {
  return `derived:${seed.dataset.dataset_key}:strategy:${seed.ids.definitionId}:iter-${seed.variant.iteration_index}:${researchStrategyIterationGeneratorSlug()}:${seed.variant.variant_label}`;
}

function strategyExternalKey(seed) {
  return `demo-paper.${seed.scope.instrument.toLowerCase()}.opening-range-retest.${seed.variant.iteration_index}.${researchStrategyIterationGeneratorSlug()}.${seed.variant.variant_label}`;
}

function variantSimulationShards(seed, context) {
  const runtimeSetups = Array.isArray(seed.variant.runtime_setups) && seed.variant.runtime_setups.length
    ? seed.variant.runtime_setups
    : seed.runtimeBindings.setups;
  if (runtimeSetups.length <= 4) return [{ shard_id: "single", runtimeBindings: { ...seed.runtimeBindings, setups: runtimeSetups } }];
  const byDate = new Map();
  for (const setup of runtimeSetups) {
    const tradingDate = setup.trading_date || setup.valid_from_paris?.slice(0, 10) || "unknown";
    if (!byDate.has(tradingDate)) byDate.set(tradingDate, []);
    byDate.get(tradingDate).push(setup);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tradingDate, setups], index) => {
      const cutoffParis = setups.reduce((latest, setup) => String(setup.expires_at_paris || "") > String(latest || "") ? setup.expires_at_paris : latest, null)
        || context.dataset.cutoff_paris;
      return {
        shard_id: `day_${String(index + 1).padStart(2, "0")}_${tradingDate}`,
        trading_date: tradingDate,
        cutoff_paris: cutoffParis,
        cutoff_utc: context.dataset.cutoff_utc,
        start_utc: context.dataset.time_range_start_utc,
        runtimeBindings: {
          ...seed.runtimeBindings,
          trading_date: tradingDate,
          cutoff_paris: cutoffParis,
          expires_at_paris: cutoffParis,
          setups,
        },
      };
    });
}

function variantRunKey(seed, shard = null) {
  const suffix = shard?.shard_id ? `-${shard.shard_id}` : "";
  return `demo-paper-research-${seed.scope.instrument.toLowerCase()}-m5-${seed.scope.start_utc.slice(0, 10)}-${seed.scope.end_utc.slice(0, 10)}-iter-${seed.variant.iteration_index}-${researchStrategyIterationGeneratorSlug()}-${seed.variant.variant_label}${suffix}`;
}

function correlationId(seed) {
  return `corr_research_iteration_${seed.ids.simulationRunId}`;
}

function variantOrdinal(label) {
  const order = ["balanced", "wide-retest", "quick-retest", "deep-retest", "permissive-momentum"];
  return Math.max(1, order.indexOf(label) + 1);
}

function noveltyScore(variant) {
  return Math.min(0.95, 0.45 + variant.iteration_index * 0.04 + variantOrdinal(variant.variant_label) * 0.03);
}
