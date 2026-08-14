import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTFOLIO_EXECUTION_RECONCILIATION_SCHEMA_VERSION_V1,
  TARGET_POSITION_SCHEMA_VERSION_V1,
  buildPortfolioOrderIntentPlanV1,
  evaluatePortfolioExecutionReconciliationV1,
} from "../index.js";

describe("portfolio execution reconciliation V1", () => {
  it("passes a clean restart because the existing intent prevents a duplicate order", () => {
    const first = buildPortfolioOrderIntentPlanV1({ target_positions: [target({ net_target_size: 1, delta_size: 1 })], default_protection_plan: protection() });
    const resumed = buildPortfolioOrderIntentPlanV1({ target_positions: [target({ net_target_size: 1, delta_size: 1 })], default_protection_plan: protection(), existing_order_intents: first.order_intents });
    const reconciliation = evaluatePortfolioExecutionReconciliationV1({ order_intents: first.order_intents, target_positions: [target({ net_target_size: 1 })], broker_positions: [{ account_id: "paper-sim101", instrument: "MNQ", signed_size: 0 }] });

    assert.equal(resumed.order_intents.length, 0);
    assert.equal(resumed.skipped_targets[0].reason, "DUPLICATE_INTENT_EXISTS");
    assert.equal(reconciliation.schema_version, PORTFOLIO_EXECUTION_RECONCILIATION_SCHEMA_VERSION_V1);
    assert.equal(reconciliation.status, "PASS");
    assert.deepEqual(reconciliation.duplicate_issues, []);
  });

  it("detects concurrent active intents sharing the same idempotency key", () => {
    const order_intents = [
      intent({ order_intent_id: "intent-a", idempotency_key: "same-key" }),
      intent({ order_intent_id: "intent-b", idempotency_key: "same-key" }),
    ];
    const result = evaluatePortfolioExecutionReconciliationV1({ order_intents, target_positions: [target({ net_target_size: 2 })] });

    assert.equal(result.status, "CONTROLLED_DIVERGENCE");
    assert.equal(result.duplicate_issues[0].code, "DUPLICATE_IDEMPOTENCY_KEY");
    assert.ok(result.controls.some((item) => item.code === "HALT_BROKER_SUBMIT"));
  });

  it("tracks partial fills and keeps the remaining quantity auditable", () => {
    const order_intents = [intent({ quantity: 3, action: "BUY" })];
    const result = evaluatePortfolioExecutionReconciliationV1({
      order_intents,
      broker_fills: [{ order_intent_id: "intent-a", quantity: 1, price: 28000 }],
      target_positions: [target({ net_target_size: 3 })],
      broker_positions: [{ account_id: "paper-sim101", instrument: "MNQ", signed_size: 1 }],
    });

    assert.equal(result.status, "FILL_INCOMPLETE");
    assert.equal(result.intent_audits[0].status, "PARTIALLY_FILLED");
    assert.equal(result.intent_audits[0].remaining_quantity, 2);
    assert.equal(result.intent_audits[0].outstanding_signed_delta, 2);
    assert.ok(result.controls.some((item) => item.code === "WAIT_FOR_FILLS"));
  });

  it("moves to controlled divergence when broker state cannot reach the target", () => {
    const result = evaluatePortfolioExecutionReconciliationV1({
      target_positions: [target({ net_target_size: 2 })],
      broker_positions: [{ account_id: "paper-sim101", instrument: "MNQ", signed_size: 1 }],
    });

    assert.equal(result.status, "CONTROLLED_DIVERGENCE");
    assert.equal(result.divergences[0].code, "BROKER_DESK_POSITION_DIVERGENCE");
    assert.equal(result.divergences[0].broker_net_size, 1);
    assert.equal(result.divergences[0].expected_target_size, 2);
    assert.ok(result.controls.some((item) => item.code === "OPERATOR_REVIEW"));
  });

  it("produces a stable reconciliation hash for audit", () => {
    const input = { as_of_utc: "2026-08-10T08:00:00.000Z", order_intents: [intent({ quantity: 1 })], target_positions: [target({ net_target_size: 1 })] };
    assert.equal(evaluatePortfolioExecutionReconciliationV1(input).reconciliation_hash, evaluatePortfolioExecutionReconciliationV1(input).reconciliation_hash);
  });
});

function target(overrides = {}) {
  const value = {
    schema_version: TARGET_POSITION_SCHEMA_VERSION_V1,
    id: "target-a",
    account_id: "paper-sim101",
    instrument: "MNQ",
    net_target_size: 1,
    current_net_size: 0,
    delta_size: 1,
    risk_approved_net_size: 1,
    derived_from_risk_decision_ids: ["risk-a"],
    candidate_allocation_ids: ["alloc-a"],
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "risk_approved_net_size")) value.risk_approved_net_size = value.net_target_size;
  return value;
}

function intent(overrides = {}) {
  return { order_intent_id: "intent-a", account_id: "paper-sim101", instrument: "MNQ", action: "BUY", quantity: 1, status: "READY", idempotency_key: "intent-key", ...overrides };
}

function protection() {
  return { stop_price: 27900, target_price: 28100 };
}
