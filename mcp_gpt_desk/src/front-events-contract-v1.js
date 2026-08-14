import { createHash } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";

export const FRONT_EVENTS_CONTRACT_VERSION = "front_events_v1";
export const FRONT_EVENTS_STREAMS = Object.freeze({ OPERATIONS: "operations", HEARTBEAT: "heartbeat", ERROR: "error" });
export const FRONT_EVENT_UNKNOWN = "UNKNOWN";
export const FRONT_EVENT_NOT_APPLICABLE = "NOT_APPLICABLE";
const FRONT_EVENTS_SYSTEM_CLOCK = new SystemClock();

export function buildFrontOperationsEvent(payload, options = {}) {
  const { emittedAtUtc = FRONT_EVENTS_SYSTEM_CLOCK.now().utc } = options;
  const payloadHash = hashJson(payload);
  const eventId = `${FRONT_EVENTS_CONTRACT_VERSION}:operations:${payloadHash}`;
  const trace = buildFrontEventTrace({
    ...options,
    eventId,
    eventType: "OPERATIONS_SNAPSHOT_CHANGED",
    stream: FRONT_EVENTS_STREAMS.OPERATIONS,
    emittedAtUtc,
    payload,
  });
  return {
    schema_version: FRONT_EVENTS_CONTRACT_VERSION,
    event_id: eventId,
    event_type: "OPERATIONS_SNAPSHOT_CHANGED",
    stream: FRONT_EVENTS_STREAMS.OPERATIONS,
    sequence: trace.sequence,
    revision: trace.revision,
    aggregate_id: trace.aggregate_id,
    correlation_id: trace.correlation_id,
    causation_id: trace.causation_id,
    occurred_at_utc: trace.occurred_at_utc,
    emitted_at_utc: emittedAtUtc,
    received_at_utc: trace.received_at_utc,
    account: trace.account,
    instrument: trace.instrument,
    environment: trace.environment,
    execution_mode: trace.execution_mode,
    cursor: { kind: "content_hash", stream: FRONT_EVENTS_STREAMS.OPERATIONS, payload_hash: payloadHash, event_id: eventId, sequence: trace.sequence },
    trace,
    payload,
  };
}

export function buildFrontHeartbeatEvent({ emittedAtUtc = FRONT_EVENTS_SYSTEM_CLOCK.now().utc, lastEventId = null } = {}) {
  const trace = buildFrontEventTrace({
    eventId: null,
    eventType: "STREAM_HEARTBEAT",
    stream: FRONT_EVENTS_STREAMS.HEARTBEAT,
    emittedAtUtc,
    causationId: lastEventId || FRONT_EVENT_NOT_APPLICABLE,
  });
  return {
    schema_version: FRONT_EVENTS_CONTRACT_VERSION,
    event_type: "STREAM_HEARTBEAT",
    stream: FRONT_EVENTS_STREAMS.HEARTBEAT,
    sequence: trace.sequence,
    revision: trace.revision,
    aggregate_id: trace.aggregate_id,
    correlation_id: trace.correlation_id,
    causation_id: trace.causation_id,
    occurred_at_utc: trace.occurred_at_utc,
    emitted_at_utc: emittedAtUtc,
    received_at_utc: trace.received_at_utc,
    cursor: { kind: "heartbeat", stream: FRONT_EVENTS_STREAMS.OPERATIONS, last_event_id: lastEventId || null },
    trace,
  };
}

export function buildFrontErrorEvent(error, { emittedAtUtc = FRONT_EVENTS_SYSTEM_CLOCK.now().utc, lastEventId = null } = {}) {
  const trace = buildFrontEventTrace({
    eventId: null,
    eventType: "STREAM_ERROR",
    stream: FRONT_EVENTS_STREAMS.ERROR,
    emittedAtUtc,
    causationId: lastEventId || FRONT_EVENT_NOT_APPLICABLE,
  });
  return {
    schema_version: FRONT_EVENTS_CONTRACT_VERSION,
    event_type: "STREAM_ERROR",
    stream: FRONT_EVENTS_STREAMS.ERROR,
    sequence: trace.sequence,
    revision: trace.revision,
    aggregate_id: trace.aggregate_id,
    correlation_id: trace.correlation_id,
    causation_id: trace.causation_id,
    occurred_at_utc: trace.occurred_at_utc,
    emitted_at_utc: emittedAtUtc,
    received_at_utc: trace.received_at_utc,
    cursor: { kind: "error", stream: FRONT_EVENTS_STREAMS.OPERATIONS, last_event_id: lastEventId || null },
    trace,
    error: error?.message || String(error),
  };
}

export function shouldEmitFrontEvent(event, { lastEventId = null } = {}) {
  return Boolean(event?.event_id) && event.event_id !== lastEventId;
}

export function frontEventSseFrame(event) {
  const id = event.event_id ? `id: ${event.event_id}\n` : "";
  return `${id}event: ${event.stream}\ndata: ${JSON.stringify(event)}\n\n`;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildFrontEventTrace({
  eventId,
  eventType,
  stream,
  emittedAtUtc,
  receivedAtUtc = emittedAtUtc,
  occurredAtUtc = emittedAtUtc,
  sequence = FRONT_EVENT_UNKNOWN,
  revision = FRONT_EVENT_UNKNOWN,
  aggregateId = "front-operations",
  correlationId = FRONT_EVENT_UNKNOWN,
  causationId = FRONT_EVENT_NOT_APPLICABLE,
  account = FRONT_EVENT_NOT_APPLICABLE,
  instrument = FRONT_EVENT_NOT_APPLICABLE,
  environment = FRONT_EVENT_UNKNOWN,
  executionMode = FRONT_EVENT_UNKNOWN,
  payload = null,
} = {}) {
  return {
    event_id: clean(eventId, null),
    event_type: clean(eventType, FRONT_EVENT_UNKNOWN),
    stream: clean(stream, FRONT_EVENT_UNKNOWN),
    sequence: normalizeSequence(sequence),
    revision: clean(revisionFromPayload(payload, revision), FRONT_EVENT_UNKNOWN),
    aggregate_id: clean(aggregateIdFromPayload(payload, aggregateId), FRONT_EVENT_UNKNOWN),
    correlation_id: clean(correlationIdFromPayload(payload, correlationId), FRONT_EVENT_UNKNOWN),
    causation_id: clean(causationIdFromPayload(payload, causationId), FRONT_EVENT_NOT_APPLICABLE),
    occurred_at_utc: clean(occurredAtUtc, emittedAtUtc),
    emitted_at_utc: clean(emittedAtUtc, FRONT_EVENT_UNKNOWN),
    received_at_utc: clean(receivedAtUtc, emittedAtUtc),
    account: clean(accountFromPayload(payload, account), FRONT_EVENT_NOT_APPLICABLE),
    instrument: clean(instrumentFromPayload(payload, instrument), FRONT_EVENT_NOT_APPLICABLE),
    environment: clean(environmentFromPayload(payload, environment), FRONT_EVENT_UNKNOWN),
    execution_mode: clean(executionModeFromPayload(payload, executionMode), FRONT_EVENT_UNKNOWN),
  };
}

function clean(value, fallback) {
  if (value === null && fallback === null) return null;
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeSequence(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return FRONT_EVENT_UNKNOWN;
}

function revisionFromPayload(payload, fallback) {
  return payload?.revision || payload?.meta?.revision || payload?.summary?.revision || fallback;
}

function aggregateIdFromPayload(payload, fallback) {
  return payload?.aggregateId || payload?.aggregate_id || payload?.workflowId || payload?.runId || fallback;
}

function correlationIdFromPayload(payload, fallback) {
  return payload?.correlationId || payload?.correlation_id || payload?.meta?.correlationId || fallback;
}

function causationIdFromPayload(payload, fallback) {
  return payload?.causationId || payload?.causation_id || payload?.meta?.causationId || fallback;
}

function accountFromPayload(payload, fallback) {
  return payload?.account || payload?.accountId || payload?.account_id || payload?.summary?.account || fallback;
}

function instrumentFromPayload(payload, fallback) {
  return payload?.instrument || payload?.instrumentCode || payload?.instrument_code || payload?.summary?.instrument || fallback;
}

function environmentFromPayload(payload, fallback) {
  return payload?.environment || payload?.mode || payload?.summary?.environment || fallback;
}

function executionModeFromPayload(payload, fallback) {
  return payload?.executionMode || payload?.execution_mode || payload?.summary?.executionMode || fallback;
}
