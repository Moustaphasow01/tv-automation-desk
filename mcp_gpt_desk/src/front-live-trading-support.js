export function marketSessionState(readiness = {}) {
  if (readiness.market_closed === true) return "MARKET_CLOSED";
  const state = upper(readiness.market_state || readiness.market_session?.state || readiness.state);
  if (state === "TRADING_DAY") return "TRADING_DAY";
  if (["OPEN", "PREOPEN", "HALTED", "CLOSED"].includes(state)) return state;
  return readiness.ok === true ? "OPEN" : "UNKNOWN";
}

export function liveMacroSession({ macro, news, scope, marketSeries }) {
  const macroItems = rows(macro);
  const newsItems = rows(news);
  return {
    availability: macro || news ? "KNOWN" : "UNAVAILABLE",
    sessionId: text(scope.session, "unavailable"), marketSession: text(scope.session, "unavailable"),
    volatilityRegime: "UNAVAILABLE", nextScheduledEvent: macroItems[0] || null,
    macroEvents: macroItems.slice(0, 20), news: newsItems.slice(0, 20), dataCutoff: marketSeries?.asOf || null,
    macroSource: macro ? "front_macro_resource" : null, newsSource: news ? "front_news_headlines_resource" : null,
  };
}

export function liveReconciliation(execution = {}, nominalIntentIds = new Set()) {
  const physical = execution?.safety?.physicalExecutionEnabled === true || execution?.safety?.liveAccountAllowed === true;
  // A historical broker snapshot is not evidence of a current reconciliation when
  // physical execution is disabled. Keep legacy history out of the nominal Live
  // projection and fail closed until the backend policy enables a comparable pair.
  if (!physical) return emptyReconciliation(false);
  const states = rows(execution.portfolioExecutionStates).filter((item) => nominalIntentIds.has(String(item.portfolio_order_intent_id || "")));
  const latest = rows(execution.reconciliations)[0] || null;
  if (!latest && !states.length) return emptyReconciliation(physical);
  return knownReconciliation(latest, states);
}

function emptyReconciliation(physical) {
  return {
    availability: physical ? "UNAVAILABLE" : "NOT_APPLICABLE_CURRENT_MODE",
    status: physical ? "NOT_RUN" : "PHYSICAL_EXECUTION_DISABLED", mismatchCount: null, expected: null,
    broker: physical ? null : { availability: "NOT_APPLICABLE_CURRENT_MODE" }, asOf: null,
    reason: physical ? "No canonical reconciliation snapshot has been published." : "Physical execution is disabled by policy; no broker snapshot is expected.",
    source: "broker_reconciliation_runs+portfolio_order_intent_execution_states",
  };
}

function knownReconciliation(latest, states) {
  const state = states[0] || {};
  const source = latest || {};
  const statePayload = state.payload || {};
  return {
    availability: "KNOWN", status: text(source.status, states.length ? "PARTIAL" : "UNKNOWN").toUpperCase(),
    mismatchCount: nullableMetric(source.mismatch_count), expected: source.desk_snapshot || statePayload.expected || null,
    broker: source.broker_snapshot || statePayload.broker || null,
    asOf: text(source.completed_at || source.started_at || state.updated_at_utc, "unavailable"), reason: null,
    source: "broker_reconciliation_runs+portfolio_order_intent_execution_states",
  };
}

export function liveInstanceConfidence(instances = [], signals = [], nowIso = null) {
  const nowMs = Date.parse(nowIso || "");
  const byInstance = new Map();
  for (const signal of signals) {
    const key = signal.strategyInstanceId;
    if (!key || key === "unavailable") continue;
    const expiresMs = Date.parse(signal.expiresAt || "");
    if (Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs) continue;
    const createdMs = Date.parse(signal.createdAt || "");
    const existing = byInstance.get(key);
    if (!existing || (Number.isFinite(createdMs) && createdMs > existing.createdMs)) {
      byInstance.set(key, { signalId: signal.signalId, confidence: signal.confidence, createdMs: Number.isFinite(createdMs) ? createdMs : -Infinity });
    }
  }
  return rows(instances).map((instance) => {
    const match = byInstance.get(instance.strategyInstanceId);
    return { ...instance, confidence: match ? match.confidence : null, confidenceSourceSignalId: match ? match.signalId : null };
  });
}

export function liveWatchlist(liveMarketSnapshot = null, { preferredSymbols = [] } = {}) {
  const instruments = liveMarketSnapshot?.instruments || {};
  const preferred = new Set(rows(preferredSymbols).map(canonicalInstrument).filter(Boolean));
  const available = Object.values(instruments)
    .filter((item) => item && item.symbol)
    .map((item) => ({
      symbol: canonicalInstrument(text(item.symbol, "unavailable")),
      last: nullableMetric(item.latest_close),
      changePct: nullableMetric(item.change_pct),
      trend: rows(item.intraday_series).slice(-30).map((point) => nullableMetric(point.close)).filter((value) => value !== null),
      asOf: text(item.latest_timestamp_paris, "unavailable"),
      availability: text(item.availability, "UNAVAILABLE").toUpperCase(),
    }));
  const focused = preferred.size ? available.filter((item) => preferred.has(item.symbol)) : available;
  return focused.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function canonicalInstrument(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return ({ "ZC1!": "ZC", "ZW1!": "ZW", "MNQ1!": "MNQ", "MES1!": "MES" })[symbol] || symbol;
}

export function livePerformanceR(performance = null) {
  if (!performance) return { availability: "UNAVAILABLE", sourceType: "NONE", totalR: null, dailyR: null, drawdownR: null, sampleSize: null, hitRatePct: null, series: [], asOf: null };
  const totals = performance.totals || performance.summary || {};
  const winRate = nullableMetric(totals.winRate ?? totals.win_rate);
  return {
    availability: "KNOWN", sourceType: text(performance.sourceType || performance.source_type, "RESEARCH").toUpperCase(),
    totalR: nullableMetric(totals.totalR ?? totals.total_r), dailyR: nullableMetric(totals.dailyR ?? totals.daily_r),
    drawdownR: nullableMetric(performance.summary?.max_drawdown_R ?? totals.max_drawdown_r), sampleSize: nullableMetric(totals.trades ?? totals.trade_count),
    hitRatePct: winRate === null ? null : Math.round(winRate * 1000) / 10,
    series: liveEquitySeries(performance.equity),
    asOf: text(performance.asOf || performance.generated_at_utc, "unavailable"),
  };
}

function liveEquitySeries(equity) {
  return rows(equity).slice(-60).map((point) => ({
    sequence: nullableMetric(point.sequence) ?? 0,
    at: text(point.at || point.date, "unavailable"),
    resultR: nullableMetric(point.resultR ?? point.result_R ?? point.result_r) ?? 0,
    cumulativeR: nullableMetric(point.cumulativeR ?? point.cumulative_R ?? point.cumulative_r) ?? 0,
    drawdownR: nullableMetric(point.drawdownR ?? point.drawdown_R ?? point.drawdown_r) ?? 0,
  }));
}

export function liveAssistantAdvisory({ assistantRuntime, ai, advisorySummary, nowIso }) {
  const latest = rows(assistantRuntime?.messages)[0] || null;
  return { mode: "ADVISORY", lastContextAt: text(latest?.created_at_utc || latest?.at || ai?.generatedAt, nowIso), summary: text(latest?.content || latest?.answer || advisorySummary.status, "Aucun brief Jarvis publié pour ce contexte."), source: latest ? "assistant_runtime_messages" : ai ? "ai_context_gate" : "NONE", readOnly: true };
}

export function canonicalProviderCommandRow(item) {
  const source = item || {};
  const payload = source.payload || source.command_payload || {};
  return { commandId: text(source.execution_provider_command_id, ""), portfolioOrderIntentId: text(source.portfolio_order_intent_id, ""), providerCode: text(source.provider_code || source.broker_provider_code, "unavailable"), status: text(source.status, "UNKNOWN").toUpperCase(), createdAt: text(source.created_at || source.created_at_utc, "unavailable"), updatedAt: text(source.updated_at || source.updated_at_utc, "unavailable"), correlationId: text(source.correlation_id || payload.correlation_id, "unavailable"), sourceClass: "CANONICAL_RUNTIME" };
}

export function isCanonicalFillEvent(item) {
  const state = text(item?.event_type || item?.status || item?.state, "").toUpperCase();
  return ["FILL", "FILLED", "ORDER_FILLED", "EXECUTION_FILL"].some((token) => state === token || state.endsWith(`.${token}`));
}

export function canonicalProviderFillRow(item) {
  const source = item || {};
  const payload = source.payload || {};
  return { fillId: text(source.broker_provider_event_id || source.provider_event_id || source.event_id, ""), commandId: text(source.execution_provider_command_id, "unavailable"), portfolioOrderIntentId: text(source.portfolio_order_intent_id, "unavailable"), quantity: nullableMetric(first(source.filled_quantity, source.quantity, payload.filled_quantity, payload.quantity)), price: nullableMetric(first(source.average_fill_price, source.fill_price, source.price, payload.price)), filledAt: text(source.occurred_at_utc || source.created_at, "unavailable"), sourceClass: "CANONICAL_RUNTIME" };
}

export function canonicalPositionRows(value) {
  return rows(value).map((item) => ({ portfolioOrderIntentId: text(item?.portfolio_order_intent_id, ""), lifecycleStatus: text(item?.lifecycle_status, "UNKNOWN").toUpperCase(), filledQuantity: nullableMetric(item?.filled_quantity), averageFillPrice: nullableMetric(item?.average_fill_price), providerOrderRef: text(item?.provider_order_ref, ""), revision: nullableMetric(item?.revision), asOf: text(item?.updated_at_utc, "unavailable"), sourceClass: "CANONICAL_RUNTIME" }));
}

export function canonicalProviderScope(execution = {}, nominalIntentIds = new Set()) {
  const commands = rows(execution.providerCommands).filter((item) => !item.portfolio_order_intent_id || nominalIntentIds.has(String(item.portfolio_order_intent_id)));
  const commandIds = new Set(commands.map((item) => String(item.execution_provider_command_id || "")).filter(Boolean));
  const events = rows(execution.providerEvents).filter((item) => providerEventMatches(item, nominalIntentIds, commandIds));
  return { commands, events };
}

function providerEventMatches(item, intentIds, commandIds) {
  const intentMatches = !item.portfolio_order_intent_id || intentIds.has(String(item.portfolio_order_intent_id));
  const commandMatches = !item.execution_provider_command_id || commandIds.has(String(item.execution_provider_command_id));
  return intentMatches && commandMatches;
}

export function liveSummary({ signals, intents, commands, events, safety = {}, risk = {}, performance = {} }) {
  return {
    signalsToday: signals.length, tradesExecuted: events.filter(isCanonicalFillEvent).length,
    acceptanceRatePct: signals.length ? Math.round((intents.length / signals.length) * 100) : null,
    orderIntentsPending: intents.filter((item) => ["READY", "AWAITING_MANUAL_CONFIRMATION", "PENDING"].includes(upper(item.state))).length,
    providerCommandsCreated: commands.length, providerEventsObserved: events.length,
    riskUsedPct: nullableMetric(first(risk?.summary?.risk_used_pct, risk?.summary?.open_risk_pct, risk?.summary?.current_risk_pct)),
    riskConfiguredPct: nullableMetric(first(safety.riskPercent, risk?.summary?.risk_percent)),
    correlatedExposurePct: nullableMetric(first(safety.correlatedExposurePct, risk?.summary?.correlated_exposure_pct)),
    liveDrawdownR: nullableMetric(performance.max_drawdown_R),
  };
}

export function liveSession({ execution, liveSession: currentLiveSession, scope, launchGate, health, marketSeries, marketDataStatus }) {
  const readiness = health?.data_readiness || {};
  const activeSession = text(readiness.active_session, scope.session);
  return {
    sessionId: text(execution.session_id || currentLiveSession?.id, "unavailable"),
    tradingDate: text(currentLiveSession?.date, scope.trading_date),
    phase: activeSession,
    nextMonitorAt: text(readiness.next_eligible_at_utc || execution.next_monitor_at || currentLiveSession?.nextMonitorAt || currentLiveSession?.nextCheckpointAt, "unavailable"),
    marketDataStatus: marketDataStatus(launchGate), marketState: marketSessionState(health?.data_readiness),
    activeSession,
    exchangeTimezone: text(readiness.exchange_timezone, "America/New_York"), lastKnownAt: text(marketSeries?.asOf, "unavailable"),
  };
}

export function appendLiveWarnings({ execution, safety, canonicalRuntime, riskChecks = [], liveSession: currentLiveSession, marketClosed = false, warnings }) {
  const signalCount = rows(canonicalRuntime?.latestSignals).length;
  const intentCount = rows(canonicalRuntime?.pendingOrderIntents).length;
  if (!execution.session_id && !currentLiveSession?.id) warnings.push("live-session-id:UNAVAILABLE");
  if (!marketClosed && !execution.next_monitor_at && !currentLiveSession?.nextMonitorAt && !currentLiveSession?.nextCheckpointAt) warnings.push("live-next-monitor:UNAVAILABLE");
  // A raw StrategySignal can be visible while portfolio arbitration has not
  // produced any current accepted candidate. That is a connected-empty business
  // state, not a front/runtime outage; avoid degrading the whole Live screen.
  if (intentCount && !riskChecks.length) warnings.push("live-risk-checks:UNAVAILABLE");
  if (!rows(execution.pipeline).length && canonicalRuntime.pipeline.every((item) => item.status === "UNAVAILABLE")) warnings.push("live-pipeline:UNAVAILABLE");
  if (!marketClosed && (signalCount || intentCount) && !rows(execution.timeline).length && !rows(currentLiveSession?.timeline).length && !rows(currentLiveSession?.operationalTimeline).length) warnings.push("live-timeline:UNAVAILABLE");
}

export function liveLegacyHistory(execution) {
  return { sourceClass: "LEGACY_HISTORY", canonical: false, readOnly: true, orderIntentCount: rows(execution.intents).length, orderCount: rows(execution.orders).length, tradeCount: rows(execution.trades).length };
}

export function liveTimeline(execution) {
  return rows(execution.timeline).filter((item) => item?.event_id).map((item) => ({ eventId: String(item.event_id), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), step: text(item.step || item.domain, "unavailable"), title: text(item.title || item.event_type, "Événement"), detail: text(item.detail || item.message, "Détail indisponible"), tone: ["HIGH", "WATCH"].includes(upper(item.tone || item.severity)) ? upper(item.tone || item.severity) : "INFO" }));
}

export function liveArbitrations(execution, { signalIds = null } = {}) {
  return rows(execution.arbitrations)
    .filter((item) => item?.arbitration_id && item?.signal_id)
    .filter((item) => matchesScope(signalIds, item.signal_id))
    .map((item) => ({ arbitrationId: String(item.arbitration_id), signalId: String(item.signal_id), decision: ["ACCEPTED", "SCALED", "REJECTED"].includes(upper(item.decision)) ? upper(item.decision) : "REJECTED", targetQuantity: numeric(item.target_quantity), conflictStatus: text(item.conflict_status, "UNKNOWN"), correlationPct: numeric(item.correlation_pct), reasonCode: text(item.reason_code, "REASON_UNAVAILABLE") }));
}

export function liveRiskChecks(execution, { signalIds = null, portfolioOrderIntentIds = null } = {}) {
  return preferCompleteRiskChecks([
    ...rows(execution.risk_checks)
      .filter((item) => item?.risk_check_id && item?.signal_id)
      .filter((item) => matchesScope(signalIds, item.signal_id))
      .map((item) => ({
        riskCheckId: String(item.risk_check_id),
        signalId: String(item.signal_id),
        status: riskStatus(item.status),
        limitLabel: text(item.limit_label, "Limite non publiée"),
        usedPct: nullableMetric(item.used_pct),
        reasonCode: text(item.reason_code, "REASON_UNAVAILABLE"),
        source: "execution.risk_checks",
      })),
    ...derivedRiskChecksFromOrderIntents(execution, { signalIds, portfolioOrderIntentIds }),
  ]).map(withNullableRiskUtilization);
}

export function nullableMetric(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function rows(value) { if (Array.isArray(value)) return value; if (Array.isArray(value?.items)) return value.items; if (Array.isArray(value?.rows)) return value.rows; return []; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function upper(value) { return String(value || "").toUpperCase(); }
function numeric(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function first(...values) { return values.find((value) => value !== null && value !== undefined); }

function derivedRiskChecksFromOrderIntents(execution = {}, { signalIds = null, portfolioOrderIntentIds = null } = {}) {
  return rows(execution.portfolioOrderIntents)
    .filter((intent) => matchesScope(portfolioOrderIntentIds, intent.portfolio_order_intent_id))
    .flatMap((intent, intentIndex) => {
      const signalId = intentSignalId(intent);
      if (!signalId || !matchesScope(signalIds, signalId)) return [];
      return rows(intent?.risk_decisions).map((decision, decisionIndex) => riskCheckFromDecision({
        decision,
        signalId,
        intent,
        fallbackIndex: `${intentIndex + 1}-${decisionIndex + 1}`,
      })).filter(Boolean);
    });
}

function riskCheckFromDecision({ decision = {}, signalId, intent = {}, fallbackIndex }) {
  const decisionId = text(decision.risk_decision_id, "");
  const riskCheckId = decisionId || text(intent.portfolio_order_intent_id, "") || `derived-risk-${fallbackIndex}`;
  const reasonCodes = rows(decision.reason_codes);
  return {
    riskCheckId,
    signalId,
    status: riskStatus(first(decision.status, decision.decision)),
    limitLabel: limitLabel(decision),
    usedPct: limitUtilizationPct(decision.nearest_limit),
    reasonCode: text(reasonCodes[0], "RISK_DECISION_PUBLISHED"),
    decision: text(first(decision.decision, decision.status), "UNAVAILABLE"),
    policyVersion: text(decision.risk_rule_set_version, "UNAVAILABLE"),
    reasonCodes: reasonCodes.map(String),
    requestedQuantity: nullableMetric(first(decision.requested?.quantity, decision.requested_size)),
    authorizedQuantity: nullableMetric(first(decision.authorized?.quantity, decision.approved_size, intent.risk_approved_net_size)),
    requestedRiskPct: nullableMetric(decision.requested?.risk_pct),
    authorizedRiskPct: nullableMetric(decision.authorized?.risk_pct),
    riskAmount: nullableMetric(decision.authorized?.risk_amount),
    riskPerContract: nullableMetric(decision.trade_risk?.risk_per_contract),
    stopDistancePoints: nullableMetric(decision.trade_risk?.stop_distance_points),
    stopDistanceTicks: nullableMetric(decision.trade_risk?.stop_distance_ticks),
    nearestLimit: decision.nearest_limit || null,
    portfolioBefore: decision.portfolio_before || null,
    portfolioAfter: decision.portfolio_after || null,
    breaches: rows(decision.breaches),
    source: "portfolio_risk_decisions",
  };
}

function intentSignalId(intent = {}) {
  const payload = intent.order_intent_payload || intent.payload || {};
  const lineage = payload.lineage || payload.source?.lineage || {};
  return text(first(
    intent.signal_id,
    intent.strategy_signal_id,
    payload.signal_id,
    payload.strategy_signal_id,
    rows(lineage.strategy_signal_ids)[0],
  ), "");
}

function riskStatus(value) {
  const status = upper(value);
  if (["PASS", "APPROVED", "ACCEPTED", "TAKE"].includes(status)) return "PASS";
  if (["BLOCK", "BLOCKED", "REJECT", "REJECTED", "FAILED", "DENIED"].includes(status)) return "BLOCK";
  return "WATCH";
}

function limitLabel(decision = {}) {
  const nearest = decision.nearest_limit || {};
  return text(first(nearest.label, nearest.type, nearest.limit_id, decision.risk_rule_set_version), "Global Risk");
}

function limitUtilizationPct(nearestLimit) {
  const raw = nullableMetric(nearestLimit?.utilization ?? nearestLimit?.used_pct ?? nearestLimit?.usage_pct);
  if (raw === null) return null;
  return raw <= 1 ? Math.round(raw * 10_000) / 100 : Math.round(raw * 100) / 100;
}

function preferCompleteRiskChecks(items) {
  const byIdentity = new Map();
  for (const item of items) {
    const key = `${item.riskCheckId}:${item.signalId}`;
    if (!key || key === ":") continue;
    const existing = byIdentity.get(key);
    if (!existing || (!Number.isFinite(existing.usedPct) && Number.isFinite(item.usedPct))) byIdentity.set(key, item);
  }
  return [...byIdentity.values()];
}

function withNullableRiskUtilization(item) {
  return {
    ...item,
    usedPct: Number.isFinite(item?.usedPct) ? item.usedPct : null,
  };
}

function matchesScope(scope, value) {
  return !(scope instanceof Set) || scope.has(String(value || ""));
}
