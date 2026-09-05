import test from "node:test";
import assert from "node:assert/strict";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";

test("unknown/physical mode cannot be read as a healthy theoretical account", async () => {
  const noQuery = { query() { throw new Error("SQL_NOT_EXPECTED"); } };
  for (const execution_mode of ["LIVE", "PAPER", "UNRECOGNIZED_MODE"]) {
    const result = await loadTheoreticalExposureAsOf(noQuery, { execution_mode, as_of_utc: "2026-09-04T15:00Z" });
    assert.equal(result.availability, "UNAVAILABLE");
    assert.equal(result.reason_codes.includes("PHYSICAL_EXPOSURE_READ_UNSUPPORTED"), true);
  }
});

test("a missing/invalid as-of is not an empty known exposure", async () => {
  const noQuery = { query() { throw new Error("SQL_NOT_EXPECTED"); } };
  for (const as_of_utc of [undefined, "invalid"]) {
    await assert.rejects(loadTheoreticalExposureAsOf(noQuery, { as_of_utc }), /THEORETICAL_EXPOSURE_CUTOFF_REQUIRED/);
  }
});

test("SEMI_MANUAL accepts only proven final-outcome usage and missing proof is partial", async () => {
  const proven = {
    async query() {
      return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
        daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 0, unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
        period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES",
      } }] };
    },
  };
  const semiManual = await loadTheoreticalExposureAsOf(proven, { execution_mode: "SEMI_MANUAL", as_of_utc: "2026-09-04T15:00Z" });
  assert.equal(semiManual.availability, "KNOWN");
  assert.equal(semiManual.loss_usage_availability, "KNOWN");
  assert.equal(semiManual.loss_usage.period_timezone, "UTC");

  const missingProof = { async query() { return { rows: [{ positions: [], intents: [], qualified: [] }] }; } };
  const result = await loadTheoreticalExposureAsOf(missingProof, { execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z" });
  assert.equal(result.availability, "PARTIAL");
  assert.equal(result.loss_usage_availability, "UNAVAILABLE");
  assert.ok(result.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_R_UNAVAILABLE"));
});

test("final-outcome provenance failure remains ordered before missing closed outcomes", async () => {
  const source = { async query() { return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
    daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 2,
    unproven_final_outcome_count: 1, missing_closed_final_outcome_count: 1,
  } }] }; } };
  const result = await loadTheoreticalExposureAsOf(source, {
    execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z",
  });
  assert.equal(result.loss_usage_availability, "UNAVAILABLE");
  assert.ok(result.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_PROVENANCE_UNAVAILABLE"));
  assert.equal(result.reason_codes.includes("THEORETICAL_CLOSED_TRADE_OUTCOME_UNAVAILABLE"), false);
});
