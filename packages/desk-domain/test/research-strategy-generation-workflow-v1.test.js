import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateGenomeV1,
  buildResearchStrategyGenerationPolicyV1,
  buildResearchStrategyGenerationWorkItemsV1,
  planResearchStrategyGenerationWorkflowV1,
} from "../index.js";

test("TD2-501 turns a falsifiable idea into a baseline-ready candidate", () => {
  const plan = planResearchStrategyGenerationWorkflowV1(validInput());

  assert.equal(plan.decision, "READY_FOR_BASELINE");
  assert.equal(plan.scientific_mission.status, "READY");
  assert.equal(plan.candidate.status, "IDEA");
  assert.equal(plan.lifecycle_start.to_status, "BASELINE_REQUIRED");
  assert.ok(plan.role_assignments.every((item) => item.ok));
  assert.equal(plan.work_items.length, 3);
});

test("TD2-501 rejects non-falsifiable ideas before candidate work is scheduled", () => {
  const plan = planResearchStrategyGenerationWorkflowV1(validInput({
    hypothesis: {
      ...hypothesis(),
      falsifiable_question: "Can we think about it?",
      dataset_scope: {},
    },
  }));

  assert.equal(plan.decision, "INVALID_IDEA");
  assert.equal(plan.lifecycle_start, null);
  assert.ok(plan.reasons.includes("RESEARCH_DATASET_SCOPE_REQUIRED"));
});

test("TD2-501 blocks obvious duplicate genomes", () => {
  const duplicate = buildResearchCandidateGenomeV1(candidateIdea());
  const plan = planResearchStrategyGenerationWorkflowV1(validInput({ existing_genomes: [duplicate] }));

  assert.equal(plan.decision, "BLOCKED_DUPLICATE");
  assert.equal(plan.novelty.decision, "DUPLICATE");
  assert.equal(plan.lifecycle_start, null);
});

test("TD2-501 blocks candidates that match active failure memory", () => {
  const plan = planResearchStrategyGenerationWorkflowV1(validInput({
    failure_records: [{
      failure_id: "failure:old-overfit",
      candidate: candidateIdea(),
      cause_codes: ["OVERFIT"],
      root_cause_summary: "Overfit on validation.",
      negative_result_ref: "report:old",
      evidence_refs: ["report:old"],
    }],
  }));

  assert.equal(plan.decision, "BLOCKED_FAILURE_MEMORY");
  assert.equal(plan.failure_memory.decision, "BLOCK_RETEST");
});

test("TD2-501 marks too-close candidates for revision", () => {
  const existing = buildResearchCandidateGenomeV1(candidateIdea({
    research_candidate_id: "candidate-close",
    confirmation_signals: ["VWAP", "RSI", "DXY"],
  }));
  const plan = planResearchStrategyGenerationWorkflowV1(validInput({
    existing_genomes: [existing],
    duplicate_threshold: 0.99,
    too_close_threshold: 0.7,
  }));

  assert.equal(plan.decision, "NEEDS_REVISION");
});

test("TD2-501 produces explicit role work items with expected outputs", () => {
  const plan = planResearchStrategyGenerationWorkflowV1(validInput());
  const workItems = buildResearchStrategyGenerationWorkItemsV1(plan);
  const policy = buildResearchStrategyGenerationPolicyV1();

  assert.deepEqual(plan.policy.required_roles, policy.required_roles);
  assert.ok(workItems.some((item) => item.role_id === "strategy_builder" && item.expected_output.includes("candidate_dsl_draft")));
  assert.ok(workItems.every((item) => ["research", "validation"].includes(item.mission_policy.worker_pool_id)));
});

function validInput(overrides = {}) {
  return {
    idea: candidateIdea(),
    hypothesis: hypothesis(),
    actor_ref: "operator:research",
    idempotency_key: "idem-td2-501",
    ...overrides,
  };
}

function hypothesis() {
  return {
    research_experiment_id: "exp-501",
    research_hypothesis_id: "hyp-501",
    statement: "Breakout retest after compressed trend context improves MNQ continuation.",
    falsifiable_question: "Does the breakout retest beat baseline by at least 0.3R out of sample?",
    expected_outcome: "Higher validation score and lower drawdown than baseline.",
    invalidation_criteria: "Reject if out-of-sample expectancy is below baseline or drawdown increases.",
    dataset_scope: { instruments: ["MNQ"], sessions: ["ny_open"], split: "walk_forward" },
  };
}

function candidateIdea(overrides = {}) {
  return {
    research_candidate_id: "candidate-501",
    candidate_key: "mnq.breakout.retest.501",
    research_experiment_id: "exp-501",
    research_hypothesis_id: "hyp-501",
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
