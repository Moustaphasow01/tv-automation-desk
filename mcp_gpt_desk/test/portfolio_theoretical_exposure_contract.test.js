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
