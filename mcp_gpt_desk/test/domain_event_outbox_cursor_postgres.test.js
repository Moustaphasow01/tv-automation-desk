import assert from "node:assert/strict";
import test from "node:test";
import { DomainEventOutboxRepository } from "../src/domain-event-outbox-repository.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("domain event cursor preserves PostgreSQL microseconds and stable pagination",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const repository = new DomainEventOutboxRepository({ pool: database.pool, initialized: Promise.resolve() });
    const createdAt = "2026-09-07T16:45:27.924523Z";
    await seedEvents(database.pool, [
      event("cursor-a", createdAt, "2026-09-07T16:45:27.883651Z", 1),
      event("cursor-b", createdAt, "2026-09-07T16:45:27.883652Z", 2),
      event("cursor-c", createdAt, "2026-09-07T16:45:27.883653Z", 3),
    ]);

    const legacyCheckpoint = await database.pool.query(
      "SELECT created_at_utc, domain_event_id FROM domain_event_outbox WHERE domain_event_id = 'cursor-c'",
    );
    assert.equal(legacyCheckpoint.rows[0].created_at_utc.toISOString(), "2026-09-07T16:45:27.924Z");
    const legacyReplay = await database.pool.query(`SELECT domain_event_id FROM domain_event_outbox
      WHERE (created_at_utc, domain_event_id) > ($1::timestamptz, $2::text)
      ORDER BY created_at_utc, domain_event_id`, [
      legacyCheckpoint.rows[0].created_at_utc, legacyCheckpoint.rows[0].domain_event_id,
    ]);
    assert.deepEqual(legacyReplay.rows.map((row) => row.domain_event_id), ["cursor-a", "cursor-b", "cursor-c"]);

    const firstPage = await repository.listAfter({ cursor: "cursor-a", limit: 1 });
    assert.deepEqual(firstPage.events.map((item) => item.eventId), ["cursor-b"]);
    assert.equal(firstPage.events[0].occurredAt, "2026-09-07T16:45:27.883652Z");
    assert.equal(firstPage.events[0].receivedAt, "2026-09-07T16:45:27.883652Z");
    const secondPage = await repository.listAfter({ cursor: "cursor-b", limit: 1 });
    assert.deepEqual(secondPage.events.map((item) => item.eventId), ["cursor-c"]);
    const current = await repository.listAfter({ cursor: "cursor-c" });
    assert.deepEqual(current.events, []);
    assert.equal(current.resyncRequired, false);
    assert.equal(current.checkpoint, "cursor-c");

    await seedEvents(database.pool, [
      event("cursor-d", "2026-09-07T16:45:27.924524Z", "2026-09-07T16:45:27.883654Z", 4),
    ]);
    const insertedLater = await repository.listAfter({ cursor: "cursor-c", limit: 10 });
    assert.deepEqual(insertedLater.events.map((item) => item.eventId), ["cursor-d"]);
    assert.equal(insertedLater.events[0].occurredAt, "2026-09-07T16:45:27.883654Z");
    const latest = await repository.listAfter({ cursor: "cursor-d" });
    assert.deepEqual(latest.events, []);
    assert.equal(latest.resyncRequired, false);
    assert.equal(latest.checkpoint, "cursor-d");

    const unknown = await repository.listAfter({ cursor: "cursor-unknown" });
    assert.deepEqual(unknown.events, []);
    assert.equal(unknown.resyncRequired, true);
    assert.equal(unknown.checkpoint, "cursor-d");
    const initial = await repository.listAfter({ cursor: "" });
    assert.equal(initial.initialSnapshotRequired, true);
    assert.equal(initial.checkpoint, "cursor-d");
    const emptyCheckpoint = await repository.listAfter({ cursor: "front_checkpoint_empty" });
    assert.equal(emptyCheckpoint.resyncRequired, true);
    assert.equal(emptyCheckpoint.checkpoint, "cursor-d");
  });

async function seedEvents(pool, values) {
  for (const value of values) {
    await pool.query(`INSERT INTO domain_event_outbox (
      domain_event_id, aggregate_id, aggregate_type, aggregate_sequence,
      event_type, revision, occurred_at_utc, received_at_utc, source,
      correlation_id, schema_version, payload_hash, payload, created_at_utc
    ) VALUES ($1,'cursor-test','test', $2, 'test.event', 1, $3, $3,
      'cursor-test','cursor-test','1.0.0',$4,'{}'::jsonb,$5)`, [
      value.id, value.sequence, value.occurredAt, `sha256:${"1".repeat(64)}`, value.createdAt,
    ]);
  }
}

function event(id, createdAt, occurredAt, sequence) {
  return { id, createdAt, occurredAt, sequence };
}
