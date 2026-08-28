import { codedError, text } from "./front-control-plane-common.js";
import { number, rows } from "./front-control-plane-projection-helpers.js";
import { orderRow, positionRow, signalRow, signalTemporalRow } from "./front-control-plane-row-mappers.js";

export function liveSignalDetail({ strategy, execution, risk, ai, query, nowIso }) {
  const source = selectById(rows(nested(strategy, ["signals"])), query.signalId, (item) => firstValue(item.signal_outbox_id, item.signal_id), "LIVE_SIGNAL_NOT_FOUND");
  const signal = signalRow(source);
  const matchingOrders = rows(nested(execution, ["orders"])).filter((item) => text(item.signal_id, "") === signal.signalId).map(orderRow);
  const identityValue = { signalId: signal.signalId, strategyId: signal.strategyId, strategyDefinitionId: signal.strategyId, strategyVersionId: signal.strategyVersionId, strategyInstanceId: signal.strategyInstanceId, runtimeBundleId: text(source.runtime_bundle_id, "unavailable"), sessionId: text(source.session_id, "unavailable"), correlationId: text(source.correlation_id, "unavailable"), featureSnapshotId: signal.featureSnapshotId, expectedVersion: text(source.revision, "0") };
  return {
    summary: liveSignalSummary({ signal, source, risk, nowIso }),
    identity: identityValue,
    signal: liveSignalBody({ source, nowIso }),
    predicates: rows(source.predicates),
    featureSnapshot: liveSignalFeatureSnapshot({ signal, source, nowIso }),
    context: [],
    conflicts: [],
    existingPositions: rows(nested(execution, ["trades"])).map(positionRow),
    arbitration: liveSignalArbitration({ source, matchingOrders }),
    riskCheck: liveSignalRiskCheck({ source, risk }),
    linkedOrders: matchingOrders,
    auditTrail: [],
    aiAdvisory: liveSignalAiAdvisory({ ai, nowIso }),
    navigation: [{ label: "Stratégie", route: `/strategies/${signal.strategyId}`, kind: "STRATEGY" }, { label: "Ordres", route: "/orders", kind: "ORDERS" }],
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
    expectancyR: signal.expectancyR,
    rewardRisk: signal.rewardRisk,
    regime: signal.regime,
    entryZoneLow: number(firstValue(source.entry_zone_low, source.entry_price), 0),
    entryZoneHigh: number(firstValue(source.entry_zone_high, source.entry_price), 0),
    stopPrice: number(source.stop_price, 0),
    targetPrice: number(source.target_price, 0),
  };
}
function liveSignalFeatureSnapshot({ signal, source, nowIso }) {
  return { featureSnapshotId: signal.featureSnapshotId, datasetId: text(source.dataset_id, "unavailable"), cutoffAt: text(firstValue(source.cutoff_at_utc, source.created_at_utc), nowIso), hash: text(source.feature_snapshot_hash, "unavailable"), pointInTime: true, freshness: source.feature_snapshot_id ? "FRESH" : "WATCH", items: rows(source.features) };
}
function liveSignalArbitration({ source, matchingOrders }) {
  const linked = matchingOrders.length > 0;
  return { arbitrationId: text(source.arbitration_id, "unavailable"), decision: linked ? "ACCEPTED" : "REJECTED", targetQuantity: number(source.target_quantity, 0), conflictStatus: "CLEAR", correlationPct: number(source.correlation_pct, 0), reasonCode: text(source.reason_code, linked ? "ORDER_LINKED" : "ARBITRATION_UNAVAILABLE"), portfolioRoute: "/portfolio" };
}
function liveSignalRiskCheck({ source, risk }) {
  return { riskCheckId: text(source.risk_check_id, "unavailable"), status: source.risk_check_status === "PASS" ? "PASS" : "WATCH", limitLabel: text(source.risk_limit_label, "Donnée risk check indisponible"), usedPct: number(nested(risk, ["summary", "risk_percent"]), 0), reasonCode: text(source.risk_reason_code, "RISK_CHECK_UNAVAILABLE"), maxRiskPct: number(source.max_risk_pct, 0), netCapital: firstNumber(nested(risk, ["accounts"]), "capital"), targetRiskR: number(source.target_risk_r, 0), roundedQuantity: number(source.target_quantity, 0) };
}
function liveSignalAiAdvisory({ ai, nowIso }) {
  return { mode: "ADVISORY", lastContextAt: firstValue(nested(ai, ["generatedAt"]), nowIso), summary: text(nested(ai, ["summary", "status"]), "Contexte IA indisponible."), authority: "NONE", recommendation: "WAIT" };
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
function firstValue(...values) { for (const value of values) if (value !== null && value !== undefined && value !== "") return value; return undefined; }
function nested(source, path) { let value = source; for (const key of path) { if (!value || typeof value !== "object") return undefined; value = value[key]; } return value; }
