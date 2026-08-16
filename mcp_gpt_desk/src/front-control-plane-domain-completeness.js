import { liveMarketDataStatus } from "./front-control-plane-demo-paper.js";
import {
  countBy,
  currentUtc,
  firstRow,
  hasIncidentId,
  hasSignalId,
  isActiveExecutionMode,
  latestTimestamp,
  nullableNumber,
  number,
  objectFacts,
  rows,
  runtimeState,
  stringList,
  text,
  upper,
  executionModeState,
} from "./front-control-plane-projection-helpers.js";
import { orderHumanGateProjection, permissions, resourceAllowedActions } from "./front-control-plane-permissions.js";
import { intentRow, signalRow } from "./front-control-plane-row-mappers.js";

export function canonicalOrderIntentDossier({ execution, portfolioIntent, order, actor, nowIso, health }) {
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  const riskDecision = firstRow(portfolioIntent.risk_decisions);
  const humanGate = orderHumanGateProjection({ execution, portfolioIntent, actor });
  return {
    schemaVersion: "canonical_order_intent_dossier_v1",
    meta: canonicalDossierMeta({ portfolioIntent, payload, nowIso }),
    lineage: canonicalDossierLineage({ execution, portfolioIntent, payload, humanGate, riskDecision }),
    executionTerms: canonicalDossierExecutionTerms({ portfolioIntent, payload, order }),
    riskSnapshot: canonicalDossierRiskSnapshot({ portfolioIntent, payload, riskDecision }),
    policy: executionPolicy(execution, health),
    immutability: portfolioIntent.immutability || payload.immutability || {
      policy: "REJECT_AND_REPLAN",
      immutableTermsHash: text(portfolioIntent.immutable_terms_hash || payload.immutable_terms_hash, "unavailable"),
    },
    allowedActions: {
      orderIntent: resourceAllowedActions({
        resourceType: "OrderIntent",
        status: text(portfolioIntent.status || payload.status, "READY"),
        revision: text(portfolioIntent.immutable_terms_hash || portfolioIntent.order_intent_hash || payload.order_intent_hash, "unavailable"),
        actor,
      }),
      humanGate: resourceAllowedActions({
        resourceType: "HumanGate",
        status: humanGate.status,
        revision: text(humanGate.revision, "0"),
        actor,
        expiresAt: humanGate.expiresAt,
      }),
    },
  };
}

export function liveCanonicalRuntime({ execution = {}, strategy = {}, ai = {}, risk = {}, launchGate, actor = {}, nowIso = currentUtc(), health = {} }) {
  const nominalSignals = rows(strategy?.signals).filter(isNominalLiveSignal);
  const signals = nominalSignals.filter(hasSignalId).map(signalRow);
  const nominalSignalIds = new Set(nominalSignals.map((item) => String(item.signal_id || item.signal_outbox_id || "")).filter(Boolean));
  const gateDecisions = rows(ai?.decisions).filter((item) => nominalSignalIds.has(String(item.signal_id || "")));
  const portfolioOrderIntents = rows(execution?.portfolioOrderIntents).filter(isNominalPortfolioIntent);
  const nominalIntentIds = new Set(portfolioOrderIntents.map((item) => String(item.portfolio_order_intent_id || "")).filter(Boolean));
  const humanGates = rows(execution?.humanExecutionGates).filter((item) => nominalIntentIds.has(String(item.portfolio_order_intent_id || "")));
  const providerCommands = rows(execution?.providerCommands).filter((item) => !item.portfolio_order_intent_id || nominalIntentIds.has(String(item.portfolio_order_intent_id)));
  const commandIds = new Set(providerCommands.map((item) => String(item.execution_provider_command_id || "")).filter(Boolean));
  const providerEvents = rows(execution?.providerEvents).filter((item) => (
    (!item.portfolio_order_intent_id || nominalIntentIds.has(String(item.portfolio_order_intent_id)))
    && (!item.execution_provider_command_id || commandIds.has(String(item.execution_provider_command_id)))
  ));
  const riskCenterValue = nominalRiskCenter(risk?.risk_center, portfolioOrderIntents);
  const portfolioState = nominalPortfolioState(risk?.portfolio_state, nominalIntentIds);
  return {
    schemaVersion: "live_canonical_runtime_v1",
    mode: executionPolicy(execution, health),
    authoritativeSources: liveAuthoritativeSources({ execution, strategy, gateDecisions, portfolioOrderIntents }),
    freshness: liveFreshness({ strategy, gateDecisions, portfolioOrderIntents, launchGate, nowIso }),
    pipeline: canonicalLivePipeline({
      signals,
      gateDecisions,
      portfolioOrderIntents,
      riskCenter: riskCenterValue,
      portfolioState,
      humanGates,
      providerCommands,
      providerEvents,
      launchGate,
    }),
    activeStrategyInstances: activeStrategyInstanceRows(strategy, nowIso),
    latestSignals: signals.slice(0, 12),
    aiContextGate: aiContextGateRows(gateDecisions),
    pendingOrderIntents: portfolioOrderIntents.map((item) => portfolioOrderIntentSummaryRow({ execution, item, actor })),
    pendingTargetPositions: rows(portfolioState?.pendingTargetPositions),
    riskCenter: riskCenterValue || {
      schemaVersion: "global_risk_center_v1",
      availability: "UNAVAILABLE",
      reason: "Global Risk projection is not available for this live view.",
    },
  };
}

export function isNominalLiveSignal(item = {}) {
  return String(item.source_class || item.sourceClass || "LIVE").toUpperCase() !== "CERTIFICATION_REPLAY"
    && !item.certification_run_id
    && !item.certificationRunId;
}

export function isNominalPortfolioIntent(item = {}) {
  const payload = payloadOf(item);
  const terms = item.execution_terms || payload.execution_terms || {};
  const values = [
    item.target_account_id,
    payload.account_id,
    payload.broker_account_id,
    terms.account_id,
    terms.broker_account_id,
    item.correlation_id,
    payload.correlation_id,
  ].map((value) => String(value || "").toLowerCase());
  return !values.some((value) => value === "shadow_certification" || value.startsWith("certification:") || value.startsWith("corr_cert_shadow_"));
}

export function portfolioOrderIntentSummaryRow({ execution = {}, item = {}, actor = {} }) {
  const intent = intentRow(item);
  const payload = payloadOf(item);
  const portfolioOrderIntentId = text(firstValue(item.portfolio_order_intent_id, payload.order_intent_id), intent.orderIntentId);
  const humanGate = orderHumanGateProjection({ execution, portfolioIntent: item, actor });
  const providerCommands = rows(execution.providerCommands).filter((command) => text(command.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  const providerEvents = rows(execution.providerEvents).filter((event) => text(event.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  return {
    ...intent,
    portfolioOrderIntentId,
    targetPositionId: text(firstValue(item.target_position_id, payload.target_position_id), "unavailable"),
    state: text(firstValue(item.status, payload.status), intent.state),
    executionTerms: firstValue(item.execution_terms, payload.execution_terms, null),
    riskSnapshot: firstValue(item.risk_snapshot, payload.risk_snapshot, nested(firstRow(item.risk_decisions), ["risk_economics"]), null),
    immutability: firstValue(item.immutability, payload.immutability, null),
    humanGate: { gateId: humanGate.gateId || null, status: humanGate.status, allowedActions: humanGate.actions },
    allowedActions: resourceAllowedActions({
      resourceType: "OrderIntent",
      status: humanGate.gateId ? humanGate.status : "HUMAN_GATE_NOT_CREATED",
      revision: text(firstValue(item.immutable_terms_hash, item.order_intent_hash, payload.order_intent_hash), "unavailable"),
      actor,
      expiresAt: text(item.expires_at_utc || payload.expires_at_utc, ""),
    }),
    providerCommandCount: providerCommands.length,
    providerEventCount: providerEvents.length,
    brokerSubmissionAllowed: execution?.safety?.submissionPossible === true
      && (item.broker_submission_allowed === true || payload.broker_submission_allowed === true),
    physicalExecutionState: providerCommands.length ? "PROVIDER_COMMAND_CREATED" : "NOT_SENT",
    ackIsFill: false,
    route: `/execution/orders/${encodeURIComponent(portfolioOrderIntentId)}`,
  };
}

export function frontAuditEvents({ execution = {}, strategy = {}, incidents = {}, runtime = {}, nowIso = currentUtc() }) {
  return [
    ...auditSignalEvents(strategy),
    ...auditOrderIntentEvents(execution),
    ...auditProviderCommandEvents(execution),
    ...auditProviderEvents(execution),
    ...auditExecutionTimelineEvents(execution),
    ...auditRuntimeEvents(runtime, nowIso),
    ...auditIncidentEvents(incidents, nowIso),
  ].filter((item) => item.eventId).sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

export function auditRelations(events) {
  const byCorrelation = new Map();
  for (const event of events) {
    const key = event.correlationId || "none";
    if (!byCorrelation.has(key)) byCorrelation.set(key, []);
    byCorrelation.get(key).push(event);
  }
  return [...byCorrelation.entries()].map(([correlationId, items]) => ({
    correlationId,
    eventIds: items.map((item) => item.eventId),
    domains: [...new Set(items.map((item) => item.domain))],
    authoritativeSteps: countBy(items, (item) => item.authority === "AUTHORITATIVE"),
    advisoryBranches: countBy(items, (item) => item.authority === "ADVISORY"),
  }));
}

export function telegramDrilldownFromHealth(health = {}) {
  const service = rows(health?.operations?.services).find((item) => ["telegram_alerting", "telegram_alert_worker"].includes(text(item.service_kind || item.service_id, ""))) || null;
  if (!service) {
    return {
      schemaVersion: "telegram_drilldown_front_v1",
      availability: "UNAVAILABLE",
      enabled: false,
      healthy: false,
      reason: "Telegram service health is not exposed by the backend health source.",
      secretsExposed: false,
    };
  }
  return {
    schemaVersion: "telegram_drilldown_front_v1",
    availability: "KNOWN",
    enabled: service.enabled !== false,
    healthy: ["OK", "READY", "RUNNING"].includes(upper(service.status || service.health)),
    status: text(service.status || service.health, "UNKNOWN"),
    lastHeartbeatAt: text(service.last_heartbeat_at_utc || service.heartbeat_at_utc, "unavailable"),
    destinations: rows(service.destinations).map((item, index) => ({
      label: text(item.label || item.name, `destination-${index + 1}`),
      configured: Boolean(item.configured ?? item.enabled),
      lastDeliveryAt: text(item.last_delivery_at_utc, "unavailable"),
      deliveryStatus: text(item.delivery_status, "UNKNOWN"),
      retryCount: number(item.retry_count, 0),
      errorReason: text(item.error_reason || item.last_error, ""),
    })),
    lastDeliveryAt: text(service.last_delivery_at_utc, "unavailable"),
    deliveryStatus: text(service.delivery_status, "UNKNOWN"),
    errorReason: text(service.error_reason || service.last_error, ""),
    secretsExposed: false,
  };
}

function canonicalDossierMeta({ portfolioIntent, payload, nowIso }) {
  return {
    source: "portfolio_order_intent_lineage",
    asOf: text(portfolioIntent.updated_at_utc || portfolioIntent.created_at_utc || nowIso, nowIso),
    revision: text(portfolioIntent.immutable_terms_hash || portfolioIntent.order_intent_hash || payload.order_intent_hash, "unavailable"),
    availability: "KNOWN",
  };
}

function canonicalDossierLineage({ execution, portfolioIntent, payload, humanGate, riskDecision }) {
  const source = payload.source || {};
  const portfolioOrderIntentId = text(portfolioIntent.portfolio_order_intent_id, "");
  const providerCommands = rows(execution.providerCommands).filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  const providerEvents = rows(execution.providerEvents).filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  return {
    strategyDefinition: { id: text(firstValue(payload.strategy_definition_id, payload.strategy_id), "unavailable") },
    strategyVersion: { id: text(firstValue(payload.strategy_version_id, payload.strategy_version), "unavailable") },
    strategyInstance: { id: text(payload.strategy_instance_id, "unavailable") },
    strategySignal: { id: text(firstValue(payload.signal_id, source.signal_id), "unavailable") },
    contextDecision: { id: text(firstValue(payload.context_gate_decision_id, payload.ai_context_gate_decision_id), "unavailable") },
    portfolioDecision: { id: text(firstValue(portfolioIntent.portfolio_arbitration_run_id, payload.portfolio_arbitration_run_id, source.portfolio_arbitration_run_id), "unavailable"), candidateAllocationIds: rows(firstValue(portfolioIntent.candidate_allocation_ids, source.candidate_allocation_ids)).map(String) },
    riskDecision: { id: text(firstValue(riskDecision?.risk_decision_id, rows(firstValue(portfolioIntent.risk_decision_ids, source.risk_decision_ids))[0]), "unavailable"), decision: text(riskDecision?.decision, "unavailable") },
    targetPosition: { id: text(firstValue(portfolioIntent.target_position_id, payload.target_position_id), "unavailable"), payload: portfolioIntent.target_position_payload || null },
    orderIntent: { id: text(firstValue(portfolioIntent.portfolio_order_intent_id, payload.order_intent_id), "unavailable") },
    humanGate: { id: humanGate.gateId || "unavailable", status: humanGate.status },
    providerCommands: providerCommands.map((item) => text(item.execution_provider_command_id, "")),
    providerEvents: providerEvents.map((item) => text(item.broker_provider_event_id || item.provider_event_id || item.event_id, "")),
    reconciliation: { availability: "PARTIAL", source: "portfolio_order_intent_execution_states" },
  };
}

function canonicalDossierExecutionTerms({ portfolioIntent, payload, order }) {
  return firstValue(portfolioIntent.execution_terms, payload.execution_terms) || {
    account_id: text(firstValue(payload.account_id, portfolioIntent.target_account_id), "unavailable"),
    broker_account_id: text(payload.broker_account_id, "unavailable"),
    instrument: text(firstValue(payload.instrument, portfolioIntent.target_instrument), "unavailable"),
    side: text(firstValue(payload.side, payload.action, order.side), "unavailable"),
    quantity: number(firstValue(payload.quantity, portfolioIntent.quantity), 0),
    order_type: text(firstValue(payload.order_type, order.type), "unavailable"),
    entry: payload.entry || { availability: "UNAVAILABLE", reason_code: "ENTRY_UNAVAILABLE" },
    stop: stopTerm(payload),
    targets: rows(payload.targets),
    time_in_force: text(firstValue(payload.time_in_force, order.tif), "unavailable"),
  };
}

function canonicalDossierRiskSnapshot({ portfolioIntent, payload, riskDecision }) {
  return firstValue(portfolioIntent.risk_snapshot, payload.risk_snapshot) || {
    requestedQty: number(firstValue(payload.quantity, portfolioIntent.quantity), 0),
    authorizedQty: number(firstValue(portfolioIntent.risk_approved_net_size, nested(riskDecision, ["approved_size"]), payload.quantity), 0),
    requestedRiskPct: firstValue(nested(riskDecision, ["requested", "risk_pct"]), null),
    authorizedRiskPct: firstValue(nested(riskDecision, ["authorized", "risk_pct"]), null),
    riskAmount: firstValue(nested(riskDecision, ["authorized", "risk_amount"]), null),
    riskPerContract: firstValue(nested(riskDecision, ["trade_risk", "risk_per_contract"]), null),
    stopDistance: {
      points: firstValue(nested(riskDecision, ["trade_risk", "stop_distance_points"]), null),
      ticks: firstValue(nested(riskDecision, ["trade_risk", "stop_distance_ticks"]), null),
    },
    nearestLimit: firstValue(nested(riskDecision, ["nearest_limit"]), null),
    reasonCodes: rows(firstValue(nested(riskDecision, ["reason_codes"]), payload.risk_reason_codes)).map(String),
  };
}

function liveAuthoritativeSources({ execution, strategy, gateDecisions, portfolioOrderIntents }) {
  const providerCommands = rows(execution?.providerCommands);
  const providerEvents = rows(execution?.providerEvents);
  const riskDecisions = portfolioOrderIntents.flatMap((item) => rows(item?.risk_decisions));
  return [
    { source: "strategy_signal_outbox", rows: rows(strategy?.signals).filter(hasSignalId).length, latestAt: latestTimestamp(rows(strategy?.signals), ["created_at_utc", "source_data_cutoff_utc", "updated_at_utc"]) },
    { source: "ai_context_gate_decisions", rows: gateDecisions.length, latestAt: latestTimestamp(gateDecisions, ["decided_at_utc", "updated_at_utc"]) },
    { source: "portfolio_risk_decisions", rows: riskDecisions.length, latestAt: latestTimestamp(riskDecisions, ["decided_at_utc", "created_at_utc"]) },
    { source: "portfolio_order_intent_lineage", rows: portfolioOrderIntents.length, latestAt: latestTimestamp(portfolioOrderIntents, ["updated_at_utc", "created_at_utc"]) },
    { source: "broker_provider_commands", rows: providerCommands.length, latestAt: latestTimestamp(providerCommands, ["created_at_utc", "updated_at_utc"]) },
    { source: "broker_provider_events", rows: providerEvents.length, latestAt: latestTimestamp(providerEvents, ["occurred_at_utc", "created_at_utc"]) },
  ];
}

function liveFreshness({ strategy, gateDecisions, portfolioOrderIntents, launchGate, nowIso }) {
  return {
    marketData: liveMarketDataStatus(launchGate),
    signalCutoffAt: latestTimestamp(rows(strategy?.signals), ["created_at_utc", "source_data_cutoff_utc", "updated_at_utc"]),
    contextDecisionAt: latestTimestamp(gateDecisions, ["decided_at_utc", "updated_at_utc"]),
    orderIntentAt: latestTimestamp(portfolioOrderIntents, ["updated_at_utc", "created_at_utc"]),
    asOf: nowIso,
  };
}

function canonicalLivePipeline({ signals, gateDecisions, portfolioOrderIntents, riskCenter, portfolioState, humanGates, providerCommands, providerEvents, launchGate }) {
  const targetPositions = targetPositionCount({ portfolioState, portfolioOrderIntents });
  return [
    livePipelineStage("DATA", dataPipelineStatus(launchGate), liveMarketDataStatus(launchGate), "health.data_readiness"),
    livePipelineStage("STRATEGY_SIGNAL", signals.length ? "OK" : "WAITING", `${signals.length} signal(s) déterministe(s) publié(s)`, "strategy_signal_outbox"),
    livePipelineStage("AI_CONTEXT_GATE", gateDecisions.length ? "OK" : "WAITING", `${gateDecisions.length} décision(s) context gate`, "ai_context_gate_decisions"),
    livePipelineStage("PORTFOLIO_ARBITRATION", portfolioOrderIntents.length ? "OK" : "WAITING", `${portfolioOrderIntents.length} intention(s) issues du netting`, "portfolio_order_intent_lineage"),
    livePipelineStage("GLOBAL_RISK", riskPipelineStatus(riskCenter), text(firstValue(nested(riskCenter, ["globalStatus"]), nested(riskCenter, ["availability"])), "Risk center non publié"), "portfolio_risk_decisions"),
    livePipelineStage("TARGET_POSITION", targetPositions ? "OK" : "WAITING", `${targetPositions} target position(s)`, "portfolio_target_positions"),
    livePipelineStage("ORDER_INTENT", portfolioOrderIntents.length ? "OK" : "WAITING", `${portfolioOrderIntents.length} OrderIntent(s) post-risk`, "portfolio_order_intent_lineage"),
    livePipelineStage(
      "HUMAN_GATE",
      humanGates.length ? "WAITING_OPERATOR" : portfolioOrderIntents.length ? "BLOCKED" : "WAITING",
      humanGates.length ? `${humanGates.length} Human Gate(s)` : portfolioOrderIntents.length ? "OrderIntent présent, mais aucun Human Gate canonique n'a été créé." : "Aucun OrderIntent ne requiert un Human Gate.",
      "human_execution_gates",
    ),
    livePipelineStage("EXECUTION_GATEWAY", providerCommands.length ? "OK" : "BLOCKED", providerCommands.length ? `${providerCommands.length} commande(s) provider` : "Aucune commande provider créée tant que Human Gate/Execution restent fermés.", "broker_provider_commands"),
    livePipelineStage("PROVIDER_EVENTS", providerEvents.length ? "OK" : "WAITING", `${providerEvents.length} événement(s) provider observé(s) ; ACK n'est jamais un fill.`, "broker_provider_events"),
  ];
}

function payloadOf(item = {}) { return firstValue(item.order_intent_payload, item.payload) || {}; }
function stopTerm(payload = {}) {
  const price = nested(payload, ["protection", "stop_price"]);
  return { availability: price == null ? "UNAVAILABLE" : "KNOWN", price: price ?? null };
}
function dataPipelineStatus(launchGate) {
  if (nested(launchGate, ["status"]) === "READY") return "OK";
  return liveMarketDataStatus(launchGate) === "FRESH" ? "OK" : "BLOCKED";
}
function riskPipelineStatus(riskCenter) {
  if (nested(riskCenter, ["availability"]) === "KNOWN") return "OK";
  if (rows(nested(riskCenter, ["breaches"])).length) return "OK";
  return rows(nested(riskCenter, ["limits"])).length ? "OK" : "WAITING";
}
function targetPositionCount({ portfolioState, portfolioOrderIntents }) {
  return rows(nested(portfolioState, ["pendingTargetPositions"])).length || portfolioOrderIntents.length;
}
function firstValue(...values) {
  for (const value of values) if (value !== null && value !== undefined && value !== "") return value;
  return undefined;
}
function nested(source, path) {
  let value = source;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = value[key];
  }
  return value;
}

function activeStrategyInstanceRows(strategy, nowIso) {
  const definitionByVersion = new Map(rows(strategy?.versions).map((version) => [String(version.strategy_version_id), version.strategy_definition_id]));
  return rows(strategy?.instances).filter(isActiveExecutionMode).map((item) => {
    const lastEvaluationAt = text(item.last_evaluation_at_utc, "");
    const lastHeartbeatAt = text(item.last_heartbeat_at || item.last_heartbeat_at_utc, "");
    const configuredState = runtimeState(item.runtime_state || item.status);
    const observedAt = lastEvaluationAt || lastHeartbeatAt;
    const observedAgeMs = observedAt ? Date.parse(nowIso) - Date.parse(observedAt) : Number.POSITIVE_INFINITY;
    const schedulerHealth = text(item.scheduler_health, observedAt ? "OBSERVED" : "NOT_OBSERVED").toUpperCase();
    const effectiveRuntimeState = configuredState === "RUNNING" && (schedulerHealth === "NOT_OBSERVED" || !Number.isFinite(observedAgeMs) || observedAgeMs > 20 * 60_000)
      ? "STALE"
      : configuredState;
    return {
      strategyInstanceId: text(item.strategy_instance_id, "unavailable"),
      strategyDefinitionId: text(item.strategy_definition_id || definitionByVersion.get(String(item.strategy_version_id)), "unavailable"),
      strategyVersionId: text(item.strategy_version_id, "unavailable"),
      executionMode: executionModeState(item.execution_mode),
      configuredState,
      runtimeState: effectiveRuntimeState,
      schedulerHealth,
      lastHeartbeatAt,
      lastEvaluationAt,
      nextEvaluationAt: text(item.next_evaluation_at_utc || item.next_run_at_utc, ""),
      lastEvaluationResult: text(item.last_evaluation_result, "UNKNOWN"),
      lastError: text(item.last_error, ""),
      artifactVersion: text(item.artifact_version, ""),
      scheduler: item.scheduler || null,
    };
  });
}

function nominalRiskCenter(riskCenter, intents) {
  if (!riskCenter) return null;
  if (!intents.length) return {
    ...riskCenter,
    availability: "UNAVAILABLE",
    globalStatus: "DATA_UNAVAILABLE",
    openRisk: { availability: "UNAVAILABLE", value: null, reasonCode: "NO_NOMINAL_RISK_DECISION" },
    pendingOrderIntents: 0,
    pendingTargetPositions: 0,
  };
  return { ...riskCenter, pendingOrderIntents: intents.length };
}

function nominalPortfolioState(portfolioState, intentIds) {
  if (!portfolioState) return null;
  return {
    ...portfolioState,
    pendingTargetPositions: rows(portfolioState.pendingTargetPositions).filter((item) => intentIds.has(String(item.orderIntentId || item.order_intent_id || ""))),
  };
}

function aiContextGateRows(gateDecisions) {
  return gateDecisions.slice(0, 12).map((item) => ({
    decisionId: text(item.decision_id || item.ai_context_gate_decision_id, "unavailable"),
    status: text(item.status, "UNKNOWN"),
    mode: text(item.mode, "SHADOW"),
    recommendation: text(item.recommendation, "UNKNOWN"),
    confidence: nullableNumber(item.confidence),
    riskMultiplier: nullableNumber(item.risk_multiplier),
    reasonCodes: stringList(item.reason_codes),
    anomalies: stringList(item.anomalies),
    decidedAt: text(item.decided_at_utc || item.updated_at_utc, ""),
  }));
}

function auditSignalEvents(strategy) {
  return rows(strategy?.signals).filter(hasSignalId).map((item) => auditEventRow({
    id: item.signal_outbox_id || item.signal_id,
    at: item.created_at_utc || item.source_data_cutoff_utc,
    domain: "Strategy",
    eventType: "strategy.signal.published",
    status: item.status || item.state || "RECORDED",
    title: `Signal ${text(item.instrument_code || item.symbol, "instrument")}`,
    detail: text(item.reason || item.summary, "Signal déterministe publié par le Strategy Kernel."),
    correlationId: item.correlation_id || item.signal_id || item.signal_outbox_id,
    causationId: item.strategy_instance_id,
    authority: "AUTHORITATIVE",
    route: item.signal_id || item.signal_outbox_id ? `/live/signals/${encodeURIComponent(String(item.signal_id || item.signal_outbox_id))}` : null,
    payload: item,
  }));
}

function auditOrderIntentEvents(execution) {
  return rows(execution?.portfolioOrderIntents).map((item) => {
    const payload = item.order_intent_payload || item.payload || {};
    return auditEventRow({
      id: item.portfolio_order_intent_id || payload.order_intent_id,
      at: item.created_at_utc || payload.requested_at_utc,
      domain: "OrderIntent",
      eventType: "portfolio.order_intent.created",
      status: item.status || payload.status || "READY",
      title: `OrderIntent ${text(item.target_instrument || payload.instrument, "instrument")}`,
      detail: "Intention post Portfolio/Risk ; ne constitue pas un ordre provider ni un fill.",
      correlationId: item.correlation_id || payload.correlation_id || payload.signal_id,
      causationId: item.target_position_id || payload.target_position_id,
      authority: "AUTHORITATIVE",
      route: `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id || payload.order_intent_id || ""))}`,
      payload: { order_intent_payload: payload, risk_snapshot: item.risk_snapshot, immutability: item.immutability },
    });
  });
}

function auditProviderCommandEvents(execution) {
  return rows(execution?.providerCommands).map((item) => auditEventRow({
    id: item.execution_provider_command_id,
    at: item.created_at_utc || item.updated_at_utc,
    domain: "ExecutionGateway",
    eventType: "execution.provider_command.created",
    status: item.status || "RECORDED",
    title: `Provider command ${text(item.action || item.command_type, "command")}`,
    detail: "Commande provider auditée ; un ACK provider n'est pas un fill.",
    correlationId: item.correlation_id || item.portfolio_order_intent_id,
    causationId: item.portfolio_order_intent_id,
    authority: "AUTHORITATIVE",
    route: item.portfolio_order_intent_id ? `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id))}` : "/execution/providers",
    payload: item,
  }));
}

function auditProviderEvents(execution) {
  return rows(execution?.providerEvents).map((item) => auditEventRow({
    id: item.broker_provider_event_id || item.provider_event_id || item.event_id,
    at: item.occurred_at_utc || item.created_at_utc,
    domain: "Provider",
    eventType: item.event_type || "provider.event",
    status: item.status || item.provider_status || "RECORDED",
    title: text(item.message || item.event_type, "Provider event"),
    detail: "Événement provider normalisé. Le fill doit venir d'un événement FILL explicite.",
    correlationId: item.correlation_id || item.portfolio_order_intent_id || item.execution_provider_command_id,
    causationId: item.execution_provider_command_id,
    authority: "AUTHORITATIVE",
    route: item.portfolio_order_intent_id ? `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id))}` : "/execution/providers",
    payload: item,
  }));
}

function auditExecutionTimelineEvents(execution) {
  return rows(execution?.timeline).filter((item) => item?.event_id).map((item) => auditEventRow({
    id: item.event_id,
    at: item.occurred_at_utc || item.created_at_utc,
    domain: text(item.domain || item.step, "Execution"),
    eventType: item.event_type || item.title,
    status: item.status || item.severity || "RECORDED",
    title: item.title || item.event_type,
    detail: item.detail || item.message,
    correlationId: item.correlation_id,
    causationId: item.causation_id,
    authority: "AUTHORITATIVE",
    route: "/operations/observability",
    payload: item,
  }));
}

function auditRuntimeEvents(runtime, nowIso) {
  return rows(runtime).filter((item) => item?.task_id || item?.worker_id).map((item) => auditEventRow({
    id: item.task_id || item.worker_id,
    at: item.updated_at_utc || item.created_at_utc || nowIso,
    domain: "AgentRuntime",
    eventType: item.task_type || "agent.task",
    status: item.status || "RECORDED",
    title: `Agent ${text(item.worker_id, "runtime")}`,
    detail: text(item.error_message || item.message, "Tâche agent persistée."),
    correlationId: item.correlation_id || item.task_id,
    causationId: item.mission_id,
    authority: "ADVISORY",
    route: "/operations",
    payload: item,
  }));
}

function auditIncidentEvents(incidents, nowIso) {
  return rows(incidents).filter(hasIncidentId).map((item) => auditEventRow({
    id: item.incident_id,
    at: item.created_at_utc || item.opened_at_utc || nowIso,
    domain: text(item.domain, "Incident"),
    eventType: "incident.created",
    status: item.status || item.severity || "OPEN",
    title: item.title,
    detail: item.detail || item.message,
    correlationId: item.correlation_id || item.incident_id,
    causationId: item.order_id || item.position_id || item.workflow_id,
    authority: "AUTHORITATIVE",
    route: `/operations/incidents/${encodeURIComponent(String(item.incident_id))}`,
    payload: item,
  }));
}

function auditEventRow({ id, at, domain, eventType, status, title, detail, correlationId, causationId, authority, route, payload }) {
  const sourcePayload = payload && typeof payload === "object" ? payload : {};
  return {
    eventId: text(id, ""),
    at: text(at, "unavailable"),
    domain: text(domain, "operations"),
    eventType: text(eventType, "event"),
    status: text(status, "RECORDED"),
    title: text(title, "Événement"),
    detail: text(detail, "Détail non publié."),
    correlationId: text(correlationId, "none"),
    causationId: text(causationId, ""),
    authority: authority === "ADVISORY" ? "ADVISORY" : "AUTHORITATIVE",
    latencyMs: nullableNumber(sourcePayload.latency_ms ?? sourcePayload.latencyMs),
    route: route || null,
    payloadPreview: objectFacts(sourcePayload, Object.keys(sourcePayload).slice(0, 8)),
  };
}

function livePipelineStage(stepId, status, detail, source) {
  return { stepId, label: stepId.replaceAll("_", " "), status, detail, source };
}

function executionPolicy(execution, health) {
  const safety = execution?.safety || {};
  const authority = upper(safety.executionAuthorityMode || safety.execution_authority_mode);
  return {
    environment: upper(safety.environment || health?.environment) || "UNKNOWN",
    executionMode: authority.includes("SEMI") ? "SEMI_MANUAL" : authority || "UNKNOWN",
    autoExecutionEnabled: safety.executionEnabled === true && authority === "AUTO",
    physicalExecutionEnabled: safety.submissionPossible === true,
    humanGateRequired: safety.entryOperatorApprovalRequired === true || authority.includes("SEMI"),
    ackIsFill: false,
  };
}
