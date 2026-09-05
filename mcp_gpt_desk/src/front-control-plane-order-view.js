import { codedError, text } from "./front-control-plane-common.js";
import { firstRow, firstValue, nested, nullableNumber, number, rows, upper } from "./front-control-plane-projection-helpers.js";
import { activeOrderRow, intentRow, orderFillRow, positionRow } from "./front-control-plane-row-mappers.js";
import { executionAuthorityMode, orderIntentReconciliation } from "./front-order-detail-support.js";
import { canonicalOrderIntentDossier, portfolioIntentSignalId } from "./front-control-plane-domain-completeness.js";
import { orderHumanGateProjection, resourceAllowedActions } from "./front-control-plane-permissions.js";
import { selectById } from "./front-control-plane-view-values.js";

export function orderDetail({ execution, liveMarketSnapshot, query, warnings, actor, nowIso }) {
  const requestedOrderId = text(query.orderId, "");
  const source = rows(execution?.orders).find((item) => String(item.broker_order_id || item.order_id || "").trim() === requestedOrderId)
    || (!requestedOrderId ? rows(execution?.orders)[0] : null);
  const portfolioIntentSource = findPortfolioOrderIntent({ execution, queryOrderId: requestedOrderId, order: source });
  if (!source && !portfolioIntentSource) throw codedError("ORDER_NOT_FOUND", `Unknown order: ${requestedOrderId}`, 404);
  const canonicalSource = source || syntheticOrderFromPortfolioIntent(portfolioIntentSource);
  const effectiveOrder = activeOrderRow(canonicalSource);
  const fills = rows(execution?.fills).filter((item) => source && (String(item.order_id || item.broker_order_id) === effectiveOrder.orderId || String(item.order_id) === String(source.order_id))).map(orderFillRow);
  const intentSource = portfolioIntentSource || rows(execution?.intents).find((item) => String(item.intent_id || item.order_intent_id) === effectiveOrder.orderIntentId) || null;
  const protections = rows(execution?.protections).filter((item) => String(item.order_id) === effectiveOrder.orderId).map((item) => ({ protectionId: text(item.protection_id, "unavailable"), orderId: effectiveOrder.orderId, stopOrderId: text(item.stop_order_id, undefined), targetOrderId: text(item.target_order_id, undefined), state: ["ATTACHED", "FAILED"].includes(upper(item.state || item.status)) ? upper(item.state || item.status) : "PENDING", stopPrice: number(item.stop_price, undefined), targetPrice: number(item.target_price, undefined), trailingModel: text(item.trailing_model, "unavailable"), reasonCode: text(item.reason_code, "unavailable") }));
  if (!rows(execution?.history).length) warnings.push("order-lifecycle:UNAVAILABLE");
  const lifecycle = [
    ...rows(execution?.history).filter((item) => String(item.order_id || item.broker_order_id) === effectiveOrder.orderId).map((item) => ({ eventId: text(item.event_id, "unavailable"), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), state: text(item.state || item.event_type, "unavailable"), detail: text(item.detail || item.message, "Détail indisponible") })),
    ...providerLifecycleRows({ execution, portfolioIntent: portfolioIntentSource, order: effectiveOrder }),
  ];
  const reconciliation = portfolioIntentSource ? orderIntentReconciliation({ execution, portfolioIntent: portfolioIntentSource, fills }) : null;
  const filledQuantity = reconciliation?.broker?.find((item) => item.label === "filledQuantity")?.value ?? fills.reduce((sum, item) => sum + item.quantity, 0);
  const marketContext = orderMarketContext({ order: effectiveOrder, snapshot: liveMarketSnapshot });
  const humanGate = portfolioIntentSource ? orderHumanGateProjection({ execution, portfolioIntent: portfolioIntentSource, actor, nowIso }) : null;
  return {
    summary: { state: effectiveOrder.state, orderedQuantity: effectiveOrder.quantity, filledQuantity, remainingQuantity: Math.max(0, effectiveOrder.quantity - filledQuantity), fillCount: fills.length, protectionStatus: effectiveOrder.protectionStatus },
    identity: { orderId: effectiveOrder.orderId, orderIntentId: effectiveOrder.orderIntentId, signalId: effectiveOrder.signalId, providerId: effectiveOrder.providerId, brokerOrderId: effectiveOrder.brokerOrderId, correlationId: effectiveOrder.correlationId, strategyInstanceId: effectiveOrder.strategyInstanceId },
    order: effectiveOrder,
    intent: intentSource ? intentRow(intentSource) : null,
    authority: portfolioIntentSource ? orderAuthorityProjection(portfolioIntentSource) : null,
    canonicalDossier: portfolioIntentSource ? canonicalOrderIntentDossier({ execution, portfolioIntent: portfolioIntentSource, order: effectiveOrder, actor, nowIso, health: null }) : null,
    resourceActions: portfolioIntentSource ? resourceAllowedActions({
      resourceType: "OrderIntent",
      status: humanGate?.status || "HUMAN_GATE_NOT_CREATED",
      revision: text(portfolioIntentSource.immutable_terms_hash || portfolioIntentSource.order_intent_hash || effectiveOrder.expectedVersion, "unavailable"),
      actor,
      expiresAt: humanGate?.expiresAt || "",
      additionalAllowedActions: rows(humanGate?.actions).map((action) => action.action),
    }) : resourceAllowedActions({ resourceType: "BrokerOrder", status: effectiveOrder.state, actor }),
    executionMode: portfolioIntentSource
      ? executionAuthorityMode(execution?.safety)
      : null,
    humanGate,
    reconciliation,
    marketContext,
    fills,
    protections,
    lifecycle,
    relations: [{ label: "Signal", id: effectiveOrder.signalId, route: `/live/signals/${encodeURIComponent(effectiveOrder.signalId)}` }, { label: "Stratégie", id: effectiveOrder.strategyInstanceId, route: `/strategies/${encodeURIComponent(effectiveOrder.strategyInstanceId)}` }],
  };
}

function orderMarketContext({ order = {}, snapshot = null }) {
  const instrument = normalizeDeskInstrument(order.instrument);
  const instruments = snapshot?.instruments || {};
  const quote = Object.values(instruments).find((item) => normalizeDeskInstrument(item?.symbol) === instrument) || null;
  const lastPrice = positiveNumber(quote?.latest_close);
  const entryPrice = positiveNumber(order.limitPrice);
  const stopPrice = positiveNumber(order.stopPrice);
  const targetPrice = positiveNumber(order.targetPrice);
  const sideMultiplier = upper(order.side) === "SELL" ? -1 : 1;
  const riskDistance = entryPrice !== null && stopPrice !== null ? Math.abs(entryPrice - stopPrice) : null;
  const distanceToEntryPoints = lastPrice !== null && entryPrice !== null ? (lastPrice - entryPrice) * sideMultiplier : null;
  const distanceToEntryR = distanceToEntryPoints !== null && riskDistance && riskDistance > 0 ? distanceToEntryPoints / riskDistance : null;
  const expectedR = entryPrice !== null && stopPrice !== null && targetPrice !== null && riskDistance && riskDistance > 0
    ? ((targetPrice - entryPrice) * sideMultiplier) / riskDistance
    : null;
  const bounds = [entryPrice, stopPrice, targetPrice].filter((value) => value !== null);
  const outsideTradeZone = lastPrice !== null && bounds.length >= 2
    ? lastPrice < Math.min(...bounds) || lastPrice > Math.max(...bounds)
    : null;
  return {
    instrument,
    lastPrice,
    asOf: text(quote?.latest_timestamp_paris, ""),
    availability: quote ? text(quote.availability, "KNOWN").toUpperCase() : "UNAVAILABLE",
    source: text(quote?.source || snapshot?.source, "market_candles"),
    distanceToEntryPoints,
    distanceToEntryR,
    expectedR,
    outsideTradeZone,
  };
}

function normalizeDeskInstrument(value) {
  return upper(value).replace(/^CBOT:/, "").replace(/^CME_MINI:/, "").replace(/1!$/, "");
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findPortfolioOrderIntent({ execution, queryOrderId, order }) {
  const expected = new Set(portfolioOrderIntentIds(order, [queryOrderId]));
  return rows(nested(execution, ["portfolioOrderIntents"]))
    .find((item) => portfolioOrderIntentIds(item).some((value) => expected.has(value)))
    || null;
}

function portfolioOrderIntentIds(item = {}, seeds = []) {
  item = item || {};
  const payload = firstValue(item.order_intent_payload, item.payload, {});
  return [
    ...seeds,
    item.portfolio_order_intent_id,
    item.order_intent_id,
    payload.portfolio_order_intent_id,
    payload.order_intent_id,
  ].map((value) => text(value, "")).filter(Boolean);
}

function syntheticOrderFromPortfolioIntent(lineage = {}) {
  const payload = lineage?.order_intent_payload || lineage?.payload || {};
  const protection = payload.protection || {};
  const terms = lineage?.execution_terms || payload.execution_terms || {};
  const entryPrice = priceFromTerm(terms.entry) ?? terms.entry_price ?? terms.entryPrice;
  const stopPrice = priceFromTerm(terms.stop) ?? terms.stop_price ?? terms.stopPrice;
  const targetPrice = firstTargetPrice(terms.targets) ?? terms.target_price ?? terms.targetPrice;
  return {
    order_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    broker_order_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    portfolio_order_intent_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    order_intent_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    signal_id: text(portfolioIntentSignalId(lineage), "unavailable"),
    provider_id: text(payload.provider_id, "provider-neutral"),
    strategy_instance_id: text(payload.strategy_instance_id, "unavailable"),
    broker_account_id: text(payload.broker_account_id || payload.account_id || lineage.target_account_id, "unavailable"),
    instrument_code: text(payload.instrument || lineage.target_instrument || terms.instrument, "unavailable"),
    side: upper(payload.action || terms.side || terms.action) === "SELL" ? "sell" : "buy",
    quantity: number(payload.quantity ?? lineage.risk_approved_net_size ?? lineage.quantity ?? terms.quantity, 0),
    remaining_quantity: number(payload.quantity || lineage.quantity, 0),
    order_type: payload.order_type || terms.order_type || terms.orderType,
    tif: payload.time_in_force || terms.time_in_force || terms.timeInForce,
    limit_price: payload.limit_price ?? payload.entry_price ?? entryPrice,
    stop_price: protection.stop_price ?? stopPrice,
    target_price: protection.target_price ?? targetPrice,
    idempotency_key: payload.idempotency_key || lineage.idempotency_key,
    correlation_id: payload.correlation_id || lineage.correlation_id,
    updated_at_utc: lineage.updated_at_utc || lineage.created_at_utc || payload.requested_at_utc,
    revision: lineage.order_intent_hash || payload.order_intent_hash,
    status: text(lineage.status || payload.status, "READY"),
    protection_status: protection.ready ? "ATTACHED" : "PENDING",
  };
}

function priceFromTerm(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  return value.price ?? value.value ?? value.level ?? value.mid ?? value.center;
}

function firstTargetPrice(value) {
  const target = Array.isArray(value) ? value[0] : value;
  return priceFromTerm(target);
}

function orderAuthorityProjection(lineage = {}) {
  const payload = lineage.order_intent_payload || lineage.payload || {};
  const source = payload.source || {};
  const canonicalLineage = lineage.lineage || payload.lineage || source.lineage || {};
  const riskDecision = firstRow(lineage.risk_decisions);
  const riskIds = rows(lineage.risk_decision_ids || source.risk_decision_ids).map(String);
  return {
    strategy: {
      strategyId: text(firstValue(payload.strategy_definition_id, payload.strategy_id, rows(canonicalLineage.strategy_definition_ids)[0]), "unavailable"),
      strategyInstanceId: text(firstValue(payload.strategy_instance_id, rows(canonicalLineage.strategy_instance_ids)[0]), "unavailable"),
      strategyVersion: text(firstValue(payload.strategy_version_id, payload.strategy_version, rows(canonicalLineage.strategy_version_ids)[0]), "unavailable"),
    },
    signal: {
      signalId: text(portfolioIntentSignalId(lineage), "unavailable"),
      instrument: text(payload.instrument || lineage.target_instrument, "unavailable"),
      side: payload.action === "SELL" ? "SELL" : "BUY",
    },
    contextGate: authorityStage("Context Gate", {
      decision: text(payload.context_gate_decision || payload.ai_context_decision, ""),
      authorityId: text(payload.context_gate_decision_id || payload.ai_context_gate_decision_id, ""),
      version: text(payload.context_gate_version || payload.ai_context_gate_version, ""),
      reasonCodes: rows(payload.context_gate_reason_codes || payload.ai_context_reason_codes).map(String),
    }),
    portfolioArbitration: authorityStage("Portfolio Arbitration", {
      decision: text(payload.portfolio_arbitration_decision || source.portfolio_arbitration_decision, ""),
      authorityId: text(lineage.portfolio_arbitration_run_id || payload.portfolio_arbitration_run_id || source.portfolio_arbitration_run_id, ""),
      version: text(payload.portfolio_arbitration_version, ""),
      reasonCodes: rows(payload.portfolio_arbitration_reason_codes || source.portfolio_arbitration_reason_codes).map(String),
    }),
    globalRisk: authorityStage("Global Risk", {
      decision: text(riskDecision?.decision, ""),
      authorityId: text(riskDecision?.risk_decision_id || riskIds[0], ""),
      version: text(riskDecision?.risk_rule_set_version || payload.risk_rule_set_version, ""),
      reasonCodes: rows(riskDecision?.reason_codes || payload.risk_reason_codes).map(String),
    }),
    targetPosition: {
      targetPositionId: text(lineage.target_position_id || payload.target_position_id, "unavailable"),
      account: text(lineage.target_account_id || payload.account_id || payload.broker_account_id, "unavailable"),
      authorizedQuantity: nullableNumber(lineage.risk_approved_net_size ?? riskDecision?.approved_size ?? payload.target_net_size ?? payload.quantity),
    },
  };
}

function authorityStage(label, { decision, authorityId, version, reasonCodes }) {
  return {
    label,
    decision: text(decision, ""),
    authorityId: text(authorityId, ""),
    version: text(version, ""),
    reasonCodes: rows(reasonCodes).map(String),
  };
}

function providerLifecycleRows({ execution, portfolioIntent, order }) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  const commandIds = new Set(rows(execution?.providerCommands)
    .filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId)
    .map((item) => text(item.execution_provider_command_id, ""))
    .filter(Boolean));
  return rows(execution?.providerEvents)
    .filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId || commandIds.has(text(item.execution_provider_command_id, "")))
    .map((item) => ({
      eventId: text(item.broker_provider_event_id || item.provider_event_id || item.event_id, "unavailable"),
      at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"),
      state: text(item.event_type || item.state, "unavailable"),
      detail: text(item.message || item.provider_status || item.status, `Provider event for ${order.orderId}`),
    }));
}

export function positionDetail({ execution, query, warnings }) {
  const source = selectById(rows(nested(execution, ["trades"])), query.positionId, (item) => firstValue(item.trade_id, item.position_id), "POSITION_NOT_FOUND");
  const base = positionRow(source);
  const relatedOrders = positionRelatedOrders({ execution, source, base });
  if (!rows(nested(execution, ["trade_events"])).length) warnings.push("position-lifecycle:UNAVAILABLE");
  const lifecycle = positionLifecycleRows({ execution, base });
  const signalId = text(source.signal_id, "unavailable");
  return { summary: positionDetailSummary(source, base), identity: positionDetailIdentity(source, base, signalId), position: positionDetailBody(source, base), orders: relatedOrders, lifecycle, relations: positionDetailRelations(base, signalId) };
}

function positionRelatedOrders({ execution, source, base }) {
  return rows(nested(execution, ["orders"]))
    .filter((item) => String(item.strategy_instance_id) === base.strategyInstanceId || matchingSignalId(item, source))
    .map(activeOrderRow);
}

function matchingSignalId(item, source) {
  return Boolean(source.signal_id) && String(item.signal_id) === String(source.signal_id);
}

function positionLifecycleRows({ execution, base }) {
  return rows(nested(execution, ["trade_events"]))
    .filter((item) => String(firstValue(item.trade_id, item.position_id)) === base.positionId)
    .map(positionLifecycleRow);
}

function positionLifecycleRow(item) {
  return {
    eventId: text(item.event_id, "unavailable"),
    at: text(firstValue(item.occurred_at_utc, item.created_at_utc), "unavailable"),
    state: text(firstValue(item.state, item.event_type), "unavailable"),
    detail: text(firstValue(item.detail, item.message), "Détail indisponible"),
  };
}

function positionDetailSummary(source, base) {
  return { state: text(firstValue(source.status, source.state), base.quantity > 0 ? "OPEN" : "CLOSED"), quantity: base.quantity, pnlR: base.pnlR, riskR: base.riskR, protectionStatus: base.protectionStatus };
}

function positionDetailIdentity(source, base, signalId) {
  return { positionId: base.positionId, strategyInstanceId: base.strategyInstanceId, signalId, correlationId: text(source.correlation_id, "unavailable") };
}

function positionDetailBody(source, base) {
  return {
    ...base,
    state: text(firstValue(source.status, source.state), base.quantity > 0 ? "OPEN" : "CLOSED"),
    stopPrice: number(source.stop_price, undefined),
    targetPrice: number(source.target_price, undefined),
    openedAt: text(firstValue(source.opened_at_utc, source.entry_at_utc), "unavailable"),
    closedAt: text(firstValue(source.closed_at_utc, source.exit_at_utc), undefined),
  };
}

function positionDetailRelations(base, signalId) {
  return [{ label: "Signal", id: signalId, route: `/live/signals/${encodeURIComponent(signalId)}` }, { label: "Stratégie", id: base.strategyInstanceId, route: `/strategies/${encodeURIComponent(base.strategyInstanceId)}` }];
}
