import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateEvaluationSummaryV1,
  researchCandidateHashV1,
  validateResearchCandidateV1,
  validateResearchEvaluationReportV1,
  validateResearchExperimentV1,
  validateResearchHypothesisV1,
} from "../index.js";

const NOW = "2026-08-09T08:00:00.000Z";
const experimentId = "11111111-1111-4111-8111-111111111111";
const hypothesisId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const simulationRunId = "44444444-4444-4444-8444-444444444444";

test("TD2-500 validates ResearchExperiment, ResearchHypothesis and ResearchCandidate", () => {
  assert.equal(validateResearchExperimentV1(experiment()).ok, true);
  assert.equal(validateResearchHypothesisV1(hypothesis()).ok, true);
  assert.equal(validateResearchCandidateV1(candidate()).ok, true);
});

test("TD2-500 keeps research candidate lifecycle distinct from StrategyVersion", () => {
  const result = validateResearchCandidateV1(candidate({ status: "PROMOTION_READY" }));

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_STRATEGY_VERSION_REQUIRED"));
});

test("TD2-500 requires evaluation reports to carry deterministic metrics", () => {
  const result = validateResearchEvaluationReportV1(evaluationReport({ metric_snapshot: {} }));

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("RESEARCH_EVALUATION_METRICS_REQUIRED"));
});

test("TD2-504 accepts portfolio fit and promotion matrix reports as first-class evidence", () => {
  const portfolio = validateResearchEvaluationReportV1(evaluationReport({ report_kind: "PORTFOLIO_FIT" }));
  const matrix = validateResearchEvaluationReportV1(evaluationReport({ report_kind: "PROMOTION_MATRIX" }));

  assert.equal(portfolio.ok, true);
  assert.equal(matrix.ok, true);
});

test("TD2-500 builds a candidate evaluation summary without promoting to live", () => {
  const summary = buildResearchCandidateEvaluationSummaryV1({
    research_candidate_id: candidateId,
    evaluation_reports: [
      evaluationReport({ verdict: "PASS", score: 0.82 }),
      evaluationReport({ verdict: "PASS", score: 0.78, report_kind: "OUT_OF_SAMPLE" }),
    ],
  });

  assert.equal(summary.verdict, "PASS");
  assert.equal(summary.promotion_candidate, true);
  assert.equal(summary.composite_score, 0.8);
});

test("TD2-500 blocks candidates when any evaluation fails", () => {
  const summary = buildResearchCandidateEvaluationSummaryV1({
    research_candidate_id: candidateId,
    evaluation_reports: [evaluationReport({ verdict: "PASS", score: 0.9 }), evaluationReport({ verdict: "FAIL", score: 0.2 })],
  });

  assert.equal(summary.verdict, "FAIL");
  assert.equal(summary.promotion_candidate, false);
});

test("TD2-500 hashes canonical ResearchCandidate content", () => {
  const left = researchCandidateHashV1(candidate({ metadata: { b: 2, a: 1 } }));
  const right = researchCandidateHashV1(candidate({ metadata: { a: 1, b: 2 } }));

  assert.match(left, /^sha256:[a-f0-9]{64}$/);
  assert.equal(left, right);
});

function experiment(overrides = {}) {
  return {
    research_experiment_id: experimentId,
    experiment_key: "mnq.breakout.validation",
    name: "MNQ breakout validation",
    objective: "Validate a falsifiable breakout hypothesis on frozen data.",
    owner: "research",
    status: "ACTIVE",
    comparison_metric: "composite_score",
    created_at_utc: NOW,
    ...overrides,
  };
}

function hypothesis(overrides = {}) {
  return {
    research_hypothesis_id: hypothesisId,
    research_experiment_id: experimentId,
    statement: "MNQ breakouts after compressed overnight ranges continue more often.",
    falsifiable_question: "Does the continuation beat the baseline after costs?",
    instrument_scope: ["MNQ"],
    timeframe_scope: ["M15"],
    expected_outcome: "Positive validation composite score.",
    invalidation_criteria: "Fails validation or out-of-sample robustness.",
    created_at_utc: NOW,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: candidateId,
    research_experiment_id: experimentId,
    research_hypothesis_id: hypothesisId,
    candidate_key: "mnq.breakout.validation.v1",
    source_type: "AI_GENERATED",
    status: "IN_SIMULATION",
    primary_change_summary: "Require range compression before breakout retest.",
    novelty_score: 0.62,
    created_at_utc: NOW,
    ...overrides,
  };
}

function evaluationReport(overrides = {}) {
  return {
    research_evaluation_report_id: "55555555-5555-4555-8555-555555555555",
    research_experiment_id: experimentId,
    research_candidate_id: candidateId,
    simulation_run_id: simulationRunId,
    report_kind: "VALIDATION",
    verdict: "PASS",
    score: 0.8,
    metric_snapshot: { total_r: 4.2, max_drawdown_r: -1.1 },
    criteria_snapshot: { min_score: 0.7 },
    artifact_refs: ["simulation://artifact/metrics"],
    created_at_utc: NOW,
    ...overrides,
  };
}
