import { randomUUID } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";

const STATUS_TO_SQL = Object.freeze({ PENDING: "pending", PUBLISHED: "published", CONSUMED: "consumed", FAILED: "failed", CANCELLED: "cancelled" });
const STATUS_FROM_SQL = Object.freeze(Object.fromEntries(Object.entries(STATUS_TO_SQL).map(([domain, sql]) => [sql, domain])));
const SIGNAL_BUS_REPOSITORY_CLOCK = new SystemClock();

export class PostgresStrategySignalBusRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.domainEvents = this.pool ? new DomainEventOutboxRepository(persistence) : null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("STRATEGY_SIGNAL_BUS_UNAVAILABLE", "Strategy Signal Bus repository is unavailable.");
    await this.persistence.initialized;
  }

  async publish(outbox) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await insertSignal(client, outbox);
      const saved = normalizeSignalOutboxRow(row);
      await appendSignalCreated(this.domainEvents, client, saved, outbox);
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pollPending({ limit = 100, now_utc = nowUtc() } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT * FROM strategy_signal_outbox
      WHERE status = 'pending' AND expires_at_utc > $1
      ORDER BY generated_at_utc ASC, created_at_utc ASC LIMIT $2`, [now_utc, bounded(limit)])
      .then((items) => items.map(normalizeSignalOutboxRow));
  }

  async listRecent({ limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT * FROM strategy_signal_outbox
      ORDER BY generated_at_utc DESC, created_at_utc DESC LIMIT $1`, [bounded(limit)])
      .then((items) => items.map(normalizeSignalOutboxRow));
  }

  async markConsumed({ signal_outbox_id, consumer_id = "strategy-signal-consumer", now_utc = nowUtc() } = {}) {
    await this.ready();
    return normalizeSignalOutboxRow(await one(this.pool, `UPDATE strategy_signal_outbox
      SET status = 'consumed', consumed_at_utc = COALESCE(consumed_at_utc, $2), consumer_id = $3, updated_at_utc = now()
      WHERE signal_outbox_id = $1 AND status IN ('pending', 'published') RETURNING *`, [signal_outbox_id, now_utc, consumer_id]));
  }
}

async function insertSignal(client, outbox) {
  return one(client, `INSERT INTO strategy_signal_outbox (
    signal_outbox_id, signal_id, strategy_instance_id, strategy_version_id, signal_type,
    instrument, direction, confidence, execution_mode_origin, generated_at_utc, expires_at_utc,
    correlation_id, payload, payload_hash, dedupe_key, status,
    strategy_definition_id, timeframe, session, source_data_cutoff_utc,
    setup, predicates, evidence, reason_codes, signal_quality,
    proposed_trade_plan, trade_plan_economics, availability, source_class, certification_run_id
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::strategy_instance_execution_mode,$10,$11,$12,$13::jsonb,$14,$15,$16::strategy_signal_outbox_status,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25::jsonb,$26::jsonb,$27::jsonb,$28,$29,$30)
  ON CONFLICT (dedupe_key) DO UPDATE SET signal_outbox_id = strategy_signal_outbox.signal_outbox_id RETURNING *`, [
    outbox.signal_outbox_id || randomUUID(), outbox.signal_id, outbox.strategy_instance_id, outbox.strategy_version_id || null,
    outbox.signal_type || "signal.emitted", outbox.instrument, outbox.direction, outbox.confidence,
    String(outbox.execution_mode_origin || "SHADOW").toLowerCase(), outbox.generated_at_utc, outbox.expires_at_utc,
    outbox.correlation_id, JSON.stringify(outbox.payload || {}), outbox.payload_hash, outbox.dedupe_key,
    toSqlStatus(outbox.status || "PENDING"), outbox.strategy_definition_id || null, outbox.timeframe || null,
    outbox.session || null, outbox.source_data_cutoff_utc || null, JSON.stringify(outbox.setup || null),
    JSON.stringify(outbox.predicates || null), JSON.stringify(outbox.evidence || null), array(outbox.reason_codes),
    JSON.stringify(outbox.signal_quality || null), JSON.stringify(outbox.proposed_trade_plan || null),
    JSON.stringify(outbox.trade_plan_economics || null), outbox.availability || null, outbox.source_class || "LIVE",
    outbox.certification_run_id || null,
  ]);
}

async function appendSignalCreated(events, client, saved, outbox) {
  return events.append({
    aggregateId: saved.signal_id, aggregateType: "strategy_signal", eventType: "strategy.signal.created",
    occurredAt: saved.generated_at_utc, correlationId: saved.correlation_id,
    causationId: outbox.causation_id || saved.payload?.strategy_evaluation_id || saved.payload?.evaluation_id || null,
    source: "strategy-signal-bus",
    payload: { signalId: saved.signal_id, strategyDefinitionId: saved.strategy_definition_id, strategyVersionId: saved.strategy_version_id, strategyInstanceId: saved.strategy_instance_id, instrument: saved.instrument, direction: saved.direction, sourceClass: saved.source_class, certificationRunId: saved.certification_run_id, sourceDataCutoff: saved.source_data_cutoff_utc },
  }, client);
}

export class InMemoryStrategySignalBusRepository {
  constructor() {
    this.outbox = new Map();
    this.dedupe = new Map();
  }

  async publish(outbox) {
    const dedupeKey = outbox.dedupe_key;
    if (this.dedupe.has(dedupeKey)) return clone(this.outbox.get(this.dedupe.get(dedupeKey)));
    const saved = normalizeSignalOutboxRow({
      ...outbox,
      signal_outbox_id: outbox.signal_outbox_id || randomUUID(),
      status: toSqlStatus(outbox.status || "PENDING"),
      created_at_utc: outbox.created_at_utc || nowUtc(),
      updated_at_utc: outbox.updated_at_utc || nowUtc(),
    });
    this.outbox.set(saved.signal_outbox_id, saved);
    this.dedupe.set(saved.dedupe_key, saved.signal_outbox_id);
    return clone(saved);
  }

  async pollPending({ limit = 100, now_utc = nowUtc() } = {}) {
    return [...this.outbox.values()]
      .filter((item) => item.status === "PENDING" && Date.parse(item.expires_at_utc) > Date.parse(now_utc))
      .sort((left, right) => Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc))
      .slice(0, bounded(limit))
      .map(clone);
  }

  async listRecent({ limit = 100 } = {}) {
    return [...this.outbox.values()]
      .sort((left, right) => Date.parse(right.generated_at_utc) - Date.parse(left.generated_at_utc))
      .slice(0, bounded(limit))
      .map(clone);
  }

  async markConsumed({ signal_outbox_id, consumer_id = "strategy-signal-consumer", now_utc = nowUtc() } = {}) {
    const current = this.outbox.get(signal_outbox_id);
    if (!current || !["PENDING", "PUBLISHED"].includes(current.status)) return null;
    const next = { ...current, status: "CONSUMED", consumed_at_utc: now_utc, consumer_id, updated_at_utc: now_utc };
    this.outbox.set(signal_outbox_id, next);
    return clone(next);
  }
}

export function createStrategySignalBusRepository(persistence) {
  return persistence?.pool ? new PostgresStrategySignalBusRepository(persistence) : new InMemoryStrategySignalBusRepository();
}

export function normalizeSignalOutboxRow(row) {
  if (!row) return null;
  return {
    ...signalIdentity(row),
    ...signalPayload(row),
    ...signalDelivery(row),
  };
}

function signalIdentity(row) {
  return {
    signal_outbox_id: row.signal_outbox_id,
    signal_id: row.signal_id,
    strategy_instance_id: row.strategy_instance_id,
    strategy_version_id: row.strategy_version_id || null,
    signal_type: row.signal_type || "signal.emitted",
    instrument: row.instrument,
    direction: row.direction,
    proposed_size: numberOrNull(firstDefined(
      row.proposed_size,
      row.payload?.payload?.proposed_size,
      row.payload?.signal?.proposed_size,
      row.payload?.proposed_size,
    )),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    execution_mode_origin: String(row.execution_mode_origin || "SHADOW").toUpperCase(),
    generated_at_utc: iso(row.generated_at_utc),
    expires_at_utc: iso(row.expires_at_utc),
    correlation_id: row.correlation_id,
    strategy_definition_id: row.strategy_definition_id || null,
    timeframe: row.timeframe || null,
    session: row.session || null,
    source_data_cutoff_utc: iso(row.source_data_cutoff_utc),
  };
}

function signalPayload(row) {
  return {
    payload: row.payload || {},
    setup: row.setup || null,
    predicates: row.predicates || null,
    evidence: row.evidence || null,
    reason_codes: row.reason_codes || [],
    signal_quality: row.signal_quality || null,
    proposed_trade_plan: row.proposed_trade_plan || null,
    trade_plan_economics: row.trade_plan_economics || null,
    availability: row.availability || null,
    source_class: row.source_class || "LIVE",
    certification_run_id: row.certification_run_id || null,
  };
}

function signalDelivery(row) {
  return {
    payload_hash: row.payload_hash,
    dedupe_key: row.dedupe_key,
    status: fromSqlStatus(row.status),
    notify_attempt_count: Number(row.notify_attempt_count || 0),
    published_at_utc: iso(row.published_at_utc),
    consumed_at_utc: iso(row.consumed_at_utc),
    consumer_id: row.consumer_id || null,
    last_error: row.last_error || null,
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

function toSqlStatus(value) { return STATUS_TO_SQL[String(value || "").toUpperCase()] || value; }
function fromSqlStatus(value) { return STATUS_FROM_SQL[String(value || "").toLowerCase()] || value; }
async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}
function iso(value) { return value ? new Date(value).toISOString() : null; }
function clone(value) { return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value)); }
function array(value) { return Array.isArray(value) ? value : []; }
function nowUtc() { return SIGNAL_BUS_REPOSITORY_CLOCK.now().utc; }
function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}
function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function repositoryError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 503;
  return error;
}
