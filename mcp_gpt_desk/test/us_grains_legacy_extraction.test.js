import assert from "node:assert/strict";
import test from "node:test";

import { replayUsGrainsStrategyV1 } from "../src/us-grains-strategy-engine.js";

test("legacy grains extraction normalizes mapped rows and keeps a stable synthetic replay snapshot", () => {
  const input = legacySyntheticInput();
  const first = replayUsGrainsStrategyV1(input);
  const second = replayUsGrainsStrategyV1(structuredClone(input));

  assert.deepEqual(snapshot(first), snapshot(second));
  assert.deepEqual(snapshot(first), {
    schema_version: "us_grains_strategy_replay_result_v1",
    engine_version: "us_grains_strategy_engine_v1",
    instrument: "ZW",
    signal_count: 1,
    filled_trade_count: 1,
    skipped_day_issues: ["PRIOR_DAY_LEVELS_MISSING"],
    signals: [{
      direction: "LONG",
      generated_at_utc: "2026-09-02T15:10:00.000Z",
      expires_at_utc: "2026-09-02T15:55:00.000Z",
      order_type: "LIMIT",
      entry_price: 101,
      stop_price: 100,
      target_price: 102.5,
    }],
    trades: [{
      direction: "LONG",
      generated_at_utc: "2026-09-02T15:10:00.000Z",
      filled_at_utc: "2026-09-02T15:11:00.000Z",
      closed_at_utc: "2026-09-02T15:12:00.000Z",
      status: "TARGET_HIT",
      exit_reason: "TARGET_1_HIT",
      entry_price: 101,
      stop_loss: 100,
      target_price: 102.5,
      exit_price: 102.5,
      r_result: 1.5,
    }],
  });
});

test("legacy grains extraction returns the stable empty replay envelope", () => {
  const result = replayUsGrainsStrategyV1({
    rowsBySymbol: { "ZW1!:5": [], "ZW1!:1": [] },
  });

  assert.deepEqual(snapshot(result), {
    schema_version: "us_grains_strategy_replay_result_v1",
    engine_version: "us_grains_strategy_engine_v1",
    instrument: "ZW",
    signal_count: 0,
    filled_trade_count: 0,
    skipped_day_issues: [],
    signals: [],
    trades: [],
  });
});

function legacySyntheticInput() {
  return {
    rowsBySymbol: {
      "ZW1!:5": [
        ...fiveMinuteDay("2026-09-01T13:30:00.000Z", 58, 90),
        ...currentDecisionDay(),
      ],
      "ZW1!:1": [
        candle("2026-09-02T15:11:00.000Z", 101, 101.2, 100.8, 101),
        candle("2026-09-02T15:12:00.000Z", 101, 102.75, 101, 102.5),
      ],
    },
  };
}

function currentDecisionDay() {
  return Array.from({ length: 40 }, (_, index) => {
    const timestamp = plusMinutes("2026-09-02T13:30:00.000Z", index * 5);
    if (index < 6) return candle(timestamp, 100, 101, 99, 100);
    if (index === 19 || index === 20)
      return candle(timestamp, 101, 101.75, 100.8, 101.5);
    if (index === 18) return candle(timestamp, 100.5, 100.75, 100.2, 100.5);
    if (index > 20) return candle(timestamp, 101, 101.1, 100.9, 101);
    return candle(timestamp, 100.5, 100.75, 100.2, 100.5);
  });
}

function fiveMinuteDay(startUtc, count, price) {
  return Array.from({ length: count }, (_, index) =>
    candle(plusMinutes(startUtc, index * 5), price, price + 0.5, price - 0.5, price),
  );
}

function candle(time, open, high, low, close) {
  return {
    time,
    open: String(open),
    high: String(high),
    low: String(low),
    close: String(close),
    volume: "10",
  };
}

function plusMinutes(timestampUtc, minutes) {
  return new Date(Date.parse(timestampUtc) + minutes * 60_000).toISOString();
}

function snapshot(result) {
  return {
    schema_version: result.schema_version,
    engine_version: result.engine_version,
    instrument: result.instrument,
    signal_count: result.signal_count,
    filled_trade_count: result.filled_trade_count,
    skipped_day_issues: result.skipped_days.flatMap((day) => day.issues),
    signals: result.signals.map((signal) => ({
      direction: signal.direction,
      generated_at_utc: signal.generated_at_utc,
      expires_at_utc: signal.expires_at_utc,
      order_type: signal.proposed_trade_plan.order_type,
      entry_price: signal.proposed_trade_plan.entry_price ?? signal.proposed_trade_plan.entry?.calculation_price ?? signal.proposed_trade_plan.entry?.price,
      stop_price: signal.proposed_trade_plan.stop_price ?? signal.proposed_trade_plan.stop?.price,
      target_price: signal.proposed_trade_plan.targets[0].price,
    })),
    trades: result.trades.map((trade) => ({
      direction: trade.direction,
      generated_at_utc: trade.generated_at_utc,
      filled_at_utc: trade.filled_at_utc,
      closed_at_utc: trade.closed_at_utc,
      status: trade.status,
      exit_reason: trade.exit_reason,
      entry_price: trade.entry_price,
      stop_loss: trade.stop_loss,
      target_price: trade.target_price,
      exit_price: trade.exit_price,
      r_result: trade.r_result,
    })),
  };
}
