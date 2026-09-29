import test from "node:test";
import assert from "node:assert/strict";
import { projectDay, aggregateBatch } from "../src/application/batch-projection.js";
import { fixture, DAY } from "./support.js";

test("missing metrics remain null, reported zero remains zero, statistics only use completed days", () => {
  const rows = [{ state: "COMPLETED", audit: { net_r: 0, net_usd: 20 } }, { state: "COMPLETED", audit: { net_r: 2 } }, { state: "REPLAYING", audit: { net_r: 500 } }];
  const stats = aggregateBatch(rows);
  assert.deepEqual(stats.metrics.net_r, { observed_days: 2, total_days: 2, sum: 2, mean: 1, median: 1 });
  assert.equal(stats.metrics.net_usd.observed_days, 1);
  assert.equal(stats.metrics.mae.sum, null);
  assert.equal(projectDay({ state: "NEW" }).metrics.fills, null);
});
test("actions distinguish rejected plans, technical retry, frozen replay and completed read-only", () => {
  for (const [state, action] of [["NEW", "capture"], ["WAITING_SCENARIO", "scenario"], ["FROZEN", "replay"], ["FAILED_TECHNICAL", "retry"], ["FAILED_PLAN_VALIDATION", "new-plan"]]) {
    assert.deepEqual(projectDay({ state }).allowed_actions, [action]);
  }
  assert.deepEqual(projectDay({ state: "COMPLETED" }).allowed_actions, []);
});
test("result verification tolerates JSONB key order but never changed values", async () => {
  const f = await fixture(), row = await f.workflow.execute(DAY);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  await f.replay.verifyResults(DAY, reorder(row.run_meta));
  await assert.rejects(() => f.replay.verifyResults(DAY, { ...row.run_meta, symbol: "OTHER" }), { code: "RESULT_REGISTRY_MISMATCH" });
});
test("invalid Unicode is not silently replaced during UTF-8 freeze", async () => {
  const f = await fixture();
  f.scenarioBuilder.request = async () => ({ status: "READY", plan_text: "\uD800", generated_by: "TEST_ONLY", generated_at: "2026-09-29T12:00:00Z" });
  const row = await f.workflow.execute(DAY);
  assert.equal(row.error.code, "SCENARIO_RESPONSE_INVALID");
  assert.equal(f.calls.includes("load"), false);
});
