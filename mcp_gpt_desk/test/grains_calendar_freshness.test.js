import test from "node:test";
import assert from "node:assert/strict";
import { applyGrainsCalendarFreshness, GRAINS_CALENDAR_AUTOMATION_VERSION } from "../src/grains-calendar-freshness.js";

const coverage = { status: "AVAILABLE", asOf: "2026-09-07T08:00:00Z", coverageEnd: "2026-09-14T00:00:00Z", reasonCodes: [] };
const metadata = { ingestion_mode: GRAINS_CALENDAR_AUTOMATION_VERSION, freshness_max_age_seconds: 21600 };

test("automated calendar expires exactly six hours after observation, not provider document date", () => {
  const fresh = applyGrainsCalendarFreshness(coverage, { metadata, cutoff: "2026-09-07T13:59:59Z" });
  assert.equal(fresh.status, "AVAILABLE");
  assert.equal(fresh.coverageEnd, "2026-09-07T13:59:59.999Z");
  const expired = applyGrainsCalendarFreshness(coverage, { metadata, cutoff: "2026-09-07T14:00:00Z" });
  assert.equal(expired.status, "STALE");
  assert.ok(expired.reasonCodes.includes("CALENDAR_REFRESH_OVERDUE"));
  assert.equal(coverage.coverageEnd, "2026-09-14T00:00:00Z");
});

test("legacy historical coverage is not silently rewritten by the new prospective policy", () => {
  assert.equal(applyGrainsCalendarFreshness(coverage, { cutoff: "2026-10-01T00:00:00Z" }), coverage);
});

test("invalid automation age cannot create infinite freshness or repair unavailable evidence", () => {
  for (const freshness_max_age_seconds of [0, -1, 21601, null, "21600", Infinity]) {
    const result = applyGrainsCalendarFreshness(coverage, {
      metadata: { ...metadata, freshness_max_age_seconds }, cutoff: "2026-09-07T08:01:00Z",
    });
    assert.equal(result.status, "STALE");
    assert.ok(result.reasonCodes.includes("CALENDAR_FRESHNESS_POLICY_INVALID"));
  }
  assert.equal(applyGrainsCalendarFreshness({ ...coverage, status: "UNKNOWN_COVERAGE" }, {
    metadata, cutoff: "2026-09-07T14:00:00Z",
  }).status, "UNKNOWN_COVERAGE");
});
