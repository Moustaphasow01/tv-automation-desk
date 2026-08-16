import {
  activeProviderStatuses,
  clone,
  DEFAULT_REPOSITORY_NOW_UTC,
  json,
  one,
  repositoryError,
  text,
} from "./portfolio-order-intent-execution-repository-common.js";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";

export class PostgresProviderLifecycleRepository {
  constructor(repository) {
    this.repository = repository;
    this.domainEvents = repository?.persistence ? new DomainEventOutboxRepository(repository.persistence) : null;
  }

  get pool() { return this.repository.pool; }
  async ready() { return this.repository.ready(); }

  async claimProviderCommand({ providerId = null, accountId = null, dispatcherId, leaseToken, leaseSeconds = 30, nowUtc } = {}) {
    await this.ready();
    const result = await this.pool.query(
      `WITH next_command AS (
        SELECT execution_provider_command_id
        FROM broker_provider_commands
        WHERE (status = 'pending' OR (status = 'leased' AND lease_expires_at < now()))
          AND available_at <= now()
          AND ($1::text IS NULL OR broker_provider_code = $1)
          AND ($2::text IS NULL OR broker_account_id = $2)
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE broker_provider_commands c SET
        status = 'leased',
        adapter_id = COALESCE(c.adapter_id, $3),
        lease_token = $4,
        lease_expires_at = now() + make_interval(secs => $5),
        attempt_count = attempt_count + 1,
        updated_at = now()
      FROM next_command
      WHERE c.execution_provider_command_id = next_command.execution_provider_command_id
      RETURNING c.*`,
      [text(providerId) || null, text(accountId) || null, text(dispatcherId || "provider-dispatcher"),
        leaseToken, Math.max(5, Math.min(Number(leaseSeconds) || 30, 600))],
    );
    const command = result.rows[0] || null;
    if (command?.portfolio_order_intent_id) await upsertExecutionStateWithClient(this.pool, {
      portfolioOrderIntentId: command.portfolio_order_intent_id,
      commandId: command.execution_provider_command_id,
      status: "LEASED",
      payload: { leased_at_utc: nowUtc, dispatcher_id: dispatcherId || null },
    });
    return command;
  }

  async completeProviderDispatch({ commandId, leaseToken, dispatcherId = null, status, providerOrderRef = null, error = null, nowUtc } = {}) {
    await this.ready();
    const normalizedStatus = toSqlProviderCommandStatus(status);
    const result = await this.pool.query(
      `UPDATE broker_provider_commands SET
        status = $3::execution_provider_command_status,
        adapter_id = COALESCE(adapter_id, $4),
        sent_at = CASE WHEN $3 IN ('sent','acknowledged') THEN COALESCE(sent_at, $5) ELSE sent_at END,
        acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN COALESCE(acknowledged_at, $5) ELSE acknowledged_at END,
        last_error = $6,
        lease_token = CASE WHEN $3 IN ('unknown','reconciliation_required') THEN lease_token ELSE NULL END,
        lease_expires_at = CASE WHEN $3 IN ('unknown','reconciliation_required') THEN lease_expires_at ELSE NULL END,
        payload = payload || $7::jsonb,
        updated_at = now()
       WHERE execution_provider_command_id = $1
         AND ($2::text IS NULL OR lease_token = $2)
       RETURNING *`,
      [text(commandId), text(leaseToken) || null, normalizedStatus, text(dispatcherId) || null, nowUtc, error || null,
        json({ provider_order_ref: providerOrderRef || null, dispatch_completed_at_utc: nowUtc })],
    );
    if (!result.rows[0]) throw repositoryError("PROVIDER_COMMAND_LEASE_CONFLICT", "The provider command lease is no longer valid.");
    const command = result.rows[0];
    if (command.portfolio_order_intent_id) await upsertExecutionStateWithClient(this.pool, {
      portfolioOrderIntentId: command.portfolio_order_intent_id,
      commandId: command.execution_provider_command_id,
      status: lifecycleStatusForCommandStatus(normalizedStatus),
      providerOrderRef,
      payload: { dispatch_status: normalizedStatus, error },
    });
    return command;
  }

  async recordBrokerProviderEvent({ event, nowUtc } = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const command = event.execution_provider_command_id
        ? await one(client, "SELECT * FROM broker_provider_commands WHERE execution_provider_command_id = $1 FOR UPDATE", [event.execution_provider_command_id])
        : null;
      const portfolioOrderIntentId = text(event.portfolio_order_intent_id || command?.portfolio_order_intent_id) || null;
      const duplicate = await one(client, "SELECT * FROM broker_provider_events WHERE external_event_key = $1", [event.external_event_key]);
      if (duplicate) {
        await client.query("COMMIT");
        return { status: "DUPLICATE", event: duplicate, command };
      }
      const inserted = await insertProviderEvent(client, { event, command, portfolioOrderIntentId });
      if (command) await updateCommandFromProviderEvent(client, { command, event, nowUtc });
      if (portfolioOrderIntentId) await upsertExecutionStateWithClient(client, {
        portfolioOrderIntentId,
        commandId: event.execution_provider_command_id || command?.execution_provider_command_id || null,
        event,
      });
      if (this.domainEvents) await appendProviderEvent(this.domainEvents, client, { inserted, event, command, portfolioOrderIntentId, nowUtc });
      await client.query("COMMIT");
      return { status: "RECORDED", event: inserted, command };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertProviderEvent(client, { event, command, portfolioOrderIntentId }) {
  return one(client, `INSERT INTO broker_provider_events (
    broker_provider_event_id, execution_provider_command_id, order_intent_id, portfolio_order_intent_id,
    broker_provider_code, broker_account_id, broker_contract_id, external_event_key, event_type,
    provider_order_ref, event_status, side, quantity, fill_quantity, fill_price, position_size,
    occurred_at, payload_hash, payload, raw
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::broker_provider_event_type,$10,$11,$12::order_side,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb) RETURNING *`, [
    event.broker_provider_event_id, event.execution_provider_command_id || null,
    event.order_intent_id || command?.order_intent_id || null, portfolioOrderIntentId,
    event.provider_id || command?.broker_provider_code, event.account_id || command?.broker_account_id || null,
    command?.broker_contract_id || null, event.external_event_key, toSqlEventType(event.event_type),
    event.provider_order_ref || null, event.order_status || null, toSqlSide(event.side), event.quantity,
    event.fill_quantity, event.fill_price, event.position_size, event.occurred_at_utc, event.payload_hash,
    json(event.payload), json(event),
  ]);
}

async function appendProviderEvent(events, client, { inserted, event, command, portfolioOrderIntentId, nowUtc }) {
  return events.append({
    aggregateId: inserted.broker_provider_event_id, aggregateType: "provider_event", eventType: "provider.event.received",
    occurredAt: event.occurred_at_utc || nowUtc,
    correlationId: event.correlation_id || command?.payload?.correlation_id || command?.portfolio_order_intent_id || inserted.broker_provider_event_id,
    causationId: event.execution_provider_command_id || command?.execution_provider_command_id || null, source: "provider-lifecycle",
    payload: { providerEventId: inserted.broker_provider_event_id, providerCommandId: event.execution_provider_command_id || command?.execution_provider_command_id || null, orderIntentId: portfolioOrderIntentId, providerCode: inserted.broker_provider_code, eventType: String(event.event_type || "").toUpperCase(), eventStatus: event.order_status || null, fillQuantity: event.fill_quantity ?? null, fillPrice: event.fill_price ?? null },
  }, client);
}

export class InMemoryProviderLifecycleRepository {
  constructor(repository) {
    this.repository = repository;
  }

  async claimProviderCommand({ providerId = null, accountId = null, dispatcherId, leaseToken, leaseSeconds = 30, nowUtc } = {}) {
    const nowMs = Date.parse(nowUtc || DEFAULT_REPOSITORY_NOW_UTC);
    const command = [...this.repository.providerCommands.values()]
      .filter((item) => item.status === "pending" || (item.status === "leased" && Date.parse(item.lease_expires_at || "") < nowMs))
      .filter((item) => !providerId || item.broker_provider_code === providerId)
      .filter((item) => !accountId || item.broker_account_id === accountId)
      .sort((a, b) => Date.parse(a.created_at || a.available_at || 0) - Date.parse(b.created_at || b.available_at || 0))[0];
    if (!command) return null;
    const leased = {
      ...command,
      status: "leased",
      adapter_id: command.adapter_id || text(dispatcherId || "provider-dispatcher"),
      lease_token: leaseToken,
      lease_expires_at: new Date(nowMs + Math.max(5, Math.min(Number(leaseSeconds) || 30, 600)) * 1000).toISOString(),
      attempt_count: Number(command.attempt_count || 0) + 1,
      updated_at: nowUtc,
    };
    this.repository.providerCommands.set(leased.execution_provider_command_id, clone(leased));
    upsertState(this.repository, { portfolioOrderIntentId: leased.portfolio_order_intent_id, commandId: leased.execution_provider_command_id, status: "LEASED", payload: { leased_at_utc: nowUtc, dispatcher_id: dispatcherId || null } });
    return clone(leased);
  }

  async completeProviderDispatch({ commandId, leaseToken, dispatcherId = null, status, providerOrderRef = null, error = null, nowUtc } = {}) {
    const id = text(commandId);
    const current = this.repository.providerCommands.get(id);
    if (!current || (leaseToken && current.lease_token !== leaseToken)) throw repositoryError("PROVIDER_COMMAND_LEASE_CONFLICT", "The provider command lease is no longer valid.");
    const normalizedStatus = toSqlProviderCommandStatus(status);
    const updated = {
      ...current,
      status: normalizedStatus,
      adapter_id: current.adapter_id || text(dispatcherId),
      sent_at: ["sent", "acknowledged"].includes(normalizedStatus) ? (current.sent_at || nowUtc) : current.sent_at,
      acknowledged_at: normalizedStatus === "acknowledged" ? (current.acknowledged_at || nowUtc) : current.acknowledged_at,
      lease_token: ["unknown", "reconciliation_required"].includes(normalizedStatus) ? current.lease_token : null,
      lease_expires_at: ["unknown", "reconciliation_required"].includes(normalizedStatus) ? current.lease_expires_at : null,
      last_error: error || null,
      payload: { ...(current.payload || {}), provider_order_ref: providerOrderRef || null, dispatch_completed_at_utc: nowUtc },
      updated_at: nowUtc,
    };
    this.repository.providerCommands.set(id, clone(updated));
    upsertState(this.repository, { portfolioOrderIntentId: updated.portfolio_order_intent_id, commandId: id, status: lifecycleStatusForCommandStatus(normalizedStatus), providerOrderRef, payload: { dispatch_status: normalizedStatus, error } });
    return clone(updated);
  }

  async recordBrokerProviderEvent({ event, nowUtc } = {}) {
    const key = text(event.external_event_key);
    const command = event.execution_provider_command_id ? this.repository.providerCommands.get(event.execution_provider_command_id) : null;
    if (this.repository.providerEvents.has(key)) return { status: "DUPLICATE", event: clone(this.repository.providerEvents.get(key)), command: clone(command) };
    const portfolioOrderIntentId = text(event.portfolio_order_intent_id || command?.portfolio_order_intent_id) || null;
    const stored = {
      broker_provider_event_id: event.broker_provider_event_id,
      execution_provider_command_id: event.execution_provider_command_id || null,
      order_intent_id: event.order_intent_id || command?.order_intent_id || null,
      portfolio_order_intent_id: portfolioOrderIntentId,
      broker_provider_code: event.provider_id || command?.broker_provider_code || "provider-neutral",
      broker_account_id: event.account_id || command?.broker_account_id || null,
      broker_contract_id: command?.broker_contract_id || null,
      external_event_key: key,
      event_type: toSqlEventType(event.event_type),
      provider_order_ref: event.provider_order_ref || null,
      event_status: event.order_status || null,
      side: toSqlSide(event.side),
      quantity: event.quantity,
      fill_quantity: event.fill_quantity,
      fill_price: event.fill_price,
      position_size: event.position_size,
      occurred_at: event.occurred_at_utc,
      payload_hash: event.payload_hash,
      payload: event.payload,
      raw: event,
      created_at: nowUtc,
    };
    this.repository.providerEvents.set(key, clone(stored));
    if (command) updateCommandFromInMemoryProviderEvent(this.repository, { command, event, nowUtc });
    if (portfolioOrderIntentId) upsertStateFromEvent(this.repository, { portfolioOrderIntentId, commandId: event.execution_provider_command_id || command?.execution_provider_command_id || null, event });
    return { status: "RECORDED", event: clone(stored), command: clone(command) };
  }
}

export function toSqlProviderCommandStatus(value) {
  const normalized = String(value || "").toLowerCase();
  const aliases = new Map([
    ["timeout", "unknown"],
    ["communication_lost", "unknown"],
    ["reconciliation", "reconciliation_required"],
  ]);
  const mapped = aliases.get(normalized) || normalized;
  if (!["pending", "leased", "sent", "acknowledged", "failed", "cancelled", "expired", "blocked", "unknown", "reconciliation_required"].includes(mapped)) {
    throw repositoryError("PROVIDER_COMMAND_STATUS_INVALID", `Invalid provider command status: ${value}.`);
  }
  return mapped;
}

function toSqlEventType(value) { return String(value || "").toLowerCase(); }

function toSqlSide(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "buy" || normalized === "sell") return normalized;
  if (normalized === "long") return "buy";
  if (normalized === "short") return "sell";
  return null;
}

function lifecycleStatusForCommandStatus(status) {
  return ({
    pending: "PROVIDER_COMMAND_READY",
    leased: "LEASED",
    sent: "SENT",
    acknowledged: "ACKNOWLEDGED",
    failed: "REJECTED",
    cancelled: "CANCELLED",
    expired: "EXPIRED",
    unknown: "UNKNOWN",
    reconciliation_required: "RECONCILIATION_REQUIRED",
    blocked: "BLOCKED",
  })[String(status || "").toLowerCase()] || "UNKNOWN";
}

function lifecycleStatusForProviderEvent(event) {
  return ({
    ORDER_ACCEPTED: "ACKNOWLEDGED",
    ORDER_WORKING: "ACKNOWLEDGED",
    ORDER_PARTIALLY_FILLED: "PARTIALLY_FILLED",
    ORDER_FILLED: "FILLED",
    ORDER_REJECTED: "REJECTED",
    ORDER_CANCELLED: "CANCELLED",
    PROVIDER_ERROR: "RECONCILIATION_REQUIRED",
  })[String(event.event_type || "").toUpperCase()] || "UNKNOWN";
}

function commandStatusForProviderEvent(event) {
  const eventType = String(event.event_type || "").toUpperCase();
  if (eventType === "ORDER_REJECTED") return "failed";
  if (eventType === "PROVIDER_ERROR") return "unknown";
  if (["ORDER_ACCEPTED", "ORDER_WORKING", "ORDER_PARTIALLY_FILLED", "ORDER_FILLED"].includes(eventType)) return "acknowledged";
  if (eventType === "ORDER_CANCELLED") return "cancelled";
  return "acknowledged";
}

async function updateCommandFromProviderEvent(client, { command, event, nowUtc }) {
  const status = commandStatusForProviderEvent(event);
  await client.query(
    `UPDATE broker_provider_commands SET
      status = $2::execution_provider_command_status,
      acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN COALESCE(acknowledged_at, $3) ELSE acknowledged_at END,
      last_error = CASE WHEN $2 = 'failed' THEN $4 ELSE last_error END,
      payload = payload || $5::jsonb,
      updated_at = now()
     WHERE execution_provider_command_id = $1`,
    [command.execution_provider_command_id, status, event.occurred_at_utc || nowUtc,
      event.order_status || event.event_type || null, json({ provider_order_ref: event.provider_order_ref || null })],
  );
}

function updateCommandFromInMemoryProviderEvent(repository, { command, event, nowUtc }) {
  const status = commandStatusForProviderEvent(event);
  repository.providerCommands.set(command.execution_provider_command_id, clone({
    ...command,
    status,
    acknowledged_at: status === "acknowledged" ? (command.acknowledged_at || event.occurred_at_utc) : command.acknowledged_at,
    last_error: status === "failed" ? event.order_status : command.last_error,
    updated_at: nowUtc,
  }));
}

async function upsertExecutionStateWithClient(client, { portfolioOrderIntentId, commandId = null, status = null, providerOrderRef = null, payload = {}, event = null }) {
  const lifecycleStatus = event ? lifecycleStatusForProviderEvent(event) : status;
  const filledQuantity = event?.fill_quantity ?? null;
  const averageFillPrice = event?.fill_price ?? null;
  return one(client,
    `INSERT INTO portfolio_order_intent_execution_states (
      portfolio_order_intent_id, execution_provider_command_id, lifecycle_status,
      provider_order_ref, filled_quantity, average_fill_price, last_event_id, payload
    ) VALUES ($1,$2,$3,$4,COALESCE($5::numeric,0),$6,$7,$8::jsonb)
    ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
      execution_provider_command_id = COALESCE(EXCLUDED.execution_provider_command_id, portfolio_order_intent_execution_states.execution_provider_command_id),
      lifecycle_status = EXCLUDED.lifecycle_status,
      provider_order_ref = COALESCE(EXCLUDED.provider_order_ref, portfolio_order_intent_execution_states.provider_order_ref),
      filled_quantity = GREATEST(portfolio_order_intent_execution_states.filled_quantity, EXCLUDED.filled_quantity),
      average_fill_price = COALESCE(EXCLUDED.average_fill_price, portfolio_order_intent_execution_states.average_fill_price),
      last_event_id = COALESCE(EXCLUDED.last_event_id, portfolio_order_intent_execution_states.last_event_id),
      payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
      revision = portfolio_order_intent_execution_states.revision + 1,
      updated_at_utc = now()
    RETURNING *`,
    [portfolioOrderIntentId, commandId, lifecycleStatus, providerOrderRef || event?.provider_order_ref || null,
      filledQuantity, averageFillPrice, event?.broker_provider_event_id || null,
      json(event ? { last_event_type: event.event_type, last_event_at_utc: event.occurred_at_utc } : payload)],
  );
}

function upsertState(repository, { portfolioOrderIntentId, commandId = null, status, providerOrderRef = null, payload = {} }) {
  const id = text(portfolioOrderIntentId);
  const previous = repository.executionStates.get(id) || { portfolio_order_intent_id: id, filled_quantity: 0, revision: 0, payload: {} };
  const next = {
    ...previous,
    execution_provider_command_id: commandId || previous.execution_provider_command_id || null,
    lifecycle_status: status,
    provider_order_ref: providerOrderRef || previous.provider_order_ref || null,
    payload: { ...(previous.payload || {}), ...payload },
    revision: Number(previous.revision || 0) + 1,
    updated_at_utc: payload.nowUtc || DEFAULT_REPOSITORY_NOW_UTC,
  };
  repository.executionStates.set(id, clone(next));
  return next;
}

function upsertStateFromEvent(repository, { portfolioOrderIntentId, commandId = null, event }) {
  const id = text(portfolioOrderIntentId);
  const previous = repository.executionStates.get(id) || { portfolio_order_intent_id: id, filled_quantity: 0, revision: 0, payload: {} };
  const fillQuantity = Number(event.fill_quantity);
  const nextFilled = Number.isFinite(fillQuantity) && fillQuantity >= 0 ? Math.max(Number(previous.filled_quantity || 0), fillQuantity) : Number(previous.filled_quantity || 0);
  const next = {
    ...previous,
    execution_provider_command_id: commandId || previous.execution_provider_command_id || null,
    lifecycle_status: lifecycleStatusForProviderEvent(event),
    provider_order_ref: event.provider_order_ref || previous.provider_order_ref || null,
    filled_quantity: nextFilled,
    average_fill_price: Number.isFinite(Number(event.fill_price)) ? Number(event.fill_price) : previous.average_fill_price || null,
    last_event_id: event.broker_provider_event_id,
    revision: Number(previous.revision || 0) + 1,
    payload: { ...(previous.payload || {}), last_event_type: event.event_type, last_event_at_utc: event.occurred_at_utc },
    updated_at_utc: event.occurred_at_utc,
  };
  repository.executionStates.set(id, clone(next));
  return next;
}

export { activeProviderStatuses };
