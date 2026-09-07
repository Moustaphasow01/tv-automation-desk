import { buildLiveFocusDashboard } from "./front-live-focus-dashboard.js";

// Human confirmation is not an execution outcome. After CONFIRMED, the dossier
// remains active so the operator can see the theoretical entry/fill/exit follow-up.
const TERMINAL_GATE_STATES = new Set(["REJECTED", "EXPIRED", "CANCELLED", "CANCELED"]);
const TERMINAL_SIGNAL_STATES = new Set(["REJECTED", "EXPIRED", "CANCELLED", "CANCELED"]);
const TERMINAL_THEORETICAL_STATES = new Set(["STOP_HIT", "TARGET_HIT", "EXPIRED", "CLOSED", "CANCELLED", "CANCELED", "VOIDED"]);

export function buildLiveFocusProjection({ live, marketContext, health, nowIso }) {
  const snapshot = marketContext?.snapshot || null;
  const brief = marketContext?.brief || null;
  const session = canonicalGrainsSession(health, nowIso);
  const tradeCards = buildTradeCards(live, nowIso);
  const observedOpportunities = buildObservedOpportunities(live, tradeCards, nowIso);
  const whyNoTrade = buildWhyNoTrade({ live, marketContext, snapshot, brief, tradeCards, observedOpportunities, session, nowIso });
  return {
    schemaVersion: "live_focus_view_v1",
    universe: "US_GRAINS_CBOT",
    asOf: nowIso,
    safety: { autoExecutionEnabled: false, physicalLiveEnabled: false, humanGateRequired: true, authority: "BACKEND" },
    session,
    marketContext: snapshot || unavailableContext(marketContext, nowIso),
    marketDeskBrief: brief || unavailableBrief(marketContext, whyNoTrade, nowIso),
    briefHistory: rows(marketContext?.briefHistory),
    whyNoTrade,
    operatorJourneyState: journeyState({ tradeCards, observedOpportunities, snapshot, session, whyNoTrade, nowIso }),
    tradeCards,
    dashboard: buildLiveFocusDashboard({ tradeCards, observedOpportunities, nowIso }),
    selectedTrade: tradeCards.find((card) => !card.terminal) || null,
    observedOpportunities,
    catalysts: rows(brief?.currentCatalysts),
    marketSeries: live.marketSeries,
    watchlist: live.watchlist,
    sourceStates: marketContext?.sourceStates || [],
    contextWorker: marketContext?.workerRuntime || unavailableContextWorker(),
    nextActions: operatorNextActions({ tradeCards, whyNoTrade }),
    technical: {
      source: "front-api/live-focus",
      sourceDataCutoff: snapshot?.sourceDataCutoff || live.marketSeries?.asOf || null,
      revision: Math.max(0, ...tradeCards.map((card) => Number(card.revision || 0))),
    },
  };
}

function buildTradeCards(live, nowIso) {
  return rows(live?.portfolioOrderIntents).filter((intent) => (
    meaningful(intent.targetPositionId) && meaningful(intent.humanGate?.gateId)
  )).map((intent) => {
    const signal = findSignal(live, intent.signalId);
    const theoretical = findTheoretical(live, intent.portfolioOrderIntentId);
    const publishedGateStatus = upper(intent.humanGate?.status || "UNKNOWN");
    const expiresAt = intent.humanGate?.expiresAt || intent.expiresAt || intent.allowedActions?.expiresAt || signal?.expiresAt || null;
    const expiredByTime = publishedGateStatus.startsWith("AWAITING_") && isExpiredByTime(expiresAt, nowIso);
    const gateStatus = expiredByTime && publishedGateStatus.startsWith("AWAITING_") ? "EXPIRED" : publishedGateStatus;
    const theoreticalStatus = upper(theoretical?.status || theoretical?.tradeStatus || "AWAITING_ENTRY");
    const theoreticalTerminal = TERMINAL_THEORETICAL_STATES.has(theoreticalStatus);
    const allowedActions = rows(intent.allowedActions?.allowedActions);
    const terminal = TERMINAL_GATE_STATES.has(gateStatus) || theoreticalTerminal;
    const actionable = allowedActions.includes("CONFIRM") && !terminal;
    return {
      tradeCardId: `focus-trade-${intent.portfolioOrderIntentId}`,
      targetPositionId: intent.targetPositionId,
      orderIntentId: intent.portfolioOrderIntentId,
      humanGateId: intent.humanGate.gateId,
      strategyDefinitionId: signal?.strategyDefinitionId || null,
      strategyVersionId: signal?.strategyVersionId || null,
      strategyInstanceId: signal?.strategyInstanceId || intent.strategyInstanceId || null,
      signalId: signal?.signalId || intent.signalId || null,
      contextDecisionId: signal?.aiContextGateDecisionId || null,
      portfolioDecisionId: intent.portfolioDecisionId || null,
      riskDecisionId: intent.riskDecisionId || null,
      providerCommandId: null,
      positionId: theoretical?.positionId || null,
      tradeId: theoretical?.tradeId || null,
      instrument: intent.instrument,
      side: intent.side,
      strategyName: strategyIdentity(signal, intent),
      setup: signal?.setup || signal?.setupType || null,
      createdAt: intent.createdAt || signal?.createdAt || nowIso,
      expiresAt,
      lastUpdatedAt: theoretical?.lastUpdatedAt || intent.updatedAt || nowIso,
      operatorState: gateStatus,
      theoreticalState: theoretical?.status || "AWAITING_ENTRY",
      theoreticalTradeStatus: theoretical?.tradeStatus || null,
      closedAt: theoretical?.exitAt || null,
      entryFilledAt: theoretical?.entryFilledAt || null,
      strategyProposedPlan: signal?.proposedTradePlan || null,
      contextAdjustedPlan: signal?.contextAdjustedTradePlan || null,
      riskAuthorizedPlan: intent.executionTerms || null,
      authorizedQuantity: intent.quantity ?? intent.riskSnapshot?.authorizedQty ?? null,
      authorizedRisk: intent.riskSnapshot?.authorizedRisk ?? null,
      riskAmount: intent.riskSnapshot?.riskAmount ?? null,
      expectedR: intent.expectedR ?? signal?.expectedR ?? null,
      priority: priorityCode(intent, theoretical, { actionable, terminal }),
      attentionReason: attentionReason(intent, theoretical, { actionable, terminal }),
      allowedActions,
      denialReasons: rows(intent.allowedActions?.denialReasons),
      actionable,
      temporalState: expiredByTime ? "EXPIRED" : terminal ? "TERMINAL" : actionable ? "AWAITING_OPERATOR" : "QUALIFIED",
      expiredByTime,
      lifecycleLabel: lifecycleLabel(gateStatus, theoreticalStatus),
      terminalReason: terminal ? terminalReason(gateStatus, theoreticalStatus) : null,
      actionPolicy: intent.allowedActions,
      humanGate: intent.humanGate,
      reconciliation: findReconciliation(live, intent.portfolioOrderIntentId),
      outcome: theoretical?.outcome || null,
      theoreticalResult: theoretical?.outcomeAttribution || theoretical?.outcome || null,
      operatorResult: theoretical?.manualExecution || theoretical?.operatorResult || null,
      realizedR: theoretical?.resultR ?? theoretical?.realizedR ?? null,
      realizedPnL: theoretical?.realizedPnL ?? null,
      closeReason: theoretical?.closeReason ?? theoretical?.outcome?.closeReason ?? null,
      revision: intent.allowedActions?.revision || null,
      route: intent.route,
      correlationId: intent.correlationId || signal?.correlationId || null,
      reasonCodes: [...new Set([
        ...rows(signal?.reasonCodes),
        ...rows(intent.portfolioReasonCodes),
        ...rows(intent.riskSnapshot?.reasonCodes),
      ])],
      source: "portfolio-order-intent",
      asOf: nowIso,
      availability: "AVAILABLE",
      whyThisTrade: whyThisTrade(intent, signal),
      terminal,
    };
  }).sort((left, right) => priority(right) - priority(left) || Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function buildObservedOpportunities(live, tradeCards, nowIso) {
  const cardSignalIds = new Set(tradeCards.map((card) => card.signalId).filter(Boolean));
  return rows(live?.signals).filter((signal) => signal.signalId && !cardSignalIds.has(signal.signalId)).map((signal) => {
    const status = observedStatus(signal, nowIso);
    return {
      opportunityId: `observed-${signal.signalId}`,
      signalId: signal.signalId,
      instrument: signal.symbol || signal.instrument,
      side: signal.direction || signal.side,
      strategyName: strategyIdentity(signal),
      status,
      statusLabel: lifecycleLabel(status, null),
      terminal: TERMINAL_SIGNAL_STATES.has(status),
      reasonCodes: rows(signal.reasonCodes || signal.reason_codes),
      createdAt: signal.createdAt || signal.generatedAt || null,
      expiresAt: signal.expiresAt || null,
      strategyProposedPlan: signal.proposedTradePlan || null,
      tradePlanEconomics: signal.tradePlanEconomics || signal.proposedTradePlan?.economics || null,
      expectedR: signal.expectancyR ?? signal.rewardRisk ?? null,
      diagnosticOnly: true,
      route: signal.route || `/live/signals/${encodeURIComponent(signal.signalId)}`,
      source: "strategy-signal",
      asOf: signal.createdAt || signal.generatedAt || null,
      availability: signal.availability || "AVAILABLE",
    };
  }).sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
}

function buildWhyNoTrade({ live, marketContext, snapshot, brief, tradeCards, observedOpportunities, session, nowIso }) {
  const evaluations = rows(live?.canonicalRuntime?.activeStrategyInstances);
  const prefilters = rows(marketContext?.prefilterDecisions);
  const arbitrations = rows(live?.arbitrations);
  const signalCount = rows(live?.signals).length;
  const counts = {
    evaluated: evaluations.length,
    noSignal: Math.max(0, evaluations.length - signalCount),
    signals: signalCount,
    contextAccepted: prefilters.filter((item) => upper(item.decision) === "ADMISSIBLE").length,
    contextWait: prefilters.filter((item) => upper(item.decision) === "WAIT").length,
    contextRejected: prefilters.filter((item) => upper(item.decision) === "REJECT").length,
    portfolioSelected: arbitrations.filter((item) => ["SELECTED", "TAKE", "APPROVED"].includes(upper(item.status || item.decision))).length,
    portfolioRejected: arbitrations.filter((item) => upper(item.status || item.decision) === "REJECT").length,
    riskApproved: rows(live?.riskChecks).filter((item) => ["PASS", "APPROVED", "TAKE"].includes(upper(item.status || item.decision))).length,
    riskReduced: rows(live?.riskChecks).filter((item) => upper(item.status || item.decision) === "TAKE_REDUCED").length,
    riskRejected: rows(live?.riskChecks).filter((item) => upper(item.status || item.decision) === "REJECT").length,
    orderIntents: rows(live?.portfolioOrderIntents).length,
    humanGates: tradeCards.length,
  };
  const topReasons = [];
  if (session.marketState !== "OPEN") topReasons.push("MARKET_CLOSED");
  if (!snapshot) topReasons.push("MARKET_CONTEXT_UNAVAILABLE");
  else if (snapshot.status !== "AVAILABLE") topReasons.push(`MARKET_CONTEXT_${snapshot.status}`);
  if (!counts.signals) topReasons.push("NO_SETUP");
  if (counts.signals && !tradeCards.length) topReasons.push("NO_SIGNAL_REACHED_HUMAN_GATE");
  if (tradeCards.length && !tradeCards.some((card) => !card.terminal)) topReasons.push("NO_HUMAN_ACTION_REQUIRED");
  return {
    whyNoTradeSummaryId: `why-no-trade-${String(nowIso).slice(0, 13)}`,
    universe: "US_GRAINS_CBOT",
    asOf: nowIso,
    sourceDataCutoff: snapshot?.sourceDataCutoff || live?.marketSeries?.asOf || null,
    status: topReasons.length ? "EXPLAINED" : "ACTIONABLE",
    topReasons: [...new Set(topReasons)],
    stageCounts: counts,
    blockingConditions: topReasons.map((code) => ({ code, source: reasonSource(code) })),
    nextExpectedEvaluationAt: evaluations.map((item) => item.nextEvaluationAt).filter(Boolean).sort()[0] || null,
    nextContextRefreshAt: snapshot?.validUntil || null,
    nextRelevantEventAt: nextRelevantEvent(brief),
    sourceStates: snapshot?.sourceStates || [],
    reasonCodes: [...new Set(topReasons)],
    observedOpportunityCount: observedOpportunities.length,
  };
}

function journeyState({ tradeCards, observedOpportunities, snapshot, session, whyNoTrade, nowIso }) {
  const actionable = tradeCards.find((card) => card.actionable);
  if (actionable) return journey("F", "AWAITING_HUMAN_CONFIRMATION", "OrderIntent", actionable.orderIntentId, nowIso, ["HUMAN_GATE_ACTION_AVAILABLE"]);
  const pending = tradeCards.find((card) => !card.terminal);
  if (pending) return journey("E", pending.operatorState, "OrderIntent", pending.orderIntentId, nowIso, ["QUALIFIED_DOSSIER_PENDING"]);
  const counts = whyNoTrade?.stageCounts || {};
  const underArbitration = Number(counts.portfolioSelected || 0) + Number(counts.riskApproved || 0) + Number(counts.riskReduced || 0);
  if (underArbitration > 0) return journey("D", "UNDER_ARBITRATION", "PortfolioDecision", null, nowIso, ["PORTFOLIO_OR_RISK_DECISION_PUBLISHED"]);
  const activeObserved = observedOpportunities.find((item) => !item.terminal);
  if (activeObserved) return journey("C", activeObserved.status, "StrategySignal", activeObserved.signalId, nowIso, ["OPPORTUNITY_UNDER_FILTERS"]);
  if (session.marketState !== "OPEN") return journey("A", session.marketState, "MarketSession", session.marketSession, nowIso, ["MARKET_CLOSED"]);
  return journey("B", snapshot?.status || "UNAVAILABLE", "MarketContextSnapshot", snapshot?.marketContextSnapshotId || null, nowIso, [snapshot ? "WAITING_FOR_SETUP" : "MARKET_CONTEXT_UNAVAILABLE"]);
}

function canonicalGrainsSession(health, nowIso) {
  const source = health?.data_readiness?.market_session || {};
  return {
    marketState: canonicalMarketState(source.state),
    marketSession: source.active_session || source.session || "CBOT_GRAINS_UNKNOWN",
    exchangeTimezone: source.timezone || "America/Chicago",
    marketDate: source.trading_date || source.market_date || null,
    sessionStart: source.session_start_utc || null,
    sessionEnd: source.session_end_utc || null,
    nextEligibleAt: source.next_eligible_at_utc || health?.data_readiness?.next_eligible_at_utc || null,
    asOf: source.as_of_utc || nowIso,
    source: "data_readiness.market_session",
  };
}
function canonicalMarketState(value) { const state = upper(value); return ["OPEN", "PREOPEN", "POSTCLOSE", "CLOSED", "BREAK", "HOLIDAY"].includes(state) ? state : "UNKNOWN"; }

function unavailableContext(marketContext, nowIso) { return { status: "UNAVAILABLE", universe: "US_GRAINS_CBOT", asOf: marketContext?.asOf || nowIso, reasonCodes: ["MARKET_CONTEXT_NOT_PUBLISHED"], sourceStates: marketContext?.sourceStates || [] }; }
function unavailableBrief(marketContext, whyNoTrade, nowIso) { return { status: "UNAVAILABLE", universe: "US_GRAINS_CBOT", createdAt: nowIso, headline: "Analyse de contexte non publiée", operatorSummary: "Le Desk déterministe continue ; aucune autorité IA n'est supposée.", whyNoTrade: whyNoTrade.topReasons[0] || "NO_SETUP", sourceStates: marketContext?.sourceStates || [] }; }
function unavailableContextWorker() { return { taskType: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH", lane: "live", cadenceMinutes: { marketOpen: 30, marketClosed: 60 }, timeoutMs: 780000, modelPolicy: {}, taskCount: 0, successCount: 0, failureCount: 0, activeCount: 0, lastCompletedAt: null, lastSuccessfulBriefAt: null, briefAgeSeconds: null, retryCount: 0, averageLatencyMs: null, totalTokens: 0, costMicrosUsd: 0 }; }
function whyThisTrade(intent, signal) {
  const strategyEvidence = rows(signal?.reasonCodes);
  const contextEvidence = rows(signal?.contextReasonCodes);
  const portfolioEvidence = rows(intent.portfolioReasonCodes);
  const riskEvidence = rows(intent.riskSnapshot?.reasonCodes);
  return {
    whyDirection: strategyEvidence[0] || "NOT_AVAILABLE",
    whySetup: signal?.setup || signal?.setupType || "NOT_AVAILABLE",
    whyNow: contextEvidence[0] || "NOT_AVAILABLE",
    whyContextAccepted: contextEvidence,
    whyPortfolioSelected: portfolioEvidence,
    whyRiskAuthorized: riskEvidence,
    whatWasReduced: intent.riskSnapshot?.reductionReason || "NOT_AVAILABLE",
    whatInvalidates: rows(signal?.proposedTradePlan?.invalidationConditions),
    whatToWatch: rows(signal?.contextWatchItems),
    strategyEvidence,
    contextEvidence,
    portfolioEvidence,
    riskEvidence,
    humanAuthority: "REQUIRED",
  };
}
function findSignal(live, id) { return [...rows(live?.signals), ...rows(live?.canonicalRuntime?.latestSignals)].find((item) => item.signalId === id) || null; }
function findTheoretical(live, id) {
  return rows(live?.theoreticalExecution?.rows || live?.theoreticalExecution?.items || live?.theoreticalExecution)
    .find((item) => item.portfolioOrderIntentId === id) || null;
}
function findReconciliation(live, id) { return rows(live?.reconciliation?.items || live?.reconciliation).find((item) => item.portfolioOrderIntentId === id) || null; }
function observedStatus(signal, nowIso) {
  const raw = upper(signal.effectiveState || signal.contextStatus || signal.status || signal.state || "OBSERVED");
  if (raw.includes("CANCEL")) return "CANCELLED";
  if (raw.includes("REJECT")) return "REJECTED";
  if (raw.includes("EXPIRED") || isExpiredByTime(signal.expiresAt, nowIso)) return "EXPIRED";
  if (raw.includes("WAIT")) return "WAIT";
  return "OBSERVED";
}
function priority(card) { if (card.actionable) return 4; if (!card.terminal) return 3; return upper(card.theoreticalState) === "OPEN" ? 2 : 1; }
function priorityCode(intent, theoretical, state = {}) { if (state.actionable) return "ACTIONABLE"; if (theoretical?.status === "OPEN") return "ACTIVE"; return state.terminal || TERMINAL_GATE_STATES.has(upper(intent.humanGate?.status)) ? "TERMINAL" : "PENDING"; }
function attentionReason(intent, theoretical, state = {}) { if (state.actionable) return "HUMAN_CONFIRMATION_REQUIRED"; if (!state.terminal && theoretical?.status === "OPEN") return "THEORETICAL_POSITION_OPEN"; return null; }
function operatorNextActions({ tradeCards, whyNoTrade }) { const card = tradeCards.find((item) => item.actionable); return card ? card.allowedActions : [{ action: "WAIT", reasonCodes: whyNoTrade.reasonCodes }]; }
function nextRelevantEvent(brief) { return rows(brief?.nextExpectedEvents).map((item) => item.eventTimestamp || item.event_timestamp_utc || item.at).filter(Boolean).sort()[0] || null; }
function journey(stage, rawStatus, sourceObjectType, sourceObjectId, asOf, reasonCodes) { return { stage, rawStatus, sourceObjectType, sourceObjectId, asOf, reasonCodes }; }
function reasonSource(code) { return code.startsWith("MARKET_") ? "market-context" : code.includes("HUMAN") ? "human-gate" : "strategy-runtime"; }
function strategyIdentity(signal, intent = null) {
  const candidates = [
    signal?.strategyName,
    signal?.strategy,
    signal?.strategyDefinitionId,
    signal?.strategyId,
    signal?.strategyInstanceId,
    intent?.strategyInstanceId,
  ];
  const identity = candidates.find((value) => typeof value === "string" && meaningful(value.trim()));
  return identity?.trim() || "Stratégie non publiée";
}
function rows(value) { return Array.isArray(value) ? value : []; }
function upper(value) { return String(value || "UNKNOWN").toUpperCase(); }
function meaningful(value) { return Boolean(value && !["unavailable", "unknown", "null"].includes(String(value).toLowerCase())); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function isExpiredByTime(value, nowIso) {
  const expiry = Date.parse(value || "");
  const now = Date.parse(nowIso || "");
  return Number.isFinite(expiry) && Number.isFinite(now) && expiry <= now;
}
function lifecycleLabel(gateStatus, theoreticalStatus) {
  const gate = upper(gateStatus);
  const theoretical = upper(theoreticalStatus);
  if (theoretical === "TARGET_HIT") return "Objectif touché";
  if (theoretical === "STOP_HIT") return "Stop touché";
  if (theoretical === "OPEN") return "Suivi théorique ouvert";
  if (["AWAITING_ENTRY", "PENDING_ENTRY", "WORKING"].includes(theoretical)) return "Entrée théorique surveillée";
  if (gate.includes("EXPIRED")) return "Fenêtre expirée";
  if (gate.includes("CANCEL")) return "Signal annulé";
  if (gate.includes("REJECT")) return "Dossier rejeté";
  if (gate.includes("CONFIRM")) return "Dossier confirmé · suivi en cours";
  if (gate.includes("AWAIT")) return "Validation opérateur attendue";
  if (gate.includes("WAIT")) return "Signal en attente";
  if (gate.includes("OBSERVED")) return "Signal observé";
  return gate || theoretical || "État non publié";
}
function terminalReason(gateStatus, theoreticalStatus) {
  const gate = upper(gateStatus);
  const theoretical = upper(theoreticalStatus);
  if (theoretical === "TARGET_HIT" || theoretical === "STOP_HIT" || theoretical === "CLOSED") return `THEORETICAL_${theoretical}`;
  if (gate.includes("EXPIRED")) return "HUMAN_GATE_EXPIRED";
  if (gate.includes("CANCEL")) return "HUMAN_GATE_CANCELLED";
  if (gate.includes("REJECT")) return "HUMAN_GATE_REJECTED";
  if (gate.includes("CONFIRM")) return "HUMAN_GATE_CONFIRMED";
  return "TERMINAL";
}
