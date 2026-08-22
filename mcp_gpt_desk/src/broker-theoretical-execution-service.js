import { canonicalSha256 } from "@tv-automation/desk-domain";
import {
  evaluateTheoreticalEntryIntent,
  evaluateTheoreticalTradeExit,
} from "./theoretical-execution-engine.js";

const MANUAL_EXECUTION_EVENT_TYPES = new Set(["placed", "filled", "skipped", "closed", "modified", "note"]);

export async function processTheoreticalExecution(service, {
  entryLimit = 100,
  exitLimit = 100,
  nowUtc = null,
  portfolioOrderIntentIds = null,
} = {}) {
  const scopedService = serviceAt(service, nowUtc);
  if (!scopedService.repository.available) return skipped("BROKER_REPOSITORY_UNAVAILABLE");
  if (scopedService.environment.manualTelegramExecutionEnabled !== true) {
    return skipped("THEORETICAL_EXECUTION_ONLY_IN_MANUAL_TELEGRAM_MODE");
  }
  const scope = theoreticalScope({ portfolioOrderIntentIds });
  const expiredHumanGates = typeof scopedService.repository.expireStalePortfolioHumanGates === "function"
    ? await scopedService.repository.expireStalePortfolioHumanGates({ now: scopedService.now(), ...scope })
    : { expired: 0, items: [] };
  const entries = await processTheoreticalEntries(scopedService, { entryLimit, ...scope });
  const exits = await processTheoreticalExits(scopedService, { exitLimit, ...scope });
  const materialized = countMaterialized(entries, ["fill_entry", "expire_entry"])
    + countMaterialized(exits, ["fill_exit", "review_exit"]);
  return {
    ok: true,
    status: materialized > 0 || Number(expiredHumanGates.expired || 0) > 0 ? "MATERIALIZED" : "NO_THEORETICAL_FILL",
    expiredHumanGates,
    entries,
    exits,
    materialized: materialized + Number(expiredHumanGates.expired || 0),
  };
}

export async function recordManualExecutionEvent(service, input = {}, actor = {}) {
  if (!service.repository.available) return { ok: true, status: "SKIPPED", reason: "BROKER_REPOSITORY_UNAVAILABLE" };
  const eventType = normalizeManualEventType(input);
  if (!MANUAL_EXECUTION_EVENT_TYPES.has(eventType)) {
    throw serviceError("MANUAL_EXECUTION_EVENT_INVALID", `Unsupported manual execution event: ${eventType || "missing"}.`);
  }
  const occurredAt = validIso(input.occurredAt || input.occurred_at_utc) || service.now();
  const who = actor.email || actor.uid || actor.kind || input.actor || "operator";
  const manualReconciliation = evaluateManualExecutionReconciliation({ ...input, eventType });
  const event = await service.repository.recordManualExecutionEvent({
    event: {
      order_intent_id: input.orderIntentId || input.order_intent_id || null,
      portfolio_order_intent_id: input.portfolioOrderIntentId || input.portfolio_order_intent_id || null,
      trade_id: input.tradeId || input.trade_id || null,
      management_intent_id: input.managementIntentId || input.management_intent_id || null,
      event_type: eventType,
      source: input.source || "front",
      actor: who,
      quantity: input.quantity ?? null,
      price: input.price ?? null,
      reason: input.reason || null,
      occurred_at_utc: occurredAt,
      idempotency_key: input.idempotencyKey || input.idempotency_key || manualExecutionIdempotencyKey({ input, eventType, occurredAt, who }),
      payload: { ...(input.payload || {}), manual_reconciliation: manualReconciliation },
      raw: manualExecutionRaw(input, manualReconciliation),
    },
  });
  return { ok: true, status: "RECORDED", event };
}

export function evaluateManualExecutionReconciliation(input = {}) {
  const eventType = normalizeManualEventType(input);
  const expected = expectedManualExecutionFields(input);
  const actual = actualManualExecutionFields(input);
  const mismatches = [
    ...mismatch("instrument", expected.instrument, actual.instrument),
    ...mismatch("side", expected.side, actual.side),
    ...mismatch("quantity", expected.quantity, actual.quantity),
  ];
  return {
    schema_version: "manual_execution_reconciliation_v1",
    status: manualReconciliationStatus({ eventType, expected, actual, mismatches }),
    event_type: eventType || null,
    expected,
    actual,
    mismatches,
    theoretical_execution_impact: "none",
    provider_command_created: false,
    broker_fill_authority: "external_manual_operator",
  };
}

function expectedManualExecutionFields(input = {}) {
  const payload = object(input.payload);
  const intent = object(input.orderIntentPayload || input.order_intent_payload);
  return {
    instrument: normalizedText(firstPresent(input.expectedInstrument, input.expected_instrument, intent.instrument)),
    side: normalizeSide(firstPresent(input.expectedSide, input.expected_side, intent.action, intent.side)),
    quantity: finiteNumber(firstPresent(input.expectedQuantity, input.expected_quantity, input.authorizedQuantity, input.authorized_quantity, intent.quantity, payload.expected_quantity)),
  };
}

function actualManualExecutionFields(input = {}) {
  const payload = object(input.payload);
  return {
    instrument: normalizedText(firstPresent(input.instrument, input.actualInstrument, input.actual_instrument, payload.instrument)),
    side: normalizeSide(firstPresent(input.side, input.actualSide, input.actual_side, input.action, payload.side, payload.action)),
    quantity: finiteNumber(firstPresent(input.quantity, input.filledQuantity, input.filled_quantity, payload.quantity, payload.filled_quantity)),
  };
}

async function processTheoreticalEntries(service, { entryLimit, portfolioOrderIntentIds }) {
  const candidates = typeof service.repository.listTheoreticalEntryCandidates === "function"
    ? await service.repository.listTheoreticalEntryCandidates({ limit: entryLimit, portfolioOrderIntentIds })
    : [];
  const entries = [];
  for (const candidate of candidates) {
    const evaluated = await evaluateTheoreticalEntry(service, candidate);
    entries.push(await persistTheoreticalEntryAction(service, evaluated));
  }
  return entries;
}

async function evaluateTheoreticalEntry(service, candidate) {
  const candle = await service.repository.latestClosedCandleForIntent(candidate, { now: service.now() });
  return evaluateTheoreticalEntryIntent({
    intent: candidate,
    decision: candidateDecision(candidate),
    contract: candidateContract(candidate),
    candle,
    now: service.now(),
  });
}

async function persistTheoreticalEntryAction(service, evaluated) {
  if (evaluated.action === "fill_entry") {
    return { ...evaluated, persisted: await service.repository.recordTheoreticalEntryFill({ result: evaluated, now: service.now() }) };
  }
  if (evaluated.action === "expire_entry") {
    return { ...evaluated, persisted: await service.repository.recordTheoreticalEntryExpired({ result: evaluated, now: service.now() }) };
  }
  return evaluated;
}

async function processTheoreticalExits(service, { exitLimit, portfolioOrderIntentIds }) {
  const openTrades = typeof service.repository.listTheoreticalOpenTrades === "function"
    ? await service.repository.listTheoreticalOpenTrades({ limit: exitLimit, portfolioOrderIntentIds })
    : [];
  const exits = [];
  for (const trade of openTrades) {
    const candle = await service.repository.latestClosedCandleForTrade(trade);
    const evaluated = evaluateTheoreticalTradeExit({ trade, candle });
    exits.push(await persistTheoreticalExitAction(service, evaluated));
  }
  return exits;
}

async function persistTheoreticalExitAction(service, evaluated) {
  if (evaluated.action === "fill_exit") {
    return { ...evaluated, persisted: await service.repository.recordTheoreticalExitFill({ result: evaluated, now: service.now() }) };
  }
  if (evaluated.action === "review_exit") {
    return { ...evaluated, persisted: await service.repository.recordTheoreticalReviewRequired({ result: evaluated, now: service.now() }) };
  }
  return evaluated;
}

function candidateDecision(candidate) {
  return {
    trade_decision_id: candidate.trade_decision_id,
    instrument_code: candidate.instrument_code,
    side: candidate.decision_side,
    trading_date: candidate.trading_date,
    session: candidate.session,
    strategy_id: candidate.strategy_id,
    entry_plan: candidate.entry_plan || {},
    risk_plan: candidate.risk_plan || {},
  };
}

function serviceAt(service, nowUtc) {
  const now = validIso(nowUtc);
  if (!now) return service;
  return {
    ...service,
    repository: service.repository,
    environment: service.environment,
    now: () => now,
  };
}

function candidateContract(candidate) {
  return {
    broker_contract_id: candidate.broker_contract_id,
    broker_symbol: candidate.broker_symbol,
    instrument_code: candidate.contract_instrument_code || candidate.instrument_code,
    tick_size: candidate.tick_size,
    point_value: candidate.point_value,
  };
}

function manualExecutionIdempotencyKey({ input, eventType, occurredAt, who }) {
  return `manual_exec_${canonicalSha256({
    eventType,
    orderIntentId: input.orderIntentId || input.order_intent_id || input.portfolioOrderIntentId || input.portfolio_order_intent_id || null,
    tradeId: input.tradeId || input.trade_id || null,
    managementIntentId: input.managementIntentId || input.management_intent_id || null,
    occurredAt,
    actor: who,
  }).slice(0, 48)}`;
}

function manualExecutionRaw(input, manualReconciliation = null) {
  return {
    schema_version: "manual_execution_event_v1",
    theoretical_execution_impact: "none",
    note: "Operator confirmations are tracked separately and do not fill/cancel theoretical backend trades.",
    manual_reconciliation: manualReconciliation,
    input,
  };
}

function countMaterialized(items, actions) {
  return items.filter((item) => actions.includes(item.action)).length;
}
function theoreticalScope({ portfolioOrderIntentIds } = {}) {
  const ids = Array.isArray(portfolioOrderIntentIds)
    ? [...new Set(portfolioOrderIntentIds.map((value) => String(value || "").trim()).filter(Boolean))]
    : null;
  return ids ? { portfolioOrderIntentIds: ids } : {};
}

function skipped(reason) { return { ok: true, status: "SKIPPED", reason, entries: [], exits: [] }; }
function normalizeManualEventType(input) { return String(input.eventType || input.event_type || "").trim().toLowerCase(); }
function validIso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function serviceError(code, message) { const error = new Error(message); error.code = code; error.statusCode = 400; return error; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function firstPresent(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function manualReconciliationStatus({ eventType, expected, actual, mismatches }) {
  if (mismatches.length) return "RECONCILIATION_MISMATCH";
  if (eventType === "filled" && expected.quantity !== null && actual.quantity !== null) return "MATCHED_MANUAL_EXECUTION";
  return "OBSERVATIONAL_ONLY";
}
function mismatch(field, expected, actual) {
  if (expected === null || actual === null || expected === actual) return [];
  return [{ field, expected, actual }];
}
function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizedText(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}
function normalizeSide(value) {
  const side = normalizedText(value);
  if (["BUY", "LONG"].includes(side)) return "BUY";
  if (["SELL", "SHORT"].includes(side)) return "SELL";
  return side;
}
