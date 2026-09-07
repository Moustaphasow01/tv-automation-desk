import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { DomainEventOutboxRepository } from "../src/domain-event-outbox-repository.js";
import { writeFrontControlPlaneEvents } from "../src/front-control-plane-realtime.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("durable publications cross the real HTTP SSE boundary once and then return to heartbeats",
  // Includes schema creation alongside other real-PostgreSQL suites, plus two
  // genuine five-second SSE polls. This is not a UI latency acceptance budget.
  { skip: process.env.RUN_POSTGRES_TESTS !== "1", timeout: 60_000 }, async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const repository = new DomainEventOutboxRepository({ pool: database.pool, initialized: Promise.resolve() });
    await insertEvent(database.pool, "checkpoint", "2026-09-07T16:45:26.924523Z", 1);
    const store = { listFrontRealtimeEvents: (input) => repository.listAfter(input) };
    const server = createServer((req, res) => writeFrontControlPlaneEvents(store, req, res, { cursor: "checkpoint" }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => { server.closeAllConnections(); server.close(); });
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`http://127.0.0.1:${server.address().port}/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    t.after(() => reader.cancel().catch(() => {}));
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /: heartbeat /);

    const writer = await database.pool.connect();
    await writer.query("BEGIN");
    try {
      for (let index = 1; index <= 4; index += 1) {
        await insertEvent(writer, `publication-${index}`, "2026-09-07T16:45:27.924523Z", index + 1);
      }
      await writer.query("COMMIT");
    } catch (error) { await writer.query("ROLLBACK"); throw error; }
    finally { writer.release(); }
    const capture = await readThroughIdleHeartbeat(reader);
    const events = capture.split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    assert.deepEqual(events.map((event) => event.eventId), [1, 2, 3, 4].map((index) => `publication-${index}`));
    assert.equal(new Set(events.map((event) => event.eventId)).size, 4);
    assert.ok(events.every((event) => event.eventType === "market.desk.brief.published"));
    assert.ok(events.every((event) => event.occurredAt === "2026-09-07T16:45:27.883651Z"));
    assert.match(capture, /: heartbeat /);
    const orders = await database.pool.query("SELECT count(*)::int AS count FROM portfolio_order_intent_lineage");
    assert.equal(orders.rows[0].count, 0);
  });

async function insertEvent(pool, id, createdAt, sequence) {
  await pool.query(`INSERT INTO domain_event_outbox (
    domain_event_id,aggregate_id,aggregate_type,aggregate_sequence,event_type,revision,
    occurred_at_utc,received_at_utc,source,correlation_id,schema_version,payload_hash,payload,created_at_utc
  ) VALUES ($1,'brief-test','market_desk_brief',$2,'market.desk.brief.published',1,
    '2026-09-07T16:45:27.883651Z','2026-09-07T16:45:27.883651Z','integration-test',
    'correlation-test','1.0.0',$3,'{}'::jsonb,$4)`, [id, sequence, `sha256:${"1".repeat(64)}`, createdAt]);
}

async function readThroughIdleHeartbeat(reader) {
  const decoder = new TextDecoder();
  let capture = "";
  while (!capture.includes(": heartbeat ")) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE_ENDED_BEFORE_IDLE_HEARTBEAT");
    capture += decoder.decode(value, { stream: true });
  }
  return capture;
}
