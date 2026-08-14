import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESEARCH_AGENT_ROLE_IDS_V1,
  buildResearchDecisionAuditV1,
  buildResearchScientificMissionV1,
  buildResearchScientificProcessPolicyV1,
  evaluateResearchBudgetUsageV1,
  evaluateResearchScientificProcessV1,
  validateResearchHypothesisProtocolV1,
} from "../index.js";

const hypothesis = {
  research_experiment_id: "exp-breakout-2026-06",
  research_hypothesis_id: "hyp-breakout-retest-01",
  statement: "MNQ continuation after VWAP reclaim can beat the baseline after fees.",
  falsifiable_question: "Does a VWAP reclaim retest beat the baseline after fees?",
  expected_outcome: "Higher net R with bounded drawdown.",
  invalidation_criteria: "Reject if validation score is below 0.70 or robustness fails.",
  dataset_scope: { instruments: ["MNQ"], from: "2026-06-01", to: "2026-07-25", granularity: "M1" },
  variable_set: { vwap_reclaim: true, rsi_filter: "optional" },
};

test("TD2-506 requires every research mission to start with a falsifiable hypothesis", () => {
  const invalid = validateResearchHypothesisProtocolV1({
    statement: "Try a nicer breakout idea.",
    falsifiable_question: "Find trades",
    expected_outcome: "More trades",
    dataset_scope: { instruments: ["MNQ"] },
  });
  const valid = validateResearchHypothesisProtocolV1(hypothesis);

  assert.equal(invalid.ok, false);
  assert.ok(invalid.reasons.includes("RESEARCH_HYPOTHESIS_QUESTION_NOT_FALSIFIABLE"));
  assert.ok(invalid.reasons.includes("RESEARCH_TEXT_REQUIRED"));
  assert.equal(valid.ok, true);
});

test("TD2-506 exposes visible budgets and the exact Research Lab role sequence", () => {
  const policy = buildResearchScientificProcessPolicyV1();
  const mission = buildResearchScientificMissionV1({ hypothesis, objective: "Evaluate VWAP reclaim continuation." });

  assert.deepEqual(policy.role_sequence, [...RESEARCH_AGENT_ROLE_IDS_V1]);
  assert.equal(policy.total_budget.max_tokens, 500000);
  assert.equal(policy.gates.negative_results_must_be_retained, true);
  assert.equal(mission.ok, true);
  assert.equal(mission.mission.budget_plan.max_simulation_runs, 20);
  assert.equal(mission.mission.negative_result_retention_required, true);
  assert.match(mission.mission_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-506 applies token CPU time simulation candidate and iteration budgets", () => {
  const budget = evaluateResearchBudgetUsageV1({
    policy: { total_budget: { max_tokens: 1000, max_compute_seconds: 60, max_simulation_runs: 2 } },
    usage: { tokens: 1001, compute_seconds: 61, simulation_runs: 3, candidates: 0, iterations: 0 },
  });

  assert.equal(budget.ok, false);
  assert.equal(budget.status, "budget_exhausted");
  assert.deepEqual(budget.exhausted_dimensions, ["tokens", "compute_seconds", "simulation_runs"]);
});

test("TD2-506 preserves negative results instead of silently retrying forever", () => {
  const decision = evaluateResearchScientificProcessV1({
    hypothesis,
    evidence: ["BASELINE_RUN", "VALIDATION_REPORT"],
    evaluation_reports: [{ report_kind: "VALIDATION", verdict: "FAIL", score: 0.42 }],
  });
  const retained = evaluateResearchScientificProcessV1({
    hypothesis,
    evidence: ["BASELINE_RUN", "VALIDATION_REPORT"],
    negative_result_ref: "research_negative_result:exp-breakout-2026-06:hyp-breakout-retest-01",
    evaluation_reports: [{ report_kind: "VALIDATION", verdict: "FAIL", score: 0.42, persisted: true }],
  });

  assert.equal(decision.decision, "STOP_REJECT");
  assert.equal(decision.negative_result_retention.required, true);
  assert.equal(decision.negative_result_retention.retained, false);
  assert.equal(retained.negative_result_retention.retained, true);
});

test("TD2-506 promotes only when baseline validation robustness and review evidence are present", () => {
  const waiting = evaluateResearchScientificProcessV1({
    hypothesis,
    evidence: ["BASELINE_RUN", "VALIDATION_REPORT"],
  });
  const ready = evaluateResearchScientificProcessV1({
    hypothesis,
    evidence: ["BASELINE_RUN", "VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW"],
  });

  assert.equal(waiting.decision, "WAIT_FOR_EVIDENCE");
  assert.deepEqual(waiting.missing_evidence.filter((item) => item !== "NEGATIVE_RESULT_RECORD" && item !== "DECISION_AUDIT"), ["ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW"]);
  assert.equal(ready.decision, "PROMOTE_TO_REVIEW");
});

test("TD2-506 decision audit requires evidence and negative-result retention for stops", () => {
  const rejected = buildResearchDecisionAuditV1({
    decision: "STOP_REJECT",
    reason: "Validation failed.",
    reviewer_ref: "research_reviewer",
    evidence_refs: ["research_evaluation_report:validation:01"],
  });
  const accepted = buildResearchDecisionAuditV1({
    decision: "STOP_REJECT",
    reason: "Validation failed.",
    reviewer_ref: "research_reviewer",
    evidence_refs: ["research_evaluation_report:validation:01"],
    negative_result_ref: "research_negative_result:validation:01",
  });

  assert.equal(rejected.ok, false);
  assert.ok(rejected.reasons.includes("RESEARCH_NEGATIVE_RESULT_RETENTION_REQUIRED"));
  assert.equal(accepted.ok, true);
  assert.match(accepted.audit_hash, /^sha256:[a-f0-9]{64}$/);
});
