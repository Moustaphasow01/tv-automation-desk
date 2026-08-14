import { currentTick, currentUtc, text } from "./front-control-plane-common.js";
import { executeWindowsServiceActuator } from "./desk-windows-service-actuator.js";

export const DESK_OPERATIONAL_STATES = Object.freeze([
  "STOPPED",
  "STARTING",
  "DEGRADED",
  "READY_SHADOW",
  "READY_SEMI_MANUAL",
  "PAPER_READY",
  "STOPPING",
  "FAILED",
]);

export const DESK_CONTROL_ACTIONS = Object.freeze(["status", "doctor", "start", "stop", "restart"]);

const SERVICE_EXPECTATIONS = Object.freeze([
  serviceExpectation("postgres", ["postgres"], { source: "health.mode" }),
  serviceExpectation("api", ["api"], { source: "health.ready" }),
  serviceExpectation("live_runtime_scheduler", ["live_runtime_scheduler", "live_runtime"], { staleSeconds: 180 }),
  serviceExpectation("broker_management", ["broker_management"], { staleSeconds: 180 }),
  serviceExpectation("telegram_alerting", ["telegram_alerting", "telegram_alert_worker"], { staleSeconds: 180, optionalForShadow: true }),
  serviceExpectation("replay_preparation", ["replay_preparation", "replay_preparation_worker"], { staleSeconds: 300, optionalForShadow: true }),
  serviceExpectation("agent_runtime_supervisor", ["agent_runtime_supervisor", "agent_supervisor"], { staleSeconds: 180, optionalForShadow: true }),
  serviceExpectation("agent_runtime_research", ["agent_runtime_research", "research_agent_runtime"], { staleSeconds: 300, optionalForShadow: true }),
]);

export async function executeDeskOperationalControl({ store, command, environment = "PAPER", idempotencyKey, correlationId, actor, windowsServiceRunner } = {}) {
  const action = normalizeAction(command);
  const actuatorMode = process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR || "plan_only";
  const health = typeof store?.health === "function"
    ? await store.health()
    : { ok: false, ready: false, mode: "unavailable", error: "store.health_unavailable" };
  const result = buildDeskOperationalResult({
    action,
    environment,
    health,
    idempotencyKey,
    correlationId,
    actor,
    actuatorMode,
    nowUtc: currentUtc(store?.clock),
    releaseVersion: process.env.DESK_RELEASE_VERSION || "unversioned",
    aiWorkerMode: process.env.DESK_AI_WORKER_MODE || "shadow",
  });
  if (!result.plan.actuator_invocation_required) return result;
  return attachWindowsActuatorResult(result, await executeWindowsServiceActuator({
    action,
    dryRun: result.plan.dryRun === true,
    timeoutMs: result.plan.timeout_ms,
    ...(windowsServiceRunner ? { runner: windowsServiceRunner } : {}),
  }));
}

function attachWindowsActuatorResult(result, actuator) {
  return {
    ...result,
    status: actuator.ok ? (actuator.dry_run ? "DRY_RUN" : "ACTUATED") : "FAILED",
    actuator,
    plan: { ...result.plan, actuator_outcome: actuator.status },
    state: actuator.ok ? result.state : actuatorFailedState(result.state, actuator),
  };
}

function actuatorFailedState(state, actuator) {
  return {
    ...state,
    fail_closed: true,
    blockers: [
      ...state.blockers,
      {
        id: "actuator.windows_services",
        ok: false,
        severity: "blocker",
        detail: actuatorFailureDetail(actuator),
        remediation: remediation("actuator"),
        metadata: { actuator_status: actuator.status },
      },
    ],
  };
}

function actuatorFailureDetail(actuator) {
  return actuator.failures.map((item) => `${item.type}:${item.service_name || item.error_code || "unknown"}`).join(", ");
}

export function buildDeskOperationalResult({
  action,
  environment = "PAPER",
  health = {},
  idempotencyKey = "",
  correlationId = "",
  actor = {},
  actuatorMode = "plan_only",
  nowUtc = currentUtc(),
  releaseVersion = "unversioned",
  aiWorkerMode = "shadow",
} = {}) {
  const normalizedAction = normalizeAction(action);
  const snapshot = evaluateDeskOperationalState({
    health,
    environment,
    nowUtc,
    releaseVersion,
    aiWorkerMode,
  });
  const plan = operationalPlan({
    action: normalizedAction,
    state: snapshot.state,
    actuatorMode,
    environment,
    snapshot,
  });
  const status = normalizedAction === "doctor"
    ? (snapshot.blockers.length ? "DEGRADED" : "PASSED")
    : normalizedAction === "status"
      ? "SUCCEEDED"
      : plan.dryRun ? "DRY_RUN_READY" : plan.sideEffectsEnabled ? "ACTUATION_READY" : "PLAN_ONLY";
  return {
    schema_version: "desk_operational_control_result_v1",
    action: normalizedAction,
    status,
    command_idempotency_key: text(idempotencyKey, ""),
    correlation_id: text(correlationId, ""),
    environment: String(environment || "PAPER").toUpperCase(),
    release_version: releaseVersion,
    ai_worker_mode: aiWorkerMode,
    actor: {
      kind: text(actor?.kind, "operator"),
      email: actor?.email || null,
      uid: actor?.uid || null,
    },
    evaluated_at_utc: nowUtc,
    broker_execution: false,
    live_execution: false,
    auto_execution: false,
    state: snapshot,
    doctor: normalizedAction === "doctor" ? doctorReport(snapshot) : null,
    plan,
  };
}

export function evaluateDeskOperationalState({ health = {}, environment = "PAPER", nowUtc = currentUtc(), releaseVersion = "unversioned", aiWorkerMode = "shadow" } = {}) {
  const checks = buildOperationalChecks({ health, nowUtc });
  const blockers = failedChecks(checks, "blocker");
  const warnings = failedChecks(checks, "warning");
  const readiness = operationalReadiness(checks);
  const state = deriveOperationalState({ blockers, readiness, environment });
  return {
    schema_version: "desk_operational_state_v1",
    state,
    ready: ["READY_SHADOW", "READY_SEMI_MANUAL", "PAPER_READY"].includes(state),
    fail_closed: blockers.length > 0 || state === "FAILED",
    sensitive_actions_enabled: state === "PAPER_READY" && readiness.paperSafe,
    release_version: releaseVersion,
    ai_worker_mode: aiWorkerMode,
    evaluated_at_utc: nowUtc,
    blockers: blockers.map(publicCheck),
    warnings: warnings.map(publicCheck),
    checks: checks.map(publicCheck),
    services: serviceSummary(checks),
    allowed_actions: allowedDeskActions(state),
    forbidden_actions: forbiddenDeskActions(state),
  };
}

export function buildOperationalChecks({ health = {}, nowUtc = currentUtc() } = {}) {
  const services = rows(health?.operations?.services);
  return [
    ...coreOperationalChecks({ health, services }),
    ...SERVICE_EXPECTATIONS
      .filter(isRuntimeServiceExpectation)
      .map((expectation) => serviceExpectationCheck({ expectation, services, nowUtc })),
  ];
}

function failedChecks(checks, severity) {
  return checks.filter((item) => item.severity === severity && item.ok === false);
}

function operationalReadiness(checks) {
  const semiManualReady = checkById(checks, "execution.semi_manual_safe")?.ok === true;
  const telegramReady = checkById(checks, "telegram.trading_ready")?.ok !== false;
  return {
    dataReady: checkById(checks, "data.live_fresh")?.ok !== false,
    semiManualReady,
    telegramReady,
    paperSafe: semiManualReady && telegramReady,
  };
}

function deriveOperationalState({ blockers, readiness, environment }) {
  if (blockers.some(isCorePlatformBlocker)) return "FAILED";
  if (blockers.length) return "DEGRADED";
  if (isPaperEnvironment(environment) && readiness.dataReady && readiness.paperSafe) return "PAPER_READY";
  if (readiness.semiManualReady) return "READY_SEMI_MANUAL";
  return "READY_SHADOW";
}

function isCorePlatformBlocker(check) {
  return check.id === "api.ready" || check.id === "api.postgres_mode";
}

function isPaperEnvironment(environment) {
  return String(environment || "").toUpperCase() === "PAPER";
}

function coreOperationalChecks({ health, services }) {
  return [
    check("api.ready", health?.ready === true || health?.ok === true, "Backend API répond.", "API indisponible.", "blocker", remediation("api")),
    check("api.postgres_mode", health?.mode === "postgres", "PostgreSQL est la source de vérité active.", `Mode persistance inattendu: ${health?.mode || "unknown"}.`, "blocker", remediation("postgres")),
    check("data.live_fresh", liveDataReady(health?.data_readiness), "Données marché prêtes ou marché fermé.", dataDetail(health?.data_readiness), "blocker", remediation("data")),
    check("execution.semi_manual_safe", executionPolicySafe(services), "Exécution broker fermée / semi-manuelle.", executionPolicyDetail(services), "blocker", remediation("execution")),
    check("telegram.trading_ready", telegramReady(services), "Telegram trading prêt ou non requis.", telegramDetail(services), "warning", remediation("telegram")),
  ];
}

function liveDataReady(dataReadiness = {}) {
  return dataReadiness?.ok === true || dataReadiness?.market_closed === true;
}

function isRuntimeServiceExpectation(expectation) {
  return expectation.id !== "postgres" && expectation.id !== "api";
}

function serviceExpectationCheck({ expectation, services, nowUtc }) {
  const service = findService(services, expectation.aliases);
  const age = serviceAgeSeconds(service, nowUtc);
  const stale = serviceStale(age, expectation.staleSeconds);
  return check(
    `service.${expectation.id}`,
    serviceExpectationOk({ service, stale, expectation }),
    serviceSuccessDetail(expectation, service),
    serviceFailureDetail(service, age, stale),
    expectation.optionalForShadow ? "warning" : "blocker",
    remediation(expectation.id),
    { service_id: service?.service_id || null, service_kind: service?.service_kind || null, age_seconds: age ?? null },
  );
}

function serviceStale(age, staleSeconds) {
  return Number.isFinite(age) && Number.isFinite(staleSeconds) && age > staleSeconds;
}

function serviceExpectationOk({ service, stale, expectation }) {
  if (!service) return expectation.optionalForShadow === true;
  return service.healthy === true && service.status !== "failed" && !stale;
}

function serviceSuccessDetail(expectation, service) {
  return service ? `${expectation.id} healthy.` : `${expectation.id} optional for shadow.`;
}

function serviceFailureDetail(service, age, stale) {
  return service ? serviceDetail(service, age, stale) : "service_absent_optional_for_shadow";
}

function operationalPlan({ action, state, actuatorMode, environment, snapshot }) {
  const mutating = ["start", "stop", "restart"].includes(action);
  const dryRun = mutating && actuatorMode === "windows_service_dry_run";
  const sideEffectsEnabled = mutating && actuatorMode === "windows_service";
  const alreadyRunning = ["READY_SHADOW", "READY_SEMI_MANUAL", "PAPER_READY", "DEGRADED"].includes(state);
  const steps = actionSteps(action, snapshot);
  return {
    schema_version: "desk_operational_plan_v1",
    action,
    environment: String(environment || "PAPER").toUpperCase(),
    actuator_mode: actuatorMode,
    dryRun,
    sideEffectsEnabled,
    actuator_invocation_required: dryRun || sideEffectsEnabled,
    timeout_ms: 45_000,
    idempotent: true,
    broker_execution: false,
    live_execution: false,
    auto_execution: false,
    outcome: !mutating
      ? "OBSERVE_ONLY"
      : dryRun
        ? "WINDOWS_SERVICE_DRY_RUN"
      : !sideEffectsEnabled
        ? "PLAN_ONLY_FAIL_CLOSED"
        : action === "start" && alreadyRunning
          ? "NOOP_ALREADY_RUNNING"
          : "READY_FOR_ACTUATOR",
    reason: mutating && !sideEffectsEnabled
      ? dryRun
        ? "DESK_OPERATIONAL_CONTROL_ACTUATOR=windows_service_dry_run; topology and operations are certified without mutating services."
        : "DESK_OPERATIONAL_CONTROL_ACTUATOR is not windows_service; command is audited and planned only."
      : "",
    steps,
  };
}

function actionSteps(action, snapshot) {
  if (action === "status") return ["read_health", "derive_operational_state", "return_snapshot"];
  if (action === "doctor") return ["read_health", "derive_operational_state", "build_doctor_report", "return_remediation"];
  const base = [
    "verify_postgres",
    "verify_schema_level",
    "verify_api_bff",
    "verify_market_data_freshness",
    "verify_agent_supervisor",
    "verify_strategy_runtime",
    "verify_portfolio_risk",
    "verify_human_gate",
    "verify_telegram",
    "verify_execution_gateway_safe_mode",
  ];
  if (action === "start") return ["acquire_operational_lease", ...base, "start_missing_services", "refresh_health", "publish_operational_event"];
  if (action === "stop") return ["acquire_operational_lease", "pause_claim_lanes", "lock_broker_execution", "stop_producer_services", "publish_operational_event"];
  if (action === "restart") return ["acquire_operational_lease", "pause_claim_lanes", "lock_broker_execution", "stop_producer_services", ...base, "start_services", "refresh_health", "publish_operational_event"];
  return ["unknown_action"];
}

function doctorReport(snapshot) {
  return {
    schema_version: "desk_operational_doctor_v1",
    summary: {
      state: snapshot.state,
      blockers: snapshot.blockers.length,
      warnings: snapshot.warnings.length,
      fail_closed: snapshot.fail_closed,
    },
    checks: snapshot.checks.map((item) => ({
      id: item.id,
      ok: item.ok,
      severity: item.severity,
      detail: item.detail,
      remediation: item.remediation,
    })),
    next_actions: snapshot.blockers.length
      ? snapshot.blockers.map((item) => item.remediation)
      : ["Desk infrastructure is ready for the current authorized mode; keep AUTO/LIVE broker disabled unless a separate cutover approves it."],
  };
}

function serviceSummary(checks) {
  return checks
    .filter((item) => item.id.startsWith("service."))
    .map((item) => ({
      service: item.id.slice("service.".length),
      status: item.ok ? "HEALTHY" : item.severity === "warning" ? "DEGRADED" : "FAILED",
      detail: item.detail,
      metadata: item.metadata || {},
    }));
}

function allowedDeskActions(state) {
  const base = ["desk.status", "desk.doctor"];
  if (state === "FAILED") return [...base, "desk.start"];
  if (state === "STOPPED") return [...base, "desk.start"];
  return [...base, "desk.start", "desk.stop", "desk.restart"];
}

function forbiddenDeskActions(state) {
  return [
    { action: "broker.live.enable", reason: "LIVE broker activation requires a separate explicit cutover." },
    { action: "broker.auto.enable", reason: "AUTO execution remains outside TD2-418." },
    ...(state === "FAILED" ? [{ action: "research.paper.promote", reason: "Desk state FAILED; promotion must remain closed." }] : []),
  ];
}

function publicCheck(item) {
  return {
    id: item.id,
    ok: item.ok,
    severity: item.severity,
    detail: item.detail,
    remediation: item.remediation,
    metadata: item.metadata || {},
  };
}

function check(id, ok, successDetail, failureDetail, severity = "blocker", remediationText = "", metadata = {}) {
  return { id, ok: ok === true, severity, detail: ok === true ? successDetail : failureDetail, remediation: remediationText, metadata };
}

function checkById(checks, id) {
  return checks.find((item) => item.id === id) || null;
}

function normalizeAction(command) {
  const action = String(command || "").replace(/^desk\./, "").trim().toLowerCase();
  if (!DESK_CONTROL_ACTIONS.includes(action)) throw new Error(`Unsupported desk operational action: ${command}`);
  return action;
}

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

function serviceExpectation(id, aliases, options = {}) {
  return Object.freeze({ id, aliases: Object.freeze(aliases), ...options });
}

function findService(services, aliases) {
  return rows(services).find((service) => aliases.includes(String(service?.service_kind || "")) || aliases.includes(String(service?.service_id || ""))) || null;
}

function serviceAgeSeconds(service, nowUtc) {
  const heartbeat = service?.heartbeat_at_utc || service?.updated_at_utc || service?.details?.heartbeat_at_utc || service?.details?.fetched_at_utc;
  if (!isoLike(nowUtc) || !isoLike(heartbeat)) return null;
  const nowMs = currentTick({ utc: nowUtc }).epochMs;
  const heartbeatMs = currentTick({ utc: heartbeat }).epochMs;
  if (!Number.isFinite(nowMs) || !Number.isFinite(heartbeatMs)) return null;
  return Math.max(0, Math.floor((nowMs - heartbeatMs) / 1000));
}

function isoLike(value) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(value || ""));
}

function serviceDetail(service, age, stale) {
  return `${service.service_id || service.service_kind || "unknown"} status=${service.status || "unknown"} healthy=${String(service.healthy)}${Number.isFinite(age) ? ` age=${age}s` : ""}${stale ? " stale=true" : ""}`;
}

function dataDetail(data = {}) {
  return `state=${data?.state || "unknown"} ok=${String(data?.ok)} core_age_seconds=${data?.core_age_seconds ?? "unknown"} blocker=${data?.data_blocker || "none"}`;
}

function executionPolicySafe(services) {
  const broker = findService(services, ["broker_management"]);
  const safety = broker?.details?.result?.paper_safety || {};
  if (safety.live_account_allowed === true) return false;
  if (safety.execution_authority_mode === "auto" && safety.entry_operator_approval_required !== true) return false;
  if (safety.execution_enabled === true && safety.manual_telegram_execution_enabled !== true && safety.submission_possible === true) return false;
  return true;
}

function executionPolicyDetail(services) {
  const broker = findService(services, ["broker_management"]);
  const safety = broker?.details?.result?.paper_safety || {};
  return `execution_enabled=${String(safety.execution_enabled)} authority=${safety.execution_authority_mode || "unknown"} operator_approval=${String(safety.entry_operator_approval_required)} manual_telegram=${String(safety.manual_telegram_execution_enabled)} submission_possible=${String(safety.submission_possible)} live_account_allowed=${String(safety.live_account_allowed)}`;
}

function telegramReady(services) {
  const telegram = findService(services, ["telegram_alerting", "telegram_alert_worker"]);
  if (!telegram) return true;
  const env = telegram.details?.environment || {};
  return telegram.healthy === true && env.workerEnabled !== false && env.tradingConfigured !== false;
}

function telegramDetail(services) {
  const telegram = findService(services, ["telegram_alerting", "telegram_alert_worker"]);
  if (!telegram) return "telegram_service_absent_optional";
  const env = telegram.details?.environment || {};
  return `healthy=${String(telegram.healthy)} worker=${String(env.workerEnabled)} trading=${String(env.tradingConfigured)}`;
}

function remediation(kind) {
  const map = {
    api: "Vérifier DeskFuturesApi, /healthz et /readyz, puis relancer le service si nécessaire.",
    postgres: "Vérifier PostgreSQL, DATABASE_URL et le niveau de migrations avant de rouvrir les commandes.",
    data: "Vérifier les alertes TradingView durables MNQ/MES M1/M5 et relancer le scheduler live.",
    execution: "Conserver AUTO/LIVE fermés, remettre authority=semi_auto et approval opérateur si nécessaire.",
    telegram: "Vérifier DeskFuturesTelegram, token/chat configurés et envoyer une alerte de test.",
    live_runtime_scheduler: "Relancer DeskFuturesLiveRuntime et contrôler son heartbeat/data_state.",
    broker_management: "Relancer DeskFuturesBrokerManagement et vérifier paper_safety.",
    replay_preparation: "Relancer DeskFuturesReplayPreparation si la file replay doit être alimentée.",
    agent_runtime_supervisor: "Relancer DeskFuturesAgentRuntimeSupervisor et vérifier leases/tasks.",
    agent_runtime_research: "Relancer DeskFuturesAgentRuntimeResearch et vérifier la queue research.",
    actuator: "Contrôler l’allowlist Windows, l’ordre de dépendance et relancer uniquement après dry-run conforme.",
  };
  return map[kind] || "Lire les logs du service et appliquer le runbook opérationnel.";
}
