import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateGenomeV1,
  buildResearchContradictoryValidationPolicyV1,
  buildResearchContradictoryValidationWorkItemsV1,
  planResearchContradictoryValidationWorkflowV1,
} from "../index.js";

test("TD2-502 promotes only after validation, robustness and contradictory review evidence", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput());

  assert.equal(plan.decision, "READY_FOR_PROMOTION_REVIEW");
  assert.equal(plan.evidence.missing_evidence.length, 0);
  assert.equal(plan.metric_gate.status, "pass");
  assert.equal(plan.contradictory_review_gate.status, "pass");
  assert.equal(plan.lifecycle_review.to_status, "UNDER_REVIEW");
  assert.equal(plan.role_assignments.length, 3);
});

test("TD2-502 waits when the contradictory review is missing", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput({
    evaluation_reports: reports().filter((item) => item.kind !== "CONTRADICTORY_REVIEW"),
  }));

  assert.equal(plan.decision, "WAIT_FOR_EVIDENCE");
  assert.ok(plan.evidence.missing_evidence.includes("CONTRADICTORY_REVIEW"));
  assert.equal(plan.lifecycle_review, null);
});

test("TD2-502 rejects a candidate when validation fails and keeps a negative result ref", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput({
    evaluation_reports: reports().map((item) => item.kind === "VALIDATION" ? { ...item, verdict: "FAIL", score: 0.22 } : item),
  }));

  assert.equal(plan.decision, "REJECT_CANDIDATE");
  assert.ok(plan.reasons.includes("VALIDATION_REPORT_FAIL"));
  assert.equal(plan.decision_audit.normalized.decision, "STOP_REJECT");
  assert.match(plan.decision_audit.normalized.negative_result_ref, /^negative_result:candidate-502:/);
});

test("TD2-502 requests revision when contradictory objections remain unresolved", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput({
    evaluation_reports: reports().map((item) => item.kind === "CONTRADICTORY_REVIEW" ? { ...item, objections: ["Session filter too narrow"] } : item),
  }));

  assert.equal(plan.decision, "REQUIRES_REVISION");
  assert.ok(plan.reasons.includes("CONTRADICTORY_OBJECTIONS_UNRESOLVED"));
});

test("TD2-502 blocks retests already present in active failure memory", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput({
    failure_records: [{
      failure_id: "failure:prior-low-edge",
      candidate: candidate(),
      cause_codes: ["LOW_EDGE"],
      root_cause_summary: "Low edge after costs.",
      negative_result_ref: "report:old-negative",
      evidence_refs: ["report:old-negative"],
    }],
  }));

  assert.equal(plan.decision, "REJECT_CANDIDATE");
  assert.ok(plan.reasons.includes("FAILURE_MEMORY_BLOCK_RETEST"));
});

test("TD2-502 emits explicit validation work items for the IA roles", () => {
  const plan = planResearchContradictoryValidationWorkflowV1(validInput());
  const workItems = buildResearchContradictoryValidationWorkItemsV1(plan);
  const policy = buildResearchContradictoryValidationPolicyV1();

  assert.deepEqual(plan.policy.required_roles, policy.required_roles);
  assert.ok(workItems.some((item) => item.role_id === "research_reviewer" && item.expected_output.includes("contradictory_review")));
  assert.ok(workItems.every((item) => item.input_refs.research_candidate_id === "candidate-502"));
});

test("TD2-502 catches too-close genomes before promotion review", () => {
  const existing = buildResearchCandidateGenomeV1(candidate({
    research_candidate_id: "candidate-too-close",
    confirmation_signals: ["VWAP", "RSI", "DXY"],
  }));
  const plan = planResearchContradictoryValidationWorkflowV1(validInput({
    existing_genomes: [existing],
    duplicate_threshold: 0.99,
    too_close_threshold: 0.7,
  }));

  assert.equal(plan.decision, "REQUIRES_REVISION");
  assert.ok(plan.reasons.includes("NOVELTY_TOO_CLOSE"));
});

function validInput(overrides = {}) {
  return {
    candidate: candidate(),
    hypothesis: hypothesis(),
    evaluation_reports: reports(),
    actor_ref: "operator:research",
    reviewer_ref: "reviewer:contradictory",
    idempotency_key: "idem-td2-502",
    created_at_utc: "2026-08-09T10:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: "candidate-502",
    candidate_key: "mnq.breakout.retest.502",
    research_experiment_id: "exp-502",
    research_hypothesis_id: "hyp-502",
    source_type: "AI_GENERATED",
    status: "IN_SIMULATION",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation after compression trend.",
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
    research_experiment_id: "exp-502",
    research_hypothesis_id: "hyp-502",
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
    { report_id: "report:validation", kind: "VALIDATION", verdict: "PASS", score: 0.78, simulation_run_id: "sim:validation" },
    { report_id: "report:robustness", kind: "ROBUSTNESS", verdict: "PASS", score: 0.7, simulation_run_id: "sim:robustness" },
    { report_id: "report:contradictory", kind: "CONTRADICTORY_REVIEW", verdict: "PASS", score: 0.76 },
  ];
}
