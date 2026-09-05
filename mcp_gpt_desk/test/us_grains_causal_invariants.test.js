import assert from "node:assert/strict";
import test from "node:test";
import { detectUsGrainsStrategySignals, buildGrainMarketContext, usGrainsSessionCloseUtc } from "../src/us-grains-strategy-suite.js";

test("independent review: future own and peer price changes cannot rewrite earlier signals", () => {
  const input = fixture();
  const cutoff = "2026-07-07T15:10:00.000Z";
  const full = detectUsGrainsStrategySignals(input).raw_signals.filter((signal) => signal.generated_at_utc <= cutoff);
  assert.ok(full.length > 0, "invariance is not a vacuous empty-array comparison");
  const altered = structuredClone(input);
  for (const [key, rows] of Object.entries(altered.rowsBySymbol)) {
    const duration = Number(key.split(":").at(-1)) * 60_000;
    for (const row of rows) {
      if (Date.parse(row.timestamp_utc) + duration > Date.parse(cutoff)) {
        for (const field of ["open", "high", "low", "close"]) row[field] += 500;
      }
    }
  }
  const changed = detectUsGrainsStrategySignals(altered).raw_signals.filter((signal) => signal.generated_at_utc <= cutoff);
  const prefix = detectUsGrainsStrategySignals({ ...input, asOfUtc: cutoff }).raw_signals;
  assert.deepEqual(changed, full);
  assert.deepEqual(prefix, full);
});

test("independent review: public context constructor cannot consume future peer bars", () => {
  const input = fixture();
  const args = { instrument: "ZW", tradingDate: "2026-07-07", asOfUtc: "2026-07-07T15:10Z",
    rows: input.rowsBySymbol["ZW1!:5"].filter((row) => row.timestamp_utc.startsWith("2026-07-07")),
    peerRows: input.rowsBySymbol["ZC1!:5"].filter((row) => row.timestamp_utc.startsWith("2026-07-07")) };
  const cutoff = Date.parse(args.asOfUtc);
  const expected = buildGrainMarketContext({ ...args,
    rows: args.rows.filter((row) => Date.parse(row.timestamp_utc) + 300_000 <= cutoff),
    peerRows: args.peerRows.filter((row) => Date.parse(row.timestamp_utc) + 300_000 <= cutoff) });
  assert.deepEqual(buildGrainMarketContext(args), expected);
});

test("independent review: Chicago close follows winter and summer UTC offsets", () => {
  assert.equal(usGrainsSessionCloseUtc("2026-02-06T16:00Z"), "2026-02-06T19:20:00.000Z");
  assert.equal(usGrainsSessionCloseUtc("2026-04-06T16:00Z"), "2026-04-06T18:20:00.000Z");
});

function fixture() {
  const prior = bars("2026-07-06T13:30Z", 58, 5, 99, 0);
  const current = bars("2026-07-07T13:30Z", 58, 5, 100, 0.5);
  return { instruments: ["ZW"], startDate: "2026-07-07", endDate: "2026-07-07", rowsBySymbol: {
    "ZW1!:5": [...prior, ...current], "ZC1!:5": [...prior, ...current],
    "ZW1!:1": bars("2026-07-07T13:30Z", 290, 1, 100, 0.1),
  } };
}

function bars(start, count, step, base, increment) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp_utc: new Date(Date.parse(start) + index * step * 60_000).toISOString(),
    open: base + index * increment, high: base + index * increment + 0.75,
    low: base + index * increment - 0.25, close: base + index * increment + 0.5, volume: 100,
  }));
}
