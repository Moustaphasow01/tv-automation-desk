import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAnalyticalDecisionAllowed,
  validateAnalyticalDecision,
} from "../src/analytical-journey-api.js";
import {
  analyticalDecisionFixture,
  buildCompletedAnalyticalJourney,
} from "./support/analytical-journey-fixtures.js";

const VALIDATED_AT = "2026-08-02T11:00:00.000Z";

test("decision validator approves a fully receipted mandatory route", () => {
  const decision = analyticalDecisionFixture({ action: "ARM_CONDITIONAL_SETUP" });
  const journey = buildCompletedAnalyticalJourney({ decision });
  const validation = validateAnalyticalDecision({
    journey,
    decision,
    intent: "RISK_INCREASING",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(validation.structurally_valid, true);
  assert.equal(validation.decision_allowed, true);
  assert.equal(validation.status, "APPROVED");
  assert.equal(validation.violations.length, 0);
  assert.equal(validation.warnings.length, 0);
  assert.match(validation.validation_hash, /^[a-f0-9]{64}$/);
  assert.match(validation.validation_id, /^analytical_validation_/);
  assert.ok(validation.conclusion_receipt_id);
  assert.equal(Object.isFrozen(validation), true);
});

test("context unavailability degrades but does not veto a risk-increasing decision", () => {
  const decision = analyticalDecisionFixture({ action: "ARM_CONDITIONAL_SETUP" });
  const journey = buildCompletedAnalyticalJourney({
    decision,
    availabilityByPhase: {
      CROSS_ASSET: "UNAVAILABLE",
      NEWS: "DEGRADED",
    },
  });
  const validation = assertAnalyticalDecisionAllowed({
    journey,
    decision,
    intent: "RISK_INCREASING",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(validation.status, "APPROVED_DEGRADED");
  assert.equal(validation.decision_allowed, true);
  assert.ok(
    validation.warnings.some((warning) => (
      warning.code === "ANALYTICAL_DECISION_DEGRADED_CONTEXT"
      && warning.phases.includes("CROSS_ASSET")
      && warning.phases.includes("NEWS")
    )),
  );
});

test("hard evidence unavailability rejects risk increase but allows a no-risk decision", () => {
  const decision = analyticalDecisionFixture({ action: "WAIT" });
  const journey = buildCompletedAnalyticalJourney({
    decision,
    availabilityByPhase: {
      CORE_MARKET: "UNAVAILABLE",
    },
  });
  const rejected = validateAnalyticalDecision({
    journey,
    decision,
    intent: "RISK_INCREASING",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(rejected.decision_allowed, false);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.structurally_valid, true);
  assert.equal(rejected.policy_valid, false);
  assert.ok(
    rejected.violations.some((violation) => (
      violation.code === "ANALYTICAL_DECISION_HARD_EVIDENCE_UNAVAILABLE"
      && violation.phases.includes("CORE_MARKET")
    )),
  );
  assert.throws(
    () => assertAnalyticalDecisionAllowed({
      journey,
      decision,
      intent: "RISK_INCREASING",
      validatedAtUtc: VALIDATED_AT,
    }),
    (error) => error.code === "ANALYTICAL_DECISION_REJECTED",
  );

  const safe = validateAnalyticalDecision({
    journey,
    decision,
    intent: "NO_RISK_CHANGE",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(safe.decision_allowed, true);
  assert.equal(safe.status, "APPROVED_DEGRADED");
  assert.ok(
    safe.warnings.some((warning) => (
      warning.code === "ANALYTICAL_HARD_EVIDENCE_UNAVAILABLE_RISK_INCREASE_FORBIDDEN"
    )),
  );
});

test("a blocked phase vetoes risk increase while preserving defensive decisions", () => {
  const decision = analyticalDecisionFixture({ action: "PROTECT_POSITION" });
  const journey = buildCompletedAnalyticalJourney({
    decision,
    availabilityByPhase: {
      OPPORTUNITY: "BLOCKED",
    },
  });
  const riskIncrease = validateAnalyticalDecision({
    journey,
    decision,
    intent: "RISK_INCREASING",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(journey.status, "BLOCKED");
  assert.equal(riskIncrease.decision_allowed, false);
  assert.ok(
    riskIncrease.violations.some((violation) => (
      violation.code === "ANALYTICAL_DECISION_BLOCKED_PHASE"
      && violation.phases.includes("OPPORTUNITY")
    )),
  );

  const defensive = validateAnalyticalDecision({
    journey,
    decision,
    intent: "POSITION_MANAGEMENT",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(defensive.decision_allowed, true);
  assert.equal(defensive.status, "APPROVED_DEGRADED");
});

test("decision payload must exactly match the backend-hashed conclusion receipt", () => {
  const receiptedDecision = analyticalDecisionFixture({ action: "WAIT" });
  const journey = buildCompletedAnalyticalJourney({ decision: receiptedDecision });
  const substitutedDecision = {
    ...receiptedDecision,
    action: "ARM_CONDITIONAL_SETUP",
  };
  const validation = validateAnalyticalDecision({
    journey,
    decision: substitutedDecision,
    intent: "RISK_INCREASING",
    validatedAtUtc: VALIDATED_AT,
  });
  assert.equal(validation.decision_allowed, false);
  assert.ok(
    validation.violations.some((violation) => (
      violation.code === "ANALYTICAL_DECISION_RECEIPT_MISMATCH"
    )),
  );
});
