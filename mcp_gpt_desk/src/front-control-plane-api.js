import { buildAiContextOverviewFromStore } from "./front-ai-context-projection.js";
import { buildPortfolioRiskOverviewFromStore } from "./front-portfolio-risk-projection.js";
import { loadFrontDeskSession, normalizeFrontApiScope, sessionSummary } from "./front-session-projection.js";
import { loadFrontMacroResource, loadFrontNewsHeadlinesResource } from "./front-api-resources.js";
import { buildDemoPaperReadiness, demoPaperLaunchGate, liveMarketDataStatus, publicLaunchGate, launchGatePipelineDetail, launchGatePipelineStatus } from "./front-control-plane-demo-paper.js";
import { acceptControlPlaneCommand, FRONT_COMMAND_CATALOG } from "./front-control-plane-command.js";
import { authSession } from "./front-control-plane-auth.js";
import { jarvisWorkspace } from "./front-jarvis-projection.js";
import { loadFrontAssistantRuntime } from "./front-assistant-runtime-source.js";
import { codedError, currentTick, currentUtc, hash, text } from "./front-control-plane-common.js";

export {
  frontControlPlaneSseFrame,
  loadFrontControlPlaneRealtimeEvents,
  writeFrontControlPlaneEvents,
} from "./front-control-plane-realtime.js";

export const FRONT_CONTROL_PLANE_PREFIX = "/front-api/v1";
export const FRONT_CONTROL_PLANE_COMMANDS_PATH = `${FRONT_CONTROL_PLANE_PREFIX}/commands`;
export const FRONT_CONTROL_PLANE_EVENTS_PATH = `${FRONT_CONTROL_PLANE_PREFIX}/events`;
export const FRONT_CONTROL_PLANE_CAPABILITIES_PATH = `${FRONT_CONTROL_PLANE_PREFIX}/capabilities`;

const VIEW_PATH = /^\/front-api\/v1\/views\/([a-z0-9-]+)$/;
const COMMAND_PATH = /^\/front-api\/v1\/commands\/([a-zA-Z0-9_-]+)$/;
// Keep one short, shared source window across the widgets of an operator view.
// Five seconds is below the live monitor cadence while preventing the same
// expensive PostgreSQL projections from being rebuilt for every card/refetch.
const FRONT_SOURCE_CACHE_TTL_MS = 5_000;
const FRONT_SOURCE_TIMEOUT_MS = 3_500;
const sourceCacheByStore = new WeakMap();
const VIEW_NAMES = new Set([
  "auth-session", "operator-settings", "admin-access", "command-center", "demo-paper-readiness", "events-audit",
  "operations-queue", "research-agent-fleet", "research-compute-scheduler", "research-data-catalog",
  "research-experiment-detail", "research-run-detail", "research-lab", "strategy-center",
  "strategy-detail", "strategy-compare", "live-trading", "live-signal-detail", "orders", "risk",
  "order-detail", "position-detail", "incident-detail",
  "execution-providers", "execution-incidents", "portfolio", "jarvis-workspace",
  "sessions", "live-plan", "live-news", "live-timeline", "execution-reconciliation", "operations-observability",
  "research-experiments", "research-candidates", "research-dataset-detail", "strategy-deployments",
  "replay-overview", "replay-runs", "replay-run-detail", "replay-compare",
  "performance-overview", "performance-calendar", "performance-day-detail", "performance-strategies", "performance-trades",
  "workflow-detail", "event-detail", "operations-runbooks", "governance-prompts", "governance-policies",
]);
const VIEW_BUILDERS = {
  "command-center": commandCenter,
  "demo-paper-readiness": demoPaperReadiness,
  "live-trading": liveTrading,
  portfolio,
  "operations-queue": operationsQueue,
  "events-audit": eventsAudit,
  orders,
  risk: riskCenter,
  "execution-providers": executionProviders,
  "execution-incidents": executionIncidents,
  "research-lab": researchLab,
  "research-agent-fleet": researchAgentFleet,
  "research-data-catalog": researchDataCatalog,
  "research-compute-scheduler": researchCompute,
  "strategy-center": strategyCenter,
  "auth-session": authSession,
  "operator-settings": operatorSettings,
  "admin-access": adminAccess,
  "jarvis-workspace": jarvisWorkspace,
  sessions: sessionsView,
  "live-plan": livePlan,
  "live-news": liveNews,
  "live-timeline": liveTimeline,
  "execution-reconciliation": executionReconciliation,
  "operations-observability": operationsObservability,
  "research-experiments": researchExperimentsExplorer,
  "research-candidates": researchCandidatesExplorer,
  "research-dataset-detail": researchDatasetDetailExplorer,
  "strategy-deployments": strategyDeploymentsExplorer,
  "replay-overview": replayOverviewExplorer,
  "replay-runs": replayRunsExplorer,
  "replay-run-detail": replayRunDetailExplorer,
  "replay-compare": replayCompareExplorer,
  "performance-overview": performanceOverviewExplorer,
  "performance-calendar": performanceCalendarExplorer,
  "performance-day-detail": performanceDayDetailExplorer,
  "performance-strategies": performanceStrategiesExplorer,
  "performance-trades": performanceTradesExplorer,
  "workflow-detail": workflowDetailExplorer,
  "event-detail": eventDetailExplorer,
  "operations-runbooks": operationsRunbooksExplorer,
  "governance-prompts": governancePromptsExplorer,
  "governance-policies": governancePoliciesExplorer,
  "live-signal-detail": liveSignalDetail,
  "order-detail": orderDetail,
  "position-detail": positionDetail,
  "incident-detail": incidentDetail,
  "strategy-detail": strategyDetail,
  "strategy-compare": strategyCompare,
  "research-experiment-detail": researchExperimentDetail,
  "research-run-detail": researchRunDetail,
};
const VIEW_SOURCE_DEPENDENCIES = {
  "auth-session": [],
  "operator-settings": [],
  "admin-access": ["execution", "incidents"],
  "command-center": ["execution", "strategy", "incidents", "agent-runtime", "portfolio-risk", "health"],
  "demo-paper-readiness": ["execution", "strategy", "agent-runtime", "data-foundation", "portfolio-risk", "health"],
  "events-audit": ["execution", "incidents", "agent-runtime"],
  "operations-queue": ["agent-runtime", "incidents"],
  "research-agent-fleet": ["agent-runtime", "research"],
  "research-compute-scheduler": ["agent-runtime", "simulation-runs"],
  "research-data-catalog": ["data-foundation"],
  "research-experiment-detail": ["research", "agent-runtime", "simulation-runs", "data-foundation"],
  "research-run-detail": ["research", "simulation-runs"],
  "research-lab": ["agent-runtime", "research", "data-foundation", "simulation-runs", "incidents"],
  "strategy-center": ["strategy", "research"],
  "strategy-detail": ["strategy", "research", "execution", "incidents"],
  "strategy-compare": ["strategy", "research", "simulation-runs"],
  "live-trading": ["execution", "strategy", "incidents", "ai-context", "health"],
  "live-signal-detail": ["execution", "strategy", "portfolio-risk", "ai-context"],
  "order-detail": ["execution"],
  "position-detail": ["execution"],
  "incident-detail": ["incidents"],
  orders: ["execution"],
  risk: ["execution", "portfolio-risk"],
  "execution-providers": ["execution", "incidents"],
  "execution-incidents": ["execution", "incidents"],
  portfolio: ["execution", "portfolio-risk"],
  "jarvis-workspace": ["ai-context", "incidents", "agent-runtime", "assistant-runtime", "research", "data-foundation", "execution", "strategy", "portfolio-risk", "health"],
  sessions: ["sessions"],
  "live-plan": ["live-session"],
  "live-news": ["live-session", "front-macro", "front-news"],
  "live-timeline": ["live-session"],
  "execution-reconciliation": ["execution"],
  "operations-observability": ["observability"],
  "research-experiments": ["research"],
  "research-candidates": ["research"],
  "research-dataset-detail": ["data-foundation"],
  "strategy-deployments": ["strategy"],
  "replay-overview": ["replays"],
  "replay-runs": ["replays"],
  "replay-run-detail": ["replay-detail"],
  "replay-compare": ["replays", "replay-comparison"],
  "performance-overview": ["performance"],
  "performance-calendar": ["performance"],
  "performance-day-detail": ["performance"],
  "performance-strategies": ["performance"],
  "performance-trades": ["performance"],
  "workflow-detail": ["workflow-detail"],
  "event-detail": ["event-detail"],
  "operations-runbooks": ["runbooks"],
  "governance-prompts": ["prompt-registry"],
  "governance-policies": ["execution", "observability-policy"],
};
export function isFrontControlPlanePath(pathname) {
  return pathname === FRONT_CONTROL_PLANE_COMMANDS_PATH ||
    pathname === FRONT_CONTROL_PLANE_EVENTS_PATH ||
    pathname === FRONT_CONTROL_PLANE_CAPABILITIES_PATH ||
    VIEW_PATH.test(pathname) || COMMAND_PATH.test(pathname);
}

export function isFrontControlPlaneWriteRequest(pathname, method) {
  return pathname === FRONT_CONTROL_PLANE_COMMANDS_PATH && method === "POST";
}

export function isFrontControlPlaneMethodAllowed(pathname, method) {
  if (pathname === FRONT_CONTROL_PLANE_COMMANDS_PATH) return method === "POST";
  if (pathname === FRONT_CONTROL_PLANE_EVENTS_PATH) return method === "GET";
  if (pathname === FRONT_CONTROL_PLANE_CAPABILITIES_PATH) return method === "GET";
  return (VIEW_PATH.test(pathname) || COMMAND_PATH.test(pathname)) && method === "GET";
}

export async function handleFrontControlPlane(store, { pathname, query = {}, body = {}, headers = {}, actor = {} }) {
  if (pathname === FRONT_CONTROL_PLANE_COMMANDS_PATH) {
    return acceptControlPlaneCommand(store, { body, headers, actor });
  }
  if (pathname === FRONT_CONTROL_PLANE_CAPABILITIES_PATH) return capabilityCatalog(actor);

  const commandMatch = pathname.match(COMMAND_PATH);
  if (commandMatch) return loadControlPlaneCommand(store, commandMatch[1]);

  const match = pathname.match(VIEW_PATH);
  if (!match || !VIEW_NAMES.has(match[1])) {
    throw codedError("FRONT_CONTROL_PLANE_ROUTE_NOT_FOUND", "front_control_plane_route_not_found", 404);
  }

  return loadControlPlaneView(store, match[1], query, actor);
}

function capabilityCatalog(actor = {}) {
  const granted = permissions(actor);
  return {
    schemaVersion: "1.0.0",
    capabilities: granted,
    actions: Object.entries(FRONT_COMMAND_CATALOG).map(([commandType, value]) => ({
      actionId: `control-plane.${commandType}`,
      commandType,
      capability: value.capability,
      environments: [...value.environments],
      mutation: value.mutation,
      brokerExecution: value.brokerExecution,
      allowed: granted.some((item) => item.capability === "front.command" && item.allowed),
    })),
  };
}

async function loadControlPlaneCommand(store, commandId) {
  if (typeof store?.getFrontOperatorCommand !== "function") {
    throw codedError("FRONT_COMMAND_STORE_UNAVAILABLE", "Command status store is unavailable.", 503);
  }
  const command = await store.getFrontOperatorCommand({ command_id: commandId });
  if (!command) throw codedError("FRONT_COMMAND_NOT_FOUND", `Command not found: ${commandId}`, 404);
  return {
    commandId: text(command.command_id, commandId),
    status: normalizeCommandStatus(command.status),
    correlationId: text(command.correlation_id, ""),
    updatedAt: text(command.updated_at_utc || command.accepted_at_utc || command.created_at_utc, ""),
    message: text(command.result?.message || command.error_message, command.status === "ACCEPTED" ? "Commande acceptée ; résultat terminal en attente." : ""),
    auditId: command.audit_id || undefined,
    result: command.result ?? null,
  };
}

function normalizeCommandStatus(value) {
  const status = String(value || "").toUpperCase();
  return ["REQUESTED", "ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CONFLICT", "REJECTED", "CANCELLED", "TIMED_OUT"].includes(status)
    ? status
    : "FAILED";
}

async function loadControlPlaneView(store, viewName, query, actor = {}) {
  const started = currentTick(store?.clock);
  const warnings = [];
  const source = (label, factory) => safeSource(
    label,
    cachedSource(store, label, query, factory, number(store?.frontControlPlaneSourceCacheTtlMs, FRONT_SOURCE_CACHE_TTL_MS)),
    warnings,
    number(store?.frontControlPlaneSourceTimeoutMs, FRONT_SOURCE_TIMEOUT_MS),
  );
  const loaders = {
    execution: () => source("execution", () => call(store, "getExecutionOverview", query)),
    strategy: () => source("strategy", () => call(store, "getStrategyV2Overview", query)),
    performance: () => source("performance", () => call(store, "getOperationsPerformance", query)),
    incidents: () => source("incidents", () => call(store, "listOperationsIncidents", { ...query, limit: 50 })),
    "agent-runtime": () => source("agent-runtime", () => call(store, "listAgentRuntimeTasks", { ...query, limit: 50 })),
    research: () => source("research", () => call(store, "getResearchLabOverview", { ...query, limit: 100 })),
    "data-foundation": () => source("data-foundation", () => call(store, "listDataFoundationDatasets", { ...query, limit: 100 })),
    "simulation-runs": () => source("simulation-runs", () => call(store?.operations, "listSimulationRuns", { ...query, limit: 100 })),
    "portfolio-risk": () => source("portfolio-risk", () => buildPortfolioRiskOverviewFromStore(store, query)),
    "ai-context": () => source("ai-context", () => buildAiContextOverviewFromStore(store, query)),
    sessions: () => source("sessions", async () => {
      const scopes = ["asia_open", "ny_open"].map((session) => ({
        ...normalizeFrontApiScope({ ...query, session }),
        front_cache: true,
        defer_secondary_resources: true,
      }));
      const sessions = await Promise.all(scopes.map((scope) => loadFrontDeskSession(store, scope)));
      return sessions.map(sessionSummary);
    }),
    "live-session": () => source("live-session", () => loadFrontDeskSession(store, {
      ...normalizeFrontApiScope(query),
      front_cache: true,
      defer_secondary_resources: true,
    })),
    "front-macro": () => source("front-macro", () => loadFrontMacroResource(store, { ...query, front_cache: true })),
    "front-news": () => source("front-news", () => loadFrontNewsHeadlinesResource(store, { ...query, front_cache: true })),
    observability: () => source("observability", () => call(store, "getOperationsObservability", { ...query, limit: 100 })),
    "assistant-runtime": () => source("assistant-runtime", () => loadFrontAssistantRuntime(store, { ...query, limit: 20 })),
    replays: () => source("replays", () => call(store, "listOperationsReplays", { ...query, limit: 200 })),
    "replay-detail": () => loadFrontReplayDetail(store, query),
    "replay-comparison": () => source("replay-comparison", () => {
      const ids = queryList(query.ids || query.id);
      return ids.length >= 2 && typeof store?.compareOperationsReplays === "function"
        ? store.compareOperationsReplays({ ids })
        : Promise.resolve(null);
    }),
    "workflow-detail": () => call(store, "getOperationsWorkflow", { workflow_id: requiredQuery(query, "workflowId", "WORKFLOW_ID_REQUIRED") }),
    "event-detail": () => loadFrontEventDetail(store, query),
    runbooks: () => source("runbooks", () => call(store, "listOperationsRunbooks", { ...query, limit: 200 })),
    "prompt-registry": () => source("prompt-registry", () => call(store, "getPromptRegistryOverview", {})),
    "observability-policy": () => source("observability-policy", () => call(store, "getOperationsObservabilityPolicy", {})),
    health: () => typeof store?.health === "function" ? source("health", () => store.health()) : Promise.resolve(null),
  };
  const dependencies = VIEW_SOURCE_DEPENDENCIES[viewName] || [];
  const loaded = Object.fromEntries(await Promise.all(dependencies.map(async (name) => [name, await loaders[name]()]))) ;
  const context = {
    execution: loaded.execution ?? null,
    strategy: loaded.strategy ?? null,
    performance: loaded.performance ?? null,
    incidents: loaded.incidents ?? null,
    runtime: loaded["agent-runtime"] ?? null,
    research: loaded.research ?? null,
    dataFoundation: loaded["data-foundation"] ?? null,
    simulationRuns: loaded["simulation-runs"] ?? null,
    risk: loaded["portfolio-risk"] ?? null,
    ai: loaded["ai-context"] ?? null,
    sessions: loaded.sessions ?? null,
    liveSession: loaded["live-session"] ?? null,
    macro: loaded["front-macro"] ?? null,
    news: loaded["front-news"] ?? null,
    observability: loaded.observability ?? null,
    assistantRuntime: loaded["assistant-runtime"] ?? null,
    replays: loaded.replays ?? null,
    replayDetail: loaded["replay-detail"] ?? null,
    replayComparison: loaded["replay-comparison"] ?? null,
    workflowDetail: loaded["workflow-detail"] ?? null,
    eventDetail: loaded["event-detail"] ?? null,
    runbooks: loaded.runbooks ?? null,
    promptRegistry: loaded["prompt-registry"] ?? null,
    observabilityPolicy: loaded["observability-policy"] ?? null,
    health: loaded.health ?? null,
    query, warnings, clock: store?.clock, nowIso: currentTick(store?.clock).utc, actor,
  };
  return envelope({
    viewName,
    started,
    stale: warnings.length > 0,
    warnings,
    data: viewData(viewName, context),
    clock: store?.clock,
    sources: dependencies,
    actor,
  });
}

function viewData(viewName, context) {
  return (VIEW_BUILDERS[viewName] || commandCenter)(context);
}

async function loadFrontReplayDetail(store, query = {}) {
  const runId = requiredQuery(query, "runId", "REPLAY_RUN_ID_REQUIRED");
  // The historical detail endpoint hydrates the complete price series and every
  // GPT payload. That contract remains available to specialist consumers, but it
  // is too large for an operator-page bootstrap. The Control Plane projection
  // reads the same canonical run and timeline through their scoped paths and
  // publishes only the counts required by this view.
  const [replays, timeline] = await Promise.all([
    call(store, "listOperationsReplays", { limit: 1000, versionScope: "all" }),
    call(store, "getOperationsReplayTimeline", { run_id: runId }),
  ]);
  const run = rows(replays?.items).find((item) => String(item?.sourceId || item?.id || "") === runId);
  if (!run) throw codedError("REPLAY_NOT_FOUND", `Unknown replay: ${runId}`, 404);
  return {
    run,
    gptProcessCount: number(run?.metrics?.gptProcesses, 0),
    timelineCount: rows(timeline?.items).length,
    projectionMode: "OPERATOR_SUMMARY",
  };
}

async function loadFrontEventDetail(store, query) {
  const eventId = requiredQuery(query, "eventId", "EVENT_ID_REQUIRED");
  const scope = normalizeFrontApiScope(query);
  const date = text(query.date || eventId.match(/\d{4}-\d{2}-\d{2}/)?.[0], scope.trading_date);
  if (query.strategyId) {
    try {
      return await call(store, "getLiveTimelineEventDetail", { event_id: eventId, strategy_id: query.strategyId, session: scope.session, date });
    } catch (error) {
      if (!isEventLookupMiss(error)) throw error;
    }
  }
  const sessions = query.session ? [query.session] : ["asia_open", "ny_open"];
  const projections = await Promise.all(sessions.map((session) => loadFrontDeskSession(store, {
    ...scope,
    strategy_id: session === "ny_open" ? "ny_open_1530" : "asia_open",
    trading_date: date,
    date,
    session,
    front_cache: true,
    defer_secondary_resources: true,
  })));
  const event = projections.flatMap(sessionEvents).find((item) => eventIdentifier(item) === eventId);
  if (!event) throw codedError("EVENT_NOT_FOUND", `Event not found: ${eventId}`, 404);
  return { event: normalizeEventDetail(event, eventId) };
}

function sessionEvents(projection) {
  return [...rows(projection?.operationalTimeline), ...rows(projection?.timeline)];
}

function eventIdentifier(event) {
  return text(event?.id || event?.eventId || event?.event_id, "");
}

function normalizeEventDetail(event, eventId) {
  return {
    ...event,
    id: eventId,
    eventType: text(event.type || event.category || event.eventType || event.event_type, "EVENT"),
    title: text(event.title || event.label, "Événement"),
    status: text(event.status, "RECORDED"),
    occurredAt: text(event.actualAt || event.at || event.occurredAt || event.plannedAt, "Horodatage indisponible"),
  };
}

function isEventLookupMiss(error) {
  return ["TIMELINE_EVENT_NOT_FOUND", "EVENT_NOT_FOUND", "SCOPE_REQUIRED", "STRATEGY_SESSION_MISMATCH"].includes(String(error?.code || ""));
}

function commandCenter({ execution, strategy, incidents, runtime, risk, warnings, nowIso }) {
  const openIncidents = rows(incidents).length;
  return {
    summary: commandCenterSummary({ execution, strategy, incidents, runtime, warnings }),
    systems: commandCenterSystems({ execution, strategy, runtime, risk, warnings }),
    activity: activityRows({ execution, strategy, incidents }),
    risk: commandCenterRisk({ execution, risk, openIncidents }),
    lanes: commandCenterLanes({ execution, runtime, risk }),
    upcoming: [{ id: "next-refresh", time: timeLabel(nowIso), title: "Rafraîchissement projection", detail: "BFF VNext read-only", tone: warnings.length ? "WATCH" : "INFO" }],
  };
}

function commandCenterSummary({ execution, strategy, incidents, runtime, warnings }) {
  const criticalIncidents = countBy(rows(incidents), isCriticalSeverity);
  return {
    deskStatus: warnings.length || criticalIncidents || execution?.safety?.submissionPossible === false ? "DEGRADED" : "NOMINAL",
    activeStrategies: countBy(strategy?.instances, isActiveExecutionMode),
    activeResearchAgents: rows(runtime).length,
    criticalIncidents,
    pendingCommands: countBy(execution?.intents, isPendingCommandStatus),
  };
}

function commandCenterSystems({ execution, strategy, runtime, risk, warnings }) {
  return [
    system("market-data", "Market Data", execution ? "OK" : "DEGRADED", execution ? "État execution disponible ; fraîcheur détaillée dans Live" : "Source execution indisponible", 0),
    system("strategy-runtime", "Strategy Runtime", availabilityStatus(strategy), `${rows(strategy?.instances).length} instances visibles`, 0),
    system("agent-runtime", "AI Worker Service", availabilityStatus(runtime), `${rows(runtime).length} tâches agent visibles`, 0),
    system("execution-gateway", "Execution Gateway", availabilityStatus(execution), `${rows(execution?.orders).length} ordres broker visibles`, 0),
    system("portfolio-risk", "Portfolio Risk", risk?.summary?.submission_possible === false ? "DEGRADED" : availabilityStatus(risk), risk?.summary?.status || "projection partielle", 0),
    system("postgres", "PostgreSQL", warnings.length ? "DEGRADED" : "OK", warnings[0] || "lectures BFF effectuées", 0),
  ];
}

function commandCenterRisk({ execution, risk, openIncidents }) {
  return {
    capitalStatus: riskCapitalStatus(risk),
    riskUsagePct: number(risk?.summary?.risk_percent, 0),
    maxDrawdownR: number(execution?.performance?.max_drawdown_R ?? 0, 0),
    openPositions: number(risk?.summary?.openTrades, 0),
    healthyLimits: risk?.summary?.submission_possible ? 1 : 0,
    totalLimits: 1,
    activeAlerts: openIncidents,
  };
}

function commandCenterLanes({ execution, runtime, risk }) {
  return [
    laneState("live-lane", "Chaîne Live", "runtime → risk → execution", execution),
    laneState("research-lane", "Research Factory", "agents IA et expériences", runtime),
    laneState("execution-lane", "Exécution & protection", "provider-neutral", execution),
    laneState("risk-lane", "Portfolio Risk", "arbitrage et limites globales", risk),
  ];
}

function sessionsView({ sessions, query }) {
  const scope = normalizeFrontApiScope(query);
  const items = rows(sessions).filter((item) => item?.id).map((item) => ({
    sessionId: String(item.id),
    label: text(item.label, String(item.id)),
    shortLabel: text(item.shortLabel, String(item.id).toUpperCase()),
    status: text(item.status, "UNKNOWN"),
    severity: text(item.severity, "info"),
    decision: text(item.decision, "NO_ACTION"),
    healthPct: number(item.health, 0),
    lastMonitorAt: text(item.lastMonitorAt, "—"),
    tradingDate: scope.trading_date,
    route: `/live?session=${encodeURIComponent(String(item.id))}`,
  }));
  return {
    summary: {
      total: items.length,
      nominal: items.filter((item) => ["ok", "success", "info"].includes(item.severity.toLowerCase())).length,
      attention: items.filter((item) => ["warning", "error", "critical", "danger"].includes(item.severity.toLowerCase())).length,
      activeTheses: items.filter((item) => !["NO_ACTIVE_THESIS", "NO_THESIS", "UNKNOWN"].includes(upper(item.status))).length,
      tradingDate: scope.trading_date,
    },
    sessions: items,
  };
}

function livePlan({ liveSession, query, nowIso }) {
  const scope = normalizeFrontApiScope(query);
  const session = liveSession || {};
  const master = session.master || {};
  const thesis = session.thesis || {};
  const setup = session.setup || {};
  const position = session.position || {};
  const masterAvailable = Boolean(master.id && master.id !== "no-master");
  const thesisAvailable = Boolean(thesis.id && thesis.id !== "no-active-thesis");
  const setupAvailable = Boolean(setup.id && setup.id !== "no-setup");
  return {
    summary: {
      sessionStatus: text(session.status, "UNKNOWN"),
      masterAvailable,
      thesisAvailable,
      setupAvailable,
      positionActive: position.active === true,
      nextMonitorAt: text(session.nextMonitorAt, "—"),
    },
    scope: {
      sessionId: text(session.id, scope.session),
      tradingDate: text(session.date, scope.trading_date),
      mode: text(session.mode, scope.mode).toUpperCase(),
      generatedAt: nowIso,
    },
    brief: {
      headline: text(session.liveBrief?.headline, "Aucun brief live matérialisé."),
      action: text(session.liveBrief?.action, "AUCUNE ACTION"),
      summary: text(session.liveBrief?.summary, "Aucun résumé matérialisé."),
      why: text(session.liveBrief?.why, "Motif non publié."),
      nextAction: text(session.liveBrief?.nextAction, "Aucune prochaine action publiée."),
      decision: text(session.liveBrief?.decision, "NO_ACTION"),
    },
    claim: {
      lastClaimAt: text(session.claim?.lastClaimAt, "—"),
      workerId: text(session.claim?.workerId, "—"),
      nextTaskStatus: text(session.claim?.nextTaskStatus, "unknown"),
      nextTaskLabel: text(session.claim?.nextTaskLabel, "Tâche non publiée"),
      dueCheckpoint: text(session.claim?.dueCheckpoint, "—"),
      followingCheckpoint: text(session.claim?.followingTaskCheckpoint, "—"),
      latencySeconds: nullableNumber(session.claim?.latencySeconds),
      latencyTargetSeconds: nullableNumber(session.claim?.latencyTargetSeconds),
    },
    master: {
      available: masterAvailable,
      id: text(master.id, "—"),
      createdAt: text(master.createdAt, "—"),
      decision: text(master.decision, "NON DISPONIBLE"),
      instrument: text(master.instrument, "—"),
      direction: text(master.direction, "wait"),
      confidence: number(master.confidence, 0),
      summary: text(master.summary, "Aucun Master matérialisé."),
      regime: text(master.regime, "Non matérialisé"),
      macroThesis: text(master.macroThesis, "Non matérialisée"),
      assetSelection: text(master.assetSelection, "Non matérialisée"),
      expectedPath: stringList(master.expectedPath),
      failurePath: stringList(master.failurePath),
      monitoringPlaybook: stringList(master.monitoringPlaybook),
    },
    thesis: {
      available: thesisAvailable,
      id: text(thesis.id, "—"),
      instrument: text(thesis.instrument, "—"),
      direction: text(thesis.direction, "wait"),
      status: text(thesis.status, "NO_ACTIVE_THESIS"),
      dominantScenario: text(thesis.dominantScenario, "Aucune thèse active matérialisée."),
      secondaryScenario: text(thesis.secondaryScenario, "Aucun scénario secondaire matérialisé."),
      confidence: number(thesis.confidence, 0),
      health: number(thesis.health, 0),
      validUntil: text(thesis.validUntil, "—"),
      nextFocus: text(thesis.nextFocus, "Aucun focus matérialisé."),
      positiveDrivers: stringList(thesis.scoreDriversPositive),
      negativeDrivers: stringList(thesis.scoreDriversNegative),
    },
    setup: {
      available: setupAvailable,
      id: text(setup.id, "—"),
      label: text(setup.label, "Aucun setup matérialisé"),
      instrument: text(setup.instrument, "—"),
      direction: text(setup.direction, "wait"),
      status: text(setup.status, "NO_SETUP"),
      geometryReady: setup.geometryReady === true,
      backendCanTrigger: setup.backendCanTrigger === true,
      missingFields: stringList(setup.missingFields),
      entryLower: nullableNumber(setup.entryLower ?? setup.entryFrom),
      entryUpper: nullableNumber(setup.entryUpper ?? setup.entryTo),
      executionEntry: nullableNumber(setup.executionEntry),
      executionRule: text(setup.executionRule, "Règle non publiée"),
      stop: nullableNumber(setup.stop),
      tp1: nullableNumber(setup.tp1),
      tp2: nullableNumber(setup.tp2),
      tp3: nullableNumber(setup.tp3),
      risk: nullableNumber(setup.risk),
      confidence: nullableNumber(setup.confidence),
      rr: nullableNumber(setup.rr),
      reason: text(setup.reason, "Aucun motif publié."),
    },
    position: {
      active: position.active === true,
      status: text(position.status, "NO_POSITION"),
      instrument: text(position.instrument, "—"),
      direction: text(position.direction, "wait"),
      entry: nullableNumber(position.entry),
      current: nullableNumber(position.current),
      unrealizedR: nullableNumber(position.unrealizedR),
      executionMode: text(position.executionMode, scope.mode),
      brokerExecution: position.brokerExecution === true,
      note: text(position.note, "Aucune position canonique active."),
    },
    levels: rows(session.levels).map((item, index) => ({
      levelId: text(item.id || item.level_id, `level-${index + 1}`),
      label: text(item.label || item.name, "Niveau"),
      value: nullableNumber(item.value ?? item.price),
      kind: text(item.kind || item.type, "REFERENCE"),
    })),
  };
}

function liveNews({ liveSession, macro, news, query }) {
  const scope = normalizeFrontApiScope(query);
  const macroEvents = rows(macro?.macro).map((item, index) => ({
    eventId: text(item.id || item.event_id, `macro-${item.scheduledAt || item.date || index}`),
    scheduledAt: text(item.scheduledAt, "—"),
    time: text(item.time, "—"),
    title: text(item.title, "Événement macro"),
    currency: text(item.currency, "—"),
    importance: text(item.importance, "UNKNOWN"),
    previous: text(item.previous, "—"),
    forecast: text(item.forecast, "—"),
    actual: text(item.actual, "—"),
    isNext: item.isNext === true,
  }));
  const headlines = rows(news?.headlines).map((item, index) => ({
    headlineId: text(item.id || item.headline_id, `headline-${item.publishedAt || item.scheduledAt || index}`),
    publishedAt: text(item.publishedAt || item.scheduledAt, "—"),
    title: text(item.title, "Actualité sans titre"),
    source: text(item.source, "Source non publiée"),
    provider: text(item.provider, "Provider non publié"),
    importance: text(item.importance, "UNKNOWN"),
    impact: text(item.impact, "Impact non publié."),
    url: text(item.url, ""),
    assets: stringList(item.assets),
    topics: stringList(item.topics),
  }));
  const providerCount = new Set(headlines.map((item) => item.provider).filter((item) => item !== "Provider non publié")).size;
  return {
    summary: {
      macroEvents: macroEvents.length,
      highImpactEvents: macroEvents.filter((item) => upper(item.importance) === "HIGH").length,
      headlines: headlines.length,
      providers: providerCount,
      nearEvent: macro?.nearEvent === true,
      nextMacroAt: text(macro?.nextMacro || liveSession?.nextMacro, "—"),
    },
    scope: {
      sessionId: text(liveSession?.id, scope.session),
      tradingDate: text(liveSession?.date, scope.trading_date),
      mode: text(liveSession?.mode, scope.mode).toUpperCase(),
    },
    macroEvents,
    headlines,
  };
}

function liveTimeline({ liveSession, query }) {
  const scope = normalizeFrontApiScope(query);
  const operational = rows(liveSession?.operationalTimeline).map((item, index) => ({
    eventId: text(item.id, `operational-${index + 1}`),
    category: text(item.type, "OPERATION"),
    title: text(item.label, "Événement opérationnel"),
    plannedAt: text(item.plannedAt, "—"),
    actualAt: item.actualAt ? String(item.actualAt) : null,
    status: text(item.status, "UNKNOWN"),
    latencySeconds: nullableNumber(item.latencySeconds),
    summary: text(item.summary, "Résumé non publié."),
    detail: text(item.detail, "Détail non publié."),
  }));
  const analytical = rows(liveSession?.timeline).map((item, index) => ({
    eventId: text(item.id || item.eventId, `timeline-${index + 1}`),
    category: text(item.type || item.category, "ANALYSIS"),
    title: text(item.title || item.label, "Événement d'analyse"),
    plannedAt: text(item.plannedAt || item.at || item.occurredAt, "—"),
    actualAt: item.actualAt || item.at || item.occurredAt ? String(item.actualAt || item.at || item.occurredAt) : null,
    status: text(item.status, "COMPLETED"),
    latencySeconds: nullableNumber(item.latencySeconds),
    summary: text(item.summary || item.description, "Résumé non publié."),
    detail: text(item.detail, "Détail non publié."),
  }));
  const events = [...operational, ...analytical].sort((left, right) => String(left.plannedAt).localeCompare(String(right.plannedAt)));
  return {
    summary: {
      total: events.length,
      completed: events.filter((item) => ["DONE", "COMPLETED", "EXECUTED"].includes(upper(item.status))).length,
      waiting: events.filter((item) => ["WAITING", "SCHEDULED", "READY"].includes(upper(item.status))).length,
      delayed: events.filter((item) => ["LATE", "DELAYED", "FAILED", "BLOCKED"].includes(upper(item.status))).length,
      nextCheckpointAt: text(liveSession?.nextCheckpointAt, "—"),
      lastCompletedAt: text(liveSession?.lastCompletedCheckpointAt, "—"),
    },
    scope: {
      sessionId: text(liveSession?.id, scope.session),
      tradingDate: text(liveSession?.date, scope.trading_date),
      mode: text(liveSession?.mode, scope.mode).toUpperCase(),
    },
    events,
  };
}

function executionReconciliation({ execution }) {
  const reconciliations = rows(execution?.reconciliations).map((item, index) => ({
    reconciliationId: text(item.reconciliation_id || item.id, `reconciliation-${index + 1}`),
    accountId: text(item.broker_account_id || item.account_id, "—"),
    status: text(item.status, "UNKNOWN"),
    mismatchCount: number(item.mismatch_count, rows(item.mismatches).length),
    checkedAt: text(item.checked_at_utc || item.created_at_utc || item.updated_at_utc, "—"),
    source: text(item.source || item.adapter_kind, "execution-overview"),
  }));
  const parityRuns = rows(execution?.adapterParityRuns).map((item, index) => ({
    parityRunId: text(item.adapter_parity_run_id || item.id, `parity-${index + 1}`),
    accountId: text(item.broker_account_id, "—"),
    leftAdapter: text(item.left_adapter, "—"),
    rightAdapter: text(item.right_adapter, "—"),
    status: text(item.status, "UNKNOWN"),
    mismatchCount: number(item.mismatch_count, rows(item.mismatches).length),
    checkedAt: text(item.checked_at_utc || item.created_at_utc || item.updated_at_utc, "—"),
  }));
  const mismatches = reconciliations.reduce((total, item) => total + item.mismatchCount, 0) + parityRuns.reduce((total, item) => total + item.mismatchCount, 0);
  return {
    summary: {
      status: reconciliations.length === 0 && parityRuns.length === 0 ? "NOT_RUN" : mismatches > 0 ? "MISMATCH" : "MATCHED",
      reconciliationRuns: reconciliations.length,
      parityRuns: parityRuns.length,
      mismatches,
      openTrades: number(execution?.summary?.openTrades, 0),
      activeOrders: number(execution?.summary?.activeOrders, 0),
    },
    reconciliations,
    parityRuns,
    providers: providerRows(execution),
    accounts: rows(execution?.accounts).filter((item) => item?.broker_account_id).map(accountRow),
  };
}

function operationsObservability({ observability }) {
  const summary = observability?.summary || {};
  const workerSummary = observability?.aiWorkers || {};
  return {
    summary: {
      processes: number(summary.processes, 0),
      queued: number(summary.queued, 0),
      running: number(summary.running, 0),
      failed: number(summary.failed, 0),
      completed: number(summary.completed, 0),
      retries: number(summary.retries, 0),
      successRate: nullableNumber(summary.successRate),
      avgQueueMs: nullableNumber(summary.avgQueueMs),
      avgExecutionMs: nullableNumber(summary.avgExecutionMs),
      p95ExecutionMs: nullableNumber(summary.p95ExecutionMs),
      totalTokens: nullableNumber(summary.totalTokens),
      costUsd: nullableNumber(summary.costUsd),
      slaBreaches: number(summary.slaBreaches, 0),
    },
    queue: {
      depth: number(observability?.queue?.depth, 0),
      oldestQueuedMs: nullableNumber(observability?.queue?.oldestQueuedMs),
      activeLeases: number(observability?.leases?.active, 0),
      expiringLeases: number(observability?.leases?.expiring, 0),
      expiredLeases: number(observability?.leases?.expired, 0),
    },
    coverage: observability?.coverage || {},
    runtimeSettings: {
      reasoningEffort: text(observability?.aiRuntimeSettings?.reasoningEffort, "unavailable"),
      revision: number(observability?.aiRuntimeSettings?.revision, 0),
      source: text(observability?.aiRuntimeSettings?.source, "unavailable"),
      appliesTo: text(observability?.aiRuntimeSettings?.appliesTo, "unavailable"),
      supportedReasoningEfforts: stringList(observability?.aiRuntimeSettings?.supportedReasoningEfforts),
      updatedAt: observability?.aiRuntimeSettings?.updatedAt ? String(observability.aiRuntimeSettings.updatedAt) : null,
    },
    workerSummary: {
      expected: number(workerSummary.expected, 0),
      registered: number(workerSummary.registered, 0),
      healthy: number(workerSummary.healthy, 0),
      active: number(workerSummary.active, 0),
      degraded: number(workerSummary.degraded, 0),
    },
    workers: rows(workerSummary.items).map((item, index) => ({
      workerId: text(item.workerId || item.worker_id || item.id, `worker-${index + 1}`),
      status: text(item.status, "UNKNOWN"),
      model: text(item.model, "—"),
      lastSeenAt: text(item.lastSeenAt || item.last_seen_at_utc, "—"),
      task: text(item.task || item.currentTask || item.current_task, "—"),
    })),
    processes: rows(observability?.items).map((item, index) => ({
      processId: text(item.id, `process-${index + 1}`),
      scope: text(item.scope, "—"),
      workflow: text(item.workflow, "—"),
      runId: text(item.runId, "—"),
      status: text(item.status, "UNKNOWN"),
      worker: text(item.worker, "—"),
      queueMs: nullableNumber(item.queueMs),
      executionMs: nullableNumber(item.executionMs),
      totalTokens: nullableNumber(item.telemetry?.totalTokens),
      costUsd: nullableNumber(item.telemetry?.costUsd),
      queueBreached: item.sla?.queueBreached === true,
      executionBreached: item.sla?.executionBreached === true,
      updatedAt: text(item.updatedAt, "—"),
    })),
    workflowBreakdown: rows(observability?.breakdowns?.workflows).map((item) => ({
      label: text(item.label, "—"),
      processes: number(item.processes, 0),
      running: number(item.running, 0),
      failed: number(item.failed, 0),
      successRate: nullableNumber(item.successRate),
      avgExecutionMs: nullableNumber(item.avgExecutionMs),
    })),
  };
}

function researchExperimentsExplorer({ research }) {
  const items = rows(research?.experiments).filter((item) => item?.research_experiment_id).map((item) => explorerItem({
    id: item.research_experiment_id,
    title: item.name,
    subtitle: item.objective,
    status: item.status,
    primary: `${number(item.counts?.evaluation_reports, 0)} rapports`,
    secondary: text(item.comparison_metric, "métrique non publiée"),
    route: `/research/experiments/${encodeURIComponent(String(item.research_experiment_id))}`,
    tags: [item.owner, item.metadata?.mission_id],
  }));
  return explorerView("Expériences", "Hypothèses, évaluations et progression des expériences de recherche.", items, [
    metric("Actives", items.filter((item) => ["ACTIVE", "RUNNING"].includes(upper(item.status))).length),
    metric("Terminées", items.filter((item) => upper(item.status) === "COMPLETED").length),
    metric("Rapports", rows(research?.evaluation_reports).length),
  ]);
}

function researchCandidatesExplorer({ research }) {
  const reports = new Map(rows(research?.evaluation_reports).map((item) => [item.research_candidate_id, item]));
  const items = rows(research?.candidates).filter((item) => item?.research_candidate_id).map((item) => {
    const report = reports.get(item.research_candidate_id) || {};
    return explorerItem({
      id: item.research_candidate_id,
      title: item.primary_change_summary || item.name || "Candidat stratégie",
      subtitle: `Expérience ${text(item.research_experiment_id, "—")}`,
      status: item.status,
      primary: text(item.last_evaluation_verdict || report.verdict, "Verdict indisponible"),
      secondary: report.score == null ? "Score indisponible" : `Score ${number(report.score, 0).toFixed(2)}`,
      route: item.research_experiment_id ? `/research/experiments/${encodeURIComponent(String(item.research_experiment_id))}` : undefined,
      tags: [report.report_kind],
    });
  });
  return explorerView("Candidats stratégie", "Verdicts, preuves et statut de promotion sans décision reconstruite côté UI.", items, [
    metric("À revoir", items.filter((item) => upper(item.status).includes("REVIEW")).length),
    metric("Promotion ready", items.filter((item) => upper(item.status) === "PROMOTION_READY").length),
    metric("Rejetés", items.filter((item) => upper(item.status) === "REJECTED").length),
  ]);
}

function researchDatasetDetailExplorer({ dataFoundation, query }) {
  const datasetId = requiredQuery(query, "datasetId", "DATASET_ID_REQUIRED");
  const source = rows(dataFoundation).find((item) => String(item.dataset_id) === datasetId);
  if (!source) throw codedError("DATASET_NOT_FOUND", `Unknown dataset: ${datasetId}`, 404);
  const metadata = source.metadata || {};
  return explorerView("Détail dataset", text(source.name || source.dataset_key, datasetId), [explorerItem({
    id: datasetId,
    title: text(source.name || source.dataset_key, datasetId),
    subtitle: `${text(source.time_range_start_utc, "—")} → ${text(source.time_range_end_utc, "—")}`,
    status: source.status,
    primary: text(source.provenance_hash, "Provenance indisponible"),
    secondary: source.cutoff_utc ? `Cutoff ${source.cutoff_utc}` : "Cutoff indisponible",
    tags: [metadata.instrument, metadata.timeframe, metadata.timezone],
    facts: objectFacts(source, ["dataset_id", "dataset_key", "status", "cutoff_utc", "provenance_hash", "schema_version"]),
  })], [metric("Point-in-time", source.cutoff_utc ? "Oui" : "Non"), metric("Instrument", text(metadata.instrument, "—")), metric("Granularité", text(metadata.timeframe, "—"))]);
}

function strategyDeploymentsExplorer({ strategy }) {
  const versions = new Map(rows(strategy?.versions).map((item) => [item.strategy_version_id, item]));
  const items = rows(strategy?.instances).filter((item) => item?.strategy_instance_id).map((item) => {
    const version = versions.get(item.strategy_version_id) || {};
    return explorerItem({
      id: item.strategy_instance_id,
      title: text(item.strategy_instance_id, "Instance stratégie"),
      subtitle: `${text(item.execution_mode, "—")} · version ${text(version.version_label || item.strategy_version_id, "—")}`,
      status: item.runtime_state,
      primary: text(item.last_heartbeat_at, "Heartbeat indisponible"),
      secondary: item.triple_lock_validated ? "Triple lock validé" : "Triple lock non validé",
      route: version.strategy_definition_id ? `/strategies/${encodeURIComponent(String(version.strategy_definition_id))}` : undefined,
      tags: [item.execution_mode, ...(rows(item.instrument_scope))],
    });
  });
  return explorerView("Déploiements stratégie", "Instances runtime, modes d'exécution et heartbeat réels.", items, [metric("Instances", items.length), metric("PAPER", items.filter((item) => item.tags.includes("PAPER")).length), metric("Actives", items.filter((item) => ["RUNNING", "ACTIVE"].includes(upper(item.status))).length)]);
}

function replayOverviewExplorer({ replays }) {
  const summary = replays?.summary || {};
  const items = rows(replays?.days).map((item) => explorerItem({
    id: text(item.primaryRunId || item.date, "replay-day"),
    title: `Replay du ${text(item.date, "—")}`,
    subtitle: `${number(item.sessionCount, 0)} session(s) · ${number(item.totalProgress, 0)}%`,
    status: item.status,
    primary: `${signedNumber(item.totalR)} R`,
    secondary: `${number(item.gptProcesses, 0)} processus GPT`,
    route: item.primaryRunId ? `/replay/runs/${encodeURIComponent(String(item.primaryRunId))}` : "/replay/runs",
    tags: [item.currentReplayTime, item.startTime, item.endTime],
  }));
  return explorerView("Replay", "Progression, résultats et éligibilité des journées replay.", items, [metric("Exécutions", number(summary.executions, 0)), metric("Actifs", number(summary.active, 0)), metric("Total R", `${signedNumber(summary.totalR)} R`), metric("Éligibles", number(summary.resultEligible, 0))]);
}

function replayRunsExplorer({ replays }) {
  const items = rows(replays).map(replayExplorerItem);
  return explorerView("Runs Replay", "Chaque run conserve son moteur, sa version et son éligibilité résultat.", items, [metric("Runs", items.length), metric("En cours", items.filter((item) => ["RUNNING", "WAITING_GPT"].includes(upper(item.status))).length), metric("Terminés", items.filter((item) => upper(item.status) === "COMPLETED").length), metric("Échecs", items.filter((item) => upper(item.status) === "FAILED").length)]);
}

function replayRunDetailExplorer({ replayDetail }) {
  const run = replayDetail?.run || {};
  const gptProcessCount = replayDetail?.gptProcessCount ?? rows(replayDetail?.gptProcesses).length;
  const timelineCount = replayDetail?.timelineCount ?? rows(replayDetail?.timeline).length;
  return explorerView("Détail Replay", text(run.name, text(run.sourceId || run.id, "Replay")), [explorerItem({
    id: text(run.sourceId || run.id, "replay"),
    title: text(run.name, "Replay run"),
    subtitle: `${text(run.tradingDate, "—")} · ${text(run.session, "—")} · ${number(run.progress, 0)}%`,
    status: run.status,
    primary: `${signedNumber(run.metrics?.totalR)} R`,
    secondary: `${number(gptProcessCount, 0)} processus GPT · ${number(timelineCount, 0)} événements`,
    tags: [run.engineVersion, run.replaySchemaVersion, run.variantId],
    facts: [
      fact("Moteur", run.engineVersion), fact("Contrat Master", run.masterContractVersion), fact("V4 certifié", run.v4Certified ? "Oui" : "Non"), fact("Résultat éligible", run.resultEligible ? "Oui" : "Non"), fact("Étape courante", run.currentStepId), fact("Action suivante", run.nextAction),
    ],
  })], [metric("Progression", `${number(run.progress, 0)}%`), metric("Total R", `${signedNumber(run.metrics?.totalR)} R`), metric("GPT", number(gptProcessCount, 0)), metric("Timeline", number(timelineCount, 0))]);
}

function replayCompareExplorer({ replays, replayComparison }) {
  if (replayComparison) {
    const comparisons = rows(replayComparison?.items || replayComparison?.runs || replayComparison?.comparisons).map((item) => explorerItem({ id: item.id || item.runId, title: item.name || item.runId, subtitle: item.variant || item.strategyId, status: item.status || item.verdict, primary: item.totalR == null ? "Résultat indisponible" : `${signedNumber(item.totalR)} R`, secondary: item.deltaR == null ? "Delta indisponible" : `${signedNumber(item.deltaR)} R delta`, route: item.runId ? `/replay/runs/${encodeURIComponent(String(item.runId))}` : undefined }));
    return explorerView("Comparaison Replay", "Comparaison backend des runs sélectionnés.", comparisons, [metric("Comparés", comparisons.length)]);
  }
  const items = rows(replays).slice(0, 20).map(replayExplorerItem);
  return explorerView("Comparer Replay", "Sélectionnez au moins deux IDs dans l'URL via ?ids=runA,runB pour une comparaison backend.", items, [metric("Candidats", items.length), metric("Comparaison", "Non configurée")]);
}

function performanceOverviewExplorer({ performance }) {
  const totals = performance?.totals || {};
  const items = rows(performance?.dayDrilldowns).map(performanceDayItem);
  return explorerView("Performance", "PnL en R, risque et attribution calculés par le backend.", items, [metric("Total R", `${signedNumber(totals.totalR)} R`), metric("Trades", number(totals.trades, 0)), metric("Win rate", `${number(totals.winRate, 0).toFixed(1)}%`), metric("Max DD", `${signedNumber(totals.maxDrawdownR)} R`), metric("Expectancy", `${signedNumber(totals.expectancyR)} R`)]);
}

function performanceCalendarExplorer({ performance }) {
  const items = rows(performance?.dayDrilldowns).map(performanceDayItem);
  return explorerView("Calendrier de performance", "Drill-down journalier des résultats officiels en R.", items, [metric("Jours", items.length), metric("Gagnants", items.filter((item) => Number(item.primary.replace(" R", "")) > 0).length), metric("Perdants", items.filter((item) => Number(item.primary.replace(" R", "")) < 0).length)]);
}

function performanceDayDetailExplorer({ performance, query }) {
  const dayId = requiredQuery(query, "dayId", "PERFORMANCE_DAY_ID_REQUIRED");
  const day = rows(performance?.dayDrilldowns).find((item) => String(item.date) === dayId);
  if (!day) throw codedError("PERFORMANCE_DAY_NOT_FOUND", `Unknown performance day: ${dayId}`, 404);
  const trades = rows(day.tradeItems).map(performanceTradeItem);
  return explorerView("Détail performance jour", `${day.date} · ${signedNumber(day.totalR)} R`, trades, [metric("Total R", `${signedNumber(day.totalR)} R`), metric("Trades", number(day.trades, 0)), metric("Wins", number(day.wins, 0)), metric("Losses", number(day.losses, 0)), metric("Drawdown", `${signedNumber(day.drawdownR)} R`)]);
}

function performanceStrategiesExplorer({ performance }) {
  const dimension = rows(performance?.breakdowns).find((item) => upper(item.dimension) === "STRATEGY") || {};
  const items = rows(dimension.items).map((item, index) => explorerItem({ id: item.id || item.key || item.label || `strategy-${index}`, title: item.label || item.strategyId || item.id, subtitle: `${number(item.trades, 0)} trades`, status: item.totalR >= 0 ? "POSITIVE" : "NEGATIVE", primary: `${signedNumber(item.totalR)} R`, secondary: item.winRate == null ? "Win rate indisponible" : `${number(item.winRate, 0).toFixed(1)}% win`, route: item.strategyId ? `/strategies/${encodeURIComponent(String(item.strategyId))}` : undefined }));
  return explorerView("Performance stratégies", "Attribution officielle par stratégie.", items, [metric("Stratégies", items.length), metric("Total R", `${signedNumber(performance?.totals?.totalR)} R`)]);
}

function performanceTradesExplorer({ performance }) {
  const trades = rows(performance?.dayDrilldowns).flatMap((day) => rows(day.tradeItems)).map(performanceTradeItem);
  return explorerView("Trade tape", "Trades officiels utilisés par l'agrégation de performance.", trades, [metric("Trades", trades.length), metric("Total R", `${signedNumber(performance?.totals?.totalR)} R`), metric("Wins", number(performance?.totals?.wins, 0)), metric("Losses", number(performance?.totals?.losses, 0))]);
}

function workflowDetailExplorer({ workflowDetail }) {
  const workflow = workflowDetail?.workflow || workflowDetail || {};
  const id = text(workflow.id || workflow.workflowId || workflow.workflow_id, "workflow");
  const steps = rows(workflowDetail?.steps || workflow.steps).map((step, index) => explorerItem({ id: step.id || step.stepId || `step-${index + 1}`, title: step.label || step.name || step.stepId || "Étape", subtitle: step.detail || step.message || "Détail non publié", status: step.status || step.state, primary: step.durationMs == null ? "Durée indisponible" : `${step.durationMs} ms`, secondary: step.updatedAt || step.updated_at_utc || "Horodatage indisponible" }));
  return explorerView("Détail workflow", id, steps, [metric("Statut", text(workflow.status, "UNKNOWN")), metric("Étapes", steps.length), metric("Progression", `${number(workflow.progress, 0)}%`), metric("Total R", `${signedNumber(workflow.metrics?.totalR)} R`)]);
}

function eventDetailExplorer({ eventDetail }) {
  const event = eventDetail?.event || eventDetail || {};
  const id = text(event.id || event.eventId || event.event_id, "event");
  return explorerView("Détail événement", text(event.title || event.eventType || event.event_type, id), [explorerItem({ id, title: text(event.title || event.eventType || event.event_type, "Événement"), subtitle: text(event.detail || event.message, "Détail non publié"), status: event.status || event.severity || "RECORDED", primary: text(event.occurredAt || event.occurred_at_utc || event.created_at_utc, "Horodatage indisponible"), secondary: text(event.correlationId || event.correlation_id, "Corrélation indisponible"), facts: objectFacts(event, Object.keys(event).slice(0, 12)) })], [metric("Type", text(event.eventType || event.event_type, "—")), metric("Statut", text(event.status || event.severity, "RECORDED"))]);
}

function operationsRunbooksExplorer({ runbooks }) {
  const items = rows(runbooks).map((item) => explorerItem({ id: item.id, title: item.title, subtitle: item.summary, status: item.status || item.severity, primary: text(item.nextAction, "Action non publiée"), secondary: text(item.owner, "Owner non publié"), route: item.workflowId ? `/operations/workflows/${encodeURIComponent(String(item.workflowId))}` : item.incidentId ? `/operations/incidents/${encodeURIComponent(String(item.incidentId))}` : undefined, tags: [item.kind, item.severity, item.session] }));
  return explorerView("Runbooks", "Procédures réelles générées depuis les incidents, notifications et workflows.", items, [metric("Action requise", number(runbooks?.summary?.actionRequired, 0)), metric("Critiques", number(runbooks?.summary?.critical, 0)), metric("En attente", number(runbooks?.summary?.waiting, 0)), metric("Total", items.length)]);
}

function governancePromptsExplorer({ promptRegistry, warnings }) {
  if (!promptRegistry) warnings.push("prompt-registry:UNAVAILABLE");
  const items = rows(promptRegistry).map((item) => explorerItem({ id: item.promptVersionId || item.promptKey, title: item.promptKey, subtitle: `${text(item.lane, "—")} · ${text(item.semanticVersion, "—")}`, status: item.parityStatus || item.status, primary: text(item.deploymentStage, "UNKNOWN"), secondary: text(item.sourcePath, "Source indisponible"), tags: [item.runtimeStack, ...rows(item.contracts).map(promptContractTag)], facts: [fact("Composition", item.compositionId), fact("Hash attendu", item.contentSha256), fact("Hash source", item.actualSourceSha256), fact("Évaluation", item.evaluation?.status)] }));
  return explorerView("Prompts & IA", "Versions, bindings, parité des sources et capacité de rollback.", items, [metric("Prompts actifs", number(promptRegistry?.summary?.activePrompts, 0)), metric("Bindings", number(promptRegistry?.summary?.activeBindings, 0)), metric("Parité OK", number(promptRegistry?.summary?.parityOk, 0)), metric("Drift", number(promptRegistry?.summary?.parityDrift, 0))]);
}

function promptContractTag(contract) {
  if (!contract || typeof contract !== "object") return text(contract, "Contrat inconnu");
  const name = text(contract.name, "Contrat inconnu");
  const version = text(contract.version, "");
  return version ? `${name}@${version}` : name;
}

function governancePoliciesExplorer({ execution, observabilityPolicy }) {
  const executionItems = rows(execution?.policies).map((item, index) => explorerItem({ id: item.policy_id || item.id || `execution-policy-${index + 1}`, title: item.name || item.policy_key || "Politique exécution", subtitle: item.description || "Politique publiée par execution overview", status: item.status || (item.enabled === false ? "DISABLED" : "ACTIVE"), primary: text(item.revision, "Révision indisponible"), secondary: text(item.updated_at_utc || item.updatedAt, "Horodatage indisponible"), tags: ["EXECUTION"] }));
  const obsPolicy = observabilityPolicy?.policy || observabilityPolicy;
  const observabilityItems = obsPolicy && typeof obsPolicy === "object" ? [explorerItem({ id: text(obsPolicy.id || obsPolicy.policyId, "observability-policy"), title: text(obsPolicy.name, "Politique observabilité"), subtitle: "Seuils, budgets et garde-fous de télémétrie", status: obsPolicy.enabled === false ? "DISABLED" : text(obsPolicy.status, "ACTIVE"), primary: text(obsPolicy.revision, "Révision indisponible"), secondary: text(obsPolicy.updatedAt || obsPolicy.updated_at_utc, "Horodatage indisponible"), tags: ["OBSERVABILITY"], facts: objectFacts(obsPolicy, Object.keys(obsPolicy).slice(0, 10)) })] : [];
  const items = [...executionItems, ...observabilityItems];
  return explorerView("Policies", "Politiques réelles de risque, exécution et observabilité en lecture seule.", items, [metric("Politiques", items.length), metric("Actives", items.filter((item) => upper(item.status) === "ACTIVE").length), metric("Désactivées", items.filter((item) => upper(item.status) === "DISABLED").length)]);
}

function liveTrading({ execution, strategy, incidents, ai, health, query, warnings, nowIso }) {
  const executionValue = execution || {};
  const safety = executionValue.safety || {};
  const performance = executionValue.performance || {};
  const advisorySummary = (ai && ai.summary) || {};
  const scope = normalizeFrontApiScope(query);
  const signals = rows(strategy?.signals).filter(hasSignalId).map(signalRow);
  const ordersList = rows(executionValue.orders).filter(hasOrderId).map(orderRow);
  const fills = rows(executionValue.fills).filter(hasFillId).map(fillRow);
  const launchGate = demoPaperLaunchGate({ health, execution: executionValue, nowIso, rows });
  const arbitrations = rows(executionValue.arbitrations).filter((item) => item?.arbitration_id && item?.signal_id).map((item) => ({
    arbitrationId: String(item.arbitration_id),
    signalId: String(item.signal_id),
    decision: ["ACCEPTED", "SCALED", "REJECTED"].includes(upper(item.decision)) ? upper(item.decision) : "REJECTED",
    targetQuantity: number(item.target_quantity, 0),
    conflictStatus: text(item.conflict_status, "UNKNOWN"),
    correlationPct: number(item.correlation_pct, 0),
    reasonCode: text(item.reason_code, "REASON_UNAVAILABLE"),
  }));
  const riskChecks = rows(executionValue.risk_checks).filter((item) => item?.risk_check_id && item?.signal_id).map((item) => ({
    riskCheckId: String(item.risk_check_id),
    signalId: String(item.signal_id),
    status: ["PASS", "WATCH", "BLOCK"].includes(upper(item.status)) ? upper(item.status) : "WATCH",
    limitLabel: text(item.limit_label, "Limite non publiée"),
    usedPct: number(item.used_pct, 0),
    reasonCode: text(item.reason_code, "REASON_UNAVAILABLE"),
  }));
  if (!executionValue.session_id) warnings.push("live-session-id:UNAVAILABLE");
  if (!executionValue.next_monitor_at) warnings.push("live-next-monitor:UNAVAILABLE");
  if (!executionValue.arbitrations) warnings.push("live-arbitrations:UNAVAILABLE");
  if (!executionValue.risk_checks) warnings.push("live-risk-checks:UNAVAILABLE");
  if (safety.correlatedExposurePct == null) warnings.push("live-correlated-exposure:UNAVAILABLE");
  if (!rows(executionValue.pipeline).length) warnings.push("live-pipeline:UNAVAILABLE");
  if (!rows(executionValue.timeline).length) warnings.push("live-timeline:UNAVAILABLE");
  return {
    summary: {
      signalsToday: signals.length,
      tradesExecuted: fills.length,
      acceptanceRatePct: signals.length ? Math.round((ordersList.length / signals.length) * 100) : 0,
      riskUsedPct: number(safety.riskPercent, 0),
      correlatedExposurePct: number(safety.correlatedExposurePct, 0),
      liveDrawdownR: number(performance.max_drawdown_R, 0),
    },
    session: {
      sessionId: text(executionValue.session_id, "unavailable"),
      tradingDate: scope.trading_date,
      phase: scope.session === "ny_open" ? "New York" : "Asia",
      nextMonitorAt: text(executionValue.next_monitor_at, "unavailable"),
      marketDataStatus: liveMarketDataStatus(launchGate),
    },
    launchGate: publicLaunchGate(launchGate),
    pipeline: pipeline(executionValue, launchGate),
    signals,
    arbitrations,
    riskChecks,
    orders: ordersList,
    fills,
    positions: rows(executionValue.trades).filter(hasTradeId).map(positionRow),
    providers: providerRows(execution),
    incidents: rows(incidents).filter(hasIncidentId).map(incidentSummary),
    timeline: rows(executionValue.timeline).filter((item) => item?.event_id).map((item) => ({ eventId: String(item.event_id), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), step: text(item.step || item.domain, "unavailable"), title: text(item.title || item.event_type, "Événement"), detail: text(item.detail || item.message, "Détail indisponible"), tone: ["HIGH", "WATCH"].includes(upper(item.tone || item.severity)) ? upper(item.tone || item.severity) : "INFO" })),
    aiAdvisory: { mode: "ADVISORY", lastContextAt: ai?.generatedAt || nowIso, summary: advisorySummary.status || "AI Context consultatif uniquement." },
  };
}

function demoPaperReadiness(context) { return buildDemoPaperReadiness({ ...context, rows }); }

function portfolio({ execution, risk, nowIso, warnings }) {
  warnings.push("portfolio-attribution:NOT_IMPLEMENTED", "portfolio-correlation:NOT_IMPLEMENTED", "portfolio-equity-curve:NOT_IMPLEMENTED", "portfolio-reconciliation:PARTIAL", "portfolio-virtual-attribution:NOT_IMPLEMENTED");
  const sourceExposureRows = rows(risk?.exposures).filter((item) => item?.exposure_id || item?.instrument_code);
  const exposureRows = sourceExposureRows.filter((item) => finiteNumber(item?.value_usd) !== null);
  if (sourceExposureRows.length && !exposureRows.length) warnings.push("portfolio-exposure-values:UNAVAILABLE");
  const trades = rows(execution?.trades).filter(hasTradeId).filter(isOpenPortfolioTrade);
  const summary = portfolioSummary(execution, risk, nowIso);
  if (summary.accountSnapshotStale) warnings.push("portfolio-account-snapshot:STALE");
  return {
    summary: summary.values,
    summaryTruth: summary.truth,
    equityCurve: [],
    positions: trades.map(portfolioPositionRow),
    exposureTree: exposureRows.map((item) => ({ id: text(item.exposure_id || item.instrument_code, ""), label: text(item.instrument_code, "Instrument"), group: "Index", side: "NET", valueUsd: number(item.value_usd, 0), weightPct: number(item.weight_pct, 0) })),
    brokerPositions: trades.map(portfolioBrokerPositionRow),
    correlationMatrix: { instruments: exposureRows.map((item) => text(item.instrument_code, "—")).slice(0, 4), cells: [], topPair: "—", portfolioCorrelation: 0, diversificationScore: 0 },
    virtualAllocations: [],
    reconciliation: { status: risk?.summary?.reconciliationDivergences ? "MISMATCH" : "PENDING", targetDeskQuantity: 0, brokerRealQuantity: 0, deltaQuantity: 0, asOf: nowIso, ordersInFlight: number(execution?.summary?.activeOrders, 0) },
    attribution: { bestContributor: "—", top3RiskPct: 0, diversificationScore: 0, items: [] },
    timeline: [],
  };
}

function portfolioSummary(execution = {}, risk = {}, nowIso) {
  const snapshot = latestAccountSnapshot(execution?.accountSnapshots);
  const equity = finiteNumber(snapshot?.payload?.net_liquidation_value ?? snapshot?.cash_value);
  const unrealizedPnl = finiteNumber(snapshot?.unrealized_pnl ?? snapshot?.payload?.unrealized_pnl);
  const riskPct = finiteNumber(risk?.summary?.risk_percent ?? execution?.safety?.riskPercent);
  const correlatedExposurePct = finiteNumber(risk?.summary?.correlated_exposure_pct);
  const sourceAt = isoTimestamp(snapshot?.captured_at, nowIso);
  const accountSnapshotStale = Boolean(snapshot) && isOlderThanSeconds(sourceAt, nowIso, number(execution?.safety?.accountSnapshotMaxAgeSeconds, 60));
  const values = {
    equity: equity ?? 0,
    grossExposureUsd: 0,
    netExposureUsd: 0,
    unrealizedPnl: unrealizedPnl ?? 0,
    riskUsedPct: riskPct ?? 0,
    correlatedExposurePct: correlatedExposurePct ?? 0,
    netLiquidation: equity ?? 0,
    dailyR: 0,
    exposureUsd: 0,
    maxDrawdownR: 0,
    openPositions: number(execution?.summary?.openTrades, 0),
    riskUsagePct: riskPct ?? 0,
  };
  return {
    values,
    truth: {
      equity: equity == null ? unavailableValue("Aucun snapshot de capital exploitable", "execution.accountSnapshots") : metricValue(equity, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      grossExposureUsd: notImplementedValue("Le backend ne publie pas encore l’exposition brute consolidée", "portfolio.gross-exposure"),
      netExposureUsd: notImplementedValue("Le backend ne publie pas encore l’exposition nette consolidée", "portfolio.net-exposure"),
      unrealizedPnl: unrealizedPnl == null ? unavailableValue("PnL latent absent du dernier snapshot", "execution.accountSnapshots") : metricValue(unrealizedPnl, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      riskUsedPct: riskPct == null ? unavailableValue("Pourcentage de risque absent", "portfolio-risk") : knownValue(riskPct, nowIso, "portfolio-risk"),
      correlatedExposurePct: correlatedExposurePct == null ? notImplementedValue("Exposition corrélée non publiée", "portfolio.correlation") : knownValue(correlatedExposurePct, nowIso, "portfolio-risk"),
    },
    accountSnapshotStale,
  };
}

function isOpenPortfolioTrade(item = {}) {
  return upper(item.status) === "OPEN" || number(item.quantity_open, 0) > 0;
}

function latestAccountSnapshot(value) {
  return rows(value).slice().sort((left, right) => Date.parse(right?.captured_at || 0) - Date.parse(left?.captured_at || 0))[0] || null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTimestamp(value, fallback) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isOlderThanSeconds(value, reference, seconds) {
  const timestamp = Date.parse(value);
  const now = Date.parse(reference);
  return Number.isFinite(timestamp) && Number.isFinite(now) && now - timestamp > seconds * 1000;
}

function metricValue(value, asOf, source, stale) {
  return stale ? { state: "STALE", value, asOf, source, reason: "Dernier snapshot compte au-delà de la fenêtre de fraîcheur" } : knownValue(value, asOf, source);
}

function knownValue(value, asOf, source) { return { state: "KNOWN", value, asOf, source }; }
function unavailableValue(reason, source) { return { state: "UNAVAILABLE", reason, source }; }
function notImplementedValue(reason, capability) { return { state: "NOT_IMPLEMENTED", reason, capability }; }

function portfolioPositionRow(item = {}) {
  return {
    positionId: text(item.trade_id || item.position_id, ""),
    strategyInstanceId: text(item.strategy_instance_id, "unknown"),
    symbol: text(item.instrument_code, "—"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    virtualR: 0,
    brokerQuantity: number(item.quantity_open, 0),
    reconciliation: "PENDING",
  };
}

function portfolioBrokerPositionRow(item = {}) {
  return {
    positionId: text(item.trade_id || item.position_id, ""),
    account: text(item.broker_account_id, "—"),
    instrument: text(item.instrument_code, "—"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    averagePrice: number(item.entry_price, 0),
    markPrice: number(item.current_price, 0),
    unrealizedPnl: 0,
    riskR: 0,
    protectionStatus: "PENDING",
    reconciliationStatus: "PENDING",
  };
}

function operationsQueue({ runtime, incidents, warnings }) {
  warnings.push("operations-event-flow:NOT_IMPLEMENTED", "operations-policy-gates:NOT_IMPLEMENTED");
  const missions = rows(runtime).filter((item) => item?.mission_id || item?.task_id).map((item) => ({ missionId: text(item.mission_id || item.task_id, ""), title: text(item.task_type, "Agent task"), ownerAgent: text(item.worker_id, "agent-runtime"), currentTask: text(item.status, "READY"), state: runtimeMissionState(item.status), retryCount: number(item.retry_count, 0), maxRetries: number(item.max_retries, 0), tokenBudgetPct: number(item.token_budget_pct, 0), computeBudgetPct: number(item.compute_budget_pct, 0) }));
  return {
    summary: { activeMissions: missions.length, waitingEvents: 0, blockedGates: 0, retryBacklog: 0, dlqItems: 0, budgetUsedPct: 0 },
    missions,
    eventFlow: [],
    policyGates: [],
    deadLetters: [],
    incidents: rows(incidents).filter(hasIncidentId).map((item) => ({ incidentId: text(item.incident_id, ""), missionId: text(item.mission_id, "—"), title: text(item.title, "Incident"), detail: text(item.detail || item.message, "Incident backend"), domain: text(item.domain, "operations"), severity: severity(item.severity), route: "/execution/incidents" })),
    commandActions: [],
  };
}

function eventsAudit({ warnings }) {
  warnings.push("events-audit-source:NOT_IMPLEMENTED");
  return {
    summary: { totalEvents: 0, correlations: 0, authoritativeSteps: 0, advisoryBranches: 0, avgLatencyMs: 0, exportablePayloads: 0 },
    filters: { activeCorrelationId: "none", domains: [], statuses: [], windowLabel: "BFF current" },
    events: [],
    selectedCorrelation: {
      correlationId: "none",
      rootEventId: "none",
      authoritativePath: [],
      advisoryPath: [],
      totalLatencyMs: 0,
      payloadPreview: [],
      logs: [],
    },
    relations: [],
    commandActions: [],
  };
}

function orders({ execution, warnings }) {
  warnings.push("orders-state-machine:NOT_IMPLEMENTED", "orders-history:NOT_IMPLEMENTED");
  const activeOrders = rows(execution?.orders).filter(hasOrderId).map(activeOrderRow);
  return { summary: { orderIntents: rows(execution?.intents).filter(hasIntentId).length, activeOrders: activeOrders.length, recentFills: rows(execution?.fills).filter(hasFillId).length, partialOrders: countBy(activeOrders, (item) => item.state === "PARTIAL"), rejectedOrders: countBy(activeOrders, (item) => item.state === "REJECTED"), protectedOrdersPct: orderProtectionRate(activeOrders) }, filters: { activeTab: "ACTIVE", stateCounts: {}, providerCounts: {} }, orderIntents: rows(execution?.intents).filter(hasIntentId).map(intentRow), activeOrders, fills: rows(execution?.fills).filter(hasFillId).map(orderFillRow), protections: [], providers: providerRows(execution), stateMachine: [], history: [], commandActions: [] };
}

function orderDetail({ execution, query, warnings, actor }) {
  const requestedOrderId = text(query.orderId, "");
  const source = rows(execution?.orders).find((item) => String(item.broker_order_id || item.order_id || "").trim() === requestedOrderId)
    || (!requestedOrderId ? rows(execution?.orders)[0] : null);
  const portfolioIntentSource = findPortfolioOrderIntent({ execution, queryOrderId: requestedOrderId, order: source });
  if (!source && !portfolioIntentSource) throw codedError("ORDER_NOT_FOUND", `Unknown order: ${requestedOrderId}`, 404);
  const canonicalSource = source || syntheticOrderFromPortfolioIntent(portfolioIntentSource);
  const effectiveOrder = activeOrderRow(canonicalSource);
  const fills = rows(execution?.fills).filter((item) => source && (String(item.order_id || item.broker_order_id) === effectiveOrder.orderId || String(item.order_id) === String(source.order_id))).map(orderFillRow);
  const intentSource = portfolioIntentSource || rows(execution?.intents).find((item) => String(item.intent_id || item.order_intent_id) === effectiveOrder.orderIntentId) || null;
  const protections = rows(execution?.protections).filter((item) => String(item.order_id) === effectiveOrder.orderId).map((item) => ({ protectionId: text(item.protection_id, "unavailable"), orderId: effectiveOrder.orderId, stopOrderId: text(item.stop_order_id, undefined), targetOrderId: text(item.target_order_id, undefined), state: ["ATTACHED", "FAILED"].includes(upper(item.state || item.status)) ? upper(item.state || item.status) : "PENDING", stopPrice: number(item.stop_price, undefined), targetPrice: number(item.target_price, undefined), trailingModel: text(item.trailing_model, "unavailable"), reasonCode: text(item.reason_code, "unavailable") }));
  if (!rows(execution?.history).length) warnings.push("order-lifecycle:UNAVAILABLE");
  const lifecycle = [
    ...rows(execution?.history).filter((item) => String(item.order_id || item.broker_order_id) === effectiveOrder.orderId).map((item) => ({ eventId: text(item.event_id, "unavailable"), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), state: text(item.state || item.event_type, "unavailable"), detail: text(item.detail || item.message, "Détail indisponible") })),
    ...providerLifecycleRows({ execution, portfolioIntent: portfolioIntentSource, order: effectiveOrder }),
  ];
  const reconciliation = portfolioIntentSource ? orderIntentReconciliation({ execution, portfolioIntent: portfolioIntentSource, fills }) : null;
  const filledQuantity = reconciliation?.broker?.find((item) => item.label === "filledQuantity")?.value ?? fills.reduce((sum, item) => sum + item.quantity, 0);
  return {
    summary: { state: effectiveOrder.state, orderedQuantity: effectiveOrder.quantity, filledQuantity, remainingQuantity: Math.max(0, effectiveOrder.quantity - filledQuantity), fillCount: fills.length, protectionStatus: effectiveOrder.protectionStatus },
    identity: { orderId: effectiveOrder.orderId, orderIntentId: effectiveOrder.orderIntentId, signalId: effectiveOrder.signalId, providerId: effectiveOrder.providerId, brokerOrderId: effectiveOrder.brokerOrderId, correlationId: effectiveOrder.correlationId, strategyInstanceId: effectiveOrder.strategyInstanceId },
    order: effectiveOrder,
    intent: intentSource ? intentRow(intentSource) : null,
    authority: portfolioIntentSource ? orderAuthorityProjection(portfolioIntentSource) : null,
    executionMode: portfolioIntentSource ? "SEMI_MANUAL" : null,
    humanGate: portfolioIntentSource ? orderHumanGateProjection({ execution, portfolioIntent: portfolioIntentSource, actor }) : null,
    reconciliation,
    fills,
    protections,
    lifecycle,
    relations: [{ label: "Signal", id: effectiveOrder.signalId, route: `/live/signals/${encodeURIComponent(effectiveOrder.signalId)}` }, { label: "Stratégie", id: effectiveOrder.strategyInstanceId, route: `/strategies/${encodeURIComponent(effectiveOrder.strategyInstanceId)}` }],
  };
}

function findPortfolioOrderIntent({ execution, queryOrderId, order }) {
  const expected = new Set([
    queryOrderId,
    order?.portfolio_order_intent_id,
    order?.order_intent_id,
    order?.payload?.portfolio_order_intent_id,
    order?.payload?.order_intent_id,
  ].map((value) => text(value, "")).filter(Boolean));
  return rows(execution?.portfolioOrderIntents).find((item) => {
    const payload = item?.order_intent_payload || item?.payload || {};
    return [
      item?.portfolio_order_intent_id,
      item?.order_intent_id,
      payload?.order_intent_id,
      payload?.portfolio_order_intent_id,
    ].some((value) => expected.has(text(value, "")));
  }) || null;
}

function syntheticOrderFromPortfolioIntent(lineage = {}) {
  const payload = lineage?.order_intent_payload || lineage?.payload || {};
  const protection = payload.protection || {};
  return {
    order_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    broker_order_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    portfolio_order_intent_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    order_intent_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id, ""),
    signal_id: text(payload.signal_id, "unavailable"),
    provider_id: text(payload.provider_id, "provider-neutral"),
    strategy_instance_id: text(payload.strategy_instance_id, "unavailable"),
    broker_account_id: text(payload.broker_account_id || payload.account_id || lineage.target_account_id, "unavailable"),
    instrument_code: text(payload.instrument || lineage.target_instrument, "unavailable"),
    side: payload.action === "SELL" ? "sell" : "buy",
    quantity: number(payload.quantity || lineage.quantity, 0),
    remaining_quantity: number(payload.quantity || lineage.quantity, 0),
    order_type: payload.order_type,
    tif: payload.time_in_force,
    limit_price: payload.limit_price ?? payload.entry_price,
    stop_price: protection.stop_price,
    target_price: protection.target_price,
    idempotency_key: payload.idempotency_key || lineage.idempotency_key,
    correlation_id: payload.correlation_id || lineage.correlation_id,
    updated_at_utc: lineage.updated_at_utc || lineage.created_at_utc || payload.requested_at_utc,
    revision: lineage.order_intent_hash || payload.order_intent_hash,
    status: text(lineage.status || payload.status, "READY"),
    protection_status: protection.ready ? "ATTACHED" : "PENDING",
  };
}

function orderAuthorityProjection(lineage = {}) {
  const payload = lineage.order_intent_payload || lineage.payload || {};
  const source = payload.source || {};
  const riskDecision = firstRow(lineage.risk_decisions);
  const candidateIds = rows(lineage.candidate_allocation_ids || source.candidate_allocation_ids).map(String);
  const riskIds = rows(lineage.risk_decision_ids || source.risk_decision_ids).map(String);
  return {
    strategy: {
      strategyId: text(payload.strategy_id, "unavailable"),
      strategyInstanceId: text(payload.strategy_instance_id, "unavailable"),
      strategyVersion: text(payload.strategy_version_id || payload.strategy_version, "unavailable"),
    },
    signal: {
      signalId: text(payload.signal_id, "unavailable"),
      instrument: text(payload.instrument || lineage.target_instrument, "unavailable"),
      side: payload.action === "SELL" ? "SELL" : "BUY",
    },
    contextGate: authorityStage("Context Gate", {
      decision: text(payload.context_gate_decision || payload.ai_context_decision, ""),
      authorityId: text(payload.context_gate_decision_id || payload.ai_context_gate_decision_id, ""),
      version: text(payload.context_gate_version || payload.ai_context_gate_version, ""),
      reasonCodes: rows(payload.context_gate_reason_codes || payload.ai_context_reason_codes).map(String),
    }),
    portfolioArbitration: authorityStage("Portfolio Arbitration", {
      decision: candidateIds.length ? "ALLOCATED" : "",
      authorityId: text(lineage.portfolio_arbitration_run_id || payload.portfolio_arbitration_run_id || source.portfolio_arbitration_run_id, ""),
      version: text(payload.portfolio_arbitration_version, "portfolio_arbitration_v1"),
      reasonCodes: candidateIds,
    }),
    globalRisk: authorityStage("Global Risk", {
      decision: text(riskDecision?.decision, riskIds.length ? "APPROVED" : ""),
      authorityId: text(riskDecision?.risk_decision_id || riskIds[0], ""),
      version: text(riskDecision?.risk_rule_set_version || payload.risk_rule_set_version, "portfolio_risk_v1"),
      reasonCodes: rows(riskDecision?.reason_codes || payload.risk_reason_codes || riskIds).map(String),
    }),
    targetPosition: {
      targetPositionId: text(lineage.target_position_id || payload.target_position_id, "unavailable"),
      account: text(lineage.target_account_id || payload.account_id || payload.broker_account_id, "unavailable"),
      authorizedQuantity: number(lineage.risk_approved_net_size ?? riskDecision?.approved_size ?? payload.target_net_size ?? payload.quantity, 0),
    },
  };
}

function authorityStage(label, { decision, authorityId, version, reasonCodes }) {
  return {
    label,
    decision: text(decision, ""),
    authorityId: text(authorityId, ""),
    version: text(version, ""),
    reasonCodes: rows(reasonCodes).map(String),
  };
}

function orderHumanGateProjection({ execution, portfolioIntent, actor }) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  const gate = rows(execution?.humanExecutionGates).find((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId)
    || (portfolioIntent?.human_execution_gate_id ? portfolioIntent : null);
  const status = upper(gate?.status || portfolioIntent?.human_gate_status || "AWAITING_MANUAL_CONFIRMATION");
  const operatorCanWrite = permissions(actor).some((item) => item.capability === "front.command" && item.allowed);
  return {
    gateId: text(gate?.human_execution_gate_id || portfolioIntent?.human_execution_gate_id, ""),
    status,
    revision: number(gate?.revision || portfolioIntent?.human_gate_revision, 0),
    expiresAt: text(gate?.expires_at_utc || portfolioIntent?.human_gate_expires_at_utc || portfolioIntent?.expires_at_utc, ""),
    confirmedAt: text(gate?.confirmed_at_utc || portfolioIntent?.human_gate_confirmed_at_utc, ""),
    rejectedAt: text(gate?.rejected_at_utc || portfolioIntent?.human_gate_rejected_at_utc, ""),
    actions: status === "AWAITING_MANUAL_CONFIRMATION" ? humanGateActions({ portfolioIntent, operatorCanWrite }) : [],
    unavailableReason: operatorCanWrite
      ? ""
      : "Session desk.write requise ; le front ne peut pas inventer d'autorisation locale.",
  };
}

function humanGateActions({ portfolioIntent, operatorCanWrite }) {
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  const portfolioOrderIntentId = text(portfolioIntent.portfolio_order_intent_id || payload.order_intent_id, "");
  const expectedRevision = text(portfolioIntent.order_intent_hash || payload.order_intent_hash || portfolioIntent.human_gate_revision, "unavailable");
  const permission = operatorCanWrite ? "ALLOWED" : "DENIED";
  return [
    {
      action: "CONFIRM",
      actionId: `human-gate.confirm.${portfolioOrderIntentId}`,
      label: "Confirmer OrderIntent PAPER",
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      permission,
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision,
      impactPreview: "Autorise uniquement le passage Human Gate ; aucune preuve provider ni fill n'est créée par cette action.",
      payload: { portfolioOrderIntentId },
    },
    {
      action: "REJECT",
      actionId: `human-gate.reject.${portfolioOrderIntentId}`,
      label: "Rejeter OrderIntent",
      commandType: "execution.order_intent.reject",
      environment: "PAPER",
      permission,
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision,
      impactPreview: "Bloque l'intention post-risk sans modifier les termes immuables.",
      payload: { portfolioOrderIntentId },
    },
  ];
}

function orderIntentReconciliation({ execution, portfolioIntent, fills }) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  const state = rows(execution?.portfolioExecutionStates).find((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId) || {};
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  const expectedQuantity = number(payload.quantity || portfolioIntent.quantity, 0);
  const filledQuantity = number(state.filled_quantity, fills.reduce((sum, item) => sum + item.quantity, 0));
  const lifecycleStatus = text(state.lifecycle_status, "AWAITING_MANUAL_CONFIRMATION");
  const mismatches = lifecycleStatus === "FILLED" && filledQuantity !== expectedQuantity
    ? [{ field: "quantity", expected: String(expectedQuantity), actual: String(filledQuantity), reason: "FILLED_QUANTITY_MISMATCH" }]
    : [];
  return {
    status: mismatches.length ? "MISMATCH" : lifecycleStatus,
    checkedAt: text(state.updated_at_utc || portfolioIntent.created_at_utc, ""),
    expected: [
      { label: "portfolioOrderIntentId", value: portfolioOrderIntentId },
      { label: "quantity", value: expectedQuantity },
      { label: "targetPositionId", value: text(portfolioIntent.target_position_id || payload.target_position_id, "") },
    ],
    broker: [
      { label: "filledQuantity", value: filledQuantity },
      { label: "providerOrderRef", value: text(state.provider_order_ref, "") },
      { label: "lifecycleStatus", value: lifecycleStatus },
    ],
    mismatches,
  };
}

function providerLifecycleRows({ execution, portfolioIntent, order }) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  const commandIds = new Set(rows(execution?.providerCommands)
    .filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId)
    .map((item) => text(item.execution_provider_command_id, ""))
    .filter(Boolean));
  return rows(execution?.providerEvents)
    .filter((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId || commandIds.has(text(item.execution_provider_command_id, "")))
    .map((item) => ({
      eventId: text(item.broker_provider_event_id || item.provider_event_id || item.event_id, "unavailable"),
      at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"),
      state: text(item.event_type || item.state, "unavailable"),
      detail: text(item.message || item.provider_status || item.status, `Provider event for ${order.orderId}`),
    }));
}

function positionDetail({ execution, query, warnings }) {
  const source = selectById(rows(execution?.trades), query.positionId, (item) => item.trade_id || item.position_id, "POSITION_NOT_FOUND");
  const base = positionRow(source);
  const relatedOrders = rows(execution?.orders).filter((item) => String(item.strategy_instance_id) === base.strategyInstanceId || (source.signal_id && String(item.signal_id) === String(source.signal_id))).map(activeOrderRow);
  if (!rows(execution?.trade_events).length) warnings.push("position-lifecycle:UNAVAILABLE");
  const lifecycle = rows(execution?.trade_events).filter((item) => String(item.trade_id || item.position_id) === base.positionId).map((item) => ({ eventId: text(item.event_id, "unavailable"), at: text(item.occurred_at_utc || item.created_at_utc, "unavailable"), state: text(item.state || item.event_type, "unavailable"), detail: text(item.detail || item.message, "Détail indisponible") }));
  const signalId = text(source.signal_id, "unavailable");
  return { summary: { state: text(source.status || source.state, base.quantity > 0 ? "OPEN" : "CLOSED"), quantity: base.quantity, pnlR: base.pnlR, riskR: base.riskR, protectionStatus: base.protectionStatus }, identity: { positionId: base.positionId, strategyInstanceId: base.strategyInstanceId, signalId, correlationId: text(source.correlation_id, "unavailable") }, position: { ...base, state: text(source.status || source.state, base.quantity > 0 ? "OPEN" : "CLOSED"), stopPrice: number(source.stop_price, undefined), targetPrice: number(source.target_price, undefined), openedAt: text(source.opened_at_utc || source.entry_at_utc, "unavailable"), closedAt: text(source.closed_at_utc || source.exit_at_utc, undefined) }, orders: relatedOrders, lifecycle, relations: [{ label: "Signal", id: signalId, route: `/live/signals/${encodeURIComponent(signalId)}` }, { label: "Stratégie", id: base.strategyInstanceId, route: `/strategies/${encodeURIComponent(base.strategyInstanceId)}` }] };
}

function incidentDetail({ incidents, query, warnings }) {
  const source = selectById(rows(incidents), query.incidentId, (item) => item.incident_id, "INCIDENT_NOT_FOUND");
  const incident = incidentRow(source);
  if (!incident.chronology.length) warnings.push("incident-chronology:UNAVAILABLE");
  if (!incident.reconciliationResults.length) warnings.push("incident-reconciliation:UNAVAILABLE");
  return { summary: { severity: incident.severity, status: incident.status, retryCount: number(source.retry_count, 0), operatorGate: text(source.operator_gate, "NONE") }, incident: { ...incident, retryCount: number(source.retry_count, 0), operatorGate: text(source.operator_gate, "NONE"), impactR: number(source.impact_R ?? source.impact_r, 0), impactSummary: text(source.impact_summary, incident.detail), machineRecommendation: text(source.machine_recommendation, "Indisponible"), openedAt: text(source.opened_at_utc || source.created_at_utc, "unavailable"), updatedAt: text(source.updated_at_utc || source.created_at_utc, "unavailable") }, payloadPreview: incident.payloadPreview, meta: incident.meta, chronology: incident.chronology, reconciliationResults: incident.reconciliationResults, postMortem: incident.postMortem, retries: rows(source.retries), relations: [{ label: "Ordre", id: text(source.order_id, "unavailable"), route: `/execution/orders/${encodeURIComponent(text(source.order_id, "unavailable"))}` }, { label: "Position", id: text(source.position_id, "unavailable"), route: `/execution/portfolio/positions/${encodeURIComponent(text(source.position_id, "unavailable"))}` }] };
}

function riskCenter({ risk, warnings }) {
  if (!risk?.limits) warnings.push("risk-limits:UNAVAILABLE");
  return { summary: { globalStatus: risk?.summary?.status || "DATA_UNAVAILABLE", riskUsedPct: number(risk?.summary?.risk_percent, 0), grossExposureUsd: number(risk?.summary?.gross_exposure_usd, 0), netExposureUsd: number(risk?.summary?.net_exposure_usd, 0), leverage: number(risk?.summary?.leverage, 0), dailyLossR: number(risk?.summary?.daily_loss_r, 0), dailyLossLimitR: number(risk?.summary?.daily_loss_limit_r, 0), trailingDrawdownR: number(risk?.summary?.trailing_drawdown_r, 0), maxDrawdownR: number(risk?.summary?.max_drawdown_r, 0), activeBreaches: rows(risk?.breaches).length, stressTestsToday: rows(risk?.stress_tests).length }, limits: rows(risk?.limits), exposures: rows(risk?.exposures).filter((item) => item?.exposure_id || item?.instrument_code).map((item) => ({ exposureId: text(item.exposure_id || item.instrument_code, ""), label: text(item.instrument_code, "Exposure"), valueUsd: number(item.value_usd, 0), riskPct: number(item.risk_pct, 0), status: upper(item.status) === "BLOCK" ? "BLOCK" : upper(item.status) === "PASS" ? "PASS" : "WATCH" })), correlations: rows(risk?.correlations), propConstraints: rows(risk?.prop_constraints), stressTests: rows(risk?.stress_tests), breaches: rows(risk?.breaches), commandActions: [] };
}

function executionProviders({ execution, incidents, warnings }) {
  if (!execution?.performance) warnings.push("execution-provider-performance:UNAVAILABLE");
  const providers = providerRows(execution);
  const accounts = rows(execution?.accounts).filter((item) => item?.broker_account_id).map(accountRow);
  return { summary: { primaryProviderId: providers[0]?.providerId || "unavailable", standbyProviderId: providers[1]?.providerId || "unavailable", activeProviders: providers.length, degradedProviders: countBy(providers, (item) => item.status !== "OK"), avgLatencyMs: average(providers.map((item) => item.latencyMs)), fillRatePct: number(execution?.performance?.fill_rate_pct, 0), slippageR: number(execution?.performance?.slippage_r, 0), openIncidents: rows(incidents).filter(hasIncidentId).length, accounts: accounts.length }, providers: providers.map((item, index) => ({ ...item, adapter: item.providerId, state: item.status === "OK" ? index === 0 ? "PRIMARY" : "STANDBY" : "DEGRADED", role: index === 0 ? "PRIMARY" : "STANDBY", fillRatePct: number(execution?.performance?.fill_rate_pct, 0), browserExposure: "NONE" })), accounts, adapters: [], healthChecks: providers.map((item) => ({ checkId: `health_${item.providerId}`, label: item.label, detail: item.status, latencyMs: item.latencyMs, status: item.status === "OK" ? "PASS" : "WATCH" })), switchWorkflow: [], events: [], incidents: rows(incidents).filter(hasIncidentId).map(incidentSummary), commandActions: [] };
}

function executionIncidents({ incidents, warnings }) {
  warnings.push("incident-reconciliation-details:NOT_IMPLEMENTED");
  const list = rows(incidents).filter(hasIncidentId).map(incidentRow);
  return { summary: { openIncidents: list.length, criticalIncidents: countBy(list, (item) => item.severity === "CRITICAL"), highIncidents: countBy(list, (item) => item.severity === "HIGH"), retryableIncidents: 0, pendingReconciliations: 0, impactedOrders: 0, avgAgeMinutes: 0, impactR: 0 }, filters: { activeDomain: "ALL", activeSeverity: "ALL", searchHint: "incident, provider, order", statuses: [] }, incidents: list, selectedIncident: list[0] || emptyIncident(), retries: [], commandActions: [] };
}

function researchLab({ runtime, research, dataFoundation, simulationRuns, incidents, actor }) {
  const experiments = rows(research?.experiments).filter((item) => item?.research_experiment_id).map(researchExperimentRow);
  const candidates = rows(research?.candidates).filter((item) => item?.research_candidate_id);
  const reports = rows(research?.evaluation_reports).filter((item) => item?.research_evaluation_report_id);
  return {
    summary: {
      runningExperiments: countBy(experiments, (item) => item.status === "RUNNING" || item.status === "WAITING"),
      completedExperiments: countBy(rows(research?.experiments), (item) => upper(item.status) === "COMPLETED"),
      promotedStrategies: countBy(candidates, (item) => upper(item.status) === "PROMOTION_READY"),
      rejectedStrategies: countBy(candidates, (item) => upper(item.status) === "REJECTED" || item.last_evaluation_verdict === "FAIL"),
      activeResearchAgents: rows(runtime).length,
      computeBudgetUsedPct: Math.min(100, rows(simulationRuns).length * 4),
      tokenBudgetUsedPct: 0,
    },
    pipeline: researchPipelineRows({ experiments, reports, candidates }),
    experiments,
    agents: rows(runtime).filter((item) => item?.worker_id || item?.task_id).map(agentRow),
    coverage: researchCoverageRows(dataFoundation),
    results: reports.map(researchResultRow),
    knowledgeGraph: researchKnowledgeGraph(research),
    computeQueue: rows(simulationRuns).filter((item) => item?.simulation_run_id || item?.simulationRunId).map(researchLabComputeRow),
    datasets: rows(dataFoundation).filter((item) => item?.dataset_id).map(researchDatasetRow),
    incidents: rows(incidents).filter(hasIncidentId).map((item) => ({ incidentId: text(item.incident_id, ""), severity: severity(item.severity), title: text(item.title, "Incident"), detail: text(item.detail || item.message, "Incident backend"), openedAt: text(item.created_at_utc, "unavailable") })),
    commandActions: [researchBootstrapAction(actor)],
  };
}
function researchAgentFleet({ runtime, warnings }) { warnings.push("agent-conversations:NOT_IMPLEMENTED"); const agents = rows(runtime).filter((item) => item?.worker_id || item?.task_id).map(agentRow); return { summary: { totalAgents: agents.length, activeAgents: countBy(agents, (item) => item.status === "ACTIVE"), waitingAgents: countBy(agents, (item) => item.status === "WAITING"), queueDepth: agents.reduce((sum, item) => sum + item.queueDepth, 0), lockedLeases: countBy(runtime, (item) => Boolean(item.lease_id || item.lease_token)), avgSuccessRatePct: average(rows(runtime).map((item) => number(item.success_rate_pct, NaN))) }, agents, queue: [], conversations: [], incidents: [], commandActions: [] }; }
function researchDataCatalog({ dataFoundation, incidents }) { const datasets = rows(dataFoundation).filter((item) => item?.dataset_id).map(researchDataCatalogDatasetRow); return { summary: { datasets: datasets.length, instruments: new Set(datasets.map((item) => item.instrument)).size, features: 0, lineageEdges: datasets.length, qualityOkPct: datasets.length ? Math.round(countBy(datasets, (item) => item.quality === "OK") / datasets.length * 100) : 0, openGaps: countBy(datasets, (item) => item.quality !== "OK") }, datasets, instruments: researchInstruments(datasets), features: [], lineage: researchLineage(datasets), incidents: rows(incidents).filter(hasIncidentId).map(dataCatalogIncident), commandActions: [] }; }
function researchCompute({ runtime, simulationRuns }) { const sourceWorkers = rows(runtime).filter((item) => item?.worker_id || item?.task_id); const jobs = rows(simulationRuns).filter((item) => item?.simulation_run_id || item?.simulationRunId).map(simulationComputeJobRow); return { summary: { activeWorkers: sourceWorkers.length, runningJobs: countBy(jobs, (item) => item.state === "RUNNING"), queuedJobs: countBy(jobs, (item) => item.state === "QUEUED"), waitingJobs: countBy(sourceWorkers, (item) => upper(item.status) === "READY"), dlqItems: 0, researchUsedPct: average(sourceWorkers.map((item) => number(item.cpu_pct, NaN))), liveReservedPct: 0, costTodayUsd: sourceWorkers.reduce((sum, item) => sum + number(item.cost_usd_hour, 0), 0) }, pools: researchComputePools(jobs), workers: sourceWorkers.map(researchComputeWorkerRow), jobs, reservations: [], dlq: [], commandActions: [] }; }
function strategyCenter({ strategy }) {
  const strategies = rows(strategy?.definitions).map(strategyRow);
  const selected = strategies[0] || strategyRow({});
  return {
    summary: {
      totalStrategies: strategies.length,
      liveStrategies: countBy(strategy?.instances, (item) => upper(item.execution_mode) === "LIVE"),
      paperStrategies: countBy(strategy?.instances, (item) => upper(item.execution_mode) === "PAPER"),
      suspendedStrategies: 0,
      watchlistStrategies: 0,
      averageExpectancyR: 0,
      averageProfitFactor: 0,
      averageDrawdownR: 0,
    },
    strategies,
    lifecycleDistribution: [],
    performanceByFamily: [],
    topStrategies: [],
    recentEvents: [],
    selectedInspector: {
      strategyId: selected.strategyId,
      strategyDefinitionId: selected.strategyDefinitionId,
      strategyVersionId: selected.strategyVersionId,
      strategyInstanceId: selected.strategyInstanceId,
      runtimeBundleId: selected.runtimeBundleId,
      thesis: "Projection BFF read-only : aucun inspector canonique publié pour cette stratégie.",
      rulesSummary: [],
      gates: [],
      riskAllocationPct: 0,
      currentCommandEligibility: "READ_ONLY",
    },
  };
}

function operatorSettings({ warnings }) { warnings.push("operator-settings-store:NOT_IMPLEMENTED"); return { summary: { theme: "dark", density: "compact", language: "fr", timezone: "Europe/Paris", notificationsEnabled: false, voiceState: "OFF", activeDevices: 0, activeSessions: 0, privacyMode: "STRICT" }, cockpitPreferences: [], widgets: [], notificationRules: [], jarvis: { pushToTalkEnabled: false, wakeWordEnabled: false, voiceState: "OFF", lastVoiceCheckAt: "unavailable", transcriptRetention: "NONE" }, shortcuts: [], devices: [], privacy: [], guardrails: [], commandActions: [] }; }
function adminAccess({ actor, warnings }) { warnings.push("admin-directory:NOT_IMPLEMENTED"); const writeAllowed = permissions(actor).some((item) => item.capability === "front.command" && item.allowed); return { summary: { accessMode: writeAllowed ? "FULL_ADMIN" : "READ_ONLY", users: 0, activeUsers: 0, roles: rows(actor?.roles).length, capabilities: permissions(actor).length, accountGroups: 0, pendingChanges: 0, auditEvents: 0 }, currentAccess: { userId: text(actor?.uid || actor?.email, "anonymous"), roles: rows(actor?.roles), canMutate: writeAllowed, readOnlyReason: writeAllowed ? "" : "Session desk.write requise", stepUpReady: writeAllowed }, users: [], roles: [], capabilities: permissions(actor), accountGroups: [], policies: [], providerAccess: [], auditEvents: [], commandActions: [] }; }
function liveSignalDetail({ strategy, execution, risk, ai, query, nowIso }) {
  const source = selectById(rows(strategy?.signals), query.signalId, (item) => item.signal_outbox_id || item.signal_id, "LIVE_SIGNAL_NOT_FOUND");
  const signal = signalRow(source);
  const matchingOrders = rows(execution?.orders).filter((item) => text(item.signal_id, "") === signal.signalId).map(orderRow);
  const identityValue = { signalId: signal.signalId, strategyId: signal.strategyId, strategyDefinitionId: signal.strategyId, strategyVersionId: signal.strategyVersionId, strategyInstanceId: signal.strategyInstanceId, runtimeBundleId: text(source.runtime_bundle_id, "unavailable"), sessionId: text(source.session_id, "unavailable"), correlationId: text(source.correlation_id, "unavailable"), featureSnapshotId: signal.featureSnapshotId, expectedVersion: text(source.revision, "0") };
  return { summary: { signalScore: signal.confidence, timeToExpirySec: Math.max(0, Math.floor((Date.parse(signal.expiresAt) - Date.parse(nowIso)) / 1000)), acceptanceProbabilityPct: signal.confidence, targetQuantity: number(source.target_quantity, 0), riskUsedPct: number(risk?.summary?.risk_percent, 0), conflictCount: 0 }, identity: identityValue, signal: { symbol: signal.symbol, direction: signal.direction, state: signal.state, generatedAt: signal.createdAt, expiresAt: signal.expiresAt, confidence: signal.confidence, expectancyR: signal.expectancyR, rewardRisk: signal.rewardRisk, regime: signal.regime, entryZoneLow: number(source.entry_zone_low ?? source.entry_price, 0), entryZoneHigh: number(source.entry_zone_high ?? source.entry_price, 0), stopPrice: number(source.stop_price, 0), targetPrice: number(source.target_price, 0) }, predicates: rows(source.predicates), featureSnapshot: { featureSnapshotId: signal.featureSnapshotId, datasetId: text(source.dataset_id, "unavailable"), cutoffAt: text(source.cutoff_at_utc || source.created_at_utc, nowIso), hash: text(source.feature_snapshot_hash, "unavailable"), pointInTime: true, freshness: source.feature_snapshot_id ? "FRESH" : "WATCH", items: rows(source.features) }, context: [], conflicts: [], existingPositions: rows(execution?.trades).map(positionRow), arbitration: { arbitrationId: text(source.arbitration_id, "unavailable"), decision: matchingOrders.length ? "ACCEPTED" : "REJECTED", targetQuantity: number(source.target_quantity, 0), conflictStatus: "CLEAR", correlationPct: number(source.correlation_pct, 0), reasonCode: text(source.reason_code, matchingOrders.length ? "ORDER_LINKED" : "ARBITRATION_UNAVAILABLE"), portfolioRoute: "/portfolio" }, riskCheck: { riskCheckId: text(source.risk_check_id, "unavailable"), status: source.risk_check_status === "PASS" ? "PASS" : "WATCH", limitLabel: text(source.risk_limit_label, "Donnée risk check indisponible"), usedPct: number(risk?.summary?.risk_percent, 0), reasonCode: text(source.risk_reason_code, "RISK_CHECK_UNAVAILABLE"), maxRiskPct: number(source.max_risk_pct, 0), netCapital: firstNumber(risk?.accounts, "capital"), targetRiskR: number(source.target_risk_r, 0), roundedQuantity: number(source.target_quantity, 0) }, linkedOrders: matchingOrders, auditTrail: [], aiAdvisory: { mode: "ADVISORY", lastContextAt: ai?.generatedAt || nowIso, summary: text(ai?.summary?.status, "Contexte IA indisponible."), authority: "NONE", recommendation: "WAIT" }, navigation: [{ label: "Stratégie", route: `/strategies/${signal.strategyId}`, kind: "STRATEGY" }, { label: "Ordres", route: "/orders", kind: "ORDERS" }], commandActions: [] };
}
function strategyDetail({ strategy, research, execution, incidents, query, warnings }) {
  const definition = selectById(rows(strategy?.definitions), query.strategyId, (item) => item.strategy_definition_id || item.strategy_id, "STRATEGY_NOT_FOUND");
  const strategyId = String(definition.strategy_definition_id || definition.strategy_id);
  const versions = rows(strategy?.versions).filter((item) => String(item.strategy_definition_id || item.strategy_id) === strategyId);
  const versionIds = new Set(versions.map((item) => String(item.strategy_version_id || "")).filter(Boolean));
  const instances = rows(strategy?.instances).filter((item) => String(item.strategy_definition_id || "") === strategyId || versionIds.has(String(item.strategy_version_id || "")));
  const instanceIds = new Set(instances.map((item) => String(item.strategy_instance_id || "")).filter(Boolean));
  const signals = rows(strategy?.signals).filter((item) => String(item.strategy_definition_id || item.strategy_id || "") === strategyId || instanceIds.has(String(item.strategy_instance_id || "")));
  const trades = rows(execution?.trades).filter((item) => instanceIds.has(String(item.strategy_instance_id || "")));
  const selectedVersion = versions.find((item) => upper(item.status) === "VALIDATED") || versions[0] || null;
  const selectedInstance = instances.find((item) => ["RUNNING", "STARTING"].includes(upper(item.runtime_state || item.status))) || instances[0] || null;
  const reports = rows(research?.evaluation_reports).filter((item) => String(item.strategy_definition_id || item.strategy_id || item.metadata?.strategy_definition_id || "") === strategyId);
  const latestReport = reports[0] || null;
  const metrics = latestReport?.metrics || latestReport?.metric_snapshot || {};
  if (!latestReport) warnings.push("strategy-metrics:NOT_IMPLEMENTED");
  if (!selectedVersion) warnings.push("strategy-version:UNAVAILABLE");
  const runtimeStatus = runtimeState(selectedInstance?.runtime_state || selectedInstance?.status);
  const executionMode = executionModeState(selectedInstance?.execution_mode);
  return {
    summary: {
      strategyScore: number(latestReport?.score, 0),
      netR30d: number(metrics.total_r, 0),
      trades30d: number(metrics.trade_count, trades.length),
      activeVersions: versions.filter((item) => !["REJECTED", "DEPRECATED", "RETIRED"].includes(upper(item.status))).length,
      runningInstances: instances.filter((item) => runtimeState(item.runtime_state || item.status) === "RUNNING").length,
      openSignals: signals.filter((item) => !["FILLED", "EXPIRED", "REJECTED"].includes(signalState(item.state || item.status))).length,
      riskAllocationPct: number(selectedInstance?.risk_allocation_pct, 0),
      liveParityPct: number(metrics.live_parity_pct, 0),
    },
    identity: {
      strategyId,
      strategyDefinitionId: strategyId,
      strategyVersionId: text(selectedVersion?.strategy_version_id, "unavailable"),
      strategyInstanceId: text(selectedInstance?.strategy_instance_id, "unavailable"),
      name: text(definition.name || definition.label, strategyId),
      family: strategyFamily(definition.family),
      thesis: text(definition.thesis || definition.objective || definition.description, "Thèse non publiée par le Strategy Kernel."),
      tier: strategyTier(definition.tier),
      executionMode,
      runtimeStatus,
      scientificStatus: scientificStatus(definition.scientific_status || definition.status),
      versionStatus: versionStatus(selectedVersion?.status),
      runtimeBundleId: text(selectedInstance?.runtime_bundle_id, "unavailable"),
      ownerAgent: text(definition.owner_agent, "Research Reviewer"),
    },
    definition: {
      dslVersion: text(selectedVersion?.dsl_version || definition.dsl_version, "unavailable"),
      sourceExperimentId: text(selectedVersion?.source_experiment_id || definition.source_experiment_id, "unavailable"),
      sourceRunId: text(selectedVersion?.source_run_id || definition.source_run_id, "unavailable"),
      strategySpecId: text(selectedVersion?.strategy_spec_id || definition.strategy_spec_id, "unavailable"),
      instruments: stringList(definition.instruments || selectedVersion?.instruments),
      timeframes: stringList(definition.timeframes || selectedVersion?.timeframes),
      sessions: stringList(definition.sessions || selectedVersion?.sessions),
      tags: stringList(definition.tags),
    },
    strategySpec: strategySpecProjection(selectedVersion?.strategy_spec || definition.strategy_spec),
    constraints: [],
    regimes: [],
    versions: versions.map(strategyVersionRow),
    instances: instances.map(strategyInstanceRow),
    performance: latestReport ? [performanceBucket("BACKTEST", metrics)] : [],
    signals: signals.filter(hasSignalId).map(signalRow),
    trades: trades.filter(hasTradeId).map(strategyTradeRow),
    incidents: rows(incidents).filter((item) => String(item.strategy_definition_id || item.strategy_id || "") === strategyId).map(strategyIncidentRow),
    correlations: [],
    riskAllocation: {
      budgetPct: number(selectedInstance?.risk_allocation_pct, 0),
      usedPct: number(selectedInstance?.risk_used_pct, 0),
      maxConcurrentSignals: number(selectedInstance?.max_concurrent_signals, 0),
      netCapitalPct: number(selectedInstance?.net_capital_pct, 0),
      reason: selectedInstance ? "Valeurs publiées par l'instance runtime." : "Instance runtime indisponible.",
    },
    commandActions: [],
  };
}

function strategyCompare({ strategy, query, warnings }) {
  const definition = selectById(rows(strategy?.definitions), query.strategyId, (item) => item.strategy_definition_id || item.strategy_id, "STRATEGY_NOT_FOUND");
  const strategyId = String(definition.strategy_definition_id || definition.strategy_id);
  const versions = rows(strategy?.versions).filter((item) => String(item.strategy_definition_id || item.strategy_id) === strategyId).slice(0, 2);
  if (versions.length < 2) throw codedError("STRATEGY_COMPARE_INSUFFICIENT_VERSIONS", `Two persisted versions are required for ${strategyId}.`, 409);
  warnings.push("strategy-compare-metrics:NOT_IMPLEMENTED");
  const [base, candidate] = versions;
  return {
    summary: { strategyId, baseVersionId: String(base.strategy_version_id), candidateVersionId: String(candidate.strategy_version_id), verdict: "REVIEW", netImprovementR: 0, expectancyDeltaR: 0, profitFactorDelta: 0, drawdownDeltaR: 0, liveParityDeltaPct: 0 },
    strategy: { strategyId, strategyDefinitionId: strategyId, name: text(definition.name || definition.label, strategyId), family: strategyFamily(definition.family) },
    versions: [compareVersionRow(base, "BASE"), compareVersionRow(candidate, "CANDIDATE")],
    specDiffs: [], parameterDiffs: [], metricComparison: [], regimeComparison: [], divergentTrades: [], costs: [], parity: [],
    deepLinks: [{ label: "Dossier stratégie", route: `/strategies/${strategyId}`, kind: "STRATEGY" }],
    commandActions: [],
  };
}

function researchExperimentDetail({ research, runtime, simulationRuns, dataFoundation, query, warnings }) {
  const source = selectById(rows(research?.experiments), query.experimentId, (item) => item.research_experiment_id || item.experiment_id, "RESEARCH_EXPERIMENT_NOT_FOUND");
  const experimentId = String(source.research_experiment_id || source.experiment_id);
  const missionId = text(source.metadata?.mission_id || source.mission_id, "unavailable");
  const runs = rows(simulationRuns).filter((item) => String(item.metadata?.research_experiment_id || item.research_experiment_id || "") === experimentId);
  const reports = rows(research?.evaluation_reports).filter((item) => String(item.research_experiment_id || "") === experimentId);
  const candidates = rows(research?.candidates).filter((item) => String(item.research_experiment_id || "") === experimentId);
  const owner = rows(runtime).find((item) => String(item.mission_id || "") === missionId) || null;
  const datasets = rows(dataFoundation).filter((item) => {
    const datasetId = String(item.dataset_id || "");
    return runs.some((run) => String(run.dataset_id || run.metadata?.dataset_id || "") === datasetId) || String(source.dataset_id || "") === datasetId;
  });
  const latestReport = reports[0] || null;
  if (!owner) warnings.push("research-owner:UNAVAILABLE");
  if (!latestReport) warnings.push("research-evaluation:UNAVAILABLE");
  return {
    experiment: {
      experimentId,
      missionId,
      runId: text(source.winner_simulation_run_id || runs[0]?.simulation_run_id, "unavailable"),
      title: text(source.name, experimentId),
      hypothesis: text(source.objective, "Hypothèse non publiée."),
      family: text(source.family, "unavailable"),
      stage: stageFromResearch(source),
      status: experimentDetailStatus(source.status),
      score: number(latestReport?.score ?? source.metadata?.score, 0),
      progressPct: researchProgress(source, reports, runs),
      currentTask: text(owner?.status || source.comparison_metric, "unavailable"),
      expectedEvent: text(owner?.expected_event, "unavailable"),
      nextAutomaticTransition: text(source.next_transition, "unavailable"),
    },
    ownership: {
      ownerAgentId: text(owner?.worker_id || owner?.task_id, "unavailable"),
      ownerAgentName: text(owner?.worker_id, "Agent non assigné"),
      missionId,
      conversationId: text(owner?.conversation_id || owner?.thread_id, "unavailable"),
      leaseId: text(owner?.lease_id || owner?.lease_token, "unavailable"),
      heartbeatAt: text(owner?.updated_at_utc || owner?.created_at_utc, "unavailable"),
      tokenBudgetPct: number(owner?.token_budget_pct, 0),
      computeBudgetPct: number(owner?.compute_budget_pct, 0),
    },
    datasets: datasets.map(researchExperimentDatasetRow),
    strategySpec: researchExperimentSpec(source, candidates[0]),
    versions: candidates.map(researchCandidateVersionRow),
    iterations: reports.map(researchIterationRow),
    segmentedMetrics: reports.flatMap(researchSegmentRows),
    agentJournal: rows(owner?.journal).map(researchJournalRow),
    knowledgeCreated: [],
    commandActions: [],
  };
}

function researchRunDetail({ research, simulationRuns, query, warnings }) {
  const source = selectById(rows(simulationRuns), query.runId, (item) => item.simulation_run_id || item.simulationRunId || item.run_id, "RESEARCH_RUN_NOT_FOUND");
  const runId = String(source.simulation_run_id || source.simulationRunId || source.run_id);
  const experimentId = text(source.metadata?.research_experiment_id || source.research_experiment_id, "unavailable");
  const reports = rows(research?.evaluation_reports).filter((item) => String(item.simulation_run_id || item.run_id || item.metadata?.simulation_run_id || "") === runId);
  const report = reports[0] || null;
  const metrics = source.metrics || source.metric_snapshot || report?.metrics || report?.metric_snapshot || {};
  const sourceTrades = rows(source.trades || source.results?.trades);
  if (!report && Object.keys(metrics).length === 0) warnings.push("research-run-metrics:UNAVAILABLE");
  return {
    run: {
      runId,
      experimentId,
      missionId: text(source.metadata?.mission_id || source.mission_id, "unavailable"),
      strategyVersionId: text(source.strategy_version_id || source.metadata?.strategy_version_id, "unavailable"),
      datasetId: text(source.dataset_id || source.metadata?.dataset_id, "unavailable"),
      datasetHash: text(source.dataset_hash || source.metadata?.dataset_hash, "unavailable"),
      engineVersion: text(source.simulation_engine_version || source.engine_version, "unavailable"),
      runtimeVersion: text(source.result_schema_version || source.runtime_version, "unavailable"),
      seed: number(source.reproducibility_seed ?? source.seed, 0),
      status: researchRunStatus(source.status),
      reproducibility: source.dataset_hash && source.engine_version ? "LOCKED" : "PARTIAL",
      startedAt: text(source.started_at_utc || source.startedAt, "unavailable"),
      completedAt: text(source.completed_at_utc || source.completedAt, undefined),
    },
    parameters: objectEntries(source.parameters || source.config || {}),
    summary: runMetricSummary(metrics, sourceTrades),
    equityCurve: numericList(source.equity_curve || source.results?.equity_curve),
    distribution: rows(source.distribution),
    regimePerformance: rows(source.regime_performance),
    hourlyPerformance: rows(source.hourly_performance),
    ambiguity: rows(source.ambiguity),
    benchmark: { baselineRunId: text(source.baseline_run_id, "unavailable"), deltaR: number(source.benchmark?.delta_r, 0), deltaDrawdownR: number(source.benchmark?.delta_drawdown_r, 0), verdict: benchmarkVerdict(source.benchmark?.verdict) },
    trades: sourceTrades.filter(hasTradeId).map(researchRunTradeRow),
    commandActions: [],
  };
}

function envelope({ viewName, data, started, stale, warnings = [], clock, sources = [], actor = {} }) {
  const tick = currentTick(clock);
  const now = tick.utc;
  return {
    meta: {
      generatedAt: now,
      asOf: now,
      stale,
      availability: viewAvailability(warnings, sources),
      warnings,
      sources: sources.map((source) => ({ source, state: warnings.some((warning) => warning.startsWith(`${source}:`)) ? "UNAVAILABLE" : "AVAILABLE" })),
      latencyMs: Math.max(0, tick.epochMs - started.epochMs),
      correlationId: `corr_front_view_${viewName}_${hash(now).slice(0, 12)}`,
      schemaVersion: "1.0.0",
    },
    permissions: permissions(actor),
    data,
  };
}

function permissions(actor = {}) {
  const writeAllowed = ["operator_session", "api_key", "oauth"].includes(String(actor.kind || "")) && rows(actor.scopes).includes("desk.write");
  return [
    { capability: "front.read", allowed: true },
    { capability: "front.command", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.paper", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.live", allowed: false, reason: "LIVE_CUTOVER_LOCKED", requiresStepUp: true },
  ];
}
function system(id, label, status, detail, latencyMs) { return { id, label, status, detail, latencyMs }; }
function lane(id, label, detail, completed, total, state) { return { id, label, detail, completed, total, state }; }
function laneState(id, label, detail, source) { return lane(id, label, detail, source ? 1 : 0, 1, source ? "NOMINAL" : "WATCH"); }
function pipeline(execution, launchGate) {
  const allowedSteps = new Set(["MARKET_DATA", "FEATURE_ENGINE", "STRATEGY_RUNTIME", "SIGNAL_BUS", "ARBITRATION", "GLOBAL_RISK", "BROKER_NETTING", "ORDER_INTENT", "EXECUTION_GATEWAY", "PROVIDER", "BROKER", "RECONCILIATION"]);
  const canonical = rows(execution?.pipeline)
    .filter((item) => allowedSteps.has(upper(item.step_id || item.step)))
    .map((item) => ({
      stepId: upper(item.step_id || item.step),
      label: text(item.label, upper(item.step_id || item.step).replaceAll("_", " ")),
      status: ["OK", "RUNNING", "WATCH", "BLOCKED"].includes(upper(item.status)) ? upper(item.status) : "WATCH",
      latencyMs: number(item.latency_ms, 0),
      detail: text(item.detail || item.message, "Détail backend indisponible"),
    }));
  if (canonical.length) return canonical;
  return [...allowedSteps]
    .map((stepId) => ({ stepId, status: launchGatePipelineStatus(stepId, launchGate), detail: launchGatePipelineDetail(stepId, launchGate) }))
    .filter((item) => item.status)
    .map((item) => ({ stepId: item.stepId, label: item.stepId.replaceAll("_", " "), status: item.status, latencyMs: 0, detail: item.detail || "État issu du launch gate autoritaire" }));
}
function activityRows({ execution, strategy, incidents, nowIso = currentUtc() }) { return [{ id: "act_strategy_projection", time: timeLabel(nowIso), domain: "Strategy", label: "Projection strategy-v2", detail: `${rows(strategy?.instances).length} instances`, duration: "—", state: strategy ? "DONE" : "WATCH" }, { id: "act_execution_projection", time: timeLabel(nowIso), domain: "Execution", label: "Projection execution", detail: `${rows(execution?.orders).length} ordres`, duration: "—", state: execution ? "DONE" : "WATCH" }, ...rows(incidents).filter(hasIncidentId).slice(0, 4).map((item) => ({ id: text(item.incident_id, ""), time: timeLabel(item.created_at_utc || nowIso), domain: text(item.domain, "Operations"), label: text(item.title, "Incident"), detail: text(item.message || item.detail, "Incident ouvert"), duration: "—", state: "WATCH" }))]; }
function signalRow(item) { return { signalId: text(item.signal_outbox_id || item.signal_id, ""), strategyId: text(item.strategy_definition_id || item.strategy_id, "unavailable"), strategyVersionId: text(item.strategy_version_id, "unavailable"), strategyInstanceId: text(item.strategy_instance_id, "unavailable"), symbol: text(item.instrument_code || item.symbol, "unavailable"), direction: upper(item.direction || item.side) === "SHORT" ? "SHORT" : "LONG", state: signalState(item.state || item.status), confidence: number(item.confidence, 0), createdAt: text(item.created_at_utc, "unavailable"), expiresAt: text(item.expires_at_utc, "unavailable"), featureSnapshotId: text(item.feature_snapshot_id, "unavailable"), ruleHits: stringList(item.rule_hits), expectancyR: number(item.expectancy_R ?? item.expectancy_r, 0), rewardRisk: number(item.reward_risk, 0), regime: text(item.regime, "unavailable") }; }
function orderRow(item) { return { orderId: text(item.broker_order_id || item.order_id, ""), signalId: text(item.signal_id, "unavailable"), providerId: text(item.provider_id, "unavailable"), brokerOrderId: text(item.broker_order_id, "unavailable"), symbol: text(item.instrument_code || item.broker_symbol, "unavailable"), side: upper(item.side) === "SELL" ? "SELL" : "BUY", type: orderType(item.order_type || item.type), quantity: number(item.quantity, 0), state: orderState(item.state || item.status) }; }
function activeOrderRow(item) { const payload = item?.order_intent_payload || item?.payload || {}; const protection = payload.protection || {}; return { ...orderRow(item), orderIntentId: text(item.portfolio_order_intent_id || item.order_intent_id || payload.order_intent_id, "unavailable"), strategyInstanceId: text(item.strategy_instance_id || payload.strategy_instance_id, "unavailable"), account: text(item.broker_account_id || payload.broker_account_id || payload.account_id, "unavailable"), instrument: text(item.instrument_code || item.broker_symbol || payload.instrument, "unavailable"), remainingQuantity: number(item.remaining_quantity ?? item.quantity ?? payload.quantity, 0), tif: text(item.tif || item.time_in_force || payload.time_in_force, "unavailable"), limitPrice: number(item.limit_price ?? item.entry_price ?? payload.limit_price ?? payload.entry_price, undefined), stopPrice: number(item.stop_price ?? payload.stop_price ?? protection.stop_price, undefined), targetPrice: number(item.target_price ?? payload.target_price ?? protection.target_price, undefined), commissions: number(item.commissions, 0), slippageR: number(item.slippage_R ?? item.slippage_r, 0), protectionStatus: protectionState(item.protection_status || (protection.ready ? "PROTECTED" : "")), idempotencyKey: text(item.idempotency_key || payload.idempotency_key, "unavailable"), correlationId: text(item.correlation_id || payload.correlation_id, "unavailable"), updatedAt: text(item.updated_at_utc || item.created_at_utc || payload.requested_at_utc, "unavailable"), expectedVersion: text(item.revision || item.order_intent_hash || payload.order_intent_hash, "unavailable") }; }
function intentRow(item) { const payload = item?.order_intent_payload || item?.payload || {}; const protection = payload.protection || {}; return { orderIntentId: text(item.intent_id || item.order_intent_id || item.portfolio_order_intent_id || payload.order_intent_id, ""), signalId: text(item.signal_id || payload.signal_id, "unavailable"), strategyInstanceId: text(item.strategy_instance_id || payload.strategy_instance_id, "unavailable"), account: text(item.broker_account_id || payload.broker_account_id || payload.account_id || item.target_account_id, "unavailable"), instrument: text(item.instrument_code || payload.instrument || item.target_instrument, "unavailable"), side: upper(item.side || payload.side || payload.action) === "SELL" ? "SELL" : "BUY", quantity: number(item.quantity ?? payload.quantity, 0), type: orderType(item.order_type || item.type || payload.order_type), tif: text(item.tif || item.time_in_force || payload.time_in_force, "unavailable"), limitPrice: number(item.limit_price ?? item.entry_price ?? payload.limit_price ?? payload.entry_price, undefined), stopPrice: number(item.stop_price ?? payload.stop_price ?? protection.stop_price, undefined), targetPrice: number(item.target_price ?? payload.target_price ?? protection.target_price, undefined), providerId: text(item.provider_id || payload.provider_id, "unavailable"), state: text(item.state || item.status || payload.status, "unavailable"), idempotencyKey: text(item.idempotency_key || payload.idempotency_key, "unavailable"), correlationId: text(item.correlation_id || payload.correlation_id, "unavailable"), createdAt: text(item.created_at_utc || payload.requested_at_utc, "unavailable"), expectedVersion: text(item.revision || item.order_intent_hash || payload.order_intent_hash, "unavailable") }; }
function fillRow(item) { return { fillId: text(item.fill_id, ""), orderId: text(item.order_id, "unavailable"), quantity: number(item.quantity, 0), price: number(item.price, 0), filledAt: text(item.filled_at_utc, "unavailable") }; }
function orderFillRow(item) { return { ...fillRow(item), providerId: text(item.provider_id, "provider"), brokerExecutionId: text(item.broker_execution_id, "—"), instrument: text(item.instrument_code, "—"), commission: 0, slippageR: 0 }; }
function positionRow(item) { return { positionId: text(item.trade_id || item.position_id, ""), strategyInstanceId: text(item.strategy_instance_id, "unavailable"), symbol: text(item.instrument_code, "unavailable"), side: side(item.side), quantity: number(item.quantity_open, 0), averagePrice: number(item.entry_price, 0), riskR: number(item.risk_R ?? item.risk_r, 0), pnlR: number(item.realized_R ?? item.pnl_R ?? item.result_R, 0), protectionStatus: protectionState(item.protection_status) }; }
function providerRows(execution) { return rows(execution?.providers).filter((item) => item?.provider_id).map((item) => ({ providerId: text(item.provider_id, ""), label: text(item.label || item.provider_id, "Provider"), mode: executionModeState(item.mode), status: providerState(item), latencyMs: number(item.latency_ms, 0), lastHeartbeatAt: text(item.last_heartbeat_at_utc, "unavailable") })); }
function accountRow(item) { return { accountId: text(item.broker_account_id, ""), providerId: text(item.provider_id, "unavailable"), label: text(item.account_label, "Account"), mode: upper(item.mode) === "LIVE" ? "LIVE" : "PAPER", state: item.read_only ? "READ_ONLY" : "ACTIVE", netLiqUsd: number(item.capital, 0), openPositions: number(item.open_positions, 0), ordersToday: number(item.orders_today, 0) }; }
function incidentSummary(item) { return { incidentId: text(item.incident_id, ""), severity: severity(item.severity), title: text(item.title, "Incident"), detail: text(item.detail || item.message, "Incident backend"), route: `/operations/incidents/${encodeURIComponent(String(item.incident_id))}` }; }
function incidentRow(item) { return { ...incidentSummary(item), domain: text(item.domain, "operations"), status: text(item.status, "OPEN"), ageMinutes: 0, impactedOrderIds: [], correlationId: text(item.correlation_id, "none"), route: "/execution/incidents", chronology: [], reconciliationResults: [], meta: [{ label: "Source", value: text(item.domain, "operations") }], payloadPreview: [{ key: "incident_id", value: text(item.incident_id, "unknown") }], postMortem: emptyPostMortem() }; }
function emptyIncident() { return { incidentId: "none", severity: "LOW", title: "Aucun incident", detail: "Aucun incident ouvert dans la projection.", route: "/execution/incidents", chronology: [], reconciliationResults: [], meta: [], payloadPreview: [], postMortem: emptyPostMortem() }; }
function emptyPostMortem() { return { rootCause: "Aucun incident sélectionné", containment: "Aucune action requise", permanentFix: "Non applicable", ownerRole: "SYSTEM", dueAt: currentUtc() }; }
function agentRow(item) { return { agentId: text(item.worker_id || item.task_id, ""), name: text(item.worker_id, "Agent runtime"), role: text(item.task_type, "agent-runtime"), status: upper(item.status) === "READY" ? "WAITING" : upper(item.status) === "FAILED" ? "FAILED" : "ACTIVE", missionId: text(item.mission_id, "unavailable"), task: text(item.status, "unavailable"), model: text(item.model, "unavailable"), reasoningLevel: text(item.reasoning_level, "unavailable"), queueDepth: number(item.queue_depth, 0), tokenBudgetPct: number(item.token_budget_pct, 0) }; }
function researchExperimentRow(item) { const reports = number(item.counts?.evaluation_reports, 0); return { experimentId: text(item.research_experiment_id, ""), missionId: text(item.metadata?.mission_id, "unavailable"), runId: text(item.winner_simulation_run_id, "unavailable"), title: text(item.name, "Expérience recherche"), hypothesis: text(item.objective, "Hypothèse non publiée"), ownerAgent: text(item.owner, "unavailable"), stage: stageFromResearch(item), status: statusFromResearch(item), progressPct: researchProgress(item, Array.from({ length: reports }), []), score: number(item.metadata?.score, 0), eta: "unavailable", currentTask: text(item.comparison_metric, "unavailable"), expectedEvent: text(item.expected_event, "unavailable"), tokenBudgetPct: number(item.token_budget_pct, 0), computeBudgetPct: number(item.compute_budget_pct, 0) }; }
function researchPipelineRows({ experiments, reports, candidates }) { return ["IDEA", "BASELINE", "ITERATION", "ROBUSTNESS", "OOS", "PAPER_READY"].map((stage) => ({ stageId: stage, label: stage.replace("_", " "), state: pipelineState(stage, { experiments, reports, candidates }), activeExperiments: countBy(experiments, (item) => item.stage === stage), promoted: countBy(candidates, (item) => upper(item.status) === "PROMOTION_READY"), rejected: countBy(candidates, (item) => upper(item.status) === "REJECTED"), budgetUsedPct: stage === "BASELINE" ? Math.min(100, reports.length * 25) : 0 })); }
function researchCoverageRows(dataFoundation) { return rows(dataFoundation).filter((item) => item?.dataset_id).map((item) => ({ coverageId: text(item.dataset_id, ""), label: text(item.name || item.dataset_key, "Dataset"), coveragePct: upper(item.status) === "READY" ? 100 : number(item.coverage_pct, 0), detail: `${text(item.dataset_key, "dataset")} · ${timeLabel(item.cutoff_utc)}`, quality: upper(item.status) === "READY" ? "OK" : "WATCH" })); }
function researchDatasetRow(item) { return { datasetId: text(item.dataset_id, ""), label: text(item.name || item.dataset_key, "Dataset"), lineage: text(item.provenance_hash, "unavailable"), coverage: `${text(item.time_range_start_utc, "unavailable").slice(0, 10)} → ${text(item.time_range_end_utc, "unavailable").slice(0, 10)}`, pointInTime: Boolean(item.cutoff_utc), quality: upper(item.status) === "READY" ? "OK" : "WATCH" }; }
function researchResultRow(report) { const metrics = report.metrics || report.metric_snapshot || {}; const decision = upper(report.verdict) === "PASS" ? "PROMOTED" : upper(report.verdict) === "FAIL" ? "REJECTED" : "REVIEW"; return { resultId: text(report.research_evaluation_report_id, ""), experimentId: text(report.research_experiment_id, "unavailable"), strategyId: text(report.research_candidate_id, "unavailable"), title: text(report.report_kind, "Validation"), decision, oosR: number(metrics.total_r, 0), sharpe: number(metrics.sharpe_r, 0), robustnessScore: Math.round(number(report.score, 0) * 100), decidedAt: text(report.created_at_utc, "unavailable") }; }
function researchKnowledgeGraph(research) { const summary = research?.knowledge_graph?.summary || {}; return { clusters: [{ clusterId: "research_graph", label: "Candidats stratégie", experiments: number(summary.nodes || rows(research?.experiments).length, 0), similarityPct: 0, signal: "NOVEL" }], strongestLink: text(research?.knowledge_graph?.graph_hash, "—"), noveltyScore: 50 }; }
function researchBootstrapAction(actor) { const allowed = permissions(actor).some((item) => item.capability === "front.command" && item.allowed); return { actionId: "act_research_bootstrap_demo_paper", label: "Amorcer backtest 1 mois", commandType: "research.bootstrap_demo_paper", permission: allowed ? "ALLOWED" : "DENIED", requiresConfirmation: true, impactSummary: allowed ? "Crée dataset, stratégie seed, simulation 1 mois, candidate research et tâche agent." : "Session opérateur desk.write requise.", payload: { symbol_code: "MNQ1!", instrument: "MNQ", timeframe: "5", start_utc: "2026-06-01T00:00:00.000Z", end_utc: "2026-07-01T00:00:00.000Z", dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01" } }; }
function researchLabComputeRow(item) { return { jobId: text(item.simulation_run_id || item.simulationRunId, ""), missionId: text(item.metadata?.mission_id, "unavailable"), label: `Simulation ${text(item.source_run_id || item.status, "research")}`, status: terminalSimulation(item.status) ? "DONE" : computeState(item.status) === "RUNNING" ? "RUNNING" : "QUEUED", progressPct: terminalSimulation(item.status) ? 100 : number(item.progress_pct, 0), worker: text(item.worker_id, "unavailable"), eta: text(item.eta, "unavailable"), costUsd: number(item.cost_usd, 0) }; }
function simulationComputeJobRow(item) { return { jobId: text(item.simulation_run_id || item.simulationRunId, ""), missionId: text(item.metadata?.mission_id, "unavailable"), experimentId: text(item.metadata?.research_experiment_id, undefined), runId: text(item.simulation_run_id || item.simulationRunId, undefined), label: `Simulation ${text(item.source_run_id || item.status, "research")}`, state: computeState(item.status), priority: text(item.priority, "NORMAL"), poolId: text(item.pool_id, "unavailable"), workerId: text(item.worker_id, "unavailable"), requestedVcpu: number(item.requested_vcpu, 0), requestedMemoryGb: number(item.requested_memory_gb, 0), allocatedVcpu: number(item.allocated_vcpu, 0), allocatedMemoryGb: number(item.allocated_memory_gb, 0), progressPct: terminalSimulation(item.status) ? 100 : number(item.progress_pct, 0), eta: text(item.eta, "unavailable"), retryCount: number(item.retry_count, 0), maxRetries: number(item.max_retries, 0), startedAt: text(item.started_at_utc || item.startedAt, undefined), expectedEvent: text(item.expected_event, "unavailable"), errorCode: text(item.failure_code, undefined) }; }
function researchDataCatalogDatasetRow(item) { const metadata = item.metadata || {}; return { datasetId: text(item.dataset_id, ""), label: text(item.name || item.dataset_key, "Dataset"), instruments: metadata.instrument ? [metadata.instrument] : [], instrument: text(metadata.instrument, "UNKNOWN"), granularity: text(metadata.timeframe, "mixed"), period: `${text(item.time_range_start_utc, "—").slice(0, 10)} → ${text(item.time_range_end_utc, "—").slice(0, 10)}`, source: text(item.source || metadata.source, "unavailable"), provenance: text(item.provenance_hash, "—"), quality: upper(item.status) === "READY" ? "OK" : "WATCH", freshness: text(item.cutoff_utc, "—"), pointInTime: Boolean(item.cutoff_utc), lookaheadStatus: item.cutoff_utc ? "PASS" : "WATCH", version: text(item.schema_version, "dataset_v1"), gaps: number(item.gaps, 0), timezone: text(metadata.timezone, "Europe/Paris"), rolloverPolicy: text(metadata.rollover_policy, "unavailable") }; }
function researchInstruments(datasets) { return [...new Set(datasets.map((item) => item.instrument).filter(Boolean))].map((instrument) => { const primary = datasets.find((item) => item.instrument === instrument); return { symbol: instrument, assetClass: "FUTURES", primaryDatasetId: primary?.datasetId || "dataset_unknown", sessionTemplate: "full_day", timezone: "Europe/Paris", rollover: "continuous", nextRollover: "—", coveragePct: primary?.quality === "OK" ? 100 : 50, quality: primary?.quality || "WATCH" }; }); }
function researchLineage(datasets) { return datasets.map((dataset) => ({ edgeId: `edge_${dataset.datasetId}`, from: "market_candles", to: dataset.datasetId, relation: "BUILDS", status: dataset.quality === "OK" ? "OK" : "WATCH" })); }
function dataCatalogIncident(item) { return { incidentId: text(item.incident_id, ""), datasetId: text(item.dataset_id, "unavailable"), severity: severity(item.severity), title: text(item.title, "Incident data"), status: text(item.status, "OPEN"), retryable: item.retryable === true }; }
function researchComputePools(jobs) { return [{ poolId: "research-cpu", label: "Research CPU", mode: "RESEARCH", status: "ACTIVE", capacityVcpu: 2, capacityMemoryGb: 4, usedPct: Math.min(100, jobs.length * 10), reservedForLivePct: 0, runningJobs: countBy(jobs, (item) => item.state === "RUNNING"), queuedJobs: countBy(jobs, (item) => item.state === "QUEUED") }, { poolId: "live-reserve", label: "LIVE Reserve", mode: "LIVE_RESERVED", status: "ACTIVE", capacityVcpu: 2, capacityMemoryGb: 4, usedPct: 0, reservedForLivePct: 50, runningJobs: 0, queuedJobs: 0 }]; }
function researchComputeWorkerRow(item) { return { workerId: text(item.worker_id || item.task_id, ""), poolId: text(item.pool_id, "unavailable"), kind: ["CPU", "GPU"].includes(upper(item.kind)) ? upper(item.kind) : "LLM_ORCHESTRATOR", status: upper(item.status) === "READY" ? "WAITING" : upper(item.status) === "FAILED" ? "DEGRADED" : "RUNNING", currentJobId: text(item.task_id, undefined), heartbeatAt: text(item.updated_at_utc || item.created_at_utc, "unavailable"), cpuPct: number(item.cpu_pct, 0), memoryPct: number(item.memory_pct, 0), gpuPct: number(item.gpu_pct, 0), costUsdHour: number(item.cost_usd_hour, 0) }; }
function researchReservations() { return [{ reservationId: "reserve_live_default", label: "LIVE protected capacity", poolId: "live-reserve", scope: "LIVE", reservedPct: 50, active: true, reason: "Les jobs research ne doivent pas affamer le live." }]; }
function strategyRow(item) {
  const strategyId = text(item.strategy_definition_id || item.strategy_id, "none");
  return {
    strategyId,
    strategyDefinitionId: strategyId,
    strategyVersionId: text(item.strategy_version_id, "none"),
    strategyInstanceId: text(item.strategy_instance_id, "none"),
    runtimeBundleId: text(item.runtime_bundle_id, "none"),
    name: text(item.name || item.label, "Aucune stratégie"),
    family: strategyFamily(item.family),
    instruments: Array.isArray(item.instruments) ? item.instruments.map(String) : [],
    timeframe: text(item.timeframe, "—"),
    scientificStatus: "CANDIDATE",
    versionStatus: "DRAFT",
    runtimeStatus: "STOPPED",
    executionMode: "SHADOW",
    tier: "WATCH",
    expectancyR: 0,
    profitFactor: 0,
    winRatePct: 0,
    maxDrawdownR: 0,
    liveHealth: "OFF",
    lifecycle: "DRAFT",
    lastOosR: 0,
  };
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function runtimeState(value) {
  const state = upper(value);
  if (state === "RUNNING") return "RUNNING";
  if (state === "STARTING") return "STARTING";
  if (state === "PAUSED") return "PAUSED";
  if (state === "FAILED") return "FAILED";
  return "STOPPED";
}

function executionModeState(value) {
  const mode = upper(value);
  if (mode === "LIVE") return "LIVE";
  if (mode === "PAPER") return "PAPER";
  return "SHADOW";
}

function versionStatus(value) {
  const status = upper(value);
  if (["VALIDATED", "REJECTED", "DEPRECATED", "RETIRED"].includes(status)) return status;
  return "DRAFT";
}

function scientificStatus(value) {
  const status = upper(value);
  if (["VALIDATED", "REJECTED", "WATCHLIST"].includes(status)) return status;
  return "CANDIDATE";
}

function strategyTier(value) {
  const tier = upper(value);
  return ["TIER_1", "TIER_2", "TIER_3"].includes(tier) ? tier : "WATCH";
}

function signalState(value) {
  const state = upper(value);
  return ["NEW", "ARBITRATED", "REJECTED", "ORDERED", "FILLED", "EXPIRED"].includes(state) ? state : "NEW";
}

function strategySpecProjection(source = {}) {
  const spec = source && typeof source === "object" ? source : {};
  return {
    entryModel: text(spec.entry_model || spec.entryModel, "unavailable"),
    stopModel: text(spec.stop_model || spec.stopModel, "unavailable"),
    targetModel: text(spec.target_model || spec.targetModel, "unavailable"),
    invalidationModel: text(spec.invalidation_model || spec.invalidationModel, "unavailable"),
    riskModel: text(spec.risk_model || spec.riskModel, "unavailable"),
    rules: rows(spec.rules).map((rule, index) => ({
      ruleId: text(rule.rule_id || rule.ruleId, `rule_${index + 1}`),
      label: text(rule.label || rule.name, `Règle ${index + 1}`),
      type: strategyRuleType(rule.type),
      expression: text(rule.expression || rule.predicate, "unavailable"),
      state: upper(rule.state) === "DISABLED" ? "DISABLED" : upper(rule.state) === "WATCH" ? "WATCH" : "ACTIVE",
      weightPct: number(rule.weight_pct ?? rule.weightPct, 0),
    })),
    levels: rows(spec.levels).map((level, index) => ({
      levelId: text(level.level_id || level.levelId, `level_${index + 1}`),
      label: text(level.label || level.name, `Niveau ${index + 1}`),
      lower: number(level.lower, 0),
      upper: number(level.upper, 0),
      role: strategyLevelRole(level.role),
    })),
  };
}

function strategyRuleType(value) {
  const type = upper(value);
  return ["ENTRY", "FILTER", "RISK", "EXIT", "INVALIDATION"].includes(type) ? type : "FILTER";
}

function strategyLevelRole(value) {
  const role = upper(value);
  return ["ENTRY_ZONE", "STOP", "TARGET", "INVALIDATION"].includes(role) ? role : "ENTRY_ZONE";
}

function strategyVersionRow(item) {
  const metrics = item.metrics || item.metadata?.metrics || {};
  return {
    strategyVersionId: String(item.strategy_version_id),
    label: text(item.version_label || item.label, String(item.strategy_version_id)),
    status: versionStatus(item.status),
    createdAt: text(item.created_at || item.created_at_utc, "unavailable"),
    sourceRunId: text(item.source_run_id || item.metadata?.source_run_id, "unavailable"),
    expectancyR: number(metrics.expectancy_r, 0),
    maxDrawdownR: number(metrics.max_drawdown_r, 0),
    changeSummary: text(item.metadata?.change_summary, "Aucun résumé publié."),
  };
}

function strategyInstanceRow(item) {
  return {
    strategyInstanceId: String(item.strategy_instance_id),
    strategyVersionId: text(item.strategy_version_id, "unavailable"),
    runtimeBundleId: text(item.runtime_bundle_id || item.metadata?.runtime_bundle_id, "unavailable"),
    mode: executionModeState(item.execution_mode),
    runtimeStatus: runtimeState(item.runtime_state || item.status),
    account: text(item.account_scope, "unavailable"),
    riskAllocationPct: number(item.risk_allocation_pct || item.metadata?.risk_allocation_pct, 0),
    lastHeartbeatAt: text(item.last_heartbeat_at, "unavailable"),
  };
}

function performanceBucket(scope, metrics = {}) {
  return {
    scope,
    trades: number(metrics.trade_count, 0),
    netR: number(metrics.total_r, 0),
    expectancyR: number(metrics.expectancy_r, 0),
    profitFactor: number(metrics.profit_factor, 0),
    winRatePct: number(metrics.win_rate_pct, 0),
    maxDrawdownR: number(metrics.max_drawdown_r, 0),
    parityPct: number(metrics.live_parity_pct, 0),
  };
}

function hasSignalId(item) {
  return Boolean(item?.signal_outbox_id || item?.signal_id) && ["LONG", "SHORT"].includes(upper(item?.direction || item?.side));
}
function hasTradeId(item) { return Boolean(item?.trade_id || item?.position_id); }
function hasOrderId(item) {
  return Boolean(item?.broker_order_id || item?.order_id) && ["BUY", "SELL"].includes(upper(item?.side));
}
function hasIntentId(item) { return Boolean(item?.intent_id || item?.order_intent_id); }
function hasFillId(item) { return Boolean(item?.fill_id); }
function hasIncidentId(item) { return Boolean(item?.incident_id); }

function runtimeMissionState(value) {
  const state = upper(value);
  if (["COMPLETED", "DONE", "SUCCEEDED"].includes(state)) return "DONE";
  if (["BLOCKED", "NEEDS_OPERATOR", "FAILED"].includes(state)) return "BLOCKED";
  if (["READY", "WAITING", "QUEUED"].includes(state)) return "WAITING";
  return "RUNNING";
}

function orderType(value) {
  const type = upper(value);
  return ["MARKET", "STOP_LIMIT"].includes(type) ? type : "LIMIT";
}

function orderState(value) {
  const state = upper(value);
  return ["INTENT", "SENT", "ACKED", "PARTIAL", "FILLED", "CANCELLED", "REJECTED"].includes(state) ? state : "INTENT";
}

function protectionState(value) {
  const state = upper(value);
  if (state === "PROTECTED") return "PROTECTED";
  if (state === "UNPROTECTED") return "UNPROTECTED";
  return "PENDING";
}

function providerState(item) {
  const state = upper(item.status || item.health);
  if (item.enabled === false || ["DOWN", "DISCONNECTED", "FAILED"].includes(state)) return "DOWN";
  if (["DEGRADED", "STALE", "WATCH"].includes(state)) return "DEGRADED";
  return "OK";
}

function orderProtectionRate(activeOrders) {
  if (!activeOrders.length) return 0;
  return Math.round(countBy(activeOrders, (item) => item.protectionStatus === "PROTECTED") / activeOrders.length * 100);
}

function strategyTradeRow(item) {
  return {
    tradeId: String(item.trade_id || item.position_id),
    signalId: text(item.signal_id, "unavailable"),
    symbol: text(item.instrument_code || item.symbol, "unavailable"),
    side: side(item.side) === "SHORT" ? "SHORT" : "LONG",
    openedAt: text(item.opened_at_utc || item.entry_at_utc, "unavailable"),
    closedAt: text(item.closed_at_utc || item.exit_at_utc, "unavailable"),
    pnlR: number(item.realized_R ?? item.pnl_R ?? item.result_R, 0),
    exitReason: text(item.exit_reason, "unavailable"),
  };
}

function strategyIncidentRow(item) {
  return {
    incidentId: String(item.incident_id),
    severity: severity(item.severity),
    status: ["ACKED", "RESOLVED"].includes(upper(item.status)) ? upper(item.status) : "OPEN",
    title: text(item.title, "Incident"),
    detail: text(item.detail || item.message, "Détail indisponible"),
  };
}

function compareVersionRow(item, role) {
  return {
    role,
    strategyVersionId: String(item.strategy_version_id),
    runtimeBundleId: text(item.runtime_contract_bundle_version || item.metadata?.runtime_bundle_id, "unavailable"),
    label: text(item.version_label, String(item.strategy_version_id)),
    status: versionStatus(item.status),
    sourceRunId: text(item.source_run_id || item.metadata?.source_run_id, "unavailable"),
    createdAt: text(item.created_at || item.created_at_utc, "unavailable"),
  };
}

function experimentDetailStatus(value) {
  const status = upper(value);
  if (["COMPLETED", "PASSED", "PROMOTION_READY"].includes(status)) return "PASSED";
  if (["FAILED", "REJECTED", "CANCELLED"].includes(status)) return "FAILED";
  if (status === "ARCHIVED") return "ARCHIVED";
  if (status === "DRAFT") return "WAITING";
  if (status === "CANDIDATE") return "CANDIDATE";
  return "RUNNING";
}

function researchProgress(source, reports, runs) {
  if (["COMPLETED", "PASSED", "PROMOTION_READY"].includes(upper(source.status))) return 100;
  if (reports.length) return 75;
  if (runs.length) return 50;
  return 25;
}

function researchExperimentDatasetRow(item) {
  return {
    datasetId: String(item.dataset_id),
    label: text(item.name || item.dataset_key, String(item.dataset_id)),
    hash: text(item.provenance_hash || item.dataset_hash, "unavailable"),
    coverage: `${text(item.time_range_start_utc, "unavailable")} → ${text(item.time_range_end_utc, "unavailable")}`,
    quality: upper(item.status) === "READY" ? "OK" : upper(item.status) === "FAILED" ? "FAILED" : "WATCH",
    pointInTime: Boolean(item.cutoff_utc),
  };
}

function researchExperimentSpec(experiment, candidate = {}) {
  const metadata = candidate?.metadata || experiment?.metadata || {};
  return {
    strategyId: text(candidate?.strategy_definition_id || experiment?.strategy_definition_id, "unavailable"),
    strategyVersionId: text(candidate?.strategy_version_id, "unavailable"),
    specId: text(candidate?.deterministic_plan_ref || metadata.strategy_spec_id, "unavailable"),
    instrument: text(metadata.instrument, "unavailable"),
    timeframe: text(metadata.timeframe, "unavailable"),
    entryModel: text(metadata.entry_model, "unavailable"),
    riskModel: text(metadata.risk_model, "unavailable"),
    invariants: stringList(metadata.invariants),
  };
}

function researchCandidateVersionRow(item) {
  return {
    versionId: text(item.strategy_version_id || item.research_candidate_id, "unavailable"),
    label: text(item.candidate_key || item.primary_change_summary, "Candidate"),
    parentVersionId: text(item.metadata?.parent_strategy_version_id, undefined),
    createdAt: text(item.created_at_utc, "unavailable"),
    change: text(item.primary_change_summary, "Aucun résumé publié."),
    status: upper(item.status) === "REJECTED" ? "REJECTED" : upper(item.status) === "PROMOTION_READY" ? "ACTIVE" : "CANDIDATE",
  };
}

function reportVerdict(value) {
  const verdict = upper(value);
  if (["PASS", "PASSED", "PROMOTED"].includes(verdict)) return "PASS";
  if (["FAIL", "FAILED", "REJECTED"].includes(verdict)) return "FAIL";
  return "WATCH";
}

function researchIterationRow(item) {
  const metrics = item.metrics || item.metric_snapshot || {};
  return {
    iterationId: String(item.research_evaluation_report_id),
    at: text(item.created_at_utc, "unavailable"),
    stage: text(item.report_kind, "EVALUATION"),
    result: reportVerdict(item.verdict),
    metricR: number(metrics.total_r, 0),
    note: text(item.rationale || item.summary, "Rapport backend sans commentaire."),
  };
}

function researchSegmentRows(item) {
  const metrics = item.metrics || item.metric_snapshot || {};
  return [{
    segmentId: `${item.research_evaluation_report_id}_overall`,
    label: text(item.report_kind, "Overall"),
    trades: number(metrics.trade_count, 0),
    pnlR: number(metrics.total_r, 0),
    sharpe: number(metrics.sharpe_r ?? metrics.sharpe, 0),
    maxDrawdownR: number(metrics.max_drawdown_r, 0),
    verdict: reportVerdict(item.verdict),
  }];
}

function researchJournalRow(item, index) {
  return {
    journalId: text(item.journal_id || item.event_id, `journal_${index + 1}`),
    at: text(item.at || item.created_at_utc, "unavailable"),
    level: upper(item.level) === "ERROR" ? "ERROR" : upper(item.level) === "WARN" ? "WARN" : "INFO",
    message: text(item.message, "Entrée sans message."),
  };
}

function researchRunStatus(value) {
  const status = upper(value);
  if (status === "COMPLETED") return "COMPLETED";
  if (["FAILED", "REJECTED", "CANCELLED"].includes(status)) return "FAILED";
  if (status === "RUNNING") return "RUNNING";
  return "QUEUED";
}

function objectEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item)).map(([key, item]) => ({ key, value: item }));
}

function numericList(value) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function runMetricSummary(metrics, trades) {
  return {
    totalR: number(metrics.total_r, 0),
    maxDrawdownR: number(metrics.max_drawdown_r, 0),
    trades: number(metrics.trade_count, trades.length),
    winRatePct: number(metrics.win_rate_pct, 0),
    profitFactor: number(metrics.profit_factor, 0),
    sharpe: number(metrics.sharpe_r ?? metrics.sharpe, 0),
    avgMaeR: number(metrics.avg_mae_r, 0),
    avgMfeR: number(metrics.avg_mfe_r, 0),
    slippageR: number(metrics.slippage_r, 0),
    costR: number(metrics.cost_r, 0),
  };
}

function benchmarkVerdict(value) {
  const verdict = upper(value);
  if (verdict === "BETTER") return "BETTER";
  if (verdict === "WORSE") return "WORSE";
  return "MIXED";
}

function researchRunTradeRow(item) {
  return {
    tradeId: String(item.trade_id || item.position_id),
    openedAt: text(item.opened_at_utc || item.entry_at_utc, "unavailable"),
    closedAt: text(item.closed_at_utc || item.exit_at_utc, "unavailable"),
    symbol: text(item.instrument_code || item.symbol, "unavailable"),
    side: side(item.side) === "SHORT" ? "SHORT" : "LONG",
    entry: number(item.entry_price, 0),
    exit: number(item.exit_price, 0),
    pnlR: number(item.realized_R ?? item.pnl_R ?? item.result_R, 0),
    maeR: number(item.mae_R ?? item.mae_r, 0),
    mfeR: number(item.mfe_R ?? item.mfe_r, 0),
    regime: text(item.regime, "unavailable"),
  };
}
function identity() { return { signalId: "none", strategyId: "none", strategyDefinitionId: "none", strategyVersionId: "none", strategyInstanceId: "none", runtimeBundleId: "none", sessionId: "none", correlationId: "none", featureSnapshotId: "none", expectedVersion: "0" }; }
function selectById(items, requestedId, idOf, errorCode) {
  if (!requestedId) throw codedError(`${errorCode}_ID_REQUIRED`, "Resource identifier is required.", 400);
  const candidate = items.find((item) => String(idOf(item)) === String(requestedId));
  if (!candidate) throw codedError(errorCode, `Unknown resource: ${requestedId}`, 404);
  return candidate;
}
async function safeSource(label, promise, warnings, timeoutMs = FRONT_SOURCE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(codedError("FRONT_SOURCE_TIMEOUT", `${label} exceeded ${timeoutMs} ms`, 504)), timeoutMs); timer.unref?.(); }),
    ]);
  } catch (error) {
    warnings.push(`${label}:${error?.code || error?.message || "unavailable"}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function cachedSource(store, label, query, factory, ttlMs = FRONT_SOURCE_CACHE_TTL_MS) {
  if (!store || (typeof store !== "object" && typeof store !== "function")) return Promise.resolve().then(factory);
  let cache = sourceCacheByStore.get(store);
  if (!cache) { cache = new Map(); sourceCacheByStore.set(store, cache); }
  const key = `${label}:${JSON.stringify(Object.entries(query || {}).sort(([left], [right]) => left.localeCompare(right)))}`;
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  const promise = Promise.resolve().then(factory).catch((error) => { cache.delete(key); throw error; });
  cache.set(key, { expiresAt: now + Math.max(0, ttlMs), promise });
  return promise;
}
async function call(store, method, args) { if (typeof store?.[method] !== "function") throw codedError("FRONT_CONTROL_PLANE_SOURCE_UNAVAILABLE", `${method} unavailable`, 503); return store[method](args); }
function rows(value) { return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : []; }
function firstRow(value) { return rows(value)[0] || null; }
function viewAvailability(warnings, sources) {
  if (!warnings.length) return "AVAILABLE";
  const unavailableSources = sources.filter((source) => warnings.some((warning) => warning.startsWith(`${source}:`)));
  return sources.length > 0 && unavailableSources.length === sources.length ? "UNAVAILABLE" : "PARTIAL";
}
function countBy(value, predicate) { return rows(value).filter(predicate).length; }
function firstNumber(value, key) { const found = rows(value).map((item) => number(item?.[key], null)).find((item) => item !== null); return found || 0; }
function average(values) { const finite = values.filter((item) => Number.isFinite(item)); return finite.length ? Math.round(finite.reduce((a, b) => a + b, 0) / finite.length) : 0; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullableNumber(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function requiredQuery(query, key, code) { const value = text(query?.[key] ?? query?.[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)], ""); if (!value) throw codedError(code, `${key} is required`, 400); return value; }
function queryList(value) { return Array.isArray(value) ? value.map(String).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function signedNumber(value) { const parsed = number(value, 0); return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(2)}`; }
function metric(label, value) { return { label, value: String(value) }; }
function fact(label, value) { return { label, value: value === null || value === undefined || value === "" ? "—" : String(value) }; }
function objectFacts(source, keys) { return keys.filter((key) => source?.[key] !== undefined && typeof source[key] !== "object").map((key) => fact(key.replaceAll("_", " "), source[key])); }
function explorerItem({ id, title, subtitle, status, primary, secondary, route, tags = [], facts = [] }) { return { id: text(id, "unavailable"), title: text(title, "Objet sans titre"), subtitle: text(subtitle, "Détail non publié"), status: text(status, "UNKNOWN"), primary: text(primary, "—"), secondary: text(secondary, "—"), route: route || null, tags: tags.filter(Boolean).map(String), facts }; }
function explorerView(title, description, items, metrics = []) { return { summary: { title, description, total: items.length, metrics }, items }; }
function replayExplorerItem(item) { return explorerItem({ id: item.sourceId || item.id, title: item.name || `Replay ${item.tradingDate || ""}`, subtitle: `${text(item.tradingDate, "—")} · ${text(item.session, "—")} · ${number(item.progress, 0)}%`, status: item.status, primary: `${signedNumber(item.metrics?.totalR)} R`, secondary: item.resultEligible ? "Résultat éligible" : "Résultat non éligible", route: `/replay/runs/${encodeURIComponent(String(item.sourceId || item.id))}`, tags: [item.engineVersion, item.variantId, item.replayClassification] }); }
function performanceDayItem(item) { return explorerItem({ id: item.date, title: text(item.date, "Journée"), subtitle: `${number(item.trades, 0)} trades · ${number(item.winRate, 0).toFixed(1)}% win`, status: number(item.totalR, 0) > 0 ? "POSITIVE" : number(item.totalR, 0) < 0 ? "NEGATIVE" : "FLAT", primary: `${signedNumber(item.totalR)} R`, secondary: `${signedNumber(item.drawdownR)} R drawdown`, route: `/performance/days/${encodeURIComponent(String(item.date))}`, tags: [...rows(item.sessions), ...rows(item.strategyIds)] }); }
function performanceTradeItem(item, index = 0) { return explorerItem({ id: item.tradeId || item.trade_id || item.positionId || `trade-${index + 1}`, title: `${text(item.instrument || item.instrument_code || item.symbol, "Trade")} · ${text(item.direction || item.side, "—")}`, subtitle: text(item.closedAt || item.closed_at_utc || item.exit_at_utc || item.openedAt || item.opened_at_utc, "Horodatage indisponible"), status: number(item.resultR ?? item.realized_R ?? item.pnlR, 0) > 0 ? "WIN" : number(item.resultR ?? item.realized_R ?? item.pnlR, 0) < 0 ? "LOSS" : "FLAT", primary: `${signedNumber(item.resultR ?? item.realized_R ?? item.pnlR)} R`, secondary: text(item.exitReason || item.exit_reason, "Sortie non publiée"), route: item.positionId || item.position_id ? `/execution/portfolio/positions/${encodeURIComponent(String(item.positionId || item.position_id))}` : undefined, tags: [item.strategyId || item.strategy_id, item.session] }); }
function upper(value) { return String(value ?? "").toUpperCase(); }
function availabilityStatus(value) { return value ? "OK" : "DEGRADED"; }
function stageFromResearch(item) { const status = upper(item.status); if (status === "COMPLETED") return "PAPER_READY"; if (number(item.counts?.evaluation_reports, 0) > 0) return "OOS"; return "BASELINE"; }
function statusFromResearch(item) { const status = upper(item.status); if (status === "COMPLETED") return "PASSED"; if (status === "CANCELLED" || status === "ARCHIVED") return "REJECTED"; if (status === "DRAFT") return "WAITING"; return "RUNNING"; }
function pipelineState(stage, { experiments, reports, candidates }) { if (stage === "IDEA") return experiments.length ? "DONE" : "WAITING"; if (stage === "BASELINE") return reports.length ? "DONE" : (experiments.length ? "RUNNING" : "WAITING"); if (stage === "PAPER_READY") return countBy(candidates, (item) => upper(item.status) === "PROMOTION_READY") ? "DONE" : "WAITING"; return reports.length ? "WAITING" : "WAITING"; }
function computeState(status) { const normalized = upper(status); if (normalized === "COMPLETED") return "COMPLETED"; if (normalized === "FAILED" || normalized === "REJECTED") return "FAILED"; if (normalized === "RUNNING") return "RUNNING"; return "QUEUED"; }
function terminalSimulation(status) { return ["COMPLETED", "FAILED", "REJECTED", "CANCELLED", "REVIEW_REQUIRED"].includes(upper(status)); }
function isActiveExecutionMode(item) { return ["LIVE", "PAPER", "SHADOW"].includes(upper(item.execution_mode)); }
function isCriticalSeverity(item) { return ["CRITICAL", "HIGH"].includes(upper(item.severity)); }
function isPendingCommandStatus(item) { return ["pending_approval", "approved", "queued"].includes(String(item.status)); }
function riskCapitalStatus(risk) { if (!risk?.summary) return "STOP"; return risk.summary.status === "CONTROLLED" ? "NORMAL" : "WATCH"; }
function side(value) { const normalized = upper(value); if (normalized.includes("SHORT") || normalized === "SELL") return "SHORT"; if (normalized.includes("LONG") || normalized === "BUY") return "LONG"; return "FLAT"; }
function severity(value) { const normalized = upper(value); if (normalized === "CRITICAL") return "HIGH"; return ["LOW", "MEDIUM", "HIGH"].includes(normalized) ? normalized : "LOW"; }
function strategyFamily(value) { const normalized = String(value || "").toLowerCase(); if (normalized.includes("mean")) return "Mean Reversion"; if (normalized.includes("macro")) return "Macro"; if (normalized.includes("momentum")) return "Momentum"; if (normalized.includes("arbitrage")) return "Arbitrage"; return "Breakout"; }
function timeLabel(value) { return String(value || currentUtc()).slice(11, 16); }
