export { frontAuditEvents, auditRelations } from "./front-control-plane-audit-projection.js";
export { telegramDrilldownFromHealth } from "./front-control-plane-telegram-projection.js";
import { liveMarketDataStatus } from "./front-control-plane-demo-paper.js";
import {
  countBy,
  currentUtc,
  firstRow,
  hasSignalId,
  isActiveExecutionMode,
  latestTimestamp,
  nullableNumber,
  number,
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
  const humanGate = orderHumanGateProjection({ execution, portfolioIntent, actor, nowIso });
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
        additionalAllowedActions: humanGate.actions.map((action) => action.action),
      }),
      humanGate: resourceAllowedActions({
        resourceType: "HumanGate",
        status: humanGate.status,
        revision: text(humanGate.revision, "0"),
        actor,
        expiresAt: humanGate.expiresAt,
        additionalAllowedActions: humanGate.actions.map((action) => action.action),
      }),
    },
  };
}

export function liveCanonicalRuntime({ execution = {}, strategy = {}, ai = {}, risk = {}, launchGate, actor = {}, nowIso = currentUtc(), health = {} }) {
  const cohort = currentLiveLineageCohort({ execution, strategy, nowIso });
  const currentSignals = cohort.signals;
  const signals = currentSignals.filter(hasSignalId).map(signalRow);
  const gateDecisions = rows(ai?.decisions).filter((item) => cohort.signalIds.has(String(item.signal_id || "")));
  const portfolioOrderIntents = cohort.portfolioOrderIntents;
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
    authoritativeSources: liveAuthoritativeSources({ execution, signals: currentSignals, gateDecisions, portfolioOrderIntents }),
    freshness: liveFreshness({ signals: currentSignals, gateDecisions, portfolioOrderIntents, launchGate, nowIso }),
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
    activeStrategyInstances: activeStrategyInstanceRows(strategy, nowIso, health),
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

export function currentLiveLineageCohort({ execution = {}, strategy = {}, nowIso = currentUtc() } = {}) {
  const nominalSignals = rows(strategy?.signals).filter(isNominalLiveSignal);
  const currentSignals = nominalSignals.filter((item) => isCurrentLiveSignal(item, nowIso));
  const knownSignalIds = signalIds(nominalSignals);
  const currentSignalIds = signalIds(currentSignals);
  const portfolioOrderIntents = rows(execution?.portfolioOrderIntents)
    .filter(isNominalPortfolioIntent)
    .filter((item) => isCurrentLivePortfolioIntent(item, nowIso))
    .filter((item) => belongsToCurrentSignalCohort(item, knownSignalIds, currentSignalIds));
  const cohortSignalIds = new Set(currentSignalIds);
  for (const intent of portfolioOrderIntents) {
    const signalId = portfolioIntentSignalId(intent);
    if (signalId) cohortSignalIds.add(signalId);
  }
  return { signals: currentSignals, portfolioOrderIntents, signalIds: cohortSignalIds };
}

// The actionable Live cohort deliberately excludes expired and terminal
// resources. The theoretical performance/history projection must not use that
// same filter: doing so makes a closed outcome disappear as soon as its signal
// expires. Keep current intents plus every nominal intent for which the backend
// has durable theoretical or manual tracking evidence.
export function liveTheoreticalLineageCohort({ execution = {}, currentPortfolioOrderIntents = [] } = {}) {
  const currentIds = new Set(rows(currentPortfolioOrderIntents).map(portfolioIntentId).filter(Boolean));
  const evidenceIds = new Set();
  for (const collection of [execution?.theoreticalEvents, execution?.manualExecutionEvents, execution?.trades]) {
    for (const item of rows(collection)) {
      const id = portfolioIntentId(item);
      if (id) evidenceIds.add(id);
    }
  }
  const nominal = rows(execution?.portfolioOrderIntents).filter(isNominalPortfolioIntent);
  const evidenceDates = nominal
    .filter((item) => evidenceIds.has(portfolioIntentId(item)))
    .map(portfolioIntentTradingDate)
    .filter(Boolean)
    .sort();
  const latestEvidenceDate = evidenceDates.at(-1) || "";
  return nominal.filter((item) => {
    const id = portfolioIntentId(item);
    if (currentIds.has(id)) return true;
    if (!evidenceIds.has(id)) return false;
    const tradingDate = portfolioIntentTradingDate(item);
    return !latestEvidenceDate || !tradingDate || tradingDate === latestEvidenceDate;
  });
}

export function liveFocusLineageCohort({ execution = {}, currentPortfolioOrderIntents = [], limit = 48 } = {}) {
  const currentIds = new Set(rows(currentPortfolioOrderIntents).map(portfolioIntentId).filter(Boolean));
  const durableIds = new Set(currentIds);
  for (const collection of [execution?.humanExecutionGates, execution?.theoreticalEvents, execution?.manualExecutionEvents, execution?.trades]) {
    for (const item of rows(collection)) {
      const id = portfolioIntentId(item);
      if (id) durableIds.add(id);
    }
  }
  return rows(execution?.portfolioOrderIntents)
    .filter(isNominalPortfolioIntent)
    .filter((item) => durableIds.has(portfolioIntentId(item)))
    .sort((left, right) => Date.parse(intentActivityAt(right) || "") - Date.parse(intentActivityAt(left) || ""))
    .slice(0, positiveLimit(limit, 48, 200));
}

export function isNominalLiveSignal(item = {}) {
  return String(item.source_class || item.sourceClass || "LIVE").toUpperCase() !== "CERTIFICATION_REPLAY"
    && !item.certification_run_id
    && !item.certificationRunId;
}

export function isCurrentLiveSignal(item = {}, nowIso = currentUtc()) {
  const status = upper(firstValue(item.status, item.state, ""));
  if (["EXPIRED", "CANCELLED", "CANCELED", "REJECTED", "FAILED", "SUPERSEDED", "CLOSED", "DONE", "CONSUMED"].includes(status)) return false;
  const expiresAt = firstValue(item.expires_at_utc, item.expiresAt);
  const nowMs = Date.parse(nowIso || currentUtc());
  const expiresMs = Date.parse(expiresAt || "");
  return !(Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs);
}

export function portfolioIntentSignalId(item = {}) {
  const payload = payloadOf(item);
  const lineage = item.lineage || payload.lineage || payload.source?.lineage || {};
  return text(firstValue(
    item.signal_id,
    item.strategy_signal_id,
    payload.signal_id,
    payload.strategy_signal_id,
    rows(lineage.strategy_signal_ids)[0],
  ), "");
}

function portfolioIntentId(item = {}) {
  const payload = payloadOf(item);
  return text(firstValue(
    item.portfolio_order_intent_id,
    item.portfolioOrderIntentId,
    item.order_intent_id,
    item.orderIntentId,
    payload.portfolio_order_intent_id,
    payload.order_intent_id,
  ), "");
}

function intentActivityAt(item = {}) {
  const payload = payloadOf(item);
  return firstValue(item.updated_at_utc, item.created_at_utc, item.requested_at_utc, payload.updated_at_utc, payload.created_at_utc, payload.requested_at_utc);
}

function positiveLimit(value, fallback, max) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function portfolioIntentTradingDate(item = {}) {
  const payload = payloadOf(item);
  const value = firstValue(item.created_at_utc, item.requested_at_utc, payload.requested_at_utc, payload.created_at_utc);
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

export function isNominalPortfolioIntent(item = {}) {
  const payload = payloadOf(item);
  const terms = item.execution_terms || payload.execution_terms || {};
  const lineage = item.lineage || payload.lineage || payload.source?.lineage || {};
  const values = [
    item.target_account_id,
    payload.account_id,
    payload.broker_account_id,
    terms.account_id,
    terms.broker_account_id,
    item.correlation_id,
    payload.correlation_id,
  ].map((value) => String(value || "").toLowerCase());
  const strategySignalId = portfolioIntentSignalId(item);
  const strategyInstanceId = firstValue(
    item.strategy_instance_id,
    payload.strategy_instance_id,
    rows(lineage.strategy_instance_ids)[0],
  );
  return Boolean(strategySignalId && strategyInstanceId)
    && !values.some((value) => value === "shadow_certification" || value.startsWith("certification:") || value.startsWith("corr_cert_shadow_"));
}

export function isCurrentLivePortfolioIntent(item = {}, nowIso = currentUtc()) {
  const payload = payloadOf(item);
  const status = String(firstValue(item.status, payload.status, "") || "").toUpperCase();
  const terminalStatuses = new Set([
    "EXPIRED",
    "CANCELLED",
    "CANCELED",
    "REJECTED",
    "FAILED",
    "SUPERSEDED",
    "FILLED",
    "CLOSED",
    "DONE",
  ]);
  if (terminalStatuses.has(status)) return false;
  const expiresAt = firstValue(item.expires_at_utc, item.expiresAt, payload.expires_at_utc, payload.expiresAt);
  if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.parse(nowIso || currentUtc())) return false;
  return true;
}

export function isCurrentPortfolioIntent(item = {}, nowIso = currentUtc()) {
  return isCurrentLivePortfolioIntent(item, nowIso);
}

export function portfolioOrderIntentSummaryRow({ execution = {}, item = {}, actor = {}, nowIso = currentUtc() }) {
  const intent = intentRow(item);
  const payload = payloadOf(item);
  const portfolioOrderIntentId = text(firstValue(item.portfolio_order_intent_id, payload.order_intent_id), intent.orderIntentId);
  const humanGate = orderHumanGateProjection({ execution, portfolioIntent: item, actor, nowIso });
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
    humanGate: { gateId: humanGate.gateId || null, status: humanGate.status, expiresAt: humanGate.expiresAt || null, revision: humanGate.revision, undoExpiresAt: humanGate.undoExpiresAt || null, undoneAt: humanGate.undoneAt || null, allowedActions: humanGate.actions },
    allowedActions: resourceAllowedActions({
      resourceType: "OrderIntent",
      status: humanGate.gateId ? humanGate.status : "HUMAN_GATE_NOT_CREATED",
      revision: text(firstValue(item.immutable_terms_hash, item.order_intent_hash, payload.order_intent_hash), "unavailable"),
      actor,
      expiresAt: humanGate.expiresAt || text(item.expires_at_utc || payload.expires_at_utc, ""),
      additionalAllowedActions: humanGate.actions.map((action) => action.action),
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
  const lineage = firstValue(portfolioIntent.lineage, payload.lineage, source.lineage) || {};
  const portfolioOrderIntentId = text(portfolioIntent.portfolio_order_intent_id, "");
  const providerCommands = rows(execution.providerCommands).filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  const providerEvents = rows(execution.providerEvents).filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  return {
    strategyDefinition: { id: text(firstValue(payload.strategy_definition_id, payload.strategy_id, rows(lineage.strategy_definition_ids)[0]), "unavailable") },
    strategyVersion: { id: text(firstValue(payload.strategy_version_id, payload.strategy_version, rows(lineage.strategy_version_ids)[0]), "unavailable") },
    strategyInstance: { id: text(firstValue(payload.strategy_instance_id, rows(lineage.strategy_instance_ids)[0]), "unavailable") },
    strategySignal: { id: text(firstValue(portfolioIntentSignalId(portfolioIntent), payload.signal_id, source.signal_id), "unavailable") },
    contextDecision: { id: text(firstValue(payload.context_gate_decision_id, payload.ai_context_gate_decision_id), "unavailable") },
    portfolioDecision: { id: text(firstValue(portfolioIntent.portfolio_arbitration_run_id, payload.portfolio_arbitration_run_id, source.portfolio_arbitration_run_id), "unavailable"), candidateAllocationIds: rows(firstValue(portfolioIntent.candidate_allocation_ids, source.candidate_allocation_ids)).map(String) },
    riskDecision: { id: text(firstValue(riskDecision?.risk_decision_id, rows(firstValue(portfolioIntent.risk_decision_ids, source.risk_decision_ids, lineage.risk_decision_ids))[0]), "unavailable"), decision: text(riskDecision?.decision, "unavailable") },
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
    quantity: nullableNumber(firstValue(payload.quantity, portfolioIntent.quantity)),
    order_type: text(firstValue(payload.order_type, order.type), "unavailable"),
    entry: payload.entry || { availability: "UNAVAILABLE", reason_code: "ENTRY_UNAVAILABLE" },
    stop: stopTerm(payload),
    targets: rows(payload.targets),
    time_in_force: text(firstValue(payload.time_in_force, order.tif), "unavailable"),
  };
}

function canonicalDossierRiskSnapshot({ portfolioIntent, payload, riskDecision }) {
  return firstValue(portfolioIntent.risk_snapshot, payload.risk_snapshot) || {
    requestedQty: nullableNumber(firstValue(payload.quantity, portfolioIntent.quantity)),
    authorizedQty: nullableNumber(firstValue(portfolioIntent.risk_approved_net_size, nested(riskDecision, ["approved_size"]), payload.quantity)),
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

function liveAuthoritativeSources({ execution, signals, gateDecisions, portfolioOrderIntents }) {
  const providerCommands = rows(execution?.providerCommands);
  const providerEvents = rows(execution?.providerEvents);
  const riskDecisions = portfolioOrderIntents.flatMap((item) => rows(item?.risk_decisions));
  return [
    { source: "strategy_signal_outbox", rows: rows(signals).filter(hasSignalId).length, latestAt: latestTimestamp(rows(signals), ["created_at_utc", "source_data_cutoff_utc", "updated_at_utc"]) },
    { source: "ai_context_gate_decisions", rows: gateDecisions.length, latestAt: latestTimestamp(gateDecisions, ["decided_at_utc", "updated_at_utc"]) },
    { source: "portfolio_risk_decisions", rows: riskDecisions.length, latestAt: latestTimestamp(riskDecisions, ["decided_at_utc", "created_at_utc"]) },
    { source: "portfolio_order_intent_lineage", rows: portfolioOrderIntents.length, latestAt: latestTimestamp(portfolioOrderIntents, ["updated_at_utc", "created_at_utc"]) },
    { source: "broker_provider_commands", rows: providerCommands.length, latestAt: latestTimestamp(providerCommands, ["created_at_utc", "updated_at_utc"]) },
    { source: "broker_provider_events", rows: providerEvents.length, latestAt: latestTimestamp(providerEvents, ["occurred_at_utc", "created_at_utc"]) },
  ];
}

function liveFreshness({ signals, gateDecisions, portfolioOrderIntents, launchGate, nowIso }) {
  return {
    marketData: liveMarketDataStatus(launchGate),
    signalCutoffAt: latestTimestamp(rows(signals), ["created_at_utc", "source_data_cutoff_utc", "updated_at_utc"]),
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
  return ["FRESH", "LIVE"].includes(upper(liveMarketDataStatus(launchGate))) ? "OK" : "BLOCKED";
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

function activeStrategyInstanceRows(strategy, nowIso, health = {}) {
  const marketClosed = health?.data_readiness?.market_closed === true;
  const liveScheduler = rows(health?.operations?.services).find((item) => item?.service_kind === "live_runtime_scheduler");
  const liveSchedulerHealthy = liveScheduler?.healthy === true || ["HEALTHY", "OK", "READY"].includes(String(liveScheduler?.status || "").toUpperCase());
  const definitionByVersion = new Map(rows(strategy?.versions).map((version) => [String(version.strategy_version_id), version.strategy_definition_id]));
  const nameByDefinition = new Map(rows(strategy?.definitions).map((definition) => [String(definition.strategy_definition_id || definition.strategy_id), definition.name || definition.label]).filter(([, name]) => Boolean(name)));
  return rows(strategy?.instances).filter(isActiveExecutionMode).map((item) => {
    const lastEvaluationAt = text(item.last_evaluation_at_utc, "");
    const lastHeartbeatAt = text(item.last_heartbeat_at || item.last_heartbeat_at_utc, "");
    const configuredState = runtimeState(item.runtime_state || item.status);
    const observedAt = lastEvaluationAt || lastHeartbeatAt;
    const observedAgeMs = observedAt ? Date.parse(nowIso) - Date.parse(observedAt) : Number.POSITIVE_INFINITY;
    const schedulerHealth = text(item.scheduler_health, observedAt ? "OBSERVED" : "NOT_OBSERVED").toUpperCase();
    const intentionallyIdle = configuredState === "RUNNING" && marketClosed && liveSchedulerHealthy;
    const effectiveRuntimeState = intentionallyIdle
      ? "MARKET_CLOSED"
      : configuredState === "RUNNING" && (schedulerHealth === "NOT_OBSERVED" || !Number.isFinite(observedAgeMs) || observedAgeMs > 20 * 60_000)
        ? "STALE"
        : configuredState;
    const resolvedDefinitionId = text(item.strategy_definition_id || definitionByVersion.get(String(item.strategy_version_id)), "unavailable");
    return {
      strategyInstanceId: text(item.strategy_instance_id, "unavailable"),
      strategyDefinitionId: resolvedDefinitionId,
      strategyVersionId: text(item.strategy_version_id, "unavailable"),
      name: nameByDefinition.get(resolvedDefinitionId) || null,
      executionMode: executionModeState(item.execution_mode),
      configuredState,
      runtimeState: effectiveRuntimeState,
      schedulerHealth: intentionallyIdle ? "IDLE_MARKET_CLOSED" : schedulerHealth,
      instruments: stringList(item.instrument_scope),
      sessionScopes: stringList(item.session_scope),
      lastHeartbeatAt,
      lastEvaluationAt,
      nextEvaluationAt: text(item.next_evaluation_at_utc || item.next_run_at_utc, ""),
      lastEvaluationResult: text(item.last_evaluation_result, "UNKNOWN"),
      lastEvaluationReasonCodes: stringList(item.last_evaluation_reason_codes),
      lastEvaluationContext: item.last_evaluation_payload || null,
      lastError: text(item.last_error, ""),
      artifactVersion: text(item.artifact_version, ""),
      scheduler: item.scheduler || null,
    };
  });
}

function nominalRiskCenter(riskCenter, intents) {
  if (!riskCenter) return null;
  const decisions = intents.flatMap((item) => rows(item?.risk_decisions));
  if (!intents.length || !decisions.length) return {
    ...riskCenter,
    availability: "CONNECTED_EMPTY",
    globalStatus: "NO_NOMINAL_DECISION",
    reason: intents.length
      ? "Aucune décision Global Risk n'est publiée pour les OrderIntents de la cohorte courante."
      : "Aucun OrderIntent nominal ne nécessite une décision Global Risk dans la fenêtre courante.",
    openRisk: { availability: "CONNECTED_EMPTY", value: null, reasonCode: "NO_NOMINAL_RISK_DECISION" },
    limits: [],
    breaches: [],
    nearestLimits: [],
    policyVersions: [],
    pendingOrderIntents: intents.length,
    pendingTargetPositions: new Set(intents.map((item) => item?.target_position_id).filter(Boolean)).size,
  };
  const riskAmounts = intents.map(currentIntentRiskAmount).filter((value) => value !== null);
  const blocked = decisions.some(isBlockingRiskDecision) || decisions.some((item) => rows(item?.breaches).length > 0);
  return {
    ...riskCenter,
    availability: "KNOWN",
    globalStatus: blocked ? "BLOCKED" : "CONTROLLED",
    openRisk: riskAmounts.length
      ? { availability: "KNOWN", value: riskAmounts.reduce((sum, value) => sum + value, 0), currency: "USD", source: "portfolio_risk_decisions" }
      : { availability: "UNAVAILABLE", value: null, reasonCode: "CURRENT_RISK_AMOUNT_UNAVAILABLE" },
    limits: decisions.flatMap((item) => rows(item?.limits)),
    breaches: decisions.flatMap((item) => rows(item?.breaches)),
    nearestLimits: decisions.map((item) => item?.nearest_limit).filter(Boolean),
    policyVersions: [...new Set(decisions.map((item) => item?.risk_rule_set_version).filter(Boolean))],
    pendingOrderIntents: intents.length,
    pendingTargetPositions: new Set(intents.map((item) => item?.target_position_id).filter(Boolean)).size,
  };
}

function currentIntentRiskAmount(intent = {}) {
  const payload = payloadOf(intent);
  const decision = firstRow(intent.risk_decisions) || {};
  const candidates = [
    intent.risk_snapshot?.riskAmount,
    intent.risk_snapshot?.risk_amount,
    payload.risk_snapshot?.riskAmount,
    payload.risk_snapshot?.risk_amount,
    nested(decision, ["authorized", "risk_amount"]),
    nested(decision, ["risk_economics", "authorized_risk_amount"]),
  ];
  return candidates.map(nullableNumber).find((value) => value !== null) ?? null;
}

function isBlockingRiskDecision(decision = {}) {
  return ["BLOCK", "BLOCKED", "REJECT", "REJECTED", "FAILED", "DENIED"].includes(upper(firstValue(decision.status, decision.decision)));
}

function signalIds(items) {
  return new Set(rows(items).map((item) => String(item.signal_id || item.signal_outbox_id || "")).filter(Boolean));
}

function belongsToCurrentSignalCohort(intent, knownSignalIds, currentSignalIds) {
  const signalId = portfolioIntentSignalId(intent);
  return !signalId || !knownSignalIds.has(signalId) || currentSignalIds.has(signalId);
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
    signalId: text(item.signal_id || item.strategy_signal_id, "") || null,
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
