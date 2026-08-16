import {
  canonicalSha256,
  clone,
  DEFAULT_REPOSITORY_NOW_UTC,
  hasValue,
  hash,
  isExpired,
  json,
  normalizeLineage,
  numberOrNull,
  one,
  text,
} from "./portfolio-order-intent-execution-repository-common.js";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";

export class PostgresHumanExecutionGateRepository {
  constructor(repository) {
    this.repository = repository;
    this.domainEvents = repository?.persistence ? new DomainEventOutboxRepository(repository.persistence) : null;
  }

  get pool() { return this.repository.pool; }
  async ready() { return this.repository.ready(); }

  async ensureHumanGate({ portfolioOrderIntentId, expiresAtUtc = null, nowUtc, correlationId = null, correlation_id = null } = {}) {
    await this.ready();
    const gateId = `human_gate_${canonicalSha256({ portfolio_order_intent_id: portfolioOrderIntentId }).slice(0, 24)}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await one(client, "SELECT * FROM human_execution_gates WHERE portfolio_order_intent_id = $1 FOR UPDATE", [text(portfolioOrderIntentId)]);
      if (existing) {
        await client.query("COMMIT");
        return existing;
      }
      const lineage = await one(client, "SELECT payload FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id = $1", [text(portfolioOrderIntentId)]);
      const correlation = text(correlationId || correlation_id || lineage?.payload?.correlation_id || lineage?.payload?.correlationId) || null;
      const result = await client.query(
      `INSERT INTO human_execution_gates (
        human_execution_gate_id, portfolio_order_intent_id, status, expires_at_utc, payload
      ) VALUES ($1,$2,'AWAITING_MANUAL_CONFIRMATION',$3,$4::jsonb)
      ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
        expires_at_utc = COALESCE(human_execution_gates.expires_at_utc, EXCLUDED.expires_at_utc),
        updated_at_utc = now()
      RETURNING *`,
      [gateId, text(portfolioOrderIntentId), expiresAtUtc || null, json({ opened_at_utc: nowUtc, correlation_id: correlation })],
      );
      const gate = result.rows[0];
      await insertHumanGateEventWithClient(client, { gate, eventType: "OPENED", nowUtc, payload: { expires_at_utc: expiresAtUtc || null } });
      await appendHumanGateDomainEvent(this.domainEvents, client, { gate, eventType: "created", nowUtc, payload: { expiresAtUtc: expiresAtUtc || null } });
      await client.query("COMMIT");
      return gate;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmHumanGate(input = {}) {
    await this.ready();
    const portfolioOrderIntentId = text(input.portfolioOrderIntentId || input.portfolio_order_intent_id);
    const nowUtc = input.nowUtc || DEFAULT_REPOSITORY_NOW_UTC;
    const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (idempotencyKey) {
        const duplicate = await one(client, `SELECT e.*, g.* FROM human_execution_gate_events e
          JOIN human_execution_gates g ON g.human_execution_gate_id = e.human_execution_gate_id
          WHERE e.idempotency_key = $1`, [idempotencyKey]);
        if (duplicate) {
          await client.query("COMMIT");
          return { status: duplicate.event_type === "CONFIRMED" ? "CONFIRMED" : "REFUSED", idempotent: true, gate: duplicate };
        }
      }
      const lineage = await one(client, "SELECT * FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id = $1 FOR UPDATE", [portfolioOrderIntentId]);
      if (!lineage) return await refused(client, { portfolioOrderIntentId, reason: "PORTFOLIO_ORDER_INTENT_NOT_FOUND", input, nowUtc, domainEvents: this.domainEvents });
      let gate = await one(client, "SELECT * FROM human_execution_gates WHERE portfolio_order_intent_id = $1 FOR UPDATE", [portfolioOrderIntentId]);
      if (!gate) gate = await insertGateForConfirmation(client, { portfolioOrderIntentId, lineage, nowUtc });
      const normalized = normalizeLineage({ ...lineage, order_intent_payload: lineage.payload, ...gateToLineageFields(gate) });
      const issueCode = humanGateConfirmationIssue({ lineage: normalized, gate, input, nowUtc });
      if (issueCode) return await refused(client, { gate, portfolioOrderIntentId, reason: issueCode, input, nowUtc, domainEvents: this.domainEvents });
      const terms = confirmationTerms(normalized, input.approvedTerms || input.approved_terms || {});
      const termsHash = hash(terms);
      const confirmedGate = await one(client,
        `UPDATE human_execution_gates SET
          status = 'CONFIRMED',
          revision = revision + 1,
          operator_id = $2,
          idempotency_key = $3,
          confirmed_at_utc = $4,
          terms_hash = $5,
          payload = payload || $6::jsonb,
          updated_at_utc = now()
         WHERE human_execution_gate_id = $1
         RETURNING *`,
        [gate.human_execution_gate_id, text(input.operatorId || input.operator_id || "operator"), idempotencyKey || null, nowUtc,
          termsHash, json({ approved_terms: terms, confirmation_reason: input.reason || null })],
      );
      await insertHumanGateEventWithClient(client, {
        gate: confirmedGate,
        eventType: "CONFIRMED",
        operatorId: confirmedGate.operator_id,
        idempotencyKey,
        nowUtc,
        payload: { approved_terms: terms, terms_hash: termsHash },
      });
      await upsertGateStateWithClient(client, {
        portfolioOrderIntentId,
        status: "AWAITING_MANUAL_CONFIRMATION",
        payload: { human_gate_status: "CONFIRMED", confirmed_at_utc: nowUtc },
      });
      await appendHumanGateDomainEvent(this.domainEvents, client, { gate: confirmedGate, eventType: "state_changed", nowUtc, payload: { previousState: gate.status, state: confirmedGate.status, operatorId: confirmedGate.operator_id } });
      await client.query("COMMIT");
      return { status: "CONFIRMED", idempotent: false, gate: confirmedGate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectHumanGate(input = {}) {
    await this.ready();
    const portfolioOrderIntentId = text(input.portfolioOrderIntentId || input.portfolio_order_intent_id);
    const nowUtc = input.nowUtc || DEFAULT_REPOSITORY_NOW_UTC;
    const gate = await this.ensureHumanGate({ portfolioOrderIntentId, nowUtc });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
      `UPDATE human_execution_gates SET
        status = 'REJECTED',
        revision = revision + 1,
        operator_id = $2,
        idempotency_key = $3,
        rejected_at_utc = $4,
        reason = $5,
        updated_at_utc = now()
       WHERE human_execution_gate_id = $1
       RETURNING *`,
      [gate.human_execution_gate_id, text(input.operatorId || input.operator_id || "operator"),
        text(input.idempotencyKey || input.idempotency_key) || null, nowUtc, input.reason || null],
      );
      const rejectedGate = result.rows[0];
      await insertHumanGateEventWithClient(client, { gate: rejectedGate, eventType: "REJECTED", operatorId: rejectedGate.operator_id, idempotencyKey: text(input.idempotencyKey || input.idempotency_key) || null, nowUtc, payload: { reason: input.reason || null } });
      await appendHumanGateDomainEvent(this.domainEvents, client, { gate: rejectedGate, eventType: "state_changed", nowUtc, payload: { previousState: gate.status, state: rejectedGate.status, operatorId: rejectedGate.operator_id, reason: input.reason || null } });
      await client.query("COMMIT");
      return { status: "REJECTED", gate: rejectedGate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class InMemoryHumanExecutionGateRepository {
  constructor(repository) {
    this.repository = repository;
  }

  async ensureHumanGate({ portfolioOrderIntentId, expiresAtUtc = null, nowUtc } = {}) {
    const id = text(portfolioOrderIntentId);
    const existing = this.repository.humanGates.get(id);
    if (existing) return clone(existing);
    const gate = {
      human_execution_gate_id: `human_gate_${canonicalSha256({ portfolio_order_intent_id: id }).slice(0, 24)}`,
      portfolio_order_intent_id: id,
      status: "AWAITING_MANUAL_CONFIRMATION",
      revision: 1,
      operator_id: null,
      idempotency_key: null,
      confirmed_at_utc: null,
      rejected_at_utc: null,
      expires_at_utc: expiresAtUtc || null,
      terms_hash: null,
      reason: null,
      payload: { opened_at_utc: nowUtc },
      created_at_utc: nowUtc,
      updated_at_utc: nowUtc,
    };
    this.repository.humanGates.set(id, clone(gate));
    recordHumanGateEvent(this.repository, { gate, eventType: "OPENED", nowUtc, payload: { expires_at_utc: expiresAtUtc || null } });
    return clone(gate);
  }

  async confirmHumanGate(input = {}) {
    const id = text(input.portfolioOrderIntentId || input.portfolio_order_intent_id);
    const nowUtc = input.nowUtc || DEFAULT_REPOSITORY_NOW_UTC;
    const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
    const duplicate = idempotencyKey ? [...this.repository.humanGateEvents.values()].find((event) => event.idempotency_key === idempotencyKey) : null;
    if (duplicate) return { status: duplicate.event_type === "CONFIRMED" ? "CONFIRMED" : "REFUSED", idempotent: true, gate: clone(this.repository.humanGates.get(id)) };
    const lineage = this.repository.lineages.get(id);
    if (!lineage) return refusedInMemory(this.repository, { portfolioOrderIntentId: id, reason: "PORTFOLIO_ORDER_INTENT_NOT_FOUND", input, nowUtc });
    let gate = this.repository.humanGates.get(id);
    if (!gate) gate = await this.ensureHumanGate({ portfolioOrderIntentId: id, expiresAtUtc: lineage.payload?.expires_at_utc || lineage.payload?.expires_at || null, nowUtc });
    const issueCode = humanGateConfirmationIssue({ lineage, gate, input, nowUtc });
    if (issueCode) return refusedInMemory(this.repository, { gate, portfolioOrderIntentId: id, reason: issueCode, input, nowUtc });
    const terms = confirmationTerms(lineage, input.approvedTerms || input.approved_terms || {});
    const termsHash = hash(terms);
    const confirmed = {
      ...gate,
      status: "CONFIRMED",
      revision: Number(gate.revision || 1) + 1,
      operator_id: text(input.operatorId || input.operator_id || "operator"),
      idempotency_key: idempotencyKey || null,
      confirmed_at_utc: nowUtc,
      terms_hash: termsHash,
      payload: { ...(gate.payload || {}), approved_terms: terms, confirmation_reason: input.reason || null },
      updated_at_utc: nowUtc,
    };
    this.repository.humanGates.set(id, clone(confirmed));
    recordHumanGateEvent(this.repository, { gate: confirmed, eventType: "CONFIRMED", operatorId: confirmed.operator_id, idempotencyKey, nowUtc, payload: { approved_terms: terms, terms_hash: termsHash } });
    upsertState(this.repository, { portfolioOrderIntentId: id, status: "AWAITING_MANUAL_CONFIRMATION", payload: { human_gate_status: "CONFIRMED", confirmed_at_utc: nowUtc } });
    return { status: "CONFIRMED", idempotent: false, gate: clone(confirmed) };
  }

  async rejectHumanGate(input = {}) {
    const id = text(input.portfolioOrderIntentId || input.portfolio_order_intent_id);
    const nowUtc = input.nowUtc || DEFAULT_REPOSITORY_NOW_UTC;
    const gate = await this.ensureHumanGate({ portfolioOrderIntentId: id, nowUtc });
    const rejected = {
      ...gate,
      status: "REJECTED",
      revision: Number(gate.revision || 1) + 1,
      operator_id: text(input.operatorId || input.operator_id || "operator"),
      idempotency_key: text(input.idempotencyKey || input.idempotency_key) || null,
      rejected_at_utc: nowUtc,
      reason: input.reason || null,
      updated_at_utc: nowUtc,
    };
    this.repository.humanGates.set(id, clone(rejected));
    recordHumanGateEvent(this.repository, { gate: rejected, eventType: "REJECTED", operatorId: rejected.operator_id, idempotencyKey: rejected.idempotency_key, nowUtc, payload: { reason: input.reason || null } });
    return { status: "REJECTED", gate: clone(rejected) };
  }
}

export function gateToLineageFields(gate = null) {
  if (!gate) return {};
  return {
    human_execution_gate_id: gate.human_execution_gate_id || null,
    human_gate_status: gate.status || null,
    human_gate_revision: gate.revision || 0,
    human_gate_operator_id: gate.operator_id || null,
    human_gate_idempotency_key: gate.idempotency_key || null,
    human_gate_confirmed_at_utc: gate.confirmed_at_utc || null,
    human_gate_rejected_at_utc: gate.rejected_at_utc || null,
    human_gate_expires_at_utc: gate.expires_at_utc || null,
    human_gate_terms_hash: gate.terms_hash || null,
  };
}

export function humanGatePersistenceIssue({ lineage, gate, nowUtc }) {
  if (!gate) return "HUMAN_CONFIRMATION_REQUIRED";
  if (!["CONFIRMED", "CERTIFICATION_AUTO_APPROVED"].includes(String(gate.status || "").toUpperCase())) return `HUMAN_GATE_${String(gate.status || "MISSING").toUpperCase()}`;
  if (isExpired(gate.expires_at_utc || lineage.expires_at_utc, nowUtc)) return "HUMAN_GATE_EXPIRED";
  if (gate.terms_hash && gate.payload?.approved_terms) {
    const terms = confirmationTerms(lineage, gate.payload.approved_terms);
    if (gate.terms_hash !== hash(terms)) return "HUMAN_GATE_TERMS_DRIFT";
  }
  return null;
}

function humanGateConfirmationIssue({ lineage, gate, input, nowUtc }) {
  if (lineage.broker_submission_allowed !== true || lineage.status !== "READY") return "PORTFOLIO_ORDER_INTENT_NOT_SUBMITTABLE";
  if (["REJECTED", "INVALIDATED", "EXECUTION_BLOCKED"].includes(String(gate.status || "").toUpperCase())) return `HUMAN_GATE_${String(gate.status).toUpperCase()}`;
  if (isExpired(gate.expires_at_utc || lineage.expires_at_utc, nowUtc)) return "HUMAN_GATE_EXPIRED";
  const approvedTerms = input.approvedTerms || input.approved_terms || {};
  const expectedRevision = Number(input.expectedRevision ?? input.expected_revision);
  if (Number.isInteger(expectedRevision) && expectedRevision !== Number(gate.revision || 1)) return "HUMAN_GATE_REVISION_CONFLICT";
  if (hasValue(approvedTerms.quantity) && Number(approvedTerms.quantity) !== Number(lineage.quantity)) return "HUMAN_GATE_QUANTITY_IMMUTABLE";
  if (hasValue(approvedTerms.account_id) && text(approvedTerms.account_id) !== text(lineage.target_account_id || lineage.payload?.account_id || lineage.payload?.broker_account_id)) return "HUMAN_GATE_ACCOUNT_IMMUTABLE";
  if (hasValue(approvedTerms.broker_account_id) && text(approvedTerms.broker_account_id) !== text(lineage.payload?.broker_account_id || lineage.target_account_id)) return "HUMAN_GATE_ACCOUNT_IMMUTABLE";
  if (hasValue(approvedTerms.instrument) && text(approvedTerms.instrument).toUpperCase() !== text(lineage.target_instrument || lineage.payload?.instrument).toUpperCase()) return "HUMAN_GATE_INSTRUMENT_IMMUTABLE";
  if (hasValue(approvedTerms.action) && text(approvedTerms.action).toUpperCase() !== text(lineage.payload?.action || lineage.payload?.side).toUpperCase()) return "HUMAN_GATE_SIDE_IMMUTABLE";
  return null;
}

function confirmationTerms(lineage, approvedTerms = {}) {
  const payload = lineage.payload || lineage.order_intent_payload || {};
  return {
    portfolio_order_intent_id: lineage.portfolio_order_intent_id,
    target_position_id: lineage.target_position_id,
    account_id: text(approvedTerms.account_id || payload.account_id || payload.broker_account_id || lineage.target_account_id),
    broker_account_id: text(approvedTerms.broker_account_id || payload.broker_account_id || payload.account_id || lineage.target_account_id),
    instrument: text(approvedTerms.instrument || payload.instrument || lineage.target_instrument).toUpperCase(),
    action: text(approvedTerms.action || payload.action || payload.side).toUpperCase(),
    quantity: Number(approvedTerms.quantity || lineage.quantity || payload.quantity),
    order_type: text(approvedTerms.order_type || payload.order_type || "MARKET").toUpperCase(),
    protection: {
      stop_price: numberOrNull(approvedTerms.stop_price ?? payload.protection?.stop_price),
      target_price: numberOrNull(approvedTerms.target_price ?? payload.protection?.target_price),
    },
  };
}

async function insertGateForConfirmation(client, { portfolioOrderIntentId, lineage, nowUtc }) {
  return one(client,
    `INSERT INTO human_execution_gates (human_execution_gate_id, portfolio_order_intent_id, status, expires_at_utc, payload)
     VALUES ($1,$2,'AWAITING_MANUAL_CONFIRMATION',$3,$4::jsonb) RETURNING *`,
    [`human_gate_${canonicalSha256({ portfolio_order_intent_id: portfolioOrderIntentId }).slice(0, 24)}`,
      portfolioOrderIntentId, lineage.payload?.expires_at_utc || lineage.payload?.expires_at || null,
      json({ opened_at_utc: nowUtc, source: "confirm_auto_open" })],
  );
}

async function refused(client, { gate = null, portfolioOrderIntentId, reason, input, nowUtc, domainEvents = null }) {
  const existingGate = gate || await one(client, "SELECT * FROM human_execution_gates WHERE portfolio_order_intent_id = $1", [portfolioOrderIntentId]);
  const effectiveGate = existingGate || await insertRefusalGate(client, { portfolioOrderIntentId, nowUtc });
  await insertHumanGateEventWithClient(client, {
    gate: effectiveGate,
    eventType: "REFUSED",
    operatorId: input.operatorId || input.operator_id || "operator",
    idempotencyKey: input.idempotencyKey || input.idempotency_key || null,
    nowUtc,
    payload: { reason },
  });
  await upsertGateStateWithClient(client, { portfolioOrderIntentId, status: "BLOCKED", payload: { human_gate_refusal: reason } });
  await appendHumanGateDomainEvent(domainEvents, client, { gate: effectiveGate, eventType: "state_changed", nowUtc, payload: { state: effectiveGate.status, attemptedAction: "CONFIRM", refusalReason: reason } });
  await client.query("COMMIT");
  return { status: "REFUSED", reason, gate: effectiveGate };
}

async function appendHumanGateDomainEvent(outbox, client, { gate, eventType, nowUtc, payload = {} }) {
  if (!outbox || !gate) return;
  await outbox.append({
    aggregateId: gate.human_execution_gate_id,
    aggregateType: "human_gate",
    eventType: `human_gate.${eventType}`,
    occurredAt: nowUtc,
    correlationId: gate.payload?.correlation_id || gate.payload?.correlationId || `order-intent:${gate.portfolio_order_intent_id}`,
    causationId: gate.portfolio_order_intent_id,
    revision: Number(gate.revision || 1),
    source: "human-execution-gate",
    payload: {
      gateId: gate.human_execution_gate_id,
      orderIntentId: gate.portfolio_order_intent_id,
      state: gate.status,
      ...payload,
    },
  }, client);
}

async function insertRefusalGate(client, { portfolioOrderIntentId, nowUtc }) {
  return one(client,
    `INSERT INTO human_execution_gates (human_execution_gate_id, portfolio_order_intent_id, status, payload)
     VALUES ($1,$2,'AWAITING_MANUAL_CONFIRMATION',$3::jsonb) RETURNING *`,
    [`human_gate_${canonicalSha256({ portfolio_order_intent_id: portfolioOrderIntentId }).slice(0, 24)}`,
      portfolioOrderIntentId, json({ opened_at_utc: nowUtc, source: "refusal_auto_open" })],
  );
}

async function insertHumanGateEventWithClient(client, { gate, eventType, operatorId = null, idempotencyKey = null, nowUtc, payload = {} }) {
  const result = await client.query(
    `INSERT INTO human_execution_gate_events (
      human_execution_gate_event_id, human_execution_gate_id, portfolio_order_intent_id,
      event_type, operator_id, idempotency_key, occurred_at_utc, payload_hash, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING *`,
    [`human_gate_event_${canonicalSha256({ gate_id: gate.human_execution_gate_id, event_type: eventType, idempotency_key: idempotencyKey, occurred_at_utc: nowUtc, payload }).slice(0, 24)}`,
      gate.human_execution_gate_id, gate.portfolio_order_intent_id, eventType, operatorId || null,
      text(idempotencyKey) || null, nowUtc, hash(payload), json(payload)],
  );
  return result.rows[0] || null;
}

async function upsertGateStateWithClient(client, { portfolioOrderIntentId, status, payload = {} }) {
  return one(client,
    `INSERT INTO portfolio_order_intent_execution_states (
      portfolio_order_intent_id, lifecycle_status, payload
    ) VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
      lifecycle_status = EXCLUDED.lifecycle_status,
      payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
      revision = portfolio_order_intent_execution_states.revision + 1,
      updated_at_utc = now()
    RETURNING *`,
    [portfolioOrderIntentId, status, json(payload)],
  );
}

function refusedInMemory(repository, { gate = null, portfolioOrderIntentId, reason, input, nowUtc }) {
  const id = portfolioOrderIntentId;
  const currentGate = gate || repository.humanGates.get(id) || {
    human_execution_gate_id: `human_gate_${canonicalSha256({ portfolio_order_intent_id: id }).slice(0, 24)}`,
    portfolio_order_intent_id: id,
    status: "AWAITING_MANUAL_CONFIRMATION",
    revision: 1,
    payload: {},
  };
  repository.humanGates.set(id, clone(currentGate));
  recordHumanGateEvent(repository, { gate: currentGate, eventType: "REFUSED", operatorId: input.operatorId || input.operator_id || "operator", idempotencyKey: input.idempotencyKey || input.idempotency_key || null, nowUtc, payload: { reason } });
  upsertState(repository, { portfolioOrderIntentId: id, status: "BLOCKED", payload: { human_gate_refusal: reason } });
  return { status: "REFUSED", reason, gate: clone(currentGate) };
}

function recordHumanGateEvent(repository, { gate, eventType, operatorId = null, idempotencyKey = null, nowUtc, payload = {} }) {
  const event = {
    human_execution_gate_event_id: `human_gate_event_${canonicalSha256({ gate_id: gate.human_execution_gate_id, event_type: eventType, idempotency_key: idempotencyKey, occurred_at_utc: nowUtc, payload }).slice(0, 24)}`,
    human_execution_gate_id: gate.human_execution_gate_id,
    portfolio_order_intent_id: gate.portfolio_order_intent_id,
    event_type: eventType,
    operator_id: operatorId || null,
    idempotency_key: idempotencyKey || null,
    occurred_at_utc: nowUtc,
    payload_hash: hash(payload),
    payload,
    created_at_utc: nowUtc,
  };
  repository.humanGateEvents.set(event.human_execution_gate_event_id, clone(event));
  return event;
}

function upsertState(repository, { portfolioOrderIntentId, status, payload = {} }) {
  const id = text(portfolioOrderIntentId);
  const previous = repository.executionStates.get(id) || { portfolio_order_intent_id: id, filled_quantity: 0, revision: 0, payload: {} };
  const next = {
    ...previous,
    lifecycle_status: status,
    payload: { ...(previous.payload || {}), ...payload },
    revision: Number(previous.revision || 0) + 1,
    updated_at_utc: payload.nowUtc || DEFAULT_REPOSITORY_NOW_UTC,
  };
  repository.executionStates.set(id, clone(next));
  return next;
}
