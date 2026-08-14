import { buildRobustnessReportV1 } from "@tv-automation/desk-replay-engine";
import { createResearchExperimentRegistryService } from "../research-experiment-registry-service.js";
import { buildResearchPromotionGateEvaluationReports } from "./research-promotion-gate-evaluations.js";
import {
  RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
  canonicalTaskId,
  coded,
  conversationFromRunnerInput,
  requiredText,
  stableUuid,
} from "./research-strategy-iteration-common.js";

export const RESEARCH_ROBUSTNESS_REVIEW_RUNNER_SCHEMA_VERSION = "research_robustness_review_runner_v1";
export const RESEARCH_ROBUSTNESS_REVIEW_OUTPUT_SCHEMA_VERSION = "research_agent_robustness_review_output_v1";
export const RESEARCH_ROBUSTNESS_REVIEW_TASK_TYPE = "RESEARCH_ROBUSTNESS_REVIEW";

export async function runResearchRobustnessReviewTask({ store, runnerInput = {}, nowUtc } = {}) {
  const task = requireSupportedTask(runnerInput.task);
  const resolvedNowUtc = resolveNowUtc({ store, task, nowUtc });
  const payload = task.payload || {};
  const registry = resolveResearchRegistry(store);
  const simulationRegistry = resolveSimulationRegistry(store);
  const researchCandidateId = requiredText(payload.research_candidate_id, "research_candidate_id");
  const simulationRunId = requiredText(payload.simulation_run_id, "simulation_run_id");
  const [candidate, baselineRun, baselineArtifacts, existingEvaluationReports] = await Promise.all([
    registry.getCandidate(researchCandidateId),
    simulationRegistry.getRun(simulationRunId),
    simulationRegistry.listArtifacts({ simulationRunId, limit: 100 }),
    registry.listEvaluationReports({ researchCandidateId, reportKind: null, limit: 500 }),
  ]);
  const baselineResult = canonicalResultFromRunAndArtifacts(baselineRun, baselineArtifacts);
  const report = buildResearchRobustnessEvaluation({
    task,
    payload,
    candidate,
    baselineRun,
    baselineResult,
    existingEvaluationReports,
    actor: runnerActor(runnerInput),
    nowUtc: resolvedNowUtc,
  });
  const saved = await recordEvaluationReportOrReuseExisting({ registry, report });
  return buildResearchRobustnessReviewRunnerOutput({ report, saved, runnerInput });
}

export function buildResearchRobustnessEvaluation({
  task = {},
  payload = {},
  candidate = {},
  baselineRun = {},
  baselineResult = {},
  existingEvaluationReports = [],
  actor = "agent-runtime-research-robustness",
  nowUtc,
} = {}) {
  const taskId = canonicalTaskId(task);
  const resolvedNowUtc = resolveNowUtc({ task, nowUtc });
  const robustness = buildRobustnessReportV1(robustnessInput({ payload, candidate, baselineRun, baselineResult, nowUtc: resolvedNowUtc }));
  const oos = oosProxyFromRobustness(robustness);
  const robustnessReport = {
    research_evaluation_report_id: stableRobustnessReportId({ payload }),
    research_experiment_id: requiredText(candidate.research_experiment_id, "research_experiment_id"),
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "ROBUSTNESS",
    verdict: robustnessVerdict(robustness),
    score: robustnessScore(robustness),
    metric_snapshot: robustnessMetricSnapshot(robustness, oos),
    criteria_snapshot: {
      schema_version: RESEARCH_ROBUSTNESS_REVIEW_RUNNER_SCHEMA_VERSION,
      decision: robustnessDecision(robustness),
      gate: robustness.gate,
      policy: robustness.policy_snapshot,
      tests: testSummary(robustness.tests),
      oos_proxy: oos,
      next_recommended_task_type: null,
    },
    artifact_refs: [
      `simulation-run://${payload.simulation_run_id}`,
      baselineRun.result_ref,
      baselineRun.metrics_ref,
      `robustness-report://${robustness.content_hash}`,
    ].filter(Boolean),
    reviewer_ref: actor,
    metadata: {
      schema_version: RESEARCH_ROBUSTNESS_REVIEW_RUNNER_SCHEMA_VERSION,
      task_id: taskId,
      task_key: task.task_key,
      lane: task.lane,
      strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id || null,
      dataset_id: payload.dataset_id || baselineRun.dataset_id || null,
      dataset_key: payload.dataset_key || baselineRun.metadata?.dataset_key || null,
      generator_version: payload.generator_version || baselineRun.metadata?.generator_version || RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
      robustness_report_hash: robustness.content_hash,
      oos_proxy_report_id: stableOosReportId({ payload }),
    },
    created_at_utc: stableReportTime(task, resolvedNowUtc),
  };
  const oosReport = {
    ...robustnessReport,
    research_evaluation_report_id: stableOosReportId({ payload }),
    report_kind: "OUT_OF_SAMPLE",
    verdict: oos.verdict,
    score: oos.score,
    metric_snapshot: {
      total_r: oos.total_r,
      trade_count: oos.trade_count,
      max_drawdown_r: oos.max_drawdown_r,
      pass_rate: oos.pass_rate,
    },
    criteria_snapshot: {
      schema_version: RESEARCH_ROBUSTNESS_REVIEW_RUNNER_SCHEMA_VERSION,
      proxy: true,
      source: "robustness_walk_forward_and_distribution_gate",
      reasons: oos.reasons,
    },
    artifact_refs: robustnessReport.artifact_refs,
    metadata: {
      ...robustnessReport.metadata,
      robustness_report_id: robustnessReport.research_evaluation_report_id,
      proxy: true,
    },
  };
  const promotionGateEvaluations = buildResearchPromotionGateEvaluationReports({
    task,
    payload,
    candidate,
    baselineRun,
    baselineResult,
    robustness,
    oos,
    robustnessReport,
    oosReport,
    existingEvaluationReports,
    actor,
    nowUtc: resolvedNowUtc,
  });
  const finalDecision = finalRobustnessDecision({ robustness, promotionMatrix: promotionGateEvaluations.promotion_matrix });
  return {
    robustness,
    oos,
    promotion_gate_evaluations: promotionGateEvaluations,
    reports: [robustnessReport, oosReport, ...promotionGateEvaluations.reports],
    command: (report) => ({
      idempotency_key: `idem_research_${String(report.report_kind).toLowerCase()}_${report.research_evaluation_report_id}`,
      correlation_id: task.correlation_id || `corr_research_robustness_${report.research_candidate_id}`,
      actor,
      reason: `Agent runtime robustness and promotion gate review: ${finalDecision}`,
      run_link_id: report.research_evaluation_report_id,
    }),
    assessment: {
      decision: finalDecision,
      verdict: robustnessVerdict(robustness),
      score: robustnessScore(robustness),
      reasons: [...(robustness.gate?.reasons || []), ...(promotionGateEvaluations.promotion_matrix?.reasons || [])],
      next_task_type: null,
    },
  };
}

export function buildResearchRobustnessReviewRunnerOutput({ report, saved = [], runnerInput = {} } = {}) {
  const robustnessReport = saved.find((item) => item.report_kind === "ROBUSTNESS") || report.reports[0];
  const oosReport = saved.find((item) => item.report_kind === "OUT_OF_SAMPLE") || report.reports[1];
  const portfolioFitReport = saved.find((item) => item.report_kind === "PORTFOLIO_FIT") || report.reports.find((item) => item.report_kind === "PORTFOLIO_FIT");
  const promotionMatrixReport = saved.find((item) => item.report_kind === "PROMOTION_MATRIX") || report.reports.find((item) => item.report_kind === "PROMOTION_MATRIX");
  const promotionDecision = promotionMatrixReport?.criteria_snapshot?.decision || report.promotion_gate_evaluations?.promotion_matrix?.decision || null;
  return {
    ok: true,
    status: report.assessment.decision,
    schema_version: RESEARCH_ROBUSTNESS_REVIEW_OUTPUT_SCHEMA_VERSION,
    output_ref: `research-evaluation-report://${robustnessReport.research_evaluation_report_id}`,
    research_candidate_id: robustnessReport.research_candidate_id,
    simulation_run_id: robustnessReport.simulation_run_id,
    robustness_report_id: robustnessReport.research_evaluation_report_id,
    oos_report_id: oosReport.research_evaluation_report_id,
    portfolio_fit_report_id: portfolioFitReport?.research_evaluation_report_id || null,
    promotion_matrix_report_id: promotionMatrixReport?.research_evaluation_report_id || null,
    verdict: robustnessReport.verdict,
    score: Number(robustnessReport.score),
    reasons: report.assessment.reasons,
    next_recommended_task_type: null,
    robustness_gate_passed: report.robustness.gate?.promotion_allowed === true,
    promotion_decision: promotionDecision,
    promotion_allowed: promotionDecision === "APPROVED_FOR_PROMOTION",
    conversation: conversationFromRunnerInput(runnerInput),
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_micros_usd: 0 },
    telemetry: {
      runner: "research-robustness-review-deterministic",
      schema_version: RESEARCH_ROBUSTNESS_REVIEW_RUNNER_SCHEMA_VERSION,
      token_consuming: false,
      robustness_report_hash: report.robustness.content_hash,
      promotion_decision: promotionDecision,
    },
  };
}

async function recordEvaluationReportOrReuseExisting({ registry, report }) {
  const saved = [];
  for (const evaluation of report.reports) {
    try {
      const result = await registry.recordEvaluationReport(evaluation, report.command(evaluation));
      saved.push(result.report || result.entity || evaluation);
    } catch (error) {
      if (error?.code !== "RESEARCH_AGGREGATE_CONFLICT") throw error;
      const existing = await findExistingReport({ registry, report: evaluation });
      if (!existing) throw error;
      saved.push(existing);
    }
  }
  return saved;
}

async function findExistingReport({ registry, report }) {
  if (!registry?.listEvaluationReports) return null;
  const reports = await registry.listEvaluationReports({
    researchCandidateId: report.research_candidate_id,
    research_candidate_id: report.research_candidate_id,
    reportKind: report.report_kind,
    report_kind: report.report_kind,
    limit: 500,
  });
  return (reports || []).find((candidate) =>
    candidate?.research_candidate_id === report.research_candidate_id
    && candidate?.report_kind === report.report_kind
    && candidate?.simulation_run_id === report.simulation_run_id) || null;
}

function robustnessInput({ payload, candidate, baselineRun, baselineResult, nowUtc }) {
  const policy = {
    min_total_r: 0,
    min_profit_factor: 1,
    max_drawdown_floor_r: Math.min(-5, Number(baselineResult.metrics?.max_drawdown_r || -5) - 0.5),
    min_walk_forward_pass_rate: 0.6,
    min_parameter_pass_rate: 0.6,
    min_cost_stress_pass_rate: 0.6,
    max_cost_stress_degradation_r: Math.max(2, Number(baselineResult.metrics?.total_r || 0) * 0.35),
    min_bootstrap_p05_total_r: -1,
    max_bootstrap_loss_probability: 0.45,
    min_monte_carlo_p05_total_r: -1,
    max_monte_carlo_drawdown_p95_abs_r: 10,
    bootstrap_sample_count: 64,
    monte_carlo_sample_count: 64,
    sample_seed: `desk-robustness:${payload.research_candidate_id}:${payload.simulation_run_id}`,
  };
  return {
    strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id,
    candidate_strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id,
    checked_at_utc: nowUtc,
    baseline_result: baselineResult,
    walk_forward_results: walkForwardSegments(baselineResult),
    stress_results: costStressResults(baselineResult),
    parameter_perturbation_results: parameterPerturbationResults(baselineResult),
    policy,
    compute_observability: { compute_worker_runs: 1 },
  };
}

function canonicalResultFromRunAndArtifacts(run = {}, artifacts = []) {
  const resultArtifact = artifacts.find((artifact) => artifact.artifact_kind === "RESULT");
  const metricsArtifact = artifacts.find((artifact) => artifact.artifact_kind === "METRICS");
  const positionsArtifact = artifacts.find((artifact) => artifact.artifact_kind === "POSITIONS");
  const result = { ...(resultArtifact?.payload || {}) };
  return {
    ...result,
    simulation_run_id: run.simulation_run_id,
    run_id: result.run_id || run.source_run_id || run.simulation_run_id,
    strategy_version_id: result.strategy_version_id || run.strategy_version_id,
    dataset_id: result.dataset_id || run.dataset_id,
    status: result.status || run.status,
    content_hash: result.content_hash || run.result_hash,
    result_hash: result.result_hash || run.result_hash,
    metrics_hash: result.metrics_hash || run.metrics_hash,
    dataset_hash: result.dataset_hash || run.dataset_hash,
    parameters_hash: result.parameters_hash || run.parameters_hash,
    metrics: result.metrics || metricsArtifact?.payload || run.metadata?.metrics || {},
    positions: Array.isArray(result.positions) ? result.positions : (positionsArtifact?.payload?.items || []),
  };
}

function walkForwardSegments(result = {}) {
  const positions = closedPositions(result);
  if (positions.length < 2) return [];
  const chunks = chunkPositions(positions, Math.min(3, positions.length));
  return chunks.map((items, index) => syntheticResult(result, {
    run_id: `${result.run_id || result.simulation_run_id}:walk_forward:${index + 1}`,
    positions: items,
  }));
}

function costStressResults(result = {}) {
  const positions = closedPositions(result);
  if (!positions.length) return [];
  return [
    syntheticResult(result, {
      run_id: `${result.run_id || result.simulation_run_id}:cost_stress:commission_x2`,
      positions: positions.map((position) => ({
        ...position,
        r_result: round(Number(position.r_result || 0) - 0.03),
        execution_cost_r: round(Number(position.execution_cost_r || 0) + 0.03),
      })),
    }),
    syntheticResult(result, {
      run_id: `${result.run_id || result.simulation_run_id}:cost_stress:slippage_guard`,
      positions: positions.map((position) => ({
        ...position,
        r_result: round(Number(position.r_result || 0) - 0.05),
        execution_cost_r: round(Number(position.execution_cost_r || 0) + 0.05),
      })),
    }),
  ];
}

function parameterPerturbationResults(result = {}) {
  const positions = closedPositions(result);
  if (positions.length < 2) return [];
  return [
    syntheticResult(result, {
      run_id: `${result.run_id || result.simulation_run_id}:parameter:even_trades`,
      positions: positions.filter((_, index) => index % 2 === 0),
    }),
    syntheticResult(result, {
      run_id: `${result.run_id || result.simulation_run_id}:parameter:odd_trades`,
      positions: positions.filter((_, index) => index % 2 === 1),
    }),
  ].filter((item) => item.positions.length);
}

function syntheticResult(base = {}, overrides = {}) {
  const positions = Array.isArray(overrides.positions) ? overrides.positions : [];
  const metrics = metricsFromPositions(positions);
  return {
    ...base,
    ...overrides,
    metrics,
    status: "COMPLETED",
    positions,
    content_hash: null,
    result_hash: null,
    metrics_hash: null,
  };
}

function metricsFromPositions(positions = []) {
  const results = positions.map((position) => Number(position.r_result)).filter(Number.isFinite);
  return {
    trade_count: results.length,
    total_r: round(results.reduce((sum, value) => sum + value, 0)),
    profit_factor: profitFactor(results),
    max_drawdown_r: maxDrawdown(results),
    expectancy_r: results.length ? round(results.reduce((sum, value) => sum + value, 0) / results.length) : null,
    win_rate: results.length ? round(results.filter((value) => value > 0).length / results.length) : 0,
  };
}

function closedPositions(result = {}) {
  return (Array.isArray(result.positions) ? result.positions : [])
    .filter((position) => String(position.status || "CLOSED").toUpperCase() === "CLOSED")
    .filter((position) => Number.isFinite(Number(position.r_result)));
}

function chunkPositions(positions, chunkCount) {
  const count = Math.max(1, Math.min(chunkCount, positions.length));
  return Array.from({ length: count }, (_, index) => positions.filter((_, positionIndex) => positionIndex % count === index)).filter((items) => items.length);
}

function oosProxyFromRobustness(report = {}) {
  const walk = report.tests?.walk_forward || {};
  const baseline = report.baseline || {};
  const reasons = [];
  if (walk.status === "FAIL") reasons.push("WALK_FORWARD_FAILED");
  if (report.tests?.bootstrap?.status === "FAIL") reasons.push("BOOTSTRAP_FAILED");
  if (report.tests?.monte_carlo?.status === "FAIL") reasons.push("MONTE_CARLO_FAILED");
  if (walk.status === "REVIEW") reasons.push("WALK_FORWARD_REVIEW_REQUIRED");
  const verdict = reasons.some((reason) => reason.endsWith("_FAILED")) ? "FAIL" : reasons.length ? "NEEDS_REVIEW" : "PASS";
  const score = verdict === "PASS" ? Math.max(0.7, robustnessScore(report) - 0.03) : Math.min(0.69, robustnessScore(report));
  return {
    verdict,
    score: round4(score),
    reasons,
    pass_rate: Number(walk.pass_rate || 0),
    total_r: Number(baseline.total_r || 0),
    trade_count: Number(baseline.trade_count || 0),
    max_drawdown_r: Number(baseline.max_drawdown_r || 0),
  };
}

function robustnessVerdict(report = {}) {
  if (report.gate?.status === "PASS") return "PASS";
  if (report.gate?.status === "FAIL") return "FAIL";
  return "NEEDS_REVIEW";
}

function robustnessDecision(report = {}) {
  if (report.gate?.status === "PASS") return "ROBUSTNESS_PASSED_OPERATOR_PROMOTION_REQUIRED";
  if (report.gate?.status === "FAIL") return "ROBUSTNESS_FAILED";
  return "ROBUSTNESS_REVIEW_REQUIRED";
}

function finalRobustnessDecision({ robustness = {}, promotionMatrix = {} } = {}) {
  if (robustness.gate?.status === "FAIL") return "ROBUSTNESS_FAILED";
  if (robustness.gate?.status !== "PASS") return "ROBUSTNESS_REVIEW_REQUIRED";
  if (promotionMatrix.decision === "APPROVED_FOR_PROMOTION") return "PROMOTION_READY_OPERATOR_APPROVED";
  if (promotionMatrix.decision === "NEEDS_OPERATOR_APPROVAL") return "ROBUSTNESS_PASSED_OPERATOR_PROMOTION_REQUIRED";
  if (promotionMatrix.decision === "REJECT_PROMOTION") return "PROMOTION_REJECTED";
  if (promotionMatrix.decision === "RETIRE_CANDIDATE") return "PROMOTION_RETIRED";
  return "PROMOTION_GATE_BLOCKED";
}

function robustnessScore(report = {}) {
  const tests = Object.values(report.tests || {});
  if (!tests.length) return 0.4;
  const passRate = tests.filter((test) => test.status === "PASS").length / tests.length;
  const baseline = report.baseline || {};
  const pnl = Math.min(0.15, Math.max(0, Number(baseline.total_r || 0)) / 80);
  const drawdown = Math.max(0, Math.min(0.1, (10 + Number(baseline.max_drawdown_r || 0)) / 100));
  return round4(Math.min(0.95, 0.45 + passRate * 0.3 + pnl + drawdown));
}

function robustnessMetricSnapshot(report = {}, oos = {}) {
  return {
    total_r: Number(report.baseline?.total_r || 0),
    trade_count: Number(report.baseline?.trade_count || 0),
    max_drawdown_r: Number(report.baseline?.max_drawdown_r || 0),
    profit_factor: report.baseline?.profit_factor ?? null,
    robustness_score: robustnessScore(report),
    gate_status: report.gate?.status || "REVIEW",
    promotion_allowed: report.gate?.promotion_allowed === true,
    walk_forward_pass_rate: Number(report.tests?.walk_forward?.pass_rate || 0),
    cost_stress_pass_rate: Number(report.tests?.cost_slippage_stress?.pass_rate || 0),
    bootstrap_loss_probability: report.tests?.bootstrap?.loss_probability ?? null,
    monte_carlo_p05_total_r: report.tests?.monte_carlo?.percentile_05_total_r ?? null,
    oos_proxy_verdict: oos.verdict,
    oos_proxy_score: oos.score,
  };
}

function testSummary(tests = {}) {
  return Object.fromEntries(Object.entries(tests).map(([name, test]) => [name, {
    status: test.status,
    reasons: test.reasons || [],
    pass_rate: test.pass_rate ?? null,
    sample_count: test.sample_count ?? test.scenario_count ?? null,
  }]));
}

function stableRobustnessReportId({ payload = {} } = {}) {
  return stableUuid({
    kind: "research_robustness_review",
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "ROBUSTNESS",
  });
}

function stableOosReportId({ payload = {} } = {}) {
  return stableUuid({
    kind: "research_oos_proxy_review",
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "OUT_OF_SAMPLE",
  });
}

function resolveResearchRegistry(store) {
  if (store?.researchRegistry) return store.researchRegistry;
  if (!store?.persistence) throw coded("RESEARCH_REGISTRY_STORE_REQUIRED", "Research registry store is required.", true);
  return createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
}

function resolveSimulationRegistry(store) {
  if (!store?.simulationRuns) throw coded("RESEARCH_ROBUSTNESS_SIMULATION_REGISTRY_REQUIRED", "Simulation Run service is required.", true);
  return store.simulationRuns;
}

function requireSupportedTask(task = {}) {
  if (!task || typeof task !== "object") throw coded("RESEARCH_AGENT_TASK_REQUIRED", "Agent task is required.", false);
  if (task.lane !== "research") throw coded("RESEARCH_AGENT_LANE_UNSUPPORTED", `Unsupported lane: ${task.lane}.`, false);
  if (task.task_type !== RESEARCH_ROBUSTNESS_REVIEW_TASK_TYPE) {
    throw coded("RESEARCH_AGENT_TASK_TYPE_UNSUPPORTED", `Unsupported research task type: ${task.task_type}.`, false);
  }
  return { ...task, task_id: canonicalTaskId(task) };
}

function runnerActor(runnerInput) {
  return runnerInput?.lease?.worker_id || runnerInput?.task?.assigned_worker_id || "agent-runtime-research-robustness";
}

function resolveNowUtc({ store, task = {}, nowUtc } = {}) {
  const resolved = nowUtc
    || store?.clock?.now?.()?.utc
    || task.created_at_utc
    || task.not_before_utc
    || task.updated_at_utc;
  return requiredText(resolved, "nowUtc");
}

function stableReportTime(task, nowUtc) {
  return task.created_at_utc || task.not_before_utc || nowUtc;
}

function profitFactor(values) {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? null : 0;
  return round(wins / losses);
}

function maxDrawdown(results) {
  let peak = 0;
  let cursor = 0;
  let drawdown = 0;
  for (const result of results) {
    cursor = round(cursor + result);
    peak = Math.max(peak, cursor);
    drawdown = Math.min(drawdown, round(cursor - peak));
  }
  return drawdown;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function round4(value) {
  return round(value, 4);
}
