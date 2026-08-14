import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateLifecyclePolicyV1,
  transitionResearchCandidateLifecycleV1,
  validateResearchCandidateLifecycleSnapshotV1,
} from "../index.js";

const candidateId = "33333333-3333-4333-8333-333333333333";
const experimentId = "11111111-1111-4111-8111-111111111111";
const hypothesisId = "22222222-2222-4222-8222-222222222222";
const strategyVersionId = "44444444-4444-4444-8444-444444444444";

test("TD2-510 exposes the research candidate lifecycle policy", () => {
  const policy = buildResearchCandidateLifecyclePolicyV1();

  assert.equal(policy.statuses.length, 7);
  assert.equal(policy.transitions.IDEA.START_BASELINE, "BASELINE_REQUIRED");
  assert.equal(policy.transitions.UNDER_REVIEW.MARK_PROMOTION_READY, "PROMOTION_READY");
  assert.equal(policy.invariants.terminal_candidates_are_immutable, true);
  assert.match(policy.lifecycle_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-510 runs the nominal lifecycle with audited evidence", () => {
  let current = candidate({ status: "IDEA" });
  const baseline = transitionResearchCandidateLifecycleV1(current, command("START_BASELINE", ["hypothesis_protocol:accepted"]));
  current = { ...current, ...baseline.candidate_patch };
  const simulation = transitionResearchCandidateLifecycleV1(current, command("SUBMIT_TO_SIMULATION", ["baseline_run:BASELINE_RUN:001"]));
  current = { ...current, ...simulation.candidate_patch };
  const review = transitionResearchCandidateLifecycleV1(current, command("REQUEST_REVIEW", ["research_evaluation_report:VALIDATION_REPORT:001"]));
  current = { ...current, ...review.candidate_patch, strategy_version_id: strategyVersionId };
  const promote = transitionResearchCandidateLifecycleV1(current, command("MARK_PROMOTION_READY", [
    "research_evaluation_report:VALIDATION_REPORT:001",
    "research_evaluation_report:ROBUSTNESS_REPORT:001",
    "research_review:CONTRADICTORY_REVIEW:001",
    "research_decision:DECISION_AUDIT:001",
  ], { strategy_version_id: strategyVersionId, process_decision: "PROMOTE_TO_REVIEW" }));

  assert.equal(baseline.ok, true);
  assert.equal(simulation.to_status, "IN_SIMULATION");
  assert.equal(review.to_status, "UNDER_REVIEW");
  assert.equal(promote.ok, true);
  assert.equal(promote.candidate_patch.status, "PROMOTION_READY");
  assert.equal(promote.event.accepted, true);
});

test("TD2-510 blocks invalid transitions before any patch is produced", () => {
  const result = transitionResearchCandidateLifecycleV1(
    candidate({ status: "IDEA" }),
    command("MARK_PROMOTION_READY", ["research_decision:DECISION_AUDIT:001"], { strategy_version_id: strategyVersionId }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.candidate_patch, null);
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_TRANSITION_NOT_ALLOWED"));
});

test("TD2-510 prevents promotion from bypassing scientific gates", () => {
  const result = transitionResearchCandidateLifecycleV1(
    candidate({ status: "UNDER_REVIEW", strategy_version_id: strategyVersionId }),
    command("MARK_PROMOTION_READY", ["research_evaluation_report:VALIDATION_REPORT:001"], {
      process_decision: "WAIT_FOR_EVIDENCE",
      strategy_version_id: strategyVersionId,
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_ROBUSTNESS_REPORT_REQUIRED"));
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_CONTRADICTORY_REVIEW_REQUIRED"));
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_DECISION_AUDIT_REQUIRED"));
  assert.ok(result.reasons.includes("RESEARCH_CANDIDATE_PROMOTION_REQUIRES_PROCESS_READY"));
});

test("TD2-510 requires negative-result retention and keeps terminal candidates immutable", () => {
  const missingNegative = transitionResearchCandidateLifecycleV1(
    candidate({ status: "IN_SIMULATION" }),
    command("REJECT", ["research_evaluation_report:VALIDATION_REPORT:fail"]),
  );
  const rejected = transitionResearchCandidateLifecycleV1(
    candidate({ status: "IN_SIMULATION" }),
    command("REJECT", ["research_evaluation_report:VALIDATION_REPORT:fail"], {
      negative_result_ref: "research_negative_result:fail:001",
    }),
  );
  const terminalRetry = transitionResearchCandidateLifecycleV1(
    { ...candidate({ status: "REJECTED" }), ...rejected.candidate_patch },
    command("START_BASELINE", ["operator:retry"]),
  );

  assert.equal(missingNegative.ok, false);
  assert.ok(missingNegative.reasons.includes("RESEARCH_CANDIDATE_NEGATIVE_RESULT_REQUIRED"));
  assert.equal(rejected.ok, true);
  assert.equal(rejected.candidate_patch.promotion_blocked, true);
  assert.equal(terminalRetry.ok, false);
  assert.ok(terminalRetry.reasons.includes("RESEARCH_CANDIDATE_TERMINAL_IMMUTABLE"));
});

test("TD2-510 validates lifecycle snapshots for promotion-ready and rejected candidates", () => {
  const invalidPromotion = validateResearchCandidateLifecycleSnapshotV1(candidate({ status: "PROMOTION_READY" }));
  const validPromotion = validateResearchCandidateLifecycleSnapshotV1(candidate({
    status: "PROMOTION_READY",
    strategy_version_id: strategyVersionId,
    lifecycle_evidence: {
      evidence_refs: [
        "VALIDATION_REPORT:001",
        "ROBUSTNESS_REPORT:001",
        "CONTRADICTORY_REVIEW:001",
        "DECISION_AUDIT:001",
      ],
    },
  }));
  const rejected = validateResearchCandidateLifecycleSnapshotV1(candidate({
    status: "REJECTED",
    lifecycle_evidence: { negative_result_ref: "research_negative_result:001" },
  }));

  assert.equal(invalidPromotion.ok, false);
  assert.ok(invalidPromotion.reasons.includes("RESEARCH_CANDIDATE_PROMOTION_STRATEGY_VERSION_REQUIRED"));
  assert.equal(validPromotion.ok, true);
  assert.equal(rejected.ok, true);
});

function command(name, evidenceRefs, overrides = {}) {
  return {
    command: name,
    actor_ref: "research_reviewer",
    idempotency_key: `idem-${name}-${evidenceRefs.join("-")}`,
    evidence_refs: evidenceRefs,
    transitioned_at_utc: "2026-08-09T12:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: candidateId,
    research_experiment_id: experimentId,
    research_hypothesis_id: hypothesisId,
    candidate_key: "mnq.breakout.retest.v1",
    source_type: "AI_GENERATED",
    status: "IDEA",
    primary_change_summary: "Test a deterministic breakout retest candidate.",
    metadata: {},
    created_at_utc: "2026-08-09T08:00:00.000Z",
    ...overrides,
  };
}
