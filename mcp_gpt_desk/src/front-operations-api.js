import { z } from "zod";
import { frontAgentRuntimeMethodAllowed, handleFrontAgentRuntime, isFrontAgentRuntimePath, isFrontAgentRuntimeWriteRequest } from "./front-agent-runtime-api.js";
import { FRONT_RESEARCH_STATIC_PATHS, frontOperationsResearchMethodAllowed, handleFrontOperationsResearch, isFrontOperationsResearchPath } from "./front-operations-research-api.js";
import { frontSimulationRunMethodAllowed, handleFrontSimulationRuns, isFrontSimulationRunPath } from "./front-simulation-runs-api.js";
import { buildAiContextOverviewFromStore } from "./front-ai-context-projection.js";
import { buildPortfolioRiskOverviewFromStore } from "./front-portfolio-risk-projection.js";
export const FRONT_OPERATIONS_PREFIX = "/api/v1"; export const FRONT_OPERATIONS_EVENTS_PATH = "/api/v1/events";

const STATIC_PATHS = new Set([
  "/api/v1/operations/summary",
  "/api/v1/workflows",
  "/api/v1/replays",
  "/api/v1/replay-preparations",
  "/api/v1/claim-lanes",
  "/api/v1/gpt-processes",
  "/api/v1/observability/overview",
  "/api/v1/observability/policy",
  "/api/v1/ai/runtime-settings",
  "/api/v1/observability/incidents/evaluate",
  "/api/v1/performance/overview", "/api/v1/replays/compare",
  "/api/v1/incidents",
  "/api/v1/notifications",
  "/api/v1/notifications/sync",
  "/api/v1/telegram",
  "/api/v1/telegram/actions",
  "/api/v1/runbooks",
  "/api/v1/history/sessions",
  "/api/v1/strategies",
  "/api/v1/strategy-v2/overview",
  "/api/v1/strategy-v2/definitions",
  "/api/v1/strategy-v2/versions",
  "/api/v1/strategy-v2/instances", "/api/v1/strategy-v2/signals", "/api/v1/strategy-v2/audit", "/api/v1/prompt-registry/overview",
  "/api/v1/portfolio-risk/overview", "/api/v1/ai-context/overview",
  ...FRONT_RESEARCH_STATIC_PATHS,
  "/api/v1/data-foundation/overview", "/api/v1/data-foundation/sources", "/api/v1/data-foundation/ingestion-batches",
  "/api/v1/data-foundation/datasets", "/api/v1/data-foundation/features", "/api/v1/data-foundation/feature-computations",
  "/api/v1/data-foundation/market-data-profiles", "/api/v1/data-foundation/storage-objects", "/api/v1/data-foundation/hot-series-windows", "/api/v1/data-foundation/feature-values",
  "/api/v1/execution/overview", "/api/v1/execution/actions",
  "/api/v1/execution/bridge/heartbeat", "/api/v1/execution/bridge/claim", "/api/v1/execution/bridge/complete", "/api/v1/execution/bridge/events", "/api/v1/execution/bridge/reconcile",
  "/api/v1/execution/addon/heartbeat", "/api/v1/execution/addon/claim", "/api/v1/execution/addon/complete", "/api/v1/execution/addon/events", "/api/v1/execution/addon/snapshot",
  FRONT_OPERATIONS_EVENTS_PATH,
]);

export function isFrontOperationsPath(pathname) {
  return STATIC_PATHS.has(pathname)
    || /^\/api\/v1\/workflows\/[^/]+(?:\/(?:steps|events|actions))?$/.test(pathname)
    || /^\/api\/v1\/replays\/[^/]+(?:\/(?:timeline|price-series|days|actions))?$/.test(pathname)
    || isFrontSimulationRunPath(pathname)
    || /^\/api\/v1\/replay-preparations\/[^/]+(?:\/actions)?$/.test(pathname)
    || /^\/api\/v1\/claim-lanes\/(?:live|replay)\/actions$/.test(pathname)
    || isFrontAgentRuntimePath(pathname)
    || /^\/api\/v1\/replays\/[^/]+\/days\/\d{4}-\d{2}-\d{2}$/.test(pathname)
    || /^\/api\/v1\/replays\/[^/]+\/sessions\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/gpt-processes\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/incidents\/[^/]+\/actions$/.test(pathname)
    || /^\/api\/v1\/notifications\/[^/]+\/actions$/.test(pathname)
    || /^\/api\/v1\/runbooks\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/history\/sessions\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/definitions\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/versions\/[^/]+(?:\/actions)?$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/instances\/[^/]+(?:\/actions)?$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/signals\/[^/]+\/actions$/.test(pathname)
    || isFrontOperationsResearchPath(pathname)
    || /^\/api\/v1\/strategies\/[^/]+\/versions\/compare$/.test(pathname)
    || /^\/api\/v1\/execution\/intents\/[^/]+$/.test(pathname);
}

export function isFrontOperationsWriteRequest(pathname, method) {
  if (method !== "POST") return false;
  return pathname === "/api/v1/replays"
    || pathname === "/api/v1/replay-preparations"
    || /^\/api\/v1\/claim-lanes\/(?:live|replay)\/actions$/.test(pathname)
    || isFrontAgentRuntimeWriteRequest(pathname, method)
    || pathname === "/api/v1/observability/policy"
    || pathname === "/api/v1/ai/runtime-settings"
    || pathname === "/api/v1/observability/incidents/evaluate"
    || pathname === "/api/v1/notifications/sync"
    || pathname === "/api/v1/strategy-v2/definitions"
    || pathname === "/api/v1/strategy-v2/versions"
    || pathname === "/api/v1/strategy-v2/instances"
    || /^\/api\/v1\/strategy-v2\/versions\/[^/]+\/actions$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/instances\/[^/]+\/actions$/.test(pathname)
    || /^\/api\/v1\/strategy-v2\/signals\/[^/]+\/actions$/.test(pathname)
    || pathname.endsWith("/actions")
    || pathname.startsWith("/api/v1/execution/bridge/")
    || pathname.startsWith("/api/v1/execution/addon/");
}

export function isFrontOperationsMethodAllowed(pathname, method) {
  if (pathname === FRONT_OPERATIONS_EVENTS_PATH) return method === "GET";
  if (pathname === "/api/v1/replays") return method === "GET" || method === "POST";
  if (pathname === "/api/v1/replay-preparations") return method === "GET" || method === "POST";
  if (pathname === "/api/v1/claim-lanes") return method === "GET";
  const agentRuntimeMethodAllowed = frontAgentRuntimeMethodAllowed(pathname, method); if (agentRuntimeMethodAllowed !== null) return agentRuntimeMethodAllowed;
  if (pathname === "/api/v1/observability/policy") return method === "GET" || method === "POST";
  if (pathname === "/api/v1/ai/runtime-settings") return method === "GET" || method === "POST";
  if (pathname === "/api/v1/observability/incidents/evaluate") return method === "POST";
  if (pathname === "/api/v1/notifications/sync") return method === "POST";
  if (pathname === "/api/v1/telegram") return method === "GET";
  if (pathname === "/api/v1/telegram/actions") return method === "POST";
  if (pathname === "/api/v1/strategy-v2/overview") return method === "GET";
  if (pathname === "/api/v1/strategy-v2/audit") return method === "GET";
  if (pathname === "/api/v1/strategy-v2/signals") return method === "GET";
  if (pathname === "/api/v1/prompt-registry/overview") return method === "GET";
  if (pathname === "/api/v1/portfolio-risk/overview" || pathname === "/api/v1/ai-context/overview") return method === "GET";
  const researchMethodAllowed = frontOperationsResearchMethodAllowed(pathname, method);
  if (researchMethodAllowed !== null) return researchMethodAllowed;
  const simulationRunMethodAllowed = frontSimulationRunMethodAllowed(pathname, method); if (simulationRunMethodAllowed !== null) return simulationRunMethodAllowed;
  if (pathname.startsWith("/api/v1/data-foundation/")) return method === "GET";
  if (["/api/v1/strategy-v2/definitions", "/api/v1/strategy-v2/versions", "/api/v1/strategy-v2/instances"].includes(pathname)) return method === "GET" || method === "POST";
  if (/^\/api\/v1\/strategy-v2\/(?:definitions|versions|instances)\/[^/]+$/.test(pathname)) return method === "GET";
  if (/^\/api\/v1\/strategy-v2\/(?:versions|instances)\/[^/]+\/actions$/.test(pathname)) return method === "POST";
  if (/^\/api\/v1\/strategy-v2\/signals\/[^/]+\/actions$/.test(pathname)) return method === "POST";
  if (pathname === "/api/v1/execution/overview" || /^\/api\/v1\/execution\/intents\/[^/]+$/.test(pathname)) return method === "GET";
  if (pathname === "/api/v1/execution/actions" || pathname.startsWith("/api/v1/execution/bridge/") || pathname.startsWith("/api/v1/execution/addon/")) return method === "POST";
  if (pathname.endsWith("/actions")) return method === "POST";
  return method === "GET";
}

export async function handleFrontOperations(store, { pathname, method, query = {}, body = {}, actor = {} }) {
  if (pathname === "/api/v1/operations/summary") return store.getOperationsSummary(filters(query));
  if (pathname === "/api/v1/workflows") return store.listOperationsWorkflows(filters(query));

  let match = pathname.match(/^\/api\/v1\/workflows\/([^/]+)(?:\/(steps|events|actions))?$/);
  if (match) {
    const workflowId = decode(match[1]);
    if (match[2] === "actions") return store.executeOperationsWorkflowAction({ workflow_id: workflowId, input: body, actor });
    const detail = await store.getOperationsWorkflow({ workflow_id: workflowId });
    if (match[2] === "steps") return response("DeskWorkflowStepList", { workflowId, count: detail.steps.length, items: detail.steps });
    if (match[2] === "events") return response("DeskWorkflowEventList", { workflowId, count: detail.events.length, items: detail.events });
    return detail;
  }

  if (pathname === "/api/v1/replays") {
    if (method === "POST") return store.createOrchestratedReplayDay(parseReplayCreateInput(body));
    return store.listOperationsReplays(filters(query));
  }
  if (pathname === "/api/v1/replay-preparations") {
    if (method === "POST") return store.createReplayPreparation(parseReplayPreparationInput(body));
    return store.listReplayPreparations({
      status: query.status || null,
      session: query.session || null,
      date: query.date || null,
      limit: query.limit ? Number(query.limit) : 100,
    });
  }
  if (pathname === "/api/v1/claim-lanes") return store.getClaimLanesOverview();
  match = pathname.match(/^\/api\/v1\/claim-lanes\/(live|replay)\/actions$/);
  if (match) {
    const input = parseClaimLaneAction(body);
    return store.executeClaimLaneAction({ lane: match[1], ...input, actor });
  }
  const agentRuntime = await handleFrontAgentRuntime(store, { pathname, method, query, body, actor }); if (agentRuntime.handled) return agentRuntime.result;
  match = pathname.match(/^\/api\/v1\/replay-preparations\/([^/]+)(?:\/(actions))?$/);
  if (match) {
    const preparationId = decode(match[1]);
    if (match[2] === "actions") {
      const input = parseReplayPreparationAction(body);
      return store.executeReplayPreparationAction({ preparation_id: preparationId, ...input, actor });
    }
    return store.getReplayPreparation({ preparation_id: preparationId });
  }
  if (pathname === "/api/v1/replays/compare") return store.compareOperationsReplays({ ids: listQuery(query.ids || query.id) });

  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (match) return store.getOperationsReplayDay({ run_id: decode(match[1]), date: match[2] });
  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)\/sessions\/([^/]+)$/);
  if (match) return store.getOperationsReplaySession({ run_id: decode(match[1]), session_execution_id: decode(match[2]) });
  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)(?:\/(timeline|price-series|days|actions))?$/);
  if (match) {
    const runId = decode(match[1]);
    if (match[2] === "timeline") return store.getOperationsReplayTimeline({ run_id: runId });
    if (match[2] === "price-series") return store.getOperationsReplayPriceSeries({ run_id: runId });
    if (match[2] === "days") return store.getOperationsReplayDays({ run_id: runId });
    if (match[2] === "actions") return store.executeOperationsWorkflowAction({ workflow_id: `replay:${runId}`, input: body, actor });
    return store.getOperationsReplay({ run_id: runId });
  }

  if (pathname === "/api/v1/gpt-processes") return store.listOperationsGptProcesses({ ...filters(query), runId: query.run_id || query.runId || null });
  match = pathname.match(/^\/api\/v1\/gpt-processes\/([^/]+)$/);
  if (match) return store.getOperationsGptProcess({ process_id: decode(match[1]) });

  if (pathname === "/api/v1/observability/overview") return store.getOperationsObservability(filters(query));
  if (pathname === "/api/v1/observability/policy") {
    if (method === "POST") return store.executeOperationsObservabilityPolicyAction({ input: parseObservabilityPolicyAction(body), actor });
    return store.getOperationsObservabilityPolicy();
  }
  if (pathname === "/api/v1/ai/runtime-settings") {
    if (method === "POST") return store.executeOperationsAiRuntimeSettingsAction({ input: parseAiRuntimeSettingsAction(body), actor });
    return store.getOperationsAiRuntimeSettings();
  }
  if (pathname === "/api/v1/observability/incidents/evaluate") {
    return store.evaluateOperationsObservabilityIncidents({ input: parseObservabilityIncidentEvaluateInput(body), actor });
  }
  if (pathname === "/api/v1/performance/overview") return store.getOperationsPerformance(filters(query));
  if (pathname === "/api/v1/incidents") return store.listOperationsIncidents(filters(query));
  const simulationRuns = await handleFrontSimulationRuns(store, { pathname, query }); if (simulationRuns.handled) return simulationRuns.result;
  match = pathname.match(/^\/api\/v1\/incidents\/([^/]+)\/actions$/);
  if (match) return store.executeOperationsIncidentAction({ incident_id: decode(match[1]), input: body, actor });
  if (pathname === "/api/v1/notifications") return store.listOperationsNotifications(filters(query));
  if (pathname === "/api/v1/notifications/sync") {
    return store.syncOperationsNotifications({ input: parseNotificationSyncInput(body), actor });
  }
  match = pathname.match(/^\/api\/v1\/notifications\/([^/]+)\/actions$/);
  if (match) return store.executeOperationsNotificationAction({ notification_id: decode(match[1]), input: body, actor });
  if (pathname === "/api/v1/telegram") return store.getTelegramStatus();
  if (pathname === "/api/v1/telegram/actions") return store.executeTelegramAction({ input: parseTelegramAction(body), actor });
  if (pathname === "/api/v1/runbooks") return store.listOperationsRunbooks(filters(query));
  match = pathname.match(/^\/api\/v1\/runbooks\/([^/]+)$/);
  if (match) return store.getOperationsRunbook({ runbook_id: decode(match[1]) });
  if (pathname === "/api/v1/history/sessions") return store.getOperationsHistory(filters(query));
  match = pathname.match(/^\/api\/v1\/history\/sessions\/([^/]+)$/);
  if (match) return store.getOperationsHistorySession({ session_id: decode(match[1]) });
  if (pathname === "/api/v1/strategies") return store.listOperationsStrategies();
  if (pathname === "/api/v1/strategy-v2/overview") return store.getStrategyV2Overview(strategyV2Query(query));
  if (pathname === "/api/v1/strategy-v2/definitions") {
    if (method === "POST") return store.createStrategyV2Definition({ input: parseStrategyDefinitionInput(body), actor });
    return store.listStrategyV2Definitions(strategyV2Query(query));
  }
  match = pathname.match(/^\/api\/v1\/strategy-v2\/definitions\/([^/]+)$/);
  if (match) return store.getStrategyV2Definition({ strategy_definition_id: decode(match[1]) });
  if (pathname === "/api/v1/strategy-v2/versions") {
    if (method === "POST") return store.createStrategyV2Version({ input: parseStrategyVersionInput(body), actor });
    return store.listStrategyV2Versions(strategyV2Query(query));
  }
  match = pathname.match(/^\/api\/v1\/strategy-v2\/versions\/([^/]+)(?:\/(actions))?$/);
  if (match) {
    const strategyVersionId = decode(match[1]);
    if (match[2] === "actions") return store.executeStrategyV2VersionAction({ strategy_version_id: strategyVersionId, input: parseStrategyVersionAction(body), actor });
    return store.getStrategyV2Version({ strategy_version_id: strategyVersionId });
  }
  if (pathname === "/api/v1/strategy-v2/instances") {
    if (method === "POST") return store.createStrategyV2Instance({ input: parseStrategyInstanceInput(body), actor });
    return store.listStrategyV2Instances(strategyV2Query(query));
  }
  if (pathname === "/api/v1/strategy-v2/signals") return store.pollStrategyV2Signals(strategyV2Query(query));
  match = pathname.match(/^\/api\/v1\/strategy-v2\/instances\/([^/]+)(?:\/(actions))?$/);
  if (match) {
    const strategyInstanceId = decode(match[1]);
    if (match[2] === "actions") return store.executeStrategyV2InstanceAction({ strategy_instance_id: strategyInstanceId, input: parseStrategyInstanceAction(body), actor });
    return store.getStrategyV2Instance({ strategy_instance_id: strategyInstanceId });
  }
  match = pathname.match(/^\/api\/v1\/strategy-v2\/signals\/([^/]+)\/actions$/);
  if (match) return store.consumeStrategyV2Signal({ signal_outbox_id: decode(match[1]), input: parseStrategySignalAction(body), actor });
  if (pathname === "/api/v1/strategy-v2/audit") return store.listStrategyV2AuditEvents(strategyV2Query(query));
  if (pathname === "/api/v1/prompt-registry/overview") return store.getPromptRegistryOverview();
  if (pathname === "/api/v1/portfolio-risk/overview") return buildPortfolioRiskOverviewFromStore(store, filters(query)); if (pathname === "/api/v1/ai-context/overview") return buildAiContextOverviewFromStore(store, filters(query));
  const researchResult = await handleFrontOperationsResearch(store, { pathname, method, query, body, actor });
  if (researchResult.handled) return researchResult.result;
  if (pathname === "/api/v1/data-foundation/overview") return store.getDataFoundationOverview(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/sources") return store.listDataFoundationSources(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/ingestion-batches") return store.listDataFoundationIngestionBatches(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/datasets") return store.listDataFoundationDatasets(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/features") return store.listDataFoundationFeatures(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/feature-computations") return store.listDataFoundationFeatureComputations(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/market-data-profiles") return store.listDataFoundationMarketDataProfiles(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/storage-objects") return store.listDataFoundationStorageObjects(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/hot-series-windows") return store.listDataFoundationHotSeriesWindows(dataFoundationQuery(query, actor));
  if (pathname === "/api/v1/data-foundation/feature-values") return store.listDataFoundationFeatureValues(dataFoundationQuery(query, actor));
  match = pathname.match(/^\/api\/v1\/strategies\/([^/]+)\/versions\/compare$/);
  if (match) return store.compareOperationsStrategyVersions({ strategy_id: decode(match[1]), left: query.left, right: query.right });
  if (pathname === "/api/v1/execution/overview") return store.getExecutionOverview(filters(query));
  match = pathname.match(/^\/api\/v1\/execution\/intents\/([^/]+)$/);
  if (match) return store.getExecutionIntent({ intent_id: decode(match[1]) });
  if (pathname === "/api/v1/execution/actions") return store.executeBrokerAction({ input: parseExecutionAction(body), actor });
  if (pathname === "/api/v1/execution/bridge/heartbeat") return store.recordBrokerHeartbeat(parseBridgeHeartbeat(body));
  if (pathname === "/api/v1/execution/bridge/claim") return store.claimBrokerExecution(parseBridgeClaim(body));
  if (pathname === "/api/v1/execution/bridge/complete") return store.completeBrokerExecution(parseBridgeComplete(body));
  if (pathname === "/api/v1/execution/bridge/events") return store.recordBrokerOrderEvent(parseBridgeEvent(body));
  if (pathname === "/api/v1/execution/bridge/reconcile") return store.reconcileBrokerExecution(parseBridgeReconcile(body));
  if (pathname === "/api/v1/execution/addon/heartbeat") return store.recordNinjaAddonHeartbeat(parseAddonHeartbeat(body));
  if (pathname === "/api/v1/execution/addon/claim") return store.claimNinjaAddonExecution(parseAddonClaim(body));
  if (pathname === "/api/v1/execution/addon/complete") return store.completeNinjaAddonExecution(parseBridgeComplete(body));
  if (pathname === "/api/v1/execution/addon/events") return store.recordNinjaAddonEvents(parseAddonEvents(body));
  if (pathname === "/api/v1/execution/addon/snapshot") return store.recordNinjaAddonSnapshot(parseAddonSnapshot(body));
  throw Object.assign(new Error(`Front operations route not found: ${pathname}`), { code: "NOT_FOUND", statusCode: 404 });
}

const replayCreateSchema = z.object({
  backtest_id: z.string().min(3).max(200),
  replay_run_id: z.string().min(3).max(200).optional(),
  run_id: z.string().min(3).max(200).optional(),
  strategy_id: z.string().min(2).max(200),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(["asia_open", "ny_open"]),
  pack_id: z.string().min(3).max(300),
  pack_build_id: z.string().min(3).max(300),
  start_time: z.string().min(5).max(50),
  end_time: z.string().min(5).max(50),
  cutoff_paris: z.string().min(5).max(50).optional(),
  timezone: z.string().min(3).max(80).default("Europe/Paris"),
  cadence: z.enum(["5m", "15m", "30m", "60m"]).default("15m"),
  automation_enabled: z.boolean().default(true),
  idempotency_key: z.string().min(8).max(200),
}).strict();

const replayPreparationSchema = z.object({
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessions: z.array(z.enum(["asia_open", "ny_open"])).min(1).max(2).optional(),
  cadence: z.enum(["5m", "15m", "30m", "60m"]).default("15m"),
  worker_group: z.literal("replay-v4").default("replay-v4"),
  priority: z.number().int().min(1).max(999).default(100),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES", "NQ", "ES"]),
  idempotency_key: z.string().min(8).max(200),
}).strict();

const replayPreparationActionSchema = z.object({
  action: z.enum(["publish", "retry", "cancel"]),
}).strict();

const claimLaneActionSchema = z.object({
  action: z.enum(["pause", "resume"]),
  expected_revision: z.number().int().min(0),
  reason: z.string().min(3).max(500),
}).strict();

const observabilityPolicyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  queueWarningMs: z.number().int().min(60_000).max(86_400_000).optional(),
  executionWarningMs: z.number().int().min(60_000).max(86_400_000).optional(),
  leaseExpiringMs: z.number().int().min(30_000).max(1_800_000).optional(),
  telemetryCoverageWarningPct: z.number().int().min(0).max(100).optional(),
  costCoverageMinimumPct: z.number().int().min(0).max(100).optional(),
  failureRateWarningPct: z.number().int().min(0).max(100).optional(),
  dailyCostBudgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  monthlyCostBudgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "policy doit contenir au moins une règle" });

const observabilityPolicyActionSchema = z.object({
  action: z.literal("update"),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(200),
  confirmationPhrase: z.literal("CONFIRM_UPDATE"),
  reason: z.string().min(3).max(500),
  policy: observabilityPolicyPatchSchema,
}).strict();

const aiRuntimeSettingsActionSchema = z.object({
  action: z.literal("update_reasoning_effort"),
  expectedRevision: z.number().int().min(0),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]),
  idempotencyKey: z.string().min(8).max(200),
  confirmationPhrase: z.literal("CONFIRM_UPDATE_REASONING_EFFORT"),
  reason: z.string().min(3).max(500),
}).strict();

const observabilityIncidentEvaluateSchema = z.object({
  autoResolve: z.boolean().default(true),
  syncNotifications: z.boolean().default(true),
  reason: z.string().min(3).max(500).optional(),
}).strict();

const notificationSyncSchema = z.object({
  autoClear: z.boolean().default(true),
  limit: z.number().int().min(1).max(1000).optional(),
  reason: z.string().min(3).max(500).optional(),
}).strict();

const telegramActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("configure"),
    expectedRevision: z.number().int().min(0),
    enabled: z.boolean(),
    adminEnabled: z.boolean(),
    tradingEnabled: z.boolean(),
    commandsEnabled: z.boolean(),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_TELEGRAM_CONFIGURATION"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("mute"),
    expectedRevision: z.number().int().min(0),
    minutes: z.number().int().min(1).max(10080),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_TELEGRAM_MUTE"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("resume"),
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_TELEGRAM_RESUME"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("test"),
    profile: z.enum(["admin", "trading"]),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_TELEGRAM_TEST"),
    reason: z.string().min(3).max(500),
  }).strict(),
]);

const strategyDefinitionSchema = z.object({
  strategy_definition_id: z.string().uuid(),
  external_key: z.string().min(3).max(128),
  name: z.string().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  owner: z.string().min(3).max(200),
  asset_class: z.string().min(2).max(80).optional(),
  default_instruments: z.array(z.string().min(1).max(32)).max(32).default([]),
  tags: z.array(z.string().min(1).max(64)).max(64).default([]),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.string().min(3).max(500),
}).strict();

const strategyVersionSchema = z.object({
  strategy_version_id: z.string().uuid(),
  strategy_definition_id: z.string().uuid(),
  version_label: z.string().min(1).max(80),
  status: z.enum(["DRAFT", "IN_SIMULATION", "VALIDATED", "PUBLISHED", "DEPRECATED"]).default("DRAFT"),
  dsl_source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  compiled_artifact_ref: z.string().min(3).max(500),
  compiled_artifact_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().optional(),
  validated_metrics_ref: z.string().uuid().nullable().optional(),
  runtime_contract_bundle_version: z.string().min(1).max(120),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  published_at: z.string().datetime({ offset: true }).optional(),
  deprecated_at: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.string().min(3).max(500),
}).strict();

const strategyVersionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("transition_status"), nextStatus: z.enum(["DRAFT", "IN_SIMULATION", "VALIDATED", "PUBLISHED", "DEPRECATED"]), validatedMetricsRef: z.string().uuid().nullable().optional(), updatedAt: z.string().datetime({ offset: true }).optional(), idempotencyKey: z.string().min(8).max(200), reason: z.string().min(3).max(500) }).strict(),
  z.object({ action: z.literal("compile_dsl"), dslSource: z.union([z.string().min(2), z.record(z.unknown())]), runtimeBindings: z.record(z.unknown()).default({}), scope: z.record(z.unknown()).default({}), sourceMode: z.enum(["SHADOW", "PAPER", "LIVE"]).default("PAPER"), idempotencyKey: z.string().min(8).max(200), reason: z.string().min(3).max(500) }).strict(),
]);

const strategyInstanceSchema = z.object({
  strategy_instance_id: z.string().uuid(),
  strategy_version_id: z.string().uuid(),
  runtime_state: z.enum(["CREATED", "STARTING", "RUNNING", "PAUSED", "STOPPING", "STOPPED", "FAILED_TO_START", "ERRORED"]).default("CREATED"),
  execution_mode: z.enum(["SHADOW", "PAPER", "LIVE"]).default("SHADOW"),
  account_scope: z.string().min(3).max(200).nullable().optional(),
  instrument_scope: z.array(z.string().min(1).max(32)).max(64).default([]),
  session_scope: z.array(z.string().min(1).max(64)).max(64).default([]),
  risk_budget_ref: z.string().uuid().nullable().optional(),
  triple_lock_validated: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
  last_heartbeat_at: z.string().datetime({ offset: true }).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  stopped_at: z.string().datetime({ offset: true }).optional(),
  failed_at: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.string().min(3).max(500),
}).strict();

const strategyInstanceActionSchema = z.object({
  action: z.literal("transition"),
  nextRuntimeState: z.enum(["CREATED", "STARTING", "RUNNING", "PAUSED", "STOPPING", "STOPPED", "FAILED_TO_START", "ERRORED"]).optional(),
  nextExecutionMode: z.enum(["SHADOW", "PAPER", "LIVE"]).optional(),
  accountScope: z.string().min(3).max(200).nullable().optional(),
  tripleLockValidated: z.boolean().optional(),
  operatorApprovalId: z.string().min(3).max(200).optional(),
  lastHeartbeatAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(8).max(200),
  reason: z.string().min(3).max(500),
}).strict().refine((value) => Boolean(value.nextRuntimeState || value.nextExecutionMode), {
  message: "At least one runtime or execution mode transition is required.",
});

const executionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("materialize"), scope: z.object({ run_id: z.string().optional(), trading_date: z.string().optional(), session: z.string().optional() }).strict().optional() }).strict(),
  z.object({ action: z.literal("materialize_management"), monitorId: z.string().min(3).optional(), limit: z.number().int().min(1).max(500).optional(), scope: z.object({ strategy_id: z.string().optional(), trading_date: z.string().optional(), session: z.string().optional() }).strict().optional() }).strict(),
  z.object({ action: z.literal("evaluate"), decisionId: z.string().min(8), accountId: z.string().optional(), policyProfileId: z.string().optional() }).strict(),
  z.object({
    action: z.literal("configure_sizing"),
    policyProfileId: z.string().min(3).max(200).default("ninjatrader_sim101_local"),
    expectedRevision: z.number().int().min(0),
    riskPercent: z.number().min(0.01).max(0.25),
    maxRoundingExcessPercent: z.number().min(0).max(0.25).default(0.25),
    maxDecisionAgeSeconds: z.number().int().min(5).max(3_600).default(120),
    fallbackCapitalEnabled: z.boolean(),
    fallbackCapital: z.number().min(100).max(100_000_000),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_SIM101_SIZING_POLICY"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("configure_execution_mode"),
    policyProfileId: z.string().min(3).max(200).default("ninjatrader_sim101_local"),
    expectedRevision: z.number().int().min(0),
    mode: z.enum(["semi_auto", "auto"]),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_SIM101_EXECUTION_MODE"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("configure_ninjatrader_startup"),
    enabled: z.boolean(),
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().min(8).max(200),
    confirmationPhrase: z.literal("CONFIRM_NINJATRADER_AUTOSTART"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({ action: z.literal("approve"), intentId: z.string().min(8), idempotencyKey: z.string().min(8), confirmationPhrase: z.literal("CONFIRM_SIM101_ORDER"), reason: z.string().min(3).max(500) }).strict(),
  z.object({ action: z.literal("reject"), intentId: z.string().min(8), idempotencyKey: z.string().min(8), confirmationPhrase: z.literal("CONFIRM_REJECT"), reason: z.string().min(3).max(500) }).strict(),
  z.object({ action: z.literal("approve_management"), managementIntentId: z.string().min(8), idempotencyKey: z.string().min(8), confirmationPhrase: z.literal("CONFIRM_SIM101_MANAGEMENT"), reason: z.string().min(3).max(500) }).strict(),
  z.object({ action: z.literal("reject_management"), managementIntentId: z.string().min(8), idempotencyKey: z.string().min(8), confirmationPhrase: z.literal("CONFIRM_REJECT"), reason: z.string().min(3).max(500) }).strict(),
  z.object({ action: z.literal("kill_switch"), locked: z.boolean(), confirmationPhrase: z.enum(["ENGAGE_KILL_SWITCH", "RELEASE_SIM101_KILL_SWITCH"]), reason: z.string().min(3).max(500) }).strict(),
]);

const bridgeHeartbeatSchema = z.object({
  bridgeId: z.string().min(3).max(200), brokerAccountId: z.string().min(3).max(200).optional(),
  mode: z.enum(["disabled", "dry_run_file", "sim101_ati_manual_arm", "sim101_ati_approved_only", "sim101_addon_approved_only", "live_read_only_reconciliation", "live_limited_approved_only"]),
  status: z.string().max(50).optional(), hostName: z.string().max(200).optional(), processId: z.number().int().positive().optional(),
  ninjaConnected: z.boolean(), atiEnabled: z.boolean(), accountName: z.string().max(100), version: z.string().max(100).optional(),
}).strict();

const strategySignalActionSchema = z.object({ action: z.literal("consume"), consumerId: z.string().min(3).max(200).optional(), consumedAtUtc: z.string().datetime({ offset: true }).optional(), idempotencyKey: z.string().min(8).max(200), reason: z.string().min(3).max(500) }).strict();

const bridgeClaimSchema = z.object({ bridgeId: z.string().min(3).max(200), accountName: z.string().max(100), leaseSeconds: z.number().int().min(5).max(120).optional() }).strict();
const bridgeCompleteSchema = z.object({
  bridgeId: z.string().min(3).max(200), outboxId: z.string().min(3).max(200), leaseToken: z.string().uuid(),
  workType: z.enum(["entry", "management"]).default("entry"), status: z.enum(["rendered", "delivered", "acknowledged", "failed"]), renderedCommand: z.string().max(2000).optional(), error: z.string().max(1000).optional(),
}).strict();
const bridgeEventSchema = z.object({
  intentId: z.string().min(8).optional(), managementIntentId: z.string().min(8).optional(), managementOrderRef: z.boolean().optional(), brokerOrderId: z.string().optional(), externalEventKey: z.string().min(16).max(128).optional(), update: z.object({
    broker_order_ref: z.string().optional(), order_id: z.string().optional(), status: z.string().optional(), order_state: z.string().optional(),
    filled_quantity: z.union([z.number(), z.string()]).optional(), filled: z.union([z.number(), z.string()]).optional(),
    average_fill_price: z.union([z.number(), z.string()]).optional(), avg_fill_price: z.union([z.number(), z.string()]).optional(),
    remaining_quantity: z.union([z.number(), z.string()]).optional(), remaining: z.union([z.number(), z.string()]).optional(),
    occurred_at: z.string().optional(), timestamp: z.string().optional(),
  }).passthrough(),
}).strict().refine((value) => [Boolean(value.intentId), Boolean(value.managementIntentId), value.managementOrderRef === true].filter(Boolean).length === 1, { message: "Exactly one entry intent, management intent or management order reference is required." });
const bridgeReconcileSchema = z.object({
  bridgeId: z.string().min(3).optional(), brokerAccountId: z.string().min(3).optional(), brokerSnapshot: z.object({
    orders: z.array(z.record(z.unknown())).default([]), positions: z.array(z.record(z.unknown())).default([]), account: z.record(z.unknown()).optional(),
  }).strict(),
  reconciliationMode: z.enum(["disabled", "alert_only", "blocking"]).default("alert_only"),
  triggeredBy: z.enum(["manual", "scheduled", "operator", "bridge", "addon"]).default("bridge"),
  operatorConfirmation: z.string().max(120).optional(),
}).strict();

const addonHeartbeatSchema = z.object({
  bridgeId: z.string().min(3).max(200), brokerAccountId: z.string().min(3).max(200).optional(),
  mode: z.literal("sim101_addon_approved_only").default("sim101_addon_approved_only"),
  status: z.string().max(50).optional(), hostName: z.string().max(200).optional(), processId: z.number().int().positive().optional(),
  ninjaConnected: z.boolean(), commandEnabled: z.boolean().default(false), accountName: z.string().regex(/^Sim\d*$/i).max(100),
  protocolVersion: z.literal("desk_ninja_addon_v1").default("desk_ninja_addon_v1"), capabilities: z.record(z.unknown()).default({}),
}).strict();
const addonClaimSchema = z.object({
  bridgeId: z.string().min(3).max(200), brokerAccountId: z.string().min(3).max(200).optional(),
  accountName: z.string().regex(/^Sim\d*$/i).max(100), leaseSeconds: z.number().int().min(5).max(120).optional(),
}).strict();
const addonEventSchema = z.object({
  event_id: z.string().min(8).max(200).optional(), event_type: z.enum(["order", "execution", "position", "account", "connection", "command"]),
  occurred_at: z.string().datetime({ offset: true }), intent_id: z.string().min(8).max(200).optional(), management_intent_id: z.string().min(8).max(200).optional(),
  command_id: z.string().min(8).max(200).optional(), external_event_key: z.string().min(8).max(256).optional(), payload: z.record(z.unknown()).default({}),
}).strict();
const addonEventsSchema = z.object({
  bridgeId: z.string().min(3).max(200), brokerAccountId: z.string().min(3).max(200).optional(), events: z.array(addonEventSchema).min(1).max(200),
}).strict();
const addonSnapshotSchema = z.object({
  bridgeId: z.string().min(3).max(200), brokerAccountId: z.string().min(3).max(200).optional(), snapshotId: z.string().min(8).max(256).optional(),
  reconcile: z.boolean().default(false), lockOnDivergence: z.boolean().default(false),
  reconciliationMode: z.enum(["disabled", "alert_only", "blocking"]).optional(),
  triggeredBy: z.enum(["manual", "scheduled", "operator", "bridge", "addon"]).default("addon"),
  operatorConfirmation: z.string().max(120).optional(),
  snapshot: z.object({
    captured_at: z.string().datetime({ offset: true }), connection: z.record(z.unknown()).default({}), account: z.record(z.unknown()).default({}),
    orders: z.array(z.record(z.unknown())).default([]), positions: z.array(z.record(z.unknown())).default([]),
  }).strict(),
}).strict();

function parseReplayCreateInput(body) {
  const parsed = replayCreateSchema.safeParse(body);
  if (parsed.success) return { ...parsed.data, date: parsed.data.date || parsed.data.trading_date, cutoff_paris: parsed.data.cutoff_paris || parsed.data.start_time };
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = "INVALID_REPLAY_CREATE_INPUT";
  error.statusCode = 400;
  throw error;
}

function parseReplayPreparationInput(body) {
  return parseBody(replayPreparationSchema, body, "INVALID_REPLAY_PREPARATION");
}

function parseReplayPreparationAction(body) {
  return parseBody(replayPreparationActionSchema, body, "INVALID_REPLAY_PREPARATION_ACTION");
}

function parseClaimLaneAction(body) {
  return parseBody(claimLaneActionSchema, body, "INVALID_CLAIM_LANE_ACTION");
}

function parseObservabilityPolicyAction(body) {
  const parsed = observabilityPolicyActionSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = "INVALID_OBSERVABILITY_POLICY";
  error.statusCode = 400;
  throw error;
}

function parseAiRuntimeSettingsAction(body) {
  return parseBody(aiRuntimeSettingsActionSchema, body, "INVALID_AI_RUNTIME_SETTINGS");
}

function parseObservabilityIncidentEvaluateInput(body) {
  const parsed = observabilityIncidentEvaluateSchema.safeParse(body || {});
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = "INVALID_OBSERVABILITY_INCIDENT_EVALUATION";
  error.statusCode = 400;
  throw error;
}

function parseNotificationSyncInput(body) {
  const parsed = notificationSyncSchema.safeParse(body || {});
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = "INVALID_NOTIFICATION_SYNC";
  error.statusCode = 400;
  throw error;
}

function parseTelegramAction(body) {
  return parseBody(telegramActionSchema, body, "INVALID_TELEGRAM_ACTION");
}

function parseStrategyDefinitionInput(body) { return parseBody(strategyDefinitionSchema, body, "INVALID_STRATEGY_DEFINITION"); }
function parseStrategyVersionInput(body) { return parseBody(strategyVersionSchema, body, "INVALID_STRATEGY_VERSION"); }
function parseStrategyVersionAction(body) { return parseBody(strategyVersionActionSchema, body, "INVALID_STRATEGY_VERSION_ACTION"); }
function parseStrategyInstanceInput(body) { return parseBody(strategyInstanceSchema, body, "INVALID_STRATEGY_INSTANCE"); }
function parseStrategyInstanceAction(body) { return parseBody(strategyInstanceActionSchema, body, "INVALID_STRATEGY_INSTANCE_ACTION"); }
function parseStrategySignalAction(body) { return parseBody(strategySignalActionSchema, body, "INVALID_STRATEGY_SIGNAL_ACTION"); }

function parseExecutionAction(body) { return parseBody(executionActionSchema, body, "INVALID_EXECUTION_ACTION"); }
function parseBridgeHeartbeat(body) { return parseBody(bridgeHeartbeatSchema, body, "INVALID_BRIDGE_HEARTBEAT"); }
function parseBridgeClaim(body) { return parseBody(bridgeClaimSchema, body, "INVALID_BRIDGE_CLAIM"); }
function parseBridgeComplete(body) { return parseBody(bridgeCompleteSchema, body, "INVALID_BRIDGE_COMPLETION"); }
function parseBridgeEvent(body) { return parseBody(bridgeEventSchema, body, "INVALID_BRIDGE_EVENT"); }
function parseBridgeReconcile(body) { return parseBody(bridgeReconcileSchema, body, "INVALID_BRIDGE_RECONCILIATION"); }
function parseAddonHeartbeat(body) { return parseBody(addonHeartbeatSchema, body, "INVALID_ADDON_HEARTBEAT"); }
function parseAddonClaim(body) { return parseBody(addonClaimSchema, body, "INVALID_ADDON_CLAIM"); }
function parseAddonEvents(body) { return parseBody(addonEventsSchema, body, "INVALID_ADDON_EVENTS"); }
function parseAddonSnapshot(body) { return parseBody(addonSnapshotSchema, body, "INVALID_ADDON_SNAPSHOT"); }

function parseBody(schema, body, code) {
  const parsed = schema.safeParse(body || {});
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = code;
  error.statusCode = 400;
  throw error;
}

export function filters(query = {}) {
  return {
    kind: query.kind || null,
    scope: query.scope || null,
    workflow: query.workflow || null,
    worker: query.worker || null,
    model: query.model || null,
    provider: query.provider || null,
    status: query.status || null,
    level: query.level || null,
    session: query.session || null,
    strategyId: query.strategy_id || query.strategyId || null, strategyVersionId: query.strategy_version_id || query.strategyVersionId || null, datasetId: query.dataset_id || query.datasetId || null,
    simulationRunId: query.simulation_run_id || query.simulationRunId || null, artifactKind: query.artifact_kind || query.artifactKind || null,
    versionScope: query.version_scope || query.versionScope || null,
    instrument: query.instrument || null,
    direction: query.direction || null,
    date: query.date || null,
    from: query.from || query.date_from || null,
    to: query.to || query.date_to || null,
    runId: query.run_id || query.runId || null,
    process: query.process || query.process_id || query.work_item_id || query.workItemId || null,
    incident: query.incident || query.incident_id || query.incidentId || null,
    runbook: query.runbook || query.runbook_id || query.runbookId || null,
    target: query.target || query.target_id || query.targetId || null,
    q: query.q || null,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function strategyV2Query(query = {}) { return { ...filters(query), strategy_definition_id: query.strategy_definition_id || query.strategyDefinitionId || null, strategy_version_id: query.strategy_version_id || query.strategyVersionId || null, runtime_state: query.runtime_state || query.runtimeState || null, execution_mode: query.execution_mode || query.executionMode || null, aggregate_type: query.aggregate_type || query.aggregateType || null, aggregate_id: query.aggregate_id || query.aggregateId || null }; }

function dataFoundationQuery(query = {}, actor = {}) {
  return {
    audience: query.audience || "front",
    actor,
    status: query.status || null,
    kind: query.kind || null,
    provider: query.provider || null,
    environment: query.environment || null,
    data_source_id: query.data_source_id || query.dataSourceId || null,
    source_key: query.source_key || query.sourceKey || null,
    dataset_id: query.dataset_id || query.datasetId || null,
    dataset_key: query.dataset_key || query.datasetKey || null,
    feature_key: query.feature_key || query.featureKey || null,
    category: query.category || null,
    entity_key: query.entity_key || query.entityKey || null,
    instrument_code: query.instrument_code || query.instrumentCode || null,
    timeframe: query.timeframe || null,
    blocking_classification: query.blocking_classification || query.blockingClassification || null,
    storage_tier: query.storage_tier || query.storageTier || null,
    storage_format: query.storage_format || query.storageFormat || null,
    from_utc: query.from_utc || query.fromUtc || null,
    to_utc: query.to_utc || query.toUtc || null,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function response(contract, payload) {
  return { contract, schemaVersion: "1.0.0", ...payload };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function listQuery(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
