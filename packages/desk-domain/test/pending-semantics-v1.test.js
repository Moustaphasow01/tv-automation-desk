import { it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDeterministicConditionSetV1,
  evaluateOpportunitySeekingControlledV1,
} from "../index.js";

it("keeps future PENDING/NOT_STARTED distinct from missing canonical M1 data", () => {
  const setup = {
    instrument: "MNQ",
    direction: "long",
    entry_price: 100,
    stop_loss: 98,
    take_profit_1: 104,
    risk_pct: 0.25,
    valid_from_paris: "2026-06-11T09:05:00+02:00",
    expires_at_paris: "2026-06-11T12:00:00+02:00",
  };
  const conditions = [{
    condition_id: "future_activation",
    predicate_type: "PRICE_RELATION",
    role: "ACTIVATION",
    effect: "REQUIRE_TRUE",
    instrument: "MNQ",
    timeframe: "M1",
    operator: "CLOSE_ABOVE",
    threshold: 101,
    importance: "MANDATORY",
    required_for_trigger: true,
  }];
  const rows = [{
    instrument: "MNQ",
    timeframe: "M1",
    timestamp_paris: "2026-06-11T09:01:00+02:00",
    high: 101,
    low: 99,
    close: 100,
    closed: true,
  }];
  const evaluation = evaluateDeterministicConditionSetV1({
    setup,
    conditions,
    rows,
    nowParis: "2026-06-11T09:01:30+02:00",
  });
  assert.equal(evaluation.required_not_started, 1);
  assert.equal(evaluation.required_unknown, 0);

  const policy = evaluateOpportunitySeekingControlledV1({
    setup,
    conditionEvaluation: evaluation,
    phase: "ENTRY_TRIGGER",
    nowParis: null,
  });
  assert.equal(policy.eligible, true);
  assert.equal(policy.trigger_eligible, false);
  assert.equal(policy.structural_conditions_ready, false);
  assert.equal(
    policy.hard_failures.some((entry) => entry.code === "CANONICAL_TRIGGER_DATA_MISSING"),
    false,
  );
  assert.equal(
    policy.hard_failures.some((entry) => entry.code === "MANDATORY_INDICATOR_MISSING"),
    false,
  );
});
