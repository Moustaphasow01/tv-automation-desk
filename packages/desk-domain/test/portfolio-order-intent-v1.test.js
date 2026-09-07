import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_INTENT_SCHEMA_VERSION_V1,
  PORTFOLIO_ORDER_INTENT_PLAN_SCHEMA_VERSION_V1,
  TARGET_POSITION_SCHEMA_VERSION_V1,
  buildPortfolioOrderIntentPlanV1,
} from "../index.js";

describe("portfolio order intent V1", () => {
  it("creates a deterministic provider-neutral order intent from a target position", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      as_of_utc: "2026-08-09T08:30:00.000Z",
      target_positions: [target({ net_target_size: 2, current_net_size: 0, delta_size: 2 })],
      default_protection_plan: protection(),
      provider_contracts: { MNQ: { provider_contract_id: "cme:mnq", provider_symbol: "MNQ SEP26" } },
    });

    assert.equal(plan.schema_version, PORTFOLIO_ORDER_INTENT_PLAN_SCHEMA_VERSION_V1);
    assert.equal(plan.status, "ORDER_INTENTS_READY");
    assert.equal(plan.order_intents.length, 1);
    assert.equal(plan.order_intents[0].schema_version, ORDER_INTENT_SCHEMA_VERSION_V1);
    assert.equal(plan.order_intents[0].action, "BUY");
    assert.equal(plan.order_intents[0].quantity, 2);
    assert.equal(plan.order_intents[0].lifecycle_action, "OPEN");
    assert.equal(plan.order_intents[0].status, "READY");
    assert.equal(plan.order_intents[0].audit.direct_llm_order, false);
    assert.equal(plan.order_intents[0].provider_contract_ref.provider_symbol, "MNQ SEP26");
    assert.match(plan.order_intents[0].idempotency_key, /^[a-f0-9]{64}$/);
  });

  it("creates a reduce intent when target is smaller than current exposure", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ net_target_size: 1, current_net_size: 3, delta_size: -2 })],
      default_protection_plan: protection(),
    });

    const intent = plan.order_intents[0];
    assert.equal(intent.action, "SELL");
    assert.equal(intent.quantity, 2);
    assert.equal(intent.lifecycle_action, "REDUCE");
    assert.equal(intent.closing_size, 2);
    assert.equal(intent.opening_size, 0);
  });

  it("creates a reverse intent when the target crosses through flat", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ net_target_size: -2, current_net_size: 1, delta_size: -3 })],
      default_protection_plan: protection(),
    });

    const intent = plan.order_intents[0];
    assert.equal(intent.action, "SELL");
    assert.equal(intent.quantity, 3);
    assert.equal(intent.lifecycle_action, "REVERSE");
    assert.equal(intent.closing_size, 1);
    assert.equal(intent.opening_size, 2);
  });

  it("does not recreate an already active identical order intent", () => {
    const first = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ id: "target-a", net_target_size: 1, current_net_size: 0, delta_size: 1 })],
      default_protection_plan: protection(),
    });
    const second = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ id: "target-a", net_target_size: 1, current_net_size: 0, delta_size: 1 })],
      default_protection_plan: protection(),
      existing_order_intents: first.order_intents,
    });

    assert.equal(second.order_intents.length, 0);
    assert.equal(second.skipped_targets[0].reason, "DUPLICATE_INTENT_EXISTS");
    assert.equal(second.skipped_targets[0].idempotency_key, first.order_intents[0].idempotency_key);
  });

  it("creates a cancel replace request when an active intent conflicts with the new target", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ id: "target-new", net_target_size: 2, current_net_size: 0, delta_size: 2 })],
      default_protection_plan: protection(),
      existing_order_intents: [{ order_intent_id: "old-intent", account_id: "paper-sim101", instrument: "MNQ", status: "queued", idempotency_key: "old" }],
    });

    assert.equal(plan.status, "CANCEL_REPLACE_READY");
    assert.equal(plan.cancel_replace_requests.length, 1);
    assert.equal(plan.cancel_replace_requests[0].stale_order_intent_id, "old-intent");
    assert.equal(plan.cancel_replace_requests[0].replacement_order_intent_id, plan.order_intents[0].order_intent_id);
    assert.equal(plan.order_intents[0].replaces_order_intent_id, "old-intent");
    assert.equal(plan.order_intents[0].lifecycle_action, "CANCEL_REPLACE");
  });

  it("requires broker protections before submission is allowed", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ net_target_size: 1, current_net_size: 0, delta_size: 1 })],
      execution_policy: { submission_enabled: true },
    });

    assert.equal(plan.order_intents[0].status, "PROTECTION_REQUIRED");
    assert.equal(plan.order_intents[0].broker_submission_allowed, false);
    assert.deepEqual(plan.order_intents[0].protection.missing, ["STOP_PRICE_REQUIRED", "TARGET_PRICE_REQUIRED"]);
  });

  it("does not let a global broker account override a different target account", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [
        target({ id: "target-sim101", account_id: "paper-sim101", net_target_size: 1 }),
        target({ id: "target-sim102", account_id: "paper-sim102", net_target_size: 1 }),
      ],
      execution_policy: {
        broker_account_id: "paper-sim101",
        broker_account_ids: { "paper-sim102": "broker-sim102" },
        submission_enabled: true,
      },
      default_protection_plan: protection(),
    });

    const byTarget = new Map(plan.order_intents.map((intent) => [intent.target_position_id, intent]));
    assert.equal(byTarget.get("target-sim101").broker_account_id, "paper-sim101");
    assert.equal(byTarget.get("target-sim102").broker_account_id, "broker-sim102");
  });

  it("falls back to the target account when no safe broker account mapping exists", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ id: "target-sim102", account_id: "paper-sim102", net_target_size: 1 })],
      execution_policy: { broker_account_id: "paper-sim101", submission_enabled: true },
      default_protection_plan: protection(),
    });

    assert.equal(plan.order_intents[0].account_id, "paper-sim102");
    assert.equal(plan.order_intents[0].broker_account_id, "paper-sim102");
  });

  it("fails closed when target position lacks Portfolio/Risk lineage", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [{
        id: "manual-target",
        account_id: "paper-sim101",
        instrument: "MNQ",
        net_target_size: 1,
        current_net_size: 0,
        delta_size: 1,
      }],
      default_protection_plan: protection(),
    });

    assert.equal(plan.order_intents.length, 0);
    assert.equal(plan.skipped_targets[0].reason, "TARGET_POSITION_SCHEMA_REQUIRED");
    assert.ok(plan.skipped_targets[0].authority_issues.includes("PORTFOLIO_ARBITRATION_LINEAGE_REQUIRED"));
    assert.ok(plan.skipped_targets[0].authority_issues.includes("GLOBAL_RISK_DECISION_REQUIRED"));
  });

  it("detects mutation after Global Risk approved a different target size", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({ net_target_size: 3, risk_approved_net_size: 2, delta_size: 3 })],
      default_protection_plan: protection(),
    });

    assert.equal(plan.order_intents.length, 0);
    assert.equal(plan.skipped_targets[0].reason, "RISK_APPROVED_TARGET_MUTATED");
  });

  it("refuses a LONG target carrying a SHORT approved trade plan before READY", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({
        net_direction: "LONG",
        net_target_size: 2,
        delta_size: 2,
        approved_trade_plan: approvedTradePlan("SHORT"),
      })],
    });

    assert.equal(plan.order_intents.length, 0);
    assert.equal(plan.status, "NO_ORDER_INTENTS");
    assert.equal(plan.skipped_targets[0].reason, "APPROVED_TRADE_PLAN_DIRECTION_MISMATCH");
  });

  it("does not treat boolean prices as decimal zero", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({
        net_direction: "LONG",
        approved_trade_plan: { ...approvedTradePlan("LONG"), stop: { price: false }, targets: [{ price: false }] },
      })],
    });

    assert.equal(plan.order_intents[0].status, "PROTECTION_REQUIRED");
    assert.deepEqual(plan.order_intents[0].protection.missing, ["STOP_PRICE_REQUIRED", "TARGET_PRICE_REQUIRED"]);
    assert.equal(plan.order_intents[0].protection.stop_price, null);
    assert.equal(plan.order_intents[0].protection.target_price, null);
  });

  it("preserves FLAT target semantics without creating an OrderIntent", () => {
    const plan = buildPortfolioOrderIntentPlanV1({
      target_positions: [target({
        net_direction: "FLAT",
        net_target_size: 0,
        current_net_size: 0,
        delta_size: 0,
        risk_approved_net_size: 0,
        approved_trade_plan: approvedTradePlan("SHORT"),
      })],
    });

    assert.equal(plan.order_intents.length, 0);
    assert.equal(plan.skipped_targets[0].reason, "NO_DELTA");
  });
});

function target(overrides = {}) {
  const value = {
    schema_version: TARGET_POSITION_SCHEMA_VERSION_V1,
    id: "targetpos-a",
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

function protection(overrides = {}) {
  return {
    stop_price: 27900,
    target_price: 28100,
    max_slippage_ticks: 4,
    ...overrides,
  };
}

function approvedTradePlan(side) {
  return {
    availability: "KNOWN",
    side,
    entry: { availability: "KNOWN", price: 28000 },
    stop: { availability: "KNOWN", price: side === "LONG" ? 27900 : 28100 },
    targets: [{ availability: "KNOWN", price: side === "LONG" ? 28100 : 27900 }],
    economics: { direction: side },
  };
}
