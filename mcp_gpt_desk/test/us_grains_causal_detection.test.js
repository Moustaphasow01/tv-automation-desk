import assert from "node:assert/strict";
import test from "node:test";

import {
  detectUsGrainsStrategySignals,
  replayUsGrainsStrategySuiteV1,
} from "../src/us-grains-strategy-suite.js";
import { evaluateUsGrainsDataQuality } from "../src/us-grains-data-quality.js";

function row(timestamp, open, close = open + 0.25) {
  return {
    timestamp_utc: timestamp,
    open,
    high: Math.max(open, close) + 0.25,
    low: Math.min(open, close) - 0.25,
    close,
    volume: 10,
  };
}

function m5Day(startUtc, prices) {
  return prices.map((price, index) =>
    row(
      new Date(Date.parse(startUtc) + index * 300000).toISOString(),
      price,
      price + 0.5,
    ),
  );
}

function causalInput(extra = {}) {
  const prior = m5Day(
    "2026-07-06T13:30:00.000Z",
    Array.from({ length: 58 }, () => 99),
  );
  const current = m5Day(
    "2026-07-07T13:30:00.000Z",
    Array.from({ length: 20 }, (_, index) => 100 + index * 0.5),
  );
  return {
    instruments: ["ZW"],
    rowsBySymbol: { "ZW1!:5": [...prior, ...current], "ZW1!:1": [] },
    ...extra,
  };
}

test("causal detector timestamps M5 signals at close and remains invariant to later rows", () => {
  const input = causalInput();
  const first = detectUsGrainsStrategySignals(input);
  assert.ok(first.raw_signals.length > 0);
  const cutoff = "2026-07-07T15:05:00.000Z";
  const baseline = detectUsGrainsStrategySignals({ ...input, asOfUtc: cutoff });
  const later = row("2026-07-07T17:00:00.000Z", 500, 501);
  const changed = detectUsGrainsStrategySignals({
    ...input,
    asOfUtc: cutoff,
    rowsBySymbol: {
      ...input.rowsBySymbol,
      "ZW1!:5": [...input.rowsBySymbol["ZW1!:5"], later],
    },
  });
  assert.deepEqual(changed.raw_signals, baseline.raw_signals);
  for (const signal of first.raw_signals) {
    assert.equal(signal.generated_at_utc, signal.source_data_cutoff_utc);
    assert.equal(
      Date.parse(signal.generated_at_utc) -
        Date.parse(signal.evidence[0].bar_open_utc),
      300000,
    );
    assert.ok(
      Date.parse(signal.expires_at_utc) <=
        Date.parse("2026-07-07T18:20:00.000Z"),
    );
    assert.equal(signal.signal_quality.causal_detection_version, "v2");
  }
});

test("calendar entries require explicit prior knowledge and blackout is post-detection", () => {
  const input = causalInput();
  const unknown = {
    event_timestamp_utc: "2026-07-07T15:00:00.000Z",
    importance: "HIGH",
  };
  const knownLate = {
    ...unknown,
    source_published_at_utc: "2026-07-07T16:00:00.000Z",
  };
  assert.deepEqual(
    detectUsGrainsStrategySignals({ ...input, agriEvents: [unknown] })
      .raw_signals,
    detectUsGrainsStrategySignals({ ...input, agriEvents: [knownLate] })
      .raw_signals,
  );
  const replay = replayUsGrainsStrategySuiteV1(input);
  assert.equal(replay.simulation_status, "NOT_RUN");
  assert.equal(replay.total_r, null);
  assert.deepEqual(replay.trades, []);
});

test("quality counts only bars closed at the 13:20 Chicago cutoff", () => {
  const m1 = Array.from({ length: 291 }, (_, index) =>
    row(
      new Date(
        Date.parse("2026-07-07T13:30:00.000Z") + index * 60000,
      ).toISOString(),
      100,
    ),
  );
  const m5 = Array.from({ length: 59 }, (_, index) =>
    row(
      new Date(
        Date.parse("2026-07-07T13:30:00.000Z") + index * 300000,
      ).toISOString(),
      100,
    ),
  );
  const quality = evaluateUsGrainsDataQuality({
    asOfUtc: "2026-07-07T18:20:00.000Z",
    m1Rows: m1,
    m5Rows: m5,
  });
  assert.equal(quality.timeframes.M1.expected_row_count, 290);
  assert.equal(quality.timeframes.M1.row_count, 290);
  assert.equal(quality.timeframes.M5.expected_row_count, 58);
  assert.equal(quality.timeframes.M5.row_count, 58);
});

test("quality excludes incomplete OHLC and the 13:20 M5 open after the session", () => {
  const valid = row("2026-07-07T18:15:00.000Z", 100);
  const sessionOverrun = row("2026-07-07T18:20:00.000Z", 101);
  const invalid = {
    ...valid,
    timestamp_utc: "2026-07-07T18:10:00.000Z",
    high: null,
  };
  const quality = evaluateUsGrainsDataQuality({
    asOfUtc: "2026-07-07T18:30:00.000Z",
    m5Rows: [valid, sessionOverrun, invalid],
  });
  assert.equal(quality.timeframes.M5.row_count, 1);
});
