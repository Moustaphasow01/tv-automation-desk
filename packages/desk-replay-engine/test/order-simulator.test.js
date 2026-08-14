import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_SIMULATOR_VERSION_V1,
  applyOrderReplacementsV1,
  simulateEntryOrderV1,
  simulateExitOrderV1,
} from "../index.js";

describe("order simulator V1", () => {
  it("fills market orders with deterministic spread, slippage and commission", () => {
    const outcome = simulateEntryOrderV1({
      setup: entrySetup({ order_type: "MARKET", quantity: 2 }),
      row: candle({ open: 100, high: 101, low: 99 }),
      policy: { pricing: { spread_points: 0.5, slippage_points: 0.25, commission_r_per_contract: 0.01 } },
    });

    assert.equal(outcome.simulator_version, ORDER_SIMULATOR_VERSION_V1);
    assert.equal(outcome.status, "FILLED");
    assert.equal(outcome.fill.raw_price, 100);
    assert.equal(outcome.fill.price, 100.5);
    assert.equal(outcome.fill.commission_r, 0.02);
  });

  it("fills buy limits at the open when a gap crosses the limit and can partial fill", () => {
    const outcome = simulateEntryOrderV1({
      setup: entrySetup({ order_type: "LIMIT", quantity: 3, order_limit_price: 100 }),
      row: candle({ open: 99.5, high: 100.25, low: 99 }),
      policy: { gap_policy: "FILL_AT_OPEN_IF_THROUGH_PRICE", partial_fill: { enabled: true, fill_ratio: 0.5, minimum_quantity: 1 } },
    });

    assert.equal(outcome.status, "PARTIALLY_FILLED");
    assert.equal(outcome.fill.raw_price, 99.5);
    assert.equal(outcome.fill.quantity, 1);
    assert.equal(outcome.fill.requested_quantity, 3);
  });

  it("activates stop-limit orders before requiring the limit to trade", () => {
    const waiting = simulateEntryOrderV1({
      setup: entrySetup({ order_type: "STOP_LIMIT", stop_trigger_price: 101, stop_limit_price: 100.75 }),
      row: candle({ open: 100, high: 101.5, low: 100.9 }),
    });
    const filled = simulateEntryOrderV1({
      setup: entrySetup({ order_type: "STOP_LIMIT", stop_trigger_price: 101, stop_limit_price: 100.75 }),
      row: candle({ open: 100, high: 101.5, low: 100.5 }),
    });

    assert.equal(waiting.status, "PENDING");
    assert.equal(waiting.reason, "STOP_LIMIT_ACTIVATED_NOT_FILLED");
    assert.equal(filled.status, "FILLED");
    assert.equal(filled.fill.raw_price, 100.75);
  });

  it("makes intrabar stop/target ambiguity explicit and configurable", () => {
    const review = simulateExitOrderV1({ position: position(), row: candle({ open: 100, high: 111, low: 94 }) });
    const conservative = simulateExitOrderV1({ position: position(), row: candle({ open: 100, high: 111, low: 94 }), policy: { ambiguous_intrabar_policy: "CONSERVATIVE_STOP" } });
    const favorable = simulateExitOrderV1({ position: position(), row: candle({ open: 100, high: 111, low: 94 }), policy: { ambiguous_intrabar_policy: "FAVORABLE_TARGET" } });

    assert.equal(review.review_required, true);
    assert.equal(review.reason, "AMBIGUOUS_INTRABAR_STOP_AND_TARGET");
    assert.equal(conservative.status, "FILLED");
    assert.equal(conservative.reason, "STOP_LOSS");
    assert.equal(favorable.status, "FILLED");
    assert.equal(favorable.reason, "TAKE_PROFIT_1");
  });

  it("supports deterministic cancel and replace before fill evaluation", () => {
    const order = { order_type: "LIMIT", limit_price: 100, status: "WORKING" };
    const replaced = applyOrderReplacementsV1(order, [{ at_paris: "2026-06-11T10:05:00+02:00", limit_price: 98 }], candle({ time: "2026-06-11T10:06:00+02:00" }));
    const cancelled = simulateEntryOrderV1({
      setup: entrySetup({ order_type: "LIMIT", order_limit_price: 100, order_replacements: [{ at_paris: "2026-06-11T10:05:00+02:00", action: "CANCEL", reason: "operator_cancel" }] }),
      row: candle({ time: "2026-06-11T10:06:00+02:00", open: 100, high: 101, low: 99 }),
    });

    assert.equal(replaced.limit_price, 98);
    assert.equal(cancelled.status, "PENDING");
    assert.equal(cancelled.reason, "operator_cancel");
  });
});

function entrySetup(overrides = {}) {
  return {
    setup_id: "setup_mnq_long",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    order_limit_price: 100,
    quantity: 1,
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    position_id: "pos_mnq_long",
    setup_id: "setup_mnq_long",
    instrument: "MNQ",
    direction: "long",
    quantity: 1,
    entry_price: 100,
    stop_loss: 95,
    take_profit_1: 110,
    risk_points: 5,
    ...overrides,
  };
}

function candle({ time = "2026-06-11T10:06:00+02:00", open = 100, high = 101, low = 99, close = open } = {}) {
  return { time, open, high, low, close, closed: true };
}
