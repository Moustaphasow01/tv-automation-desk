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

test("known cursor remains an id parameter and never round-trips its timestamp through JavaScript", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [{ cursor_found: true, domain_event_id: null }] };
      return { rows: [{ domain_event_id: "evt-cursor" }] };
    },
  };
  const repository = new DomainEventOutboxRepository({ pool, initialized: Promise.resolve() });

  const result = await repository.listAfter({ cursor: "evt-cursor", limit: 25 });

  assert.deepEqual(result.events, []);
  assert.deepEqual(calls[0].params, ["evt-cursor", 25]);
  assert.match(calls[0].sql, /EXISTS\(SELECT 1 FROM checkpoint\) AS cursor_found/);
  assert.match(calls[0].sql, /CROSS JOIN checkpoint/);
  assert.doesNotMatch(calls[0].sql, /\$1::timestamptz/);
});

test("idempotent append preserves PostgreSQL Date milliseconds", async () => {
  const stored = {
    domain_event_id: "evt-existing",
    aggregate_id: "aggregate-1",
    aggregate_type: "test",
    aggregate_sequence: 1,
    event_type: "test.event",
    occurred_at_utc: new Date("2026-09-07T16:45:27.883Z"),
    received_at_utc: new Date("2026-09-07T16:45:27.884Z"),
    source: "test",
    correlation_id: "correlation-1",
    schema_version: "1.0.0",
    revision: 1,
    payload: {},
  };
  const pool = { query: async () => ({ rows: [stored] }) };
  const repository = new DomainEventOutboxRepository({ pool, initialized: Promise.resolve() });

  const result = await repository.append({
    eventId: "evt-existing",
    aggregateId: "aggregate-1",
    aggregateType: "test",
    eventType: "test.event",
    correlationId: "correlation-1",
    payload: {},
  });

  assert.equal(result.status, "IDEMPOTENT");
  assert.equal(result.event.occurredAt, "2026-09-07T16:45:27.883Z");
  assert.equal(result.event.receivedAt, "2026-09-07T16:45:27.884Z");
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
