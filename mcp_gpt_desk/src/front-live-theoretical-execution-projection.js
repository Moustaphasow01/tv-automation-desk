const ATTRIBUTION_POLICY_VERSION = "operator_outcome_attribution_v1";
const TERMINAL_TRADE_STATES = new Set(["CLOSED", "CANCELLED", "REJECTED", "EXPIRED", "ERROR"]);
const MANUAL_EXECUTION_EVIDENCE = new Set(["PLACED", "FILLED", "CLOSED"]);
const DEFAULT_PROJECTION_NOW_UTC = "1970-01-01T00:00:00.000Z";

export function buildLiveTheoreticalExecution({ execution = {}, nowIso = DEFAULT_PROJECTION_NOW_UTC } = {}) {
  const intents = rows(execution.portfolioOrderIntents).filter((item) => portfolioIntentId(item));
  const projectedRows = intents.map((intent) => theoreticalRow({ execution, intent })).sort(byLatestActivity);
  const closed = projectedRows.filter((item) => item.tradeStatus === "CLOSED" && item.resultR !== null);
  return {
    schemaVersion: "live_theoretical_execution_v1",
    availability: projectedRows.length ? "AVAILABLE" : "CONNECTED_EMPTY",
    status: projectedRows.length ? "TRACKING" : "EMPTY",
    source: "portfolio_order_intent_lineage+trade_theoretical_execution_events+trade_outcomes+trade_manual_execution_events",
    asOf: latestIso(projectedRows.flatMap((item) => [item.latestEventAt, item.operatorDecisionAt, item.manualExecutionAt, item.exitAt])) || nowIso,
    attributionPolicyVersion: ATTRIBUTION_POLICY_VERSION,
    summary: {
      trackedIntents: projectedRows.length,
      working: count(projectedRows, (item) => ["WORKING", "AWAITING_ENTRY"].includes(item.status)),
      entryFilled: count(projectedRows, (item) => ["ENTRY_FILLED", "TARGET_HIT", "STOP_HIT"].includes(item.status)),
      targetHit: count(projectedRows, (item) => item.status === "TARGET_HIT"),
      stopHit: count(projectedRows, (item) => item.status === "STOP_HIT"),
      expired: count(projectedRows, (item) => ["ENTRY_EXPIRED", "EXPIRED"].includes(item.status)),
      reviewRequired: count(projectedRows, (item) => item.status === "EXIT_REVIEW_REQUIRED"),
      openTrades: count(projectedRows, (item) => item.tradeStatus && !TERMINAL_TRADE_STATES.has(item.tradeStatus)),
      closedTrades: closed.length,
      totalClosedR: roundR(closed.reduce((sum, item) => sum + Number(item.resultR || 0), 0)),
      operatorCaptured: count(projectedRows, (item) => item.outcomeAttribution.status === "CAPTURED"),
      operatorMissed: count(projectedRows, (item) => item.outcomeAttribution.status === "MISSED_OPPORTUNITY"),
      operatorAvoidedLoss: count(projectedRows, (item) => item.outcomeAttribution.status === "AVOIDED_LOSS"),
      operatorUnverified: count(projectedRows, (item) => item.outcomeAttribution.status === "EXECUTION_UNVERIFIED"),
    },
    rows: projectedRows,
  };
}

export function theoreticalPerformanceR(projection, nowIso = DEFAULT_PROJECTION_NOW_UTC) {
  const finalRows = rows(projection?.rows)
    .filter((item) => item.tradeStatus === "CLOSED" && finiteOrNull(item.resultR) !== null)
    .sort((left, right) => Date.parse(left.exitAt || left.latestEventAt || "") - Date.parse(right.exitAt || right.latestEventAt || ""));
  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  const series = finalRows.map((item, index) => {
    cumulativeR = roundR(cumulativeR + Number(item.resultR));
    peakR = Math.max(peakR, cumulativeR);
    const drawdownR = roundR(cumulativeR - peakR);
    maxDrawdownR = Math.min(maxDrawdownR, drawdownR);
    return { sequence: index + 1, at: item.exitAt || item.latestEventAt, resultR: Number(item.resultR), cumulativeR, drawdownR };
  });
  const tradingDay = String(nowIso || "").slice(0, 10);
  const dailyR = roundR(finalRows.filter((item) => String(item.exitAt || item.latestEventAt || "").slice(0, 10) === tradingDay).reduce((sum, item) => sum + Number(item.resultR || 0), 0));
  const wins = count(finalRows, (item) => Number(item.resultR) > 0);
  return {
    availability: finalRows.length ? "AVAILABLE" : "CONNECTED_EMPTY",
    sourceType: "THEORETICAL_BACKEND",
    totalR: finalRows.length ? roundR(cumulativeR) : null,
    dailyR: finalRows.length ? dailyR : null,
    drawdownR: finalRows.length ? maxDrawdownR : null,
    sampleSize: finalRows.length,
    hitRatePct: finalRows.length ? Math.round((wins / finalRows.length) * 10_000) / 100 : null,
    series,
    asOf: projection?.asOf || nowIso,
  };
}

export function theoreticalTimelineEvents(projection) {
  return rows(projection?.rows).filter((item) => item.latestEventType && item.latestEventAt).map((item) => ({
    eventId: `theoretical:${item.portfolioOrderIntentId}:${item.latestEventType}:${item.latestEventAt}`,
    at: item.latestEventAt,
    step: "THEORETICAL_EXECUTION",
    title: theoreticalEventLabel(item.latestEventType),
    detail: `${item.instrument} ${item.side} · ${item.outcomeAttribution.status}${item.resultR === null ? "" : ` · ${item.resultR}R`}`,
    tone: item.latestEventType === "STOP_HIT" ? "HIGH" : item.latestEventType === "TARGET_HIT" ? "INFO" : "WATCH",
  }));
}

function theoreticalRow({ execution, intent }) {
  const id = portfolioIntentId(intent);
  const payload = object(intent.order_intent_payload || intent.payload);
  const events = rows(execution.theoreticalEvents).filter((event) => String(event.portfolio_order_intent_id || "") === id).sort(byEventTimeDesc);
  const tradeIds = new Set(events.map((event) => String(event.trade_id || "")).filter(Boolean));
  const trade = rows(execution.trades).find((item) => String(item.portfolio_order_intent_id || "") === id || tradeIds.has(String(item.trade_id || ""))) || null;
  const gate = rows(execution.humanExecutionGates).find((item) => String(item.portfolio_order_intent_id || "") === id) || null;
  const gateEvents = rows(execution.humanExecutionGateEvents).filter((event) => String(event.portfolio_order_intent_id || "") === id).sort(byOccurredDesc);
  const manualEvents = rows(execution.manualExecutionEvents).filter((event) => String(event.portfolio_order_intent_id || "") === id || (trade?.trade_id && String(event.trade_id || "") === String(trade.trade_id))).sort(byOccurredDesc);
  const latestEvent = events[0] || null;
  const latestManual = manualEvents[0] || null;
  const latestDecision = gateEvents.find((event) => ["CONFIRMED", "REJECTED", "REVERTED", "EXPIRED"].includes(upper(event.event_type))) || null;
  const status = theoreticalStatus({ latestEvent, trade, gate, intent });
  const resultR = upper(trade?.status) === "CLOSED" ? finiteOrNull(trade?.result_r) : null;
  const attribution = operatorOutcomeAttribution({ gate, latestDecision, latestManual, resultR, trade });
  const terms = object(intent.execution_terms || payload.execution_terms || payload.approved_trade_plan);
  const protection = object(payload.protection);
  const targets = targetRows(payload, terms, protection);
  const entry = firstFinite(nested(terms, "entry", "price"), nested(payload, "entry", "price"), payload.entry_price, payload.limit_price, payload.stop_price);
  return {
    portfolioOrderIntentId: id,
    targetPositionId: text(intent.target_position_id || payload.target_position_id),
    strategySignalId: signalId(intent, payload),
    strategyId: text(payload.strategy_id || nested(payload, "source", "strategy_id") || intent.strategy_id),
    strategyInstanceId: text(payload.strategy_instance_id || nested(payload, "source", "strategy_instance_id") || intent.strategy_instance_id),
    instrument: upper(payload.instrument || terms.instrument || intent.target_instrument),
    side: normalizeSide(payload.action || payload.side || terms.side),
    orderType: upper(payload.order_type || terms.order_type),
    quantity: finiteOrNull(intent.quantity ?? payload.quantity ?? terms.quantity),
    entry,
    stop: firstFinite(protection.stop_price, nested(terms, "stop", "price"), terms.stop_price),
    targets,
    expectedR: firstFinite(payload.expected_r, payload.reward_risk, nested(payload, "trade_plan_economics", "reward_risk"), nested(terms, "economics", "reward_risk")),
    status,
    latestEventType: upper(latestEvent?.event_type || status),
    latestEventAt: iso(latestEvent?.event_at_utc || trade?.updated_at || intent.updated_at_utc || intent.created_at_utc),
    entryFilledAt: iso(events.find((event) => upper(event.event_type) === "ENTRY_FILLED")?.event_at_utc || trade?.opened_at),
    entryFillPrice: firstFinite(events.find((event) => upper(event.event_type) === "ENTRY_FILLED")?.price, trade?.avg_entry_price),
    exitAt: iso(events.find((event) => ["TARGET_HIT", "STOP_HIT"].includes(upper(event.event_type)))?.event_at_utc || trade?.closed_at),
    exitPrice: firstFinite(events.find((event) => ["TARGET_HIT", "STOP_HIT"].includes(upper(event.event_type)))?.price, trade?.avg_exit_price),
    resultR,
    tradeId: text(trade?.trade_id),
    tradeStatus: upper(trade?.status),
    sourceCandleAt: iso(latestEvent?.source_candle_timestamp_utc),
    sourceTimeframe: text(nested(latestEvent, "payload", "candle", "timeframe") || nested(latestEvent, "raw", "candle", "timeframe")),
    physicalExecutionCreated: rows(execution.providerCommands).some((command) => String(command.portfolio_order_intent_id || "") === id),
    brokerEvidence: rows(execution.providerEvents).some((event) => String(event.portfolio_order_intent_id || "") === id) ? "PROVIDER_EVENT_RECORDED" : "NONE",
    operatorDecision: upper(gate?.status || latestDecision?.event_type || "NOT_RECORDED"),
    operatorDecisionAt: iso(latestDecision?.occurred_at_utc || gate?.confirmed_at_utc || gate?.rejected_at_utc || gate?.updated_at_utc),
    operatorActor: text(latestDecision?.operator_id || gate?.operator_id),
    manualExecutionStatus: upper(latestManual?.event_type || "NOT_REPORTED"),
    manualExecutionAt: iso(latestManual?.occurred_at_utc),
    outcomeAttribution: attribution,
  };
}

function operatorOutcomeAttribution({ gate, latestDecision, latestManual, resultR, trade }) {
  const manualStatus = upper(latestManual?.event_type);
  const decision = upper(gate?.status || latestDecision?.event_type);
  const finalOutcome = upper(trade?.status) === "CLOSED" && resultR !== null;
  if (!finalOutcome) return attribution("PENDING_OUTCOME", resultR, null, null, null, "THEORETICAL_OUTCOME_NOT_FINAL");
  if (MANUAL_EXECUTION_EVIDENCE.has(manualStatus)) return attribution("CAPTURED", resultR, resultR, 0, 0, "MANUAL_EXECUTION_EVIDENCE_RECORDED");
  if (manualStatus === "SKIPPED" || ["REJECTED", "EXPIRED"].includes(decision)) {
    if (resultR > 0) return attribution("MISSED_OPPORTUNITY", resultR, 0, resultR, 0, manualStatus === "SKIPPED" ? "MANUAL_SKIP_RECORDED" : `HUMAN_GATE_${decision}`);
    if (resultR < 0) return attribution("AVOIDED_LOSS", resultR, 0, resultR, Math.abs(resultR), manualStatus === "SKIPPED" ? "MANUAL_SKIP_RECORDED" : `HUMAN_GATE_${decision}`);
    return attribution("NOT_TAKEN_FLAT", resultR, 0, 0, 0, "THEORETICAL_OUTCOME_FLAT");
  }
  if (decision === "CONFIRMED") return attribution("EXECUTION_UNVERIFIED", resultR, null, null, null, "CONFIRMATION_IS_NOT_MANUAL_FILL_EVIDENCE");
  return attribution("OPERATOR_DECISION_UNKNOWN", resultR, null, null, null, "NO_OPERATOR_EXECUTION_EVIDENCE");
}

function attribution(status, theoreticalResultR, capturedR, missedR, avoidedLossR, reasonCode) {
  return { policyVersion: ATTRIBUTION_POLICY_VERSION, status, theoreticalResultR, capturedR, missedR, avoidedLossR, reasonCode };
}

function theoreticalStatus({ latestEvent, trade, gate, intent }) {
  const event = upper(latestEvent?.event_type);
  if (event === "ENTRY_EXPIRED") return "ENTRY_EXPIRED";
  if (event) return event;
  if (trade) return upper(trade.status) === "CLOSED" ? "CLOSED" : "ENTRY_FILLED";
  if (["EXPIRED", "REJECTED", "INVALIDATED"].includes(upper(gate?.status || intent.status))) return "EXPIRED";
  return "AWAITING_ENTRY";
}

function targetRows(payload, terms, protection) {
  const rawTargets = rows(payload.targets).length ? rows(payload.targets) : rows(terms.targets);
  if (rawTargets.length) return rawTargets.map((target, index) => ({ label: text(target?.label, `T${index + 1}`), price: firstFinite(target?.price, target?.value, target), ratioR: firstFinite(target?.ratio_r, target?.ratioR) }));
  const single = firstFinite(protection.target_price, terms.target_price);
  return single === null ? [] : [{ label: "T1", price: single, ratioR: null }];
}

function signalId(intent, payload) {
  const lineage = object(intent.lineage || payload.lineage || nested(payload, "source", "lineage"));
  return text(intent.signal_id || payload.signal_id || payload.strategy_signal_id || rows(lineage.strategy_signal_ids)[0] || payload.source_signal_id || nested(payload, "approved_trade_plan", "source_signal_id"));
}

function portfolioIntentId(intent) { return text(intent?.portfolio_order_intent_id || intent?.order_intent_payload?.order_intent_id || intent?.payload?.order_intent_id); }
function byLatestActivity(left, right) { return Date.parse(right.latestEventAt || right.operatorDecisionAt || "") - Date.parse(left.latestEventAt || left.operatorDecisionAt || ""); }
function byEventTimeDesc(left, right) { return Date.parse(right.event_at_utc || right.created_at_utc || "") - Date.parse(left.event_at_utc || left.created_at_utc || ""); }
function byOccurredDesc(left, right) { return Date.parse(right.occurred_at_utc || right.created_at_utc || "") - Date.parse(left.occurred_at_utc || left.created_at_utc || ""); }
function theoreticalEventLabel(value) { return ({ ENTRY_FILLED: "Entrée théorique touchée", ENTRY_EXPIRED: "Entrée théorique expirée", TARGET_HIT: "Objectif théorique touché", STOP_HIT: "Stop théorique touché", EXIT_REVIEW_REQUIRED: "Sortie théorique à revoir" })[upper(value)] || `Suivi théorique ${upper(value)}`; }
function normalizeSide(value) {
  const normalized = upper(value);
  if (["SELL", "SHORT"].includes(normalized)) return "SHORT";
  if (["BUY", "LONG"].includes(normalized)) return "LONG";
  return "UNKNOWN";
}
function latestIso(values) { return values.map(iso).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""; }
function firstFinite(...values) { for (const value of values) { const parsed = finiteOrNull(value); if (parsed !== null) return parsed; } return null; }
function finiteOrNull(value) { if (value === null || value === undefined || value === "" || typeof value === "object") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function rows(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function nested(source, ...path) { let value = source; for (const key of path) { if (!value || typeof value !== "object") return null; value = value[key]; } return value; }
function count(items, predicate) { return items.filter(predicate).length; }
function upper(value) { return String(value || "").trim().toUpperCase(); }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function roundR(value) { return Math.round(Number(value || 0) * 10_000) / 10_000; }
