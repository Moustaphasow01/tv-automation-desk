export function marketSessionState(readiness = {}) {
  if (readiness.market_closed === true) return "MARKET_CLOSED";
  const sessionState = upper(readiness.market_session?.state || readiness.market_state);
  if (["OPEN", "PREOPEN", "HALTED", "CLOSED", "TRADING_DAY", "SESSION_OPEN"].includes(sessionState)) return sessionState;
  const state = upper(readiness.state);
  if (["FRESH", "STALE", "DELAYED", "DOWN"].includes(state)) return state;
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

export function liveTheoreticalExecution(execution = {}, nominalIntentIds = new Set()) {
  const intents = rows(execution.portfolioOrderIntents).filter((item) => nominalIntentIds.has(String(item.portfolio_order_intent_id || "")));
  const events = rows(execution.theoreticalEvents).filter((item) => nominalIntentIds.has(String(item.portfolio_order_intent_id || "")));
  const trades = rows(execution.trades).filter((item) => nominalIntentIds.has(String(item.portfolio_order_intent_id || "")));
  const eventsByIntent = groupBy(events, "portfolio_order_intent_id");
  const tradeByIntent = latestBy(trades, "portfolio_order_intent_id", (item) => item.updated_at || item.created_at);
  const projectedRows = intents.map((intent) => theoreticalIntentRow({
    intent,
    events: eventsByIntent.get(String(intent.portfolio_order_intent_id || "")) || [],
    trade: tradeByIntent.get(String(intent.portfolio_order_intent_id || "")) || null,
  }));
  const asOf = latestTimestamp([
    ...events.map((item) => item.event_at_utc || item.created_at_utc),
    ...trades.map((item) => item.updated_at || item.created_at),
    ...intents.map((item) => item.updated_at_utc || item.created_at_utc),
  ]);
  const summary = theoreticalSummary(projectedRows);
  return {
    schemaVersion: "live_theoretical_execution_v1",
    availability: intents.length ? "KNOWN" : "CONNECTED_EMPTY",
    status: summary.openTrades > 0 ? "TRACKING_OPEN" : projectedRows.length ? "TRACKING" : "NO_ORDER_INTENT",
    source: "portfolio_order_intent_lineage+trade_theoretical_execution_events+trades",
    asOf,
    summary,
    rows: projectedRows,
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

export function liveWatchlist(liveMarketSnapshot = null) {
  const instruments = liveMarketSnapshot?.instruments || {};
  return Object.values(instruments)
    .filter((item) => item && item.symbol)
    .map((item) => ({
      symbol: text(item.symbol, "unavailable"),
      last: nullableMetric(item.latest_close),
      changePct: nullableMetric(item.change_pct),
      trend: rows(item.intraday_series).slice(-30).map((point) => nullableMetric(point.close)).filter((value) => value !== null),
      asOf: text(item.latest_timestamp_paris, "unavailable"),
      availability: text(item.availability, "UNAVAILABLE").toUpperCase(),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
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

function theoreticalIntentRow({ intent, events, trade }) {
  const payload = intent.payload || {};
  const terms = payload.execution_terms || {};
  const latestEvent = latestByTimestamp(events, (item) => item.event_at_utc || item.created_at_utc);
  const latestPayload = latestEvent?.payload || {};
  const status = theoreticalStatus({ latestEvent, trade });
  const side = text(payload.action || payload.side || intent.side, "UNAVAILABLE").toUpperCase();
  const orderType = text(payload.order_type || terms.order_type, "UNAVAILABLE").toUpperCase();
  const targets = Array.isArray(payload.targets) ? payload.targets : Array.isArray(terms.targets) ? terms.targets : [];
  return {
    portfolioOrderIntentId: text(intent.portfolio_order_intent_id, ""),
    targetPositionId: text(intent.target_position_id, ""),
    strategySignalId: text(payload.signal_id || payload.strategy_signal_id, ""),
    strategyId: text(payload.strategy_id, ""),
    strategyInstanceId: text(payload.strategy_instance_id || payload.source?.lineage?.strategy_instance_ids?.[0], ""),
    instrument: text(payload.instrument || intent.target_instrument, "UNAVAILABLE"),
    side,
    orderType,
    quantity: nullableMetric(payload.quantity ?? intent.quantity),
    entry: nullableMetric(first(payload.entry?.price, terms.entry?.price, payload.limit_price)),
    stop: nullableMetric(first(payload.protection?.stop_price, terms.stop?.price, payload.stop_price)),
    targets: targets.map((target, index) => ({ label: text(target.label, `T${index + 1}`), price: nullableMetric(first(target.price, target.value)), ratioR: nullableMetric(first(target.ratioR, target.ratio_r)) })),
    expectedR: nullableMetric(first(payload.expected_r, payload.expectedR)),
    status,
    latestEventType: text(latestEvent?.event_type, "NONE").toUpperCase(),
    latestEventAt: text(latestEvent?.event_at_utc, ""),
    entryFilledAt: firstEventAt(events, "entry_filled"),
    entryFillPrice: nullableMetric(firstEvent(events, "entry_filled")?.price),
    exitAt: theoreticalExitAt(events),
    exitPrice: nullableMetric(latestPayload.price ?? latestEvent?.price),
    resultR: nullableMetric(first(trade?.result_r, trade?.realized_r, trade?.payload?.result_r)),
    tradeId: text(trade?.trade_id, ""),
    tradeStatus: text(trade?.status, "NONE").toUpperCase(),
    sourceCandleAt: text(latestEvent?.source_candle_timestamp_utc || latestPayload.candle?.timestamp_utc, ""),
    sourceTimeframe: text(latestPayload.candle?.timeframe, ""),
    physicalExecutionCreated: false,
    brokerEvidence: "NONE",
  };
}

function theoreticalSummary(projectedRows) {
  return {
    trackedIntents: projectedRows.length,
    working: projectedRows.filter((item) => item.status === "WORKING").length,
    entryFilled: projectedRows.filter((item) => item.status === "ENTRY_FILLED").length,
    targetHit: projectedRows.filter((item) => item.status === "TARGET_HIT").length,
    stopHit: projectedRows.filter((item) => item.status === "STOP_HIT").length,
    expired: projectedRows.filter((item) => item.status === "EXPIRED").length,
    reviewRequired: projectedRows.filter((item) => item.status === "REVIEW_REQUIRED").length,
    openTrades: projectedRows.filter((item) => ["ENTRY_FILLED", "OPEN"].includes(item.status)).length,
    closedTrades: projectedRows.filter((item) => ["TARGET_HIT", "STOP_HIT"].includes(item.status)).length,
    totalClosedR: Math.round(projectedRows.reduce((sum, item) => sum + (["TARGET_HIT", "STOP_HIT"].includes(item.status) ? Number(item.resultR) || 0 : 0), 0) * 100) / 100,
  };
}

function theoreticalStatus({ latestEvent, trade }) {
  const eventType = upper(latestEvent?.event_type);
  if (eventType === "ENTRY_EXPIRED") return "EXPIRED";
  if (eventType === "TARGET_HIT") return "TARGET_HIT";
  if (eventType === "STOP_HIT") return "STOP_HIT";
  if (eventType === "EXIT_REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (eventType === "ENTRY_FILLED") return "ENTRY_FILLED";
  if (upper(trade?.status) === "CLOSED") return "CLOSED";
  if (trade?.trade_id) return "OPEN";
  return "WORKING";
}

function firstEvent(events, eventType) {
  return events.find((item) => upper(item?.event_type) === upper(eventType)) || null;
}

function firstEventAt(events, eventType) {
  return text(firstEvent(events, eventType)?.event_at_utc, "");
}

function theoreticalExitAt(events) {
  return text(firstEvent(events, "target_hit")?.event_at_utc || firstEvent(events, "stop_hit")?.event_at_utc || firstEvent(events, "exit_review_required")?.event_at_utc, "");
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of rows(items)) {
    const value = String(item?.[key] || "");
    if (!value) continue;
    const bucket = map.get(value) || [];
    bucket.push(item);
    map.set(value, bucket);
  }
  return map;
}

function latestBy(items, key, at) {
  const map = new Map();
  for (const item of rows(items)) {
    const value = String(item?.[key] || "");
    if (!value) continue;
    const existing = map.get(value);
    if (!existing || timestamp(at(item)) >= timestamp(at(existing))) map.set(value, item);
  }
  return map;
}

function latestByTimestamp(items, at) {
  let latest = null;
  for (const item of rows(items)) {
    if (!latest || timestamp(at(item)) >= timestamp(at(latest))) latest = item;
  }
  return latest;
}

function latestTimestamp(values) {
  const valid = values.map(timestamp).filter(Number.isFinite);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : -Infinity;
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
