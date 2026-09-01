import { currentTick, currentUtc, hash } from "./front-control-plane-common.js";

export function writeFrontControlPlaneEvents(store, req, res, input = {}, corsHeaders = {}) {
  let lastEventId = String(input.cursor || input.last_event_id || req.headers["last-event-id"] || "");
  let closed = false, busy = false;

  res.writeHead(200, {
    ...corsHeaders,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const emit = async () => {
    if (closed || res.writableEnded || busy) return;
    busy = true;
    try {
      const events = await loadFrontControlPlaneRealtimeEvents(store, { cursor: lastEventId, limit: 25 });
      if (events.length) {
        for (const event of events) {
          res.write(frontControlPlaneSseFrame(event));
          lastEventId = event.eventType === "desk.resync_required" ? "" : event.eventId;
        }
      } else {
        res.write(`: heartbeat ${currentTick(input.clock).utc}\n\n`);
      }
    } catch (error) {
      res.write(frontControlPlaneSseFrame(errorEvent({ error, input, lastEventId })));
    } finally {
      busy = false;
    }
  };

  emit();
  const timer = setInterval(emit, 5_000);
  timer.unref?.();
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
}

export async function loadFrontControlPlaneRealtimeEvents(store, { cursor = "", limit = 25 } = {}) {
  if (typeof store?.listFrontRealtimeEvents === "function") {
    const result = await store.listFrontRealtimeEvents({ cursor, limit });
    return normalizeRealtimeResult(result, { cursor });
  }
  const pool = store?.persistence?.pool;
  if (!pool) return [];
  let checkpointSequence = 0;
  if (String(cursor || "").trim()) {
    const checkpoint = await pool.query(`
    WITH ordered AS (
      SELECT o.assistant_outbox_id,
             o.assistant_event_id,
             o.created_at_utc,
             row_number() OVER (ORDER BY o.created_at_utc, o.assistant_outbox_id)::int AS sequence
        FROM assistant_outbox o
        LEFT JOIN assistant_events e ON e.assistant_event_id = o.assistant_event_id
       WHERE o.channel = 'FRONT_REALTIME'
    )
    SELECT sequence
      FROM ordered
     WHERE assistant_event_id = $1 OR assistant_outbox_id = $1
     ORDER BY sequence DESC
     LIMIT 1`, [String(cursor || "")]);
    if (!checkpoint.rows.length) return [resyncRequiredEvent({ cursor })];
    checkpointSequence = Number(checkpoint.rows[0].sequence || 0);
  }
  const result = await pool.query(`
    WITH ordered AS (
      SELECT o.assistant_outbox_id,
             o.assistant_event_id,
             o.payload,
             o.created_at_utc,
             e.event_type,
             e.assistant_profile_id,
             e.assistant_conversation_id,
             e.assistant_task_id,
             row_number() OVER (ORDER BY o.created_at_utc, o.assistant_outbox_id)::int AS sequence
        FROM assistant_outbox o
        LEFT JOIN assistant_events e ON e.assistant_event_id = o.assistant_event_id
       WHERE o.channel = 'FRONT_REALTIME'
    )
    SELECT *
      FROM ordered
     WHERE sequence > $1::int
     ORDER BY sequence
     LIMIT $2::int`, [checkpointSequence, Math.max(1, Math.min(100, Number(limit) || 25))]);
  return normalizeRealtimeResult(result.rows.map(frontAssistantOutboxRowToEvent), { cursor });
}

export function frontControlPlaneSseFrame(event) {
  return `id: ${event.eventId}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`;
}

function errorEvent({ error, input, lastEventId }) {
  const errorTick = currentTick(input.clock);
  return {
    eventId: `evt_front_control_plane_error_${hash(`${errorTick.utc}:${lastEventId}`).slice(0, 16)}`,
    eventType: "incident.created",
    occurredAt: errorTick.utc,
    correlationId: lastEventId || `corr_front_control_plane_${hash(errorTick.utc).slice(0, 12)}`,
    schemaVersion: "1.0.0",
    payload: { source: "front-control-plane-bff", error: String(error?.message || error).slice(0, 500) },
  };
}

function resyncRequiredEvent({ cursor, checkpoint = null }) {
  const occurredAt = currentUtc();
  return {
    eventId: `evt_front_control_plane_resync_${hash(`${cursor}:${occurredAt}`).slice(0, 16)}`,
    aggregateId: "front-control-plane",
    aggregateType: "front_realtime_stream",
    eventType: "desk.resync_required",
    occurredAt,
    receivedAt: occurredAt,
    source: "front-control-plane-bff",
    correlationId: `corr_front_control_plane_resync_${hash(String(cursor || "")).slice(0, 12)}`,
    causationId: valueOrNull(cursor),
    schemaVersion: "1.0.0",
    sequence: 0,
    payload: {
      reason: "CURSOR_NOT_FOUND_OR_EXPIRED",
      requestedCursor: String(cursor || ""),
      checkpoint,
      action: "REFETCH_SNAPSHOT_THEN_RESUBSCRIBE",
      brokerExecution: false,
      orderSubmissionEnabled: false,
    },
  };
}

function normalizeRealtimeResult(result, { cursor }) {
  const events = Array.isArray(result) ? result : Array.isArray(result?.events) ? result.events : [];
  if (!events.length) {
    if (result?.resyncRequired === true || result?.resync_required === true) {
      return [resyncRequiredEvent({ cursor, checkpoint: result?.checkpoint || null })];
    }
    if (result?.initialSnapshotRequired === true || result?.initial_snapshot_required === true) {
      return [snapshotCheckpointEvent({ checkpoint: result?.checkpoint || null })];
    }
    return [];
  }
  const seen = new Set();
  return events.filter((event) => {
      const key = firstText([event?.eventId, event?.event_id]);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function snapshotCheckpointEvent({ checkpoint }) {
  const occurredAt = currentUtc();
  const stableCheckpoint = String(checkpoint || "front_checkpoint_empty");
  return {
    eventId: stableCheckpoint,
    aggregateId: "live-focus",
    aggregateType: "front_snapshot",
    eventType: "desk.snapshot.updated",
    occurredAt,
    receivedAt: occurredAt,
    source: "front-control-plane-bff",
    correlationId: `corr_front_snapshot_${hash(stableCheckpoint).slice(0, 12)}`,
    schemaVersion: "1.0.0",
    sequence: 0,
    revision: 1,
    payload: {
      freshness: "initial",
      checkpoint: checkpoint || null,
      action: "REFETCH_CANONICAL_SNAPSHOT",
      brokerExecution: false,
      orderSubmissionEnabled: false,
    },
  };
}

function frontAssistantOutboxRowToEvent(row) {
  const payload = object(row.payload);
  const ids = assistantEventIds(row, payload);
  const sourceEventType = firstText([row.event_type, payload.event_type]).toUpperCase();
  return {
    eventId: ids.eventId,
    aggregateId: ids.conversationId,
    aggregateType: "assistant_conversation",
    eventType: frontEventType(sourceEventType),
    occurredAt: iso(row.created_at_utc),
    receivedAt: currentUtc(),
    source: "domain-assistant-runtime",
    correlationId: ids.correlationId,
    causationId: ids.taskId,
    schemaVersion: "1.0.0",
    sequence: Number(row.sequence || 0),
    payload: {
      assistantProfileId: valueOrNull(firstText([row.assistant_profile_id, payload.assistant_profile_id])),
      conversationId: valueOrNull(ids.conversationId),
      taskId: valueOrNull(ids.taskId),
      answerMessageId: valueOrNull(payload.answer_message_id),
      sourceEventType: valueOrNull(sourceEventType),
      brokerExecution: false,
      orderSubmissionEnabled: false,
    },
  };
}

function assistantEventIds(row, payload) {
  const eventId = firstText([row.assistant_event_id, row.assistant_outbox_id]);
  const taskId = firstText([row.assistant_task_id, payload.task_id]);
  return {
    eventId,
    taskId,
    conversationId: firstText([row.assistant_conversation_id, payload.conversation_id], "jarvis"),
    correlationId: firstText([taskId, row.assistant_outbox_id]),
  };
}

function frontEventType(sourceEventType) {
  if (sourceEventType === "ANSWER_PERSISTED") return "jarvis.message.created";
  return "desk.snapshot.updated";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstText(values, fallback = "") {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return fallback;
}

function valueOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function iso(value) {
  if (!value) return currentUtc();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
