import {
  canonicalSha256,
  evaluateResearchPromotionMatrixV1,
  planResearchContradictoryValidationWorkflowV1,
} from "@tv-automation/desk-domain";
import { requiredText, stableUuid } from "./research-strategy-iteration-common.js";

export const RESEARCH_PROMOTION_GATE_EVALUATIONS_SCHEMA_VERSION = "research_promotion_gate_evaluations_v1";

export function buildResearchPromotionGateEvaluationReports({
  task = {},
  payload = {},
  candidate = {},
  baselineRun = {},
  baselineResult = {},
  robustness = {},
  robustnessReport = {},
  oosReport = {},
  existingEvaluationReports = [],
  actor = "agent-runtime-research-robustness",
  nowUtc,
} = {}) {
  const portfolioFit = buildPortfolioFitAssessment({ payload, candidate, baselineRun, baselineResult, robustness });
  const portfolioFitReport = {
    research_evaluation_report_id: stablePortfolioFitReportId({ payload }),
    research_experiment_id: requiredText(candidate.research_experiment_id, "research_experiment_id"),
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "PORTFOLIO_FIT",
    verdict: portfolioFit.verdict,
    score: portfolioFit.score,
    metric_snapshot: portfolioFit.metric_snapshot,
    criteria_snapshot: {
      schema_version: RESEARCH_PROMOTION_GATE_EVALUATIONS_SCHEMA_VERSION,
      decision: portfolioFit.decision,
      policy: portfolioFit.policy,
      reasons: portfolioFit.reasons,
      portfolio_context_hash: portfolioFit.portfolio_context_hash,
      automatic_execution_enabled: false,
      live_authorization: false,
    },
    artifact_refs: [
      `simulation-run://${payload.simulation_run_id}`,
      baselineRun.result_ref,
      baselineRun.metrics_ref,
      `robustness-report://${robustness.content_hash}`,
    ].filter(Boolean),
    reviewer_ref: actor,
    metadata: reportMetadata({ task, payload, candidate, baselineRun, nowUtc }),
    created_at_utc: stableReportTime(task, nowUtc),
  };
  const validationPlan = buildValidationPlan({
    payload,
    candidate,
    baselineRun,
    baselineResult,
    robustnessReport,
    oosReport,
    portfolioFitReport,
    existingEvaluationReports,
    nowUtc,
  });
  const promotionMatrix = evaluateResearchPromotionMatrixV1({
    candidate: {
      ...candidate,
      status: candidate.status || "UNDER_REVIEW",
      strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id,
    },
    validation_plan: validationPlan,
    priority_score: priorityFromPortfolioFit(portfolioFit),
    operator_approval: operatorApprovalFrom({ payload, candidate }),
    previous_strategy_version_id: previousStrategyVersionId({ payload, candidate }),
    actor_ref: actor,
    idempotency_key: `idem_research_promotion_matrix_${stablePromotionMatrixReportId({ payload })}`,
    created_at_utc: stableReportTime(task, nowUtc),
  });
  const matrixVerdict = promotionMatrixVerdict({ promotionMatrix, robustnessReport, oosReport, portfolioFitReport });
  const promotionMatrixReport = {
    ...portfolioFitReport,
    research_evaluation_report_id: stablePromotionMatrixReportId({ payload }),
    report_kind: "PROMOTION_MATRIX",
    verdict: matrixVerdict,
    score: promotionMatrixScore({ promotionMatrix, portfolioFit, matrixVerdict }),
    metric_snapshot: {
      robustness_score: Number(robustnessReport.score ?? 0),
      oos_score: Number(oosReport.score ?? 0),
      portfolio_fit_score: portfolioFit.score,
      priority_score: Number(promotionMatrix.priority_score?.priority_score ?? 0),
      blocked_gate_count: Object.values(promotionMatrix.gates || {}).filter((gate) => gate?.ok === false).length,
      live_authorization: 0,
      automatic_execution_enabled: 0,
    },
    criteria_snapshot: {
      schema_version: RESEARCH_PROMOTION_GATE_EVALUATIONS_SCHEMA_VERSION,
      decision: promotionMatrix.decision,
      reasons: promotionMatrix.reasons,
      matrix: promotionMatrix,
      validation_plan_ref: promotionMatrix.validation_plan_ref,
      validation_decision: validationPlan.decision,
      gates: canonicalGates({ promotionMatrix, validationPlan, portfolioFitReport, robustnessReport, oosReport }),
      semi_manual_required: true,
      operator_approval_required: true,
      automatic_execution_enabled: false,
      live_authorization: false,
      portfolio_fit_report_id: portfolioFitReport.research_evaluation_report_id,
    },
    artifact_refs: [
      ...portfolioFitReport.artifact_refs,
      `research-evaluation-report://${portfolioFitReport.research_evaluation_report_id}`,
      `research-evaluation-report://${robustnessReport.research_evaluation_report_id}`,
      `research-evaluation-report://${oosReport.research_evaluation_report_id}`,
    ],
    metadata: {
      ...portfolioFitReport.metadata,
      portfolio_fit_report_id: portfolioFitReport.research_evaluation_report_id,
      promotion_matrix_hash: promotionMatrix.matrix_hash,
      final_promotion_decision: promotionMatrix.decision,
      policy: "SEMI_MANUAL",
    },
  };
  return {
    portfolio_fit: portfolioFit,
    validation_plan: validationPlan,
    promotion_matrix: promotionMatrix,
    reports: [portfolioFitReport, promotionMatrixReport],
  };
}

export function buildPortfolioFitAssessment({
  payload = {},
  candidate = {},
  baselineRun = {},
  baselineResult = {},
  robustness = {},
} = {}) {
  const context = portfolioContextFrom({ payload, candidate, baselineRun });
  const metrics = baselineResult.metrics || robustness.baseline || {};
  const policy = {
    min_trade_count: 8,
    min_total_r: 0,
    min_profit_factor: 1,
    max_drawdown_floor_r: -10,
    max_declared_correlation_abs: 0.75,
    correlation_required_before_promotion: true,
    risk_budget_required_before_promotion: true,
  };
  const review = [];
  const fails = [];
  const tradeCount = Number(metrics.trade_count ?? robustness.baseline?.trade_count ?? 0);
  const totalR = Number(metrics.total_r ?? robustness.baseline?.total_r ?? 0);
  const profitFactor = finiteOrNull(metrics.profit_factor ?? robustness.baseline?.profit_factor);
  const maxDrawdownR = Number(metrics.max_drawdown_r ?? robustness.baseline?.max_drawdown_r ?? 0);
  const maxAbsCorrelation = maxAbsDeclaredCorrelation(context);
  if (tradeCount < policy.min_trade_count) fails.push("PORTFOLIO_FIT_TRADE_COUNT_BELOW_POLICY");
  if (totalR < policy.min_total_r) fails.push("PORTFOLIO_FIT_TOTAL_R_BELOW_POLICY");
  if (profitFactor !== null && profitFactor < policy.min_profit_factor) fails.push("PORTFOLIO_FIT_PROFIT_FACTOR_BELOW_POLICY");
  if (maxDrawdownR < policy.max_drawdown_floor_r) fails.push("PORTFOLIO_FIT_DRAWDOWN_BELOW_POLICY");
  if (maxAbsCorrelation !== null && maxAbsCorrelation > policy.max_declared_correlation_abs) fails.push("PORTFOLIO_FIT_CORRELATION_TOO_HIGH");
  if (maxAbsCorrelation === null) review.push("PORTFOLIO_CORRELATION_NOT_PROVEN");
  if (!hasRiskBudget(context)) review.push("PORTFOLIO_RISK_BUDGET_NOT_PROVEN");
  const verdict = fails.length ? "FAIL" : review.length ? "NEEDS_REVIEW" : "PASS";
  const score = portfolioFitScore({ tradeCount, totalR, profitFactor, maxDrawdownR, maxAbsCorrelation, verdict });
  return {
    verdict,
    decision: verdict === "PASS" ? "PORTFOLIO_FIT_ACCEPTABLE" : verdict === "FAIL" ? "PORTFOLIO_FIT_BLOCKED" : "PORTFOLIO_FIT_REVIEW_REQUIRED",
    score,
    reasons: [...fails, ...review],
    policy,
    portfolio_context_hash: `sha256:${canonicalSha256(context)}`,
    metric_snapshot: {
      trade_count: tradeCount,
      total_r: round4(totalR),
      profit_factor: profitFactor,
      max_drawdown_r: round4(maxDrawdownR),
      declared_correlation_count: declaredCorrelations(context).length,
      max_abs_declared_correlation: maxAbsCorrelation,
      risk_budget_declared: hasRiskBudget(context),
    },
  };
}

function buildValidationPlan({ payload, candidate, baselineRun, baselineResult, robustnessReport, oosReport, portfolioFitReport, existingEvaluationReports, nowUtc }) {
  const reports = [
    baselineValidationReport({ payload, baselineRun, baselineResult }),
    ...normalizeExistingReports(existingEvaluationReports),
    toValidationReport(robustnessReport),
    toValidationReport(oosReport),
    toValidationReport(portfolioFitReport),
  ].filter(Boolean);
  return planResearchContradictoryValidationWorkflowV1({
    candidate: {
      ...candidate,
      status: candidate.status || "UNDER_REVIEW",
      strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id,
    },
    hypothesis: {
      research_experiment_id: candidate.research_experiment_id,
      research_hypothesis_id: candidate.research_hypothesis_id,
      statement: candidate.metadata?.hypothesis_statement || "Candidate must remain profitable after robust validation and portfolio fit.",
      falsifiable_question: "Does the candidate keep acceptable OOS, robustness and portfolio-fit properties after costs?",
      expected_outcome: "Promotion matrix can reach operator approval state only after robust evidence is present.",
      invalidation_criteria: "Reject or block when validation, robustness, OOS, portfolio fit or operator approval evidence is missing.",
      dataset_scope: {
        dataset_id: payload.dataset_id || baselineRun.dataset_id || null,
        dataset_key: payload.dataset_key || baselineRun.metadata?.dataset_key || null,
      },
    },
    evaluation_reports: reports,
    actor_ref: "research_promotion_gate_evaluations_v1",
    reviewer_ref: "research_promotion_gate_evaluations_v1",
    idempotency_key: `idem_validation_plan_${payload.research_candidate_id}_${payload.simulation_run_id}`,
    created_at_utc: nowUtc,
  });
}

function baselineValidationReport({ payload = {}, baselineRun = {}, baselineResult = {} } = {}) {
  const metrics = baselineResult.metrics || baselineRun.metadata?.metrics || {};
  return {
    report_id: `baseline:${payload.simulation_run_id || baselineRun.simulation_run_id}`,
    kind: "TRAIN",
    verdict: baselineRun.status === "FAILED" ? "FAIL" : "PASS",
    score: baselineScore(metrics),
    simulation_run_id: payload.simulation_run_id || baselineRun.simulation_run_id,
    metrics,
    evidence_ref: `simulation-run://${payload.simulation_run_id || baselineRun.simulation_run_id}`,
    objections: baselineRun.status === "FAILED" ? ["BASELINE_RUN_FAILED"] : [],
  };
}

function canonicalGates({ promotionMatrix, validationPlan, portfolioFitReport, robustnessReport, oosReport }) {
  return {
    G0_DATASET_VERSIONED: gate(Boolean(robustnessReport.metadata?.dataset_id), robustnessReport.metadata?.dataset_id || "DATASET_ID_REQUIRED"),
    G1_VALIDATION_EVIDENCE: gate(validationPlan.evidence?.present_evidence?.includes("VALIDATION_REPORT"), validationPlan.evidence?.missing_evidence || []),
    G2_ROBUSTNESS: gate(robustnessReport.verdict === "PASS", robustnessReport.criteria_snapshot?.gate?.reasons || robustnessReport.verdict),
    G3_OUT_OF_SAMPLE: gate(oosReport.verdict === "PASS", oosReport.criteria_snapshot?.reasons || oosReport.verdict),
    G4_PORTFOLIO_FIT: gate(portfolioFitReport.verdict === "PASS", portfolioFitReport.criteria_snapshot?.reasons || portfolioFitReport.verdict),
    G5_PROMOTION_MATRIX: gate(promotionMatrix.decision === "APPROVED_FOR_PROMOTION" || promotionMatrix.decision === "NEEDS_OPERATOR_APPROVAL", promotionMatrix.decision),
    G6_OPERATOR_APPROVAL: gate(promotionMatrix.gates?.operator_approval?.ok === true, promotionMatrix.operator_approval?.status || "PENDING"),
    G7_LIVE_AUTHORIZATION: gate(false, "LIVE_AUTHORIZATION_EXPLICITLY_DISABLED_IN_SEMI_MANUAL_PREPROD"),
  };
}

function promotionMatrixVerdict({ promotionMatrix, robustnessReport, oosReport, portfolioFitReport }) {
  if (promotionMatrix.decision === "APPROVED_FOR_PROMOTION") return "PASS";
  if (promotionMatrix.decision === "NEEDS_OPERATOR_APPROVAL") return "NEEDS_REVIEW";
  if ([robustnessReport.verdict, oosReport.verdict, portfolioFitReport.verdict].includes("FAIL")) return "FAIL";
  if (promotionMatrix.decision === "REJECT_PROMOTION" || promotionMatrix.decision === "RETIRE_CANDIDATE") return "FAIL";
  return "NEEDS_REVIEW";
}

function promotionMatrixScore({ promotionMatrix, portfolioFit, matrixVerdict }) {
  const raw = Number(promotionMatrix.priority_score?.priority_score ?? portfolioFit.score ?? 0);
  if (matrixVerdict === "PASS") return round4(Math.max(0.7, raw));
  if (matrixVerdict === "NEEDS_REVIEW") return round4(Math.min(0.69, Math.max(0.45, raw)));
  return round4(Math.min(0.49, raw));
}

function priorityFromPortfolioFit(portfolioFit) {
  const score = portfolioFit.verdict === "PASS"
    ? Math.max(0.72, portfolioFit.score)
    : portfolioFit.verdict === "NEEDS_REVIEW"
      ? Math.min(0.49, portfolioFit.score)
      : Math.min(0.2, portfolioFit.score);
  return {
    schema_version: "research_priority_score_v1",
    priority_score: round4(score),
    decision: score >= 0.7 ? "HIGH_PRIORITY" : score >= 0.5 ? "MEDIUM_PRIORITY" : score >= 0.3 ? "LOW_PRIORITY" : "DEFER",
    factors: { portfolio_fit: portfolioFit.score },
  };
}

function portfolioFitScore({ tradeCount, totalR, profitFactor, maxDrawdownR, maxAbsCorrelation, verdict }) {
  const tradeComponent = Math.min(0.15, tradeCount / 100);
  const pnlComponent = Math.min(0.2, Math.max(0, totalR) / 50);
  const pfComponent = profitFactor === null ? 0.05 : Math.min(0.2, Math.max(0, profitFactor - 1) / 5);
  const drawdownComponent = Math.max(0, Math.min(0.15, (10 + maxDrawdownR) / 100));
  const correlationComponent = maxAbsCorrelation === null ? 0 : Math.max(0, Math.min(0.1, 0.75 - maxAbsCorrelation));
  const score = 0.35 + tradeComponent + pnlComponent + pfComponent + drawdownComponent + correlationComponent;
  if (verdict === "FAIL") return round4(Math.min(0.49, score));
  if (verdict === "NEEDS_REVIEW") return round4(Math.min(0.69, score));
  return round4(Math.max(0.7, Math.min(0.95, score)));
}

function baselineScore(metrics = {}) {
  const totalR = Number(metrics.total_r || 0);
  const profitFactor = finiteOrNull(metrics.profit_factor);
  const maxDrawdownR = Number(metrics.max_drawdown_r || 0);
  const score = 0.5
    + Math.min(0.2, Math.max(0, totalR) / 50)
    + (profitFactor === null ? 0.05 : Math.min(0.2, Math.max(0, profitFactor - 1) / 5))
    + Math.max(0, Math.min(0.1, (10 + maxDrawdownR) / 100));
  return round4(Math.max(0, Math.min(0.95, score)));
}

function toValidationReport(report) {
  if (!report?.report_kind) return null;
  return {
    report_id: report.research_evaluation_report_id,
    kind: report.report_kind,
    verdict: report.verdict,
    score: report.score,
    simulation_run_id: report.simulation_run_id,
    metrics: report.metric_snapshot,
    evidence_ref: `research-evaluation-report://${report.research_evaluation_report_id}`,
    objections: report.verdict === "PASS" ? [] : report.criteria_snapshot?.reasons || report.criteria_snapshot?.gate?.reasons || [],
  };
}

function normalizeExistingReports(reports = []) {
  return (Array.isArray(reports) ? reports : []).map(toValidationReport);
}

function operatorApprovalFrom({ payload = {}, candidate = {} } = {}) {
  return payload.operator_approval || candidate.metadata?.operator_approval || { status: "PENDING" };
}

function previousStrategyVersionId({ payload = {}, candidate = {} } = {}) {
  return payload.previous_strategy_version_id || candidate.metadata?.previous_strategy_version_id || "";
}

function portfolioContextFrom({ payload = {}, candidate = {}, baselineRun = {} } = {}) {
  return payload.portfolio_context || candidate.metadata?.portfolio_context || baselineRun.metadata?.portfolio_context || {};
}

function declaredCorrelations(context = {}) {
  const value = context.correlations || context.strategy_correlations || context.existing_strategy_correlations;
  return Array.isArray(value) ? value : [];
}

function maxAbsDeclaredCorrelation(context = {}) {
  const values = declaredCorrelations(context)
    .map((item) => Number(typeof item === "number" ? item : item.correlation ?? item.rho ?? item.value))
    .filter(Number.isFinite)
    .map(Math.abs);
  return values.length ? round4(Math.max(...values)) : null;
}

function hasRiskBudget(context = {}) {
  return Boolean(context.risk_budget || context.risk_budget_r || context.portfolio_risk_budget || context.account_risk_budget);
}

function stablePortfolioFitReportId({ payload = {} } = {}) {
  return stableUuid({
    kind: "research_portfolio_fit_review",
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "PORTFOLIO_FIT",
  });
}

function stablePromotionMatrixReportId({ payload = {} } = {}) {
  return stableUuid({
    kind: "research_promotion_matrix_review",
    research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requiredText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "PROMOTION_MATRIX",
  });
}

function reportMetadata({ task = {}, payload = {}, candidate = {}, baselineRun = {}, nowUtc } = {}) {
  return {
    schema_version: RESEARCH_PROMOTION_GATE_EVALUATIONS_SCHEMA_VERSION,
    task_id: task.task_id || task.agent_task_id || null,
    task_key: task.task_key || null,
    lane: task.lane || null,
    strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || baselineRun.strategy_version_id || null,
    dataset_id: payload.dataset_id || baselineRun.dataset_id || null,
    dataset_key: payload.dataset_key || baselineRun.metadata?.dataset_key || null,
    checked_at_utc: nowUtc || null,
    policy: "SEMI_MANUAL",
  };
}

function stableReportTime(task = {}, nowUtc) {
  return task.created_at_utc || task.not_before_utc || nowUtc;
}

function gate(ok, detail) {
  return { ok: Boolean(ok), detail };
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
