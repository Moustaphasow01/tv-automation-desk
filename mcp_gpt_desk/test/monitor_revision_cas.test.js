import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const stateCollection = "desk_active_theses";
const monitorCollection = "desk_manual_monitors";
const setupCollection = "desk_setups";

function mutation({ monitorId, expectedRevision = 2, commandHash = `hash_${monitorId}` } = {}) {
  const monitorDoc = { monitor_id: monitorId, command_id: `command_${monitorId}`, monitor_command_hash: commandHash };
  return {
    monitorCollection,
    monitorId,
    monitorDoc,
    commandHash,
    stateCollection,
    stateId: "thesis_1",
    expectedRevision,
    statePatch: { health_score: 75 },
    writes: [
      { collection: monitorCollection, documentId: monitorId, data: monitorDoc },
      { collection: setupCollection, documentId: `setup_${monitorId}`, data: { setup_id: `setup_${monitorId}` } },
    ],
  };
}

test("stale Monitor CAS rejects before every document mutation", async () => {
  const persistence = new InMemoryDeskPersistence({ documents: { [stateCollection]: { thesis_1: { thesis_id: "thesis_1", revision: 2 } } } });
  await assert.rejects(
    () => persistence.commitLiveMonitorMutation(mutation({ monitorId: "stale", expectedRevision: 1 })),
    (error) => error.code === "MONITOR_REVISION_CONFLICT",
  );
  assert.equal(persistence.peek(monitorCollection, "stale"), null);
  assert.equal(persistence.peek(setupCollection, "setup_stale"), null);
  assert.deepEqual(persistence.peek(stateCollection, "thesis_1"), { thesis_id: "thesis_1", revision: 2 });
});

test("Monitor CAS atomically advances state and retries idempotently", async () => {
  const persistence = new InMemoryDeskPersistence({ documents: { [stateCollection]: { thesis_1: { thesis_id: "thesis_1", revision: 2 } } } });
  const first = await persistence.commitLiveMonitorMutation(mutation({ monitorId: "m1" }));
  assert.equal(first.replayed, false);
  assert.equal(first.revision, 3);
  assert.equal(persistence.peek(stateCollection, "thesis_1").revision, 3);
  assert.equal(persistence.peek(monitorCollection, "m1").applied_revision, 3);
  assert.equal(persistence.peek(setupCollection, "setup_m1").setup_id, "setup_m1");

  const retry = await persistence.commitLiveMonitorMutation(mutation({ monitorId: "m1" }));
  assert.equal(retry.replayed, true);
  assert.equal(persistence.peek(stateCollection, "thesis_1").revision, 3);
  await assert.rejects(
    () => persistence.commitLiveMonitorMutation(mutation({ monitorId: "m1", commandHash: "different" })),
    (error) => error.code === "MONITOR_IDEMPOTENCY_CONFLICT",
  );
});

test("concurrent Monitor commits accept exactly one expected revision", async () => {
  const persistence = new InMemoryDeskPersistence({ documents: { [stateCollection]: { thesis_1: { thesis_id: "thesis_1", revision: 2 } } } });
  const results = await Promise.allSettled([
    persistence.commitLiveMonitorMutation(mutation({ monitorId: "left" })),
    persistence.commitLiveMonitorMutation(mutation({ monitorId: "right" })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "MONITOR_REVISION_CONFLICT");
  assert.equal(persistence.peek(stateCollection, "thesis_1").revision, 3);
  assert.equal(persistence.count(monitorCollection), 1);
  assert.equal(persistence.count(setupCollection), 1);
});
