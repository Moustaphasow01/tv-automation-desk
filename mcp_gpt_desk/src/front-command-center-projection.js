import { text } from "./front-control-plane-common.js";

export function buildCommandCenterProjection(context) {
  const incidents = rows(context.incidents);
  const incidentsAvailable = context.incidents != null;
  return {
    mode: modeProjection(context),
    summary: summaryProjection(context, incidents, incidentsAvailable),
    systems: systemsProjection(context),
    activity: activityProjection(context),
    risk: riskProjection(context, incidents, incidentsAvailable),
    lanes: lanesProjection(context),
    upcoming: upcomingProjection(context),
    market: marketProjection(context.health),
    research: researchProjection(context),
    signals: signalProjection(context.strategy),
    humanGate: humanGateProjection(context.execution),
    provider: providerProjection(context.execution),
    performance: performanceProjection(context.performance),
    incidents: incidentProjection(context.incidents),
    assistant: assistantProjection(context.runtime),
    audit: auditProjection(context),
  };
}

function modeProjection({ execution, health }) {
  const safety = execution?.safety || null;
  return {
    environment: text(safety?.environment, "UNKNOWN").toUpperCase(),
    executionMode: executionMode(safety),
    autoExecution: booleanState(safety?.autoExecutionEnabled),
    liveBroker: booleanState(safety?.liveAccountAllowed),
    release: text(health?.release || health?.version, "UNAVAILABLE"),
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
    pendingCommands: execution ? rows(execution.intents).filter(pendingIntent).length : null,
    providerSafety: execution?.safety?.submissionPossible === false ? "NO_BROKER_SIDE_EFFECT" : "UNAVAILABLE",
  };
}

function systemsProjection({ execution, strategy, runtime, risk, warnings, health }) {
  return [
    system("api", "API", health ? healthState(health) : "DEGRADED", sourceDetail(health, "API")),
    system("bff", "BFF", warnings.length ? "DEGRADED" : "OK", warnings[0] || "Projection composée disponible"),
    system("postgres", "PostgreSQL", serviceState(health, "postgres"), serviceDetail(health, "postgres")),
    system("market-data", "Market Data", marketState(health?.data_readiness), marketDetail(health?.data_readiness)),
    system("research", "Research Scheduler", serviceState(health, "research_scheduler"), countDetail(runtime, "tâches agent")),
    system("strategy", "Strategy Runtime", explicitSystemState(strategy), countDetail(strategy?.instances, "instances")),
    system("workers", "Research Workers", serviceState(health, "ai_worker_runtime"), countDetail(runtime, "tâches")),
    system("risk", "Risk Engine", explicitSystemState(risk?.summary), text(risk?.summary?.status, "Projection indisponible")),
    system("human-gate", "Human Gate", explicitSystemState(execution?.humanGate), countDetail(execution?.intents, "intentions")),
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
      instrument: text(feed.instrument, "UNAVAILABLE"),
      timeframe: text(feed.timeframe, "—"),
      source: text(feed.provenance?.classification || feed.source, "UNAVAILABLE"),
      asOf: text(feed.as_of_utc || feed.last_seen_at, "UNAVAILABLE"),
      freshnessSeconds: nullableNumber(feed.age_seconds ?? freshness),
      status: feedStatus(feed, readiness),
    })),
  };
}

function researchProjection({ research, runtime, dataFoundation }) {
  const experiments = rows(research?.experiments);
  const candidates = rows(research?.candidates);
  return {
    available: Boolean(research),
    hypothesisCount: research ? experiments.length : null,
    experimentCount: research ? experiments.length : null,
    runCount: null,
    candidateCount: research ? candidates.length : null,
    activeWorkers: runtime ? new Set(rows(runtime).map((item) => item.worker_id).filter(Boolean)).size : null,
    expectedWorkers: null,
    datasetCount: dataFoundation ? rows(dataFoundation).length : null,
    artifactCount: null,
    rows: experiments.filter((experiment) => experiment?.research_experiment_id || experiment?.experiment_id).slice(0, 5).map((experiment) => ({
      id: String(experiment.research_experiment_id || experiment.experiment_id),
      mission: text(experiment.name || experiment.objective, "UNAVAILABLE"),
      dataset: text(experiment.dataset_id || experiment.dataset_key, "UNAVAILABLE"),
      run: text(experiment.run_id || experiment.simulation_run_id, "UNAVAILABLE"),
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

function humanGateProjection(execution) {
  return {
    available: Boolean(execution),
    rows: rows(execution?.intents).filter((intent) => intent?.order_intent_id || intent?.intent_id).slice(0, 6).map((intent) => ({
      orderIntentId: String(intent.order_intent_id || intent.intent_id),
      instrument: text(intent.instrument_code || intent.instrument, "UNAVAILABLE"),
      side: text(intent.side, "UNAVAILABLE").toUpperCase(),
      quantity: nullableNumber(intent.quantity),
      executionMode: text(intent.execution_mode || execution?.safety?.executionAuthorityMode, "UNAVAILABLE").toUpperCase(),
      status: text(intent.human_gate_status || intent.gate_status, "UNKNOWN").toUpperCase(),
      allowedActions: rows(intent.allowed_actions).map((action) => String(action)),
      ageSeconds: nullableNumber(intent.age_seconds),
    })),
  };
}

function providerProjection(execution) {
  const providers = rows(execution?.providers);
  const orders = rows(execution?.orders);
  const fills = rows(execution?.fills);
  return {
    available: Boolean(execution),
    mode: text(providers[0]?.mode, "UNAVAILABLE").toUpperCase(),
    circuitBreaker: text(providers[0]?.circuit_breaker_state, "UNAVAILABLE").toUpperCase(),
    health: providerHealth(providers[0]),
    ackLatencyMs: nullableNumber(providers[0]?.latency_ms),
    mismatchCount: reconciliationMismatchCount(execution?.reconciliations),
    events: providerEvents(orders, fills),
  };
}

function performanceProjection(performance) {
  const totals = performance?.totals || performance?.summary;
  const curve = rows(performance?.equityCurve || performance?.equity_curve).map(Number).filter(Number.isFinite);
  return {
    available: Boolean(performance),
    pnlR: nullableNumber(totals?.totalR ?? totals?.total_r),
    trades: nullableNumber(totals?.trades ?? totals?.trade_count),
    maxDrawdownR: nullableNumber(performance?.summary?.max_drawdown_R),
    curve,
  };
}

function incidentProjection(incidents) {
  return rows(incidents).filter((incident) => incident?.incident_id || incident?.id).slice(0, 6).map((incident) => ({
    id: String(incident.incident_id || incident.id),
    severity: severity(incident),
    detectedAt: text(incident.opened_at_utc || incident.created_at || incident.detected_at, "UNAVAILABLE"),
    resource: text(incident.resource || incident.domain || incident.provider_id, "UNAVAILABLE"),
    title: text(incident.title || incident.detail, "UNAVAILABLE"),
    runbook: text(incident.runbook_id, "UNAVAILABLE"),
    action: text(incident.recommended_action || incident.action, "UNAVAILABLE"),
  }));
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
  return activityProjection(context).slice(0, 7).map((item) => ({
    id: item.id,
    at: item.time,
    eventType: item.label,
    detail: item.detail,
    actor: item.domain,
    status: item.state,
  }));
}

function activityProjection({ execution, strategy, incidents }) {
  const result = [];
  rows(strategy?.signals).slice(0, 3).forEach((item) => result.push(activity("signal", item)));
  rows(execution?.orders).slice(0, 2).forEach((item) => result.push(activity("order", item)));
  rows(incidents).slice(0, 2).forEach((item) => result.push(activity("incident", item)));
  return result.filter(Boolean);
}

function activity(domain, item) {
  const identifier = item.signal_id || item.order_id || item.incident_id;
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

function providerEvents(orders, fills) {
  const orderEvents = orders.filter((item) => item?.order_id).slice(0, 4).map((item) => ({
    id: String(item.order_id),
    at: text(item.updated_at_utc || item.created_at_utc, "UNAVAILABLE"),
    stage: providerStage(item),
    detail: text(item.broker_order_id || item.instrument_code, "UNAVAILABLE"),
    status: text(item.status || item.state, "UNKNOWN").toUpperCase(),
  }));
  const fillEvents = fills.filter((item) => item?.fill_id).slice(0, 2).map((item) => ({
    id: String(item.fill_id),
    at: text(item.filled_at_utc || item.created_at_utc, "UNAVAILABLE"),
    stage: "FILL",
    detail: text(item.order_id, "UNAVAILABLE"),
    status: "FILL",
  }));
  return [...orderEvents, ...fillEvents].slice(0, 6);
}

function service(health, kind) {
  return rows(health?.operations?.services).find((item) => item.service_kind === kind);
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

function executionMode(safety) {
  const value = text(safety?.executionAuthorityMode || safety?.execution_authority_mode, "UNKNOWN").toUpperCase();
  if (value.includes("SEMI")) return "SEMI_MANUAL";
  return value;
}

function deskStatus({ execution, warnings, criticalIncidents }) {
  if (!execution) return "UNKNOWN";
  if (warnings.length || criticalIncidents || execution.safety?.submissionPossible === false) return "DEGRADED";
  const state = text(execution?.safety?.status || execution?.status, "UNKNOWN").toUpperCase();
  return ["NOMINAL", "HEALTHY", "READY", "OK"].includes(state) ? "NOMINAL" : state;
}

function marketState(readiness) {
  if (!readiness) return "UNAVAILABLE";
  if (readiness.ok === true || String(readiness.state).toLowerCase() === "fresh") return "FRESH";
  const state = String(readiness.state || "STALE").toUpperCase();
  return ["STALE", "DELAYED", "DOWN"].includes(state) ? state : "DEGRADED";
}

function feedStatus(feed, readiness) {
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
  if (!provider) return "UNAVAILABLE";
  if (provider.enabled === false) return "DISCONNECTED";
  const state = text(provider.health || provider.status || provider.connectivity, "UNAVAILABLE").toUpperCase();
  return ["HEALTHY", "CONNECTED", "READY", "OK"].includes(state) ? "HEALTHY" : state;
}
function reconciliationMismatchCount(value) {
  if (value == null) return null;
  const items = rows(value);
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
