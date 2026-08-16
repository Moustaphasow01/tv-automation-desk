export function marketSessionState(readiness = {}) {
  if (readiness.market_closed === true) return "MARKET_CLOSED";
  const state = upper(readiness.market_state || readiness.state);
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

export function livePerformanceR(performance = null) {
  if (!performance) return { availability: "UNAVAILABLE", sourceType: "NONE", totalR: null, dailyR: null, drawdownR: null, sampleSize: null, asOf: null };
  const totals = performance.totals || performance.summary || {};
  return {
    availability: "KNOWN", sourceType: text(performance.sourceType || performance.source_type, "RESEARCH").toUpperCase(),
    totalR: nullableMetric(totals.totalR ?? totals.total_r), dailyR: nullableMetric(totals.dailyR ?? totals.daily_r),
    drawdownR: nullableMetric(performance.summary?.max_drawdown_R ?? totals.max_drawdown_r), sampleSize: nullableMetric(totals.trades ?? totals.trade_count),
    asOf: text(performance.asOf || performance.generated_at_utc, "unavailable"),
  };
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

export function liveSummary({ signals, intents, commands, events, safety = {}, performance = {} }) {
  return {
    signalsToday: signals.length, tradesExecuted: events.filter(isCanonicalFillEvent).length,
    acceptanceRatePct: signals.length ? Math.round((intents.length / signals.length) * 100) : null,
    orderIntentsPending: intents.filter((item) => ["READY", "AWAITING_MANUAL_CONFIRMATION", "PENDING"].includes(upper(item.state))).length,
    providerCommandsCreated: commands.length, providerEventsObserved: events.length,
    riskUsedPct: nullableMetric(safety.riskPercent), correlatedExposurePct: nullableMetric(safety.correlatedExposurePct), liveDrawdownR: nullableMetric(performance.max_drawdown_R),
  };
}

export function liveSession({ execution, liveSession: currentLiveSession, scope, launchGate, health, marketSeries, marketDataStatus }) {
  return {
    sessionId: text(execution.session_id || currentLiveSession?.id, "unavailable"),
    tradingDate: text(currentLiveSession?.date, scope.trading_date),
    phase: scope.session === "ny_open" ? "New York" : "Asia",
    nextMonitorAt: text(execution.next_monitor_at || currentLiveSession?.nextMonitorAt || currentLiveSession?.nextCheckpointAt, "unavailable"),
    marketDataStatus: marketDataStatus(launchGate), marketState: marketSessionState(health?.data_readiness),
    activeSession: text(health?.data_readiness?.active_session || scope.session, "UNKNOWN"),
    exchangeTimezone: text(health?.data_readiness?.exchange_timezone, "America/New_York"), lastKnownAt: text(marketSeries?.asOf, "unavailable"),
  };
}

export function appendLiveWarnings({ execution, safety, canonicalRuntime, liveSession: currentLiveSession, marketClosed = false, warnings }) {
  const signalCount = rows(canonicalRuntime?.latestSignals).length;
  const intentCount = rows(canonicalRuntime?.pendingOrderIntents).length;
  if (!execution.session_id && !currentLiveSession?.id) warnings.push("live-session-id:UNAVAILABLE");
  if (!marketClosed && !execution.next_monitor_at && !currentLiveSession?.nextMonitorAt && !currentLiveSession?.nextCheckpointAt) warnings.push("live-next-monitor:UNAVAILABLE");
  if (signalCount && !execution.arbitrations) warnings.push("live-arbitrations:UNAVAILABLE");
  if (intentCount && !execution.risk_checks) warnings.push("live-risk-checks:UNAVAILABLE");
  if (intentCount && safety.correlatedExposurePct == null) warnings.push("live-correlated-exposure:UNAVAILABLE");
  if (!rows(execution.pipeline).length && canonicalRuntime.pipeline.every((item) => item.status === "UNAVAILABLE")) warnings.push("live-pipeline:UNAVAILABLE");
  if (!marketClosed && (signalCount || intentCount) && !rows(execution.timeline).length && !rows(currentLiveSession?.timeline).length && !rows(currentLiveSession?.operationalTimeline).length) warnings.push("live-timeline:UNAVAILABLE");
}

export function liveLegacyHistory(execution) {
  return { sourceClass: "LEGACY_HISTORY", canonical: false, readOnly: true, orderIntentCount: rows(execution.intents).length, orderCount: rows(execution.orders).length, tradeCount: rows(execution.trades).length };
}

export function liveTimeline(execution) {
  return rows(execution.timeline).filter((item) => item?.event_id).map((item) => ({ eventId: String(item.event_id), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), step: text(item.step || item.domain, "unavailable"), title: text(item.title || item.event_type, "Événement"), detail: text(item.detail || item.message, "Détail indisponible"), tone: ["HIGH", "WATCH"].includes(upper(item.tone || item.severity)) ? upper(item.tone || item.severity) : "INFO" }));
}

export function liveArbitrations(execution) {
  return rows(execution.arbitrations).filter((item) => item?.arbitration_id && item?.signal_id).map((item) => ({ arbitrationId: String(item.arbitration_id), signalId: String(item.signal_id), decision: ["ACCEPTED", "SCALED", "REJECTED"].includes(upper(item.decision)) ? upper(item.decision) : "REJECTED", targetQuantity: numeric(item.target_quantity), conflictStatus: text(item.conflict_status, "UNKNOWN"), correlationPct: numeric(item.correlation_pct), reasonCode: text(item.reason_code, "REASON_UNAVAILABLE") }));
}

export function liveRiskChecks(execution) {
  return rows(execution.risk_checks).filter((item) => item?.risk_check_id && item?.signal_id).map((item) => ({ riskCheckId: String(item.risk_check_id), signalId: String(item.signal_id), status: ["PASS", "WATCH", "BLOCK"].includes(upper(item.status)) ? upper(item.status) : "WATCH", limitLabel: text(item.limit_label, "Limite non publiée"), usedPct: numeric(item.used_pct), reasonCode: text(item.reason_code, "REASON_UNAVAILABLE") }));
}

export function nullableMetric(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function rows(value) { if (Array.isArray(value)) return value; if (Array.isArray(value?.items)) return value.items; if (Array.isArray(value?.rows)) return value.rows; return []; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function upper(value) { return String(value || "").toUpperCase(); }
function numeric(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function first(...values) { return values.find((value) => value !== null && value !== undefined); }
