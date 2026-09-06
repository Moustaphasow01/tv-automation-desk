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
  assert.equal(semiManual.loss_usage.monetary_availability, "UNAVAILABLE");
  assert.equal(semiManual.loss_usage.daily_loss_monetary, null);

  const missingProof = { async query() { return { rows: [{ positions: [], intents: [], qualified: [] }] }; } };
  const result = await loadTheoreticalExposureAsOf(missingProof, { execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z" });
  assert.equal(result.availability, "PARTIAL");
  assert.equal(result.loss_usage_availability, "UNAVAILABLE");
  assert.ok(result.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_R_UNAVAILABLE"));
});

test("monetary loss usage exposes canonical amounts only with complete currency provenance", async () => {
  const complete = monetarySource();
  const result = await loadTheoreticalExposureAsOf(complete, monetaryRequest());
  assert.deepEqual({
    daily: result.loss_usage.daily_loss_monetary,
    weekly: result.loss_usage.weekly_loss_monetary,
    reserved: result.loss_usage.reserved_monetary_risk,
    currency: result.loss_usage.currency,
    availability: result.loss_usage.monetary_availability,
  }, { daily: 600, weekly: 850, reserved: 500, currency: "USD", availability: "KNOWN" });

  const incomplete = monetarySource({ monetary_reservation_gap_count: 1 });
  const unavailable = await loadTheoreticalExposureAsOf(incomplete, monetaryRequest());
  assert.equal(unavailable.loss_usage_availability, "KNOWN");
  assert.equal(unavailable.loss_usage.monetary_availability, "UNAVAILABLE");
  assert.equal(unavailable.loss_usage.daily_loss_monetary, null);
  assert.equal(unavailable.loss_usage.reserved_monetary_risk, null);
  assert.equal(unavailable.loss_usage.currency, "UNAVAILABLE");
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

function monetaryRequest() {
  return {
    execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z",
    risk_budget: { max_monetary_risk_currency: "USD" },
  };
}

function monetarySource(overrides = {}) {
  return { async query() { return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
    daily_realized_r: -0.6, weekly_realized_r: -0.85,
    daily_loss_monetary: 600, weekly_loss_monetary: 850, reserved_monetary_risk: 500,
    currency: "USD", monetary_reservation_gap_count: 0, monetary_outcome_gap_count: 0,
    final_outcome_count: 2, unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
    period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES", ...overrides,
  } }] }; } };
}
