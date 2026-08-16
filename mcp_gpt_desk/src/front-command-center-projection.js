import { text } from "./front-control-plane-common.js";
import {
  frontAuditEvents,
  isNominalLiveSignal,
  isNominalPortfolioIntent,
  portfolioOrderIntentSummaryRow,
} from "./front-control-plane-domain-completeness.js";

export function buildCommandCenterProjection(context) {
  const execution = nominalExecution(context.execution);
  const strategy = nominalStrategy(context.strategy);
  const nominalContext = { ...context, execution, strategy };
  const incidents = rows(context.incidents);
  const incidentsAvailable = context.incidents != null;
  return {
    mode: modeProjection(nominalContext),
    summary: summaryProjection(nominalContext, incidents, incidentsAvailable),
    systems: systemsProjection(nominalContext),
    activity: activityProjection(nominalContext),
    risk: riskProjection(nominalContext, incidents, incidentsAvailable),
    lanes: lanesProjection(nominalContext),
    upcoming: upcomingProjection(nominalContext),
    market: marketProjection(context.health),
    research: researchProjection(nominalContext),
    signals: signalProjection(strategy),
    humanGate: humanGateProjection(execution, context.actor, context.nowIso),
    provider: providerProjection(execution),
    performance: performanceProjection(context.performance),
    incidents: incidentProjection(context.incidents),
    operations: operationsProjection(nominalContext),
    assistant: assistantProjection(context.assistantRuntime),
    audit: auditProjection(nominalContext),
  };
}

function nominalStrategy(strategy) {
  if (!strategy) return strategy;
  return { ...strategy, signals: rows(strategy.signals).filter(isNominalLiveSignal) };
}

function nominalExecution(execution) {
  if (!execution) return execution;
  const portfolioOrderIntents = rows(execution.portfolioOrderIntents).filter(isNominalPortfolioIntent);
  const intentIds = new Set(portfolioOrderIntents.map((item) => String(item.portfolio_order_intent_id || "")).filter(Boolean));
  const providerCommands = rows(execution.providerCommands).filter((item) => !item.portfolio_order_intent_id || intentIds.has(String(item.portfolio_order_intent_id)));
  const commandIds = new Set(providerCommands.map((item) => String(item.execution_provider_command_id || "")).filter(Boolean));
  return {
    ...execution,
    portfolioOrderIntents,
    humanExecutionGates: rows(execution.humanExecutionGates).filter((item) => intentIds.has(String(item.portfolio_order_intent_id || ""))),
    providerCommands,
    providerEvents: rows(execution.providerEvents).filter((item) => (
      (!item.portfolio_order_intent_id || intentIds.has(String(item.portfolio_order_intent_id)))
      && (!item.execution_provider_command_id || commandIds.has(String(item.execution_provider_command_id)))
    )),
  };
}

function modeProjection({ execution, health }) {
  const safety = execution?.safety || null;
  const authorityMode = executionMode(safety);
  const autoExecutionEnabled = safety?.executionEnabled === true && authorityMode === "AUTO";
  return {
    environment: text(safety?.environment || health?.environment, "UNKNOWN").toUpperCase(),
    executionMode: authorityMode,
    autoExecution: booleanState(autoExecutionEnabled),
    liveBroker: booleanState(safety?.physicalExecutionEnabled ?? safety?.liveAccountAllowed),
    autoExecutionEnabled,
    physicalExecutionEnabled: safety?.physicalExecutionEnabled === true || safety?.liveAccountAllowed === true,
    humanGateRequired: safety?.humanGateRequired !== false,
    providerSubmissionEnabled: safety?.submissionPossible === true,
    release: text(health?.release_version || health?.release || health?.version, "UNAVAILABLE"),
    marketData: marketState(health?.data_readiness),
  };
}

function summaryProjection({ execution, strategy, runtime, warnings }, incidents, incidentsAvailable) {
  const criticalIncidents = incidents.filter((item) => severity(item) === "CRITICAL").length;
  return {
    deskStatus: deskStatus({ execution, warnings, criticalIncidents }),
    activeStrategies: strategy ? rows(strategy.instances).filter(activeInstance).length : null,
    activeResearchAgents: runtime ? rows(runtime).filter(activeTask).length : null,
    expectedResearchAgents: null,
    criticalIncidents: incidentsAvailable ? criticalIncidents : null,
    pendingCommands: execution ? rows(execution.portfolioOrderIntents).filter(pendingIntent).length : null,
    providerSafety: execution?.safety?.submissionPossible === false ? "NO_BROKER_SIDE_EFFECT" : "POLICY_NOT_PUBLISHED",
  };
}

function systemsProjection({ execution, strategy, runtime, risk, warnings, health }) {
  return [
    system("api", "API", health ? healthState(health) : "DEGRADED", sourceDetail(health, "API")),
    system("bff", "BFF", warnings.length ? "DEGRADED" : "OK", warnings[0] || "Projection composée disponible"),
    system("postgres", "PostgreSQL", postgresState(health), postgresDetail(health)),
    system("market-data", "Market Data", marketState(health?.data_readiness), marketDetail(health?.data_readiness)),
    system("research", "Research Scheduler", researchSchedulerState(health, runtime), researchSchedulerDetail(health, runtime)),
    system("strategy", "Strategy Runtime", strategyRuntimeState(strategy), strategyRuntimeDetail(strategy)),
    system("workers", "Research Workers", workerRuntimeState(health, runtime), workerRuntimeDetail(health, runtime)),
    system("risk", "Risk Engine", risk ? "OK" : "UNAVAILABLE", text(risk?.summary?.status, "Projection indisponible")),
    system("human-gate", "Human Gate", canonicalHumanGateState(execution), countDetail(execution?.humanExecutionGates, "gates canoniques")),
    system("telegram", "Telegram", serviceState(health, "telegram_alerting"), serviceDetail(health, "telegram_alerting")),
  ];
}

function riskProjection({ execution, risk }, incidents, incidentsAvailable) {
  const summary = risk?.summary;
  return {
    capitalStatus: riskCapitalStatus(summary),
    riskUsagePct: nullableNumber(summary?.risk_percent),
    maxDrawdownR: nullableNumber(execution?.performance?.max_drawdown_R),
    openPositions: nullableNumber(summary?.openTrades),
    healthyLimits: summary ? (summary.submission_possible ? 1 : 0) : null,
    totalLimits: summary ? 1 : null,
    activeAlerts: incidentsAvailable ? incidents.length : null,
  };
}

function marketProjection(health) {
  const readiness = health?.data_readiness;
  const freshness = nullableNumber(readiness?.core_age_seconds);
  return {
    status: marketState(readiness),
    freshnessSeconds: freshness,
    rows: rows(readiness?.core_feeds).filter((feed) => feed?.feed_id).slice(0, 7).map((feed) => ({
      id: String(feed.feed_id),
      instrument: text(feed.instrument, "INSTRUMENT_NOT_PUBLISHED"),
      timeframe: text(feed.timeframe, "—"),
      source: text(feed.provenance?.classification || feed.source, "SOURCE_NOT_PUBLISHED"),
      asOf: text(feed.latest_timestamp_utc || feed.as_of_utc || feed.last_seen_at, "AS_OF_NOT_PUBLISHED"),
      freshnessSeconds: nullableNumber(feed.age_seconds ?? freshness),
      status: feedStatus(feed, readiness),
    })),
  };
}

function researchProjection({ research, runtime, dataFoundation, simulationRuns }) {
  const hypotheses = rows(research?.hypotheses);
  const experiments = rows(research?.experiments);
  const candidates = rows(research?.candidates);
  const runs = rows(simulationRuns);
  const datasets = rows(dataFoundation);
  return {
    available: Boolean(research),
    hypothesisCount: research ? hypotheses.length : null,
    experimentCount: research ? experiments.length : null,
    runCount: simulationRuns ? runs.length : null,
    candidateCount: research ? candidates.length : null,
    activeWorkers: runtime ? new Set(rows(runtime).map((item) => item.worker_id).filter(Boolean)).size : null,
    expectedWorkers: null,
    datasetCount: dataFoundation ? datasets.length : null,
    artifactCount: research ? artifactCount(research) : null,
    rows: experiments.filter((experiment) => experiment?.research_experiment_id || experiment?.experiment_id).slice(0, 5).map((experiment) => ({
      id: String(experiment.research_experiment_id || experiment.experiment_id),
      mission: text(experiment.name || experiment.objective, "MISSION_NOT_PUBLISHED"),
      dataset: text(experiment.dataset_id || experiment.dataset_key, "NOT_LINKED"),
      run: text(experiment.run_id || experiment.simulation_run_id, "NO_ACTIVE_RUN"),
      status: text(experiment.status, "UNKNOWN").toUpperCase(),
      workers: null,
      artifacts: nullableNumber(experiment.counts?.evaluation_reports),
    })),
  };
}

function signalProjection(strategy) {
  return {
    available: Boolean(strategy),
    rows: rows(strategy?.signals).filter((signal) => signal?.signal_id).slice(0, 6).map((signal) => ({
      id: String(signal.signal_id),
      at: text(signal.created_at_utc || signal.created_at, "UNAVAILABLE"),
      instrument: text(signal.instrument_code || signal.symbol, "UNAVAILABLE"),
      setup: text(signal.setup_type || signal.signal_type, "UNAVAILABLE"),
      confidence: nullableNumber(signal.confidence),
      gate: text(signal.gate || signal.status, "UNAVAILABLE").toUpperCase(),
      portfolioDecision: "UNAVAILABLE",
      riskDecision: "UNAVAILABLE",
    })),
  };
}

function humanGateProjection(execution, actor, nowIso) {
  const intentsWithGate = rows(execution?.portfolioOrderIntents).filter((intent) => {
    const id = String(intent?.portfolio_order_intent_id || "");
    return rows(execution?.humanExecutionGates).some((gate) => String(gate?.portfolio_order_intent_id || "") === id);
  });
  return {
    available: Boolean(execution),
    availability: intentsWithGate.length ? "KNOWN" : "CONNECTED_EMPTY",
    source: "human_execution_gates",
    rows: intentsWithGate.slice(0, 6).map((intent) => {
      const canonical = portfolioOrderIntentSummaryRow({ execution, item: intent, actor });
      return {
        orderIntentId: canonical.portfolioOrderIntentId,
        instrument: text(canonical.instrument || canonical.symbol, "UNAVAILABLE"),
        side: text(canonical.side, "UNAVAILABLE").toUpperCase(),
        quantity: nullableNumber(canonical.quantity),
        executionMode: text(execution?.safety?.executionAuthorityMode, "UNAVAILABLE").toUpperCase(),
        status: text(canonical.humanGate?.status, "UNKNOWN").toUpperCase(),
        allowedActions: rows(canonical.allowedActions?.allowedActions).map(String),
        ageSeconds: ageSeconds(intent.created_at_utc, nowIso),
        route: canonical.route,
      };
    }),
  };
}

function providerProjection(execution) {
  const providers = rows(execution?.providers);
  const commands = rows(execution?.providerCommands);
  const events = rows(execution?.providerEvents);
  const policyDisabled = execution?.safety?.submissionPossible === false;
  const provider = providers[0];
  return {
    available: Boolean(execution),
    availability: providerAvailability(policyDisabled, providers.length),
    mode: providerMode(policyDisabled, provider),
    circuitBreaker: providerCircuitBreaker(policyDisabled, provider),
    health: policyDisabled ? "DISABLED_BY_POLICY" : providerHealth(provider),
    ackLatencyMs: nullableNumber(provider?.latency_ms),
    mismatchCount: reconciliationMismatchCount(execution?.reconciliations),
    events: providerEvents(commands, events),
    source: "broker_provider_commands+broker_provider_events",
    physicalExecutionPolicy: execution?.safety?.submissionPossible === true ? "ENABLED" : "DISABLED_BY_POLICY",
  };
}

function providerAvailability(policyDisabled, providerCount) {
  if (policyDisabled) return "NOT_APPLICABLE_CURRENT_MODE";
  return providerCount ? "KNOWN" : "CONNECTED_EMPTY";
}

function providerMode(policyDisabled, provider) {
  if (policyDisabled) return "DISABLED_BY_POLICY";
  return text(provider?.mode, "MODE_NOT_PUBLISHED").toUpperCase();
}

function providerCircuitBreaker(policyDisabled, provider) {
  if (policyDisabled) return "NOT_APPLICABLE_CURRENT_MODE";
  return text(provider?.circuit_breaker_state, "STATE_NOT_PUBLISHED").toUpperCase();
}

function performanceProjection(performance) {
  const totals = performanceTotals(performance);
  return {
    available: Boolean(performance),
    pnlR: nullableNumber(totals?.totalR ?? totals?.total_r),
    trades: nullableNumber(totals?.trades ?? totals?.trade_count),
    maxDrawdownR: nullableNumber(performance?.summary?.max_drawdown_R),
    curve: performanceCurve(performance),
  };
}

function performanceTotals(performance) {
  return performance?.totals || performance?.summary;
}

function performanceCurve(performance) {
  return rows(performance?.equityCurve || performance?.equity_curve).map(Number).filter(Number.isFinite);
}

function incidentProjection(incidents) {
  return rows(incidents).filter((incident) => incident?.incident_id || incident?.id).slice(0, 6).map((incident) => ({
    id: String(incident.incident_id || incident.id),
    severity: severity(incident),
    detectedAt: text(incident.opened_at_utc || incident.created_at || incident.detected_at || incident.firstObservedAt || incident.createdAt || incident.lastObservedAt, "DATE_NOT_PUBLISHED"),
    resource: text(incident.resource || incident.domain || incident.provider_id || incident.source || incident.kind || incident.sourceCollection, "RESOURCE_NOT_PUBLISHED"),
    title: text(incident.title || incident.detail || incident.message, "INCIDENT_TITLE_NOT_PUBLISHED"),
    runbook: text(incident.runbook_id || incident.runbookId || firstRunbookLabel(incident), "NO_RUNBOOK_LINKED"),
    action: text(incident.recommended_action || incident.action || incident.triage?.nextAction || incident.recommendedActions?.[0]?.label, "NO_ACTION_PUBLISHED"),
  }));
}

function operationsProjection({ runtime, ai, health }) {
  const readiness = health?.data_readiness;
  return {
    availability: runtime != null && ai != null && readiness != null ? "KNOWN" : "PARTIAL",
    queuedTasks: queuedTaskCount(runtime),
    dlqItems: nullableNumber(ai?.summary?.open_dead_letters),
    staleFeeds: staleFeedCount(readiness),
  };
}

function queuedTaskCount(runtime) {
  if (runtime == null) return null;
  return rows(runtime).filter((item) => ["READY", "WAITING", "WAITING_GPT"].includes(text(item?.status, "").toUpperCase())).length;
}

function staleFeedCount(readiness) {
  if (readiness == null) return null;
  if (readiness.market_closed === true) return 0;
  return rows(readiness.core_feeds).filter(staleFeed).length;
}

function staleFeed(feed) {
  if (feed?.stale === true) return true;
  return ["STALE", "DELAYED", "DOWN"].includes(text(feed?.status || feed?.state, "").toUpperCase());
}

function firstRunbookLabel(incident) {
  return rows(incident?.links).find((link) => String(link?.kind || "").toLowerCase() === "runbook")?.label;
}

function assistantProjection(runtime) {
  const tasks = rows(runtime);
  return {
    available: Boolean(runtime),
    activeWorkers: runtime ? new Set(tasks.map((item) => item.worker_id).filter(Boolean)).size : null,
    expectedWorkers: null,
    runningTasks: runtime ? tasks.filter(activeTask).length : null,
    latest: tasks.filter((task) => task?.task_id).slice(0, 3).map((task) => ({
      id: String(task.task_id),
      role: text(task.worker_id || task.task_type, "UNAVAILABLE"),
      status: text(task.status, "UNKNOWN").toUpperCase(),
    })),
  };
}

function auditProjection(context) {
  return frontAuditEvents({
    execution: context.execution,
    strategy: context.strategy,
    incidents: context.incidents,
    runtime: context.runtime,
    nowIso: context.nowIso,
  }).slice(0, 7).map((item) => ({ id: item.eventId, at: item.at, eventType: item.eventType, detail: item.detail, actor: item.actor, status: item.status, route: item.route || null }));
}

function activityProjection({ execution, strategy, incidents }) {
  const result = [];
  rows(strategy?.signals).slice(0, 3).forEach((item) => result.push(activity("signal", item)));
  rows(execution?.providerCommands).slice(0, 2).forEach((item) => result.push(activity("provider-command", item)));
  rows(incidents).slice(0, 2).forEach((item) => result.push(activity("incident", item)));
  return result.filter(Boolean);
}

function activity(domain, item) {
  const identifier = item.signal_id || item.signal_outbox_id || item.execution_provider_command_id || item.incident_id;
  if (!identifier) return null;
  return {
    id: String(identifier),
    time: text(item.created_at_utc || item.opened_at_utc || item.updated_at_utc, "UNAVAILABLE"),
    domain: domain.toUpperCase(),
    label: text(item.title || item.signal_type || item.status, domain),
    detail: text(item.detail || item.instrument_code, "UNAVAILABLE"),
    duration: text(item.duration || item.age, "—"),
    state: activityState(item),
  };
}

function lanesProjection({ execution, runtime, risk }) {
  void execution;
  void runtime;
  void risk;
  return [];
}

function upcomingProjection({ nowIso, warnings }) {
  void nowIso;
  void warnings;
  return [];
}

function providerEvents(commands, events) {
  const commandEvents = commands.filter((item) => item?.execution_provider_command_id).slice(0, 4).map((item) => ({
    id: String(item.execution_provider_command_id),
    at: text(item.updated_at_utc || item.created_at_utc, "UNAVAILABLE"),
    stage: providerStage(item),
    detail: text(item.portfolio_order_intent_id || item.provider_code, "UNAVAILABLE"),
    status: text(item.status || item.state, "UNKNOWN").toUpperCase(),
  }));
  const lifecycleEvents = events.filter((item) => item?.broker_provider_event_id || item?.provider_event_id).slice(0, 4).map((item) => ({
    id: String(item.broker_provider_event_id || item.provider_event_id),
    at: text(item.occurred_at_utc || item.created_at, "UNAVAILABLE"),
    stage: text(item.event_type || item.status, "UNKNOWN").toUpperCase(),
    detail: text(item.portfolio_order_intent_id || item.execution_provider_command_id, "UNAVAILABLE"),
    status: text(item.status || item.event_type, "UNKNOWN").toUpperCase(),
  }));
  return [...commandEvents, ...lifecycleEvents].slice(0, 6);
}

function service(health, kind) {
  return rows(health?.operations?.services).find((item) => item.service_kind === kind);
}

function agentRuntimeServices(health, lane) {
  return rows(health?.operations?.services).filter((item) => item?.service_kind === "agent_runtime_supervisor" && (!lane || String(item?.details?.lane || "").toLowerCase() === lane));
}

function researchSchedulerState(health, runtime) {
  const services = agentRuntimeServices(health, "research");
  if (services.some((item) => item?.healthy === true)) return "OK";
  if (services.length) return "DEGRADED";
  return runtime == null ? "UNAVAILABLE" : "DEGRADED";
}

function researchSchedulerDetail(health, runtime) {
  const serviceRow = agentRuntimeServices(health, "research")[0];
  return serviceRow ? `${text(serviceRow.status, "STATE_NOT_PUBLISHED")} · ${countDetail(runtime, "tâches agent")}` : `Heartbeat non publié · ${countDetail(runtime, "tâches agent")}`;
}

function strategyRuntimeState(strategy) {
  if (!strategy) return "UNAVAILABLE";
  const runtimeStates = strategy?.summary?.runtime_states || {};
  if (nullableNumber(runtimeStates.RUNNING) > 0) return "OK";
  return rows(strategy.instances).length ? "DEGRADED" : "OK";
}

function strategyRuntimeDetail(strategy) {
  const running = nullableNumber(strategy?.summary?.runtime_states?.RUNNING);
  return running === null ? countDetail(strategy?.instances, "instances") : `${running} instance(s) RUNNING`;
}

function workerRuntimeState(health, runtime) {
  if (runtime == null) return "UNAVAILABLE";
  const services = agentRuntimeServices(health);
  if (services.some((item) => item?.healthy === true)) return "OK";
  return services.length ? "DEGRADED" : "DEGRADED";
}

function workerRuntimeDetail(health, runtime) {
  const services = agentRuntimeServices(health);
  if (!services.length) return `Heartbeat non publié · ${countDetail(runtime, "tâches")}`;
  const healthy = services.filter((item) => item?.healthy === true).length;
  return `${healthy}/${services.length} superviseur(s) sain(s) · ${countDetail(runtime, "tâches")}`;
}

function serviceState(health, kind) {
  const item = service(health, kind);
  if (!item) return "UNAVAILABLE";
  if (item.healthy === true || ["healthy", "ok", "ready"].includes(String(item.status).toLowerCase())) return "OK";
  if (item.healthy === false || item.status) return "DEGRADED";
  return "UNAVAILABLE";
}

function serviceDetail(health, kind) {
  const item = service(health, kind);
  return text(item?.heartbeat_at_utc || item?.status, "Source indisponible");
}

function postgresState(health) {
  if (!health) return "UNAVAILABLE";
  if (health.mode === "postgres" && (health.ready === true || health.ok === true)) return "OK";
  return serviceState(health, "postgres");
}

function postgresDetail(health) {
  if (health?.mode === "postgres" && (health?.ready === true || health?.ok === true)) return "Readiness PostgreSQL confirmée";
  return serviceDetail(health, "postgres");
}

function canonicalHumanGateState(execution) {
  if (!execution) return "UNAVAILABLE";
  const gates = rows(execution.humanExecutionGates);
  if (!gates.length) return "OK";
  return gates.some((gate) => ["FAILED", "EXPIRED", "REJECTED"].includes(text(gate.status, "").toUpperCase())) ? "DEGRADED" : "OK";
}

function executionMode(safety) {
  const value = text(safety?.executionAuthorityMode || safety?.execution_authority_mode, "UNKNOWN").toUpperCase();
  if (value.includes("SEMI")) return "SEMI_MANUAL";
  return value;
}

function deskStatus({ execution, warnings, criticalIncidents }) {
  if (!execution) return "UNKNOWN";
  if (warnings.length || criticalIncidents) return "DEGRADED";
  if (execution.safety?.submissionPossible === false) return "NOMINAL";
  const state = text(execution?.safety?.status || execution?.status, "UNKNOWN").toUpperCase();
  return ["NOMINAL", "HEALTHY", "READY", "OK"].includes(state) ? "NOMINAL" : state;
}

function marketState(readiness) {
  if (!readiness) return "UNAVAILABLE";
  if (readiness.market_closed === true) return "MARKET_CLOSED";
  if (readiness.ok === true || String(readiness.state).toLowerCase() === "fresh") return "FRESH";
  const state = String(readiness.state || "STALE").toUpperCase();
  return ["STALE", "DELAYED", "DOWN"].includes(state) ? state : "DEGRADED";
}

function feedStatus(feed, readiness) {
  if (readiness?.market_closed === true) return feed?.latest_timestamp_utc ? "LAST_KNOWN" : "UNAVAILABLE";
  if (feed?.stale === true) return "STALE";
  if (feed?.stale === false) return "FRESH";
  const state = text(feed?.status || feed?.state, "UNAVAILABLE").toUpperCase();
  return state;
}

function marketDetail(readiness) {
  if (!readiness) return "Source indisponible";
  const age = nullableNumber(readiness.core_age_seconds);
  return age === null ? marketState(readiness) : `${marketState(readiness)} · ${age}s`;
}

function sourceDetail(value, label) { return value ? `${label} disponible` : `${label} indisponible`; }
function healthState(health) { return health?.ready === true || health?.ok === true ? "OK" : "DEGRADED"; }
function countDetail(value, label) { return value ? `${rows(value).length} ${label}` : `${label} indisponibles`; }
function system(id, label, status, detail) { return { id, label, status, detail, latencyMs: null }; }
function booleanState(value) { return value === true ? "ON" : value === false ? "OFF" : "UNKNOWN"; }
function rows(value) { return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []; }
function nullableNumber(value) { const numeric = Number(value); return value == null || !Number.isFinite(numeric) ? null : numeric; }
function activeInstance(item) { return ["SHADOW", "PAPER", "LIVE"].includes(String(item?.execution_mode || item?.executionMode).toUpperCase()); }
function activeTask(item) { return ["READY", "RUNNING", "CLAIMED", "WAITING_GPT"].includes(String(item?.status).toUpperCase()); }
function pendingIntent(item) { return !["FILLED", "CANCELLED", "REJECTED", "EXPIRED"].includes(String(item?.status).toUpperCase()); }
function providerStage(item) { const state = text(item?.status || item?.state, "UNKNOWN").toUpperCase(); return state.includes("ACK") ? "ACK" : state; }
function providerHealth(provider) {
  if (!provider) return "PROVIDER_NOT_CONFIGURED";
  if (provider.enabled === false) return "DISCONNECTED";
  const state = text(provider.health || provider.status || provider.connectivity, "STATE_NOT_PUBLISHED").toUpperCase();
  return ["HEALTHY", "CONNECTED", "READY", "OK"].includes(state) ? "HEALTHY" : state;
}
function artifactCount(research) {
  const explicit = nullableNumber(research?.summary?.artifacts ?? research?.counts?.artifacts);
  if (explicit !== null) return explicit;
  return rows(research?.reports).reduce((total, report) => total + (rows(report?.artifacts).length || nullableNumber(report?.artifact_count) || 0), 0);
}
function ageSeconds(value, nowIso) {
  const at = Date.parse(value);
  const now = Date.parse(nowIso);
  return Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, Math.round((now - at) / 1000)) : null;
}
function reconciliationMismatchCount(value) {
  if (value == null) return null;
  const items = rows(value);
  if (!items.length) return null;
  const statuses = items.map((item) => text(item?.status, "UNKNOWN").toUpperCase());
  const mismatches = statuses.filter((status) => ["MISMATCH", "MISMATCHED", "DIVERGED", "FAILED"].includes(status)).length;
  return statuses.some((status) => status === "UNKNOWN") && mismatches === 0 ? null : mismatches;
}
function riskCapitalStatus(summary) { if (!summary) return "UNKNOWN"; if (summary.submission_possible === false) return "WATCH"; return text(summary.capital_status, "UNKNOWN").toUpperCase(); }
function explicitSystemState(value) {
  if (!value) return "UNAVAILABLE";
  if (value.healthy === true || value.ready === true || value.ok === true) return "OK";
  if (value.healthy === false || value.ready === false || value.ok === false) return "DEGRADED";
  const state = text(value.status || value.state || value.health, "UNAVAILABLE").toUpperCase();
  if (["HEALTHY", "READY", "OK", "NOMINAL"].includes(state)) return "OK";
  if (["DEGRADED", "DOWN", "FAILED", "BLOCKED", "STALE"].includes(state)) return "DEGRADED";
  return "UNAVAILABLE";
}
function severity(item) { return text(item?.severity, "UNKNOWN").toUpperCase(); }
function activityState(item) { const state = String(item?.status || item?.state).toUpperCase(); return ["FAILED", "REJECTED", "BLOCKED"].includes(state) ? "WATCH" : ["DONE", "FILLED", "COMPLETED"].includes(state) ? "DONE" : "RUNNING"; }
