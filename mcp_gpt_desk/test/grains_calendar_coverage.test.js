import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGrainsCalendarCoverage } from "../src/grains-calendar-coverage.js";
import {
  buildCausalGrainContext,
  adjudicateCausalGrainSignal,
} from "../src/us-grains-causal-context.js";
import { grainsCalendarFixture } from "./support/grains-calendar-fixture.js";

const cutoff = "2026-09-04T15:00:00Z";
test("macro coverage requires a known, versioned source, not just an empty calendar", () => {
  for (const sources of [
    [],
    [grainsCalendarFixture({ asOf: "2026-09-05T00:00Z" })],
    [grainsCalendarFixture({ sourceVersionHash: null })],
    [grainsCalendarFixture({ status: "UNKNOWN_COVERAGE" })],
    [grainsCalendarFixture({ coverageEnd: "2026-09-01T00:00Z" })],
  ]) {
    assert.equal(
      evaluateGrainsCalendarCoverage({ sources, cutoff }).admissible,
      false,
    );
  }
  assert.equal(
    evaluateGrainsCalendarCoverage({
      sources: [grainsCalendarFixture()],
      cutoff,
    }).admissible,
    true,
  );
});

test("newer known degraded source invalidates earlier coverage; future revisions do not", () => {
  const good = grainsCalendarFixture();
  const bad = grainsCalendarFixture({
    asOf: "2026-09-03T00:00Z",
    status: "STALE",
  });
  assert.equal(
    evaluateGrainsCalendarCoverage({ sources: [good, bad], cutoff }).admissible,
    false,
  );
  assert.equal(
    evaluateGrainsCalendarCoverage({
      sources: [good, { ...bad, asOf: "2026-09-05T00:00Z" }],
      cutoff,
    }).admissible,
    true,
  );
});

test("missing calendar yields WAIT after detection and does not claim no macro risk", () => {
  const context = buildCausalGrainContext({
    instrument: "ZW",
    tradingDate: "2026-09-04",
    asOfUtc: cutoff,
    events: [],
    dataQuality: { tradeable: true },
  });
  assert.ok(context.reason_codes.includes("AGRI_EVENT_COVERAGE_UNKNOWN"));
  assert.equal(
    context.reason_codes.includes("NO_HIGH_AGRI_EVENT_NEARBY"),
    false,
  );
  const result = adjudicateCausalGrainSignal({
    signal: {
      signal_id: "test",
      direction: "LONG",
      generated_at_utc: cutoff,
      source_data_cutoff_utc: cutoff,
      setup: { setup_kind: "VWAP_PULLBACK" },
    },
    context,
  });
  assert.equal(result.recommendation, "WAIT");
  assert.ok(result.reason_codes.includes("AGRI_CALENDAR_COVERAGE_UNPROVEN"));
});

test("simultaneous conflicting coverage versions fail closed, exact duplicates are harmless", () => {
  const first = grainsCalendarFixture();
  const second = grainsCalendarFixture({ status: "STALE" });
  const result = evaluateGrainsCalendarCoverage({
    sources: [first, second],
    cutoff,
  });
  assert.equal(result.admissible, false);
  assert.deepEqual(result.reasonCodes, ["AGRI_CALENDAR_VERSION_AMBIGUOUS"]);
  assert.equal(
    evaluateGrainsCalendarCoverage({ sources: [first, { ...first }], cutoff })
      .admissible,
    true,
  );
});
