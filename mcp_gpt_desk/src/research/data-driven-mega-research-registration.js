import { createHash } from "node:crypto";
import {
  canonicalJson,
  canonicalSha256,
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
} from "@tv-automation/desk-domain";
import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { enqueueResearchAgentTask } from "./research-agent-task-queue.js";
import { DATA_DRIVEN_STRATEGY_FAMILIES } from "./data-driven-strategy-family-catalog.js";

const VERSION = "data_driven_mega_research_batch_v1";

export function buildExperiment({ scope, dataset, ids, timestamp }) {
  return {
    research_experiment_id: ids.experimentId,
    experiment_key: safeKey(`mega:${scope.batch_id}:${scope.dataset_key}`),
    name: `Mega Research ${scope.instrument} M${scope.timeframe} — 1000 familles data-driven`,
    objective: "Tester massivement des familles/variantes déterministes data-driven sans exécution broker.",
    owner: "desk-research",
    status: "ACTIVE",
    comparison_metric: "total_r",
    candidate_selection_cutoff_utc: dataset.cutoff_utc,
    budget: { max_candidates: scope.count, max_compute_jobs: scope.count, broker_execution_enabled: false },
    metadata: {
      dataset_key: dataset.dataset_key,
      batch_id: scope.batch_id,
      generator: VERSION,
      family_set: scope.family_set,
      setups_per_variant: scope.setups_per_variant,
    },
    created_at_utc: timestamp,
    updated_at_utc: timestamp,
  };
}

export async function registerFamilyHypotheses({ registry, scope, ids, familySpecs = DATA_DRIVEN_STRATEGY_FAMILIES, timestamp, command }) {
  const results = new Map();
  for (const familySpec of familySpecs) {
    const hypothesisId = uuidFromValue({ kind: "research_hypothesis", experiment: ids.experimentId, family: familySpec.family_id });
    await registry.registerHypothesis({
      research_hypothesis_id: hypothesisId,
      research_experiment_id: ids.experimentId,
      statement: `${familySpec.label} peut produire une edge exploitable sur ${scope.instrument} M${scope.timeframe}.`,
      falsifiable_question: `La famille ${familySpec.family_id} obtient-elle un total R positif avec drawdown maîtrisé sur le dataset réel ?`,
      instrument_scope: [scope.instrument],
      timeframe_scope: [`M${scope.timeframe}`],
      population_scope: "mega_data_driven_cumulative_research",
      variable_set: { family_set: scope.family_set, family_id: familySpec.family_id, anchor_kind: familySpec.anchor_kind, direction: familySpec.direction },
      expected_outcome: "Au moins 2 trades fermés, total R positif, drawdown supérieur au floor research.",
      invalidation_criteria: "Total R non positif, drawdown sous le floor ou échantillon insuffisant.",
      status: "TESTING",
      confidence_score: 0.5,
      metadata: { generator: VERSION, family_set: scope.family_set, family: familySpec },
      created_at_utc: timestamp,
      updated_at_utc: timestamp,
    }, command);
    results.set(familySpec.family_id, { experimentId: ids.experimentId, hypothesisId });
  }
  return results;
}

export function buildVariantSeed({ scope, dataset, tradingDays, variant, ids, familyIds, timestamp }) {
  const dsl = variantStrategyDsl({ scope, variant });
  const runtimeBindings = variantRuntimeBindings({ scope, dataset, variant });
  return {
    scope,
    dataset,
    tradingDays,
    variant,
    ids,
    familyIds,
    timestamp,
    dsl,
    dslText: canonicalJson(dsl),
    runtimeBindings,
    parameters: simulationParameters(),
  };
}

function variantStrategyDsl({ scope, variant }) {
  const base = {
    instrument: scope.instrument,
    timeframe: `M${scope.timeframe}`,
    rr_minimum: Math.min(2, variant.parameters.target_rr),
    risk_pct: 0.25,
    order_type: variant.parameters.order_type,
    tolerance_points: variant.parameters.tolerance_points,
    max_bars: variant.parameters.max_bars,
    require_rejection_confirmation: variant.parameters.require_rejection_confirmation,
  };
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [
      { ...base, template_id: templateId(variant), direction: variant.direction, rank: 1 },
    ],
    metadata: {
      generator: VERSION,
      family_id: variant.family_id,
      family_label: variant.family_label,
      family_set: scope.family_set,
      family_index: variant.family_index,
      variant_index: variant.variant_index,
      anchor_kind: variant.anchor_kind,
      note: "Compiler currently supports BREAKOUT_RETEST primitives; research family diversity is expressed through data-derived anchors and runtime bindings.",
    },
  };
}

function variantRuntimeBindings({ scope, dataset, variant }) {
  return {
    valid_from_paris: toParisIso(Date.parse(scope.start_utc)),
    expires_at_paris: dataset.cutoff_paris,
    cutoff_paris: dataset.cutoff_paris,
    pack_id: dataset.dataset_key,
    pack_build_id: dataset.dataset_id,
    plan_id: `plan__${variant.candidate_key}`,
    session: "mega_data_driven_research",
    trading_date: scope.start_utc.slice(0, 10),
    setup_id_prefix: `mega_${variant.family_id}_${variant.variant_index}`,
    setups: variant.runtime_setups,
  };
}

export async function registerDefinition(store, seed, command) {
  const existing = await store.strategyKernel.getDefinitionByExternalKey?.(seed.variant.strategy_external_key);
  if (existing) return { status: "EXISTING_BY_EXTERNAL_KEY", definition: existing, audit: null };
  return store.strategyKernel.registerDefinition({
    strategy_definition_id: seed.ids.definitionId,
    external_key: seed.variant.strategy_external_key,
    name: `Data-driven ${seed.scope.instrument} — ${seed.variant.family_label}`,
    description: `Famille data-driven ${seed.variant.family_label}, générée par ${VERSION}.`,
    owner: "desk-research",
    asset_class: "FUTURES",
    default_instruments: [seed.scope.instrument],
    tags: ["mega-research", "data-driven", seed.variant.family_id],
    metadata: {
      batch_id: seed.scope.batch_id,
      dataset_key: seed.dataset.dataset_key,
      generator: VERSION,
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      family_index: seed.variant.family_index,
      anchor_kind: seed.variant.anchor_kind,
    },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

export async function registerVersion(store, seed, command) {
  const existing = (await store.strategyKernel.listVersions({ strategyDefinitionId: seed.ids.definitionId, limit: 2_000 }))
    .find((item) => item.version_label === seed.variant.version_label);
  if (existing) return { status: "EXISTING_BY_VERSION_LABEL", version: existing, audit: null };
  return store.strategyKernel.registerVersion({
    strategy_version_id: seed.ids.versionId,
    strategy_definition_id: seed.ids.definitionId,
    version_label: seed.variant.version_label,
    status: "VALIDATED",
    dsl_source_hash: sha256Text(seed.dslText),
    compiled_artifact_ref: `strategy://mega-research/${seed.ids.versionId}/compiled-artifact`,
    compiled_artifact_hash: null,
    validated_metrics_ref: seed.ids.simulationRunId,
    runtime_contract_bundle_version: "deterministic_execution_plan_v1_4",
    metadata: {
      dsl_source: seed.dsl,
      validation_scope: "mega_data_driven_research",
      research_candidate_id: seed.ids.candidateId,
      batch_id: seed.scope.batch_id,
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      family_index: seed.variant.family_index,
      variant_index: seed.variant.variant_index,
    },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

export async function compileVersion(store, seed, command) {
  const result = await store.strategyKernel.compileVersion({
    strategy_version_id: seed.ids.versionId,
    dsl_source: seed.dslText,
    runtime_bindings: seed.runtimeBindings,
    scope: compileScope(seed),
    source_mode: "PAPER",
  }, command);
  if (result.status !== "COMPILED") {
    throw coded("MEGA_RESEARCH_STRATEGY_COMPILE_REJECTED", "Mega research strategy cannot compile.", {
      reasons: result.compilation?.reasons,
      issues: result.compilation?.issues,
    });
  }
  return result;
}

export function runSimulation(seed, dataset, rows, compilation) {
  return runCanonicalSimulationV1({
    run_id: `mega-research-${seed.scope.instrument.toLowerCase()}-m${seed.scope.timeframe}-${seed.scope.batch_id}-${seed.variant.global_index}`,
    strategy_version_id: seed.ids.versionId,
    compiled_artifact: compilation.compilation.compiled_artifact,
    dataset: simulationDataset(dataset, rows),
    rows,
    parameters: seed.parameters,
    reproducibility_seed: `${VERSION}:${seed.variant.candidate_key}`,
    cutoff_utc: dataset.cutoff_utc,
    cutoff_paris: dataset.cutoff_paris,
    run_started_at_utc: dataset.time_range_start_utc,
  });
}

export async function registerSimulation(store, seed, dataset, simulation, compilation, command) {
  return store.simulationRuns.recordSimulationResult({
    simulation_run_id: seed.ids.simulationRunId,
    strategy_version_id: seed.ids.versionId,
    dataset_id: dataset.dataset_id,
    compiled_artifact_hash: compilation.compilation.evidence.compiled_artifact_hash,
    result: simulation,
    metadata: {
      source: VERSION,
      batch_id: seed.scope.batch_id,
      dataset_key: dataset.dataset_key,
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      family_label: seed.variant.family_label,
      family_index: seed.variant.family_index,
      variant_index: seed.variant.variant_index,
      total_rows: simulation?.data_quality?.consumed_rows || 0,
      metrics: simulation.metrics || {},
    },
    created_at_utc: seed.timestamp,
  }, {
    ...command,
    idempotency_key: `idem_mega_sim_${seed.ids.simulationRunId}`,
    run_link_id: seed.ids.reportId,
  });
}

export async function registerCandidateAndEvaluation({ registry, seed, registered, simulation, command }) {
  const candidate = await ensureCandidate(registry, seed, command);
  const report = await registry.recordEvaluationReport(buildEvaluation(seed, registered.run, simulation.metrics || {}), {
    ...command,
    idempotency_key: `idem_mega_eval_${seed.ids.reportId}`,
    run_link_id: seed.ids.reportId,
  });
  return {
    experiment_id: seed.familyIds.experimentId,
    hypothesis_id: seed.familyIds.hypothesisId,
    candidate_id: seed.ids.candidateId,
    report_id: seed.ids.reportId,
    candidate,
    report,
  };
}

async function ensureCandidate(registry, seed, command) {
  try {
    return await registry.getCandidate(seed.ids.candidateId);
  } catch (error) {
    if (error?.code !== "RESEARCH_CANDIDATE_NOT_FOUND") throw error;
  }
  return registry.registerCandidate({
    research_candidate_id: seed.ids.candidateId,
    research_experiment_id: seed.familyIds.experimentId,
    research_hypothesis_id: seed.familyIds.hypothesisId,
    candidate_key: seed.variant.candidate_key,
    source_type: "AI_GENERATED",
    status: "UNDER_REVIEW",
    strategy_definition_id: seed.ids.definitionId,
    strategy_version_id: seed.ids.versionId,
    primary_change_summary: seed.variant.primary_change_summary,
    deterministic_plan_ref: `strategy-version://${seed.ids.versionId}`,
    novelty_score: noveltyScore(seed.variant),
    promotion_blocked: true,
    promotion_block_reason: "Attente review agent après backtest data-driven mega batch.",
    metadata: {
      generator: VERSION,
      batch_id: seed.scope.batch_id,
      dataset_key: seed.dataset.dataset_key,
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      family_label: seed.variant.family_label,
      family_index: seed.variant.family_index,
      anchor_kind: seed.variant.anchor_kind,
      variant_index: seed.variant.variant_index,
      global_index: seed.variant.global_index,
      parameters: seed.variant.parameters,
    },
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  }, command);
}

function buildEvaluation(seed, run, metrics) {
  const verdict = evaluationVerdict(metrics);
  return {
    research_evaluation_report_id: seed.ids.reportId,
    research_experiment_id: seed.familyIds.experimentId,
    research_candidate_id: seed.ids.candidateId,
    simulation_run_id: run.simulation_run_id,
    report_kind: "VALIDATION",
    verdict,
    score: evaluationScore(metrics, verdict),
    metric_snapshot: metrics,
    criteria_snapshot: {
      schema_version: VERSION,
      min_trade_count: 2,
      min_total_r: 0,
      max_drawdown_floor_r: -8,
      decision: verdict === "PASS" ? "READY_FOR_CONTRADICTORY_REVIEW" : "REJECT_OR_REVIEW",
      reasons: evaluationReasons(metrics),
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      anchor_kind: seed.variant.anchor_kind,
    },
    artifact_refs: [run.result_ref, run.metrics_ref, `strategy-version://${seed.ids.versionId}`].filter(Boolean),
    reviewer_ref: "deterministic-mega-bootstrap",
    metadata: {
      source: VERSION,
      batch_id: seed.scope.batch_id,
      dataset_id: seed.dataset.dataset_id,
      dataset_key: seed.dataset.dataset_key,
      strategy_version_id: seed.ids.versionId,
      family_set: seed.scope.family_set,
      family_id: seed.variant.family_id,
      variant_index: seed.variant.variant_index,
    },
    created_at_utc: seed.timestamp,
  };
}

export async function enqueueReviewTask(pool, { seed, dataset, registered, research, operationTime }) {
  return enqueueResearchAgentTask(pool, {
    mission: {
      agent_mission_id: seed.ids.missionId,
      mission_key: safeKey(`mega-review:${seed.scope.batch_id}:${seed.variant.family_id}:${seed.variant.variant_index}`),
      mission_type: "RESEARCH_STRATEGY_VALIDATION",
      lane: "research",
      objective: "Relire un candidat data-driven du mega batch et décider contradiction, robustesse ou rejet.",
      context_ref: `research://${seed.familyIds.experimentId}`,
      correlation_id: `corr_mega_${seed.ids.simulationRunId}`,
      priority: 45,
      model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-review" },
      metadata: {
        source: VERSION,
        simulation_run_id: registered.run.simulation_run_id,
        strategy_version_id: seed.ids.versionId,
        family_set: seed.scope.family_set,
        family_id: seed.variant.family_id,
      },
      created_at_utc: operationTime,
    },
    task: {
      agent_task_id: seed.ids.taskId,
      agent_mission_id: seed.ids.missionId,
      task_key: safeKey(`mega-review:${seed.scope.batch_id}:${seed.variant.family_id}:${seed.variant.variant_index}`),
      task_type: "RESEARCH_BACKTEST_REVIEW",
      lane: "research",
      input_ref: `simulation-run://${registered.run.simulation_run_id}`,
      priority: 45,
      payload: {
        dataset_id: dataset.dataset_id,
        dataset_key: dataset.dataset_key,
        generator_version: VERSION,
        generator_slug: "mega-data-driven-v1",
        strategy_version_id: seed.ids.versionId,
        simulation_run_id: registered.run.simulation_run_id,
        research_candidate_id: research.candidate_id,
        required_decision: "REVIEW_OR_PROMOTE_NO_AUTO_ITERATION",
        iteration_index: 1,
        max_iterations: 1,
        max_variants: 1,
        metrics: registered.run.metadata?.metrics || {},
        family: {
          family_set: seed.scope.family_set,
          family_id: seed.variant.family_id,
          family_label: seed.variant.family_label,
          family_index: seed.variant.family_index,
          anchor_kind: seed.variant.anchor_kind,
          parameters: seed.variant.parameters,
        },
      },
      idempotency_key: `idem_mega_review_${seed.ids.taskId}`,
      max_attempts: 3,
      not_before_utc: operationTime,
      correlation_id: `corr_mega_${seed.ids.simulationRunId}`,
      metadata: { source: VERSION },
      created_at_utc: operationTime,
    },
  });
}

function templateId(familySpec) { return `${familySpec.family_id}_${familySpec.direction}`; }
function compileScope(seed) {
  return { trading_date: seed.scope.start_utc.slice(0, 10), session: "mega_data_driven_research", cutoff_utc: seed.dataset.cutoff_utc, cutoff_paris: seed.dataset.cutoff_paris, strategy_id: seed.variant.strategy_external_key, pack_id: seed.dataset.dataset_key, pack_build_id: seed.dataset.dataset_id };
}
function simulationDataset(dataset, rows) {
  return { ...dataset, dataset_hash: dataset.content_hash, sealed: true, sealed_at_utc: dataset.cutoff_utc, time_range: { from_utc: dataset.time_range_start_utc, to_utc: dataset.time_range_end_utc, to_paris: dataset.cutoff_paris }, rows };
}
function simulationParameters() {
  return { simulation_policy: { position_at_cutoff: "MARK_TO_MARKET_CLOSE" }, order_simulation_policy: { ambiguous_intrabar_policy: "CONSERVATIVE_STOP", spread_points: 0.25, slippage_points: 0.25, commission_r_per_contract: 0.01 }, validation_scope: "mega_data_driven_research" };
}
function evaluationVerdict(metrics) {
  if (number(metrics.trade_count) < 2) return "NEEDS_REVIEW";
  if (number(metrics.total_r) <= 0 || number(metrics.max_drawdown_r) < -8) return "FAIL";
  return "PASS";
}
function evaluationReasons(metrics) {
  const reasons = [];
  if (number(metrics.trade_count) < 2) reasons.push("INSUFFICIENT_TRADE_SAMPLE");
  if (number(metrics.total_r) <= 0) reasons.push("NON_POSITIVE_TOTAL_R");
  if (number(metrics.max_drawdown_r) < -8) reasons.push("DRAWDOWN_BELOW_RESEARCH_FLOOR");
  return reasons.length ? reasons : ["BASELINE_BACKTEST_ACCEPTABLE"];
}
function evaluationScore(metrics, verdict) {
  const total = Math.max(-12, Math.min(20, number(metrics.total_r)));
  const tradeCount = Math.min(20, Math.max(0, number(metrics.trade_count)));
  const drawdown = Math.max(0, 1 - Math.abs(number(metrics.max_drawdown_r)) / 10);
  const raw = verdict === "PASS" ? 0.62 + Math.min(0.18, total / 80) + Math.min(0.08, tradeCount / 250) + drawdown * 0.12 : 0.18 + Math.min(0.24, Math.max(0, total + 6) / 50) + Math.min(0.16, tradeCount / 100) + drawdown * 0.18;
  return Math.max(0.01, Math.min(0.99, Math.round(raw * 10_000) / 10_000));
}
function noveltyScore(variant) { return Math.min(0.97, 0.55 + variant.family_index * 0.01 + (variant.variant_index % 17) * 0.01); }
function safeKey(value) { const normalized = String(value || "key").toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, ""); const bounded = normalized.slice(0, 180).replace(/[^a-z0-9]+$/, ""); return bounded || "key"; }
function sha256Text(value) { return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function uuidFromValue(value) { return uuidFromHash(canonicalSha256(value)); }
function uuidFromHash(hash) { const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0"); const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16); return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`; }
function coded(code, message, details = {}) { return Object.assign(new Error(message || code), { code, details, retryable: false }); }
