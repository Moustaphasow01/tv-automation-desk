import assert from "node:assert/strict";
import test from "node:test";
import {
  FRONT_EVENTS_CONTRACT_VERSION,
  buildFrontErrorEvent,
  buildFrontHeartbeatEvent,
  buildFrontOperationsEvent,
  frontEventSseFrame,
  shouldEmitFrontEvent,
} from "../src/front-events-contract-v1.js";

test("front events use stable content-addressed cursors for reconnect dedupe", () => {
  const payload = { contract: "OperationsSummary", schemaVersion: "1.0.0", totals: { workflows: 3 } };
  const first = buildFrontOperationsEvent(payload, { emittedAtUtc: "2026-08-10T08:00:00.000Z" });
  const replayed = buildFrontOperationsEvent(payload, { emittedAtUtc: "2026-08-10T08:01:00.000Z" });
  const changed = buildFrontOperationsEvent({ ...payload, totals: { workflows: 4 } });

  assert.equal(first.schema_version, FRONT_EVENTS_CONTRACT_VERSION);
  assert.equal(first.event_id, replayed.event_id);
  assert.equal(shouldEmitFrontEvent(replayed, { lastEventId: first.event_id }), false);
  assert.equal(shouldEmitFrontEvent(changed, { lastEventId: first.event_id }), true);
});

test("front events carry traceability fields without inventing business truth", () => {
  const event = buildFrontOperationsEvent(
    {
      contract: "OperationsSummary",
      revision: 7,
      correlation_id: "corr-operations-1",
      account_id: "Sim101",
      instrument_code: "MNQ",
      execution_mode: "SEMI_MANUAL",
      environment: "PAPER",
    },
    {
      emittedAtUtc: "2026-08-10T08:00:00.000Z",
      sequence: 42,
      causationId: "cmd-1",
      aggregateId: "operations-summary",
    },
  );

  assert.equal(event.sequence, 42);
  assert.equal(event.revision, "7");
  assert.equal(event.aggregate_id, "operations-summary");
  assert.equal(event.correlation_id, "corr-operations-1");
  assert.equal(event.causation_id, "cmd-1");
  assert.equal(event.occurred_at_utc, "2026-08-10T08:00:00.000Z");
  assert.equal(event.received_at_utc, "2026-08-10T08:00:00.000Z");
  assert.equal(event.account, "Sim101");
  assert.equal(event.instrument, "MNQ");
  assert.equal(event.environment, "PAPER");
  assert.equal(event.execution_mode, "SEMI_MANUAL");
  assert.equal(event.trace.event_id, event.event_id);
  assert.equal(JSON.stringify(event).includes(":undefined"), false);
});

test("front events mark unavailable metadata explicitly instead of defaulting to success-like values", () => {
  const event = buildFrontOperationsEvent({ ok: true }, { emittedAtUtc: "2026-08-10T08:00:00.000Z" });

  assert.equal(event.sequence, "UNKNOWN");
  assert.equal(event.revision, "UNKNOWN");
  assert.equal(event.correlation_id, "UNKNOWN");
  assert.equal(event.causation_id, "NOT_APPLICABLE");
  assert.equal(event.account, "NOT_APPLICABLE");
  assert.equal(event.instrument, "NOT_APPLICABLE");
  assert.equal(event.environment, "UNKNOWN");
  assert.equal(event.execution_mode, "UNKNOWN");
});

test("front events serialize SSE frames with typed stream and resumable id", () => {
  const event = buildFrontOperationsEvent({ ok: true }, { emittedAtUtc: "2026-08-10T08:00:00.000Z" });
  const frame = frontEventSseFrame(event);

  assert.match(frame, /^id: front_events_v1:operations:[a-f0-9]{64}\n/);
  assert.match(frame, /\nevent: operations\n/);
  assert.match(frame, /"event_type":"OPERATIONS_SNAPSHOT_CHANGED"/);
});

test("front heartbeat and error events stay typed without creating duplicate operation ids", () => {
  const heartbeat = buildFrontHeartbeatEvent({ emittedAtUtc: "2026-08-10T08:00:00.000Z", lastEventId: "cursor-1" });
  const error = buildFrontErrorEvent(new Error("boom"), { emittedAtUtc: "2026-08-10T08:01:00.000Z", lastEventId: "cursor-1" });

  assert.equal(heartbeat.event_type, "STREAM_HEARTBEAT");
  assert.equal(heartbeat.cursor.last_event_id, "cursor-1");
  assert.equal(frontEventSseFrame(heartbeat).startsWith("event: heartbeat\n"), true);
  assert.equal(error.event_type, "STREAM_ERROR");
  assert.equal(error.error, "boom");
  assert.equal(frontEventSseFrame(error).includes("event: error\n"), true);
});
