import { codedError, text } from "./front-control-plane-common.js";
import { number, rows } from "./front-control-plane-projection-helpers.js";
import { orderRow, positionRow, signalRow, signalTemporalRow } from "./front-control-plane-row-mappers.js";
import { portfolioIntentSignalId, portfolioOrderIntentSummaryRow } from "./front-control-plane-domain-completeness.js";

export function liveSignalDetail({ strategy, execution, risk, ai, query, nowIso, actor }) {
  const source = selectById(rows(nested(strategy, ["signals"])), query.signalId, (item) => firstValue(item.signal_outbox_id, item.signal_id), "LIVE_SIGNAL_NOT_FOUND");
  const signal = signalRow(source);
  const matchingOrders = rows(nested(execution, ["orders"])).filter((item) => signalIdOf(item) === signal.signalId).map(orderRow);
  const matchingIntents = rows(nested(execution, ["portfolioOrderIntents"]))
    .filter((item) => portfolioIntentSignalId(item) === signal.signalId);
  const primaryIntent = matchingIntents[0] || null;
  const contextDecisions = rows(nested(ai, ["decisions"])).filter((item) => text(item.signal_id || item.strategy_signal_id, "") === signal.signalId);
  const identityValue = { signalId: signal.signalId, strategyId: signal.strategyId, strategyDefinitionId: signal.strategyId, strategyVersionId: signal.strategyVersionId, strategyInstanceId: signal.strategyInstanceId, runtimeBundleId: text(source.runtime_bundle_id, "unavailable"), sessionId: text(source.session_id, "unavailable"), correlationId: text(source.correlation_id, "unavailable"), featureSnapshotId: signal.featureSnapshotId, expectedVersion: text(source.revision, "0") };
  return {
    summary: liveSignalSummary({ signal, source, risk, nowIso }),
    identity: identityValue,
    signal: liveSignalBody({ source, nowIso }),
    predicates: liveSignalPredicates(source),
    featureSnapshot: liveSignalFeatureSnapshot({ signal, source, nowIso }),
    context: liveSignalContext(contextDecisions),
    conflicts: [],
    existingPositions: rows(nested(execution, ["trades"])).map(positionRow),
    arbitration: liveSignalArbitration({ source, primaryIntent }),
    riskCheck: liveSignalRiskCheck({ source, risk, primaryIntent }),
    linkedOrderIntents: matchingIntents.map((item) => portfolioOrderIntentSummaryRow({ execution, item, actor })),
    linkedOrders: matchingOrders,
    auditTrail: [],
    aiAdvisory: liveSignalAiAdvisory({ decisions: contextDecisions, ai, nowIso }),
    navigation: [
      { label: "Stratégie", route: `/strategies/${signal.strategyId}`, kind: "STRATEGY" },
      ...(primaryIntent ? [{ label: "OrderIntent principal", route: `/execution/orders/${encodeURIComponent(text(primaryIntent.portfolio_order_intent_id, ""))}`, kind: "ORDERS" }] : []),
      { label: "Ordres", route: "/orders", kind: "ORDERS" },
    ],
    commandActions: [],
  };
}

function liveSignalSummary({ signal, source, risk, nowIso }) {
  return {
    signalScore: signal.confidence,
    timeToExpirySec: Math.max(0, Math.floor((Date.parse(signal.expiresAt) - Date.parse(nowIso)) / 1000)),
    acceptanceProbabilityPct: signal.confidence,
    targetQuantity: number(source.target_quantity, 0),
    riskUsedPct: number(nested(risk, ["summary", "risk_percent"]), 0),
    conflictCount: 0,
  };
}
function liveSignalBody({ source, nowIso }) {
  const signal = signalTemporalRow(source, nowIso);
  const tradePlan = signal.proposedTradePlan || {};
  const economics = signal.tradePlanEconomics || tradePlan.economics || {};
  const entry = tradePlan.entry || {};
  const stop = tradePlan.stop || {};
  const firstTarget = rows(tradePlan.targets)[0] || {};
  const firstTargetEconomics = rows(economics.targets)[0] || {};
  return {
    symbol: signal.symbol,
    direction: signal.direction,
    state: signal.state,
    effectiveState: signal.effectiveState,
    stateAsOf: signal.stateAsOf,
    temporalReason: signal.temporalReason,
    generatedAt: signal.createdAt,
    expiresAt: signal.expiresAt,
    confidence: signal.confidence,
    expectancyR: nullableNumber(firstValue(source.expectancy_R, source.expectancy_r, firstTargetEconomics.expected_r, firstTarget.expected_r)),
    rewardRisk: nullableNumber(firstValue(source.reward_risk, firstTargetEconomics.reward_risk, firstTarget.reward_risk)),
    regime: signal.regime,
    entryZoneLow: nullableNumber(firstValue(source.entry_zone_low, entry.low, source.entry_price, entry.price, entry.calculation_price)),
    entryZoneHigh: nullableNumber(firstValue(source.entry_zone_high, entry.high, source.entry_price, entry.price, entry.calculation_price)),
    stopPrice: nullableNumber(firstValue(source.stop_price, stop.price)),
    targetPrice: nullableNumber(firstValue(source.target_price, firstTarget.price)),
  };
}
function liveSignalFeatureSnapshot({ signal, source, nowIso }) {
  return { featureSnapshotId: signal.featureSnapshotId, datasetId: text(source.dataset_id, "unavailable"), cutoffAt: text(firstValue(source.cutoff_at_utc, source.created_at_utc), nowIso), hash: text(source.feature_snapshot_hash, "unavailable"), pointInTime: true, freshness: source.feature_snapshot_id ? "FRESH" : "WATCH", items: rows(source.features) };
}
function liveSignalArbitration({ source, primaryIntent }) {
  const payload = primaryIntent?.order_intent_payload || primaryIntent?.payload || {};
  const arbitrationId = firstValue(primaryIntent?.portfolio_arbitration_run_id, payload.portfolio_arbitration_run_id, source.arbitration_id);
  const decision = text(firstValue(payload.portfolio_arbitration_decision, primaryIntent?.status), "").toUpperCase();
  return {
    arbitrationId: text(arbitrationId, "unavailable"),
    decision: decision.includes("REJECT") ? "REJECTED" : decision.includes("SCALE") ? "SCALED" : primaryIntent ? "ACCEPTED" : "REJECTED",
    targetQuantity: number(firstValue(primaryIntent?.risk_approved_net_size, payload.quantity, source.target_quantity), 0),
    conflictStatus: "CLEAR",
    correlationPct: number(source.correlation_pct, 0),
    reasonCode: text(firstValue(rows(payload.portfolio_arbitration_reason_codes)[0], source.reason_code), primaryIntent ? "PORTFOLIO_INTENT_PUBLISHED" : "ARBITRATION_UNAVAILABLE"),
    portfolioRoute: "/portfolio",
  };
}
function liveSignalRiskCheck({ source, risk, primaryIntent }) {
  const payload = primaryIntent?.order_intent_payload || primaryIntent?.payload || {};
  const riskDecision = rows(primaryIntent?.risk_decisions)[0] || null;
  const rawStatus = text(firstValue(riskDecision?.decision, riskDecision?.status, source.risk_check_status), "").toUpperCase();
  return {
    riskCheckId: text(firstValue(riskDecision?.risk_decision_id, rows(primaryIntent?.risk_decision_ids)[0], source.risk_check_id), "unavailable"),
    status: rawStatus.includes("REJECT") || rawStatus.includes("BLOCK") ? "BLOCK" : rawStatus.includes("PASS") || rawStatus.includes("APPROV") || primaryIntent ? "PASS" : "WATCH",
    limitLabel: text(firstValue(nested(riskDecision, ["nearest_limit", "type"]), source.risk_limit_label), "Donnée risk check indisponible"),
    usedPct: number(nested(risk, ["summary", "risk_percent"]), 0),
    reasonCode: text(firstValue(rows(riskDecision?.reason_codes)[0], rows(payload.risk_reason_codes)[0], source.risk_reason_code), "RISK_CHECK_UNAVAILABLE"),
    maxRiskPct: number(firstValue(nested(riskDecision, ["authorized", "risk_pct"]), source.max_risk_pct), 0),
    netCapital: firstNumber(nested(risk, ["accounts"]), "capital"),
    targetRiskR: number(firstValue(nested(riskDecision, ["trade_risk", "risk_r"]), source.target_risk_r), 0),
    roundedQuantity: number(firstValue(riskDecision?.approved_size, primaryIntent?.risk_approved_net_size, source.target_quantity), 0),
  };
}
function liveSignalAiAdvisory({ decisions, ai, nowIso }) {
  const decision = decisions[0] || null;
  const recommendation = text(decision?.recommendation || decision?.decision, "WAIT").toUpperCase();
  return { mode: "ADVISORY", lastContextAt: firstValue(decision?.decided_at_utc, nested(ai, ["generatedAt"]), nowIso), summary: text(decision?.summary || decision?.reason || nested(ai, ["summary", "status"]), "Contexte IA indisponible."), authority: "NONE", recommendation: ["TAKE", "TAKE_REDUCED", "REJECT"].includes(recommendation) ? recommendation : "WAIT" };
}

function liveSignalPredicates(source) {
  const explicit = rows(firstValue(source.predicates, nested(source, ["setup", "predicates"]), nested(source, ["setup", "conditions"])));
  const normalized = explicit.map((item, index) => {
    if (typeof item === "string") return predicateRow(item, index, {});
    return predicateRow(text(firstValue(item.label, item.name, item.enum_code, item.predicate_id), `Règle ${index + 1}`), index, item);
  });
  if (normalized.length) return normalized;
  return rows(source.rule_hits).map((item, index) => predicateRow(String(item), index, {}));
}

function predicateRow(label, index, item) {
  const status = text(firstValue(item.status, item.result), "PASS").toUpperCase();
  return {
    predicateId: text(firstValue(item.predicate_id, item.id), `predicate-${index + 1}`),
    label,
    enumCode: text(firstValue(item.enum_code, item.code), label),
    observedValue: text(firstValue(item.observed_value, item.observed, item.value), "Condition observée"),
    threshold: text(firstValue(item.threshold, item.expected), "Condition satisfaite"),
    status: status.includes("FAIL") ? "FAIL" : status.includes("WATCH") ? "WATCH" : "PASS",
    sourceFeatureId: text(firstValue(item.source_feature_id, item.feature_id), "strategy_signal_outbox"),
  };
}

function liveSignalContext(decisions) {
  return decisions.map((item, index) => {
    const recommendation = text(item.recommendation || item.decision || item.status, "WAIT").toUpperCase();
    return {
      contextId: text(item.ai_context_gate_decision_id || item.context_decision_id || item.decision_id, `context-${index + 1}`),
      label: "Décision Context Gate",
      value: recommendation,
      interpretation: rows(item.reason_codes).length ? rows(item.reason_codes).join(" · ") : text(item.reason || item.summary, "Décision contextuelle publiée sans reason code."),
      tone: recommendation.includes("REJECT") || recommendation.includes("BLOCK") ? "NEGATIVE" : recommendation.includes("TAKE") || recommendation.includes("ACCEPT") || recommendation.includes("PASS") ? "POSITIVE" : "WATCH",
    };
  });
}

function signalIdOf(item) {
  const payload = item?.order_intent_payload || item?.payload || {};
  const lineage = item?.lineage || payload.lineage || payload.source?.lineage || {};
  return text(firstValue(item?.signal_id, item?.strategy_signal_id, payload.signal_id, rows(lineage.strategy_signal_ids)[0]), "");
}
function selectById(items, requestedId, idOf, errorCode) {
  const expected = text(requestedId, "");
  const match = rows(items).find((item) => text(idOf(item), "") === expected);
  if (!match) throw codedError(errorCode, `${errorCode}: ${expected}`, 404);
  return match;
}
function firstNumber(value, key) {
  const found = rows(value).map((item) => number(item?.[key], null)).find((item) => item !== null);
  return found || 0;
}
function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function firstValue(...values) { for (const value of values) if (value !== null && value !== undefined && value !== "") return value; return undefined; }
function nested(source, path) { let value = source; for (const key of path) { if (!value || typeof value !== "object") return undefined; value = value[key]; } return value; }
