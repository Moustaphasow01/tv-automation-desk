import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../scripts/correct_theoretical_trade_outcomes.mjs", import.meta.url));

test("apply CLI fails closed before database access without the exact confirmation", () => {
  const result = spawnSync(process.execPath, [script,
    "--mode", "apply",
    "--manifest", "manifest.json",
    "--output", "report.json",
    "--corrected-by", "operator-test",
    "--reason", "test",
    "--correction-known-at-utc", "2026-09-07T08:00:00Z",
  ], { encoding: "utf8", env: {} });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, code: "OUTCOME_CORRECTION_CONFIRMATION_REQUIRED" });
});

test("CLI rejects unknown arguments without reading a manifest or database", () => {
  const result = spawnSync(process.execPath, [script, "--unknown", "value"], { encoding: "utf8", env: {} });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, code: "OUTCOME_CORRECTION_PATHS_REQUIRED" });
});
