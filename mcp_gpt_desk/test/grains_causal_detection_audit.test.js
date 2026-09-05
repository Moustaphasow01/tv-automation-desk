import test from "node:test";
import assert from "node:assert/strict";
import { auditCausalDetection, candlesToRowsBySymbol, compareSignals } from "../src/grains-causal-detection-audit.js";

const candle = (timestamp_utc, close = 1) => ({ feed_id: "prod__tradingview__ZC1!__5", timestamp_utc, open: close, high: close, low: close, close, volume: 1 });
const signal = (at, direction = "LONG") => ({ signal_id: `s-${at}`, instrument: "ZC", direction, generated_at_utc: at, source_data_cutoff_utc: at, expires_at_utc: "2026-09-04T17:00:00.000Z", setup: { family: "VWAP_PULLBACK" }, proposed_trade_plan: { plan_hash: "p1" }, signal_quality: { strategy_suite_version: "us_grains_strategy_suite_causal_v2", context_gate: { recommendation: "TAKE" } } });

test("converts feed ids and checks causal prefix invariance", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const source = { asOf: at, candles: [candle("2026-09-04T14:55:00.000Z"), candle("2026-09-04T15:55:00.000Z", 9)], signals: [signal(at)] };
  const detect = (input) => ({ suite_version: "fixture", raw_signals: input.rowsBySymbol["ZC1!:5"].some((row) => row.timestamp_utc === "2026-09-04T14:55:00.000Z") ? [signal(at)] : [] });
  const report = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.equal(candlesToRowsBySymbol(source.candles)["ZC1!:5"].length, 2);
  assert.equal(report.invariance.changed_count, 0);
  assert.equal(report.legacy_comparison.matched_count, 1);
});

test("reports changed prefix and signal fingerprint differences", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const source = { candles: [candle("2026-09-04T14:55:00.000Z")], signals: [signal(at)] };
  const detect = (input) => ({ raw_signals: input.asOfUtc === at ? [signal(at, "SHORT")] : [signal(at)] });
  const report = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.equal(report.invariance.changed_count, 1);
  assert.equal(report.invariance.counterexamples[0].reason, "SIGNAL_CHANGED_AT_PREFIX");
});

test("compares missing and added signals without trade or gate proxies", () => {
  const old = [signal("2026-09-04T15:00:00.000Z")];
  const added = signal("2026-09-04T15:05:00.000Z");
  const result = compareSignals(old, [added]);
  assert.equal(result.matched_count, 0);
  assert.equal(result.missing_legacy_count, 1);
  assert.equal(result.new_causal_count, 1);
});

test("keeps same-bar families and directions distinct using source bar open", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const oldA = signal(at, "LONG");
  const oldB = { ...signal(at, "SHORT"), setup: { family: "OPENING_RANGE_BREAKOUT_RETEST" } };
  const result = compareSignals([oldA, oldB], [oldA]);
  assert.equal(result.matched_count, 1);
  assert.equal(result.missing_legacy_count, 1);
  assert.match(result.missing_legacy_examples[0], /OPENING_RANGE_BREAKOUT_RETEST/);
  assert.match(result.missing_legacy_examples[0], /2026-09-04T14:55:00.000Z/);
});

test("future OHLC changes do not enter a closed prefix", () => {
  const cutoff = "2026-09-04T15:00:00.000Z";
  const future = "2026-09-04T15:05:00.000Z";
  const source = { candles: [candle("2026-09-04T14:55:00.000Z"), candle(future, 2)], signals: [signal(cutoff)] };
  const detect = (input) => ({ raw_signals: input.rowsBySymbol["ZC1!:5"].some((row) => row.timestamp_utc === "2026-09-04T14:55:00.000Z") ? [signal(cutoff)] : [] });
  const first = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  const altered = { ...source, candles: [source.candles[0], { ...source.candles[1], close: 999 }] };
  const second = auditCausalDetection({ source: altered, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.deepEqual(second.invariance, first.invariance);
});

test("audit detects a prefix signal entirely suppressed by future data in the full batch", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const source = { candles: [candle("2026-09-04T14:55Z"), candle("2026-09-04T15:55Z")] };
  const detect = (input) => ({ raw_signals: input.rowsBySymbol["ZC1!:5"].length === 1 ? [signal(at)] : [] });
  const report = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.equal(report.detector.raw_signal_count, 0);
  assert.equal(report.invariance.checked, 2);
  assert.ok(report.invariance.changed_count > 0);
  assert.ok(report.invariance.unexpected_prefix_count > 0);
});

test("audit compares both directions on the same family and source bar without first-match collisions", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const source = { candles: [candle("2026-09-04T14:55Z")] };
  const detect = () => ({ raw_signals: [signal(at), signal(at, "SHORT")] });
  const report = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.equal(report.invariance.changed_count, 0);
  assert.equal(report.invariance.unexpected_prefix_count, 0);
});

test("audit perturbs future prices and catches a detector that ignores its clock", () => {
  const at = "2026-09-04T15:00:00.000Z";
  const source = { candles: [candle("2026-09-04T14:55Z"), candle("2026-09-04T15:55Z")] };
  const detect = (input) => ({ raw_signals: [signal(at, input.rowsBySymbol["ZC1!:5"].at(-1).close > 100 ? "SHORT" : "LONG")] });
  const report = auditCausalDetection({ source, detect, startDate: "2026-09-04", endDate: "2026-09-04" });
  assert.ok(report.invariance.counterexamples.some((item) => item.reason === "FUTURE_PRICE_PERTURBATION_CHANGED_SIGNAL"));
});

test("legacy ledger unwraps the real signal.emitted envelope before matching family and source-open", () => {
  const old = signal("2026-09-04T14:55:00.000Z");
  old.signal_quality.strategy_suite_version = "us_grains_strategy_suite_v1";
  const row = { signal_id: old.signal_id, instrument: "ZC", direction: "LONG", generated_at_utc: old.generated_at_utc,
    proposed_trade_plan: old.proposed_trade_plan, payload: { type: "signal.emitted", payload: old } };
  const current = signal("2026-09-04T15:00:00.000Z");
  const result = compareSignals([row], [current]);
  assert.equal(result.matched_count, 1);
  assert.equal(result.missing_legacy_count, 0);
});
