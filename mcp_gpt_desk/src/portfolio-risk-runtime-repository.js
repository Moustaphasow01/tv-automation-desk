import { canonicalSha256 } from "@tv-automation/desk-domain";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";
import { loadTheoreticalExposureAsOf, lockTheoreticalExposureScope } from "./portfolio-theoretical-exposure-repository.js";

export class PostgresPortfolioRiskRuntimeRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.domainEvents = this.pool ? new DomainEventOutboxRepository(persistence) : null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("PORTFOLIO_RISK_REPOSITORY_UNAVAILABLE", "Portfolio Risk repository is unavailable.");
    await this.persistence.initialized;
  }

  async persistPipeline(input = {}) {
    await this.ready();
    const record = normalizePipelineRecord(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const persistence = await persistRecord(this.domainEvents, client, record);
      await client.query("COMMIT");
      return persistence;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async withTheoreticalExposureSnapshot(input = {}, planner) {
    await this.ready();
    if (typeof planner !== "function") throw repositoryError("PORTFOLIO_EXPOSURE_PLANNER_REQUIRED", "A pure Portfolio planner is required.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockTheoreticalExposureScope(client, input);
      const existing = await one(client, "SELECT * FROM portfolio_arbitration_runs WHERE idempotency_key = $1 FOR UPDATE", [stableIdempotencyKey(input)]);
      if (existing) {
        await client.query("COMMIT");
        return { status: "IDEMPOTENT", exposure_snapshot: existing.payload?.exposure_snapshot || null, result: storedPipeline(existing), persistence: persistedExisting(existing) };
      }
      const snapshot = await loadTheoreticalExposureAsOf(client, input);
      const result = await planner(snapshot);
      const record = normalizePipelineRecord({ ...input, ...result, exposure_snapshot: snapshot, idempotency_key: stableIdempotencyKey(input) });
      const persistence = await persistRecord(this.domainEvents, client, record);
      await client.query("COMMIT");
      return { status: "PERSISTED", exposure_snapshot: snapshot, result, persistence };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadOrderIntentLineage({ portfolioOrderIntentId, tradeOrderIntentId } = {}) {
    await this.ready();
    const row = await one(this.pool, `SELECT l.*, t.account_id, t.instrument, t.net_target_size,
        array_remove(array_agg(DISTINCT a.candidate_allocation_id), NULL) AS candidate_allocation_ids,
        array_remove(array_agg(DISTINCT r.risk_decision_id), NULL) AS risk_decision_ids
      FROM portfolio_order_intent_lineage l
      JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
      LEFT JOIN portfolio_target_position_allocations a ON a.target_position_id = t.target_position_id
      LEFT JOIN portfolio_target_position_risk_decisions r ON r.target_position_id = t.target_position_id
      WHERE ($1::text IS NULL OR l.portfolio_order_intent_id = $1)
        AND ($2::text IS NULL OR l.trade_order_intent_id = $2)
      GROUP BY l.portfolio_order_intent_id, t.target_position_id
      LIMIT 1`, [portfolioOrderIntentId || null, tradeOrderIntentId || null]);
    return row || null;
  }
}

export class InMemoryPortfolioRiskRuntimeRepository {
  constructor() {
    this.runs = new Map();
    this.idempotency = new Map();
    this.allocations = new Map();
    this.riskDecisions = new Map();
    this.targets = new Map();
    this.orderIntents = new Map();
  }

  get available() { return true; }

  async persistPipeline(input = {}) {
    const record = normalizePipelineRecord(input);
    if (this.idempotency.has(record.run.idempotency_key)) {
      const runId = this.idempotency.get(record.run.idempotency_key);
      return { status: "IDEMPOTENT", portfolio_arbitration_run_id: runId, counts: zeroCounts(), existing: this.runs.get(runId) };
    }
    this.runs.set(record.run.id, clone(record.run));
    this.idempotency.set(record.run.idempotency_key, record.run.id);
    record.allocations.forEach((item) => this.allocations.set(item.id, clone(item)));
    record.riskDecisions.forEach((item) => this.riskDecisions.set(item.risk_decision_id, clone(item)));
    record.targets.forEach((item) => this.targets.set(item.id, clone(item)));
    record.orderIntents.forEach((item) => this.orderIntents.set(item.order_intent_id, clone(item)));
    return { status: "PERSISTED", portfolio_arbitration_run_id: record.run.id, counts: counts(record) };
  }

  async withTheoreticalExposureSnapshot(input = {}, planner) {
    const key = stableIdempotencyKey(input);
    if (this.idempotency.has(key)) {
      const existing = this.runs.get(this.idempotency.get(key));
      return { status: "IDEMPOTENT", exposure_snapshot: existing.payload?.exposure_snapshot || null, result: storedPipeline(existing), persistence: persistedExisting(existing) };
    }
    const snapshot = memoryExposureSnapshot(input);
    const result = await planner(snapshot);
    const persistence = await this.persistPipeline({ ...input, ...result, exposure_snapshot: snapshot, idempotency_key: key });
    return { status: "PERSISTED", exposure_snapshot: snapshot, result, persistence };
  }

  async loadOrderIntentLineage({ portfolioOrderIntentId } = {}) {
    const intent = this.orderIntents.get(portfolioOrderIntentId);
    if (!intent) return null;
    const target = this.targets.get(intent.target_position_id);
    return {
      portfolio_order_intent_id: intent.order_intent_id,
      target_position_id: intent.target_position_id,
      trade_order_intent_id: intent.trade_order_intent_id || null,
      idempotency_key: intent.idempotency_key,
      candidate_allocation_ids: target?.candidate_allocation_ids || [],
      risk_decision_ids: target?.derived_from_risk_decision_ids || [],
    };
  }
}

export function createPortfolioRiskRuntimeRepository(persistence) {
  return persistence?.pool ? new PostgresPortfolioRiskRuntimeRepository(persistence) : new InMemoryPortfolioRiskRuntimeRepository();
}

export function normalizePipelineRecord(input = {}) {
  // Keep unauthorizable drafts in the audited run payload, not as canonical
  // allocation rows. A corrected policy may reconsider that same draft safely.
  const allocations = input.risk?.status === "CONFIG_MISSING" ? []
    : array(input.allocations?.candidate_allocations || input.candidate_allocations);
  const riskDecisions = array(input.risk?.allocation_evaluations || input.risk_decisions);
  const targets = array(input.targets?.target_positions || input.target_positions);
  const orderIntents = array(input.intents?.order_intents || input.order_intents);
  const asOf = iso(input.as_of_utc || input.asOfUtc || input.allocations?.as_of_utc || input.risk?.as_of_utc || input.targets?.as_of_utc);
  const run = normalizeRun(input, { allocations, riskDecisions, targets, orderIntents, asOf });
  return { run, risk: input.risk || {}, allocations, riskDecisions, targets, orderIntents };
}

function normalizeRun(input, items) {
  const idempotencyKey = stableIdempotencyKey({ ...input, allocations: input.allocations || { candidate_allocations: items.allocations } });
  const base = {
    idempotency_key: idempotencyKey,
    portfolio_scope: text(input.portfolio_scope || input.allocations?.portfolio_scope || input.scope || "default"),
    account_id: text(input.account_id || input.targets?.account_id || input.risk?.account_id || "default"),
    status: runStatus(items),
    as_of_utc: items.asOf,
    correlation_id: text(input.correlation_id || input.correlationId),
    signal_ids: allSignalIds(input, items.allocations),
    plan_hash: hash({ allocations: input.allocations?.plan_hash, risk: input.risk?.evaluation_hash, targets: input.targets?.plan_hash, intents: input.intents?.plan_hash }),
    payload: {
      allocation_plan: input.allocations || null,
      risk_evaluation: input.risk || null,
      target_position_plan: input.targets || null,
      order_intent_plan: input.intents || null,
      exposure_snapshot: input.exposure_snapshot || null,
    },
  };
  return { id: text(input.portfolio_arbitration_run_id || input.run_id) || `portfolio_run_${canonicalSha256(base).slice(0, 24)}`, ...base, payload_hash: hash(base.payload) };
}

async function persistRecord(domainEvents, client, record) {
  const existing = await one(client, "SELECT * FROM portfolio_arbitration_runs WHERE idempotency_key = $1 FOR UPDATE", [record.run.idempotency_key]);
  if (existing) return persistedExisting(existing);
  await insertRun(client, record.run);
  for (const allocation of record.allocations) await insertAllocation(client, record.run.id, allocation);
  for (const decision of record.riskDecisions) await insertRiskDecision(client, record, decision);
  for (const target of record.targets) await insertTarget(client, record.run.id, target);
  for (const target of record.targets) await insertTargetLinks(client, target);
  for (const intent of record.orderIntents) await insertOrderIntentLineage(client, intent);
  await appendPipelineDomainEvents(domainEvents, client, record);
  return { status: "PERSISTED", portfolio_arbitration_run_id: record.run.id, counts: counts(record) };
}

function stableIdempotencyKey(input = {}) {
  const supplied = text(input.idempotency_key || input.idempotencyKey || input.command?.idempotency_key);
  if (supplied) return supplied;
  const signals = input.signals || input.allocations?.candidate_allocations || [];
  const signalIds = array(signals).map((item) => text(item.signal_id || item.id)).filter(Boolean).sort();
  return `portfolio-risk:${canonicalSha256({ account_id: text(input.account_id || "default"), portfolio_scope: text(input.portfolio_scope || input.scope || "default"), signal_ids: signalIds,
    risk_budget: input.risk_budget || input.riskBudget || null })}`;
}

function persistedExisting(existing) {
  return { status: "IDEMPOTENT", portfolio_arbitration_run_id: existing.portfolio_arbitration_run_id, counts: zeroCounts(), existing };
}

function storedPipeline(existing) {
  const payload = existing.payload || {};
  return {
    status: existing.status || "IDEMPOTENT",
    allocations: payload.allocation_plan || emptyPlan(),
    risk: payload.risk_evaluation || emptyPlan(),
    targets: payload.target_position_plan || emptyPlan(),
    intents: payload.order_intent_plan || emptyPlan(),
  };
}

function memoryExposureSnapshot(input) {
  const mode = String(input.execution_mode || input.executionMode || "SHADOW").toUpperCase();
  const unavailable = ["LIVE", "PAPER", "BROKER", "PHYSICAL"].includes(mode);
  return {
    source: "THEORETICAL_PERSISTED_AS_OF", execution_mode: mode, as_of_utc: input.as_of_utc || input.asOfUtc,
    portfolio_scope: input.portfolio_scope || input.scope || "default", account_id: input.account_id || "default",
    availability: unavailable ? "UNAVAILABLE" : "KNOWN",
    reason_codes: unavailable ? ["PHYSICAL_EXPOSURE_READ_UNSUPPORTED"] : [],
    positions: array(input.positions || input.virtual_positions), pending_order_intents: array(input.existing_order_intents), qualified_signal_ids: [],
    reservation_instruments: [], unknown_reservation_instruments: [],
  };
}

function emptyPlan() { return {}; }

async function insertRun(client, run) {
  await client.query(`INSERT INTO portfolio_arbitration_runs (
      portfolio_arbitration_run_id, idempotency_key, portfolio_scope, account_id, status,
      as_of_utc, correlation_id, signal_ids, plan_hash, payload_hash, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
    run.id, run.idempotency_key, run.portfolio_scope, run.account_id, run.status, run.as_of_utc,
    run.correlation_id || null, run.signal_ids, run.plan_hash, run.payload_hash, json(run.payload),
  ]);
}

async function insertAllocation(client, runId, allocation) {
  await client.query(`INSERT INTO portfolio_candidate_allocations (
      candidate_allocation_id, portfolio_arbitration_run_id, portfolio_scope, account_id, instrument, net_direction,
      proposed_size, long_size, short_size, net_size, status, strategy_instance_count,
      signal_ids, as_of_utc, payload_hash, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`, [
    allocation.id, runId, allocation.portfolio_scope, text(allocation.account_id || "default"), allocation.instrument, allocation.net_direction,
    number(allocation.proposed_size), number(allocation.long_size), number(allocation.short_size),
    number(allocation.net_size), allocation.status, integer(allocation.strategy_instance_count),
    array(allocation.signal_ids), allocation.as_of_utc, hash(allocation), json(allocation),
  ]);
}

async function insertRiskDecision(client, record, decision) {
  await client.query(`INSERT INTO portfolio_risk_decisions (
      risk_decision_id, candidate_allocation_id, account_id, instrument, status, decision,
      requested_size, approved_size, reason_codes, limits_applied, risk_budget_id,
      risk_rule_set_version, risk_evaluation_hash, decided_at_utc, payload_hash, payload,
      account_capital_reference, requested, authorized, trade_risk, portfolio_before,
      portfolio_after, limits, nearest_limit, breaches, risk_economics
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb)`, [
    decision.risk_decision_id, decision.candidate_allocation_id, text(decision.account_id || record.run.account_id), decision.instrument,
    decision.status, decision.decision, number(decision.requested_size), number(decision.approved_size),
    array(decision.reason_codes), array(decision.limits_applied), text(record.risk?.budget?.budget_id),
    text(record.risk?.budget?.budget_hash), text(record.risk?.evaluation_hash), record.run.as_of_utc,
    hash(decision), json(decision),
    jsonOrNull(decision.account_capital_reference),
    jsonOrNull(decision.requested),
    jsonOrNull(decision.authorized),
    jsonOrNull(decision.trade_risk),
    jsonOrNull(decision.portfolio_before),
    jsonOrNull(decision.portfolio_after),
    jsonOrNull(decision.limits),
    jsonOrNull(decision.nearest_limit),
    jsonOrNull(decision.breaches),
    jsonOrNull(decision.risk_economics),
  ]);
}

async function insertTarget(client, runId, target) {
  await client.query(`INSERT INTO portfolio_target_positions (
      target_position_id, portfolio_arbitration_run_id, account_id, instrument, net_direction,
      current_net_size, net_target_size, delta_size, risk_approved_net_size, status,
      computed_at_utc, target_hash, payload_hash, payload,
      approved_trade_plan, risk_allocation, expected_exposure, lineage
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb)`, [
    target.id, runId, target.account_id, target.instrument, target.net_direction,
    number(target.current_net_size), number(target.net_target_size), number(target.delta_size),
    number(target.risk_approved_net_size), target.status, target.computed_at_utc,
    hash(target), hash(target), json(target),
    jsonOrNull(target.approved_trade_plan),
    jsonOrNull(target.risk_allocation),
    jsonOrNull(target.expected_exposure),
    jsonOrNull(target.lineage),
  ]);
}

async function insertTargetLinks(client, target) {
  for (const id of array(target.candidate_allocation_ids)) {
    await client.query("INSERT INTO portfolio_target_position_allocations (target_position_id, candidate_allocation_id) VALUES ($1,$2)", [target.id, id]);
  }
  for (const id of array(target.derived_from_risk_decision_ids).filter(Boolean)) {
    await client.query("INSERT INTO portfolio_target_position_risk_decisions (target_position_id, risk_decision_id) VALUES ($1,$2)", [target.id, id]);
  }
}

async function insertOrderIntentLineage(client, intent) {
  await client.query(`INSERT INTO portfolio_order_intent_lineage (
      portfolio_order_intent_id, target_position_id, trade_order_intent_id, idempotency_key,
      status, broker_submission_allowed, quantity, order_intent_hash, payload_hash, payload
      , execution_terms, risk_snapshot, lineage, policy, immutability, immutable_terms_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16)`, [
    intent.order_intent_id, intent.target_position_id, intent.trade_order_intent_id || null,
    intent.idempotency_key, intent.status, intent.broker_submission_allowed === true,
    number(intent.quantity), intent.order_intent_hash, hash(intent), json(intent),
    jsonOrNull(intent.execution_terms),
    jsonOrNull(intent.risk_snapshot),
    jsonOrNull(intent.source?.lineage || null),
    jsonOrNull({
      provider_id: intent.provider_id,
      order_type: intent.order_type,
      time_in_force: intent.time_in_force,
      broker_submission_allowed: intent.broker_submission_allowed,
    }),
    jsonOrNull(intent.immutability),
    intent.immutable_terms_hash || null,
  ]);
}

async function appendPipelineDomainEvents(outbox, client, record) {
  if (!outbox) return;
  const correlationId = record.run.correlation_id || `portfolio-risk:${record.run.id}`;
  await outbox.append({
    aggregateId: record.run.id,
    aggregateType: "portfolio_arbitration",
    eventType: "portfolio.arbitration.completed",
    occurredAt: record.run.as_of_utc,
    correlationId,
    causationId: record.run.signal_ids[0] || null,
    source: "portfolio-risk-runtime",
    payload: {
      portfolioArbitrationRunId: record.run.id,
      signalIds: record.run.signal_ids,
      status: record.run.status,
      candidateAllocationIds: record.allocations.map((item) => item.id),
    },
  }, client);
  for (const decision of record.riskDecisions) {
    await outbox.append({
      aggregateId: decision.risk_decision_id,
      aggregateType: "risk_decision",
      eventType: "risk.decision.created",
      occurredAt: record.run.as_of_utc,
      correlationId,
      causationId: record.run.id,
      source: "portfolio-risk-runtime",
      payload: {
        riskDecisionId: decision.risk_decision_id,
        candidateAllocationId: decision.candidate_allocation_id,
        decision: decision.decision,
        status: decision.status,
        requestedQuantity: numberOrNull(decision.requested_size),
        authorizedQuantity: numberOrNull(decision.approved_size),
        reasonCodes: array(decision.reason_codes),
      },
    }, client);
  }
  for (const target of record.targets) {
    await outbox.append({
      aggregateId: target.id,
      aggregateType: "target_position",
      eventType: "target_position.created",
      occurredAt: target.computed_at_utc || record.run.as_of_utc,
      correlationId,
      causationId: array(target.derived_from_risk_decision_ids)[0] || record.run.id,
      source: "portfolio-risk-runtime",
      payload: {
        targetPositionId: target.id,
        account: target.account_id,
        instrument: target.instrument,
        targetNetSize: numberOrNull(target.net_target_size),
        deltaSize: numberOrNull(target.delta_size),
        authorizedQuantity: numberOrNull(target.risk_approved_net_size),
      },
    }, client);
  }
  for (const intent of record.orderIntents) {
    await outbox.append({
      aggregateId: intent.order_intent_id,
      aggregateType: "order_intent",
      eventType: "order_intent.created",
      occurredAt: intent.created_at_utc || record.run.as_of_utc,
      correlationId,
      causationId: intent.target_position_id,
      source: "portfolio-risk-runtime",
      payload: {
        orderIntentId: intent.order_intent_id,
        targetPositionId: intent.target_position_id,
        status: intent.status,
        authorizedQuantity: numberOrNull(intent.quantity),
        brokerSubmissionAllowed: intent.broker_submission_allowed === true,
      },
    }, client);
  }
}

function counts(record) {
  return { allocations: record.allocations.length, risk_decisions: record.riskDecisions.length, target_positions: record.targets.length, order_intents: record.orderIntents.length };
}
function zeroCounts() { return { allocations: 0, risk_decisions: 0, target_positions: 0, order_intents: 0 }; }
function runStatus({ riskDecisions, targets, orderIntents }) {
  if (orderIntents.length) return "ORDER_INTENTS_READY";
  if (targets.length) return "TARGETS_READY";
  if (riskDecisions.some((item) => item.status === "BLOCK")) return "RISK_BLOCKED";
  return "NO_TARGETS";
}
function allSignalIds(input, allocations) {
  const direct = array(input.signals).map((item) => text(item.signal_id || item.id));
  const rejected = array(input.allocations?.rejected_signals).map((item) => text(item.signal_id));
  return [...new Set([...signalIds(allocations), ...direct, ...rejected].filter(Boolean))].sort();
}

function signalIds(allocations) { return allocations.flatMap((item) => array(item.signal_ids)); }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function repositoryError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function json(value) { return JSON.stringify(value ?? {}); }
function jsonOrNull(value) { return value === undefined || value === null ? null : JSON.stringify(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function numberOrNull(value) { const parsed = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed; }
function integer(value) { return Math.max(0, Math.trunc(number(value))); }
function iso(value) {
  const parsed = Date.parse(value || "");
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  throw repositoryError("PORTFOLIO_RISK_AS_OF_REQUIRED", "Portfolio Risk persistence requires an explicit as_of_utc timestamp.");
}
