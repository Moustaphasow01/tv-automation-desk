import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTheoreticalEntryIntent,
  evaluateTheoreticalTradeExit,
} from "../src/theoretical-execution-engine.js";
import { simulateGrainSignalTheoreticalOutcome } from "../src/us-grains-theoretical-replay.js";

test("grains causal replay matches the live theoretical engine for the same authorized plan and M1 candles", () => {
  const signal = grainSignal();
  const rows = [m1("10:00", { low: 99 }), m1("10:01", { high: 111, low: 99 })];
  const replay = simulateGrainSignalTheoreticalOutcome({ signal, executionRows: rows, asOfUtc: "2026-09-04T10:05:00.000Z", sessionCloseUtc: "2026-09-04T10:10:00.000Z" });
  const entry = evaluateTheoreticalEntryIntent({ intent: liveIntent(), decision: liveDecision(), contract: { instrument_code: "ZC" }, candle: rows[0], now: "2026-09-04T10:05:00.000Z" });
  const exit = evaluateTheoreticalTradeExit({ trade: liveTrade(entry), candle: rows[1] });

  assert.equal(entry.action, "fill_entry");
  assert.equal(exit.action, "fill_exit");
  assert.equal(replay.status, "TARGET_HIT");
  assert.equal(replay.filled_at_utc, entry.event_at_utc);
  assert.equal(replay.closed_at_utc, exit.event_at_utc);
  assert.equal(replay.entry_price, entry.price);
  assert.equal(replay.exit_price, exit.price);
  assert.equal(replay.r_result, 2);
});

test("grains causal replay preserves the live gap and slippage policy", () => {
  const policy = { gap_policy: "FILL_AT_OPEN_IF_THROUGH_PRICE", spread_points: 0.5, slippage_points: 0.25 };
  const signal = grainSignal();
  const rows = [m1("10:00", { open: 99, high: 101, low: 98 }), m1("10:01", { high: 111, low: 99 })];
  const replay = simulateGrainSignalTheoreticalOutcome({ signal, executionRows: rows, asOfUtc: "2026-09-04T10:05:00.000Z", sessionCloseUtc: "2026-09-04T10:10:00.000Z", policy });
  const live = evaluateTheoreticalEntryIntent({ intent: liveIntent(), decision: liveDecision(), contract: { instrument_code: "ZC" }, candle: rows[0], now: "2026-09-04T10:05:00.000Z", policy });

  assert.equal(live.action, "fill_entry");
  assert.equal(replay.entry_price, live.price);
  assert.equal(replay.entry_simulator_outcome.policy_snapshot.gap_policy, "FILL_AT_OPEN_IF_THROUGH_PRICE");
  assert.equal(replay.entry_simulator_outcome.policy_snapshot.slippage_points, 0.25);
});

test("grains causal replay keeps a same-bar stop and target as indeterminate", () => {
  const replay = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal(),
    executionRows: [m1("10:00", { low: 99 }), m1("10:01", { high: 111, low: 94 })],
    asOfUtc: "2026-09-04T10:05:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(replay.status, "UNKNOWN");
  assert.equal(replay.reason, "AMBIGUOUS_INTRABAR_STOP_AND_TARGET");
  assert.equal(replay.closed_at_utc, null);
  assert.equal(replay.r_result, null);
});

test("grains causal replay does not use an M1 candle that closed at or before the signal close", () => {
  const replay = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:01:00.000Z" }),
    executionRows: [m1("09:59", { low: 99 }), untouchedM1("10:00")],
    asOfUtc: "2026-09-04T10:02:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(replay.status, "EXPIRED_NO_FILL");
  assert.equal(replay.filled_at_utc, null);
  assert.equal(replay.reason, "ORDER_INTENT_EXPIRED");
});

test("grains causal replay expires only a complete untouched M1 entry window", () => {
  const complete = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:03:00.000Z" }),
    executionRows: [untouchedM1("10:00"), untouchedM1("10:01"), untouchedM1("10:02")],
    asOfUtc: "2026-09-04T10:04:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });
  const incomplete = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:03:00.000Z" }),
    executionRows: [untouchedM1("10:00"), untouchedM1("10:02")],
    asOfUtc: "2026-09-04T10:04:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(complete.status, "EXPIRED_NO_FILL");
  assert.equal(complete.r_result, null);
  assert.equal(incomplete.status, "UNKNOWN");
  assert.equal(incomplete.reason, "ENTRY_WINDOW_DATA_INCOMPLETE");
});

test("grains causal replay never forces an exit solely because entry expiry passed", () => {
  const replay = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:01:00.000Z" }),
    executionRows: [
      m1("10:00", { low: 99 }),
      m1("10:01", { high: 109, low: 96 }),
      m1("10:02", { high: 109, low: 96 }),
      m1("10:03", { high: 109, low: 96 }),
      m1("10:04", { high: 109, low: 96 }),
    ],
    asOfUtc: "2026-09-04T10:05:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(replay.status, "OPEN");
  assert.equal(replay.closed_at_utc, null);
  assert.equal(replay.r_result, null);
});

test("grains causal replay continues through a first miss to a later M1 fill", () => {
  const replay = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:03:00.000Z" }),
    executionRows: [untouchedM1("10:00"), m1("10:01", { low: 99 }), m1("10:02", { high: 111, low: 99 })],
    asOfUtc: "2026-09-04T10:04:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(replay.status, "TARGET_HIT");
  assert.equal(replay.filled_at_utc, "2026-09-04T10:01:00.000Z");
});

test("grains causal replay never fills the partly elapsed M1 containing a non-aligned signal", () => {
  const replay = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({
      generated_at_utc: "2026-09-04T10:00:30.000Z",
      expires_at_utc: "2026-09-04T10:02:00.000Z",
    }),
    executionRows: [m1("10:00", { low: 99 }), untouchedM1("10:01")],
    asOfUtc: "2026-09-04T10:03:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(replay.status, "EXPIRED_NO_FILL");
  assert.equal(replay.filled_at_utc, null);
});

test("grains causal replay treats malformed timing and OHLC as unknown rather than inventing a fill", () => {
  const malformedTiming = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "not-a-time" }),
    executionRows: [m1("10:00", { low: 99 })],
    asOfUtc: "2026-09-04T10:05:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });
  const malformedOhlc = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:01:00.000Z" }),
    executionRows: [m1("10:00", { open: "", high: 101, low: null, close: 100 })],
    asOfUtc: "2026-09-04T10:02:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });
  const impossibleGeometry = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:01:00.000Z" }),
    executionRows: [m1("10:00", { open: 100, high: 99, low: 101, close: 100 })],
    asOfUtc: "2026-09-04T10:02:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });
  const nonPositivePrice = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:01:00.000Z" }),
    executionRows: [m1("10:00", { open: 0, high: 101, low: 0, close: 100 })],
    asOfUtc: "2026-09-04T10:02:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(malformedTiming.status, "UNKNOWN");
  assert.equal(malformedTiming.reason, "THEORETICAL_REPLAY_INPUT_INVALID");
  assert.equal(malformedOhlc.status, "UNKNOWN");
  assert.equal(malformedOhlc.filled_at_utc, null);
  assert.equal(impossibleGeometry.status, "UNKNOWN");
  assert.equal(impossibleGeometry.filled_at_utc, null);
  assert.equal(nonPositivePrice.status, "UNKNOWN");
  assert.equal(nonPositivePrice.filled_at_utc, null);
});

test("grains causal replay stops at M1 gaps before a possible entry or exit", () => {
  const entryGap = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:03:00.000Z" }),
    executionRows: [untouchedM1("10:00"), m1("10:02", { low: 99 })],
    asOfUtc: "2026-09-04T10:04:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });
  const exitGap = simulateGrainSignalTheoreticalOutcome({
    signal: grainSignal({ expires_at_utc: "2026-09-04T10:03:00.000Z" }),
    executionRows: [m1("10:00", { low: 99 }), m1("10:02", { high: 111, low: 99 })],
    asOfUtc: "2026-09-04T10:04:00.000Z",
    sessionCloseUtc: "2026-09-04T10:10:00.000Z",
  });

  assert.equal(entryGap.status, "UNKNOWN");
  assert.equal(entryGap.reason, "ENTRY_WINDOW_DATA_INCOMPLETE");
  assert.equal(exitGap.status, "UNKNOWN");
  assert.equal(exitGap.reason, "EXIT_WINDOW_DATA_INCOMPLETE");
});

function grainSignal(overrides = {}) {
  return {
    signal_id: "signal-zc-1",
    instrument: "ZC",
    direction: "LONG",
    generated_at_utc: "2026-09-04T10:00:00.000Z",
    expires_at_utc: "2026-09-04T10:05:00.000Z",
    proposed_size: 1,
    proposed_trade_plan: {
      instrument: "ZC",
      direction: "LONG",
      order_type: "LIMIT",
      entry_price: 100,
      stop_price: 95,
      targets: [{ label: "TP1", price: 110 }],
    },
    ...overrides,
  };
}

function m1(minute, overrides = {}) {
  return {
    timestamp_utc: `2026-09-04T${minute}:00.000Z`,
    timeframe: "1",
    is_closed: true,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    ...overrides,
  };
}

function untouchedM1(minute) {
  return m1(minute, { open: 101, high: 102, low: 101, close: 101 });
}

function liveIntent() {
  return {
    order_intent_id: "signal-zc-1",
    side: "buy",
    order_type: "limit",
    quantity: 1,
    limit_price: 100,
    requested_at: "2026-09-04T10:00:00.000Z",
    expires_at: "2026-09-04T10:05:00.000Z",
    payload: { instrument: "ZC", entry_price: 100, limit_price: 100 },
  };
}

function liveDecision() {
  return { trade_decision_id: "signal-zc-1", instrument_code: "ZC", entry_plan: { entry_price: 100 } };
}

function liveTrade(entry) {
  return {
    trade_id: "signal-zc-1",
    side: "long",
    quantity_open: entry.quantity,
    current_stop_price: 95,
    current_target_price: 110,
  };
}
