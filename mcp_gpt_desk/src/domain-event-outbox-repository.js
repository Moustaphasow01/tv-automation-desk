import { canonicalSha256 } from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";

const DOMAIN_EVENT_CLOCK = new SystemClock();

export class DomainEventOutboxRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw coded("DOMAIN_EVENT_OUTBOX_UNAVAILABLE", "Domain event outbox is unavailable.");
    await this.persistence.initialized;
  }

  async append(input = {}, client = this.pool) {
    await this.ready();
    const record = normalizeDomainEvent(input);
    const existing = await client.query(
      "SELECT * FROM domain_event_outbox WHERE domain_event_id = $1",
      [record.domain_event_id],
    );
    if (existing.rows[0]) return { status: "IDEMPOTENT", event: mapEvent(existing.rows[0]) };
    const sequence = record.aggregate_sequence || await nextSequence(client, record);
    const inserted = await client.query(`INSERT INTO domain_event_outbox (
        domain_event_id, aggregate_id, aggregate_type, aggregate_sequence, event_type,
        revision, occurred_at_utc, received_at_utc, source, correlation_id,
        causation_id, schema_version, payload_hash, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
      ON CONFLICT (domain_event_id) DO UPDATE SET domain_event_id = domain_event_outbox.domain_event_id
      RETURNING *`, [
      record.domain_event_id, record.aggregate_id, record.aggregate_type, sequence,
      record.event_type, record.revision, record.occurred_at_utc, record.received_at_utc,
      record.source, record.correlation_id, record.causation_id, record.schema_version,
      record.payload_hash, JSON.stringify(record.payload),
    ]);
    return {
      status: "APPENDED",
      event: mapEvent(inserted.rows[0] || { ...record, aggregate_sequence: sequence }),
    };
  }

  async listAfter({ cursor = "", limit = 100 } = {}) {
    await this.ready();
    let checkpoint = null;
    const requestedCursor = String(cursor || "").trim();
    if (requestedCursor) {
      if (requestedCursor === "front_checkpoint_empty") {
        const checkpointNow = await currentCheckpoint(this.pool);
        if (!checkpointNow) return { events: [], resyncRequired: false, checkpoint: null };
        return { events: [], resyncRequired: true, checkpoint: checkpointNow };
      }
      const found = await this.pool.query(
        "SELECT created_at_utc, domain_event_id FROM domain_event_outbox WHERE domain_event_id = $1",
        [requestedCursor],
      );
      checkpoint = found.rows[0] || null;
      if (!checkpoint) return { events: [], resyncRequired: true, checkpoint: await currentCheckpoint(this.pool) };
    } else {
      return {
        events: [],
        resyncRequired: false,
        initialSnapshotRequired: true,
        checkpoint: await currentCheckpoint(this.pool),
      };
    }
    const result = await this.pool.query(`SELECT * FROM domain_event_outbox
      WHERE ($1::timestamptz IS NULL OR (created_at_utc, domain_event_id) > ($1, $2))
      ORDER BY created_at_utc, domain_event_id
      LIMIT $3`, [checkpoint?.created_at_utc || null, checkpoint?.domain_event_id || "", bounded(limit)]);
    return { events: result.rows.map(mapEvent), resyncRequired: false, checkpoint: await currentCheckpoint(this.pool) };
  }
}

async function currentCheckpoint(pool) {
  const result = await pool.query(`SELECT domain_event_id, created_at_utc
    FROM domain_event_outbox ORDER BY created_at_utc DESC, domain_event_id DESC LIMIT 1`);
  return result.rows[0]?.domain_event_id || null;
}

function normalizeDomainEvent(input) {
  const payload = objectValue(input.payload);
  const clockNow = DOMAIN_EVENT_CLOCK.now().utc;
  const occurredAt = iso(firstValue(input.occurred_at_utc, input.occurredAt, clockNow));
  const identity = {
    aggregate_id: required(firstValue(input.aggregate_id, input.aggregateId), "DOMAIN_EVENT_AGGREGATE_ID_REQUIRED"),
    aggregate_type: required(firstValue(input.aggregate_type, input.aggregateType), "DOMAIN_EVENT_AGGREGATE_TYPE_REQUIRED"),
    event_type: required(firstValue(input.event_type, input.eventType), "DOMAIN_EVENT_TYPE_REQUIRED"),
    correlation_id: required(firstValue(input.correlation_id, input.correlationId), "DOMAIN_EVENT_CORRELATION_ID_REQUIRED"),
    occurred_at_utc: occurredAt,
    payload,
  };
  return {
    domain_event_id: String(firstValue(input.domain_event_id, input.eventId, `domain_evt_${canonicalSha256(identity).slice(0, 24)}`)),
    ...identity,
    aggregate_sequence: positiveInteger(firstValue(input.aggregate_sequence, input.sequence)),
    revision: positiveInteger(input.revision) || 1,
    received_at_utc: iso(firstValue(input.received_at_utc, input.receivedAt, clockNow)),
    source: String(firstValue(input.source, "desk-domain-runtime")),
    causation_id: nullable(firstValue(input.causation_id, input.causationId)),
    schema_version: String(firstValue(input.schema_version, input.schemaVersion, "1.0.0")),
    payload_hash: `sha256:${canonicalSha256(payload)}`,
  };
}

function firstValue(...values) { return values.find((value) => value !== null && value !== undefined && value !== ""); }
function objectValue(value) { return value && typeof value === "object" ? value : {}; }

async function nextSequence(client, record) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`domain-event:${record.aggregate_type}:${record.aggregate_id}`]);
  const result = await client.query(`SELECT COALESCE(MAX(aggregate_sequence),0)+1 AS next
    FROM domain_event_outbox WHERE aggregate_type=$1 AND aggregate_id=$2`, [record.aggregate_type, record.aggregate_id]);
  return Number(result.rows[0]?.next || 1);
}

function mapEvent(row = {}) {
  return {
    eventId: row.domain_event_id,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at_utc),
    receivedAt: iso(row.received_at_utc),
    source: row.source,
    correlationId: row.correlation_id,
    causationId: row.causation_id || undefined,
    schemaVersion: row.schema_version,
    sequence: Number(row.aggregate_sequence),
    revision: Number(row.revision || 1),
    payload: row.payload || {},
  };
}

function bounded(value) { return Math.max(1, Math.min(500, Math.trunc(Number(value) || 100))); }
function positiveInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function nullable(value) { const result = String(value ?? "").trim(); return result || null; }
function required(value, code) { const result = nullable(value); if (result) return result; throw coded(code, code); }
function iso(value) { const parsed = Date.parse(value || ""); if (!Number.isFinite(parsed)) throw coded("DOMAIN_EVENT_TIMESTAMP_INVALID", "Domain event timestamp is invalid."); return new Date(parsed).toISOString(); }
function coded(code, message) { const error = new Error(message || code); error.code = code; return error; }
