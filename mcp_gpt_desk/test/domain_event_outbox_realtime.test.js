import assert from "node:assert/strict";
import test from "node:test";
import { DomainEventOutboxRepository } from "../src/domain-event-outbox-repository.js";

test("fresh SSE browser receives a snapshot checkpoint instead of the historical outbox", async () => {
  const repository = repositoryWithRows([{ domain_event_id: "evt-current" }]);

  const result = await repository.listAfter({ cursor: "", limit: 25 });

  assert.deepEqual(result.events, []);
  assert.equal(result.initialSnapshotRequired, true);
  assert.equal(result.resyncRequired, false);
  assert.equal(result.checkpoint, "evt-current");
});

test("empty checkpoint resyncs once a first durable event exists", async () => {
  const repository = repositoryWithRows([{ domain_event_id: "evt-first" }]);

  const result = await repository.listAfter({ cursor: "front_checkpoint_empty", limit: 25 });

  assert.deepEqual(result.events, []);
  assert.equal(result.resyncRequired, true);
  assert.equal(result.checkpoint, "evt-first");
});

test("unknown durable cursor requires canonical snapshot resync", async () => {
  const repository = repositoryWithRows([], [{ domain_event_id: "evt-latest" }]);

  const result = await repository.listAfter({ cursor: "evt-expired", limit: 25 });

  assert.deepEqual(result.events, []);
  assert.equal(result.resyncRequired, true);
  assert.equal(result.checkpoint, "evt-latest");
});

function repositoryWithRows(firstRows, subsequentRows = firstRows) {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      return { rows: calls === 1 ? firstRows : subsequentRows };
    },
  };
  return new DomainEventOutboxRepository({ pool, initialized: Promise.resolve() });
}
