import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTFOLIO_TARGET_POSITION_PLAN_SCHEMA_VERSION_V1,
  TARGET_POSITION_SCHEMA_VERSION_V1,
  buildPortfolioTargetPositionPlanV1,
} from "../index.js";

describe("portfolio target position V1", () => {
  it("creates a deterministic target position from an approved allocation", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      account_id: "paper-sim101",
      candidate_allocations: [allocation({ id: "alloc-1", net_direction: "LONG", proposed_size: 2 })],
      risk_budget_evaluation: evaluation([{ candidate_allocation_id: "alloc-1", approved_size: 2, status: "PASS", risk_decision_id: "risk-1" }]),
      current_positions: [position({ signed_size: 1 })],
    });

    assert.equal(plan.schema_version, PORTFOLIO_TARGET_POSITION_PLAN_SCHEMA_VERSION_V1);
    assert.equal(plan.status, "TARGETS_READY");
    assert.equal(plan.target_positions.length, 1);
    assert.equal(plan.target_positions[0].schema_version, TARGET_POSITION_SCHEMA_VERSION_V1);
    assert.equal(plan.target_positions[0].net_target_size, 2);
    assert.equal(plan.target_positions[0].current_net_size, 1);
    assert.equal(plan.target_positions[0].delta_size, 1);
    assert.deepEqual(plan.target_positions[0].derived_from_risk_decision_ids, ["risk-1"]);
  });

  it("nets opposite approved allocations into one account instrument target", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      account_id: "paper-sim101",
      candidate_allocations: [
        allocation({ id: "alloc-long", net_direction: "LONG", proposed_size: 2, contributing_signals: [{ signal_id: "sig-a", strategy_instance_id: "inst-a", proposed_size: 2 }] }),
        allocation({ id: "alloc-short", net_direction: "SHORT", proposed_size: 1, contributing_signals: [{ signal_id: "sig-b", strategy_instance_id: "inst-b", proposed_size: 1 }] }),
      ],
      risk_budget_evaluation: evaluation([
        { candidate_allocation_id: "alloc-long", approved_size: 2, status: "PASS", risk_decision_id: "risk-long" },
        { candidate_allocation_id: "alloc-short", approved_size: 1, status: "PASS", risk_decision_id: "risk-short" },
      ]),
    });

    assert.equal(plan.target_positions.length, 1);
    assert.equal(plan.target_positions[0].net_target_size, 1);
    assert.equal(plan.target_positions[0].net_direction, "LONG");
    assert.deepEqual(plan.target_positions[0].candidate_allocation_ids, ["alloc-long", "alloc-short"]);
    assert.equal(plan.target_positions[0].strategy_breakdown.length, 2);
  });

  it("keeps strategy breakdown signed by each signal and selects a trade plan matching the net direction", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      account_id: "paper-sim101",
      candidate_allocations: [allocation({
        id: "alloc-net-long",
        net_direction: "LONG",
        net_size: 1,
        proposed_size: 1,
        contributing_signals: [
          {
            signal_id: "sig-short-first",
            strategy_instance_id: "inst-short",
            direction: "SHORT",
            proposed_size: 2,
            proposed_trade_plan: tradePlan({ direction: "SHORT", entry: 100, stop: 110, target: 80 }),
          },
          {
            signal_id: "sig-long-second",
            strategy_instance_id: "inst-long",
            direction: "LONG",
            proposed_size: 3,
            proposed_trade_plan: tradePlan({ direction: "LONG", entry: 100, stop: 90, target: 120 }),
          },
        ],
      })],
      risk_budget_evaluation: evaluation([{ candidate_allocation_id: "alloc-net-long", approved_size: 1, status: "PASS", risk_decision_id: "risk-net-long" }]),
    });

    const target = plan.target_positions[0];
    assert.equal(target.net_direction, "LONG");
    assert.equal(target.approved_trade_plan.side, "LONG");
    assert.equal(target.approved_trade_plan.source_signal_id, "sig-long-second");
    assert.equal(target.approved_trade_plan.stop.price, 90);
    assert.equal(target.approved_trade_plan.targets[0].price, 120);
    assert.equal(target.strategy_breakdown.find((item) => item.strategy_instance_id === "inst-short").signed_size, -2);
    assert.equal(target.strategy_breakdown.find((item) => item.strategy_instance_id === "inst-long").signed_size, 3);
  });

  it("uses reduced risk size instead of requested allocation size", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      candidate_allocations: [allocation({ id: "alloc-1", net_direction: "LONG", proposed_size: 2 })],
      risk_budget_evaluation: evaluation([{ candidate_allocation_id: "alloc-1", approved_size: 1, status: "REDUCE", risk_decision_id: "risk-reduce" }]),
    });

    assert.equal(plan.target_positions[0].net_target_size, 1);
    assert.equal(plan.target_positions[0].risk_approved_net_size, 1);
    assert.equal(plan.target_positions[0].status, "TARGETED");
  });

  it("converts blocked or neutralized allocations into auditable flat targets", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      candidate_allocations: [
        allocation({ id: "alloc-block", net_direction: "LONG", proposed_size: 2 }),
        allocation({ id: "alloc-flat", net_direction: "FLAT", proposed_size: 0, status: "NEUTRALIZED" }),
      ],
      risk_budget_evaluation: evaluation([{ candidate_allocation_id: "alloc-block", approved_size: 0, status: "BLOCK", risk_decision_id: "risk-block" }]),
    });

    assert.equal(plan.target_positions.length, 1);
    assert.equal(plan.target_positions[0].net_target_size, 0);
    assert.equal(plan.target_positions[0].status, "FLAT");
  });

  it("separates identical instruments across accounts without collision", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      account_id: "paper-sim101",
      candidate_allocations: [
        allocation({ id: "alloc-a", account_id: "paper-sim101", instrument: "MNQ", proposed_size: 1 }),
        allocation({ id: "alloc-b", account_id: "paper-sim102", instrument: "MNQ", proposed_size: 1 }),
      ],
      risk_budget_evaluation: evaluation([
        { candidate_allocation_id: "alloc-a", approved_size: 1, status: "PASS", risk_decision_id: "risk-a" },
        { candidate_allocation_id: "alloc-b", approved_size: 1, status: "PASS", risk_decision_id: "risk-b" },
      ]),
    });

    assert.equal(plan.target_positions.length, 2);
    assert.deepEqual(plan.target_positions.map((item) => item.account_id).sort(), ["paper-sim101", "paper-sim102"]);
    assert.ok(plan.target_positions.every((item) => item.net_target_size === 1));
    assert.match(plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed when an exposure allocation has no Global Risk decision", () => {
    const plan = buildPortfolioTargetPositionPlanV1({
      as_of_utc: "2026-08-09T08:20:00.000Z",
      account_id: "paper-sim101",
      candidate_allocations: [allocation({ id: "alloc-without-risk", net_direction: "LONG", proposed_size: 2 })],
      risk_budget_evaluation: { status: "CONFIG_MISSING", allocation_evaluations: [] },
    });

    assert.equal(plan.status, "NO_TARGETS");
    assert.equal(plan.target_positions.length, 0);
    assert.deepEqual(plan.skipped_allocations, [{ candidate_allocation_id: "alloc-without-risk", reason: "GLOBAL_RISK_UNAVAILABLE" }]);
  });
});

function allocation(overrides = {}) {
  return {
    id: "alloc-1",
    account_id: "paper-sim101",
    instrument: "MNQ",
    net_direction: "LONG",
    proposed_size: 1,
    contributing_signals: [{ signal_id: "sig-a", strategy_instance_id: "inst-a", proposed_size: 1 }],
    ...overrides,
  };
}

function evaluation(rows) {
  return {
    status: "PASS",
    evaluation_hash: "sha256:risk-evaluation-test",
    rule_set_version: "test-risk-rules-v1",
    allocation_evaluations: rows,
  };
}

function position(overrides = {}) {
  return {
    account_id: "paper-sim101",
    instrument: "MNQ",
    signed_size: 0,
    ...overrides,
  };
}

function tradePlan({ direction = "LONG", entry = 100, stop = 90, target = 120 } = {}) {
  return {
    availability: "KNOWN",
    direction,
    order_type: "MARKET",
    entry: { availability: "KNOWN", price: entry },
    stop: { availability: "KNOWN", price: stop },
    targets: [{ label: "T1", availability: "KNOWN", price: target }],
    time_in_force: "DAY",
  };
}
