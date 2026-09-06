import assert from "node:assert/strict";
import test from "node:test";
import { detectCalendarVersionedGrainsSignals } from "../src/grains-calendar-detection.js";
import { detectUsGrainsStrategySignals } from "../src/us-grains-strategy-suite.js";
import { grainsCalendarFixture } from "./support/grains-calendar-fixture.js";

test("later calendar versions cannot replace an earlier signal context", async () => {
  const input = fixture();
  const boundary = "2026-07-07T15:10:00.000Z";
  const calendar = { agriEvents: [], agriCalendarCoverage: [grainsCalendarFixture()] };
  const baseline = detectUsGrainsStrategySignals({ ...input, ...calendar }).raw_signals;
  assert.ok(baseline.some((signal) => signal.source_data_cutoff_utc < boundary));
  assert.ok(baseline.some((signal) => signal.source_data_cutoff_utc >= boundary));
  const changed = await detectCalendarVersionedGrainsSignals({ detectionInput: input,
    calendarKnownTimes: [boundary, "2026-08-01T00:00Z"],
    readCalendarAt: async (cutoff) => cutoff < boundary ? calendar : {
      agriEvents: [], agriCalendarCoverage: [grainsCalendarFixture({ asOf: boundary, status: "UNKNOWN_COVERAGE" })],
    } });
  assert.deepEqual(changed.raw_signals.filter((signal) => signal.source_data_cutoff_utc < boundary),
    baseline.filter((signal) => signal.source_data_cutoff_utc < boundary));
  assert.deepEqual(changed.raw_signals.map((signal) => signal.signal_id).sort(), baseline.map((signal) => signal.signal_id).sort());
  assert.equal(changed.calendar_intervals.length, 2);
  assert.ok(changed.raw_signals.filter((signal) => signal.source_data_cutoff_utc >= boundary)
    .every((signal) => signal.setup.context.macro_event_risk.coverage.admissible === false));
});

function fixture() {
  const prior = bars("2026-07-06T13:30Z", 58, 5, 99, 0);
  const current = bars("2026-07-07T13:30Z", 58, 5, 100, 0.5);
  return { instruments: ["ZW"], startDate: "2026-07-07", endDate: "2026-07-07", asOfUtc: "2026-07-07T19:00:00Z",
    rowsBySymbol: { "ZW1!:5": [...prior, ...current], "ZC1!:5": [...prior, ...current],
      "ZW1!:1": bars("2026-07-07T13:30Z", 290, 1, 100, 0.1) } };
}
function bars(start, count, step, base, increment) {
  return Array.from({ length: count }, (_, index) => ({ timestamp_utc: new Date(Date.parse(start) + index * step * 60_000).toISOString(),
    open: base + index * increment, high: base + index * increment + 0.75,
    low: base + index * increment - 0.25, close: base + index * increment + 0.5, volume: 100 }));
}
