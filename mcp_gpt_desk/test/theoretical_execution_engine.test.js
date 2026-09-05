import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTheoreticalEntryIntent,
  evaluateTheoreticalTradeExit,
} from "../src/theoretical-execution-engine.js";

test("theoretical execution keeps a limit order working until price touches the limit", () => {
  const notTouched = evaluateTheoreticalEntryIntent({
    intent: entryIntent({ order_type: "limit", limit_price: 100, side: "buy" }),
    decision: decision(),
    contract: contract(),
    candle: candle({ low: 100.25 }),
  });

  assert.equal(notTouched.action, "none");
  assert.equal(notTouched.reason, "LIMIT_NOT_TOUCHED");
  assert.equal(notTouched.status, "WORKING");

  const touched = evaluateTheoreticalEntryIntent({
    intent: entryIntent({ order_type: "limit", limit_price: 100, side: "buy" }),
    decision: decision(),
    contract: contract(),
    candle: candle({ low: 99.75 }),
  });

  assert.equal(touched.action, "fill_entry");
  assert.equal(touched.price, 100);
  assert.equal(touched.quantity, 1);
});

test("theoretical execution fills market entries immediately on the next closed candle only for market orders", () => {
  const result = evaluateTheoreticalEntryIntent({
    intent: entryIntent({ order_type: "market", side: "buy", limit_price: null }),
    decision: decision({ entry_plan: { order_type: "market", entry_price: 100 } }),
    contract: contract(),
    candle: candle({ open: 101, low: 99.75 }),
  });

  assert.equal(result.action, "fill_entry");
  assert.equal(result.reason, "MARKET");
  assert.equal(result.price, 101);
});

test("theoretical execution preserves distinct legacy and canonical OrderIntent identities", () => {
  const legacy = evaluateTheoreticalEntryIntent({
    intent: entryIntent({ order_intent_id: "legacy_order_intent_1" }),
    decision: decision(),
    contract: contract(),
    candle: candle({ low: 99.75 }),
  });
  const canonical = evaluateTheoreticalEntryIntent({
    intent: entryIntent({
      order_intent_id: "portfolio_order_intent_1",
      portfolio_order_intent_id: "portfolio_order_intent_1",
    }),
    decision: decision(),
    contract: contract(),
    candle: candle({ low: 99.75 }),
  });

  assert.equal(legacy.order_intent_id, "legacy_order_intent_1");
  assert.equal(legacy.portfolio_order_intent_id, null);
  assert.equal(canonical.order_intent_id, "portfolio_order_intent_1");
  assert.equal(canonical.portfolio_order_intent_id, "portfolio_order_intent_1");
});

test("theoretical execution expires an entry instead of auto-filling after TTL", () => {
  const result = evaluateTheoreticalEntryIntent({
    intent: entryIntent({ expires_at: "2026-08-12T10:01:00.000Z" }),
    decision: decision(),
    contract: contract(),
    candle: { ...candle({ time: "2026-08-12T10:02:00.000Z", low: 99 }), theoretical_window_complete: true },
  });

  assert.equal(result.action, "expire_entry");
  assert.equal(result.reason, "ORDER_INTENT_EXPIRED");
});

test("elapsed wall clock without entry-window evidence does not fabricate expiration", () => {
  const result = evaluateTheoreticalEntryIntent({ intent: entryIntent(), candle: null, now: "2026-08-12T12:00:00Z" });
  assert.equal(result.action, "none");
  assert.equal(result.reason, "ENTRY_WINDOW_DATA_INCOMPLETE");
});

test("a complete untouched entry window expires even when the last bar opens before TTL", () => {
  const result = evaluateTheoreticalEntryIntent({ intent: entryIntent(), now: "2026-08-12T12:00:00Z",
    candle: { ...candle({ time: "2026-08-12T10:59:00Z", low: 101 }), theoretical_window_complete: true } });
  assert.equal(result.action, "expire_entry");
  assert.equal(result.event_at_utc, "2026-08-12T11:00:00.000Z");
});

test("theoretical execution follows open trades and marks intrabar stop/target ambiguity as review", () => {
  const ambiguous = evaluateTheoreticalTradeExit({
    trade: openTrade({ side: "long", current_stop_price: 95, current_target_price: 110 }),
    candle: candle({ high: 111, low: 94 }),
  });

  assert.equal(ambiguous.action, "review_exit");
  assert.equal(ambiguous.reason, "AMBIGUOUS_INTRABAR_STOP_AND_TARGET");

  const target = evaluateTheoreticalTradeExit({
    trade: openTrade({ side: "long", current_stop_price: 95, current_target_price: 110 }),
    candle: candle({ high: 111, low: 99 }),
  });

  assert.equal(target.action, "fill_exit");
  assert.equal(target.exit_reason, "target");
  assert.equal(target.price, 110);
});

function entryIntent(overrides = {}) {
  return {
    order_intent_id: "order_intent_1",
    trade_decision_id: "trade_decision_1",
    side: "buy",
    order_type: "limit",
    quantity: 1,
    limit_price: 100,
    stop_price: null,
    requested_at: "2026-08-12T10:00:00.000Z",
    expires_at: "2026-08-12T11:00:00.000Z",
    bracket: { stop_price: 95, target_price: 110 },
    payload: { instrument: "MNQ" },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    trade_decision_id: "trade_decision_1",
    instrument_code: "MNQ",
    side: "long",
    entry_plan: { order_type: "limit", entry_price: 100, limit_price: 100 },
    risk_plan: { stop_price: 95, target_price: 110 },
    ...overrides,
  };
}

function contract(overrides = {}) {
  return {
    broker_contract_id: "nt:mnq",
    instrument_code: "MNQ",
    broker_symbol: "MNQ 09-26",
    ...overrides,
  };
}

function openTrade(overrides = {}) {
  return {
    trade_id: "trade_1",
    side: "long",
    quantity_open: 1,
    current_stop_price: 95,
    current_target_price: 110,
    ...overrides,
  };
}

function candle({ time = "2026-08-12T10:05:00.000Z", open = 100, high = 101, low = 99, close = 100 } = {}) {
  return {
    feed_id: "feed_mnq_1",
    symbol_code: "MNQ",
    timeframe: "1",
    timestamp_utc: time,
    open,
    high,
    low,
    close,
  };
}
