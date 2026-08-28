import { number, rows, stringList, text, upper } from "./front-control-plane-projection-helpers.js";
import { normalizeProposedTradePlanV1 } from "@tv-automation/desk-domain";

export function activeOrderRow(item) {
  const payload = payloadOf(item);
  const protection = protectionOf(payload);
  return {
    ...orderRow(item),
    orderIntentId: text(firstValue(item.portfolio_order_intent_id, item.order_intent_id, payload.order_intent_id), "unavailable"),
    strategyInstanceId: text(firstValue(item.strategy_instance_id, payload.strategy_instance_id), "unavailable"),
    account: text(firstValue(item.broker_account_id, payload.broker_account_id, payload.account_id), "unavailable"),
    instrument: text(firstValue(item.instrument_code, item.broker_symbol, payload.instrument), "unavailable"),
    remainingQuantity: number(firstValue(item.remaining_quantity, item.quantity, payload.quantity), 0),
    tif: text(firstValue(item.tif, item.time_in_force, payload.time_in_force), "unavailable"),
    limitPrice: number(firstValue(item.limit_price, item.entry_price, payload.limit_price, payload.entry_price), undefined),
    stopPrice: number(firstValue(item.stop_price, payload.stop_price, protection.stop_price), undefined),
    targetPrice: number(firstValue(item.target_price, payload.target_price, protection.target_price), undefined),
    commissions: number(item.commissions, 0),
    slippageR: number(firstValue(item.slippage_R, item.slippage_r), 0),
    protectionStatus: protectionState(item.protection_status || (protection.ready ? "PROTECTED" : "")),
    idempotencyKey: text(firstValue(item.idempotency_key, payload.idempotency_key), "unavailable"),
    correlationId: text(firstValue(item.correlation_id, payload.correlation_id), "unavailable"),
    updatedAt: text(firstValue(item.updated_at_utc, item.created_at_utc, payload.requested_at_utc), "unavailable"),
    expectedVersion: text(firstValue(item.revision, item.order_intent_hash, payload.order_intent_hash), "unavailable"),
  };
}

export function orderRow(item) {
  const payload = payloadOf(item);
  return {
    orderId: text(firstValue(item.broker_order_id, item.order_id), ""),
    signalId: text(firstValue(item.signal_id, payload.signal_id), "unavailable"),
    providerId: text(firstValue(item.provider_id, payload.provider_id), "unavailable"),
    brokerOrderId: text(item.broker_order_id, "unavailable"),
    symbol: text(firstValue(item.instrument_code, item.broker_symbol, payload.instrument), "unavailable"),
    side: upper(firstValue(item.side, payload.side, payload.action)) === "SELL" ? "SELL" : "BUY",
    quantity: number(firstValue(item.quantity, payload.quantity), 0),
    type: orderType(firstValue(item.order_type, item.type, payload.order_type)),
    state: orderState(firstValue(item.state, item.status, payload.status)),
  };
}

export function intentRow(item) {
  const payload = payloadOf(item);
  const protection = protectionOf(payload);
  return {
    orderIntentId: text(firstValue(item.intent_id, item.order_intent_id, item.portfolio_order_intent_id, payload.order_intent_id), ""),
    signalId: text(firstValue(item.signal_id, payload.signal_id), "unavailable"),
    strategyInstanceId: text(firstValue(item.strategy_instance_id, payload.strategy_instance_id), "unavailable"),
    account: text(firstValue(item.broker_account_id, payload.broker_account_id, payload.account_id, item.target_account_id), "unavailable"),
    instrument: text(firstValue(item.instrument_code, payload.instrument, item.target_instrument), "unavailable"),
    side: upper(firstValue(item.side, payload.side, payload.action)) === "SELL" ? "SELL" : "BUY",
    quantity: number(firstValue(item.quantity, payload.quantity), 0),
    type: orderType(firstValue(item.order_type, item.type, payload.order_type)),
    tif: text(firstValue(item.tif, item.time_in_force, payload.time_in_force), "unavailable"),
    limitPrice: number(firstValue(item.limit_price, item.entry_price, payload.limit_price, payload.entry_price), undefined),
    stopPrice: number(firstValue(item.stop_price, payload.stop_price, protection.stop_price), undefined),
    targetPrice: number(firstValue(item.target_price, payload.target_price, protection.target_price), undefined),
    providerId: text(firstValue(item.provider_id, payload.provider_id), "unavailable"),
    state: text(firstValue(item.state, item.status, payload.status), "unavailable"),
    idempotencyKey: text(firstValue(item.idempotency_key, payload.idempotency_key), "unavailable"),
    correlationId: text(firstValue(item.correlation_id, payload.correlation_id), "unavailable"),
    createdAt: text(firstValue(item.created_at_utc, payload.requested_at_utc), "unavailable"),
    expectedVersion: text(firstValue(item.revision, item.order_intent_hash, payload.order_intent_hash), "unavailable"),
  };
}

export function signalRow(item) {
  const tradePlan = frontSignalTradePlan(item);
  return {
    signalId: text(firstValue(item.signal_outbox_id, item.signal_id), ""),
    strategyId: text(firstValue(item.strategy_definition_id, item.strategy_id), "unavailable"),
    strategyDefinitionId: text(firstValue(item.strategy_definition_id, item.strategy_id), "unavailable"),
    strategyVersionId: text(item.strategy_version_id, "unavailable"),
    strategyInstanceId: text(item.strategy_instance_id, "unavailable"),
    timeframe: text(item.timeframe, "unavailable"),
    session: text(item.session, "unavailable"),
    sourceDataCutoffAt: text(firstValue(item.source_data_cutoff_utc, item.cutoff_at_utc), "unavailable"),
    symbol: text(firstValue(item.instrument, item.instrument_code, item.symbol), "unavailable"),
    direction: upper(firstValue(item.direction, item.side)) === "SHORT" ? "SHORT" : "LONG",
    state: signalState(firstValue(item.state, item.status)),
    confidence: confidencePct(item.confidence),
    createdAt: text(item.created_at_utc, "unavailable"),
    expiresAt: text(item.expires_at_utc, "unavailable"),
    featureSnapshotId: text(item.feature_snapshot_id, "unavailable"),
    setup: item.setup || null,
    predicates: rows(item.predicates),
    evidence: rows(item.evidence),
    reasonCodes: stringList(item.reason_codes),
    signalQuality: item.signal_quality || null,
    proposedTradePlan: tradePlan.proposedTradePlan,
    tradePlanEconomics: tradePlan.tradePlanEconomics,
    availability: tradePlan.availability,
    sourceClass: text(item.source_class, "LIVE").toUpperCase(),
    certificationRunId: item.certification_run_id || null,
    correlationId: text(item.correlation_id, "unavailable"),
    ruleHits: stringList(item.rule_hits),
    expectancyR: number(firstValue(item.expectancy_R, item.expectancy_r), 0),
    rewardRisk: number(item.reward_risk, 0),
    regime: text(firstValue(item.regime, item.setup?.context?.market_regime, item.signal_quality?.context_bias), "unavailable"),
  };
}

function confidencePct(value) {
  const parsed = number(value, 0);
  return parsed > 0 && parsed <= 1 ? Math.round(parsed * 100) : parsed;
}

function frontSignalTradePlan(item = {}) {
  const existingPlan = item.proposed_trade_plan || null;
  const existingEconomics = item.trade_plan_economics || null;
  if (existingPlan?.availability === "KNOWN" && existingEconomics?.availability === "KNOWN") {
    return {
      proposedTradePlan: existingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || existingPlan.availability,
    };
  }
  const setup = item.setup || {};
  if (!hasTradePlanHints(existingPlan, setup)) {
    return {
      proposedTradePlan: existingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || existingPlan?.availability || null,
    };
  }
  try {
    const normalized = normalizeProposedTradePlanV1({
      ...object(existingPlan),
      instrument: firstValue(item.instrument, item.instrument_code, item.symbol, existingPlan?.instrument),
      direction: firstValue(item.direction, item.side, existingPlan?.direction),
      order_type: firstValue(existingPlan?.order_type, setup.order_type, setup.orderType),
      time_in_force: firstValue(existingPlan?.time_in_force, setup.time_in_force, setup.timeInForce, "DAY"),
      entry_price: firstValue(
        existingPlan?.entry_price,
        existingPlan?.entry?.price,
        existingPlan?.entry?.calculation_price,
        setup.entry_price,
        setup.entryPrice,
        setup.entry,
      ),
      entry_zone: firstValue(existingPlan?.entry_zone, setup.entry_zone, setup.entryZone),
      stop_price: firstValue(existingPlan?.stop?.price, existingPlan?.stop_price, setup.stop_price, setup.stopPrice, setup.stop, setup.stop_loss, setup.stopLoss),
      targets: firstValue(existingPlan?.targets, setup.targets, setup.take_profit_targets, setup.takeProfitTargets, setup.target_prices, setup.targetPrices),
      source_data_cutoff_utc: firstValue(item.source_data_cutoff_utc, item.cutoff_at_utc, existingPlan?.source?.source_data_cutoff_utc),
    });
    return {
      proposedTradePlan: normalized.proposed_trade_plan || existingPlan,
      tradePlanEconomics: normalized.economics || existingEconomics,
      availability: normalized.proposed_trade_plan?.availability || item.availability || existingPlan?.availability || null,
    };
  } catch {
    return {
      proposedTradePlan: existingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || existingPlan?.availability || null,
    };
  }
}

function hasTradePlanHints(existingPlan, setup = {}) {
  return Boolean(
    existingPlan ||
    setup.entry_zone ||
    setup.entryZone ||
    setup.entry_price ||
    setup.entryPrice ||
    setup.entry ||
    setup.stop_price ||
    setup.stopPrice ||
    setup.stop ||
    setup.stop_loss ||
    setup.stopLoss ||
    setup.targets ||
    setup.take_profit_targets ||
    setup.takeProfitTargets ||
    setup.target_prices ||
    setup.targetPrices
  );
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function payloadOf(item = {}) {
  return firstValue(item.order_intent_payload, item.payload) || {};
}

function protectionOf(payload = {}) {
  return payload.protection || {};
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function fillRow(item) {
  return {
    fillId: text(item.fill_id, ""),
    orderId: text(item.order_id, "unavailable"),
    quantity: number(item.quantity, 0),
    price: number(item.price, 0),
    filledAt: text(item.filled_at_utc, "unavailable"),
  };
}

export function orderFillRow(item) {
  return {
    ...fillRow(item),
    providerId: text(item.provider_id, "provider"),
    brokerExecutionId: text(item.broker_execution_id, "—"),
    instrument: text(item.instrument_code, "—"),
    commission: 0,
    slippageR: 0,
  };
}

export function positionRow(item) {
  return {
    positionId: text(item.trade_id || item.position_id, ""),
    strategyInstanceId: text(item.strategy_instance_id, "unavailable"),
    symbol: text(item.instrument_code, "unavailable"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    averagePrice: number(item.entry_price, 0),
    riskR: number(item.risk_R ?? item.risk_r, 0),
    pnlR: number(item.realized_R ?? item.pnl_R ?? item.result_R, 0),
    protectionStatus: protectionState(item.protection_status),
  };
}

export function providerRows(execution) {
  return rows(execution?.providers)
    .filter((item) => item?.provider_id || item?.broker_provider_code)
    .map((item) => ({
      providerId: text(firstValue(item.provider_id, item.broker_provider_code), ""),
      providerCode: text(firstValue(item.broker_provider_code, item.provider_id), ""),
      label: text(firstValue(item.display_name, item.label, item.broker_provider_code, item.provider_id), "Provider"),
      mode: executionModeState(item.mode),
      status: providerState(item),
      configured: true,
      enabled: item.enabled === true,
      health: providerState(item),
      policyState: item.enabled === false ? "DISABLED_BY_POLICY" : text(item.policy_state, "UNKNOWN").toUpperCase(),
      circuitState: text(item.circuit_breaker_state, "UNKNOWN").toUpperCase(),
      latencyMs: nullableNumber(item.latency_ms),
      lastHeartbeatAt: text(firstValue(item.last_heartbeat_at_utc, item.updated_at), "unavailable"),
      asOf: text(firstValue(item.last_heartbeat_at_utc, item.updated_at), "unavailable"),
    }));
}

export function accountRow(item) {
  return {
    accountId: text(item.broker_account_id, ""),
    providerId: text(item.provider_id, "unavailable"),
    label: text(item.account_label, "Account"),
    mode: upper(item.mode) === "LIVE" ? "LIVE" : "PAPER",
    state: item.read_only ? "READ_ONLY" : "ACTIVE",
    netLiqUsd: number(item.capital, 0),
    openPositions: number(item.open_positions, 0),
    ordersToday: number(item.orders_today, 0),
  };
}

function side(value) {
  const normalized = upper(value);
  if (normalized.includes("SHORT") || normalized === "SELL") return "SHORT";
  if (normalized.includes("LONG") || normalized === "BUY") return "LONG";
  return "FLAT";
}

function orderType(value) {
  const type = upper(value);
  return ["MARKET", "STOP_LIMIT"].includes(type) ? type : "LIMIT";
}

function orderState(value) {
  const state = upper(value);
  return ["INTENT", "SENT", "ACKED", "PARTIAL", "FILLED", "CANCELLED", "REJECTED"].includes(state) ? state : "INTENT";
}

function protectionState(value) {
  const state = upper(value);
  if (state === "PROTECTED") return "PROTECTED";
  if (state === "UNPROTECTED") return "UNPROTECTED";
  return "PENDING";
}

function executionModeState(value) {
  const mode = upper(value);
  if (mode === "LIVE") return "LIVE";
  if (mode === "PAPER") return "PAPER";
  return "SHADOW";
}

function signalState(value) {
  const state = upper(value);
  return ["NEW", "ARBITRATED", "REJECTED", "ORDERED", "FILLED", "EXPIRED", "CLOSED"].includes(state) ? state : "NEW";
}

function providerState(item) {
  const state = upper(item.status || item.health);
  if (item.enabled === false || ["DOWN", "DISCONNECTED", "FAILED"].includes(state)) return "DOWN";
  if (["DEGRADED", "STALE", "WATCH"].includes(state)) return "DEGRADED";
  return "OK";
}
