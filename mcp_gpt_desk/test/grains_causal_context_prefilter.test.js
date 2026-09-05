import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCausalGrainContextAtBus } from "../src/grains-causal-context-prefilter.js";
import { US_GRAINS_STRATEGY_SUITE_VERSION } from "../src/us-grains-strategy-suite.js";

const NOW = "2026-09-04T15:00:00.000Z";

test("causal grains context is adjudicated at the bus without mutating the raw signal", () => {
  const signal = rawSignal();
  const before = structuredClone(signal);
  const result = evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW });
  assert.equal(result.decision, "ADMISSIBLE");
  assert.equal(result.contextGate.recommendation, "TAKE");
  assert.equal(result.marketContextSnapshotId, null);
  assert.deepEqual(signal, before);
  assert.equal(signal.signal_quality.context_gate, undefined);
  assert.equal(evaluateCausalGrainContextAtBus({ signal: { ...signal, direction: "SHORT" }, nowUtc: NOW }).decision, "REJECT");
});

test("causal grains context rejects temporal, quality and multiplier contract defects", () => {
  for (const [edit, reason] of [
    [(signal) => { signal.source_data_cutoff_utc = "2026-09-04T15:05Z"; }, "GRAIN_CONTEXT_AFTER_DECISION_TIME"],
    [(signal) => { signal.expires_at_utc = NOW; }, "GRAIN_CONTEXT_SIGNAL_EXPIRED"],
    [(signal) => { signal.setup.context.source_data_cutoff_utc = "2026-09-04T14:55Z"; }, "GRAIN_CONTEXT_CUTOFF_MISMATCH"],
    [(signal) => { signal.setup.context.data_quality = { tradeable: false }; }, "GRAIN_CONTEXT_SOURCE_DATA_BLOCKED"],
    [(signal) => { delete signal.setup.context.data_quality; }, "GRAIN_CONTEXT_SOURCE_DATA_BLOCKED"],
    [(signal) => { signal.setup.context.valid_until_utc = NOW; }, "GRAIN_CONTEXT_EXPIRED_OR_UNAVAILABLE"],
    [(signal) => { signal.setup.context.instrument = "ZC"; }, "GRAIN_CONTEXT_IDENTITY_MISMATCH"],
    [(signal) => { delete signal.setup.context.macro_event_risk; }, "GRAIN_CONTEXT_CALENDAR_UNAVAILABLE"],
    [(signal) => { signal.setup.context.macro_event_risk.events = [{}]; }, "GRAIN_CONTEXT_CALENDAR_INVALID"],
    [(signal) => { signal.setup.context.risk_multiplier = 5; }, "GRAIN_CONTEXT_RISK_MULTIPLIER_INVALID"],
  ]) {
    const signal = rawSignal();
    edit(signal);
    const result = evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW });
    assert.equal(result.decision, "WAIT");
    assert.deepEqual(result.reasonCodes, [reason]);
  }
});

test("known upcoming agri event waits without preventing raw publication", () => {
  const signal = rawSignal();
  signal.setup.context.macro_event_risk.events = [{ event_timestamp_utc: "2026-09-04T15:15Z", source_published_at_utc: "2026-09-01T12:00Z" }];
  const result = evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW });
  assert.equal(result.decision, "WAIT");
  assert.ok(result.reasonCodes.includes("AGRI_REPORT_BLACKOUT"));
});

function rawSignal() {
  return {
    signal_id: "fixture", instrument: "ZW", direction: "LONG", confidence: 0.73,
    generated_at_utc: NOW, source_data_cutoff_utc: NOW, expires_at_utc: "2026-09-04T15:45Z",
    signal_quality: { strategy_suite_version: US_GRAINS_STRATEGY_SUITE_VERSION },
    setup: { setup_kind: "VWAP_PULLBACK", context: {
      schema_version: "us_grains_market_context_v2", instrument: "ZW", valid_until_utc: "2026-09-04T15:45Z", data_quality: { tradeable: true },
      source_data_cutoff_utc: NOW, instrument_bias: "LONG_BIASED", allowed_sides: ["LONG"],
      preferred_strategy_families: ["VWAP_PULLBACK"], discouraged_strategy_families: [],
      macro_event_risk: { events: [] }, risk_multiplier: 0.85,
    } },
  };
}
