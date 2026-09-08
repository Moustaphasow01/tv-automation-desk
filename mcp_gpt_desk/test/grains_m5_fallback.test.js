import assert from "node:assert/strict";
import test from "node:test";
import { GRAINS_DATA_POLICIES as POLICY } from "@tv-automation/desk-domain";
import { evaluateUsGrainsDataQuality } from "../src/us-grains-data-quality.js";
import { detectUsGrainsStrategySignals } from "../src/us-grains-strategy-suite.js";
import { evaluateCausalGrainContextAtBus } from "../src/grains-causal-context-prefilter.js";
import { MarketContextPrefilterService } from "../src/market-context-prefilter-service.js";
import { grainStrategyIdentity } from "../src/us-grains-strategy-catalog.js";
import { grainsDataPolicyFromEnvironment } from "../src/runtime-config.js";
import { grainSignal } from "./support/causal-grain-signal-fixture.js";
import { grainsCalendarFixture } from "./support/grains-calendar-fixture.js";

const NOW = "2026-09-04T15:00:00.000Z";
function bars({ start = "2026-09-04T13:30Z", count = 18, step = 5 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp_utc: new Date(Date.parse(start) + index * step * 60_000).toISOString(),
    open: 500 + index * .5, high: 501 + index * .5, low: 499 + index * .5, close: 500.5 + index * .5, volume: 10,
  }));
}
function quality(input = {}) {
  return evaluateUsGrainsDataQuality({ instrument: "ZW", asOfUtc: NOW, m5Rows: bars(), dataPolicy: POLICY.M5_FALLBACK, ...input });
}
function fallbackSignal() {
  const signal = grainSignal({ ...grainStrategyIdentity("VWAP_PULLBACK", "ZW"), direction: "LONG" });
  signal.setup.context.data_quality = quality();
  return signal;
}

test("M5 fallback is explicitly enabled; absent M1 remains visible and strict still blocks", () => {
  assert.equal(grainsDataPolicyFromEnvironment({}), POLICY.STRICT);
  assert.equal(grainsDataPolicyFromEnvironment({ DESK_US_GRAINS_M5_FALLBACK_ENABLED: "true" }), POLICY.M5_FALLBACK);
  const result = quality();
  assert.equal(result.tradeable, true);
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.timeframes.M1.status, "BLOCKED");
  assert.equal(result.timeframes.M1.row_count, 0);
  assert.equal(result.timeframes.M5.row_count, 18);
  assert.ok(result.issues.includes("M1_ROW_COUNT_BLOCKING"));
  assert.deepEqual(result.blocking_issues, []);
  assert.equal(quality({ dataPolicy: POLICY.STRICT }).tradeable, false);
});

test("frozen, sparse and zero-volume M1 cannot stop valid M5; recovery is automatic", () => {
  for (const m1Rows of [bars({ count: 1, step: 1 }), bars({ count: 80, step: 1 }),
    bars({ count: 90, step: 1 }).map((row) => ({ ...row, volume: 0 }))]) {
    assert.equal(quality({ m1Rows }).data_mode, "M5_FALLBACK");
  }
  const recovered = quality({ m1Rows: bars({ count: 90, step: 1 }) });
  assert.equal(recovered.data_mode, "M1_M5");
  assert.equal(recovered.status, "TRADEABLE");
});

test("M5 absence, staleness, duplicates, wrong day, gaps and zero volume remain blocking", () => {
  for (const m5Rows of [[], bars({ count: 15 }), [...bars(), bars()[0]],
    bars({ start: "2026-09-03T13:30Z" }), bars().filter((_, i) => i < 4 || i > 6),
    bars().map((row) => ({ ...row, volume: 0 }))]) {
    const result = quality({ m5Rows });
    assert.equal(result.tradeable, false, JSON.stringify(result));
    assert.equal(result.data_mode, "BLOCKED");
    assert.ok(result.blocking_issues.every((code) => code.startsWith("M5_")));
  }
  assert.equal(quality({ asOfUtc: null }).tradeable, false);
  assert.equal(quality({ instrument: "MES" }).tradeable, false);
});

test("bus admits qualified M5 SHADOW without mutating raw evidence and blocks rollback", async () => {
  const signal = fallbackSignal();
  const before = structuredClone(signal);
  assert.equal(evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW, dataPolicy: POLICY.M5_FALLBACK }).admissible, true);
  assert.deepEqual(evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW }).reasonCodes, ["GRAIN_M5_FALLBACK_DISABLED"]);
  assert.deepEqual(signal, before);
  const service = new MarketContextPrefilterService({ dataPolicy: POLICY.M5_FALLBACK });
  assert.equal((await service.evaluate([signal], NOW))[0].admissible, true);
  const strict = new MarketContextPrefilterService();
  assert.equal((await strict.evaluate([signal], NOW))[0].admissible, false);
});

test("fallback preserves identity, calendar, timing and M5 evidence gates", () => {
  const mutations = [
    (s) => { s.execution_mode_origin = "LIVE"; },
    (s) => { s.timeframe = "M1"; },
    (s) => { s.setup.setup_kind = "UNKNOWN_M1_STRATEGY"; },
    (s) => { s.strategy_instance_id = "other"; },
    (s) => { s.expires_at_utc = NOW; },
    (s) => { s.source_data_cutoff_utc = "2026-09-04T15:05Z"; },
    (s) => { delete s.setup.context.macro_event_risk.coverage; },
    (s) => { s.setup.context.macro_event_risk.events = [{ event_timestamp_utc: NOW, source_published_at_utc: "2026-09-01T12:00Z" }]; },
    (s) => { s.setup.context.data_quality.timeframes.M5.status = "BLOCKED"; },
    (s) => { s.setup.context.data_quality.as_of_utc = "2026-09-04T14:55Z"; },
  ];
  for (const mutate of mutations) {
    const signal = fallbackSignal(); mutate(signal);
    assert.equal(evaluateCausalGrainContextAtBus({ signal, nowUtc: NOW, dataPolicy: POLICY.M5_FALLBACK }).admissible, false);
  }
});

test("same causal M5 candidates and IDs survive missing M1, with no future data leakage", () => {
  const input = { instruments: ["ZW"], startDate: "2026-09-04", endDate: "2026-09-04", asOfUtc: NOW,
    agriCalendarCoverage: [grainsCalendarFixture()], rowsBySymbol: {
      "ZW1!:1": [], "ZW1!:5": [...bars({ start: "2026-09-03T13:30Z", count: 58 }).map((row) => ({ ...row, open: 499, close: 499.5, high: 500, low: 498 })), ...bars()],
    } };
  const strict = detectUsGrainsStrategySignals(input);
  const fallback = detectUsGrainsStrategySignals({ ...input, dataPolicy: POLICY.M5_FALLBACK });
  assert.ok(fallback.raw_signals.length > 0);
  assert.deepEqual(fallback.raw_signals.map((s) => s.signal_id), strict.raw_signals.map((s) => s.signal_id));
  assert.ok(strict.raw_signals.every((s) => s.setup.context.data_quality.tradeable === false));
  assert.ok(fallback.raw_signals.every((s) => s.setup.context.data_quality.tradeable === true));
  assert.ok(fallback.raw_signals.some((signal) => evaluateCausalGrainContextAtBus({ signal,
    nowUtc: signal.generated_at_utc, dataPolicy: POLICY.M5_FALLBACK }).admissible));
  const future = detectUsGrainsStrategySignals({ ...input, dataPolicy: POLICY.M5_FALLBACK, rowsBySymbol: {
    ...input.rowsBySymbol, "ZW1!:1": bars({ start: "2026-09-04T17:00Z", count: 20, step: 1 }),
  } });
  assert.deepEqual(future.raw_signals, fallback.raw_signals);
});
