import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "./persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "./tradingview-webhook.js";
import {
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  normalizeDecision,
} from "@tv-automation/desk-domain";
import { prepareLiveReplanMasterAfterMonitor } from "./live-orchestration.js";
import { DeskContractService } from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import { DeskPackService } from "./desk-pack-service.js";
import { LocalPackBuilder } from "./local-pack-builder.js";
import { deskError } from "./desk-errors.js";
import { DeskLiveService } from "./desk-live-service.js";
import {
  buildLiveSetupMutationDocsFromMonitor,
  materializeTriggeredLiveMonitor,
  reconcileLivePaperExecution,
} from "./live-paper-execution.js";
import { DeskFrontService } from "./desk-front-service.js";
import { FrontOperationsService } from "./front-operations-service.js";
import { buildPromptRegistryOverview } from "./prompt-registry-front-projection.js";
import { BrokerExecutionService } from "./broker-execution-service.js";
import { createBrokerExecutionRepository } from "./broker-execution-repository.js";
import { NinjaTraderStartupControl } from "./ninjatrader-startup-control.js";
import { ClaimLaneService } from "./claim-lane-service.js";
import {
  assertMasterSetupCoverage,
  assertMonitorSetupTransition,
} from "./desk-ai-worker-envelope.js";
import {
  STRATEGY_RUNTIME_VERSIONS,
  canonicalizeMasterStrategyPayload,
  canonicalizeMonitorStrategyPayload,
} from "./canonical-strategy-runtime.js";
import { assertActiveStrategySaveTarget } from "./strategy-runtime-versioning.js";
import { DeskMarketFeatureService } from "./desk-market-feature-service.js";
import { MacroCalendarService } from "./macro-calendar-service.js";
import { NewsIngestionService } from "./news-ingestion-service.js";
import { TelegramAlertService } from "./telegram-alert-service.js";
import { StrategyKernelService } from "./strategy-kernel-service.js";
import { createStrategyKernelRepository } from "./strategy-kernel-repository.js";
import { createAiContextGateRepository } from "./ai-context-gate-repository.js";
import { attachStrategySignalBusStoreMethods } from "./strategy-signal-bus-store-extension.js";
import { DataFoundationService } from "./data-foundation-service.js";
import { createDataFoundationRepository } from "./data-foundation-repository.js";
import { attachResearchLabStoreMethods } from "./research-lab-store-extension.js";
import { attachAgentRuntimeStoreMethods } from "./agent-runtime-store-extension.js";
import { createSimulationRunRegistryService } from "./simulation-run-registry-service.js";
import {
  assertReplayRunMatchesQuery,
  canonicalTimeframe,
  marketFeedCandidates,
  normalizeOperationalQuery,
  publicReplayError,
} from "./desk-market-feature-algorithms.js";
import { DeskStrategyAuditService } from "./desk-strategy-audit-service.js";
import {
  activeThesisVNextId,
  deriveActiveThesisFromMaster,
  missingMasterCutoffBundle,
  NY_OPEN_STRATEGY_ID,
  operationalSelectorArgs,
  resolveOperationalReadScope,
} from "./desk-strategy-audit-algorithms.js";
import {
  compareDeskWorkItems,
  DeskReplayService,
} from "./desk-replay-service.js";
import { ReplayPreparationService } from "./replay-preparation-service.js";
import {
  buildMasterSetupDocs,
  buildSetupDocs,
  deskEnvironment,
  executionScopeFields,
  patchReplayRun,
  replayTimelineEvent,
  selectBacktestSteps,
  selectReplayActiveThesis,
  selectReplayBundles,
  selectReplayMonitors,
  selectReplayPositions,
  selectReplayScopedSetups,
  selectReplayTimeline,
} from "./desk-replay-orchestration-algorithms.js";
import {
  ACTIVE_THESIS_STATUSES,
  assertDocumentMatchesOperationalQuery,
  assertLiveStoreWriteScope,
  buildFrontMasterState,
  buildFrontMonitorState,
  buildLiveDeskState,
  buildOrchestratedReplayState,
  claimNextDeskWorkFacade,
  hourlyMonitorVNextId,
  markThesisExpired,
  masterAnalysisVNextId,
  normalizeDeskJob,
  patchDeskJob,
  selectActivePosition,
  selectActiveTheses,
  selectAlerts,
  selectDeskJobs,
  selectExpiredTheses,
  selectLatestHourlyMonitors,
  selectLatestMasterAnalysis,
  selectReplaySimulations,
  splitPositionStateFromThesis,
  withOperationalMetadata,
  writeTimestamps,
} from "./desk-state-algorithms.js";
import {
  buildBacktestRunDoc,
  buildBacktestStepDoc,
  finalizeBacktestRun,
  markBacktestStepDone,
  markBacktestStepFailed,
  markBacktestStepRunning,
  selectBacktest,
  selectBacktestCandidateSetups,
  selectBacktestResults,
  selectBacktests,
  selectSimulatedTrades,
  replayPositionToSimulatedTrade,
  simulatedTradeFromReplay,
  summarizeBacktestTrades,
  summarizeReplayPositionTrades,
  summarizeReplayState,
  updateBacktestProgress,
} from "./desk-backtest-algorithms.js";
import {
  assertOperationalDocumentScope,
  buildManualMonitorBundle,
  buildMasterCutoffBundle,
  manualMonitorCheckpoint,
  masterPrepJobCompleted,
  masterPrepJobStarted,
  monitorPrepJobCompleted,
  monitorPrepJobFailed,
  monitorPrepJobLocked,
  monitorPrepJobStarted,
  normalizeManualMonitor,
  selectLatestManualMonitors,
  selectMasterCutoffBundle,
  summarizeReplayBundlePrep,
} from "./desk-live-bundle-algorithms.js";
import { projectLiveBundle } from "./live-bundle-view.js";
import {
  filterSetupDocs,
  normalizeDeskAnalysis,
  stableLocalId,
  stripDeskWorkLease,
} from "./desk-document-algorithms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(__dirname, "..");
const COLLECTIONS = DESK_COLLECTIONS;
const FRONT_LIVE_STATE_CACHE_TTL_MS = Math.max(0, Math.min(Number(process.env.DESK_FRONT_LIVE_STATE_CACHE_TTL_MS) || 10_000, 60_000));
const DEFAULT_LIVE_CLAIM_RETRY_ATTEMPTS = 3;
const DEFAULT_LIVE_CLAIM_RETRY_DELAY_SECONDS = 60;

function shouldProjectLiveBundle(args = {}) {
  return args.view === "compact"
    || Boolean(args.bundle_id && args.include_raw_refs === false);
}

function strategyKernelResponse(contract, payload = {}) {
  return {
    contract,
    schemaVersion: "strategy_registry_rest_v2",
    ...payload,
  };
}

function dataFoundationResponse(contract, payload = {}) {
  return {
    contract,
    schemaVersion: "data_foundation_rest_v1",
    count: Array.isArray(payload.items) ? payload.items.length : payload.count,
    ...payload,
  };
}

function commandActor(input = {}, actor = {}) {
  return {
    idempotency_key: input.idempotencyKey || input.idempotency_key || null,
    actor: actor.email || actor.uid || actor.kind || "operator",
    reason: input.reason || null,
  };
}

function groupByKey(items = [], key) {
  return items.reduce((groups, item) => {
    const value = item?.[key];
    if (!value) return groups;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
    return groups;
  }, new Map());
}

function firstByStatus(items = [], status) {
  return items.find((item) => String(item?.status || "").toUpperCase() === status) || null;
}

function strategyV2StatusCounts(items = [], key) {
  return items.reduce((counts, item) => {
    const status = String(item?.[key] || "UNKNOWN").toUpperCase();
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function buildStrategyV2Summary({ definitions = [], versions = [], instances = [] }) {
  return {
    definitions: definitions.length,
    versions: versions.length,
    instances: instances.length,
    published_versions: versions.filter((item) => String(item.status || "").toUpperCase() === "PUBLISHED").length,
    live_instances: instances.filter((item) => String(item.execution_mode || "").toUpperCase() === "LIVE").length,
    paper_instances: instances.filter((item) => String(item.execution_mode || "").toUpperCase() === "PAPER").length,
    shadow_instances: instances.filter((item) => String(item.execution_mode || "").toUpperCase() === "SHADOW").length,
    version_statuses: strategyV2StatusCounts(versions, "status"),
    runtime_states: strategyV2StatusCounts(instances, "runtime_state"),
    execution_modes: strategyV2StatusCounts(instances, "execution_mode"),
  };
}

function buildStrategyV2OverviewItems({ definitions = [], versions = [], instances = [], audit = [] }) {
  const versionsByDefinition = groupByKey(versions, "strategy_definition_id");
  const instancesByVersion = groupByKey(instances, "strategy_version_id");
  const auditByAggregate = groupByKey(audit, "aggregate_id");
  return definitions.map((definition) => {
    const definitionVersions = [...(versionsByDefinition.get(definition.strategy_definition_id) || [])]
      .sort((a, b) => String(b.updated_at_utc || b.updated_at || "").localeCompare(String(a.updated_at_utc || a.updated_at || "")));
    const definitionInstances = definitionVersions.flatMap((version) => instancesByVersion.get(version.strategy_version_id) || []);
    const publishedVersion = firstByStatus(definitionVersions, "PUBLISHED");
    const liveInstance = definitionInstances.find((item) => String(item.execution_mode || "").toUpperCase() === "LIVE") || null;
    const paperInstance = definitionInstances.find((item) => String(item.execution_mode || "").toUpperCase() === "PAPER") || null;
    const latestVersion = definitionVersions[0] || null;
    const aggregateIds = new Set([
      definition.strategy_definition_id,
      ...definitionVersions.map((item) => item.strategy_version_id),
      ...definitionInstances.map((item) => item.strategy_instance_id),
    ].filter(Boolean));
    const recentAudit = [...auditByAggregate.entries()]
      .filter(([aggregateId]) => aggregateIds.has(aggregateId))
      .flatMap(([, rows]) => rows)
      .sort((a, b) => String(b.created_at_utc || b.created_at || "").localeCompare(String(a.created_at_utc || a.created_at || "")))
      .slice(0, 10);
    return {
      strategy_definition_id: definition.strategy_definition_id,
      external_key: definition.external_key,
      name: definition.name,
      family: definition.family,
      owner: definition.owner,
      description: definition.description || null,
      latest_version: latestVersion,
      published_version: publishedVersion,
      live_instance: liveInstance,
      paper_instance: paperInstance,
      version_count: definitionVersions.length,
      instance_count: definitionInstances.length,
      audit_count: recentAudit.length,
      versions: definitionVersions,
      instances: definitionInstances,
      recent_audit: recentAudit,
      operator_state: {
        has_definition: true,
        has_published_version: Boolean(publishedVersion),
        has_runtime_instance: definitionInstances.length > 0,
        has_live_instance: Boolean(liveInstance),
        recommended_next_step: !definitionVersions.length
          ? "CREATE_VERSION"
          : !publishedVersion
            ? "VALIDATE_AND_PUBLISH_VERSION"
            : !definitionInstances.length
              ? "CREATE_SHADOW_INSTANCE"
              : liveInstance
                ? "MONITOR_LIVE_INSTANCE"
                : paperInstance
                  ? "EVALUATE_PAPER_PROMOTION"
                  : "RUN_SHADOW_VALIDATION",
      },
    };
  });
}

function normalizeLiveMasterActiveThesis({ thesis, master, setupDocs = [], tick }) {
  if (!thesis || typeof thesis !== "object" || Array.isArray(thesis)) return null;
  const sourceState = String(thesis.state || thesis.status || "WAIT_MONITORED").toUpperCase();
  const status = {
    NO_ACTIVE: "NO_ACTIVE_THESIS",
    NO_ACTIVE_THESIS: "NO_ACTIVE_THESIS",
    WAIT_MONITORED: "WAIT_MONITORED",
    CONDITIONAL: "THESIS_CONDITIONAL",
    THESIS_CONDITIONAL: "THESIS_CONDITIONAL",
    ACTIVE: "THESIS_ACTIVE",
    THESIS_ACTIVE: "THESIS_ACTIVE",
    WEAKENED: "THESIS_WEAKENED",
    THESIS_WEAKENED: "THESIS_WEAKENED",
    AT_RISK: "THESIS_AT_RISK",
    THESIS_AT_RISK: "THESIS_AT_RISK",
    POST_EVENT: "THESIS_ACTIVE",
    INVALIDATED: "THESIS_INVALIDATED",
    THESIS_INVALIDATED: "THESIS_INVALIDATED",
    EXPIRED: "EXPIRED",
    REPLAN_REQUIRED: "REPLAN_REQUIRED",
    SUPERSEDED: "EXPIRED",
  }[sourceState] || "WAIT_MONITORED";
  const thesisId = thesis.thesis_id || activeThesisVNextId({
    ...thesis,
    linked_master_analysis_id: master.analysis_id,
    valid_from: thesis.valid_from_paris || thesis.valid_from || master.created_at_paris,
    instrument: thesis.instrument || "MNQ",
  });
  const primarySetupId = thesis.primary_setup_id || null;
  const primarySetup = setupDocs.find((setup) => (
    setup.setup_id === primarySetupId || setup.setup_record_id === primarySetupId || setup.is_primary === true
  )) || null;
  const healthScore = Number(
    thesis.health_score
      ?? master.monitor_handoff?.thesis_health_baseline
      ?? master.analysis_output?.monitor_handoff?.thesis_health_baseline
      ?? 50,
  );
  const scope = executionScopeFields(master);
  return {
    ...thesis,
    ...scope,
    thesis_id: thesisId,
    linked_master_analysis_id: master.analysis_id,
    linked_setup_id: primarySetup?.setup_record_id || primarySetup?.setup_id || primarySetupId,
    primary_setup_id: primarySetupId,
    plan_id: thesis.plan_id || master.plan_id || master.analysis_output?.execution_plan?.plan_id || null,
    status,
    source_state: sourceState,
    dominant_scenario: thesis.summary || thesis.dominant_scenario || master.analysis_output?.selected_hypothesis?.reason || "Thèse V5 active",
    confidence_pct: Number(thesis.confidence_pct ?? healthScore),
    health_score: Number.isFinite(healthScore) ? Math.max(0, Math.min(100, healthScore)) : 50,
    valid_from: thesis.valid_from_paris || thesis.valid_from || master.cutoff_paris || master.created_at_paris,
    valid_until: thesis.valid_until_paris || thesis.valid_until || null,
    requires_replan_after: thesis.requires_replan_after_paris || thesis.requires_replan_after || null,
    key_levels: thesis.level_watchlist || thesis.key_levels || [],
    invalidation_conditions: thesis.invalidation_condition_ids || thesis.invalidation_conditions || [],
    mode: master.mode || "live",
    date: master.date || master.trading_date,
    trading_date: master.trading_date || master.date,
    session: master.session,
    timezone: master.timezone || "Europe/Paris",
    pack_id: master.pack_id || null,
    pack_build_id: master.pack_build_id || null,
    anti_lookahead_compliant: true,
    created_at: thesis.created_at || tick.utc,
    created_at_utc: thesis.created_at_utc || tick.utc,
    created_at_paris: thesis.created_at_paris || thesis.valid_from_paris || tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function createDeskStoreFromEnv() {
  const mode = process.env.DESK_GPT_MCP_STORE || process.env.DESK_MCP_STORE || "postgres";
  if (mode === "postgres" || mode === "postgresql") {
    return new PersistentDeskStore(new SystemClock(), new PostgresDeskPersistence());
  }
  throw new Error(`unsupported_store_mode:${mode}`);
}

function projectClaimLane(result, lane, workerId = null) {
  const lifecycle = lane === "live"
    ? {
        claim: "claim_next_live_work",
        heartbeat: "heartbeat_live",
        complete: "complete_live",
        fail: "fail_live",
      }
    : {
        claim: "claim_next_replay_work",
        heartbeat: "heartbeat_replay",
        complete: "complete_replay",
        fail: "fail_replay",
      };
  return {
    ...result,
    lane,
    claim_handle: result?.claim_handle
      ? {
          ...result.claim_handle,
          worker_id: result.claim_handle.worker_id || workerId || undefined,
        }
      : result?.claim_handle,
    worker_api: lifecycle,
  };
}

function reusablePrepJob(existingJob, args = {}) {
  return args.force_rebuild !== true
    && Boolean(existingJob?.bundle_id)
    && ["READY", "STALE", "DEGRADED"].includes(String(existingJob?.status || "").toUpperCase());
}

function reusableMonitorCatchupContext(existingBundle, args = {}) {
  if (!args.catchup_context) return true;
  return isDeepStrictEqual(existingBundle?.catchup_context || null, args.catchup_context);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

function liveClaimShouldRetry(result, tick, retryWindowSeconds) {
  if (result?.status === "DATA_NOT_READY") return result.retryable !== false;
  if (result?.status !== "NO_WORK") return false;
  if (result.reason === "in_progress") return true;
  if (!["master_not_due", "outside_window"].includes(result.reason)) return false;
  const eligibleMs = Date.parse(result.next_eligible_at_utc || "");
  return Number.isFinite(eligibleMs)
    && eligibleMs > tick.epochMs
    && eligibleMs - tick.epochMs <= retryWindowSeconds * 1000;
}

function waitForMilliseconds(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function dedupeDocuments(documents = [], idField = "id") {
  const unique = new Map();
  for (const document of documents) {
    if (!document) continue;
    const key = document[idField] || JSON.stringify(document);
    if (!unique.has(key)) unique.set(key, document);
  }
  return [...unique.values()];
}

export class PersistentDeskStore {
  constructor(clock = new SystemClock(), persistence = null) {
    this.clock = clock;
    if (!persistence) throw new Error("document_persistence_required");
    this.persistence = persistence;
    this.contracts = new DeskContractService({ persistence, clock });
    this.packs = new DeskPackService({ persistence, clock });
    this.localPacks = new LocalPackBuilder({ persistence, clock });
    this.live = new DeskLiveService({ persistence, clock, host: this });
    this.front = new DeskFrontService({ persistence, clock, marketFeedCandidates, canonicalTimeframe });
    this.market = new DeskMarketFeatureService({ persistence, clock, host: this });
    this.macroCalendar = new MacroCalendarService({ persistence, clock });
    this.news = new NewsIngestionService({ persistence, clock });
    this.telegram = persistence.pool ? new TelegramAlertService({ persistence, clock }) : null;
    this.strategyKernel = new StrategyKernelService({ repository: createStrategyKernelRepository(persistence), clock });
    this.aiContextGateRepository = createAiContextGateRepository(persistence);
    this.dataFoundation = new DataFoundationService({ repository: createDataFoundationRepository(persistence), clock });
    this.simulationRuns = createSimulationRunRegistryService({ persistence, clock });
    this.strategy = new DeskStrategyAuditService({ persistence, clock, host: this, market: this.market });
    this.replay = new DeskReplayService({ persistence, clock, host: this });
    this.replayPreparation = new ReplayPreparationService({ persistence, clock, host: this });
    this.claimLanes = new ClaimLaneService({ persistence, clock });
    this.operations = new FrontOperationsService({ persistence, clock, host: this });
    this.execution = new BrokerExecutionService({
      repository: createBrokerExecutionRepository(persistence),
      persistence,
      clock,
      startupControl: new NinjaTraderStartupControl({ clock: () => clock.now().utc }),
    });
    this.livePackPublishingEnabled = process.env.DESK_LOCAL_PACK_BUILDER_ENABLED !== "false";
    this.liveExecutionMode = process.env.DESK_LIVE_EXECUTION_MODE || "shadow";
    this.livePaperExecutionEnabled = process.env.DESK_LIVE_PAPER_EXECUTION_ENABLED !== "false";
    this.liveClaimRetryWait = waitForMilliseconds;
    this.frontLiveStateCache = new Map();
  }

  async buildAndPublishLiveRollingPack(args = {}) {
    return this.localPacks.buildLiveRollingPack(args);
  }

  async buildAndPublishReplaySourcePack({ date, session, start_paris, cutoff_paris, pack_id, source_evidence } = {}) {
    return this.localPacks.build({
      date,
      session,
      purpose: "replay_source",
      cutoffUtc: new Date(cutoff_paris).toISOString(),
      cutoffParis: cutoff_paris,
      packId: pack_id,
      requestedStartParis: start_paris,
      sourceEvidence: source_evidence,
    });
  }

  async reconcileLivePaperExecution(args = {}) {
    if (!this.livePaperExecutionEnabled) {
      return {
        ok: true,
        status: "SKIPPED",
        reason: "LIVE_PAPER_EXECUTION_DISABLED",
        execution_mode: this.liveExecutionMode,
        broker_execution: false,
      };
    }
    const paperResult = await reconcileLivePaperExecution({
      persistence: this.persistence,
      args,
      tick: this.clock.now(),
    });
    const brokerDecisionMaterialization = await this.execution.processEligiblePositions(args);
    return { ...paperResult, broker_decision_materialization: brokerDecisionMaterialization };
  }

  async armLiveEventMonitor(args = {}) {
    return this.live.armEventMonitor(args);
  }

  async health() {
    const [infrastructure, dataReadiness, operations] = await Promise.all([
      this.persistence.health(),
      typeof this.persistence.dataHealth === "function"
        ? this.persistence.dataHealth({ nowUtc: this.clock.now().utc }).catch((error) => ({
            ok: false,
            state: "health_check_failed",
            error: error.message || String(error),
          }))
        : null,
      typeof this.persistence.operationalHealth === "function"
        ? this.persistence.operationalHealth().catch((error) => ({
            ok: false,
            error: error.message || String(error),
          }))
        : null,
    ]);
    return {
      ...infrastructure,
      ...(dataReadiness ? { data_readiness: dataReadiness } : {}),
      ...(operations ? { operations } : {}),
    };
  }

  async getOperationsSummary(args = {}) { return this.operations.getOperationsSummary(args); }
  async listOperationsWorkflows(args = {}) { return this.operations.listWorkflows(args); }
  async getOperationsWorkflow({ workflow_id }) { return this.operations.getWorkflow(workflow_id); }
  async executeOperationsWorkflowAction({ workflow_id, input, actor }) { return this.operations.executeWorkflowAction(workflow_id, input, actor); }
  async listOperationsReplays(args = {}) { return this.operations.listReplays(args); }
  async getOperationsReplay({ run_id }) { return this.operations.getReplayRun(run_id); }
  async getOperationsReplayDays({ run_id }) { return this.operations.getReplayDays(run_id); }
  async getOperationsReplayDay({ run_id, date }) { return this.operations.getReplayDay(run_id, date); }
  async getOperationsReplaySession({ run_id, session_execution_id }) { return this.operations.getReplaySession(run_id, session_execution_id); }
  async getOperationsReplayTimeline({ run_id }) { return this.operations.getReplayTimeline(run_id); }
  async getOperationsReplayPriceSeries({ run_id }) { return this.operations.getReplayPriceSeries(run_id); }
  async listOperationsGptProcesses(args = {}) { return this.operations.listGptProcesses(args); }
  async getOperationsGptProcess({ process_id }) { return this.operations.getGptProcess(process_id); }
  async getOperationsObservability(args = {}) { return this.operations.getObservability(args); }
  async getOperationsObservabilityPolicy() { return this.operations.getObservabilityPolicy(); }
  async executeOperationsObservabilityPolicyAction({ input, actor }) { return this.operations.executeObservabilityPolicyAction(input, actor); }
  async getOperationsAiRuntimeSettings() { return this.operations.getAiRuntimeSettings(); }
  async executeOperationsAiRuntimeSettingsAction({ input, actor }) { return this.operations.executeAiRuntimeSettingsAction(input, actor); }
  async evaluateOperationsObservabilityIncidents({ input = {}, actor = {} } = {}) { return this.operations.evaluateObservabilityIncidents(input, actor); }
  async getOperationsPerformance(args = {}) { return this.operations.getPerformanceOverview(args); }
  async compareOperationsReplays({ ids }) { return this.operations.compareReplays(ids); }
  async listOperationsIncidents(args = {}) { return this.operations.listIncidents(args); }
  async executeOperationsIncidentAction({ incident_id, input, actor }) { return this.operations.executeIncidentAction(incident_id, input, actor); }
  async syncOperationsNotifications({ input = {}, actor = {} } = {}) { return this.operations.syncIncidentNotifications(input, actor); }
  async listOperationsNotifications(args = {}) { return this.operations.listNotifications(args); }
  async executeOperationsNotificationAction({ notification_id, input, actor }) { return this.operations.executeNotificationAction(notification_id, input, actor); }
  async getTelegramStatus() {
    if (!this.telegram) throw Object.assign(new Error("Telegram requires the PostgreSQL store."), { code: "TELEGRAM_POSTGRES_REQUIRED", statusCode: 503 });
    return this.telegram.getStatus();
  }
  async executeTelegramAction({ input, actor }) {
    if (!this.telegram) throw Object.assign(new Error("Telegram requires the PostgreSQL store."), { code: "TELEGRAM_POSTGRES_REQUIRED", statusCode: 503 });
    return this.telegram.executeAction(input, actor);
  }
  async listOperationsRunbooks(args = {}) { return this.operations.listRunbooks(args); }
  async getOperationsRunbook({ runbook_id }) { return this.operations.getRunbook(runbook_id); }
  async getOperationsHistory(args = {}) { return this.operations.getHistory(args); }
  async getOperationsHistorySession({ session_id }) { return this.operations.getHistorySession(session_id); }
  async listOperationsStrategies() { return this.operations.listStrategies(); }
  async compareOperationsStrategyVersions({ strategy_id, left, right }) { return this.operations.compareStrategyVersions(strategy_id, left, right); }
  async listStrategyV2Definitions(args = {}) {
    const items = await this.strategyKernel.listDefinitions({ limit: args.limit });
    return strategyKernelResponse("DeskStrategyDefinitionListV2", { count: items.length, items });
  }
  async getStrategyV2Definition({ strategy_definition_id }) {
    return strategyKernelResponse("DeskStrategyDefinitionV2", { definition: await this.strategyKernel.getDefinition(strategy_definition_id) });
  }
  async createStrategyV2Definition({ input = {}, actor = {} } = {}) {
    return strategyKernelResponse("DeskStrategyDefinitionCommandResultV2", await this.strategyKernel.registerDefinition(input, commandActor(input, actor)));
  }
  async listStrategyV2Versions(args = {}) {
    const items = await this.strategyKernel.listVersions({
      strategyDefinitionId: args.strategy_definition_id || args.strategyDefinitionId || null,
      status: args.status || null,
      limit: args.limit,
    });
    return strategyKernelResponse("DeskStrategyVersionListV2", { count: items.length, items });
  }
  async getStrategyV2Version({ strategy_version_id }) { return strategyKernelResponse("DeskStrategyVersionV2", { version: await this.strategyKernel.getVersion(strategy_version_id) }); }
  async createStrategyV2Version({ input = {}, actor = {} } = {}) {
    return strategyKernelResponse("DeskStrategyVersionCommandResultV2", await this.strategyKernel.registerVersion(input, commandActor(input, actor)));
  }
  async executeStrategyV2VersionAction({ strategy_version_id, input = {}, actor = {} } = {}) {
    if (input.action === "compile_dsl") return strategyKernelResponse("DeskStrategyVersionCompilationResultV2", await this.strategyKernel.compileVersion({ ...input, strategy_version_id }, commandActor(input, actor)));
    if (input.action !== "transition_status") throw Object.assign(new Error(`Unknown Strategy Version action: ${input.action}`), { code: "STRATEGY_VERSION_ACTION_UNKNOWN", statusCode: 400 });
    return strategyKernelResponse("DeskStrategyVersionCommandResultV2", await this.strategyKernel.transitionVersion({
      strategy_version_id,
      next_status: input.nextStatus || input.next_status,
      validated_metrics_ref: input.validatedMetricsRef || input.validated_metrics_ref,
      updated_at: input.updatedAt || input.updated_at,
    }, commandActor(input, actor)));
  }
  async listStrategyV2Instances(args = {}) {
    const items = await this.strategyKernel.listInstances({
      strategyVersionId: args.strategy_version_id || args.strategyVersionId || null,
      runtimeState: args.runtime_state || args.runtimeState || null,
      executionMode: args.execution_mode || args.executionMode || null,
      limit: args.limit,
    });
    return strategyKernelResponse("DeskStrategyInstanceListV2", { count: items.length, items });
  }
  async getStrategyV2Instance({ strategy_instance_id }) {
    return strategyKernelResponse("DeskStrategyInstanceV2", { instance: await this.strategyKernel.getInstance(strategy_instance_id) });
  }
  async createStrategyV2Instance({ input = {}, actor = {} } = {}) {
    return strategyKernelResponse("DeskStrategyInstanceCommandResultV2", await this.strategyKernel.registerInstance(input, commandActor(input, actor)));
  }
  async executeStrategyV2InstanceAction({ strategy_instance_id, input = {}, actor = {} } = {}) {
    if (input.action !== "transition") throw Object.assign(new Error(`Unknown Strategy Instance action: ${input.action}`), { code: "STRATEGY_INSTANCE_ACTION_UNKNOWN", statusCode: 400 });
    return strategyKernelResponse("DeskStrategyInstanceCommandResultV2", await this.strategyKernel.transitionInstance({
      strategy_instance_id,
      next_runtime_state: input.nextRuntimeState || input.next_runtime_state,
      next_execution_mode: input.nextExecutionMode || input.next_execution_mode,
      account_scope: input.accountScope ?? input.account_scope,
      triple_lock_validated: input.tripleLockValidated ?? input.triple_lock_validated,
      operator_approval_id: input.operatorApprovalId || input.operator_approval_id,
      last_heartbeat_at: input.lastHeartbeatAt || input.last_heartbeat_at,
      updated_at: input.updatedAt || input.updated_at,
    }, commandActor(input, actor)));
  }
  async listStrategyV2AuditEvents(args = {}) {
    const items = await this.strategyKernel.listAuditEvents({
      aggregateType: args.aggregate_type || args.aggregateType || null,
      aggregateId: args.aggregate_id || args.aggregateId || null,
      limit: args.limit,
    });
    return strategyKernelResponse("DeskStrategyKernelAuditEventListV2", { count: items.length, items });
  }
  async getStrategyV2Overview(args = {}) {
    const limit = args.limit ? Number(args.limit) : 500;
    const [definitions, versions, instances, audit] = await Promise.all([
      this.strategyKernel.listDefinitions({ limit }),
      this.strategyKernel.listVersions({ strategyDefinitionId: args.strategy_definition_id || args.strategyDefinitionId || null, limit }),
      this.strategyKernel.listInstances({ strategyVersionId: args.strategy_version_id || args.strategyVersionId || null, limit }),
      this.strategyKernel.listAuditEvents({ limit: Math.min(limit, 200) }),
    ]);
    const filteredInstances = args.strategy_definition_id || args.strategyDefinitionId
      ? instances.filter((instance) => versions.some((version) => version.strategy_version_id === instance.strategy_version_id))
      : instances;
    const strategies = buildStrategyV2OverviewItems({ definitions, versions, instances: filteredInstances, audit });
    return strategyKernelResponse("DeskStrategyV2Overview", {
      generated_at_utc: this.clock.now().utc,
      summary: buildStrategyV2Summary({ definitions, versions, instances: filteredInstances }),
      count: strategies.length,
      strategies,
      definitions,
      versions,
      instances: filteredInstances,
      audit,
      source: {
        canonical: "strategy_kernel_v2",
        legacy_strategy_endpoint: "/api/v1/strategies",
        note: "Legacy strategy endpoint remains available only for historical performance comparison while Strategy v2 owns governance.",
      },
    });
  }
  async getDataFoundationOverview(args = {}) { return dataFoundationResponse("DeskDataFoundationOverviewV1", await this.dataFoundation.getOverview(args)); }
  async getPromptRegistryOverview() { return buildPromptRegistryOverview({ nowUtc: this.clock.now().utc }); }
  async listDataFoundationSources(args = {}) {
    return dataFoundationResponse("DeskDataSourceListV1", await this.dataFoundation.listDataSources(args));
  }
  async listDataFoundationIngestionBatches(args = {}) {
    return dataFoundationResponse("DeskIngestionBatchListV1", await this.dataFoundation.listIngestionBatches(args));
  }
  async listDataFoundationDatasets(args = {}) {
    return dataFoundationResponse("DeskDatasetListV1", await this.dataFoundation.listDatasets(args));
  }
  async listDataFoundationFeatures(args = {}) {
    return dataFoundationResponse("DeskFeatureDefinitionListV1", await this.dataFoundation.listFeatureDefinitions(args));
  }
  async listDataFoundationFeatureComputations(args = {}) {
    return dataFoundationResponse("DeskFeatureComputationRunListV1", await this.dataFoundation.listFeatureComputationRuns(args));
  }
  async listDataFoundationMarketDataProfiles(args = {}) {
    return dataFoundationResponse("DeskMarketDataCapabilityProfileListV1", await this.dataFoundation.listMarketDataCapabilityProfiles(args));
  }
  async listDataFoundationStorageObjects(args = {}) {
    return dataFoundationResponse("DeskMarketDataStorageObjectListV1", await this.dataFoundation.listMarketDataStorageObjects(args));
  }
  async listDataFoundationHotSeriesWindows(args = {}) {
    return dataFoundationResponse("DeskMarketDataHotSeriesWindowListV1", await this.dataFoundation.listMarketDataHotSeriesWindows(args));
  }
  async listDataFoundationFeatureValues(args = {}) {
    return dataFoundationResponse("DeskFeatureValueListV1", await this.dataFoundation.listFeatureValues(args));
  }
  async getExecutionOverview(args = {}) { return this.execution.overview(args); }
  async listAiContextGateDecisions(args = {}) { return this.aiContextGateRepository.listDecisions(args); }
  async getExecutionIntent({ intent_id }) { return this.execution.intentDetail(intent_id); }
  async executeBrokerAction({ input, actor }) { return this.execution.executeAction(input, actor); }
  async recordBrokerHeartbeat(input = {}) { return this.execution.heartbeat(input); }
  async claimBrokerExecution(input = {}) { return this.execution.claimBridgeWork(input); }
  async completeBrokerExecution(input = {}) { return this.execution.completeBridgeWork(input); }
  async recordBrokerOrderEvent(input = {}) { return this.execution.recordBrokerEvent(input); }
  async reconcileBrokerExecution(input = {}) { return this.execution.reconcile(input); }
  async recordNinjaAddonHeartbeat(input = {}) { return this.execution.heartbeatAddon(input); }
  async claimNinjaAddonExecution(input = {}) { return this.execution.claimAddonWork(input); }
  async completeNinjaAddonExecution(input = {}) { return this.execution.completeAddonWork(input); }
  async recordNinjaAddonEvents(input = {}) { return this.execution.recordAddonEvents(input); }
  async recordNinjaAddonSnapshot(input = {}) { return this.execution.recordAddonSnapshot(input); }

  async ingestTradingViewWebhook(input) {
    return ingestTradingViewWebhook({ persistence: this.persistence, ...input });
  }

  async getLatestAsiaOpenPack({ date } = {}) {
    return this.packs.getLatestAsiaOpenPack({ date });
  }

  async listDeskPacks({ date_from, date_to, session = "asia_open", status = "ready", limit = 100 } = {}) {
    return this.packs.listDeskPacks({ date_from, date_to, session, status, limit });
  }

  async getDeskPack({ pack_id, pack_build_id, mode = "live", include_draft = false }) {
    return this.packs.getDeskPack({ pack_id, pack_build_id, mode, include_draft });
  }

  async getDataset({
    pack_id,
    pack_build_id,
    dataset,
    as_of_utc,
    mode = "live",
    format = "json",
    max_rows = 1000,
    row_order = "oldest_first",
  }) {
    return this.packs.getDataset({
      pack_id,
      pack_build_id,
      dataset,
      as_of_utc,
      mode,
      format,
      max_rows,
      row_order,
    });
  }

  async getMarketLevels({ pack_id, instrument }) {
    return this.packs.getMarketLevels({ pack_id, instrument });
  }

  async getMacroCalendar({ date, pack_id, pack_build_id, as_of_utc, mode = "live", importance_min = "medium" } = {}) {
    return this.packs.getMacroCalendar({ date, pack_id, pack_build_id, as_of_utc, mode, importance_min });
  }

  async getFrontDailyMacroCalendar({ date, importance_min = "low", as_of_utc } = {}) {
    return this.macroCalendar.getDailyCalendar({ date, importance_min, as_of_utc });
  }

  async getFrontMacroCalendarWindow(args = {}) {
    return this.macroCalendar.getWindowCalendar(args);
  }

  async refreshMacroCalendar(args = {}) {
    return this.macroCalendar.refresh(args);
  }

  async getMacroCalendarCoverage(args = {}) {
    return this.macroCalendar.getCoverage(args);
  }

  async refreshNews(args = {}) {
    return this.news.refresh(args);
  }

  async getFrontNewsWindow(args = {}) {
    return this.news.getWindow(args);
  }

  async getNewsCoverage() {
    return this.news.getCoverage();
  }

  async getFrontLiveMarketSnapshot({ date } = {}) {
    return this.front.getLiveMarketSnapshot({ date });
  }

  async getNewsDigest({ date, session = "asia_open", pack_id, pack_build_id, as_of_utc, mode = "live" } = {}) {
    if (!pack_id && !pack_build_id && mode !== "replay") {
      return this.news.getWindow({
        as_of_utc,
        before_hours: 48,
        limit: 100,
        instruments: session === "ny_open" ? ["MNQ", "MES"] : [],
      }).then((result) => ({
        ...result,
        date,
        session,
      }));
    }
    return this.packs.getNewsDigest({ date, session, pack_id, pack_build_id, as_of_utc, mode });
  }

  async saveDeskDecision(decision) {
    assertLiveStoreWriteScope("saveDeskDecision", decision);
    const _t = this.clock.now();
    const decision_id = decision.decision_id || stableLocalId("decision", decision.trading_date || decision.date, decision.session, _t, decision.run_id);
    const legacySource = decision.source || "chatgpt_desk";
    const canonicalDecision = normalizeDecision({
      ...decision,
      decision_id,
      source: legacySource,
      source_type: decision.source_type || "gpt",
      source_ref: decision.source_ref || decision.analysis_id || decision.pack_id || decision.report_id || decision_id,
      created_at_utc: decision.created_at_utc ?? decision.created_at ?? _t.utc,
      created_at_paris: decision.created_at_paris ?? _t.paris,
    }).decision;
    const doc = {
      ...decision,
      schema_version: DECISION_SCHEMA_VERSION,
      decision_model: DECISION_MODEL_VERSION,
      source_type: canonicalDecision.source_type,
      source_role: DECISION_SOURCE_ROLE,
      canonical_decision_id: canonicalDecision.decision_id,
      gate_status: canonicalDecision.gate_status,
      domain_status: canonicalDecision.status,
      canonical_decision: canonicalDecision,
      decision_id,
      source: legacySource,
      environment: decision.environment || deskEnvironment(),
      intake_status: decision.intake_status || "pending",
      created_at: decision.created_at ?? _t.utc,
      created_at_utc: decision.created_at_utc ?? _t.utc,
      created_at_paris: decision.created_at_paris ?? _t.paris,
      saved_at: _t.utc,
      saved_at_utc: _t.utc,
      saved_at_paris: _t.paris,
    };
    await this.#setDocument(COLLECTIONS.deskDecisions, decision_id, doc);
    return { ok: true, decision_id };
  }

  async saveDeskAnalysis(analysis) {
    assertLiveStoreWriteScope("saveDeskAnalysis", analysis);
    const _t = this.clock.now();
    const normalized = normalizeDeskAnalysis(analysis);
    const analysis_id = normalized.analysis_id || stableLocalId("analysis", normalized.trading_date || normalized.date, normalized.session, _t, normalized.run_id);
    const decision_id = normalized.executable_decision
      ? normalized.executable_decision.decision_id || normalized.decision_id || `${analysis_id}_primary`
      : normalized.decision_id || null;
    const setupDocs = buildSetupDocs(normalized, { analysis_id, decision_id }, _t);
    const doc = {
      ...normalized,
      analysis_id,
      decision_id,
      source: normalized.source || "chatgpt_desk",
      environment: normalized.environment || deskEnvironment(),
      setup_count: setupDocs.length,
      setup_ids: setupDocs.map((setup) => setup.setup_record_id),
      created_at: normalized.created_at ?? _t.utc,
      created_at_utc: normalized.created_at_utc ?? _t.utc,
      created_at_paris: normalized.created_at_paris ?? _t.paris,
      saved_at: _t.utc,
      saved_at_utc: _t.utc,
      saved_at_paris: _t.paris,
    };
    if (normalized.executable_decision) {
      await this.saveDeskDecision({
        ...normalized.executable_decision,
        ...executionScopeFields(normalized),
        decision_id,
        analysis_id,
        pack_id: normalized.executable_decision.pack_id || normalized.pack_id,
        pack_build_id: normalized.executable_decision.pack_build_id || normalized.pack_build_id,
        report_id: normalized.executable_decision.report_id || normalized.report_id,
        date: normalized.executable_decision.date || normalized.date || normalized.trading_date,
        trading_date: normalized.executable_decision.trading_date || normalized.trading_date || normalized.date,
        session: normalized.executable_decision.session || normalized.session,
      });
    }
    for (const setup of setupDocs) {
      await this.#setDocument(COLLECTIONS.deskSetups, setup.setup_record_id, setup);
    }
    await this.#setDocument(COLLECTIONS.deskAnalyses, analysis_id, doc);
    return { ok: true, analysis_id, decision_id, setup_count: doc.setup_count, setup_ids: doc.setup_ids };
  }

  async saveDeskReport(report) {
    const _t = this.clock.now();
    const report_id = report.report_id || stableLocalId("report", report.date, report.session, _t);
    const doc = {
      ...report,
      report_id,
      source: "chatgpt_desk",
      created_at: _t.utc,
      created_at_utc: _t.utc,
      created_at_paris: _t.paris,
    };
    await this.#setDocument(COLLECTIONS.deskReports, report_id, doc);
    return { ok: true, report_id };
  }

  async getDeskSetups({ pack_id, analysis_id, decision_id, status = "any", primary_only = false, limit = 50 } = {}) {
    const boundedLimit = Math.max(50, Math.min(Number(limit) || 50, 500));
    const filters = [
      analysis_id ? { field: "analysis_id", operator: "==", value: analysis_id } : null,
      decision_id ? { field: "decision_id", operator: "==", value: decision_id } : null,
      pack_id ? { field: "pack_id", operator: "==", value: pack_id } : null,
    ].filter(Boolean);
    const docs = filters.length
      ? await this.#queryCollectionDocuments({
          collection: COLLECTIONS.deskSetups,
          filters,
          limit: boundedLimit,
        })
      : await this.#listDocuments(COLLECTIONS.deskSetups, boundedLimit);
    return filterSetupDocs(docs, { pack_id, analysis_id, decision_id, status, primary_only, limit });
  }

  async replayDeskSetups(args = {}) {
    throw deskError("READ_ONLY_REPLAY_FORBIDDEN", "replayDeskSetups cannot mutate source setups; create an orchestrated replay run.", { args_present: Object.keys(args).sort() });
  }

  async updateDeskDecisionStatus({ decision_id, status, note, updated_by }) {
    const _t = this.clock.now();
    await this.#setDocument(COLLECTIONS.deskDecisions, decision_id, {
      status,
      status_note: note || null,
      status_updated_by: updated_by,
      status_updated_at: _t.utc,
      status_updated_at_utc: _t.utc,
      status_updated_at_paris: _t.paris,
    }, { merge: true });
    return { ok: true, decision_id, status };
  }

  async getActiveContracts() {
    return this.contracts.getActiveContracts();
  }

  async getContract({ contract_name, schema_version }) {
    return this.contracts.getContract({ contract_name, schema_version });
  }

  async listContractVersions({ contract_name }) {
    return this.contracts.listContractVersions({ contract_name });
  }

  async saveContract(contract) {
    return this.contracts.saveContract(contract);
  }

  async activateContractVersion({ contract_name, schema_version }) {
    return this.contracts.activateContractVersion({ contract_name, schema_version });
  }

  async archiveContractVersion({ contract_name, schema_version }) {
    return this.contracts.archiveContractVersion({ contract_name, schema_version });
  }

  async saveMasterAnalysis(masterAnalysis) {
    assertLiveStoreWriteScope("saveMasterAnalysis", masterAnalysis);
    assertActiveStrategySaveTarget(masterAnalysis, {
      workflow: "LIVE_MASTER",
      mode: "live",
      operation: "save_master_analysis",
    });
    const _t = this.clock.now();
    let payload = stripDeskWorkLease(masterAnalysis);
    if (payload.execution_policy_version === "3.0.0") {
      assertMasterSetupCoverage(payload, { workflow: "LIVE_MASTER" });
    }
    payload = canonicalizeMasterStrategyPayload(payload, {
      workflow: "LIVE_MASTER",
      sourceMode: "live",
    });
    const analysis_id = payload.analysis_id || masterAnalysisVNextId(payload);
    const existing = await this.#getDocument(COLLECTIONS.deskMasterAnalyses, analysis_id).catch(() => ({}));
    const setupDocs = buildMasterSetupDocs(payload, { analysis_id }, _t);
    const activeThesisDoc = payload.schema_version === STRATEGY_RUNTIME_VERSIONS.master_contract
      ? normalizeLiveMasterActiveThesis({
          thesis: payload.active_thesis || deriveActiveThesisFromMaster({ ...payload, analysis_id }),
          master: { ...payload, analysis_id },
          setupDocs,
          tick: _t,
        })
      : null;
    const doc = {
      ...existing,
      ...payload,
      analysis_id,
      agent_work_item_id: null,
      agent_worker_id: masterAnalysis.worker_id || existing.agent_worker_id || null,
      setup_count: setupDocs.length,
      setup_ids: setupDocs.map((setup) => setup.setup_record_id),
      active_thesis_id: activeThesisDoc?.thesis_id || payload.active_thesis_id || existing.active_thesis_id || null,
      ...writeTimestamps(payload, existing, _t),
    };
    const frontProjection = await this.front.prepareProjection(doc, "MASTER", analysis_id, _t);
    const sourceWrite = { collection: COLLECTIONS.deskMasterAnalyses, documentId: analysis_id, data: doc, merge: true };
    const strategyWrites = [
      ...setupDocs.map((setup) => ({
        collection: COLLECTIONS.deskSetups,
        documentId: setup.setup_record_id,
        data: setup,
        merge: true,
      })),
      ...(activeThesisDoc ? [{
        collection: COLLECTIONS.deskActiveTheses,
        documentId: activeThesisDoc.thesis_id,
        data: activeThesisDoc,
        merge: true,
      }] : []),
    ];
    if (payload.front_projection) {
      await this.front.commitProjection({
        sourceWrite,
        plan: frontProjection,
        additionalWrites: strategyWrites,
      });
    } else if (typeof this.persistence.writeDocuments === "function") {
      await this.persistence.writeDocuments([sourceWrite, ...strategyWrites]);
    } else {
      await this.#setDocument(sourceWrite.collection, sourceWrite.documentId, sourceWrite.data, { merge: true });
      for (const write of strategyWrites) {
        await this.#setDocument(write.collection, write.documentId, write.data, { merge: true });
      }
    }
    const strict_replay = await this.strategy.applyNyOpenStrictReplay({
      strategy_id: NY_OPEN_STRATEGY_ID,
      date: payload.trading_date || payload.date,
      analysis_id,
      setups: setupDocs,
      performed_by: "save_master_analysis_auto",
    }).catch((error) => ({ ok: false, skipped: true, error: publicReplayError(error) }));
    if (payload.context_transmission) {
      await this.saveContextTransmission({
        ...payload.context_transmission,
        ...executionScopeFields(payload),
        linked_analysis_id: analysis_id,
        date: payload.date || payload.trading_date,
        trading_date: payload.trading_date || payload.date,
        session: payload.session,
      });
    }
    if (payload.decision_journal) {
      await this.#setDocument(COLLECTIONS.deskDecisionJournal, analysis_id, {
        ...payload.decision_journal,
        ...executionScopeFields(payload),
        linked_analysis_id: analysis_id,
        created_at: _t.utc,
        created_at_utc: _t.utc,
        created_at_paris: _t.paris,
      });
    }
    return {
      ok: true,
      analysis_id,
      setup_count: setupDocs.length,
      setup_ids: setupDocs.map((setup) => setup.setup_record_id),
      active_thesis_id: activeThesisDoc?.thesis_id || null,
      work_item_id: null,
      strict_replay,
      front_projection: frontProjection.result,
    };
  }

  async saveActiveThesis(thesis) {
    assertLiveStoreWriteScope("saveActiveThesis", thesis);
    const _t = this.clock.now();
    const thesis_id = thesis.thesis_id || activeThesisVNextId(thesis);
    const existing = await this.#getDocument(COLLECTIONS.deskActiveTheses, thesis_id).catch(() => ({}));
    const candidate = {
      ...existing,
      ...thesis,
      thesis_id,
      ...writeTimestamps(thesis, existing, _t),
    };
    const { thesisDoc: doc, positionDoc } = splitPositionStateFromThesis(candidate, _t);
    await this.#setDocument(COLLECTIONS.deskActiveTheses, thesis_id, doc, { merge: true });
    if (positionDoc) {
      await this.#setDocument(COLLECTIONS.deskPositions, positionDoc.position_id, positionDoc, { merge: true });
    }
    return { ok: true, thesis_id, status: doc.status, position_id: positionDoc?.position_id || null, split_storage: Boolean(positionDoc) };
  }

  async updateActiveThesis(update) {
    assertLiveStoreWriteScope("updateActiveThesis", update);
    const _t = this.clock.now();
    const existing = await this.#getDocument(COLLECTIONS.deskActiveTheses, update.thesis_id).catch(() => ({ thesis_id: update.thesis_id }));
    const candidate = {
      ...existing,
      ...update,
      updated_at: _t.utc,
      updated_at_utc: _t.utc,
      updated_at_paris: _t.paris,
    };
    const { thesisDoc: doc, positionDoc } = splitPositionStateFromThesis(candidate, _t);
    await this.#setDocument(COLLECTIONS.deskActiveTheses, update.thesis_id, doc, { merge: true });
    if (positionDoc) {
      await this.#setDocument(COLLECTIONS.deskPositions, positionDoc.position_id, positionDoc, { merge: true });
    }
    return { ok: true, thesis_id: update.thesis_id, status: doc.status || null, position_id: positionDoc?.position_id || null, split_storage: Boolean(positionDoc) };
  }

  async saveHourlyMonitor(monitor) {
    throw deskError(
      "LEGACY_CONTRACT_WRITE_FORBIDDEN",
      "Historical hourly Monitor documents remain readable but cannot be produced after the V5.2 cutover.",
      { schema_version: monitor?.schema_version || null },
    );
  }

  async saveMonitorAlert(alert) {
    assertLiveStoreWriteScope("saveMonitorAlert", alert);
    const _t = this.clock.now();
    const alert_id = alert.alert_id || stableVNextId("alert", alert.timestamp_paris ?? _t.utc, alert.linked_thesis_id || "desk", _t);
    const doc = {
      ...alert,
      alert_id,
      timestamp_paris: alert.timestamp_paris ?? _t.paris,
      timestamp_paris_utc: _t.utc,
      sent_to_telegram: Boolean(alert.send_to_telegram),
      created_at: _t.utc,
      created_at_utc: _t.utc,
      created_at_paris: _t.paris,
    };
    await this.#setDocument(COLLECTIONS.deskAlerts, alert_id, doc);
    return { ok: true, alert_id };
  }

  async saveContextTransmission(context) {
    assertLiveStoreWriteScope("saveContextTransmission", context);
    const _t = this.clock.now();
    const context_id = context.context_id || stableVNextId("context", context.date ?? _t.utc, context.session || "session", _t);
    const doc = {
      ...context,
      context_id,
      created_at: context.created_at ?? _t.utc,
      created_at_utc: context.created_at_utc ?? _t.utc,
      created_at_paris: context.created_at_paris ?? _t.paris,
    };
    await this.#setDocument(COLLECTIONS.deskContextTransmissions, context_id, doc);
    return { ok: true, context_id };
  }

  async saveMonitorContextTransmission(context) {
    assertLiveStoreWriteScope("saveMonitorContextTransmission", context);
    const _t = this.clock.now();
    const context_id = context.context_id || stableVNextId("monitor_context", context.linked_monitor_id ?? _t.utc, context.linked_thesis_id || "thesis", _t);
    const doc = {
      ...context,
      context_id,
      created_at: context.created_at ?? _t.utc,
      created_at_utc: context.created_at_utc ?? _t.utc,
      created_at_paris: context.created_at_paris ?? _t.paris,
    };
    await this.#setDocument(COLLECTIONS.deskMonitorContextTransmissions, context_id, doc);
    return { ok: true, context_id };
  }

  async updatePositionManagement(position) {
    assertLiveStoreWriteScope("updatePositionManagement", position);
    const _t = this.clock.now();
    const position_id = position.position_id || stableVNextId("position", position.linked_thesis_id ?? _t.utc, position.instrument || "instrument", _t);
    await this.#setDocument(COLLECTIONS.deskPositions, position_id, {
      ...position,
      position_id,
      updated_at: _t.utc,
      updated_at_utc: _t.utc,
      updated_at_paris: _t.paris,
      created_at: position.created_at ?? _t.utc,
      created_at_utc: position.created_at_utc ?? _t.utc,
      created_at_paris: position.created_at_paris ?? _t.paris,
    }, { merge: true });
    return { ok: true, position_id, status: position.status || null };
  }

  async getActiveThesis(args = {}) {
    const query = normalizeOperationalQuery(args, { requireMaster: true });
    const run = query.replay
      ? await this.#getDocument(COLLECTIONS.deskReplayRuns, query.backtest_id).catch(() => null)
      : null;
    if (query.replay) assertReplayRunMatchesQuery(run, query);
    // Query one indexed parent field, then enforce the full operational scope below.
    const filters = [{ field: "linked_master_analysis_id", operator: "==", value: query.master_id }];
    const docs = await this.#queryCollectionDocuments({
      collection: query.replay ? COLLECTIONS.deskReplayActiveTheses : COLLECTIONS.deskActiveTheses,
      filters,
      limit: 200,
    });
    const result = selectActiveTheses(docs, { ...query, mode: query.mode === "backtest" ? "replay" : query.mode, now: this.clock.now() });
    for (const thesis of result.theses) {
      assertDocumentMatchesOperationalQuery(thesis, query, { masterId: query.master_id, code: "THESIS_SCOPE_MISMATCH" });
    }
    return withOperationalMetadata(result, query, run);
  }

  async getLatestMasterAnalysis(args = {}) {
    const query = normalizeOperationalQuery(args);
    const run = query.replay
      ? await this.#getDocument(COLLECTIONS.deskReplayRuns, query.backtest_id).catch(() => null)
      : null;
    if (query.replay) assertReplayRunMatchesQuery(run, query);
    const collection = query.replay ? COLLECTIONS.deskReplayMasterAnalyses : COLLECTIONS.deskMasterAnalyses;
    let docs;
    if (query.master_id) {
      const exact = await this.#getDocument(collection, query.master_id).catch(() => null);
      docs = exact ? [exact] : [];
    } else {
      docs = await this.#queryCollectionDocuments({
        collection,
        filters: [{ field: query.replay ? "replay_run_id" : "run_id", operator: "==", value: query.run_id }],
        limit: 200,
      });
    }
    const result = selectLatestMasterAnalysis(docs, { ...query, mode: query.mode === "backtest" ? "replay" : query.mode });
    if (result.analysis) assertDocumentMatchesOperationalQuery(result.analysis, query, { code: "MASTER_SCOPE_MISMATCH" });
    return withOperationalMetadata(result, query, run);
  }

  async getLatestHourlyMonitor(args = {}) {
    const query = normalizeOperationalQuery(args, { requireMaster: true, requireThesis: true });
    const run = query.replay
      ? await this.#getDocument(COLLECTIONS.deskReplayRuns, query.backtest_id).catch(() => null)
      : null;
    if (query.replay) assertReplayRunMatchesQuery(run, query);
    const thesisCollection = query.replay ? COLLECTIONS.deskReplayActiveTheses : COLLECTIONS.deskActiveTheses;
    const thesis = await this.#getDocument(thesisCollection, query.thesis_id).catch(() => null);
    if (!thesis) throw deskError("THESIS_SCOPE_MISMATCH", "Monitor parent thesis was not found.", { thesis_id: query.thesis_id });
    assertDocumentMatchesOperationalQuery(thesis, query, { masterId: query.master_id, code: "THESIS_SCOPE_MISMATCH" });
    const { thesis_id, limit = 1 } = query;
    const docs = await this.#queryCollectionDocuments({
      collection: query.replay ? COLLECTIONS.deskReplayMonitors : COLLECTIONS.deskHourlyMonitors,
      filters: [{ field: query.replay ? "thesis_id" : "linked_active_thesis_id", operator: "==", value: thesis_id }],
      limit: 200,
    });
    const result = selectLatestHourlyMonitors(docs, { ...query, mode: query.mode === "backtest" ? "replay" : query.mode });
    for (const monitor of result.monitors) {
      assertDocumentMatchesOperationalQuery(monitor, query, { masterId: query.master_id, thesisId: query.thesis_id });
    }
    return withOperationalMetadata(result, query, run);
  }

  async getLatestManualMonitor(args = {}) {
    const { thesis_id, bundle_id } = args;
    const filters = [];
    if (thesis_id) {
      filters.push({ field: "linked_active_thesis_id", operator: "==", value: thesis_id });
    }
    if (bundle_id) {
      filters.push({ field: "bundle_id", operator: "==", value: bundle_id });
    }
    const docs = await this.#queryCollectionDocuments({
      collection: COLLECTIONS.deskManualMonitors,
      filters,
      limit: 200,
    });
    return selectLatestManualMonitors(docs, args);
  }

  async getFrontProjectionCurrent(args = {}) {
    return this.front.getProjectionCurrent(args);
  }

  async getFrontOperatorCommandState({ state_id }) {
    return this.front.getOperatorCommandState({ state_id });
  }

  async getFrontOperatorCommand({ command_id }) {
    return this.front.getOperatorCommand({ command_id });
  }

  async completeFrontOperatorCommand(input) {
    return this.front.completeOperatorCommand(input);
  }

  async commitFrontOperatorCommandMutation(plan) {
    return this.front.commitOperatorCommandMutation(plan);
  }

  async getLevelMap({ date, session = "asia_open", instrument }) {
    return this.market.getLevelMap({ date, session, instrument });
  }

  async getTechnicalEvents({ date, session = "asia_open", instrument, from, to, event_type }) {
    return this.market.getTechnicalEvents({ date, session, instrument, from, to, event_type });
  }

  async getConditionStatus({ thesis_id, timestamp_paris }) {
    return this.market.getConditionStatus({ thesis_id, timestamp_paris });
  }

  async getRawWindow(args) {
    return this.market.getRawWindow(args);
  }

  async createDeskJob(job) {
    const _t = this.clock.now();
    const doc = normalizeDeskJob(job, _t);
    await this.#setDocument(COLLECTIONS.deskJobs, doc.job_id, doc);
    return { ok: true, job_id: doc.job_id, job: doc };
  }

  async getDeskJob({ job_id }) {
    const job = await this.#getDocument(COLLECTIONS.deskJobs, job_id);
    return { ok: true, job };
  }

  async listDeskJobs(args = {}) {
    const docs = await this.#listDocuments(COLLECTIONS.deskJobs, Math.max(50, Math.min(Number(args.limit) || 50, 500))).catch(() => []);
    return selectDeskJobs(docs, args);
  }

  async listAlerts(args = {}) {
    const alerts = await this.#listDocuments(COLLECTIONS.deskAlerts, Math.max(50, Math.min(Number(args.limit) || 50, 500))).catch(() => []);
    return selectAlerts(alerts, args);
  }

  async getActivePosition(args = {}) {
    let positions = [];
    if (args.thesis_id) {
      const fields = ["linked_active_thesis_id", "linked_thesis_id", "thesis_id"];
      const results = await Promise.all(fields.map((field) => this.#queryCollectionDocuments({
        collection: COLLECTIONS.deskPositions,
        filters: [{ field, operator: "==", value: args.thesis_id }],
        limit: 200,
      }).catch(() => [])));
      positions = dedupeDocuments(results.flat(), "position_id");
    }
    if (!positions.length) {
      positions = await this.#listDocuments(COLLECTIONS.deskPositions, 500).catch(() => []);
    }
    return selectActivePosition(positions, args);
  }

  async updateDeskJobStatus(update) {
    const _t = this.clock.now();
    const existing = await this.#getDocument(COLLECTIONS.deskJobs, update.job_id).catch(() => ({ job_id: update.job_id }));
    const doc = patchDeskJob(existing, update, _t);
    await this.#setDocument(COLLECTIONS.deskJobs, doc.job_id, doc, { merge: true });
    return { ok: true, job_id: doc.job_id, status: doc.status, job: doc };
  }

  async cancelDeskJob({ job_id, reason }) {
    return this.updateDeskJobStatus({
      job_id,
      status: "CANCELLED",
      error: reason ? { reason } : null,
    });
  }

  async archiveExpiredTheses({ session, dry_run = false } = {}) {
    const _t = this.clock.now();
    const docs = await this.#queryCollectionDocuments({
      collection: COLLECTIONS.deskActiveTheses,
      filters: [{ field: "status", operator: "in", value: ACTIVE_THESIS_STATUSES }],
      orderBy: [{ field: "updated_at", direction: "desc" }],
      limit: 500,
    }).catch(() => []);
    const expired = selectExpiredTheses(docs, { session, now: _t });
    if (!dry_run) {
      for (const thesis of expired) {
        await this.#setDocument(COLLECTIONS.deskActiveTheses, thesis.thesis_id, markThesisExpired(thesis, _t), { merge: true });
      }
    }
    return { ok: true, dry_run, count: expired.length, archived_thesis_ids: expired.map((thesis) => thesis.thesis_id) };
  }

  async getLiveDeskState(args = {}) {
    const { front_cache: frontCache = false, ...readArgs } = args;
    if (frontCache !== true || FRONT_LIVE_STATE_CACHE_TTL_MS <= 0) {
      return buildLiveDeskState(this, readArgs, this.clock);
    }
    const key = JSON.stringify([
      readArgs.strategy_id || "",
      readArgs.session || "asia_open",
      readArgs.mode || "live",
      readArgs.trading_date || readArgs.date || "",
      readArgs.run_id || "",
    ]);
    const now = this.clock.now().epochMs;
    const existing = this.frontLiveStateCache.get(key);
    if (existing && existing.expires_at > now) return existing.promise;
    const entry = {
      expires_at: Number.POSITIVE_INFINITY,
      promise: null,
    };
    entry.promise = Promise.resolve()
      .then(() => buildLiveDeskState(this, readArgs, this.clock))
      .then((value) => {
        if (this.frontLiveStateCache.get(key) === entry) {
          entry.expires_at = this.clock.now().epochMs + FRONT_LIVE_STATE_CACHE_TTL_MS;
        }
        return value;
      })
      .catch((error) => {
        if (this.frontLiveStateCache.get(key) === entry) this.frontLiveStateCache.delete(key);
        throw error;
      });
    this.frontLiveStateCache.set(key, entry);
    for (const [cacheKey, cached] of this.frontLiveStateCache) {
      if (cached.expires_at <= now) this.frontLiveStateCache.delete(cacheKey);
    }
    return entry.promise;
  }

  async getFrontMasterState(args = {}) {
    return buildFrontMasterState(this, args, this.clock);
  }

  async getFrontMonitorState(args = {}) {
    return buildFrontMonitorState(this, args, this.clock);
  }

  async getNyOpenStrategyState(args = {}) {
    return this.strategy.getNyOpenStrategyState(args);
  }

  async prepareNyOpenMasterBundle(args = {}) {
    return this.strategy.prepareNyOpenMasterBundle(args);
  }

  async getStrategyPerformance(args = {}) {
    return this.strategy.getStrategyPerformance(args);
  }

  async getStrategyCalendar(args = {}) {
    return this.strategy.getStrategyCalendar(args);
  }

  async getStrategyDayDetail(args = {}) {
    return this.strategy.getStrategyDayDetail(args);
  }

  async getLiveTimelineEventDetail(args = {}) {
    return this.strategy.getLiveTimelineEventDetail(args);
  }

  async recomputeStrategyPerformance(args = {}) {
    return this.strategy.recomputeStrategyPerformance(args);
  }

  async markNyOpenStrategyEvent(args = {}) {
    return this.strategy.markNyOpenStrategyEvent(args);
  }

  async getReplayState(args = {}) {
    if (!args.backtest_id) throw deskError("SCOPE_REQUIRED", "backtest_id is required for a selected replay view.", { field: "backtest_id" });
    const exactReplay = await this.#getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id).catch(() => null);
    const replayRuns = selectBacktests(exactReplay ? [exactReplay] : [], args);
    const selectedReplay = selectBacktest(replayRuns.backtests, args.backtest_id);
    if (selectedReplay) {
      const selectedId = selectedReplay.backtest_id;
      const forReplay = (collection, limit = 500) => this.#queryCollectionDocuments({
        collection,
        filters: [{ field: "backtest_id", operator: "==", value: selectedId }],
        limit,
      }).catch(() => []);
      const [
        stepDocuments,
        timelineDocuments,
        monitorDocuments,
        positionDocuments,
        setupDocuments,
        simulationDocuments,
        thesisDocuments,
        bundleDocuments,
        workItemDocuments,
      ] = await Promise.all([
        forReplay(COLLECTIONS.deskReplaySteps),
        forReplay(COLLECTIONS.deskReplayTimeline),
        forReplay(COLLECTIONS.deskReplayMonitors),
        forReplay(COLLECTIONS.deskReplayPositions),
        forReplay(COLLECTIONS.deskReplaySetups),
        forReplay(COLLECTIONS.deskReplayTradeSimulations),
        forReplay(COLLECTIONS.deskReplayActiveTheses),
        forReplay(COLLECTIONS.deskReplayBundles),
        forReplay(COLLECTIONS.deskAgentWorkItems, 200),
      ]);
      const steps = selectBacktestSteps(stepDocuments, selectedId);
      const timeline = selectReplayTimeline(timelineDocuments, selectedId);
      const monitors = selectReplayMonitors(monitorDocuments, selectedId);
      const positions = selectReplayPositions(positionDocuments, selectedId);
      const setups = selectReplayScopedSetups(setupDocuments, selectedId);
      const simulations = selectReplaySimulations(simulationDocuments, selectedId);
      const activeThesis = selectReplayActiveThesis(thesisDocuments, selectedId);
      const bundles = selectReplayBundles(bundleDocuments, selectedId);
      const workItems = workItemDocuments
        .filter((item) => item.backtest_id === selectedId)
        .sort(compareDeskWorkItems);
      return buildOrchestratedReplayState({
        runs: replayRuns.backtests,
        selectedRun: selectedReplay,
        steps,
        timeline,
        monitors,
        positions,
        setups,
        simulations,
        activeThesis,
        bundles,
        workItems,
      });
    }

    const backtests = selectBacktests(await this.#listDocuments(COLLECTIONS.deskBacktests, Math.max(50, Math.min(Number(args.limit) || 50, 500))).catch(() => []), args);
    const selected = selectBacktest(backtests.backtests, args.backtest_id);
    const selectedId = selected?.backtest_id || args.backtest_id || null;
    const steps = selectedId ? selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskBacktestSteps, 500).catch(() => []), selectedId) : [];
    const simulated_trades = selectedId ? selectSimulatedTrades(await this.#listDocuments(COLLECTIONS.deskSimulatedTrades, 500).catch(() => []), selectedId) : [];
    const results = selectedId ? selectBacktestResults(await this.#listDocuments(COLLECTIONS.deskBacktestResults, 100).catch(() => []), selectedId) : [];
    return {
      ok: true,
      backtests: backtests.backtests,
      selected_backtest: selected || null,
      timeline: steps,
      simulated_trades,
      summary_stats: summarizeReplayState(selected, simulated_trades, results),
    };
  }

  async getLiveRunCursor({ cursor_id, trading_date, session } = {}) {
    return this.live.getRunCursor({ cursor_id, trading_date, session });
  }

  async ensureLiveDailyCursors(args = {}) {
    return this.live.ensureDailyCursors(args);
  }

  async claimNextDeskWork(args = {}) {
    return claimNextDeskWorkFacade(this, args, this.clock.now());
  }

  async claimNextLiveWork(args = {}) {
    const configuredAttempts = boundedInteger(
      args.retry_attempts,
      DEFAULT_LIVE_CLAIM_RETRY_ATTEMPTS,
      1,
      3,
    );
    const retryDelaySeconds = boundedInteger(
      args.retry_delay_seconds,
      DEFAULT_LIVE_CLAIM_RETRY_DELAY_SECONDS,
      30,
      60,
    );
    const attempts = [];
    let result = null;

    for (let attempt = 1; attempt <= configuredAttempts; attempt += 1) {
      const tick = this.clock.now();
      const paris = tick.paris || toParisIso(tick.epochMs);
      const tradingDate = args.trading_date || paris.slice(0, 10);
      result = await this.claimNextLive({
        worker_id: args.worker_id,
        trading_date: tradingDate,
        lease_seconds: Math.min(args.lease_seconds || 660, 840),
      });
      attempts.push({
        attempt,
        status: result?.status || null,
        reason: result?.reason || null,
        checkpoint: result?.claim_handle?.checkpoint || result?.checkpoint || null,
        at_utc: tick.utc,
      });
      const remainingRetryWindowSeconds = (configuredAttempts - attempt) * retryDelaySeconds;
      if (attempt >= configuredAttempts
        || !liveClaimShouldRetry(result, tick, remainingRetryWindowSeconds)) {
        break;
      }
      await this.liveClaimRetryWait(retryDelaySeconds * 1000);
    }

    const retryableAfterExhaustion = liveClaimShouldRetry(
      result,
      this.clock.now(),
      retryDelaySeconds,
    );
    return projectClaimLane({
      ...result,
      claim_retry: {
        configured_attempts: configuredAttempts,
        attempts_made: attempts.length,
        retry_delay_seconds: retryDelaySeconds,
        exhausted: attempts.length >= configuredAttempts && retryableAfterExhaustion,
        attempts,
      },
    }, "live", args.worker_id);
  }

  async prewarmNextLiveWork(args = {}) {
    const tick = this.clock.now();
    const paris = tick.paris || toParisIso(tick.epochMs);
    const tradingDate = args.trading_date || paris.slice(0, 10);
    if (!await this.claimLanes.isEnabled("live")) {
      return {
        ok: true,
        status: "LANE_PAUSED",
        scope: "live",
        trading_date: tradingDate,
      };
    }
    return this.live.prewarmNext({ trading_date: tradingDate });
  }

  async claimNextReplayWork(args = {}) {
    const result = await this.claimNextReplay({
      worker_id: args.worker_id,
      workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
      backtest_id: args.backtest_id,
      lease_seconds: args.lease_seconds || 720,
    });
    return projectClaimLane(result, "replay", args.worker_id);
  }

  async claimNextLive(args = {}) {
    if (!await this.claimLanes.isEnabled("live")) {
      return {
        ok: true,
        status: "LANE_PAUSED",
        scope: "live",
        reason: "operator_paused",
        next_action: "wait_for_operator_resume",
      };
    }
    return this.live.claimNext(args);
  }

  async heartbeatLive(args = {}) {
    return this.live.heartbeat(args);
  }

  async completeLive(args = {}) {
    return this.live.complete(args);
  }

  async failLive(args = {}) {
    return this.live.fail(args);
  }

  async reconcileLiveCursors() {
    return this.live.reconcile();
  }

  async claimNextReplay(args = {}) {
    if (!await this.claimLanes.isEnabled("replay")) {
      return {
        ok: true,
        status: "LANE_PAUSED",
        scope: "replay",
        reason: "operator_paused",
        next_action: "wait_for_operator_resume",
      };
    }
    return this.replay.claimNext(args);
  }

  async heartbeatReplay(args = {}) {
    return this.heartbeatDeskWork(args);
  }

  async completeReplay(args = {}) {
    return this.completeDeskWork(args);
  }

  async failReplay(args = {}) {
    return this.failDeskWork(args);
  }

  async getDeskWorkItem({ work_item_id }) {
    return this.replay.getWorkItem({ work_item_id });
  }

  async peekNextDeskWork(args = {}) {
    return this.replay.peekNext(args);
  }

  async upsertReplayAutopilotConfig(args = {}) {
    return this.replay.upsertAutopilotConfig(args);
  }

  async setReplayAutopilotWindow(args = {}) {
    return this.replay.setAutopilotWindow(args);
  }

  async startOrResumeReplayAutopilot(args = {}) {
    return this.replay.startOrResumeAutopilot(args);
  }

  async heartbeatDeskWork(args = {}) {
    return this.replay.heartbeatWork(args);
  }

  async completeDeskWork(args = {}) {
    return this.replay.completeWork(args);
  }

  async failDeskWork(args = {}) {
    return this.replay.failWork(args);
  }

  async setReplayAutomation(args = {}) {
    return this.replay.setAutomation(args);
  }

  async retryReplayAutomationWork(args = {}) {
    return this.replay.retryAutomationWork(args);
  }

  async driveReplayAutomation(args = {}) {
    return this.replay.driveAutomation(args);
  }

  async createOrchestratedReplayDay(args = {}) {
    return this.replay.createOrchestratedReplayDay(args);
  }

  async createReplayPreparation(args = {}) {
    return this.replayPreparation.create(args);
  }

  async listReplayPreparations(args = {}) {
    return this.replayPreparation.list(args);
  }

  async getReplayPreparation(args = {}) {
    return this.replayPreparation.get(args);
  }

  async processNextReplayPreparation(args = {}) {
    return this.replayPreparation.processNext(args);
  }

  async executeReplayPreparationAction(args = {}) {
    return this.replayPreparation.action(args);
  }

  async getClaimLanesOverview() {
    return this.claimLanes.overview();
  }

  async executeClaimLaneAction(args = {}) {
    return this.claimLanes.action(args);
  }

  async prepareReplayMasterBundle(args = {}) {
    return this.replay.prepareReplayMasterBundle(args);
  }

  async getReplayMasterBundle(args = {}) {
    return this.replay.getReplayMasterBundle(args);
  }

  async saveReplayMasterAnalysis(args = {}) {
    return this.replay.saveReplayMasterAnalysis(args);
  }

  async validateReplayMasterStrategyPayload(args = {}) {
    return this.replay.validateReplayMasterStrategyPayload(args);
  }

  async advanceReplayClock(args = {}) {
    return this.replay.advanceReplayClock(args);
  }

  async prepareReplayMonitorBundle(args = {}) {
    return this.replay.prepareReplayMonitorBundle(args);
  }

  async getReplayMonitorBundle(args = {}) {
    return this.replay.getReplayMonitorBundle(args);
  }

  async getReplayBundleManifest(args = {}) {
    return this.replay.getReplayBundleManifest(args);
  }

  async getReplayBundleSection(args = {}) {
    return this.replay.getReplayBundleSection(args);
  }

  async getReplaySnapshot(args = {}) {
    return this.replay.getReplaySnapshot(args);
  }

  async saveReplayMonitor(args = {}) {
    return this.replay.saveReplayMonitor(args);
  }

  async validateReplayMonitorStrategyPayload(args = {}) {
    return this.replay.validateReplayMonitorStrategyPayload(args);
  }

  async applyReplayMonitorResult(args = {}) {
    return this.replay.applyReplayMonitorResult(args);
  }

  async simulateReplayInterval(args = {}) {
    return this.replay.simulateReplayInterval(args);
  }

  async getReplayTimeline(args = {}) {
    return this.replay.getReplayTimeline(args);
  }

  async createBacktestRun(args = {}) {
    const _t = this.clock.now();
    const setups = selectBacktestCandidateSetups(await this.#listDocuments(COLLECTIONS.deskSetups, Math.max(200, Math.min(Number(args.limit) || 200, 500))).catch(() => []), args);
    const run = buildBacktestRunDoc(args, setups, _t);
    const steps = setups.map((setup, index) => buildBacktestStepDoc(run, setup, index, _t));
    await this.#setDocument(COLLECTIONS.deskBacktests, run.backtest_id, run, { merge: true });
    for (const step of steps) {
      await this.#setDocument(COLLECTIONS.deskBacktestSteps, step.step_id, step, { merge: true });
    }
    if (!steps.length) {
      const done = finalizeBacktestRun(run, [], [], _t);
      await this.#setDocument(COLLECTIONS.deskBacktests, run.backtest_id, done, { merge: true });
      await this.#setDocument(COLLECTIONS.deskBacktestResults, `${run.backtest_id}_summary`, done.summary, { merge: true });
      return { ok: true, backtest_id: run.backtest_id, backtest: done, steps_created: 0 };
    }
    return { ok: true, backtest_id: run.backtest_id, backtest: run, steps_created: steps.length };
  }

  async getBacktestRun({ backtest_id }) {
    const backtest = await this.#getDocument(COLLECTIONS.deskBacktests, backtest_id);
    return { ok: true, backtest };
  }

  async listBacktestRuns(args = {}) {
    const limit = Math.max(50, Math.min(Number(args.limit) || 50, 500));
    const [historical, orchestrated] = await Promise.all([
      this.#listDocuments(COLLECTIONS.deskBacktests, limit).catch(() => []),
      this.#listDocuments(COLLECTIONS.deskReplayRuns, limit).catch(() => []),
    ]);
    return selectBacktests([...historical, ...orchestrated], args);
  }

  async runNextBacktestStep({ backtest_id, write_result = true }) {
    const _t = this.clock.now();
    const run = await this.#getDocument(COLLECTIONS.deskBacktests, backtest_id);
    if (["DONE", "FAILED", "CANCELLED"].includes(run.status)) {
      return { ok: true, backtest_id, status: run.status, step: null, result: run.summary || null };
    }
    const steps = selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskBacktestSteps, 500).catch(() => []), backtest_id);
    const step = steps.find((item) => ["QUEUED", "RUNNING"].includes(item.status));
    if (!step) {
      const trades = selectSimulatedTrades(await this.#listDocuments(COLLECTIONS.deskSimulatedTrades, 500).catch(() => []), backtest_id);
      const done = finalizeBacktestRun(run, steps, trades, _t);
      await this.#setDocument(COLLECTIONS.deskBacktests, backtest_id, done, { merge: true });
      await this.#setDocument(COLLECTIONS.deskBacktestResults, `${backtest_id}_summary`, done.summary, { merge: true });
      return { ok: true, backtest_id, status: done.status, step: null, result: done.summary };
    }
    const started = markBacktestStepRunning(step, _t);
    await this.#setDocument(COLLECTIONS.deskBacktestSteps, started.step_id, started, { merge: true });
    try {
      const setup = await this.#getDocument(COLLECTIONS.deskSetups, step.source_setup_id);
      const replay = await this.market.replaySetup(setup, { write_result, timeframe: "M5" });
      const trade = simulatedTradeFromReplay({ replay, run, step, setup, tick: _t });
      const completed = markBacktestStepDone(started, {
        output_ref: { collection: COLLECTIONS.deskSimulatedTrades, trade_id: trade.trade_id },
        replay,
      }, _t);
      if (write_result) {
        await this.#setDocument(COLLECTIONS.deskSimulatedTrades, trade.trade_id, trade, { merge: true });
      }
      await this.#setDocument(COLLECTIONS.deskBacktestSteps, completed.step_id, completed, { merge: true });
      const updatedSteps = selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskBacktestSteps, 500).catch(() => []), backtest_id);
      const updatedTrades = selectSimulatedTrades(await this.#listDocuments(COLLECTIONS.deskSimulatedTrades, 500).catch(() => []), backtest_id);
      const updatedRun = updateBacktestProgress(run, updatedSteps, updatedTrades, _t);
      await this.#setDocument(COLLECTIONS.deskBacktests, backtest_id, updatedRun, { merge: true });
      if (updatedRun.status === "DONE" && updatedRun.summary) {
        await this.#setDocument(COLLECTIONS.deskBacktestResults, `${backtest_id}_summary`, updatedRun.summary, { merge: true });
      }
      return { ok: true, backtest_id, status: updatedRun.status, step: completed, simulated_trade: trade, replay };
    } catch (error) {
      const failed = markBacktestStepFailed(started, error, _t);
      await this.#setDocument(COLLECTIONS.deskBacktestSteps, failed.step_id, failed, { merge: true });
      const failedRun = { ...run, status: "FAILED", error: publicReplayError(error), updated_at: _t.utc, updated_at_utc: _t.utc, updated_at_paris: _t.paris };
      await this.#setDocument(COLLECTIONS.deskBacktests, backtest_id, failedRun, { merge: true });
      return { ok: false, backtest_id, step: failed, error: publicReplayError(error) };
    }
  }

  async runBacktestUntilDone({ backtest_id, max_steps = 100, write_result = true }) {
    const steps = [];
    let last = null;
    for (let index = 0; index < max_steps; index += 1) {
      last = await this.runNextBacktestStep({ backtest_id, write_result });
      if (last.step) {
        steps.push(last.step);
      }
      if (["DONE", "FAILED", "CANCELLED"].includes(last.status) || !last.step) {
        break;
      }
    }
    const results = await this.getBacktestResults({ backtest_id });
    return { ok: true, backtest_id, status: results.backtest?.status || last?.status || null, steps_run: steps.length, result: results.result, simulated_trades: results.simulated_trades };
  }

  async cancelBacktestRun({ backtest_id, reason }) {
    const _t = this.clock.now();
    const replayRun = await this.#getDocument(COLLECTIONS.deskReplayRuns, backtest_id).catch(() => null);
    if (replayRun) {
      const cancelled = patchReplayRun(replayRun, { status: "CANCELLED", cancel_reason: reason || null }, _t);
      const timeline = replayTimelineEvent(cancelled, null, {
        event_type: "REPLAY_CANCELLED",
        phase: "Replay",
        action: "CANCEL_REPLAY",
        status: cancelled.status,
        note: reason || "Replay cancelled by operator.",
      }, _t);
      await this.#setDocument(COLLECTIONS.deskReplayRuns, backtest_id, cancelled, { merge: true });
      await this.#setDocument(COLLECTIONS.deskReplayTimeline, timeline.event_id, timeline, { merge: true });
      return { ok: true, backtest_id, status: "CANCELLED" };
    }
    const run = await this.#getDocument(COLLECTIONS.deskBacktests, backtest_id);
    const cancelled = { ...run, status: "CANCELLED", revision: Number(run.revision || 0) + 1, cancel_reason: reason || null, updated_at: _t.utc, updated_at_utc: _t.utc, updated_at_paris: _t.paris };
    await this.#setDocument(COLLECTIONS.deskBacktests, backtest_id, cancelled, { merge: true });
    return { ok: true, backtest_id, status: "CANCELLED" };
  }

  async getBacktestResults({ backtest_id }) {
    const backtest = await this.#getDocument(COLLECTIONS.deskBacktests, backtest_id).catch(() => null);
    const replayRun = await this.#getDocument(COLLECTIONS.deskReplayRuns, backtest_id).catch(() => null);
    if (replayRun && !backtest) {
      const replay_positions = selectReplayPositions(await this.#listDocuments(COLLECTIONS.deskReplayPositions, 500).catch(() => []), backtest_id);
      const replay_simulations = selectReplaySimulations(await this.#listDocuments(COLLECTIONS.deskReplayTradeSimulations, 500).catch(() => []), backtest_id);
      const simulated_trades = replay_positions.map(replayPositionToSimulatedTrade).filter(Boolean);
      return {
        ok: true,
        backtest_id,
        backtest: replayRun,
        result: summarizeReplayPositionTrades(simulated_trades, { backtest_id }),
        simulated_trades,
        replay_positions,
        replay_simulations,
      };
    }
    const simulated_trades = selectSimulatedTrades(await this.#listDocuments(COLLECTIONS.deskSimulatedTrades, 500).catch(() => []), backtest_id);
    const results = selectBacktestResults(await this.#listDocuments(COLLECTIONS.deskBacktestResults, 100).catch(() => []), backtest_id);
    return { ok: true, backtest_id, backtest, result: results[0] || backtest?.summary || summarizeBacktestTrades(simulated_trades), simulated_trades };
  }

  async getBacktestTimeline({ backtest_id }) {
    return { ok: true, backtest_id, timeline: selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskBacktestSteps, 500).catch(() => []), backtest_id) };
  }

  async getAuditState(args = {}) {
    return this.strategy.getAuditState(args);
  }

  async getSessionSnapshot({ date, session = "asia_open", instrument }) {
    return this.market.getSessionSnapshot({ date, session, instrument });
  }

  async runFeatureEngine(args = {}) {
    return this.market.runFeatureEngine(args);
  }

  async getMasterAnalysisBundle(args) {
    return buildMasterCutoffBundle(this, args, this.clock);
  }

  async prepareMasterCutoffBundleJob(args = {}) {
    const tick = this.clock.now();
    const job = masterPrepJobStarted(args, tick);
    const existingJob = await this.#getDocument(COLLECTIONS.deskMasterPrepJobs, job.job_id).catch(() => null);
    if (reusablePrepJob(existingJob, args)) {
      const existingBundle = await this.#getDocument(
        COLLECTIONS.deskMasterCutoffBundles,
        existingJob.bundle_id,
      ).catch(() => null);
      if (existingBundle) {
        const cursor = args.save !== false
          ? await this.live.upsertBundle(existingBundle, existingJob, tick)
          : null;
        return {
          ok: true,
          job_id: existingJob.job_id,
          status: existingJob.status,
          bundle_id: existingBundle.bundle_id,
          bundle: existingBundle,
          work_item: null,
          cursor_id: cursor?.cursor?.cursor_id || cursor?.cursor_id || null,
          feature_engine: existingJob.feature_engine || null,
          no_recalculation: true,
          reused_prepared_bundle: true,
        };
      }
    }
    if (monitorPrepJobLocked(existingJob, tick) && args.force_rebuild !== true) {
      return { ok: true, job_id: existingJob.job_id, status: existingJob.status, locked: true, locked_until_paris: existingJob.locked_until_paris };
    }
    await this.#setDocument(COLLECTIONS.deskMasterPrepJobs, job.job_id, job, { merge: true });
    try {
      const cutoff = args.cutoff_paris || args.as_of_utc || tick.paris;
      const featureRun = await this.market.runAutomated(args, cutoff);
      const bundle = await buildMasterCutoffBundle(this, args, this.clock);
      const existingBundle = await this.#getDocument(COLLECTIONS.deskMasterCutoffBundles, bundle.bundle_id).catch(() => null);
      const noRecalculation = Boolean(existingBundle?.source_hash && existingBundle.source_hash === bundle.source_hash && args.force_rebuild !== true);
      if (args.save !== false && !noRecalculation) {
        await this.#setDocument(COLLECTIONS.deskMasterCutoffBundles, bundle.bundle_id, bundle, { merge: true });
        if (bundle.data_quality_audit?.audit_id) {
          await this.#setDocument(COLLECTIONS.deskDataQualityAudits, bundle.data_quality_audit.audit_id, bundle.data_quality_audit, { merge: true });
        }
      }
      const completed = masterPrepJobCompleted(job, noRecalculation ? existingBundle : bundle, tick, { noRecalculation, featureRun });
      if (args.save !== false) {
        await this.#setDocument(COLLECTIONS.deskMasterPrepJobs, completed.job_id, completed, { merge: true });
      }
      const preparedBundle = noRecalculation ? existingBundle : bundle;
      const cursor = args.save !== false
        ? await this.live.upsertBundle(preparedBundle, completed, tick)
        : null;
      return { ok: true, job_id: completed.job_id, status: completed.status, bundle_id: completed.bundle_id, bundle: preparedBundle, work_item: null, cursor_id: cursor?.cursor?.cursor_id || cursor?.cursor_id || null, feature_engine: completed.feature_engine, no_recalculation: noRecalculation };
    } catch (error) {
      const failed = monitorPrepJobFailed(job, error, tick);
      await this.#setDocument(COLLECTIONS.deskMasterPrepJobs, failed.job_id, failed, { merge: true });
      return { ok: false, job_id: failed.job_id, status: failed.status, error: failed.error };
    }
  }

  async getMasterCutoffBundle(args = {}) {
    const scope = resolveOperationalReadScope(args);
    let bundle;
    if (args.bundle_id) {
      const byId = await this.#getDocument(COLLECTIONS.deskMasterCutoffBundles, args.bundle_id).catch(() => null);
      if (byId) assertOperationalDocumentScope(byId, scope);
      bundle = byId || missingMasterCutoffBundle({ ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris, resolved_scope: scope });
      return shouldProjectLiveBundle(args) ? projectLiveBundle(bundle, args) : bundle;
    }
    const docs = await this.#listDocuments(COLLECTIONS.deskMasterCutoffBundles, 200).catch(() => []);
    bundle = selectMasterCutoffBundle(docs, { ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris });
    if (bundle) assertOperationalDocumentScope(bundle, scope);
    bundle ||= missingMasterCutoffBundle({ ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris, resolved_scope: scope });
    return shouldProjectLiveBundle(args) ? projectLiveBundle(bundle, args) : bundle;
  }

  async getMonitorContextBundle(args) {
    return buildManualMonitorBundle(this, args, this.clock);
  }

  async getManualMonitorBundle(args = {}) {
    let bundle;
    if (args.bundle_id) {
      bundle = await this.#getDocument(COLLECTIONS.deskManualMonitorBundles, args.bundle_id).catch(() => null);
      if (bundle) {
        assertOperationalDocumentScope(bundle, resolveOperationalReadScope(args, { requireMaster: true, requireThesis: true }));
        return shouldProjectLiveBundle(args) ? projectLiveBundle(bundle, args) : bundle;
      }
    }
    bundle = await buildManualMonitorBundle(this, args, this.clock);
    return shouldProjectLiveBundle(args) ? projectLiveBundle(bundle, args) : bundle;
  }

  async prepareM15MonitorBundleJob(args = {}) {
    const tick = this.clock.now();
    const checkpoint = manualMonitorCheckpoint(args, tick);
    const job = monitorPrepJobStarted(args, checkpoint, tick);
    const existingJob = await this.#getDocument(COLLECTIONS.deskMonitorPrepJobs, job.job_id).catch(() => null);
    if (reusablePrepJob(existingJob, args)) {
      const existingBundle = await this.#getDocument(
        COLLECTIONS.deskManualMonitorBundles,
        existingJob.bundle_id,
      ).catch(() => null);
      if (existingBundle && reusableMonitorCatchupContext(existingBundle, args)) {
        const cursor = args.save !== false
          ? await this.live.upsertBundle(existingBundle, existingJob, tick)
          : null;
        return {
          ok: true,
          job_id: existingJob.job_id,
          status: existingJob.status,
          bundle_id: existingBundle.bundle_id,
          bundle: existingBundle,
          work_item: null,
          cursor_id: cursor?.cursor?.cursor_id || cursor?.cursor_id || null,
          feature_engine: existingJob.feature_engine || null,
          no_recalculation: true,
          reused_prepared_bundle: true,
        };
      }
    }
    if (monitorPrepJobLocked(existingJob, tick) && args.force_rebuild !== true) {
      return { ok: true, job_id: existingJob.job_id, status: existingJob.status, locked: true, locked_until_paris: existingJob.locked_until_paris };
    }
    await this.#setDocument(COLLECTIONS.deskMonitorPrepJobs, job.job_id, job, { merge: true });
    try {
      const featureRun = await this.market.runAutomated(args, checkpoint.timestamp_paris);
      const bundle = await buildManualMonitorBundle(this, { ...args, timestamp_paris: checkpoint.timestamp_paris }, this.clock);
      const existingBundle = await this.#getDocument(COLLECTIONS.deskManualMonitorBundles, bundle.bundle_id).catch(() => null);
      const noRecalculation = Boolean(existingBundle?.source_hash && existingBundle.source_hash === bundle.source_hash && args.force_rebuild !== true);
      if (args.save !== false && !noRecalculation) {
        await this.#setDocument(COLLECTIONS.deskManualMonitorBundles, bundle.bundle_id, bundle, { merge: true });
        for (const snapshot of Object.values(bundle.rolling_snapshots || {})) {
          if (snapshot?.snapshot_id) {
            await this.#setDocument(COLLECTIONS.deskRollingSnapshots, snapshot.snapshot_id, snapshot, { merge: true });
          }
        }
        if (bundle.data_quality_audit?.audit_id) {
          await this.#setDocument(COLLECTIONS.deskDataQualityAudits, bundle.data_quality_audit.audit_id, bundle.data_quality_audit, { merge: true });
        }
      }
      const completed = monitorPrepJobCompleted(job, noRecalculation ? existingBundle : bundle, tick, { noRecalculation, featureRun });
      if (args.save !== false) {
        await this.#setDocument(COLLECTIONS.deskMonitorPrepJobs, completed.job_id, completed, { merge: true });
      }
      const preparedBundle = noRecalculation ? existingBundle : bundle;
      const cursor = args.save !== false
        ? await this.live.upsertBundle(preparedBundle, completed, tick)
        : null;
      return {
        ok: true,
        job_id: completed.job_id,
        status: completed.status,
        bundle_id: completed.bundle_id,
        bundle: preparedBundle,
        work_item: null,
        cursor_id: cursor?.cursor?.cursor_id || cursor?.cursor_id || null,
        feature_engine: completed.feature_engine,
        no_recalculation: noRecalculation,
      };
    } catch (error) {
      const failed = monitorPrepJobFailed(job, error, tick);
      await this.#setDocument(COLLECTIONS.deskMonitorPrepJobs, failed.job_id, failed, { merge: true });
      return { ok: false, job_id: failed.job_id, status: failed.status, error: failed.error };
    }
  }

  async prepareReplayMonitorBundles(args = {}) {
    const results = [];
    for (const timestamp of args.timestamps_paris || []) {
      results.push(await this.prepareM15MonitorBundleJob({
        ...args,
        timestamp_paris: timestamp,
        mode: args.mode || "replay",
      }));
    }
    return summarizeReplayBundlePrep(args, results);
  }

  async saveManualMonitor(monitor) {
    if (["replay", "backtest"].includes(monitor.mode)) {
      throw deskError("READ_ONLY_REPLAY_FORBIDDEN", "Use saveReplayMonitor for replay/backtest writes.");
    }
    assertLiveStoreWriteScope("saveManualMonitor", monitor);
    assertActiveStrategySaveTarget(monitor, {
      workflow: "LIVE_M15_MONITOR",
      mode: "live",
      operation: "save_manual_monitor",
    });
    const tick = this.clock.now();
    let doc = normalizeManualMonitor({
      ...stripDeskWorkLease(monitor),
      agent_work_item_id: null,
      agent_worker_id: monitor.worker_id || null,
    }, tick);
    if (doc.execution_policy_version === "3.0.0") {
      assertMonitorSetupTransition(doc, { workflow: "LIVE_M15_MONITOR" });
    }
    if (doc.execution_policy_version === STRATEGY_RUNTIME_VERSIONS.execution_policy) {
      const existingMonitor = await this.#getDocument(COLLECTIONS.deskManualMonitors, doc.monitor_id).catch(() => null);
      if (existingMonitor) {
        const idempotentReplay = Number(existingMonitor.expected_revision) === Number(doc.expected_revision)
          && existingMonitor.linked_active_thesis_id === doc.linked_active_thesis_id
          && existingMonitor.run_id === doc.run_id
          && isDeepStrictEqual(existingMonitor.monitor_output, doc.monitor_output);
        if (!idempotentReplay) {
          throw deskError("MONITOR_IDEMPOTENCY_CONFLICT", "The Monitor identifier already belongs to a different command.", {
            monitor_id: doc.monitor_id,
          });
        }
        return {
          ok: true,
          idempotent: true,
          monitor_id: existingMonitor.monitor_id,
          status: existingMonitor.status,
          linked_active_thesis_id: existingMonitor.linked_active_thesis_id || null,
          applied_revision: existingMonitor.applied_revision ?? null,
          setup_count: (existingMonitor.materialized_setup_ids || []).length,
          setup_ids: existingMonitor.materialized_setup_ids || [],
          replaced_setup_ids: existingMonitor.replaced_setup_ids || [],
          replacement_count: (existingMonitor.replaced_setup_ids || []).length,
          front_projection: existingMonitor.front_projection || null,
        };
      }
    }
    const scopedSetupDocs = await this.#queryCollectionDocuments({
      collection: COLLECTIONS.deskSetups,
      filters: [{ field: "run_id", operator: "==", value: doc.run_id }],
      limit: 1_000,
    }).catch(() => []);
    const existingSetups = scopedSetupDocs.filter((setup) => setup.strategy_id === doc.strategy_id
      && setup.session === doc.session
      && (setup.trading_date || setup.date) === doc.trading_date
      && (setup.run_id || setup.replay_run_id) === doc.run_id
      && String(setup.mode || "live") === String(doc.mode || "live"));
    let currentThesisForCas = null;
    if (doc.execution_policy_version === STRATEGY_RUNTIME_VERSIONS.execution_policy) {
      const [thesisDocs, positionDocs] = await Promise.all([
        this.#queryCollectionDocuments({
          collection: COLLECTIONS.deskActiveTheses,
          filters: [{ field: "run_id", operator: "==", value: doc.run_id }],
          limit: 200,
        }).catch(() => []),
        this.#queryCollectionDocuments({
          collection: COLLECTIONS.deskPositions,
          filters: [{ field: "run_id", operator: "==", value: doc.run_id }],
          limit: 1_000,
        }).catch(() => []),
      ]);
      const currentThesis = currentThesisForCas = selectActiveTheses(thesisDocs, {
        strategy_id: doc.strategy_id,
        session: doc.session,
        mode: doc.mode || "live",
        trading_date: doc.trading_date,
        run_id: doc.run_id,
        status: "any",
      }).active_thesis;
      const currentPosition = selectActivePosition(positionDocs, {
        thesis_id: currentThesis?.thesis_id || doc.linked_active_thesis_id || null,
      }).position;
      const currentSetup = existingSetups.find((setup) => [
        "SETUP_CANDIDATE",
        "PRE_ARMED",
        "ARMED_CONDITIONAL",
      ].includes(String(setup.status || setup.lifecycle_status || setup.setup_status || "").toUpperCase()))
        || existingSetups[0]
        || null;
      doc = canonicalizeMonitorStrategyPayload(doc, {
        workflow: "LIVE_M15_MONITOR",
        sourceMode: "live",
        currentState: {
          thesis: currentThesis,
          setup: currentSetup,
          position: currentPosition,
          pinned_plan: currentThesis?.pinned_plan || null,
          replan: { state: currentThesis?.status === "REPLAN_REQUIRED" ? "REQUESTED" : "IDLE" },
        },
      });
    }
    if (doc.execution_policy_version === STRATEGY_RUNTIME_VERSIONS.execution_policy) {
      const expectedRevision = Number(doc.expected_revision);
      const actualRevision = currentThesisForCas === null ? null : Number(currentThesisForCas.revision || 0);
      const thesisId = doc.linked_active_thesis_id || currentThesisForCas?.thesis_id || null;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0
        || !currentThesisForCas
        || thesisId !== currentThesisForCas.thesis_id
        || expectedRevision !== actualRevision) {
        throw deskError("MONITOR_REVISION_CONFLICT", "Monitor expected_revision no longer matches the canonical active thesis.", {
          expected_revision: Number.isFinite(expectedRevision) ? expectedRevision : null,
          actual_revision: actualRevision,
          thesis_id: thesisId,
          actual_thesis_id: currentThesisForCas?.thesis_id || null,
        });
      }
      const commandMaterial = doc.deterministic_monitor_command
        || doc.monitor_output?.command
        || doc.monitor_output
        || {};
      doc = {
        ...doc,
        linked_active_thesis_id: thesisId,
        monitor_command_hash: doc.deterministic_monitor_command?.canonical_hash
          || doc.strategy_normalization_audit?.canonical_hash
          || createHash("sha256").update(JSON.stringify(commandMaterial)).digest("hex"),
      };
    }
    const setupMutation = buildLiveSetupMutationDocsFromMonitor({
      monitor: doc,
      existingSetups,
      tick,
    });
    const frontProjection = await this.front.prepareProjection(doc, "MONITOR", doc.monitor_id, tick);
    const monitorSetupDocs = setupMutation.materializedSetups;
    const replacedSetupDocs = setupMutation.replacedSetups;
    doc = {
      ...doc,
      materialized_setup_ids: monitorSetupDocs.map((setup) => setup.setup_record_id),
      replaced_setup_ids: replacedSetupDocs.map((setup) => setup.setup_record_id),
    };
    const sourceWrite = { collection: COLLECTIONS.deskManualMonitors, documentId: doc.monitor_id, data: doc, merge: true };
    const setupWrites = setupMutation.allSetups.map((setup) => ({
      collection: COLLECTIONS.deskSetups, documentId: setup.setup_record_id, data: setup, merge: true,
    }));
    let monitorCommit = null;
    if (doc.execution_policy_version === STRATEGY_RUNTIME_VERSIONS.execution_policy) {
      if (typeof this.persistence.commitLiveMonitorMutation !== "function") {
        throw deskError("MONITOR_CAS_UNAVAILABLE", "V5 Monitor persistence must provide an atomic compare-and-set boundary.");
      }
      const thesisPatch = doc.thesis_update && typeof doc.thesis_update === "object"
        ? {
            ...doc.thesis_update,
            ...executionScopeFields(doc),
            thesis_id: currentThesisForCas.thesis_id,
            master_id: doc.linked_master_analysis_id || doc.master_id,
          }
        : {};
      monitorCommit = await this.persistence.commitLiveMonitorMutation({
        monitorCollection: COLLECTIONS.deskManualMonitors,
        monitorId: doc.monitor_id,
        monitorDoc: doc,
        commandHash: doc.monitor_command_hash,
        stateCollection: COLLECTIONS.deskActiveTheses,
        stateId: currentThesisForCas.thesis_id,
        expectedRevision: Number(doc.expected_revision),
        statePatch: {
          ...thesisPatch,
          plan_id: currentThesisForCas.plan_id,
          pinned_plan: currentThesisForCas.pinned_plan,
          updated_at: tick.utc,
          updated_at_utc: tick.utc,
          updated_at_paris: tick.paris,
        },
        writes: [
          sourceWrite,
          ...setupWrites,
          ...(monitor.front_projection ? frontProjection.writes : []),
        ],
        frontStatePrecondition: monitor.front_projection ? frontProjection.currentStatePrecondition : null,
      });
      doc = monitorCommit.monitor || { ...doc, applied_revision: monitorCommit.revision };
      if (monitorCommit.replayed) {
        return {
          ok: true,
          idempotent: true,
          monitor_id: doc.monitor_id,
          status: doc.status,
          linked_active_thesis_id: doc.linked_active_thesis_id || null,
          applied_revision: monitorCommit.revision,
          setup_count: monitorSetupDocs.length,
          setup_ids: monitorSetupDocs.map((setup) => setup.setup_record_id),
          replaced_setup_ids: replacedSetupDocs.map((setup) => setup.setup_record_id),
          replacement_count: replacedSetupDocs.length,
          front_projection: frontProjection.result,
        };
      }
    } else if (monitor.front_projection) {
      await this.front.commitProjection({
        sourceWrite,
        plan: frontProjection,
        additionalWrites: setupWrites,
      });
    } else if (typeof this.persistence.writeDocuments === "function") {
      await this.persistence.writeDocuments([sourceWrite, ...setupWrites]);
    } else {
      await this.#setDocument(sourceWrite.collection, sourceWrite.documentId, sourceWrite.data, { merge: true });
      for (const write of setupWrites) {
        await this.#setDocument(write.collection, write.documentId, write.data, { merge: true });
      }
    }
    const paper_trigger = await materializeTriggeredLiveMonitor({
      persistence: this.persistence,
      monitor: doc,
      setups: monitorSetupDocs,
      tick,
    }).catch((error) => ({
      ok: false,
      status: "FAILED",
      error: error.code || error.message || String(error),
    }));
    if (doc.context_transmission) {
      await this.saveMonitorContextTransmission({
        ...doc.context_transmission,
        ...executionScopeFields(doc),
        linked_monitor_id: doc.monitor_id,
        linked_thesis_id: doc.linked_active_thesis_id || doc.context_transmission.linked_thesis_id,
        session: doc.session,
      });
    }
    if (doc.alert?.required || doc.alert?.send_to_telegram || doc.alert?.severity) {
      await this.saveMonitorAlert({
        ...doc.alert,
        ...executionScopeFields(doc),
        linked_monitor_id: doc.monitor_id,
        linked_thesis_id: doc.linked_active_thesis_id || doc.alert.linked_thesis_id,
        timestamp_paris: doc.timestamp_paris,
      });
    }
    if (doc.execution_policy_version !== STRATEGY_RUNTIME_VERSIONS.execution_policy && doc.thesis_update && doc.linked_active_thesis_id) {
      await this.updateActiveThesis({
        ...doc.thesis_update,
        ...executionScopeFields(doc),
        thesis_id: doc.linked_active_thesis_id,
        master_id: doc.linked_master_analysis_id || doc.master_id,
      });
    }
    const live_replan = await prepareLiveReplanMasterAfterMonitor(this, doc).catch((error) => ({
      ok: false,
      status: "failed",
      skipped: false,
      error: error.message || String(error),
    }));
    const broker_entry = paper_trigger.status === "MATERIALIZED"
      ? await this.execution.processEligiblePositions({
          strategy_id: doc.strategy_id,
          trading_date: doc.trading_date,
          session: doc.session,
          run_id: doc.run_id,
        }).catch((error) => ({
          ok: false,
          status: "FAILED",
          error: error.code || error.message || String(error),
        }))
      : { ok: true, status: "SKIPPED", reason: paper_trigger.reason || "NO_NEW_PAPER_POSITION" };
    const broker_management = await this.execution.materializeManagementFromMonitor(doc).catch((error) => ({
      ok: false,
      status: "failed",
      error: error.code || error.message || String(error),
    }));
    return {
      ok: true,
      monitor_id: doc.monitor_id,
      status: doc.status,
      linked_active_thesis_id: doc.linked_active_thesis_id || null,
      setup_count: monitorSetupDocs.length,
      setup_ids: monitorSetupDocs.map((setup) => setup.setup_record_id),
      replaced_setup_ids: replacedSetupDocs.map((setup) => setup.setup_record_id),
      replacement_count: replacedSetupDocs.length,
      applied_revision: monitorCommit?.revision ?? null,
      paper_trigger,
      broker_entry,
      work_item_id: null,
      live_replan,
      broker_management,
      front_projection: frontProjection.result,
    };
  }

  async logTool(log) {
    try {
      const _t = this.clock.now();
      const id = `${_t.epochMs}_${createHash("sha1").update(JSON.stringify(log)).digest("hex").slice(0, 10)}`;
      await this.#setDocument(COLLECTIONS.deskToolLogs, id, {
        ...log,
        called_at: _t.utc,
        called_at_utc: _t.utc,
        called_at_paris: _t.paris,
      });
    } catch {
      // Logging must not break the trading desk MCP path.
    }
  }

  async #getDocument(collection, documentId) {
    return this.persistence.getDocument(collection, documentId);
  }

  async #listDocuments(collection, pageSize = 50) {
    return this.persistence.listDocuments(collection, pageSize);
  }

  async #queryDocuments({ parentPath, collectionId, fromUtc, toUtc, orderField = "timestamp_utc", limit = 500 }) {
    return this.persistence.queryDocuments({ parentPath, collectionId, fromUtc, toUtc, orderField, limit });
  }

  async #queryCollectionDocuments({ collection, filters = [], orderBy = [], limit = 50 }) {
    return this.persistence.queryCollectionDocuments({ collection, filters, orderBy, limit });
  }

  async #setDocument(collection, documentId, data, { merge = false } = {}) { return this.persistence.setDocument(collection, documentId, data, { merge }); }
}

attachResearchLabStoreMethods(PersistentDeskStore);
attachAgentRuntimeStoreMethods(PersistentDeskStore);
attachStrategySignalBusStoreMethods(PersistentDeskStore, { commandActor, strategyKernelResponse });
