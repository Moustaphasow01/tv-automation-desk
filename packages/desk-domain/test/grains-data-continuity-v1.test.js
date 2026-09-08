import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGrainsDataContinuity, GRAINS_DATA_POLICIES as POLICY, normalizeGrainsDataPolicy, requiredGrainsTimeframes } from "../index.js";

test("grains continuity defaults strict and rejects unknown policies", () => {
  assert.equal(normalizeGrainsDataPolicy(), POLICY.STRICT);
  assert.throws(() => normalizeGrainsDataPolicy("IGNORE_ALL"), { code: "GRAINS_DATA_POLICY_INVALID" });
  assert.deepEqual(requiredGrainsTimeframes(), ["1", "5"]);
  for (const instruments of [[], ["MNQ"], ["ZW", "MES"]])
    assert.deepEqual(requiredGrainsTimeframes({ policy: POLICY.M5_FALLBACK, instruments }), ["1", "5"]);
  assert.deepEqual(requiredGrainsTimeframes({ policy: POLICY.M5_FALLBACK, instruments: ["ZC", "ZW"] }), ["5"]);
});

test("optional M1 never changes its evidence and M5 must independently be READY", () => {
  const timeframes = { M1: { status: "BLOCKED", issues: ["ROW_COUNT_BLOCKING"] }, M5: { status: "READY", issues: [] } };
  const before = structuredClone(timeframes);
  const fallback = evaluateGrainsDataContinuity({ policy: POLICY.M5_FALLBACK, instrument: "ZW", timeframes });
  assert.equal(fallback.tradeable, true);
  assert.equal(fallback.status, "DEGRADED");
  assert.equal(fallback.data_mode, "M5_FALLBACK");
  assert.deepEqual(fallback.blocking_issues, []);
  assert.deepEqual(timeframes, before);
  const strict = evaluateGrainsDataContinuity({ instrument: "ZW", timeframes });
  assert.equal(strict.tradeable, false);
  assert.deepEqual(strict.blocking_issues, ["M1_ROW_COUNT_BLOCKING"]);
  for (const M5 of [undefined, { status: "DEGRADED", issues: [] }, { status: "BLOCKED", issues: ["STALE_BLOCKING"] }]) {
    const result = evaluateGrainsDataContinuity({ policy: POLICY.M5_FALLBACK, instrument: "ZC", timeframes: { ...timeframes, M5 } });
    assert.equal(result.tradeable, false);
    assert.equal(result.data_mode, "BLOCKED");
    assert.deepEqual(result.reason_codes, []);
  }
  assert.equal(evaluateGrainsDataContinuity({ instrument: "ZW" }).tradeable, false);
  assert.equal(evaluateGrainsDataContinuity({ policy: POLICY.M5_FALLBACK, instrument: "ZW",
    timeframes: { M1: timeframes.M5, M5: timeframes.M5 } }).data_mode, "M1_M5");
});
