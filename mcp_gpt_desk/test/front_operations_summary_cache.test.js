import assert from "node:assert/strict";
import test from "node:test";
import { FrontOperationsService } from "../src/front-operations-service.js";

test("operations summary coalesces concurrent reads and reuses the short-lived projection", async () => {
  const persistence = new CountingPersistence();
  const service = new FrontOperationsService({
    persistence,
    clock: { now: () => ({ utc: "2026-07-23T12:00:00.000Z", epochMs: Date.parse("2026-07-23T12:00:00.000Z") }) },
    host: {},
  });

  const [left, right] = await Promise.all([
    service.getOperationsSummary({}),
    service.getOperationsSummary({}),
  ]);
  assert.deepEqual(left, right);
  const callsAfterConcurrentRead = persistence.calls;
  assert.ok(callsAfterConcurrentRead > 0);

  const cached = await service.getOperationsSummary({});
  assert.deepEqual(cached, left);
  assert.equal(persistence.calls, callsAfterConcurrentRead);
});

test("GPT operations reads project heavy bundle and output documents at the SQL boundary", async () => {
  const persistence = new ProjectionPersistence();
  const service = new FrontOperationsService({
    persistence,
    clock: { now: () => ({ utc: "2026-07-23T12:00:00.000Z", epochMs: Date.parse("2026-07-23T12:00:00.000Z") }) },
    host: {},
  });

  await service.listGptProcesses({ limit: 1000 });

  assert.deepEqual(
    persistence.projections.map((item) => item.collection).sort(),
    [
      "desk_agent_work_events",
      "desk_agent_work_items",
      "desk_ai_worker_runs",
      "desk_replay_bundles",
      "desk_replay_master_analyses",
      "desk_replay_monitors",
    ],
  );
  const bundle = persistence.projections.find((item) => item.collection === "desk_replay_bundles");
  assert.ok(bundle.fields.includes("manifest"));
  assert.ok(!bundle.fields.includes("payload"));
  assert.ok(!persistence.fullReads.includes("desk_replay_bundles"));
});

class CountingPersistence {
  calls = 0;

  async listDocuments() {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [];
  }

  async setDocument() {}
  async createDocument() {}
  async deleteDocument() {}
  async deleteCollection() {}
}

class ProjectionPersistence {
  projections = [];
  fullReads = [];

  async listDocuments(collection) {
    this.fullReads.push(collection);
    if (collection === "desk_replay_runs") {
      return [{
        backtest_id: "run-1",
        replay_mode: "orchestrated_gpt_in_the_loop",
        replay_schema_version: "2.0.0",
        strategy_version: "autopilot_v4",
        cadence: "15m",
        pinned_contracts: {
          master_contract: {
            contract_id: "DeskMasterAnalysisContract_v4_0_0",
            schema_version: "4.0.0",
          },
        },
      }];
    }
    return [];
  }

  async queryCollectionDocumentProjections(input) {
    this.projections.push(input);
    if (input.collection === "desk_agent_work_items") {
      return [{ work_item_id: "work-1", backtest_id: "run-1", step_id: "step-1", workflow: "REPLAY_MASTER", status: "READY" }];
    }
    return [];
  }

  async setDocument() {}
  async createDocument() {}
  async deleteDocument() {}
  async deleteCollection() {}
}
