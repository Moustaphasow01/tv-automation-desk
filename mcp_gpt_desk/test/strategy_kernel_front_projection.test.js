import assert from "node:assert/strict";
import test from "node:test";
import { PersistentDeskStore } from "../src/store.js";

test("Strategy v2 overview projects definitions versions instances and audit for the front", async () => {
  const calls = [];
  const store = {
    clock: { now: () => ({ utc: "2026-08-09T08:00:00.000Z" }) },
    strategyKernel: {
      async listDefinitions(input) {
        calls.push(["definitions", input]);
        return [{ strategy_definition_id: "def-1", external_key: "breakout-retest-mnq", name: "Breakout Retest MNQ", owner: "research-lab" }];
      },
      async listVersions(input) {
        calls.push(["versions", input]);
        return [{ strategy_version_id: "ver-1", strategy_definition_id: "def-1", version_label: "1.0.0", status: "PUBLISHED", updated_at_utc: "2026-08-09T08:05:00.000Z" }];
      },
      async listInstances(input) {
        calls.push(["instances", input]);
        return [
          { strategy_instance_id: "inst-paper", strategy_version_id: "ver-1", runtime_state: "RUNNING", execution_mode: "PAPER", instrument_scope: ["MNQ"] },
          { strategy_instance_id: "inst-shadow", strategy_version_id: "ver-1", runtime_state: "CREATED", execution_mode: "SHADOW", instrument_scope: ["MES"] },
        ];
      },
      async listAuditEvents(input) {
        calls.push(["audit", input]);
        return [{ audit_event_id: "audit-1", aggregate_type: "strategy_version", aggregate_id: "ver-1", event_type: "STRATEGY_VERSION_PUBLISHED", created_at_utc: "2026-08-09T08:06:00.000Z" }];
      },
    },
  };

  const result = await PersistentDeskStore.prototype.getStrategyV2Overview.call(store, { limit: 25 });

  assert.equal(result.contract, "DeskStrategyV2Overview");
  assert.equal(result.generated_at_utc, "2026-08-09T08:00:00.000Z");
  assert.equal(result.summary.definitions, 1);
  assert.equal(result.summary.published_versions, 1);
  assert.equal(result.summary.paper_instances, 1);
  assert.equal(result.summary.shadow_instances, 1);
  assert.equal(result.strategies[0].published_version.strategy_version_id, "ver-1");
  assert.equal(result.strategies[0].paper_instance.strategy_instance_id, "inst-paper");
  assert.equal(result.strategies[0].operator_state.recommended_next_step, "EVALUATE_PAPER_PROMOTION");
  assert.equal(result.strategies[0].recent_audit[0].audit_event_id, "audit-1");
  assert.deepEqual(calls.map(([name]) => name), ["definitions", "versions", "instances", "audit"]);
  assert.equal(calls[3][1].limit, 25);
});
