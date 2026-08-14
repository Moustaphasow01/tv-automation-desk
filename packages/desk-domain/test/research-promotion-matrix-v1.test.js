import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchPromotionMatrixPolicyV1,
  buildResearchPromotionRollbackPlanV1,
  evaluateResearchPromotionMatrixV1,
  normalizeOperatorApprovalV1,
  planResearchContradictoryValidationWorkflowV1,
} from "../index.js";

test("TD2-503 approves promotion only after validation gates and operator approval", () => {
  const matrix = evaluateResearchPromotionMatrixV1(validInput());

  assert.equal(matrix.decision, "APPROVED_FOR_PROMOTION");
  assert.equal(matrix.lifecycle_promotion.to_status, "PROMOTION_READY");
  assert.equal(matrix.gates.operator_approval.ok, true);
  assert.equal(matrix.gates.rollback_plan.ok, true);
  assert.equal(matrix.policy.thresholds.min_priority_score, 0.5);
});

test("TD2-503 keeps a candidate pending until operator approval is explicit", () => {
  const matrix = evaluateResearchPromotionMatrixV1(validInput({
    operator_approval: { status: "PENDING" },
  }));

  assert.equal(matrix.decision, "NEEDS_OPERATOR_APPROVAL");
  assert.deepEqual(matrix.reasons, ["OPERATOR_APPROVAL_REQUIRED"]);
  assert.equal(matrix.lifecycle_promotion, null);
});

test("TD2-503 rejects promotion when the operator rejects it", () => {
  const matrix = evaluateResearchPromotionMatrixV1(validInput({
    operator_approval: { approval_id: "approval:reject", status: "REJECTED", operator_ref: "operator:head", reason: "Too much drift." },
  }));

  assert.equal(matrix.decision, "REJECT_PROMOTION");
  assert.ok(matrix.reasons.includes("OPERATOR_REJECTED_PROMOTION"));
});

test("TD2-503 blocks promotion when contradictory validation is not ready", () => {
  const validationPlan = validationReadyPlan({ evaluation_reports: reports().filter((item) => item.kind !== "CONTRADICTORY_REVIEW") });
  const matrix = evaluateResearchPromotionMatrixV1(validInput({ validation_plan: validationPlan }));

  assert.equal(validationPlan.decision, "WAIT_FOR_EVIDENCE");
  assert.equal(matrix.decision, "BLOCKED");
  assert.equal(matrix.gates.contradictory_validation.ok, false);
});

test("TD2-503 blocks low priority candidates even if validation is green", () => {
  const matrix = evaluateResearchPromotionMatrixV1(validInput({
    priority_score: { schema_version: "research_priority_score_v1", priority_score: 0.2, decision: "DEFER" },
  }));

  assert.equal(matrix.decision, "BLOCKED");
  assert.equal(matrix.gates.priority.ok, false);
});

test("TD2-503 exposes versioned approvals and rollback plans", () => {
  const approval = normalizeOperatorApprovalV1({ approval_id: "approval:1", status: "approved", operator_ref: "operator:head" });
  const rollback = buildResearchPromotionRollbackPlanV1({
    candidate: candidate(),
    previous_strategy_version_id: "strategy-version:previous",
  });
  const policy = buildResearchPromotionMatrixPolicyV1({ min_priority_score: 0.55 });

  assert.equal(approval.ok, true);
  assert.equal(approval.status, "APPROVED");
  assert.equal(rollback.ok, true);
  assert.equal(rollback.trigger_policy.revert_to_previous_when_available, true);
  assert.equal(policy.thresholds.min_priority_score, 0.55);
});

test("TD2-503 supports explicit retirement decisions without publishing", () => {
  const matrix = evaluateResearchPromotionMatrixV1(validInput({ action: "RETIRE" }));

  assert.equal(matrix.decision, "RETIRE_CANDIDATE");
  assert.equal(matrix.lifecycle_promotion, null);
});

function validInput(overrides = {}) {
  return {
    candidate: candidate(),
    validation_plan: validationReadyPlan(),
    priority_score: { schema_version: "research_priority_score_v1", priority_score: 0.82, decision: "HIGH_PRIORITY" },
    operator_approval: { approval_id: "approval:promote", status: "APPROVED", operator_ref: "operator:head", reason: "Validated." },
    previous_strategy_version_id: "strategy-version:previous",
    actor_ref: "operator:head",
    idempotency_key: "idem-td2-503",
    created_at_utc: "2026-08-09T11:00:00.000Z",
    ...overrides,
  };
}

function validationReadyPlan(overrides = {}) {
  return planResearchContradictoryValidationWorkflowV1({
    candidate: candidate(),
    hypothesis: hypothesis(),
    evaluation_reports: reports(),
    actor_ref: "operator:research",
    reviewer_ref: "reviewer:contradictory",
    idempotency_key: "idem-td2-502-for-503",
    created_at_utc: "2026-08-09T10:00:00.000Z",
    ...overrides,
  });
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: "candidate-503",
    candidate_key: "mnq.breakout.retest.503",
    research_experiment_id: "exp-503",
    research_hypothesis_id: "hyp-503",
    source_type: "AI_GENERATED",
    status: "UNDER_REVIEW",
    strategy_version_id: "strategy-version:503",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["tp1"],
    risk_model: ["fixed_risk_pct"],
    ...overrides,
  };
}

function hypothesis() {
  return {
    research_experiment_id: "exp-503",
    research_hypothesis_id: "hyp-503",
    statement: "Breakout retest after compressed trend context improves MNQ continuation.",
    falsifiable_question: "Does the breakout retest beat baseline by at least 0.3R out of sample?",
    expected_outcome: "Higher validation score and lower drawdown than baseline.",
    invalidation_criteria: "Reject if out-of-sample expectancy is below baseline or drawdown increases.",
    dataset_scope: { instruments: ["MNQ"], sessions: ["ny_open"], split: "walk_forward" },
  };
}

function reports() {
  return [
    { report_id: "report:baseline", kind: "TRAIN", verdict: "PASS", score: 0.73, simulation_run_id: "sim:baseline" },
    { report_id: "report:validation", kind: "VALIDATION", verdict: "PASS", score: 0.8, simulation_run_id: "sim:validation" },
    { report_id: "report:robustness", kind: "ROBUSTNESS", verdict: "PASS", score: 0.71, simulation_run_id: "sim:robustness" },
    { report_id: "report:contradictory", kind: "CONTRADICTORY_REVIEW", verdict: "PASS", score: 0.78 },
  ];
}
