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
import { buildCommandCenterProjection } from "./front-command-center-projection.js";
import { livePlan } from "./front-control-plane-live-plan-projection.js";
import { liveSignalDetail } from "./front-control-plane-live-signal-projection.js";
import {
  auditRelations,
  canonicalOrderIntentDossier,
  frontAuditEvents,
  isNominalLiveSignal,
  isNominalPortfolioIntent,
  liveCanonicalRuntime,
  portfolioOrderIntentSummaryRow,
  telegramDrilldownFromHealth,
} from "./front-control-plane-domain-completeness.js";
import {
  appendLiveWarnings,
  canonicalPositionRows,
  canonicalProviderScope,
  canonicalProviderCommandRow,
  canonicalProviderFillRow,
  isCanonicalFillEvent,
  liveAssistantAdvisory,
  liveArbitrations,
  liveInstanceConfidence,
  liveLegacyHistory,
  liveMacroSession,
  livePerformanceR,
  liveReconciliation,
  liveRiskChecks,
  liveSession,
  liveSummary,
  liveTimeline as canonicalLiveTimeline,
  liveWatchlist,
  marketSessionState,
  nullableMetric,
} from "./front-live-trading-support.js";
import { executionIncidents, incidentRow, incidentSummary } from "./front-control-plane-incident-projection.js";
import { executionAuthorityMode, orderIntentReconciliation } from "./front-order-detail-support.js";
import { orderHumanGateProjection, permissions, resourceAllowedActions } from "./front-control-plane-permissions.js";
import { accountRow, activeOrderRow, fillRow, intentRow, orderFillRow, orderRow, positionRow, providerRows, signalRow } from "./front-control-plane-row-mappers.js";
import { frontTimeSeriesContracts } from "./front-control-plane-time-series-contracts.js";

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  "command-center": buildCommandCenterProjection,
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
  "replay-overview": replayOverview,
  "replay-runs": replayRunsExplorer,
  "replay-run-detail": replayRunDetailExplorer,
  "replay-compare": replayCompareExplorer,
  "performance-overview": performanceOverview,
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
  "command-center": ["execution", "strategy", "incidents", "agent-runtime", "assistant-runtime", "research", "data-foundation", "simulation-runs", "portfolio-risk", "ai-context", "performance", "health"],
  "demo-paper-readiness": ["execution", "strategy", "agent-runtime", "data-foundation", "portfolio-risk", "health"],
  "events-audit": ["execution", "strategy", "incidents", "agent-runtime"],
  "operations-queue": ["agent-runtime", "incidents"],
  "research-agent-fleet": ["agent-runtime", "research"],
  "research-compute-scheduler": ["agent-runtime", "simulation-runs"],
  "research-data-catalog": ["data-foundation"],
  "research-experiment-detail": ["research", "agent-runtime", "simulation-runs", "data-foundation"],
  "research-run-detail": ["research", "simulation-runs"],
  "research-lab": ["agent-runtime", "agent-events", "research", "data-foundation", "simulation-runs", "incidents"],
  "strategy-center": ["strategy", "performance", "strategy-promotion-lineage"],
  "strategy-detail": ["strategy", "research", "execution", "incidents"],
  "strategy-compare": ["strategy", "research", "simulation-runs"],
  "live-trading": ["execution", "strategy", "incidents", "ai-context", "portfolio-risk", "market-series", "live-market-snapshot", "live-session", "front-macro", "front-news", "assistant-runtime", "performance", "health"],
  "live-signal-detail": ["execution", "strategy", "portfolio-risk", "ai-context"],
  "order-detail": ["execution"],
  "position-detail": ["execution"],
  "incident-detail": ["incidents"],
  orders: ["execution"],
  risk: ["execution", "portfolio-risk", "strategy", "health"],
  "execution-providers": ["execution", "incidents", "health"],
  "execution-incidents": ["execution", "incidents", "agent-runtime", "runbooks"],
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
  "replay-overview": ["replays", "replay-run-full"],
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
    "agent-events": () => source("agent-events", () => call(store, "listAgentRuntimeEvents", { limit: 50 })),
    research: () => source("research", () => call(store, "getResearchLabOverview", { ...query, limit: 100 })),
    "strategy-promotion-lineage": () => UUID_PATTERN.test(String(query.strategyVersionId || ""))
      ? source("strategy-promotion-lineage", () => call(store, "getStrategyPromotionLineage", { strategyVersionId: query.strategyVersionId }))
      : Promise.resolve(null),
    "data-foundation": () => source("data-foundation", () => call(store, "listDataFoundationDatasets", { ...query, limit: 100 })),
    "simulation-runs": () => source("simulation-runs", () => call(store?.operations, "listSimulationRuns", { ...query, limit: 100 })),
    "portfolio-risk": () => source("portfolio-risk", () => buildPortfolioRiskOverviewFromStore(store, query)),
    "ai-context": () => source("ai-context", () => buildAiContextOverviewFromStore(store, query)),
    "market-series": () => source("market-series", () => call(store, "getFrontMarketSeries", query)),
    "live-market-snapshot": () => source("live-market-snapshot", () => call(store, "getFrontLiveMarketSnapshot", query)),
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
    "replay-run-full": () => query.runId
      ? source("replay-run-full", () => call(store, "getOperationsReplay", { run_id: query.runId }))
      : Promise.resolve(null),
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
    agentEvents: loaded["agent-events"] ?? null,
    research: loaded.research ?? null,
    strategyPromotionLineage: loaded["strategy-promotion-lineage"] ?? null,
    dataFoundation: loaded["data-foundation"] ?? null,
    simulationRuns: loaded["simulation-runs"] ?? null,
    risk: loaded["portfolio-risk"] ?? null,
    ai: loaded["ai-context"] ?? null,
    marketSeries: loaded["market-series"] ?? null,
    liveMarketSnapshot: loaded["live-market-snapshot"] ?? null,
    sessions: loaded.sessions ?? null,
    liveSession: loaded["live-session"] ?? null,
    macro: loaded["front-macro"] ?? null,
    news: loaded["front-news"] ?? null,
    observability: loaded.observability ?? null,
    assistantRuntime: loaded["assistant-runtime"] ?? null,
    replays: loaded.replays ?? null,
    replayDetail: loaded["replay-detail"] ?? null,
    replayRunFull: loaded["replay-run-full"] ?? null,
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

function replayOverview({ replays, replayRunFull }) {
  const summary = replays?.summary || {};
  const days = rows(replays?.days).map((day) => ({
    date: text(day.date, "unavailable"),
    status: text(day.status, "UNKNOWN"),
    sessionCount: number(day.sessionCount, 0),
    totalR: number(day.totalR, 0),
    totalProgress: number(day.totalProgress, 0),
    gptProcesses: number(day.gptProcesses, 0),
    primaryRunId: day.primaryRunId ? text(day.primaryRunId, "") : null,
    startTime: day.startTime ? text(day.startTime, "") : null,
    endTime: day.endTime ? text(day.endTime, "") : null,
  }));
  const run = replayRunFull?.run || null;
  const timeline = rows(replayRunFull?.timeline).map((item) => ({
    eventId: text(item.id, ""),
    at: text(item.at, "unavailable"),
    type: text(item.type, "EVENT"),
    layer: ["decision", "step", "gpt", "event"].includes(item.layer) ? item.layer : "event",
    title: text(item.title, "Événement"),
    detail: text(item.detail, ""),
    decision: item.decision ? text(item.decision, "") : null,
    conclusion: item.conclusion ? text(item.conclusion, "") : null,
    price: item.price == null ? null : number(item.price, 0),
    severity: item.severity ? text(item.severity, "") : null,
    stepId: item.stepId ? text(item.stepId, "") : null,
  }));
  const candles = rows(replayRunFull?.priceSeries)
    .map((point) => ({ time: text(point.time, ""), open: number(point.open, 0), high: number(point.high, 0), low: number(point.low, 0), close: number(point.close, 0) }))
    .filter((point) => point.time);
  return {
    summary: {
      executions: number(summary.executions, 0),
      days: number(summary.days, 0),
      active: number(summary.active, 0),
      totalR: number(summary.totalR, 0),
      resultEligible: number(summary.resultEligible, 0),
      gptProcesses: number(summary.gptProcesses, 0),
    },
    days,
    selectedRun: run ? {
      runId: text(run.sourceId ?? run.id, "unavailable"),
      tradingDate: text(run.tradingDate, "unavailable"),
      session: text(run.session, "unavailable"),
      strategyId: text(run.strategyId, "unavailable"),
      status: text(run.status, "UNKNOWN"),
      progress: number(run.progress, 0),
      totalR: number(nested(run, ["metrics", "totalR"]), 0),
      engineVersion: text(run.engineVersion, "unavailable"),
    } : null,
    candles,
    timeline,
    timelineCounts: {
      decision: countBy(timeline, (item) => item.layer === "decision"),
      step: countBy(timeline, (item) => item.layer === "step"),
      gpt: countBy(timeline, (item) => item.layer === "gpt"),
      event: countBy(timeline, (item) => item.layer === "event"),
    },
  };
}

function replayRunsExplorer({ replays }) {
  const items = rows(replays).map(replayExplorerItem);
  return explorerView("Runs Replay", "Chaque run conserve son moteur, sa version et son éligibilité résultat.", items, [metric("Runs", items.length), metric("En cours", items.filter((item) => ["RUNNING", "WAITING_GPT"].includes(upper(item.status))).length), metric("Terminés", items.filter((item) => upper(item.status) === "COMPLETED").length), metric("Échecs", items.filter((item) => upper(item.status) === "FAILED").length)]);
}

function replayRunDetailExplorer({ replayDetail }) {
  const run = nested(replayDetail, ["run"]) || {};
  const metrics = nested(run, ["metrics"]) || {};
  const gptProcessCount = firstValue(nested(replayDetail, ["gptProcessCount"]), rows(nested(replayDetail, ["gptProcesses"])).length);
  const timelineCount = firstValue(nested(replayDetail, ["timelineCount"]), rows(nested(replayDetail, ["timeline"])).length);
  const runId = text(firstValue(run.sourceId, run.id), "Replay");
  return explorerView("Détail Replay", text(run.name, runId), [explorerItem({
    id: text(firstValue(run.sourceId, run.id), "replay"),
    title: text(run.name, "Replay run"),
    subtitle: `${text(run.tradingDate, "—")} · ${text(run.session, "—")} · ${number(run.progress, 0)}%`,
    status: run.status,
    primary: `${signedNumber(metrics.totalR)} R`,
    secondary: `${number(gptProcessCount, 0)} processus GPT · ${number(timelineCount, 0)} événements`,
    tags: [run.engineVersion, run.replaySchemaVersion, run.variantId],
    facts: [
      fact("Moteur", run.engineVersion), fact("Contrat Master", run.masterContractVersion), fact("V4 certifié", run.v4Certified ? "Oui" : "Non"), fact("Résultat éligible", run.resultEligible ? "Oui" : "Non"), fact("Étape courante", run.currentStepId), fact("Action suivante", run.nextAction),
    ],
  })], [metric("Progression", `${number(run.progress, 0)}%`), metric("Total R", `${signedNumber(metrics.totalR)} R`), metric("GPT", number(gptProcessCount, 0)), metric("Timeline", number(timelineCount, 0))]);
}

function replayCompareExplorer({ replays, replayComparison }) {
  if (replayComparison) {
    const comparisons = rows(replayComparison?.items || replayComparison?.runs || replayComparison?.comparisons).map((item) => explorerItem({ id: item.id || item.runId, title: item.name || item.runId, subtitle: item.variant || item.strategyId, status: item.status || item.verdict, primary: item.totalR == null ? "Résultat indisponible" : `${signedNumber(item.totalR)} R`, secondary: item.deltaR == null ? "Delta indisponible" : `${signedNumber(item.deltaR)} R delta`, route: item.runId ? `/replay/runs/${encodeURIComponent(String(item.runId))}` : undefined }));
    return explorerView("Comparaison Replay", "Comparaison backend des runs sélectionnés.", comparisons, [metric("Comparés", comparisons.length)]);
  }
  const items = rows(replays).slice(0, 20).map(replayExplorerItem);
  return explorerView("Comparer Replay", "Sélectionnez au moins deux IDs dans l'URL via ?ids=runA,runB pour une comparaison backend.", items, [metric("Candidats", items.length), metric("Comparaison", "Non configurée")]);
}

function performanceOverview({ performance }) {
  const totals = performance?.totals || {};
  const risk = performance?.risk || {};
  const equity = rows(performance?.equity);
  const dailySeries = rows(performance?.dailySeries);
  const breakdowns = rows(performance?.breakdowns);
  const attribution = rows(performance?.attribution);
  const dayDrilldowns = rows(performance?.dayDrilldowns);
  const facets = performance?.facets || {};
  return {
    summary: {
      totalR: number(totals.totalR, 0),
      trades: number(totals.trades, 0),
      wins: number(totals.wins, 0),
      losses: number(totals.losses, 0),
      flats: number(totals.flats, 0),
      winRate: totals.winRate == null ? null : number(totals.winRate, 0),
      expectancyR: totals.expectancyR == null ? null : number(totals.expectancyR, 0),
      profitFactor: totals.profitFactor == null ? null : number(totals.profitFactor, 0),
      maxDrawdownR: number(risk.maxDrawdownR, 0),
      currentDrawdownR: number(risk.currentDrawdownR, 0),
      bestTradeR: risk.bestTradeR == null ? null : number(risk.bestTradeR, 0),
      worstTradeR: risk.worstTradeR == null ? null : number(risk.worstTradeR, 0),
      bestDayR: risk.bestDayR == null ? null : number(risk.bestDayR, 0),
      worstDayR: risk.worstDayR == null ? null : number(risk.worstDayR, 0),
      activeDays: number(totals.activeDays, 0),
      winningDays: number(totals.winningDays, 0),
      losingDays: number(totals.losingDays, 0),
    },
    equityCurve: equity.map((point) => ({
      sequence: number(point.sequence, 0),
      date: text(point.date, "unavailable"),
      cumulativeR: number(point.cumulativeR, 0),
      drawdownR: number(point.drawdownR, 0),
      resultR: number(point.resultR, 0),
    })),
    pnlByDay: dailySeries.map((day) => ({
      date: text(day.date, "unavailable"),
      totalR: number(day.totalR, 0),
      trades: number(day.trades, 0),
      wins: number(day.wins, 0),
      losses: number(day.losses, 0),
      winRate: day.winRate == null ? null : number(day.winRate, 0),
    })),
    breakdowns: breakdowns
      .filter((group) => ["strategy", "session", "instrument", "direction"].includes(group.dimension))
      .map((group) => ({
        dimension: performanceDimensionKey(group.dimension),
        items: rows(group.items).slice(0, 20).map((item) => ({
          label: text(item.label, "unavailable"),
          totalR: number(item.totalR, 0),
          trades: number(item.trades, 0),
          winRate: item.winRate == null ? null : number(item.winRate, 0),
        })),
      })),
    attribution: attribution.map((group) => ({
      dimension: performanceDimensionKey(group.dimension),
      items: rows(group.items).slice(0, 20).map((item) => ({
        label: text(item.label, "unavailable"),
        totalR: number(item.totalR, 0),
        trades: number(item.trades, 0),
        winRate: item.winRate == null ? null : number(item.winRate, 0),
        expectancyR: item.expectancyR == null ? null : number(item.expectancyR, 0),
        avgR: item.avgR == null ? null : number(item.avgR, 0),
        contributionPct: number(item.contributionPct, 0),
        tone: item.tone === "positive" || item.tone === "negative" ? item.tone : "neutral",
      })),
    })),
    latestTrades: [...dayDrilldowns]
      .reverse()
      .flatMap((day) => rows(day.tradeItems))
      .slice(0, 30)
      .map((trade) => ({
        tradeId: text(trade.id, "unavailable"),
        at: text(trade.at, "unavailable"),
        strategyId: trade.strategyId ? text(trade.strategyId, "") : null,
        instrument: trade.instrument ? text(trade.instrument, "") : null,
        session: trade.session ? text(trade.session, "") : null,
        direction: trade.direction ? text(trade.direction, "") : null,
        resultR: trade.resultR == null ? null : number(trade.resultR, 0),
      })),
    facets: {
      strategies: stringList(facets.strategies),
      sessions: stringList(facets.sessions),
      instruments: stringList(facets.instruments),
    },
  };
}
function performanceDimensionKey(dimension) {
  const normalized = upper(dimension);
  if (normalized === "STRATEGY") return "STRATEGY";
  if (normalized === "SESSION") return "SESSION";
  if (normalized === "INSTRUMENT") return "INSTRUMENT";
  if (normalized === "DIRECTION") return "DIRECTION";
  return "OTHER";
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
  const workflow = firstValue(nested(workflowDetail, ["workflow"]), workflowDetail, {});
  const id = text(firstValue(workflow.id, workflow.workflowId, workflow.workflow_id), "workflow");
  const steps = rows(firstValue(nested(workflowDetail, ["steps"]), workflow.steps)).map(workflowStepExplorerItem);
  return explorerView("Détail workflow", id, steps, workflowDetailMetrics(workflow, steps));
}

function eventDetailExplorer({ eventDetail }) {
  const event = firstValue(nested(eventDetail, ["event"]), eventDetail, {});
  const id = text(firstValue(event.id, event.eventId, event.event_id), "event");
  return explorerView("Détail événement", eventDetailTitle(event, id), [eventDetailItem(event, id)], eventDetailMetrics(event));
}

function workflowStepExplorerItem(step, index) {
  return explorerItem({
    id: firstValue(step.id, step.stepId, `step-${index + 1}`),
    title: firstValue(step.label, step.name, step.stepId, "Étape"),
    subtitle: firstValue(step.detail, step.message, "Détail non publié"),
    status: firstValue(step.status, step.state),
    primary: step.durationMs == null ? "Durée indisponible" : `${step.durationMs} ms`,
    secondary: firstValue(step.updatedAt, step.updated_at_utc, "Horodatage indisponible"),
  });
}
function workflowDetailMetrics(workflow, steps) {
  return [
    metric("Statut", text(workflow.status, "UNKNOWN")),
    metric("Étapes", steps.length),
    metric("Progression", `${number(workflow.progress, 0)}%`),
    metric("Total R", `${signedNumber(nested(workflow, ["metrics", "totalR"]))} R`),
  ];
}
function eventDetailTitle(event, id) { return text(firstValue(event.title, event.eventType, event.event_type), id); }
function eventDetailItem(event, id) {
  return explorerItem({
    id,
    title: text(firstValue(event.title, event.eventType, event.event_type), "Événement"),
    subtitle: text(firstValue(event.detail, event.message), "Détail non publié"),
    status: firstValue(event.status, event.severity, "RECORDED"),
    primary: text(firstValue(event.occurredAt, event.occurred_at_utc, event.created_at_utc), "Horodatage indisponible"),
    secondary: text(firstValue(event.correlationId, event.correlation_id), "Corrélation indisponible"),
    facts: objectFacts(event, Object.keys(event).slice(0, 12)),
  });
}
function eventDetailMetrics(event) {
  return [metric("Type", text(firstValue(event.eventType, event.event_type), "—")), metric("Statut", text(firstValue(event.status, event.severity), "RECORDED"))];
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
  const executionItems = rows(nested(execution, ["policies"])).map(executionPolicyExplorerItem);
  const obsPolicy = firstValue(nested(observabilityPolicy, ["policy"]), observabilityPolicy);
  const observabilityItems = observabilityPolicyItems(obsPolicy);
  const items = [...executionItems, ...observabilityItems];
  return explorerView("Policies", "Politiques réelles de risque, exécution et observabilité en lecture seule.", items, [metric("Politiques", items.length), metric("Actives", items.filter((item) => upper(item.status) === "ACTIVE").length), metric("Désactivées", items.filter((item) => upper(item.status) === "DISABLED").length)]);
}

function executionPolicyExplorerItem(item, index) {
  return explorerItem({
    id: firstValue(item.policy_id, item.id, `execution-policy-${index + 1}`),
    title: firstValue(item.name, item.policy_key, "Politique exécution"),
    subtitle: firstValue(item.description, "Politique publiée par execution overview"),
    status: firstValue(item.status, item.enabled === false ? "DISABLED" : "ACTIVE"),
    primary: text(item.revision, "Révision indisponible"),
    secondary: text(firstValue(item.updated_at_utc, item.updatedAt), "Horodatage indisponible"),
    tags: ["EXECUTION"],
  });
}
function observabilityPolicyItems(obsPolicy) {
  if (!obsPolicy || typeof obsPolicy !== "object") return [];
  return [explorerItem({
    id: text(firstValue(obsPolicy.id, obsPolicy.policyId), "observability-policy"),
    title: text(obsPolicy.name, "Politique observabilité"),
    subtitle: "Seuils, budgets et garde-fous de télémétrie",
    status: obsPolicy.enabled === false ? "DISABLED" : text(obsPolicy.status, "ACTIVE"),
    primary: text(obsPolicy.revision, "Révision indisponible"),
    secondary: text(firstValue(obsPolicy.updatedAt, obsPolicy.updated_at_utc), "Horodatage indisponible"),
    tags: ["OBSERVABILITY"],
    facts: objectFacts(obsPolicy, Object.keys(obsPolicy).slice(0, 10)),
  })];
}

function liveTrading({ execution, strategy, incidents, ai, risk, health, marketSeries, liveMarketSnapshot, liveSession: currentLiveSession, macro, news, assistantRuntime, performance: operationsPerformance, query, warnings, nowIso, actor }) {
  const executionValue = execution || {};
  const safety = executionValue.safety || {};
  const performance = executionValue.performance || {};
  const advisorySummary = (ai && ai.summary) || {};
  const scope = normalizeFrontApiScope(query);
  const signals = rows(strategy?.signals).filter(isNominalLiveSignal).filter(hasSignalId).map(signalRow);
  const nominalIntentRows = rows(executionValue.portfolioOrderIntents).filter(isNominalPortfolioIntent);
  const nominalIntentIds = new Set(nominalIntentRows.map((item) => String(item.portfolio_order_intent_id || "")).filter(Boolean));
  const portfolioOrderIntents = nominalIntentRows.map((item) => portfolioOrderIntentSummaryRow({ execution: executionValue, item, actor }));
  const provider = canonicalProviderScope(executionValue, nominalIntentIds);
  const launchGate = demoPaperLaunchGate({ health, execution: executionValue, nowIso, rows });
  const canonicalRuntime = liveCanonicalRuntime({
    execution: executionValue,
    strategy,
    ai,
    risk,
    launchGate,
    actor,
    nowIso,
    health,
  });
  const instancesWithConfidence = liveInstanceConfidence(canonicalRuntime.activeStrategyInstances, signals, nowIso);
  const arbitrations = liveArbitrations(executionValue);
  const riskChecks = liveRiskChecks(executionValue);
  appendLiveWarnings({
    execution: executionValue,
    safety,
    canonicalRuntime,
    liveSession: currentLiveSession,
    marketClosed: health?.data_readiness?.market_closed === true,
    warnings,
  });
  return {
    summary: liveSummary({ signals, intents: portfolioOrderIntents, commands: provider.commands, events: provider.events, safety, risk, performance }),
    session: liveSession({ execution: executionValue, liveSession: currentLiveSession, scope, launchGate, health, marketSeries, marketDataStatus: liveMarketDataStatus }),
    launchGate: publicLaunchGate(launchGate),
    pipeline: pipeline(executionValue, launchGate),
    canonicalRuntime: { ...canonicalRuntime, activeStrategyInstances: instancesWithConfidence },
    marketSeries: marketSeries || { availability: "UNAVAILABLE", points: [], supportedTimeframes: [], asOf: null, source: "market_candles" },
    watchlist: liveWatchlist(liveMarketSnapshot),
    macroSession: liveMacroSession({ macro, news, scope, marketSeries }),
    signals,
    arbitrations,
    riskChecks,
    portfolioOrderIntents,
    canonicalOrders: provider.commands.map(canonicalProviderCommandRow),
    canonicalFills: provider.events.filter(isCanonicalFillEvent).map(canonicalProviderFillRow),
    canonicalPositions: canonicalPositionRows(executionValue.portfolioExecutionStates).filter((item) => nominalIntentIds.has(item.portfolioOrderIntentId)),
    orders: [],
    fills: [],
    positions: [],
    legacyHistory: liveLegacyHistory(executionValue),
    providers: providerRows(execution),
    incidents: rows(incidents).filter(hasIncidentId).map(incidentSummary),
    timeline: canonicalLiveTimeline(executionValue),
    reconciliation: liveReconciliation(executionValue, nominalIntentIds),
    performanceR: livePerformanceR(operationsPerformance),
    timeSeriesContracts: frontTimeSeriesContracts({ view: "live-trading", execution: executionValue, strategy, risk, marketSeries, performance: operationsPerformance, nowIso }),
    telegramDrilldown: telegramDrilldownFromHealth(health),
    aiAdvisory: liveAssistantAdvisory({ assistantRuntime, ai, advisorySummary, nowIso }),
  };
}

function demoPaperReadiness(context) { return buildDemoPaperReadiness({ ...context, rows }); }

function portfolio({ execution, risk, nowIso, warnings }) {
  warnings.push("portfolio-attribution:NOT_IMPLEMENTED", "portfolio-correlation:NOT_IMPLEMENTED", "portfolio-equity-curve:NOT_IMPLEMENTED", "portfolio-reconciliation:PARTIAL", "portfolio-virtual-attribution:NOT_IMPLEMENTED");
  const sourceExposureRows = rows(nested(risk, ["exposures"])).filter(hasExposureIdentity);
  const exposureRows = sourceExposureRows.filter(hasExposureValue);
  if (sourceExposureRows.length && !exposureRows.length) warnings.push("portfolio-exposure-values:UNAVAILABLE");
  const trades = rows(nested(execution, ["trades"])).filter(hasTradeId).filter(isOpenPortfolioTrade);
  const summary = portfolioSummary(execution, risk, nowIso);
  if (summary.accountSnapshotStale) warnings.push("portfolio-account-snapshot:STALE");
  const positionsLong = countBy(trades, (item) => side(item.side) === "LONG");
  const positionsShort = countBy(trades, (item) => side(item.side) === "SHORT");
  const strategyIdsWithPositions = new Set(trades.map((item) => text(item.strategy_instance_id, "")).filter(Boolean));
  const humanGates = rows(nested(execution, ["humanExecutionGates"]));
  const humanGatePending = countBy(humanGates, (item) => !["CONFIRMED", "REJECTED", "EXPIRED", "CANCELLED"].includes(upper(item.status)));
  const portfolioIntents = rows(nested(execution, ["portfolioOrderIntents"]));
  const pendingOrders = countBy(portfolioIntents, (item) => ["READY", "WORKING", "PENDING", "AWAITING_MANUAL_CONFIRMATION"].includes(upper(item.status)));
  return {
    summary: { ...summary.values, positionsLong, positionsShort, strategiesWithPositions: strategyIdsWithPositions.size, humanGatePending, pendingOrders },
    summaryTruth: summary.truth,
    authoritativeState: firstValue(nested(risk, ["portfolio_state"]), null),
    accountsSummary: portfolioAccountsSummary(execution),
    equityCurve: [],
    positions: trades.map(portfolioPositionRow),
    exposureTree: exposureRows.map(portfolioExposureTreeRow),
    brokerPositions: trades.map(portfolioBrokerPositionRow),
    correlationMatrix: { instruments: exposureRows.map((item) => text(item.instrument_code, "—")).slice(0, 4), cells: [], topPair: "—", portfolioCorrelation: 0, diversificationScore: 0 },
    virtualAllocations: [],
    reconciliation: portfolioReconciliationSummary({ execution, risk, nowIso }),
    attribution: { bestContributor: "—", top3RiskPct: 0, diversificationScore: 0, items: [] },
    timeline: [],
    timeSeriesContracts: frontTimeSeriesContracts({ view: "portfolio", execution, risk, nowIso }),
  };
}

function portfolioSummary(execution = {}, risk = {}, nowIso) {
  const snapshot = latestAccountSnapshot(nested(execution, ["accountSnapshots"]));
  const equity = finiteNumber(firstValue(nested(snapshot, ["payload", "net_liquidation_value"]), nested(snapshot, ["cash_value"])));
  const unrealizedPnl = finiteNumber(firstValue(nested(snapshot, ["unrealized_pnl"]), nested(snapshot, ["payload", "unrealized_pnl"])));
  const riskPct = finiteNumber(firstValue(nested(risk, ["summary", "risk_percent"]), nested(execution, ["safety", "riskPercent"])));
  const correlatedExposurePct = finiteNumber(nested(risk, ["summary", "correlated_exposure_pct"]));
  // risk_center.{grossExposure,netExposure,dailyLoss,trailingDrawdown} are the real
  // (schema-correct) locations for these figures, but the projection that builds
  // risk_center (front-portfolio-risk-projection.js) hardcodes all four to
  // availability:"UNAVAILABLE" today - the underlying computation was never written.
  // Read the real path (so this starts working the day that gap is closed) rather
  // than a field that never existed; today it still resolves to null/unavailable.
  const grossExposureUsd = finiteNumber(nested(risk, ["risk_center", "grossExposure", "value"]));
  const netExposureUsd = finiteNumber(nested(risk, ["risk_center", "netExposure", "value"]));
  const dailyLossR = finiteNumber(nested(risk, ["risk_center", "dailyLoss", "value"]));
  const maxDrawdownR = finiteNumber(nested(risk, ["risk_center", "trailingDrawdown", "value"]));
  const openRiskUsd = finiteNumber(nested(risk, ["risk_center", "openRisk", "value"]));
  const sourceAt = isoTimestamp(nested(snapshot, ["captured_at"]), nowIso);
  const accountSnapshotStale = Boolean(snapshot) && isOlderThanSeconds(sourceAt, nowIso, number(nested(execution, ["safety", "accountSnapshotMaxAgeSeconds"]), 60));
  const values = {
    equity: equity ?? 0,
    grossExposureUsd: grossExposureUsd ?? 0,
    netExposureUsd: netExposureUsd ?? 0,
    unrealizedPnl: unrealizedPnl ?? 0,
    riskUsedPct: riskPct ?? 0,
    correlatedExposurePct: correlatedExposurePct ?? 0,
    netLiquidation: equity ?? 0,
    dailyR: dailyLossR ?? 0,
    exposureUsd: openRiskUsd ?? grossExposureUsd ?? 0,
    maxDrawdownR: maxDrawdownR ?? 0,
    openPositions: number(nested(execution, ["summary", "openTrades"]), 0),
    riskUsagePct: riskPct ?? 0,
  };
  return {
    values,
    truth: {
      equity: equity == null ? unavailableValue("Aucun snapshot de capital exploitable", "execution.accountSnapshots") : metricValue(equity, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      grossExposureUsd: grossExposureUsd == null ? unavailableValue("Exposition brute absente de l’état du risk engine", "portfolio-risk") : knownValue(grossExposureUsd, nowIso, "portfolio-risk"),
      netExposureUsd: netExposureUsd == null ? unavailableValue("Exposition nette absente de l’état du risk engine", "portfolio-risk") : knownValue(netExposureUsd, nowIso, "portfolio-risk"),
      unrealizedPnl: unrealizedPnl == null ? unavailableValue("PnL latent absent du dernier snapshot", "execution.accountSnapshots") : metricValue(unrealizedPnl, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      riskUsedPct: riskPct == null ? unavailableValue("Pourcentage de risque absent", "portfolio-risk") : knownValue(riskPct, nowIso, "portfolio-risk"),
      correlatedExposurePct: correlatedExposurePct == null ? notImplementedValue("Exposition corrélée non publiée", "portfolio.correlation") : knownValue(correlatedExposurePct, nowIso, "portfolio-risk"),
    },
    accountSnapshotStale,
  };
}

function hasExposureIdentity(item) { return Boolean(item?.exposure_id || item?.instrument_code); }
function hasExposureValue(item) { return finiteNumber(nested(item, ["value_usd"])) !== null; }
function portfolioExposureTreeRow(item) {
  return {
    id: text(firstValue(item.exposure_id, item.instrument_code), ""),
    label: text(item.instrument_code, "Instrument"),
    group: "Index",
    side: "NET",
    valueUsd: number(item.value_usd, 0),
    weightPct: number(item.weight_pct, 0),
  };
}
function portfolioAccountsSummary(execution = {}) {
  const accounts = rows(nested(execution, ["accounts"]));
  const snapshotsByAccount = new Map();
  for (const snapshot of rows(nested(execution, ["accountSnapshots"]))) {
    const accountId = text(snapshot.broker_account_id, "");
    if (!accountId) continue;
    const existing = snapshotsByAccount.get(accountId);
    if (!existing || Date.parse(snapshot.captured_at || 0) > Date.parse(existing.captured_at || 0)) snapshotsByAccount.set(accountId, snapshot);
  }
  const trades = rows(nested(execution, ["trades"])).filter(hasTradeId).filter(isOpenPortfolioTrade);
  return accounts.filter((account) => account?.broker_account_id).map((account) => {
    const accountId = text(account.broker_account_id, "");
    const snapshot = snapshotsByAccount.get(accountId) || null;
    const equity = finiteNumber(firstValue(nested(snapshot, ["payload", "net_liquidation_value"]), nested(snapshot, ["cash_value"])));
    const openPnl = finiteNumber(firstValue(nested(snapshot, ["unrealized_pnl"]), nested(snapshot, ["payload", "unrealized_pnl"])));
    return {
      accountId,
      label: text(account.account_label, accountId),
      mode: text(account.mode, "unavailable").toUpperCase(),
      equity,
      openPnl,
      openPositions: countBy(trades, (item) => text(item.broker_account_id, "") === accountId),
      asOf: snapshot ? isoTimestamp(snapshot.captured_at, null) : null,
    };
  });
}
function portfolioReconciliationSummary({ execution, risk, nowIso }) {
  return {
    status: nested(risk, ["summary", "reconciliationDivergences"]) ? "MISMATCH" : "PENDING",
    targetDeskQuantity: 0,
    brokerRealQuantity: 0,
    deltaQuantity: 0,
    asOf: nowIso,
    ordersInFlight: number(nested(execution, ["summary", "activeOrders"]), 0),
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

function eventsAudit({ execution, strategy, incidents, runtime, warnings, nowIso }) {
  const events = frontAuditEvents({ execution, strategy, incidents, runtime, nowIso });
  if (!events.length) warnings.push("events-audit-source:UNAVAILABLE");
  const correlationIds = [...new Set(events.map((item) => item.correlationId).filter((item) => item && item !== "none"))];
  const selectedCorrelationId = correlationIds[0] || "none";
  const selectedEvents = events.filter((item) => item.correlationId === selectedCorrelationId);
  return {
    summary: {
      totalEvents: events.length,
      correlations: correlationIds.length,
      authoritativeSteps: countBy(events, (item) => item.authority === "AUTHORITATIVE"),
      advisoryBranches: countBy(events, (item) => item.authority === "ADVISORY"),
      avgLatencyMs: average(events.map((item) => number(item.latencyMs, NaN))),
      exportablePayloads: countBy(events, (item) => item.payloadPreview.length > 0),
    },
    filters: {
      activeCorrelationId: selectedCorrelationId,
      domains: [...new Set(events.map((item) => item.domain))],
      statuses: [...new Set(events.map((item) => item.status))],
      windowLabel: "BFF current",
    },
    events,
    selectedCorrelation: {
      correlationId: selectedCorrelationId,
      rootEventId: selectedEvents[0]?.eventId || "none",
      authoritativePath: selectedEvents.filter((item) => item.authority === "AUTHORITATIVE").map((item) => item.eventId),
      advisoryPath: selectedEvents.filter((item) => item.authority === "ADVISORY").map((item) => item.eventId),
      totalLatencyMs: selectedEvents.reduce((sum, item) => sum + number(item.latencyMs, 0), 0),
      payloadPreview: selectedEvents.flatMap((item) => item.payloadPreview).slice(0, 20),
      logs: selectedEvents.map((item) => ({ at: item.at, domain: item.domain, status: item.status, title: item.title })),
    },
    relations: auditRelations(events),
    commandActions: [],
  };
}

function orders({ execution, warnings, actor, nowIso, query }) {
  warnings.push("orders-state-machine:NOT_IMPLEMENTED", "orders-history:NOT_IMPLEMENTED");
  const activeOrders = rows(execution?.orders).filter(hasOrderId).map(activeOrderRow);
  return { summary: { orderIntents: rows(execution?.intents).filter(hasIntentId).length, activeOrders: activeOrders.length, recentFills: rows(execution?.fills).filter(hasFillId).length, partialOrders: countBy(activeOrders, (item) => item.state === "PARTIAL"), rejectedOrders: countBy(activeOrders, (item) => item.state === "REJECTED"), protectedOrdersPct: orderProtectionRate(activeOrders) }, filters: { activeTab: "ACTIVE", stateCounts: {}, providerCounts: {} }, orderIntents: rows(execution?.intents).filter(hasIntentId).map(intentRow), activeOrders, fills: rows(execution?.fills).filter(hasFillId).map(orderFillRow), protections: [], providers: providerRows(execution), stateMachine: [], history: [], commandActions: [], humanGateReview: humanGateReviewOverview({ execution, actor, nowIso, query }) };
}

// Real portfolioOrderIntents + humanExecutionGates + risk_decisions, reusing the
// same gate/action projections orderDetail() already uses for a single intent -
// this is the list-level "Orders & Human Gate" review workflow.
function humanGateReviewOverview({ execution, actor, nowIso, query }) {
  const intents = rows(nested(execution, ["portfolioOrderIntents"]));
  const gated = intents.filter((intent) => {
    const id = text(intent.portfolio_order_intent_id, "");
    return id && rows(nested(execution, ["humanExecutionGates"])).some((gate) => text(gate.portfolio_order_intent_id, "") === id);
  });
  const items = gated.map((intent) => {
    const gate = orderHumanGateProjection({ execution, portfolioIntent: intent, actor });
    const canonical = portfolioOrderIntentSummaryRowSafe(intent);
    const riskDecision = safeArrayFirst(intent.risk_decisions);
    return {
      orderIntentId: text(intent.portfolio_order_intent_id, ""),
      instrument: text(canonical.instrument, "—"),
      side: upper(canonical.side || "—"),
      quantity: number(canonical.quantity, 0),
      authorizedQuantity: number(riskDecision?.authorized?.quantity ?? riskDecision?.approved_size, canonical.quantity ?? 0),
      riskPct: finiteOrNull(riskDecision?.authorized?.risk_pct),
      status: gate.status,
      expiresAt: gate.expiresAt || null,
      ageSeconds: ageSecondsSafe(intent.created_at_utc, nowIso),
      route: `/execution/orders/${encodeURIComponent(text(intent.portfolio_order_intent_id, ""))}`,
    };
  });
  const pending = items.filter((item) => item.status === "AWAITING_MANUAL_CONFIRMATION");
  const decided = gated.map((intent) => ({ intent, gate: orderHumanGateProjection({ execution, portfolioIntent: intent, actor }) }));
  const approvedToday = countBy(decided, ({ gate }) => Boolean(gate.confirmedAt) && isSameUtcDay(gate.confirmedAt, nowIso));
  const rejectedToday = countBy(decided, ({ gate }) => Boolean(gate.rejectedAt) && isSameUtcDay(gate.rejectedAt, nowIso));
  const decisionDurations = decided
    .map(({ intent, gate }) => {
      const resolvedAt = Date.parse(gate.confirmedAt || gate.rejectedAt || "");
      const createdAt = Date.parse(intent.created_at_utc || "");
      return Number.isFinite(resolvedAt) && Number.isFinite(createdAt) ? { intent, gate, at: gate.confirmedAt || gate.rejectedAt, durationMs: resolvedAt - createdAt } : null;
    })
    .filter((item) => item && item.durationMs >= 0);
  const decisionDurationsMs = decisionDurations.map((item) => item.durationMs);
  const requestedRunId = text(query?.orderIntentId, "");
  const selectedIntent = gated.find((intent) => text(intent.portfolio_order_intent_id, "") === requestedRunId)
    || gated.find((intent) => text(intent.portfolio_order_intent_id, "") === pending[0]?.orderIntentId)
    || gated[0]
    || null;
  const selectedDossier = selectedIntent ? canonicalOrderIntentDossier({ execution, portfolioIntent: selectedIntent, order: {}, actor, nowIso, health: null }) : null;
  const reasonCodeCounts = new Map();
  for (const intent of gated) {
    const codes = rows(safeArrayFirst(intent.risk_decisions)?.reason_codes);
    for (const code of codes) reasonCodeCounts.set(String(code), (reasonCodeCounts.get(String(code)) || 0) + 1);
  }
  const reasonCodes = [...reasonCodeCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const pendingByStrategyGroups = new Map();
  for (const intent of gated) {
    const gate = orderHumanGateProjection({ execution, portfolioIntent: intent, actor });
    if (gate.status !== "AWAITING_MANUAL_CONFIRMATION") continue;
    const payload = intent.order_intent_payload || intent.payload || {};
    const key = text(payload.strategy_instance_id, "unavailable");
    const current = pendingByStrategyGroups.get(key) || { strategyInstanceId: key, pending: 0, oldestAgeSeconds: 0 };
    current.pending += 1;
    current.oldestAgeSeconds = Math.max(current.oldestAgeSeconds, ageSecondsSafe(intent.created_at_utc, nowIso));
    pendingByStrategyGroups.set(key, current);
  }
  return {
    summary: {
      pendingCount: pending.length,
      approvedToday,
      rejectedToday,
      avgDecisionSeconds: decisionDurationsMs.length ? Math.round(decisionDurationsMs.reduce((sum, value) => sum + value, 0) / decisionDurationsMs.length / 1000) : 0,
    },
    items,
    selectedOrderIntentId: text(selectedIntent?.portfolio_order_intent_id, ""),
    selectedDossier,
    reasonCodes,
    pendingByStrategy: [...pendingByStrategyGroups.values()].sort((a, b) => b.pending - a.pending),
    recentDecisions: [...decisionDurations]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 10)
      .map(({ intent, gate, at, durationMs }) => {
        const canonical = portfolioOrderIntentSummaryRowSafe(intent);
        return {
          orderIntentId: text(intent.portfolio_order_intent_id, ""),
          instrument: text(canonical.instrument, "—"),
          decision: gate.confirmedAt === at ? "APPROVED" : "REJECTED",
          at: text(at, "unavailable"),
          decisionSeconds: Math.round(durationMs / 1000),
        };
      }),
  };
}
function safeArrayFirst(value) { return rows(value)[0] || null; }
function ageSecondsSafe(value, nowIso) {
  const created = Date.parse(value || "");
  const now = Date.parse(nowIso || "");
  return Number.isFinite(created) && Number.isFinite(now) ? Math.max(0, Math.round((now - created) / 1000)) : 0;
}
function isSameUtcDay(value, nowIso) {
  const date = new Date(value);
  const reference = new Date(nowIso);
  return !Number.isNaN(date.getTime()) && !Number.isNaN(reference.getTime())
    && date.getUTCFullYear() === reference.getUTCFullYear() && date.getUTCMonth() === reference.getUTCMonth() && date.getUTCDate() === reference.getUTCDate();
}
function portfolioOrderIntentSummaryRowSafe(intent = {}) {
  const payload = intent.order_intent_payload || intent.payload || {};
  const terms = intent.execution_terms || payload.execution_terms || {};
  return {
    instrument: firstValue(intent.target_instrument, payload.instrument, terms.instrument),
    side: firstValue(payload.action, terms.side),
    quantity: finiteOrNull(firstValue(intent.risk_approved_net_size, intent.quantity, payload.quantity, terms.quantity)),
  };
}

function orderDetail({ execution, query, warnings, actor, nowIso }) {
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
    canonicalDossier: portfolioIntentSource ? canonicalOrderIntentDossier({ execution, portfolioIntent: portfolioIntentSource, order: effectiveOrder, actor, nowIso, health: null }) : null,
    resourceActions: portfolioIntentSource ? resourceAllowedActions({
      resourceType: "OrderIntent",
      status: text(portfolioIntentSource.status || portfolioIntentSource.payload?.status, "READY"),
      revision: text(portfolioIntentSource.immutable_terms_hash || portfolioIntentSource.order_intent_hash || effectiveOrder.expectedVersion, "unavailable"),
      actor,
      expiresAt: text(portfolioIntentSource.expires_at_utc || portfolioIntentSource.payload?.expires_at_utc, ""),
    }) : resourceAllowedActions({ resourceType: "BrokerOrder", status: effectiveOrder.state, actor }),
    executionMode: portfolioIntentSource
      ? executionAuthorityMode(execution?.safety)
      : null,
    humanGate: portfolioIntentSource ? orderHumanGateProjection({ execution, portfolioIntent: portfolioIntentSource, actor }) : null,
    reconciliation,
    fills,
    protections,
    lifecycle,
    relations: [{ label: "Signal", id: effectiveOrder.signalId, route: `/live/signals/${encodeURIComponent(effectiveOrder.signalId)}` }, { label: "Stratégie", id: effectiveOrder.strategyInstanceId, route: `/strategies/${encodeURIComponent(effectiveOrder.strategyInstanceId)}` }],
  };
}

function findPortfolioOrderIntent({ execution, queryOrderId, order }) {
  const expected = new Set(portfolioOrderIntentIds(order, [queryOrderId]));
  return rows(nested(execution, ["portfolioOrderIntents"]))
    .find((item) => portfolioOrderIntentIds(item).some((value) => expected.has(value)))
    || null;
}

function portfolioOrderIntentIds(item = {}, seeds = []) {
  item = item || {};
  const payload = firstValue(item.order_intent_payload, item.payload, {});
  return [
    ...seeds,
    item.portfolio_order_intent_id,
    item.order_intent_id,
    payload.portfolio_order_intent_id,
    payload.order_intent_id,
  ].map((value) => text(value, "")).filter(Boolean);
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
      decision: text(payload.portfolio_arbitration_decision || source.portfolio_arbitration_decision, ""),
      authorityId: text(lineage.portfolio_arbitration_run_id || payload.portfolio_arbitration_run_id || source.portfolio_arbitration_run_id, ""),
      version: text(payload.portfolio_arbitration_version, ""),
      reasonCodes: rows(payload.portfolio_arbitration_reason_codes || source.portfolio_arbitration_reason_codes).map(String),
    }),
    globalRisk: authorityStage("Global Risk", {
      decision: text(riskDecision?.decision, ""),
      authorityId: text(riskDecision?.risk_decision_id || riskIds[0], ""),
      version: text(riskDecision?.risk_rule_set_version || payload.risk_rule_set_version, ""),
      reasonCodes: rows(riskDecision?.reason_codes || payload.risk_reason_codes).map(String),
    }),
    targetPosition: {
      targetPositionId: text(lineage.target_position_id || payload.target_position_id, "unavailable"),
      account: text(lineage.target_account_id || payload.account_id || payload.broker_account_id, "unavailable"),
      authorizedQuantity: nullableNumber(lineage.risk_approved_net_size ?? riskDecision?.approved_size ?? payload.target_net_size ?? payload.quantity),
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
  const source = selectById(rows(nested(execution, ["trades"])), query.positionId, (item) => firstValue(item.trade_id, item.position_id), "POSITION_NOT_FOUND");
  const base = positionRow(source);
  const relatedOrders = positionRelatedOrders({ execution, source, base });
  if (!rows(nested(execution, ["trade_events"])).length) warnings.push("position-lifecycle:UNAVAILABLE");
  const lifecycle = positionLifecycleRows({ execution, base });
  const signalId = text(source.signal_id, "unavailable");
  return { summary: positionDetailSummary(source, base), identity: positionDetailIdentity(source, base, signalId), position: positionDetailBody(source, base), orders: relatedOrders, lifecycle, relations: positionDetailRelations(base, signalId) };
}

function positionRelatedOrders({ execution, source, base }) {
  return rows(nested(execution, ["orders"]))
    .filter((item) => String(item.strategy_instance_id) === base.strategyInstanceId || matchingSignalId(item, source))
    .map(activeOrderRow);
}
function matchingSignalId(item, source) {
  return Boolean(source.signal_id) && String(item.signal_id) === String(source.signal_id);
}
function positionLifecycleRows({ execution, base }) {
  return rows(nested(execution, ["trade_events"]))
    .filter((item) => String(firstValue(item.trade_id, item.position_id)) === base.positionId)
    .map(positionLifecycleRow);
}
function positionLifecycleRow(item) {
  return {
    eventId: text(item.event_id, "unavailable"),
    at: text(firstValue(item.occurred_at_utc, item.created_at_utc), "unavailable"),
    state: text(firstValue(item.state, item.event_type), "unavailable"),
    detail: text(firstValue(item.detail, item.message), "Détail indisponible"),
  };
}
function positionDetailSummary(source, base) {
  return { state: text(firstValue(source.status, source.state), base.quantity > 0 ? "OPEN" : "CLOSED"), quantity: base.quantity, pnlR: base.pnlR, riskR: base.riskR, protectionStatus: base.protectionStatus };
}
function positionDetailIdentity(source, base, signalId) {
  return { positionId: base.positionId, strategyInstanceId: base.strategyInstanceId, signalId, correlationId: text(source.correlation_id, "unavailable") };
}
function positionDetailBody(source, base) {
  return {
    ...base,
    state: text(firstValue(source.status, source.state), base.quantity > 0 ? "OPEN" : "CLOSED"),
    stopPrice: number(source.stop_price, undefined),
    targetPrice: number(source.target_price, undefined),
    openedAt: text(firstValue(source.opened_at_utc, source.entry_at_utc), "unavailable"),
    closedAt: text(firstValue(source.closed_at_utc, source.exit_at_utc), undefined),
  };
}
function positionDetailRelations(base, signalId) {
  return [{ label: "Signal", id: signalId, route: `/live/signals/${encodeURIComponent(signalId)}` }, { label: "Stratégie", id: base.strategyInstanceId, route: `/strategies/${encodeURIComponent(base.strategyInstanceId)}` }];
}

function incidentDetail({ incidents, query, warnings }) {
  const source = selectById(rows(incidents), query.incidentId, (item) => item.incident_id, "INCIDENT_NOT_FOUND");
  const incident = incidentRow(source);
  if (!incident.chronology.length) warnings.push("incident-chronology:UNAVAILABLE");
  if (!incident.reconciliationResults.length) warnings.push("incident-reconciliation:UNAVAILABLE");
  return { summary: { severity: incident.severity, status: incident.status, retryCount: number(source.retry_count, 0), operatorGate: text(source.operator_gate, "NONE") }, incident: { ...incident, retryCount: number(source.retry_count, 0), operatorGate: text(source.operator_gate, "NONE"), impactR: number(source.impact_R ?? source.impact_r, 0), impactSummary: text(source.impact_summary, incident.detail), machineRecommendation: text(source.machine_recommendation, "Indisponible"), openedAt: text(source.opened_at_utc || source.created_at_utc, "unavailable"), updatedAt: text(source.updated_at_utc || source.created_at_utc, "unavailable") }, payloadPreview: incident.payloadPreview, meta: incident.meta, chronology: incident.chronology, reconciliationResults: incident.reconciliationResults, postMortem: incident.postMortem, retries: rows(source.retries), relations: [{ label: "Ordre", id: text(source.order_id, "unavailable"), route: `/execution/orders/${encodeURIComponent(text(source.order_id, "unavailable"))}` }, { label: "Position", id: text(source.position_id, "unavailable"), route: `/execution/portfolio/positions/${encodeURIComponent(text(source.position_id, "unavailable"))}` }] };
}

function riskCenter({ risk, execution, strategy, health, nowIso, warnings }) {
  if (!nested(risk, ["limits"])) warnings.push("risk-limits:UNAVAILABLE");
  const authoritative = nested(risk, ["risk_center"]) || null;
  const intents = rows(nested(execution, ["portfolioOrderIntents"]));
  const decisions = intents.map((intent) => riskDecisionRow(intent, nowIso)).filter(Boolean);
  return {
    summary: riskCenterSummary(risk, authoritative),
    authoritativeState: authoritative,
    limits: riskCenterLimits(authoritative, risk),
    exposures: riskCenterExposures(risk),
    correlations: rows(nested(risk, ["correlations"])),
    propConstraints: rows(nested(risk, ["prop_constraints"])),
    stressTests: rows(nested(risk, ["stress_tests"])),
    breaches: riskCenterPreferredRows(authoritative, risk, "breaches"),
    timeSeriesContracts: frontTimeSeriesContracts({ view: "risk", execution, risk, nowIso }),
    riskByAccount: riskByAccountRows(risk, decisions),
    riskByStrategy: riskByStrategyRows(decisions, strategy),
    riskByInstrument: riskByInstrumentRows(decisions),
    riskDecisions: {
      summary: riskDecisionsSummary(decisions, nowIso),
      items: [...decisions].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
    },
    circuitBreakers: circuitBreakerRows(execution, health),
    commandActions: [],
  };
}
function riskDecisionRow(intent, nowIso) {
  const payload = intent.order_intent_payload || intent.payload || {};
  const decision = safeArrayFirst(intent.risk_decisions);
  const requestedQty = finiteOrNull(firstValue(intent.quantity, payload.quantity));
  const authorizedQty = finiteOrNull(firstValue(decision?.authorized?.quantity, decision?.approved_size));
  if (requestedQty === null && authorizedQty === null) return null;
  return {
    at: text(intent.created_at_utc, "unavailable"),
    orderIntentId: text(intent.portfolio_order_intent_id, ""),
    signalId: text(payload.signal_id, "unavailable"),
    strategyInstanceId: text(payload.strategy_instance_id, "unavailable"),
    accountId: text(firstValue(intent.target_account_id, payload.account_id, payload.broker_account_id), ""),
    instrument: text(firstValue(intent.target_instrument, payload.instrument), "unavailable"),
    requestedQty: requestedQty ?? 0,
    authorizedQty: authorizedQty ?? 0,
    riskAmount: number(decision?.authorized?.risk_amount, 0),
    verdict: riskDecisionVerdict(requestedQty, authorizedQty),
    reason: text(firstValue(rows(decision?.reason_codes)[0], decision?.nearest_limit?.type), "unavailable"),
  };
}
function riskDecisionVerdict(requested, authorized) {
  if (authorized === null || authorized === 0) return "REJECTED";
  if (requested !== null && authorized < requested) return "REDUCED";
  return "APPROVED";
}
function riskDecisionsSummary(decisions, nowIso) {
  return {
    total: decisions.length,
    approved: countBy(decisions, (item) => item.verdict === "APPROVED"),
    reduced: countBy(decisions, (item) => item.verdict === "REDUCED"),
    rejected: countBy(decisions, (item) => item.verdict === "REJECTED"),
    today: countBy(decisions, (item) => isSameUtcDay(item.at, nowIso)),
  };
}
function riskByAccountRows(risk, decisions) {
  const accounts = rows(nested(risk, ["accounts"]));
  return accounts.map((account) => {
    const accountId = text(account.account_id, "");
    const accountDecisions = decisions.filter((item) => item.accountId === accountId);
    return {
      accountId,
      label: text(account.label, accountId),
      equityUsd: finiteOrNull(account.capital),
      openRiskUsd: number(aggregateSum(accountDecisions.map((item) => item.riskAmount)), 0),
      status: text(account.status, "UNKNOWN"),
    };
  });
}
function riskByStrategyRows(decisions, strategy) {
  const instances = rows(nested(strategy, ["instances"]));
  const nameById = new Map(instances.map((item) => [text(item.strategy_instance_id, ""), text(item.strategy_definition_id || item.name, item.strategy_instance_id)]));
  const groups = new Map();
  for (const item of decisions) {
    const key = item.strategyInstanceId;
    if (!key || key === "unavailable") continue;
    const current = groups.get(key) || { strategyInstanceId: key, label: nameById.get(key) || key, riskAmount: 0, decisions: 0 };
    current.riskAmount += item.riskAmount;
    current.decisions += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.riskAmount - a.riskAmount).slice(0, 10);
}
function riskByInstrumentRows(decisions) {
  const groups = new Map();
  for (const item of decisions) {
    const key = item.instrument;
    if (!key || key === "unavailable") continue;
    const current = groups.get(key) || { instrument: key, riskAmount: 0, decisions: 0 };
    current.riskAmount += item.riskAmount;
    current.decisions += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.riskAmount - a.riskAmount);
}
function aggregateSum(values) { return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0); }
function circuitBreakerRows(execution, health) {
  const locks = rows(nested(execution, ["locks"]));
  const globalLock = locks.find((item) => item.scope_type === "global");
  const accountLocks = locks.filter((item) => item.scope_type === "account");
  const marketDataOk = nested(health, ["data_readiness", "market_closed"]) !== true && health != null;
  const infraOk = health?.ok !== false;
  return [
    { breakerId: "global_kill_switch", label: "Global Kill Switch", armed: Boolean(globalLock), detail: globalLock ? text(globalLock.reason, "Verrou actif") : "Aucun verrou global actif" },
    ...accountLocks.map((lock) => ({ breakerId: text(lock.execution_lock_id, lock.scope_value), label: `Protection compte · ${text(lock.scope_value, "")}`, armed: true, detail: text(lock.reason, "Verrou de protection actif") })),
    { breakerId: "market_data", label: "Flux de données marché", armed: !marketDataOk, detail: health ? (marketDataOk ? "Aucun problème détecté" : "Marché fermé ou données indisponibles") : "État santé non publié" },
    { breakerId: "infrastructure", label: "Infrastructure d'exécution", armed: !infraOk, detail: health ? (infraOk ? "Infrastructure saine" : "Dégradation détectée") : "État santé non publié" },
  ];
}

function executionProviders({ execution, incidents, health, warnings }) {
  if (!nested(execution, ["performance"])) warnings.push("execution-provider-performance:UNAVAILABLE");
  const providers = providerRows(execution);
  const accounts = rows(execution?.accounts).filter((item) => item?.broker_account_id).map(accountRow);
  const commands = rows(execution?.providerCommands).map(providerCommandRow);
  const providerEvents = rows(execution?.providerEvents).map(providerEventRow);
  return {
    summary: executionProviderSummary({ execution, providers, accounts, incidents }),
    providers: providers.map((item, index) => executionProviderRow(item, index, execution)),
    accounts,
    adapters: [],
    healthChecks: providers.map(executionProviderHealthRow),
    switchWorkflow: [],
    events: [],
    incidents: rows(incidents).filter(hasIncidentId).map(incidentSummary),
    commandActions: [],
    executionModes: executionModesSummary(execution),
    circuitBreakers: circuitBreakerRows(execution, health),
    providerCommands: {
      counts: {
        all: commands.length,
        working: countBy(commands, (item) => ["pending", "leased", "sent"].includes(item.status)),
        pending: countBy(commands, (item) => item.status === "pending"),
        filled: countBy(commands, (item) => item.status === "filled"),
        partial: countBy(commands, (item) => item.status === "partially_filled"),
        rejected: countBy(commands, (item) => item.status === "rejected"),
        cancelled: countBy(commands, (item) => item.status === "cancelled"),
      },
      items: commands.slice(0, 100),
    },
    fills: providerEvents.filter((item) => item.classification === "FILL").slice(0, 30),
    partialFills: providerEvents.filter((item) => item.classification === "PARTIAL_FILL").slice(0, 30),
    rejectsAndCancels: providerEvents.filter((item) => item.classification === "REJECT_CANCEL").slice(0, 30),
  };
}
function providerCommandRow(item) {
  const envelope = item.payload || {};
  const payload = envelope.order_intent_payload || {};
  return {
    commandId: text(item.execution_provider_command_id, ""),
    orderIntentId: text(firstValue(item.portfolio_order_intent_id, item.order_intent_id), ""),
    providerId: text(item.broker_provider_code, "unavailable"),
    instrument: text(payload.instrument, "unavailable"),
    side: upper(text(firstValue(payload.action, payload.side), "unavailable")),
    quantity: number(payload.quantity, 0),
    commandType: text(item.command_type, "unavailable"),
    status: text(item.status, "unknown"),
    at: text(firstValue(item.available_at, item.created_at), "unavailable"),
  };
}
function providerEventRow(item) {
  const type = text(firstValue(item.event_type, item.event_status), "unavailable");
  return {
    eventId: text(firstValue(item.broker_provider_event_id, item.provider_event_id), ""),
    commandId: text(item.execution_provider_command_id, ""),
    orderIntentId: text(item.portfolio_order_intent_id, ""),
    eventType: type,
    status: text(item.event_status, "unavailable"),
    side: item.side ? upper(item.side) : null,
    quantity: item.quantity == null ? null : number(item.quantity, 0),
    fillQuantity: item.fill_quantity == null ? null : number(item.fill_quantity, 0),
    fillPrice: item.fill_price == null ? null : number(item.fill_price, 0),
    at: text(firstValue(item.occurred_at_utc, item.created_at), "unavailable"),
    classification: providerEventClassification(type),
  };
}
function providerEventClassification(type) {
  const normalized = upper(type);
  if (normalized.includes("PARTIAL")) return "PARTIAL_FILL";
  if (normalized.includes("FILL")) return "FILL";
  if (normalized.includes("REJECT") || normalized.includes("CANCEL")) return "REJECT_CANCEL";
  return "OTHER";
}
function executionModesSummary(execution) {
  const safety = execution?.safety || {};
  return {
    current: upper(text(safety.executionAuthorityMode, "unavailable")),
    executionEnabled: Boolean(safety.executionEnabled),
    manualTelegramExecutionEnabled: Boolean(safety.manualTelegramExecutionEnabled),
    entryOperatorApprovalRequired: Boolean(safety.entryOperatorApprovalRequired),
    liveAccountAllowed: Boolean(safety.liveAccountAllowed),
  };
}

function riskCenterSummary(risk, authoritative) {
  const summary = nested(risk, ["summary"]) || {};
  // grossExposure/netExposure/dailyLoss/trailingDrawdown live on the risk_center
  // ("authoritative") snapshot as { availability, value, reasonCode } nodes, not as
  // flat risk.summary.* fields (those never existed - reading them always resolved
  // to 0). front-portfolio-risk-projection.js's riskCenterState() still hardcodes
  // all four to availability:"UNAVAILABLE" today, so these correctly read through
  // as unavailable/0 until that computation is implemented; openRisk *is* real
  // (aggregated from risk_decisions), so use it in place of a fabricated leverage figure.
  const openRisk = finiteOrNull(nested(authoritative, ["openRisk", "value"]));
  return {
    globalStatus: firstValue(nested(authoritative, ["globalStatus"]), summary.status, "DATA_UNAVAILABLE"),
    riskUsedPct: number(summary.risk_percent, 0),
    grossExposureUsd: number(nested(authoritative, ["grossExposure", "value"]), 0),
    netExposureUsd: number(nested(authoritative, ["netExposure", "value"]), 0),
    leverage: number(summary.leverage, 0),
    dailyLossR: number(nested(authoritative, ["dailyLoss", "value"]), 0),
    dailyLossLimitR: number(summary.daily_loss_limit_r, 0),
    trailingDrawdownR: number(nested(authoritative, ["trailingDrawdown", "value"]), 0),
    maxDrawdownR: number(nested(authoritative, ["trailingDrawdown", "value"]), 0),
    activeBreaches: firstValue(rows(nested(authoritative, ["breaches"])).length || undefined, rows(nested(risk, ["breaches"])).length),
    stressTestsToday: rows(nested(risk, ["stress_tests"])).length,
    openRiskUsd: openRisk ?? 0,
  };
}
function finiteOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function riskCenterPreferredRows(authoritative, risk, key) {
  const authoritativeRows = rows(nested(authoritative, [key]));
  return authoritativeRows.length ? authoritativeRows : rows(nested(risk, [key]));
}

// The risk_center authoritative snapshot exposes limits in the risk engine's own
// internal shape (limit_id/current_utilization/... in snake_case), not the
// RiskView.limits front contract (limitId/usedPct/label/...). Map explicitly
// instead of passing the raw engine rows straight through to the front.
const RISK_LIMIT_TYPE_LABELS = {
  PORTFOLIO_ABS_SIZE: "Taille absolue du portefeuille",
  ACCOUNT_ABS_SIZE: "Taille absolue du compte",
  INSTRUMENT_ABS_SIZE: "Taille absolue instrument",
  CORRELATION_GROUP_ABS_SIZE: "Taille absolue groupe de corrélation",
};
function riskCenterLimits(authoritative, risk) {
  const authoritativeRows = rows(nested(authoritative, ["limits"]));
  if (authoritativeRows.length) return authoritativeRows.map((item) => mapAuthoritativeRiskLimit(item, authoritative));
  return rows(nested(risk, ["limits"]));
}
function riskLimitScope(type) {
  const normalized = upper(type);
  if (normalized.startsWith("ACCOUNT")) return "ACCOUNT";
  if (normalized.startsWith("INSTRUMENT")) return "INSTRUMENT";
  if (normalized.startsWith("CORRELATION_GROUP")) return "ASSET_CLASS";
  return "GLOBAL";
}
function riskLimitStatus(item) {
  if (item?.breached) return "BREACH";
  const severity = upper(item?.severity);
  if (severity === "EMERGENCY" || severity === "CRITICAL") return "BLOCKED";
  const utilization = number(item?.current_utilization, 0);
  if (utilization >= 0.8 || severity === "HIGH" || severity === "WARN" || severity === "WARNING") return "WATCH";
  return "PASS";
}
function riskLimitLabel(type, scopeValue) {
  const base = RISK_LIMIT_TYPE_LABELS[upper(type)] || text(type, "Limite").replaceAll("_", " ").toLowerCase();
  return scopeValue ? `${base} · ${scopeValue}` : base;
}
function mapAuthoritativeRiskLimit(item, authoritative) {
  const value = number(item.value, 0);
  const utilization = number(item.current_utilization, 0);
  const scopeValue = text(item.scope, "");
  return {
    limitId: text(item.limit_id, `${text(item.type, "LIMIT")}:${scopeValue}`),
    scope: riskLimitScope(item.type),
    label: riskLimitLabel(item.type, scopeValue),
    targetId: scopeValue,
    limitValue: value,
    usedValue: value * utilization,
    unit: upper(item.unit) === "CONTRACTS" ? "CONTRACTS" : text(item.unit, "PCT"),
    usedPct: utilization * 100,
    headroomValue: number(item.remaining, value - value * utilization),
    status: riskLimitStatus(item),
    reasonCodes: [],
    lastChangedAt: text(authoritative?.asOf, "unavailable"),
    changedBy: "risk_engine",
    officialSource: text(authoritative?.source, "risk_center"),
    contributors: [],
  };
}
function riskCenterExposures(risk) {
  return rows(nested(risk, ["exposures"]))
    .filter((item) => item?.exposure_id || item?.instrument_code)
    .map((item) => ({
      exposureId: text(firstValue(item.exposure_id, item.instrument_code), ""),
      label: text(item.instrument_code, "Exposure"),
      valueUsd: number(item.value_usd, 0),
      riskPct: number(item.risk_pct, 0),
      status: riskExposureStatus(item.status),
    }));
}
function riskExposureStatus(status) {
  const normalized = upper(status);
  if (normalized === "BLOCK") return "BLOCK";
  return normalized === "PASS" ? "PASS" : "WATCH";
}
function executionProviderSummary({ execution, providers, accounts, incidents }) {
  return {
    primaryProviderId: firstValue(nested(providers, [0, "providerId"]), "unavailable"),
    standbyProviderId: firstValue(nested(providers, [1, "providerId"]), "unavailable"),
    activeProviders: providers.length,
    degradedProviders: countBy(providers, (item) => item.status !== "OK"),
    avgLatencyMs: average(providers.map((item) => item.latencyMs)),
    fillRatePct: number(nested(execution, ["performance", "fill_rate_pct"]), 0),
    slippageR: number(nested(execution, ["performance", "slippage_r"]), 0),
    openIncidents: rows(incidents).filter(hasIncidentId).length,
    accounts: accounts.length,
  };
}
function executionProviderRow(item, index, execution) {
  return {
    ...item,
    adapter: item.providerId,
    state: item.status === "OK" ? primaryOrStandby(index) : "DEGRADED",
    role: primaryOrStandby(index),
    fillRatePct: number(nested(execution, ["performance", "fill_rate_pct"]), 0),
    browserExposure: "NONE",
  };
}
function executionProviderHealthRow(item) {
  return { checkId: `health_${item.providerId}`, label: item.label, detail: item.status, latencyMs: item.latencyMs, status: item.status === "OK" ? "PASS" : "WATCH" };
}
function primaryOrStandby(index) { return index === 0 ? "PRIMARY" : "STANDBY"; }

function researchLab({ runtime, agentEvents, research, dataFoundation, simulationRuns, incidents, actor }) {
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
    activityStream: rows(agentEvents?.items).map(researchActivityEventRow),
    commandActions: [researchBootstrapAction(actor)],
  };
}

function researchActivityEventRow(item) {
  return {
    eventId: text(item.event_id, ""),
    eventType: text(item.event_type, "unavailable"),
    missionKey: text(item.mission_key || item.mission_id, "unavailable"),
    taskKey: text(item.task_key || item.task_type, "unavailable"),
    detail: text(item.actor, ""),
    at: text(item.created_at_utc, "unavailable"),
  };
}
function researchAgentFleet({ runtime, warnings }) { warnings.push("agent-conversations:NOT_IMPLEMENTED"); const agents = rows(runtime).filter((item) => item?.worker_id || item?.task_id).map(agentRow); return { summary: { totalAgents: agents.length, activeAgents: countBy(agents, (item) => item.status === "ACTIVE"), waitingAgents: countBy(agents, (item) => item.status === "WAITING"), queueDepth: agents.reduce((sum, item) => sum + item.queueDepth, 0), lockedLeases: countBy(runtime, (item) => Boolean(item.lease_id || item.lease_token)), avgSuccessRatePct: average(rows(runtime).map((item) => number(item.success_rate_pct, NaN))) }, agents, queue: [], conversations: [], incidents: [], commandActions: [] }; }
function researchDataCatalog({ dataFoundation, incidents }) { const datasets = rows(dataFoundation).filter((item) => item?.dataset_id).map(researchDataCatalogDatasetRow); return { summary: { datasets: datasets.length, instruments: new Set(datasets.map((item) => item.instrument)).size, features: 0, lineageEdges: datasets.length, qualityOkPct: datasets.length ? Math.round(countBy(datasets, (item) => item.quality === "OK") / datasets.length * 100) : 0, openGaps: countBy(datasets, (item) => item.quality !== "OK") }, datasets, instruments: researchInstruments(datasets), features: [], lineage: researchLineage(datasets), incidents: rows(incidents).filter(hasIncidentId).map(dataCatalogIncident), commandActions: [] }; }
function researchCompute({ runtime, simulationRuns }) { const sourceWorkers = rows(runtime).filter((item) => item?.worker_id || item?.task_id); const jobs = rows(simulationRuns).filter((item) => item?.simulation_run_id || item?.simulationRunId).map(simulationComputeJobRow); return { summary: { activeWorkers: sourceWorkers.length, runningJobs: countBy(jobs, (item) => item.state === "RUNNING"), queuedJobs: countBy(jobs, (item) => item.state === "QUEUED"), waitingJobs: countBy(sourceWorkers, (item) => upper(item.status) === "READY"), dlqItems: 0, researchUsedPct: average(sourceWorkers.map((item) => number(item.cpu_pct, NaN))), liveReservedPct: 0, costTodayUsd: sourceWorkers.reduce((sum, item) => sum + number(item.cost_usd_hour, 0), 0) }, pools: researchComputePools(jobs), workers: sourceWorkers.map(researchComputeWorkerRow), jobs, reservations: [], dlq: [], commandActions: [] }; }
function strategyCenter({ strategy, strategyPromotionLineage, performance, query, nowIso }) {
  const sourceRows = rows(strategy?.strategies).length ? rows(strategy?.strategies) : rows(strategy?.definitions);
  const strategies = sourceRows.map(strategyRow);
  const requestedId = text(query?.strategyId, "");
  const selected = (requestedId && strategies.find((item) => item.strategyId === requestedId))
    || strategies.find((item) => item.runtimeStatus === "RUNNING") || strategies[0] || strategyRow({});
  const selectedRaw = sourceRows.find((item) => text(item.strategy_definition_id || item.strategy_id, "none") === selected.strategyId) || {};
  const selectedInstances = rows(selectedRaw.instances);
  const primaryInstance = selectStrategyInstance(selectedRaw, selectedInstances);
  const selectedVersion = selectStrategyVersion(selectedRaw, primaryInstance);
  const lineageMatch = strategyPromotionLineage?.candidate?.candidate?.strategy_version_id === selected.strategyVersionId
    ? strategyPromotionLineage.candidate
    : null;
  const candidate = lineageMatch?.candidate || null;
  const gateReport = candidate
    ? rows(lineageMatch?.evaluation_reports)
        .filter((item) => item.report_kind === "PROMOTION_MATRIX")
        .sort((a, b) => String(b.created_at_utc).localeCompare(String(a.created_at_utc)))[0] || null
    : null;
  const hypothesis = lineageMatch?.hypothesis || null;
  const experiment = lineageMatch?.experiment || null;
  return {
    summary: {
      totalStrategies: strategies.length,
      liveStrategies: countBy(strategy?.instances, (item) => upper(item.execution_mode) === "LIVE"),
      paperStrategies: countBy(strategy?.instances, (item) => upper(item.execution_mode) === "PAPER"),
      suspendedStrategies: countBy(strategy?.instances, (item) => ["PAUSED", "STOPPED"].includes(upper(item.runtime_state))),
      watchlistStrategies: strategies.filter((item) => item.lifecycle === "SHADOW").length,
      averageExpectancyR: averageStrategyMetric(strategies, "expectancyR"),
      averageProfitFactor: averageStrategyMetric(strategies, "profitFactor"),
      averageDrawdownR: averageStrategyMetric(strategies, "maxDrawdownR"),
    },
    strategies,
    lifecycleDistribution: strategyLifecycleDistribution(strategies),
    performanceByFamily: strategyPerformanceByFamily(strategies),
    topStrategies: topStrategyRows(strategies),
    recentEvents: strategyRecentEvents(strategy?.audit),
    selectedInspector: {
      strategyId: selected.strategyId,
      strategyDefinitionId: selected.strategyDefinitionId,
      strategyVersionId: selected.strategyVersionId,
      strategyInstanceId: selected.strategyInstanceId,
      runtimeBundleId: selected.runtimeBundleId,
      thesis: text(selectedRaw.description || selectedRaw.metadata?.thesis, "Thèse non publiée par le Strategy Kernel."),
      rulesSummary: rows(selectedVersion?.metadata?.strategy_spec?.rules).map((rule) => text(rule.label || rule.name, "")).filter(Boolean),
      meta: strategyCenterMetaRow({ definition: selectedRaw, version: selectedVersion, instance: primaryInstance }),
      spec: strategySpecProjection(selectedVersion?.metadata?.strategy_spec || selectedRaw.strategy_spec),
      gates: strategyCenterGateRows(gateReport),
      lineage: strategyCenterLineageRows({ hypothesis, experiment, candidate, version: selectedVersion, instances: selectedInstances }),
      runtimeInstances: selectedInstances.map((item) => strategyCenterInstanceRow(item, strategy?.signals, nowIso)),
      performance: strategyCenterPerformanceBlock(selected, performance),
      riskAllocationPct: number(primaryInstance?.risk_allocation_pct || primaryInstance?.metadata?.risk_allocation_pct, 0),
      currentCommandEligibility: strategyCenterCommandEligibility(selected),
    },
  };
}

function strategyCenterMetaRow({ definition = {}, version, instance }) {
  return {
    instruments: strategyInstruments(definition, instance),
    timeframe: text(firstValue(version?.metadata?.timeframe, instance?.metadata?.timeframe, definition.timeframe), "unavailable"),
    sessionScope: stringList(instance?.session_scope),
    owner: text(definition.owner, "unavailable"),
    publishedAt: text(version?.published_at, "unavailable"),
    compiledArtifactHash: text(version?.compiled_artifact_hash || version?.dsl_source_hash, "unavailable"),
    executionMode: executionModeState(instance?.execution_mode),
    accountScope: text(instance?.account_scope, "unavailable"),
  };
}

const STRATEGY_CENTER_GATE_ORDER = [
  ["G0_DATASET_VERSIONED", "G0 · Données versionnées"],
  ["G1_VALIDATION_EVIDENCE", "G1 · Preuves de validation"],
  ["G2_ROBUSTNESS", "G2 · Robustesse"],
  ["G3_OUT_OF_SAMPLE", "G3 · Hors échantillon"],
  ["G4_PORTFOLIO_FIT", "G4 · Cohérence portefeuille"],
  ["G5_PROMOTION_MATRIX", "G5 · Matrice de promotion"],
  ["G6_OPERATOR_APPROVAL", "G6 · Approbation opérateur"],
  ["G7_LIVE_AUTHORIZATION", "G7 · Autorisation live"],
];

function strategyCenterGateRows(gateReport) {
  const gates = gateReport?.criteria?.gates || null;
  return STRATEGY_CENTER_GATE_ORDER.map(([key, label]) => {
    if (!gates || !gates[key]) return { label, state: "PENDING", detail: "Aucun rapport de gate publié pour cette version." };
    const entry = gates[key];
    return { label, state: entry.ok ? "PASS" : "FAIL", detail: text(Array.isArray(entry.detail) ? entry.detail.join(", ") : entry.detail, "") };
  });
}

function strategyCenterLineageRows({ hypothesis, experiment, candidate, version, instances }) {
  const nodes = [];
  if (hypothesis) nodes.push({ nodeType: "HYPOTHESIS", id: text(hypothesis.research_hypothesis_id, "unavailable"), at: text(hypothesis.created_at_utc, "unavailable") });
  if (experiment) nodes.push({ nodeType: "EXPERIMENT", id: text(experiment.research_experiment_id, "unavailable"), at: text(experiment.created_at_utc, "unavailable") });
  if (experiment?.winner_simulation_run_id) nodes.push({ nodeType: "RUN", id: text(experiment.winner_simulation_run_id, "unavailable"), at: "unavailable" });
  if (candidate) nodes.push({ nodeType: "CANDIDATE", id: text(candidate.research_candidate_id, "unavailable"), at: text(candidate.created_at_utc, "unavailable") });
  if (version) nodes.push({ nodeType: "STRATEGY_VERSION", id: text(version.strategy_version_id, "unavailable"), at: text(version.published_at || version.created_at, "unavailable") });
  const deployedInstance = instances.find((item) => item.strategy_version_id === version?.strategy_version_id);
  if (deployedInstance) nodes.push({ nodeType: "INSTANCE", id: text(deployedInstance.strategy_instance_id, "unavailable"), at: text(deployedInstance.started_at || deployedInstance.created_at, "unavailable") });
  return nodes;
}

function strategyCenterInstanceRow(item, signals, nowIso) {
  const instanceId = String(item.strategy_instance_id);
  const today = text(nowIso, "").slice(0, 10);
  const signalsToday = today
    ? countBy(signals, (signal) => String(signal.strategy_instance_id) === instanceId && text(signal.created_at_utc || signal.created_at, "").slice(0, 10) === today)
    : 0;
  return {
    strategyInstanceId: instanceId,
    instruments: stringList(item.instrument_scope),
    mode: executionModeState(item.execution_mode),
    runtimeStatus: runtimeState(item.runtime_state || item.status),
    health: strategyLiveHealth({ runtimeStatus: runtimeState(item.runtime_state || item.status), executionMode: executionModeState(item.execution_mode) }),
    lastHeartbeatAt: text(item.last_heartbeat_at, "unavailable"),
    signalsToday,
  };
}

function strategyCenterPerformanceBlock(selected, performance) {
  const totals = performance?.totals || {};
  const matches = rows(performance?.equity).length > 0 || Number.isFinite(Number(totals.totalR));
  return {
    availability: matches ? "AVAILABLE" : "UNAVAILABLE",
    expectancyR: selected.expectancyR,
    profitFactor: selected.profitFactor,
    winRatePct: selected.winRatePct,
    maxDrawdownR: selected.maxDrawdownR,
    oosR: selected.lastOosR,
    series: rows(performance?.equity).map((point, index) => ({
      sequence: index + 1,
      at: text(point.date || point.at, "unavailable"),
      cumulativeR: number(point.cumulativeR, 0),
      drawdownR: number(point.drawdownR, 0),
    })),
  };
}

function strategyCenterCommandEligibility(selected) {
  if (selected.lifecycle === "LIVE" || selected.lifecycle === "PAPER") return "READ_ONLY";
  if (selected.versionStatus === "VALIDATED" && selected.lifecycle === "SHADOW") return "CAN_REQUEST_PAPER";
  if (selected.versionStatus === "VALIDATED") return "CAN_REQUEST_SHADOW";
  return "READ_ONLY";
}

function operatorSettings({ warnings }) { warnings.push("operator-settings-store:NOT_IMPLEMENTED"); return { summary: { theme: "dark", density: "compact", language: "fr", timezone: "Europe/Paris", notificationsEnabled: false, voiceState: "OFF", activeDevices: 0, activeSessions: 0, privacyMode: "STRICT" }, cockpitPreferences: [], widgets: [], notificationRules: [], jarvis: { pushToTalkEnabled: false, wakeWordEnabled: false, voiceState: "OFF", lastVoiceCheckAt: "unavailable", transcriptRetention: "NONE" }, shortcuts: [], devices: [], privacy: [], guardrails: [], commandActions: [] }; }
function adminAccess({ actor, warnings }) { warnings.push("admin-directory:NOT_IMPLEMENTED"); const writeAllowed = permissions(actor).some((item) => item.capability === "front.command" && item.allowed); return { summary: { accessMode: writeAllowed ? "FULL_ADMIN" : "READ_ONLY", users: 0, activeUsers: 0, roles: rows(actor?.roles).length, capabilities: permissions(actor).length, accountGroups: 0, pendingChanges: 0, auditEvents: 0 }, currentAccess: { userId: text(actor?.uid || actor?.email, "anonymous"), roles: rows(actor?.roles), canMutate: writeAllowed, readOnlyReason: writeAllowed ? "" : "Session desk.write requise", stepUpReady: writeAllowed }, users: [], roles: [], capabilities: permissions(actor), accountGroups: [], policies: [], providerAccess: [], auditEvents: [], commandActions: [] }; }
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

function lane(id, label, detail, completed, total, state) { return { id, label, detail, completed, total, state }; }
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
function agentRow(item) { return { agentId: text(item.assigned_worker_id || item.worker_id || item.task_id, ""), taskId: text(item.task_id, ""), name: text(item.assigned_worker_id || item.worker_id, "Agent runtime"), role: text(item.task_type, "agent-runtime"), status: upper(item.status) === "READY" ? "WAITING" : upper(item.status) === "FAILED" ? "FAILED" : "ACTIVE", missionId: text(item.mission_id, "unavailable"), missionKey: text(item.mission_key, "unavailable"), task: text(item.task_key || item.status, "unavailable"), model: text(item.model, "unavailable"), reasoningLevel: text(item.reasoning_level, "unavailable"), queueDepth: number(item.queue_depth, 0), tokenBudgetPct: number(item.token_budget_pct, 0), leaseActive: item.lease_active === true, leaseExpiresAt: text(item.lease_expires_at_utc, "unavailable"), lastHeartbeatAt: text(item.updated_at_utc, "unavailable") }; }
function researchExperimentRow(item) { const reports = number(item.counts?.evaluation_reports, 0); return { experimentId: text(item.research_experiment_id, ""), missionId: text(item.metadata?.mission_id, "unavailable"), runId: text(item.winner_simulation_run_id, "unavailable"), title: text(item.name, "Expérience recherche"), hypothesis: text(item.objective, "Hypothèse non publiée"), ownerAgent: text(item.owner, "unavailable"), stage: stageFromResearch(item), status: statusFromResearch(item), progressPct: researchProgress(item, Array.from({ length: reports }), []), score: number(item.metadata?.score, 0), eta: "unavailable", currentTask: text(item.comparison_metric, "unavailable"), expectedEvent: text(item.expected_event, "unavailable"), tokenBudgetPct: number(item.token_budget_pct, 0), computeBudgetPct: number(item.compute_budget_pct, 0) }; }
function researchPipelineRows({ experiments, reports, candidates }) { return ["IDEA", "BASELINE", "ITERATION", "ROBUSTNESS", "OOS", "PAPER_READY"].map((stage) => ({ stageId: stage, label: stage.replace("_", " "), state: pipelineState(stage, { experiments, reports, candidates }), activeExperiments: countBy(experiments, (item) => item.stage === stage), promoted: countBy(candidates, (item) => upper(item.status) === "PROMOTION_READY"), rejected: countBy(candidates, (item) => upper(item.status) === "REJECTED"), budgetUsedPct: stage === "BASELINE" ? Math.min(100, reports.length * 25) : 0 })); }
function researchCoverageRows(dataFoundation) { return rows(dataFoundation).filter((item) => item?.dataset_id).map((item) => ({ coverageId: text(item.dataset_id, ""), label: text(item.name || item.dataset_key, "Dataset"), coveragePct: upper(item.status) === "READY" ? 100 : number(item.coverage_pct, 0), detail: `${text(item.dataset_key, "dataset")} · ${timeLabel(item.cutoff_utc)}`, quality: upper(item.status) === "READY" ? "OK" : "WATCH" })); }
function researchDatasetRow(item) { return { datasetId: text(item.dataset_id, ""), label: text(item.name || item.dataset_key, "Dataset"), lineage: text(item.provenance_hash, "unavailable"), coverage: `${text(item.time_range_start_utc, "unavailable").slice(0, 10)} → ${text(item.time_range_end_utc, "unavailable").slice(0, 10)}`, pointInTime: Boolean(item.cutoff_utc), quality: upper(item.status) === "READY" ? "OK" : "WATCH" }; }
function researchResultRow(report) {
  const metrics = report.metrics || report.metric_snapshot || {};
  const decision = upper(report.verdict) === "PASS" ? "PROMOTED" : upper(report.verdict) === "FAIL" ? "REJECTED" : "REVIEW";
  const oosR = number(metrics.total_r, 0);
  const sharpe = number(metrics.sharpe_r, 0);
  const robustnessScore = Math.round(number(report.score, 0) * 100);
  // Composite ranking blends robustness (primary gate signal), OOS return, and Sharpe so the
  // "Top candidates" list isn't dominated by a single noisy metric.
  const compositeScore = Math.round(robustnessScore * 0.5 + Math.max(0, oosR) * 10 * 0.3 + Math.max(0, sharpe) * 20 * 0.2);
  return { resultId: text(report.research_evaluation_report_id, ""), experimentId: text(report.research_experiment_id, "unavailable"), strategyId: text(report.research_candidate_id, "unavailable"), title: text(report.report_kind, "Validation"), decision, oosR, sharpe, robustnessScore, compositeScore, decidedAt: text(report.created_at_utc, "unavailable") };
}
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
  const instances = rows(item.instances);
  const selectedInstance = selectStrategyInstance(item, instances);
  const selectedVersion = selectStrategyVersion(item, selectedInstance);
  const strategyId = text(item.strategy_definition_id || item.strategy_id, "none");
  const metrics = selectedVersion?.metadata?.metrics || selectedVersion?.metadata?.validated_metrics || {};
  const runtimeStatusValue = runtimeState(selectedInstance?.runtime_state || selectedInstance?.status);
  const executionModeValue = executionModeState(selectedInstance?.execution_mode);
  const versionStatusValue = versionStatus(selectedVersion?.status);
  return {
    strategyId,
    strategyDefinitionId: strategyId,
    strategyVersionId: text(selectedVersion?.strategy_version_id, "none"),
    strategyInstanceId: text(selectedInstance?.strategy_instance_id, "none"),
    runtimeBundleId: text(selectedVersion?.runtime_contract_bundle_version || selectedInstance?.metadata?.runtime_bundle_id, "none"),
    name: strategyInstanceDisplayName({ definition: item, version: selectedVersion, instance: selectedInstance }),
    family: strategyFamily(firstValue(item.family, item.metadata?.family_id, item.external_key)),
    instruments: strategyInstruments(item, selectedInstance),
    timeframe: text(firstValue(selectedVersion?.metadata?.timeframe, selectedInstance?.metadata?.timeframe, item.timeframe), "—"),
    scientificStatus: scientificStatus(firstValue(item.scientific_status, item.status, item.metadata?.scientific_status)),
    versionStatus: versionStatusValue,
    runtimeStatus: runtimeStatusValue,
    executionMode: executionModeValue,
    tier: strategyTier(item.tier || item.metadata?.tier),
    expectancyR: number(firstValue(metrics.expectancy_r, metrics.expectancyR), 0),
    profitFactor: number(firstValue(metrics.profit_factor, metrics.profitFactor), 0),
    winRatePct: number(firstValue(metrics.win_rate_pct, metrics.winRatePct), 0),
    maxDrawdownR: number(firstValue(metrics.max_drawdown_r, metrics.maxDrawdownR), 0),
    liveHealth: strategyLiveHealth({ runtimeStatus: runtimeStatusValue, executionMode: executionModeValue }),
    lifecycle: strategyLifecycle({ runtimeStatus: runtimeStatusValue, executionMode: executionModeValue, versionStatus: versionStatusValue }),
    lastOosR: number(firstValue(metrics.oos_r, metrics.total_r, metrics.totalR), 0),
  };
}

function selectStrategyInstance(item, instances) {
  return instances.find((candidate) => runtimeState(candidate.runtime_state || candidate.status) === "RUNNING")
    || instances.find((candidate) => runtimeState(candidate.runtime_state || candidate.status) === "PAUSED")
    || item.live_instance || item.paper_instance || instances[0] || null;
}

function selectStrategyVersion(item, selectedInstance) {
  const versions = rows(item.versions);
  return versions.find((candidate) => candidate.strategy_version_id === selectedInstance?.strategy_version_id)
    || item.published_version || item.latest_version || versions[0]
    || (item.strategy_version_id ? item : null);
}

function strategyInstanceDisplayName({ definition = {}, version = {}, instance = {} } = {}) {
  const base = text(definition.name || definition.label || definition.external_key, "Stratégie sans nom");
  const versionLabel = text(version?.version_label, "");
  const instanceId = text(instance?.strategy_instance_id, "");
  if (!instanceId && !versionLabel) return base;
  if (versionLabel) return `${base} · ${versionLabel}`;
  return `${base} · ${shortId(instanceId)}`;
}

function strategyInstruments(definition, instance) {
  return stringList(firstValue(instance?.instrument_scope, definition.default_instruments, definition.instruments, definition.metadata?.instrument));
}

function strategyLiveHealth({ runtimeStatus, executionMode }) {
  if (executionMode !== "LIVE") return runtimeStatus === "RUNNING" ? "OK" : "OFF";
  if (runtimeStatus === "RUNNING") return "OK";
  if (runtimeStatus === "PAUSED") return "WATCH";
  return "DEGRADED";
}

function strategyLifecycle({ runtimeStatus, executionMode, versionStatus }) {
  if (runtimeStatus === "RUNNING" || runtimeStatus === "PAUSED") return executionMode;
  if (versionStatus === "VALIDATED") return "RESEARCH";
  return "DRAFT";
}

function strategyLifecycleDistribution(strategies) {
  const total = Math.max(strategies.length, 1);
  return ["DRAFT", "RESEARCH", "SHADOW", "PAPER", "LIVE"].map((label) => {
    const count = strategies.filter((item) => item.lifecycle === label).length;
    return { label, count, pct: Math.round((count / total) * 100) };
  }).filter((item) => item.count > 0);
}

function strategyPerformanceByFamily(strategies) {
  return [...groupRows(strategies, (item) => item.family).entries()].map(([family, items]) => ({
    family,
    strategies: items.length,
    averageProfitFactor: averageStrategyMetric(items, "profitFactor"),
    expectancyR: averageStrategyMetric(items, "expectancyR"),
    drawdownR: averageStrategyMetric(items, "maxDrawdownR"),
  }));
}

function topStrategyRows(strategies) {
  return strategies.filter((item) => item.strategyInstanceId !== "none").slice(0, 5).map((item) => ({
    strategyId: item.strategyId,
    name: item.name,
    score: Math.round(Math.max(item.profitFactor, 0) * 25),
    oosR: item.lastOosR,
    liveParityPct: item.runtimeStatus === "RUNNING" ? 100 : 0,
  }));
}

function strategyRecentEvents(audit) {
  return rows(audit).slice(0, 8).map((item) => ({
    eventId: text(item.strategy_kernel_audit_event_id || item.event_id, "strategy_event"),
    at: text(item.created_at, "unavailable"),
    title: text(item.event_type, "Événement stratégie"),
    detail: text(item.reason || item.aggregate_id, "Audit Strategy Kernel"),
    tone: upper(item.next_runtime_state) === "FAILED" ? "HIGH" : "INFO",
  }));
}

function averageStrategyMetric(items, key) {
  const values = items.map((item) => Number(item[key])).filter(Number.isFinite);
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function groupRows(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return groups;
  }, new Map());
}

function shortId(value) {
  return text(value, "none").slice(0, 8);
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
    entryModel: text(firstValue(spec.entry_model, spec.entryModel), "unavailable"),
    stopModel: text(firstValue(spec.stop_model, spec.stopModel), "unavailable"),
    targetModel: text(firstValue(spec.target_model, spec.targetModel), "unavailable"),
    invalidationModel: text(firstValue(spec.invalidation_model, spec.invalidationModel), "unavailable"),
    riskModel: text(firstValue(spec.risk_model, spec.riskModel), "unavailable"),
    rules: rows(spec.rules).map(strategySpecRuleRow),
    levels: rows(spec.levels).map(strategySpecLevelRow),
  };
}

function strategySpecRuleRow(rule, index) {
  return {
    ruleId: text(firstValue(rule.rule_id, rule.ruleId), `rule_${index + 1}`),
    label: text(firstValue(rule.label, rule.name), `Règle ${index + 1}`),
    type: strategyRuleType(rule.type),
    expression: text(firstValue(rule.expression, rule.predicate), "unavailable"),
    state: strategyRuleState(rule.state),
    weightPct: number(firstValue(rule.weight_pct, rule.weightPct), 0),
  };
}
function strategySpecLevelRow(level, index) {
  return {
    levelId: text(firstValue(level.level_id, level.levelId), `level_${index + 1}`),
    label: text(firstValue(level.label, level.name), `Niveau ${index + 1}`),
    lower: number(level.lower, 0),
    upper: number(level.upper, 0),
    role: strategyLevelRole(level.role),
  };
}
function strategyRuleState(value) {
  const state = upper(value);
  if (state === "DISABLED") return "DISABLED";
  return state === "WATCH" ? "WATCH" : "ACTIVE";
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
function firstValue(...values) { for (const value of values) if (value !== null && value !== undefined && value !== "") return value; return undefined; }
function nested(source, path) { let value = source; for (const key of path) { if (!value || typeof value !== "object") return undefined; value = value[key]; } return value; }
function average(values) { const finite = values.filter((item) => Number.isFinite(item)); return finite.length ? Math.round(finite.reduce((a, b) => a + b, 0) / finite.length) : 0; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullableNumber(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function latestTimestamp(items, keys) {
  return rows(items)
    .flatMap((item) => keys.map((key) => item?.[key]).filter(Boolean))
    .map((value) => String(value))
    .sort()
    .at(-1) || null;
}
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
function performanceTradeItem(item, index = 0) {
  const resultR = firstValue(item.resultR, item.realized_R, item.pnlR);
  const positionId = firstValue(item.positionId, item.position_id);
  return explorerItem({
    id: firstValue(item.tradeId, item.trade_id, positionId, `trade-${index + 1}`),
    title: `${text(firstValue(item.instrument, item.instrument_code, item.symbol), "Trade")} · ${text(firstValue(item.direction, item.side), "—")}`,
    subtitle: text(firstValue(item.closedAt, item.closed_at_utc, item.exit_at_utc, item.openedAt, item.opened_at_utc), "Horodatage indisponible"),
    status: tradeResultStatus(resultR),
    primary: `${signedNumber(resultR)} R`,
    secondary: text(firstValue(item.exitReason, item.exit_reason), "Sortie non publiée"),
    route: positionId ? `/execution/portfolio/positions/${encodeURIComponent(String(positionId))}` : undefined,
    tags: [firstValue(item.strategyId, item.strategy_id), item.session],
  });
}
function tradeResultStatus(resultR) {
  const value = number(resultR, 0);
  if (value > 0) return "WIN";
  return value < 0 ? "LOSS" : "FLAT";
}
function upper(value) { return String(value ?? "").toUpperCase(); }
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
