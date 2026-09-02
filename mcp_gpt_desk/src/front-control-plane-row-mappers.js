import { number, rows, stringList, text, upper } from "./front-control-plane-projection-helpers.js";
import { normalizeProposedTradePlanV1 } from "@tv-automation/desk-domain";

export function activeOrderRow(item) {
  const payload = payloadOf(item);
  const protection = protectionOf(payload);
  const terms = executionTermsOf(item, payload);
  return {
    ...orderRow(item),
    orderIntentId: text(firstValue(item.portfolio_order_intent_id, item.order_intent_id, payload.order_intent_id), "unavailable"),
    strategyInstanceId: text(firstValue(item.strategy_instance_id, payload.strategy_instance_id), "unavailable"),
    account: text(firstValue(item.broker_account_id, item.account_id, payload.broker_account_id, payload.account_id, terms.broker_account_id, terms.account_id), "unavailable"),
    instrument: text(firstValue(item.instrument_code, item.broker_symbol, payload.instrument, terms.instrument), "unavailable"),
    remainingQuantity: number(firstValue(item.remaining_quantity, item.quantity, payload.quantity), 0),
    tif: text(firstValue(item.tif, item.time_in_force, payload.time_in_force, terms.time_in_force, terms.timeInForce), "unavailable"),
    limitPrice: number(firstValue(item.limit_price, item.entry_price, payload.limit_price, payload.entry_price, priceNode(terms.entry), terms.entry_price, terms.entryPrice), undefined),
    stopPrice: number(firstValue(item.stop_price, payload.stop_price, protection.stop_price, priceNode(terms.stop), terms.stop_price, terms.stopPrice), undefined),
    targetPrice: number(firstValue(item.target_price, payload.target_price, protection.target_price, firstTargetPrice(terms.targets), terms.target_price, terms.targetPrice), undefined),
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
  const terms = executionTermsOf(item, payload);
  const lineage = item.lineage || payload.lineage || payload.source?.lineage || {};
  return {
    orderId: text(firstValue(item.broker_order_id, item.order_id), ""),
    signalId: text(firstValue(item.signal_id, payload.signal_id, rows(lineage.strategy_signal_ids)[0]), "unavailable"),
    providerId: text(firstValue(item.provider_id, payload.provider_id), "unavailable"),
    brokerOrderId: text(item.broker_order_id, "unavailable"),
    symbol: text(firstValue(item.instrument_code, item.broker_symbol, payload.instrument, terms.instrument), "unavailable"),
    side: upper(firstValue(item.side, payload.side, payload.action, terms.side, terms.action)) === "SELL" ? "SELL" : "BUY",
    quantity: number(firstValue(item.quantity, payload.quantity, terms.quantity), 0),
    type: orderType(firstValue(item.order_type, item.type, payload.order_type, terms.order_type, terms.orderType)),
    state: orderState(firstValue(item.state, item.status, payload.status)),
  };
}

export function intentRow(item) {
  const payload = payloadOf(item);
  const protection = protectionOf(payload);
  const terms = executionTermsOf(item, payload);
  return {
    orderIntentId: text(firstValue(item.intent_id, item.order_intent_id, item.portfolio_order_intent_id, payload.order_intent_id), ""),
    signalId: text(firstValue(item.signal_id, payload.signal_id), "unavailable"),
    strategyInstanceId: text(firstValue(item.strategy_instance_id, payload.strategy_instance_id), "unavailable"),
    account: text(firstValue(item.broker_account_id, payload.broker_account_id, payload.account_id, item.target_account_id), "unavailable"),
    instrument: text(firstValue(item.instrument_code, payload.instrument, item.target_instrument, terms.instrument), "unavailable"),
    side: upper(firstValue(item.side, payload.side, payload.action, terms.side, terms.action)) === "SELL" ? "SELL" : "BUY",
    quantity: number(firstValue(item.quantity, payload.quantity, item.risk_approved_net_size, terms.quantity), 0),
    type: orderType(firstValue(item.order_type, item.type, payload.order_type, terms.order_type, terms.orderType)),
    tif: text(firstValue(item.tif, item.time_in_force, payload.time_in_force, terms.time_in_force, terms.timeInForce), "unavailable"),
    limitPrice: number(firstValue(item.limit_price, item.entry_price, payload.limit_price, payload.entry_price, priceNode(terms.entry), terms.entry_price, terms.entryPrice), undefined),
    stopPrice: number(firstValue(item.stop_price, payload.stop_price, protection.stop_price, priceNode(terms.stop), terms.stop_price, terms.stopPrice), undefined),
    targetPrice: number(firstValue(item.target_price, payload.target_price, protection.target_price, firstTargetPrice(terms.targets), terms.target_price, terms.targetPrice), undefined),
    providerId: text(firstValue(item.provider_id, payload.provider_id), "unavailable"),
    state: text(firstValue(item.state, item.status, payload.status), "unavailable"),
    idempotencyKey: text(firstValue(item.idempotency_key, payload.idempotency_key), "unavailable"),
    correlationId: text(firstValue(item.correlation_id, payload.correlation_id), "unavailable"),
    createdAt: text(firstValue(item.created_at_utc, payload.requested_at_utc), "unavailable"),
    expectedVersion: text(firstValue(item.revision, item.order_intent_hash, payload.order_intent_hash), "unavailable"),
  };
}

export function signalRow(item) {
  const payload = item.payload || {};
  const source = { ...payload, ...item };
  const lineage = item.lineage || payload.lineage || payload.source?.lineage || {};
  const tradePlan = frontSignalTradePlan(source);
  const proposedTradePlan = object(tradePlan.proposedTradePlan);
  const tradePlanEconomics = object(tradePlan.tradePlanEconomics);
  const firstTarget = rows(proposedTradePlan.targets)[0] || {};
  const firstTargetEconomics = rows(tradePlanEconomics.targets)[0] || {};
  const rawReasonCodes = stringList(source.reason_codes);
  return {
    // The domain StrategySignal ID is the canonical lineage identity. The outbox
    // ID remains useful transport evidence, but must never replace it in routes
    // or joins with Context, Risk and OrderIntent.
    signalId: text(firstValue(source.signal_id, rows(lineage.strategy_signal_ids)[0], source.signal_outbox_id), ""),
    signalOutboxId: text(source.signal_outbox_id, "") || null,
    strategyId: text(firstValue(source.strategy_definition_id, source.strategy_id, rows(lineage.strategy_definition_ids)[0]), "unavailable"),
    strategyDefinitionId: text(firstValue(source.strategy_definition_id, source.strategy_id, rows(lineage.strategy_definition_ids)[0]), "unavailable"),
    strategyVersionId: text(firstValue(source.strategy_version_id, rows(lineage.strategy_version_ids)[0]), "unavailable"),
    strategyInstanceId: text(firstValue(source.strategy_instance_id, rows(lineage.strategy_instance_ids)[0]), "unavailable"),
    timeframe: text(source.timeframe, "unavailable"),
    session: text(source.session, "unavailable"),
    sourceDataCutoffAt: text(firstValue(source.source_data_cutoff_utc, source.cutoff_at_utc), "unavailable"),
    symbol: text(firstValue(source.instrument, source.instrument_code, source.symbol), "unavailable"),
    direction: upper(firstValue(source.direction, source.side)) === "SHORT" ? "SHORT" : "LONG",
    state: signalState(firstValue(source.state, source.status)),
    confidence: confidencePct(source.confidence),
    createdAt: text(source.created_at_utc, "unavailable"),
    expiresAt: text(source.expires_at_utc, "unavailable"),
    featureSnapshotId: text(source.feature_snapshot_id, "unavailable"),
    setup: source.setup || null,
    predicates: rows(source.predicates),
    evidence: rows(source.evidence),
    reasonCodes: currentTradePlanReasonCodes(rawReasonCodes, tradePlan),
    rawReasonCodes,
    signalQuality: source.signal_quality || null,
    confidenceBreakdown: firstValue(source.confidence_breakdown, source.signal_quality?.confidence_breakdown, source.signal_quality?.components) || null,
    confidenceHistory: rows(firstValue(source.confidence_history, source.signal_quality?.confidence_history)),
    proposedTradePlan: tradePlan.proposedTradePlan,
    tradePlanEconomics: tradePlan.tradePlanEconomics,
    availability: tradePlan.availability,
    sourceClass: text(source.source_class, "LIVE").toUpperCase(),
    certificationRunId: source.certification_run_id || null,
    correlationId: text(source.correlation_id, "unavailable"),
    ruleHits: stringList(source.rule_hits),
    expectancyR: nullableNumber(firstValue(
      source.expectancy_R,
      source.expectancy_r,
      source.expected_r,
      tradePlanEconomics.expected_r,
      firstTargetEconomics.expected_r,
      firstTarget.expected_r,
    )),
    rewardRisk: nullableNumber(firstValue(
      source.reward_risk,
      tradePlanEconomics.reward_risk,
      firstTargetEconomics.reward_risk,
      firstTarget.reward_risk,
    )),
    regime: text(firstValue(source.regime, source.setup?.context?.market_regime, source.signal_quality?.context_bias), "unavailable"),
    conflicts: rows(firstValue(source.conflicts, source.signal_quality?.conflicts)),
  };
}

function currentTradePlanReasonCodes(reasonCodes, tradePlan = {}) {
  const proposedTradePlan = object(tradePlan.proposedTradePlan);
  const economics = object(tradePlan.tradePlanEconomics);
  const entry = object(proposedTradePlan.entry);
  const units = object(firstValue(proposedTradePlan.units, economics.units));
  const entryKnown = entry.availability === "KNOWN"
    && Number.isFinite(Number(firstValue(entry.price, entry.calculation_price)));
  const instrumentSpecKnown = units.availability === "KNOWN"
    && Number.isFinite(Number(units.tick_size))
    && Number.isFinite(Number(units.tick_value))
    && Number.isFinite(Number(units.point_value));

  return reasonCodes.filter((reasonCode) => {
    if (reasonCode === "ENTRY_UNAVAILABLE" && entryKnown) return false;
    if (reasonCode === "INSTRUMENT_SPEC_UNAVAILABLE" && instrumentSpecKnown) return false;
    return true;
  });
}

export function signalTemporalRow(item, nowIso) {
  const signal = signalRow(item);
  const expiryMs = Date.parse(signal.expiresAt);
  const asOfMs = Date.parse(nowIso);
  const expiredByClock = ["NEW", "ARBITRATED"].includes(signal.state)
    && Number.isFinite(expiryMs)
    && Number.isFinite(asOfMs)
    && expiryMs <= asOfMs;

  return {
    ...signal,
    effectiveState: expiredByClock ? "EXPIRED" : signal.state,
    stateAsOf: nowIso,
    temporalReason: expiredByClock ? "EXPIRY_TIMESTAMP_ELAPSED" : null,
  };
}

function confidencePct(value) {
  const parsed = number(value, 0);
  return parsed > 0 && parsed <= 1 ? Math.round(parsed * 100) : parsed;
}

function frontSignalTradePlan(item = {}) {
  const existingPlan = item.proposed_trade_plan || null;
  const canonicalExistingPlan = canonicalStoredSignalPlan(existingPlan, item);
  const existingEconomics = item.trade_plan_economics || null;
  if (canonicalExistingPlan?.availability === "KNOWN" && existingEconomics?.availability === "KNOWN") {
    return {
      proposedTradePlan: canonicalExistingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || canonicalExistingPlan.availability,
    };
  }
  const setup = item.setup || {};
  if (!hasTradePlanHints(existingPlan, setup)) {
    return {
      proposedTradePlan: canonicalExistingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || canonicalExistingPlan?.availability || null,
    };
  }
  try {
    const normalized = normalizeProposedTradePlanV1({
      ...object(canonicalExistingPlan),
      instrument: firstValue(item.instrument, item.instrument_code, item.symbol, canonicalExistingPlan?.instrument),
      direction: firstValue(item.direction, item.side, canonicalExistingPlan?.direction),
      order_type: firstValue(canonicalExistingPlan?.order_type, setup.order_type, setup.orderType),
      time_in_force: firstValue(canonicalExistingPlan?.time_in_force, setup.time_in_force, setup.timeInForce, "DAY"),
      entry_price: firstValue(
        canonicalExistingPlan?.entry_price,
        canonicalExistingPlan?.entry?.price,
        canonicalExistingPlan?.entry?.calculation_price,
        setup.entry_price,
        setup.entryPrice,
        setup.entry,
      ),
      entry_zone: firstValue(canonicalExistingPlan?.entry_zone, setup.entry_zone, setup.entryZone),
      stop_price: firstValue(canonicalExistingPlan?.stop?.price, canonicalExistingPlan?.stop_price, setup.stop_price, setup.stopPrice, setup.stop, setup.stop_loss, setup.stopLoss),
      targets: firstValue(canonicalExistingPlan?.targets, setup.targets, setup.take_profit_targets, setup.takeProfitTargets, setup.target_prices, setup.targetPrices),
      source_data_cutoff_utc: firstValue(item.source_data_cutoff_utc, item.cutoff_at_utc, canonicalExistingPlan?.source?.source_data_cutoff_utc),
    });
    return {
      proposedTradePlan: normalized.proposed_trade_plan || canonicalExistingPlan,
      tradePlanEconomics: normalized.economics || existingEconomics,
      availability: normalized.proposed_trade_plan?.availability || item.availability || canonicalExistingPlan?.availability || null,
    };
  } catch {
    return {
      proposedTradePlan: canonicalExistingPlan,
      tradePlanEconomics: existingEconomics,
      availability: item.availability || canonicalExistingPlan?.availability || null,
    };
  }
}

function canonicalStoredSignalPlan(plan, item = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return plan;
  const source = object(plan.source);
  const rawKind = source.kind;
  const nestedKind = rawKind && typeof rawKind === "object"
    ? firstValue(rawKind.kind, rawKind.source_kind, rawKind.sourceKind, rawKind.type)
    : undefined;
  const kind = typeof firstValue(nestedKind, rawKind) === "string"
    ? firstValue(nestedKind, rawKind).trim()
    : "";
  const validKind = kind && kind.toLowerCase() !== "[object object]";
  if (validKind) return plan;

  return {
    ...plan,
    source: {
      ...source,
      kind: "strategy_signal_outbox",
      source_data_cutoff_utc: firstValue(
        source.source_data_cutoff_utc,
        source.sourceDataCutoff,
        item.source_data_cutoff_utc,
        item.cutoff_at_utc,
      ) || null,
    },
  };
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

function executionTermsOf(item = {}, payload = payloadOf(item)) {
  return firstValue(item.execution_terms, item.executionTerms, payload.execution_terms, payload.executionTerms) || {};
}

function priceNode(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  return firstValue(value.price, value.value, value.level, value.mid, value.center);
}

function firstTargetPrice(value) {
  const target = Array.isArray(value) ? value[0] : value;
  return priceNode(target);
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
    symbol: text(firstValue(item.instrument_code, item.broker_symbol, item.instrument, item.symbol), "unavailable"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    averagePrice: number(firstValue(item.avg_entry_price, item.entry_price), 0),
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
    providerId: text(item.provider_id, "Non publié"),
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
  if (state === "PENDING" || state === "PUBLISHED") return "NEW";
  return ["NEW", "ARBITRATED", "REJECTED", "ORDERED", "FILLED", "EXPIRED", "CLOSED", "CONSUMED", "CANCELLED"].includes(state) ? state : "NEW";
}

function providerState(item) {
  const state = upper(item.status || item.health);
  if (item.enabled === false || ["DOWN", "DISCONNECTED", "FAILED"].includes(state)) return "DOWN";
  if (["DEGRADED", "STALE", "WATCH"].includes(state)) return "DEGRADED";
  return "OK";
}
