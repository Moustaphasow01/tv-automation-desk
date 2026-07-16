import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATASETS } from "./schemas.js";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "./persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "./tradingview-webhook.js";
import { replaySetupOutcome } from "@tv-automation/desk-replay-engine";
import {
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  createDeskExecutionScope,
  normalizeDecision,
  planThesisSetupPositionSplit,
  strategyDefinition,
} from "@tv-automation/desk-domain";
import {
  canonicalizeReplayBundle,
  projectReplayBundle,
  replayTransportContract,
} from "./replay-bundle-view.js";
import {
  prepareLiveReplanMasterAfterMonitor,
} from "./live-orchestration.js";
import { floorParisCheckpoint, isLiveMonitorCheckpointInWindow } from "./live-scope.js";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  buildReplayPositionFromTriggeredSetup,
  evaluateReplayPositionOnRows,
  evaluateReplaySetupOnRows,
  projectReplayActiveThesis,
  recommendReplayCadenceMinutes,
  selectActiveReplaySetups,
} from "./replay-continuity.js";
import {
  DeskContractService,
  compactContract,
  contractContext,
  contractHandshake,
  contractHash,
  contractSavePayload,
} from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import {
  DeskPackService,
  compactPack,
  datasetRef,
  replaySourceCoverage,
} from "./desk-pack-service.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { DeskLiveService } from "./desk-live-service.js";
import { DeskFrontService } from "./desk-front-service.js";
import { DeskMarketFeatureService } from "./desk-market-feature-service.js";
import {
  compareDeskWorkItems,
  DeskReplayService,
} from "./desk-replay-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(__dirname, "..");
const COLLECTIONS = DESK_COLLECTIONS;
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";
const NY_OPEN_STRATEGY_ID = "ny_open_1530";
const NY_OPEN_STRATEGY_NAME = "NY Open 15:30";
const NY_OPEN_SESSION = "ny_open";
const NY_OPEN_CUTOFF_TIME = "15:30:00";
const NY_OPEN_STRICT_ENTRY_TIME = "15:35:00";
const NY_OPEN_STRICT_END_TIME = "22:30:00";
const NY_OPEN_PRICING_MODES = ["conservative", "middle", "optimistic"];
const NY_OPEN_DEFAULT_PRICING_MODE = "conservative";

export function createDeskStoreFromEnv() {
  const mode = process.env.DESK_GPT_MCP_STORE || process.env.DESK_MCP_STORE || "postgres";
  if (mode === "postgres" || mode === "postgresql") {
    return new PersistentDeskStore(new SystemClock(), new PostgresDeskPersistence());
  }
  throw new Error(`unsupported_store_mode:${mode}`);
}

function deskEnvironment() {
  return process.env.DESK_ENVIRONMENT || process.env.ENVIRONMENT || "prod";
}

function replayOrchestrationPort() {
  return {
    assertReplayBundleExecutable,
    assertReplayCanAdvance,
    assertReplayContractSave,
    assertRunPackScope,
    buildOrchestratedReplayRunDoc,
    buildReplayIntervalSimulation,
    buildReplayMasterBundle,
    buildReplayMonitorApplication,
    buildReplayMonitorBundle,
    buildReplayReplanContext,
    buildReplaySetupDocs,
    buildReplayStepDoc,
    deriveActiveThesisFromMaster,
    nextReplayAction,
    normalizeReplayActiveThesis,
    normalizeReplayContextTransmission,
    normalizeReplayMasterAnalysis,
    normalizeReplayMonitor,
    offsetIso,
    patchReplayRun,
    patchReplayStep,
    patchReplayThesis,
    pinReplaySources,
    replayCreationResult,
    replayTimelineEvent,
    resolveReplayMasterPreparation,
    resolveReplayStep,
    scopedReplayChildId,
    selectBacktestSteps,
    selectLatestReplayMaster,
    selectReplayActiveThesis,
    selectReplayBundle,
    selectReplayBundleForRead,
    selectReplayBundles,
    selectReplayMonitorForStep,
    selectReplayMonitors,
    selectReplayPositions,
    selectReplayScopedSetups,
    selectReplayTimeline,
  };
}

function marketFeaturePort() {
  return {
    assertRawWindowQuery,
    assertReplayRunMatchesQuery,
    buildConditionStatusDoc,
    buildCrossAssetDeltaDocs,
    buildDeterministicFeatureSet,
    buildFreshCrossAssetDelta,
    buildScopedPackRawWindow,
    canonicalTimeframe,
    crossAssetDeltaReady,
    datasetTimeframe,
    featureDatasetCandidates,
    featureRunCompleted,
    featureRunFailed,
    featureRunStarted,
    latestClose,
    marketFeedCandidates,
    normalizeFeatureRows,
    normalizeOperationalQuery,
    publicReplayError,
    rawWindowDatasetCandidates,
    replaySetupOnCandles,
    replayWindowForSetup,
    resampleRows,
    resolveFeatureEngineActiveThesis,
    resolvePackForState,
    rowMatchesInstrument,
    selectConditionStatus,
    selectCrossAssetDelta,
    selectLevelMap,
    selectSessionSnapshot,
    selectTechnicalEvents,
    summarizeCrossAssetDelta,
    summarizeFeatureOutput,
  };
}

export class PersistentDeskStore {
  constructor(clock = new SystemClock(), persistence = null) {
    this.clock = clock;
    if (!persistence) throw new Error("document_persistence_required");
    this.persistence = persistence;
    this.contracts = new DeskContractService({ persistence, clock });
    this.packs = new DeskPackService({ persistence, clock });
    this.live = new DeskLiveService({ persistence, clock, host: this });
    this.front = new DeskFrontService({ persistence, clock, marketFeedCandidates, canonicalTimeframe });
    this.market = new DeskMarketFeatureService({ persistence, clock, host: this, port: marketFeaturePort() });
    this.replay = new DeskReplayService({ persistence, clock, host: this, orchestration: replayOrchestrationPort() });
    this.livePackPublishingEnabled = false;
  }

  async health() {
    return this.persistence.health();
  }

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

  async getDataset({ pack_id, pack_build_id, dataset, as_of_utc, mode = "live", format = "json", max_rows = 1000 }) {
    return this.packs.getDataset({ pack_id, pack_build_id, dataset, as_of_utc, mode, format, max_rows });
  }

  async getMarketLevels({ pack_id, instrument }) {
    return this.packs.getMarketLevels({ pack_id, instrument });
  }

  async getMacroCalendar({ date, pack_id, pack_build_id, as_of_utc, mode = "live", importance_min = "medium" } = {}) {
    return this.packs.getMacroCalendar({ date, pack_id, pack_build_id, as_of_utc, mode, importance_min });
  }

  async getFrontDailyMacroCalendar({ date, importance_min = "medium" } = {}) {
    return this.front.getDailyMacroCalendar({ date, importance_min });
  }

  async getFrontLiveMarketSnapshot({ date } = {}) {
    return this.front.getLiveMarketSnapshot({ date });
  }

  async getNewsDigest({ date, session = "asia_open", pack_id, pack_build_id, as_of_utc, mode = "live" } = {}) {
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
    const docs = await this.#listDocuments(COLLECTIONS.deskSetups, Math.max(50, Math.min(Number(limit) || 50, 500)));
    return filterSetupDocs(docs, { pack_id, analysis_id, decision_id, status, primary_only, limit });
  }

  async replayDeskSetups(args = {}) {
    throw deskError("LEGACY_REPLAY_FORBIDDEN", "replayDeskSetups cannot mutate source setups; create an orchestrated replay run.", { args_present: Object.keys(args).sort() });
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
    const _t = this.clock.now();
    const payload = stripDeskWorkLease(masterAnalysis);
    const analysis_id = payload.analysis_id || masterAnalysisVNextId(payload);
    const existing = await this.#getDocument(COLLECTIONS.deskMasterAnalyses, analysis_id).catch(() => ({}));
    const setupDocs = buildMasterSetupDocs(payload, { analysis_id }, _t);
    const doc = {
      ...existing,
      ...payload,
      analysis_id,
      agent_work_item_id: null,
      agent_worker_id: masterAnalysis.worker_id || existing.agent_worker_id || null,
      setup_count: setupDocs.length,
      setup_ids: setupDocs.map((setup) => setup.setup_record_id),
      ...writeTimestamps(payload, existing, _t),
    };
    const frontProjection = await this.front.prepareProjection(doc, "MASTER", analysis_id, _t);
    if (payload.front_projection) {
      await this.front.commitProjection({
        sourceWrite: { collection: COLLECTIONS.deskMasterAnalyses, documentId: analysis_id, data: doc, merge: true },
        plan: frontProjection,
      });
    } else {
      await this.#setDocument(COLLECTIONS.deskMasterAnalyses, analysis_id, doc, { merge: true });
    }
    for (const setup of setupDocs) {
      await this.#setDocument(COLLECTIONS.deskSetups, setup.setup_record_id, setup, { merge: true });
    }
    const strict_replay = await this.#applyNyOpenStrictReplay({
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
    return { ok: true, analysis_id, setup_count: setupDocs.length, setup_ids: setupDocs.map((setup) => setup.setup_record_id), work_item_id: null, strict_replay, front_projection: frontProjection.result };
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
    assertLiveStoreWriteScope("saveHourlyMonitor", monitor);
    const _t = this.clock.now();
    const monitor_id = monitor.monitor_id || hourlyMonitorVNextId(monitor);
    const existing = await this.#getDocument(COLLECTIONS.deskHourlyMonitors, monitor_id).catch(() => ({}));
    const doc = {
      ...existing,
      ...monitor,
      monitor_id,
      ...writeTimestamps(monitor, existing, _t),
    };
    const frontProjection = await this.front.prepareProjection(doc, "MONITOR", monitor_id, _t);
    if (monitor.front_projection) {
      await this.front.commitProjection({
        sourceWrite: { collection: COLLECTIONS.deskHourlyMonitors, documentId: monitor_id, data: doc, merge: true },
        plan: frontProjection,
      });
    } else {
      await this.#setDocument(COLLECTIONS.deskHourlyMonitors, monitor_id, doc, { merge: true });
    }
    return { ok: true, monitor_id, front_projection: frontProjection.result };
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

  async commitFrontOperatorCommandMutation(plan) {
    return this.front.commitOperatorCommandMutation(plan);
  }

  async getLevelMap({ date, session = "asia_open", instrument }) {
    return this.market.getLevelMap({ date, session, instrument });
  }

  async getTechnicalEvents({ date, session = "asia_open", instrument, from, to, event_type }) {
    return this.market.getTechnicalEvents({ date, session, instrument, from, to, event_type });
  }

  async getCrossAssetDelta({ timestamp_paris, window = "1h" }) {
    return this.market.getCrossAssetDelta({ timestamp_paris, window });
  }

  async ensureCrossAssetDelta({ timestamp_paris, window = "1h", save = true, raw_scope } = {}) {
    return this.market.ensureCrossAssetDelta({ timestamp_paris, window, save, raw_scope });
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
    const positions = await this.#listDocuments(COLLECTIONS.deskPositions, 200).catch(() => []);
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
    return buildLiveDeskState(this, args, this.clock);
  }

  async getFrontMasterState(args = {}) {
    return buildFrontMasterState(this, args, this.clock);
  }

  async getFrontMonitorState(args = {}) {
    return buildFrontMonitorState(this, args, this.clock);
  }

  async getNyOpenStrategyState(args = {}) {
    return buildNyOpenStrategyState(this, {
      ...(args || {}),
      strategy_id: NY_OPEN_STRATEGY_ID,
      session: NY_OPEN_SESSION,
    }, this.clock);
  }

  async prepareNyOpenMasterBundle(args = {}) {
    const date = args.date || String(this.clock.now().paris).slice(0, 10);
    const cutoff_paris = args.cutoff_paris || nyOpenCutoffParis(date);
    const result = await this.prepareMasterCutoffBundleJob({
      ...args,
      ...nyOpenOperationalScope(date, cutoff_paris),
      cutoff_paris,
      instruments: ["MNQ", "MES", "NQ", "ES"],
      save: args.save !== false,
    });
    return normalizeNyOpenBundlePrep(result, { date, cutoff_paris });
  }

  async getStrategyPerformance(args = {}) {
    const strategy_id = resolveStrategySelection(args);
    const filterId = strategy_id === "all" ? null : strategy_id;
    const trades = filterStrategyTrades(await this.#listDocuments(COLLECTIONS.deskStrategyTrades, 500).catch(() => []), args, filterId);
    const setups = filterStrategySetups(await this.#listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []), args, filterId);
    return buildStrategyPerformance({ strategy_id, trades, setups, args });
  }

  async getStrategyCalendar(args = {}) {
    const strategy_id = requireStrategyId(args);
    const docs = await this.#loadStrategyDocuments(strategy_id);
    return buildStrategyCalendar(docs, args, this.clock);
  }

  async getStrategyDayDetail(args = {}) {
    const strategy_id = requireStrategyId(args);
    const docs = await this.#loadStrategyDocuments(strategy_id);
    return buildStrategyDayDetail(docs, { ...args, strategy_id, as_of_paris: this.clock.now().paris });
  }

  async getLiveTimelineEventDetail(args = {}) {
    const strategy_id = requireStrategyId(args);
    const docs = await this.#loadStrategyDocuments(strategy_id);
    return buildLiveTimelineEventDetail(docs, { ...args, strategy_id, as_of_paris: this.clock.now().paris });
  }

  async recomputeStrategyPerformance(args = {}) {
    const tick = this.clock.now();
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    const strict_replay = await this.#applyNyOpenStrictReplay({ ...args, strategy_id }).catch((error) => ({ ok: false, skipped: true, error: publicReplayError(error) }));
    const docs = await this.#loadStrategyDocuments(strategy_id);
    const recomputed = recomputeStrategyPerformanceDocs(docs, { ...args, strategy_id }, tick);
    for (const day of recomputed.daily_performance) {
      await this.#setDocument(COLLECTIONS.deskStrategyDailyPerformance, day.perf_day_id, day, { merge: true });
    }
    for (const point of recomputed.equity_curve) {
      await this.#setDocument(COLLECTIONS.deskStrategyEquityCurve, point.point_id, point, { merge: true });
    }
    await this.#setDocument(COLLECTIONS.deskStrategyStats, strategy_id, recomputed.stats, { merge: true });
    await this.#setDocument(COLLECTIONS.deskAuditLogs, recomputed.audit.audit_id, recomputed.audit, { merge: true });
    return { ok: true, strategy_id, strict_replay, ...recomputed.summary };
  }

  async markNyOpenStrategyEvent(args = {}) {
    const tick = this.clock.now();
    const action = normalizeNyOpenAction(args);
    if (action === "replay_strict_setup") {
      const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
      const strict_replay = await this.#applyNyOpenStrictReplay({ ...args, strategy_id });
      const docs = await this.#loadStrategyDocuments(strategy_id);
      const recomputed = recomputeStrategyPerformanceDocs(docs, { ...args, strategy_id }, tick);
      for (const day of recomputed.daily_performance) {
        await this.#setDocument(COLLECTIONS.deskStrategyDailyPerformance, day.perf_day_id, day, { merge: true });
      }
      for (const point of recomputed.equity_curve) {
        await this.#setDocument(COLLECTIONS.deskStrategyEquityCurve, point.point_id, point, { merge: true });
      }
      await this.#setDocument(COLLECTIONS.deskStrategyStats, strategy_id, recomputed.stats, { merge: true });
      return { ok: true, action, status: "done", strict_replay, ...recomputed.summary };
    }
    const target = await this.#resolveStrategyActionTarget(args, action);
    if (!target) {
      return { ok: false, status: "missing", action: args.action, error: "strategy_target_not_found" };
    }
    const patch = strategyActionPatch(action, tick);
    const collection = target.type === "trade" ? COLLECTIONS.deskStrategyTrades : COLLECTIONS.deskSetups;
    await this.#setDocument(collection, target.id, patch, { merge: true });
    const audit = strategyAuditLog({
      strategy_id: args.strategy_id || NY_OPEN_STRATEGY_ID,
      action,
      document_type: target.type,
      document_id: target.id,
      previous_value: target.doc.status || null,
      new_value: patch.status,
      performed_by: args.performed_by || "dashboard_operator",
      reason: args.reason,
      tick,
    });
    await this.#setDocument(COLLECTIONS.deskAuditLogs, audit.audit_id, audit, { merge: true });
    return { ok: true, action, document_type: target.type, document_id: target.id, status: patch.status, audit_id: audit.audit_id };
  }

  async getReplayState(args = {}) {
    if (!args.backtest_id) throw deskError("SCOPE_REQUIRED", "backtest_id is required for a selected replay view.", { field: "backtest_id" });
    const replayRuns = selectBacktests(await this.#listDocuments(COLLECTIONS.deskReplayRuns, Math.max(50, Math.min(Number(args.limit) || 50, 500))).catch(() => []), args);
    const selectedReplay = selectBacktest(replayRuns.backtests, args.backtest_id);
    if (selectedReplay) {
      const selectedId = selectedReplay.backtest_id;
      const steps = selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskReplaySteps, 500).catch(() => []), selectedId);
      const timeline = selectReplayTimeline(await this.#listDocuments(COLLECTIONS.deskReplayTimeline, 500).catch(() => []), selectedId);
      const monitors = selectReplayMonitors(await this.#listDocuments(COLLECTIONS.deskReplayMonitors, 500).catch(() => []), selectedId);
      const positions = selectReplayPositions(await this.#listDocuments(COLLECTIONS.deskReplayPositions, 500).catch(() => []), selectedId);
      const setups = selectReplayScopedSetups(await this.#listDocuments(COLLECTIONS.deskReplaySetups, 500).catch(() => []), selectedId);
      const simulations = selectReplaySimulations(await this.#listDocuments(COLLECTIONS.deskReplayTradeSimulations, 500).catch(() => []), selectedId);
      const activeThesis = selectReplayActiveThesis(await this.#listDocuments(COLLECTIONS.deskReplayActiveTheses, 500).catch(() => []), selectedId);
      const bundles = selectReplayBundles(await this.#listDocuments(COLLECTIONS.deskReplayBundles, 500).catch(() => []), selectedId);
      const workItems = (await this.#queryCollectionDocuments({
        collection: COLLECTIONS.deskAgentWorkItems,
        filters: [{ field: "backtest_id", operator: "==", value: selectedId }],
        limit: 200,
      }).catch(() => []))
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

  async claimNextDeskWork(args = {}) {
    return claimNextDeskWorkFacade(this, args, this.clock.now());
  }

  async claimNextLive(args = {}) {
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

  async driveReplayAutomation(args = {}) {
    return this.replay.driveAutomation(args);
  }

  async createOrchestratedReplayDay(args = {}) {
    return this.replay.createOrchestratedReplayDay(args);
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
    const cancelled = { ...run, status: "CANCELLED", cancel_reason: reason || null, updated_at: _t.utc, updated_at_utc: _t.utc, updated_at_paris: _t.paris };
    await this.#setDocument(COLLECTIONS.deskBacktests, backtest_id, cancelled, { merge: true });
    return { ok: true, backtest_id, status: "CANCELLED" };
  }

  async getBacktestResults({ backtest_id }) {
    const backtest = await this.#getDocument(COLLECTIONS.deskBacktests, backtest_id).catch(() => null);
    const simulated_trades = selectSimulatedTrades(await this.#listDocuments(COLLECTIONS.deskSimulatedTrades, 500).catch(() => []), backtest_id);
    const results = selectBacktestResults(await this.#listDocuments(COLLECTIONS.deskBacktestResults, 100).catch(() => []), backtest_id);
    return { ok: true, backtest_id, backtest, result: results[0] || backtest?.summary || summarizeBacktestTrades(simulated_trades), simulated_trades };
  }

  async getBacktestTimeline({ backtest_id }) {
    return { ok: true, backtest_id, timeline: selectBacktestSteps(await this.#listDocuments(COLLECTIONS.deskBacktestSteps, 500).catch(() => []), backtest_id) };
  }

  async getAuditState(args = {}) {
    const [featureRuns, errors] = await Promise.all([
      this.#listDocuments(COLLECTIONS.deskFeatureRuns, 100).catch(() => []),
      this.#listDocuments(COLLECTIONS.deskErrors, 100).catch(() => []),
    ]);
    const featureDocs = {
      feature_runs: featureRuns,
      errors,
    };
    return buildAuditState(this, args, featureDocs, this.clock);
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
    if (args.bundle_id) {
      const byId = await this.#getDocument(COLLECTIONS.deskMasterCutoffBundles, args.bundle_id).catch(() => null);
      if (byId) assertOperationalDocumentScope(byId, scope);
      return byId || missingMasterCutoffBundle({ ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris, resolved_scope: scope });
    }
    const docs = await this.#listDocuments(COLLECTIONS.deskMasterCutoffBundles, 200).catch(() => []);
    const bundle = selectMasterCutoffBundle(docs, { ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris });
    if (bundle) assertOperationalDocumentScope(bundle, scope);
    return bundle || missingMasterCutoffBundle({ ...args, ...operationalSelectorArgs(scope), cutoff_paris: args.cutoff_paris || scope.cutoff_paris, resolved_scope: scope });
  }

  async getMonitorContextBundle(args) {
    return buildManualMonitorBundle(this, args, this.clock);
  }

  async getManualMonitorBundle(args = {}) {
    if (args.bundle_id) {
      const bundle = await this.#getDocument(COLLECTIONS.deskManualMonitorBundles, args.bundle_id).catch(() => null);
      if (bundle) {
        assertOperationalDocumentScope(bundle, resolveOperationalReadScope(args, { requireMaster: true, requireThesis: true }));
        return bundle;
      }
    }
    return buildManualMonitorBundle(this, args, this.clock);
  }

  async prepareM15MonitorBundleJob(args = {}) {
    const tick = this.clock.now();
    const checkpoint = manualMonitorCheckpoint(args, tick);
    const job = monitorPrepJobStarted(args, checkpoint, tick);
    const existingJob = await this.#getDocument(COLLECTIONS.deskMonitorPrepJobs, job.job_id).catch(() => null);
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
      throw deskError("LEGACY_REPLAY_FORBIDDEN", "Use saveReplayMonitor for replay/backtest writes.");
    }
    assertLiveStoreWriteScope("saveManualMonitor", monitor);
    const tick = this.clock.now();
    const doc = normalizeManualMonitor({
      ...stripDeskWorkLease(monitor),
      agent_work_item_id: null,
      agent_worker_id: monitor.worker_id || null,
    }, tick);
    const frontProjection = await this.front.prepareProjection(doc, "MONITOR", doc.monitor_id, tick);
    if (monitor.front_projection) {
      await this.front.commitProjection({
        sourceWrite: { collection: COLLECTIONS.deskManualMonitors, documentId: doc.monitor_id, data: doc, merge: true },
        plan: frontProjection,
      });
    } else {
      await this.#setDocument(COLLECTIONS.deskManualMonitors, doc.monitor_id, doc, { merge: true });
    }
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
    if (doc.thesis_update && doc.linked_active_thesis_id) {
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
    return { ok: true, monitor_id: doc.monitor_id, status: doc.status, linked_active_thesis_id: doc.linked_active_thesis_id || null, work_item_id: null, live_replan, front_projection: frontProjection.result };
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

  async #setDocument(collection, documentId, data, { merge = false } = {}) {
    return this.persistence.setDocument(collection, documentId, data, { merge });
  }

  async #applyNyOpenStrictReplay(args = {}) {
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    if (strategy_id !== NY_OPEN_STRATEGY_ID || args.strict_mode === false) {
      return { ok: true, skipped: true, reason: "strict_mode_disabled_or_strategy_not_supported" };
    }
    const tick = this.clock.now();
    const sourceSetups = Array.isArray(args.setups) && args.setups.length
      ? args.setups
      : filterStrategySetups(await this.#listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []), strictReplaySetupFilters(args), strategy_id);
    const setup = selectNyOpenStrictSetup(sourceSetups, args);
    if (!setup) {
      return { ok: true, skipped: true, reason: "ny_open_strict_setup_not_found", strategy_id };
    }
    const replayWindow = nyOpenStrictReplayWindow(setup, args);
    const modeResults = [];
    for (const pricing_mode of nyOpenStrictPricingModes()) {
      const replay = await this.market.replaySetup(strictSetupForReplay(setup, pricing_mode), {
        ...args,
        pricing_mode,
        replay_id: nyOpenStrictReplayId(setup, pricing_mode, tick),
        replay_from: replayWindow.from,
        replay_to: replayWindow.to,
        timeframe: args.timeframe || "M5",
        max_rows: args.max_rows || 5000,
      });
      await this.#setDocument(COLLECTIONS.deskSetupReplays, replay.replay_id || `${setupDocumentId(setup)}_${pricing_mode}_strict_latest`, replay, { merge: true });
      const trade = nyOpenStrictTradeFromReplay({ setup, replay, replayWindow, strategy_id, tick, pricing_mode });
      if (trade) {
        await this.#setDocument(COLLECTIONS.deskStrategyTrades, trade.trade_id, trade, { merge: true });
      }
      modeResults.push({ pricing_mode, replay, trade });
    }
    const setupPatch = nyOpenStrictSetupPatch({ setup, modeResults, replayWindow, strategy_id, tick, pricing_mode: args.pricing_mode });
    await this.#setDocument(COLLECTIONS.deskSetups, setupDocumentId(setup), setupPatch, { merge: true });
    const selected = selectedStrictModeResult(modeResults, args.pricing_mode);
    const audit = strategyAuditLog({
      strategy_id,
      action: "nyopen_strict_replay",
      document_type: selected.trade ? "trade" : "setup",
      document_id: selected.trade?.trade_id || setupDocumentId(setup),
      previous_value: setup.status || setup.lifecycle_status || null,
      new_value: selected.trade?.status || setupPatch.status,
      performed_by: args.performed_by || "backend_strict_mode",
      reason: args.reason || "strict_limit_order_from_1535",
      tick,
    });
    await this.#setDocument(COLLECTIONS.deskAuditLogs, audit.audit_id, audit, { merge: true });
    return summarizeNyOpenStrictReplay({ setup, modeResults, audit, replayWindow, strategy_id, pricing_mode: args.pricing_mode });
  }

  async #loadStrategyDocuments(strategy_id) {
    const byStrategy = (collection, limit = 500) => this.#queryCollectionDocuments({
      collection,
      filters: [{ field: "strategy_id", operator: "==", value: strategy_id }],
      limit,
    }).catch(() => []);
    const [masters, theses, setups, manualMonitors, hourlyMonitors, trades, tradeExits, daily, equity, stats, reviews, packs, bundles, liveCursors, workEvents] = await Promise.all([
      byStrategy(COLLECTIONS.deskMasterAnalyses),
      byStrategy(COLLECTIONS.deskActiveTheses),
      byStrategy(COLLECTIONS.deskSetups),
      byStrategy(COLLECTIONS.deskManualMonitors),
      byStrategy(COLLECTIONS.deskHourlyMonitors),
      byStrategy(COLLECTIONS.deskStrategyTrades),
      byStrategy(COLLECTIONS.deskStrategyTradeExits),
      byStrategy(COLLECTIONS.deskStrategyDailyPerformance),
      byStrategy(COLLECTIONS.deskStrategyEquityCurve),
      byStrategy(COLLECTIONS.deskStrategyStats, 50),
      byStrategy(COLLECTIONS.deskStrategyDailyReviews),
      byStrategy(COLLECTIONS.deskPacks),
      byStrategy(COLLECTIONS.deskMasterCutoffBundles),
      this.#listDocuments(LIVE_CURSOR_COLLECTION, 500).catch(() => []),
      this.#listDocuments(COLLECTIONS.deskAgentWorkEvents, 1000).catch(() => []),
    ]);
    return selectStrategyDocuments({
      strategy_id,
      masters,
      theses,
      setups,
      monitors: [...manualMonitors, ...hourlyMonitors],
      trades,
      tradeExits,
      daily,
      equity,
      stats,
      reviews,
      packs,
      bundles,
      liveCursors,
      workEvents,
    });
  }

  async #resolveStrategyActionTarget(args, action) {
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    if (args.trade_id) {
      const trades = await this.#listDocuments(COLLECTIONS.deskStrategyTrades, 500).catch(() => []);
      const trade = trades.find((item) => item.trade_id === args.trade_id && strategyDocMatches(item, strategy_id));
      return trade ? { type: "trade", id: trade.trade_id, doc: trade } : null;
    }
    const setupId = args.setup_id;
    if (!setupId) return null;
    const setups = await this.#listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []);
    const setup = setups.find((item) => setupDocumentId(item) === setupId || item.setup_id === setupId || item.setup_record_id === setupId);
    if (!setup) return null;
    if (action === "mark_setup_triggered") return { type: "setup", id: setupDocumentId(setup), doc: setup };
    return { type: "setup", id: setupDocumentId(setup), doc: setup };
  }
}

function assertLiveStoreWriteScope(toolName, payload = {}) {
  if (["replay", "backtest"].includes(payload.mode)) {
    throw deskError("REPLAY_WRITER_REQUIRED", `${toolName} cannot write replay/backtest data; use replay-scoped writers.`, {
      mode: payload.mode,
    });
  }
  const missing = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc", "timezone"]
    .filter((field) => payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === "");
  if (missing.length) {
    throw deskError("SCOPE_REQUIRED", `${toolName} requires a complete live execution scope.`, { missing });
  }
  const asOfMs = Date.parse(payload.as_of_utc);
  if (!Number.isFinite(asOfMs)) {
    throw deskError("INVALID_SCOPE", `${toolName} requires a valid as_of_utc timestamp.`, {
      as_of_utc: payload.as_of_utc,
    });
  }
  const cutoffParis = payload.cutoff_paris || payload.timestamp_paris || payload.created_at_paris || toParisIso(asOfMs);
  const scope = createDeskExecutionScope({
    strategy_id: payload.strategy_id,
    session: payload.session,
    mode: payload.mode,
    trading_date: payload.trading_date,
    timezone: payload.timezone,
    cutoff_paris: cutoffParis,
    cutoff_utc: new Date(asOfMs).toISOString(),
    run_id: payload.run_id,
  }, { requireRun: true });
  Object.assign(payload, {
    date: payload.date || payload.trading_date,
    as_of_utc: new Date(asOfMs).toISOString(),
    cutoff_paris: scope.cutoff_paris,
    cutoff_utc: scope.cutoff_utc,
    resolved_scope: payload.resolved_scope || scope,
    scope_hash: payload.scope_hash || scope.scope_hash,
  });
  return scope;
}

function masterAnalysisVNextId(masterAnalysis) {
  const run = masterAnalysis.run_id || masterAnalysis.resolved_scope?.run_id || null;
  const session = run ? `${masterAnalysis.session || "session"}_${run}` : masterAnalysis.session;
  return stableVNextId("master", masterAnalysis.trading_date || masterAnalysis.date, session);
}

function activeThesisVNextId(thesis) {
  return stableVNextId("thesis", thesis.linked_master_analysis_id || thesis.valid_from, thesis.instrument);
}

function hourlyMonitorVNextId(monitor) {
  return stableVNextId("monitor", monitor.linked_active_thesis_id, monitor.slot_paris || monitor.timestamp_paris);
}

function writeTimestamps(input, existing, tick) {
  return {
    created_at: input.created_at ?? existing.created_at ?? tick.utc,
    created_at_utc: input.created_at_utc ?? existing.created_at_utc ?? tick.utc,
    created_at_paris: input.created_at_paris ?? existing.created_at_paris ?? tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function splitPositionStateFromThesis(candidate, tick) {
  const plan = planThesisSetupPositionSplit(candidate, { tick });
  if (!plan.migration_required) {
    return { thesisDoc: candidate, positionDoc: null };
  }
  const thesisDoc = {
    ...candidate,
    ...plan.thesis_patch,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const positionDoc = {
    ...plan.position_record,
    created_at: plan.position_record.created_at_utc || tick.utc,
    created_at_utc: plan.position_record.created_at_utc || tick.utc,
    created_at_paris: plan.position_record.created_at_paris || tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  return { thesisDoc, positionDoc };
}

const ACTIVE_THESIS_STATUSES = [
  "THESIS_ACTIVE",
  "THESIS_CONDITIONAL",
  "WAIT_MONITORED",
  "THESIS_WEAKENED",
  "THESIS_AT_RISK",
  "SETUP_ARMED",
  "SETUP_TRIGGERED",
  "REPLAN_REQUIRED",
];

const ACTIVE_THESIS_STATUS_SET = new Set(ACTIVE_THESIS_STATUSES);

function documentTimestampUtc(doc) {
  const value = doc.as_of_utc || doc.cutoff_utc || doc.timestamp_utc || doc.cutoff_paris || doc.timestamp_paris || doc.valid_from || doc.created_at_paris || doc.created_at_utc || doc.saved_at_utc || doc.updated_at_utc || doc.created_at || doc.updated_at;
  if (!value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isDocumentAtOrBefore(doc, asOfUtc) {
  if (!asOfUtc) return true;
  const documentMs = Date.parse(documentTimestampUtc(doc));
  const asOfMs = Date.parse(asOfUtc);
  return Number.isFinite(documentMs) && Number.isFinite(asOfMs) && documentMs <= asOfMs;
}

function normalizeOperationalQuery(args = {}, { requireMaster = false, requireThesis = false } = {}) {
  const required = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc"];
  if (requireMaster) required.push("master_id");
  if (requireThesis) required.push("thesis_id");
  const missing = required.filter((field) => args[field] === undefined || args[field] === null || String(args[field]).trim() === "");
  if (missing.length) throw deskError("SCOPE_REQUIRED", "Operational getter scope is incomplete.", { missing });
  const definition = strategyDefinition(args.strategy_id);
  if (definition.session !== args.session) {
    throw deskError("STRATEGY_SESSION_MISMATCH", "Strategy and session do not match.", {
      strategy_id: args.strategy_id,
      expected_session: definition.session,
      actual_session: args.session,
    });
  }
  if (!["live", "paper", "replay", "backtest"].includes(args.mode)) {
    throw deskError("INVALID_SCOPE", "Unsupported operational mode.", { mode: args.mode });
  }
  const replay = ["replay", "backtest"].includes(args.mode);
  if (replay && !args.backtest_id) throw deskError("SCOPE_REQUIRED", "backtest_id is required for replay/backtest getters.", { field: "backtest_id" });
  if (!replay && args.backtest_id) throw deskError("INVALID_SCOPE", "backtest_id is forbidden for live/paper getters.", { backtest_id: args.backtest_id });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.trading_date)) {
    throw deskError("INVALID_SCOPE", "trading_date must be an ISO date.", { trading_date: args.trading_date });
  }
  const asOfMs = Date.parse(args.as_of_utc);
  if (!Number.isFinite(asOfMs)) throw deskError("INVALID_SCOPE", "as_of_utc must be a valid instant.", { as_of_utc: args.as_of_utc });
  return {
    ...args,
    as_of_utc: new Date(asOfMs).toISOString(),
    backtest_id: args.backtest_id || undefined,
    replay,
  };
}

function assertReplayRunMatchesQuery(run, query) {
  if (!run) throw deskError("RUN_NOT_FOUND", "Replay run was not found.", { backtest_id: query.backtest_id });
  const mismatches = [];
  for (const [field, expected, actual] of [
    ["backtest_id", query.backtest_id, run.backtest_id],
    ["strategy_id", query.strategy_id, run.strategy_id],
    ["session", query.session, run.session],
    ["trading_date", query.trading_date, run.trading_date || run.date],
    ["run_id", query.run_id, run.run_id || run.replay_run_id || run.backtest_id],
  ]) {
    if (expected !== actual) mismatches.push({ field, expected, actual: actual ?? null });
  }
  if (mismatches.length) throw deskError("RUN_SCOPE_MISMATCH", "Replay run does not match the requested scope.", { mismatches });
  if (["INVALIDATED", "QUARANTINED"].includes(run.status)) {
    throw deskError("RUN_SCOPE_MISMATCH", "Replay run is not operationally readable.", { status: run.status });
  }
  return true;
}

function operationalQueryScope(query, run = null) {
  if (run) return { ...(run.resolved_scope || {}), run_id: query.run_id, as_of_utc: query.as_of_utc };
  const asOfMs = Date.parse(query.as_of_utc);
  const scope = createDeskExecutionScope({
    strategy_id: query.strategy_id,
    session: query.session,
    mode: query.mode,
    trading_date: query.trading_date,
    timezone: "Europe/Paris",
    cutoff_paris: toParisIso(asOfMs),
    cutoff_utc: query.as_of_utc,
    run_id: query.run_id,
  }, { requireRun: true });
  return { ...scope, as_of_utc: query.as_of_utc };
}

function assertDocumentMatchesOperationalQuery(document, query, { masterId = null, thesisId = null, code = "CROSS_SCOPE_REFERENCE" } = {}) {
  const mismatches = [];
  for (const [field, expected, actual] of [
    ["strategy_id", query.strategy_id, document.strategy_id],
    ["session", query.session, document.session],
    ["mode", query.mode === "backtest" && document.mode === "replay" ? "replay" : query.mode, document.mode],
    ["trading_date", query.trading_date, document.trading_date || document.date],
    ["run_id", query.run_id, document.run_id || document.replay_run_id],
    ["backtest_id", query.backtest_id || null, document.backtest_id || null],
  ]) {
    if ((expected ?? null) !== (actual ?? null)) mismatches.push({ field, expected: expected ?? null, actual: actual ?? null });
  }
  if (masterId && (document.linked_master_analysis_id || document.master_id) !== masterId) {
    mismatches.push({ field: "master_id", expected: masterId, actual: document.linked_master_analysis_id || document.master_id || null });
  }
  if (thesisId && (document.linked_active_thesis_id || document.thesis_id) !== thesisId) {
    mismatches.push({ field: "thesis_id", expected: thesisId, actual: document.linked_active_thesis_id || document.thesis_id || null });
  }
  const timestamp = documentTimestampUtc(document);
  if (timestamp && Date.parse(timestamp) > Date.parse(query.as_of_utc)) {
    mismatches.push({ field: "as_of_utc", expected: query.as_of_utc, actual: timestamp });
  }
  if (mismatches.length) {
    throw deskError(code, "Operational document does not match the exact query scope.", {
      document_id: document.analysis_id || document.thesis_id || document.monitor_id || null,
      mismatches,
    });
  }
  return true;
}

function withOperationalMetadata(result, query, run = null) {
  const resolved_scope = operationalQueryScope(query, run);
  return {
    ...result,
    resolved_scope,
    scope_hash: run?.scope_hash || resolved_scope.scope_hash || null,
    pack_build_id: run?.pack_build_id || null,
    source_manifest_hash: run?.source_manifest_hash || null,
  };
}

function selectActiveTheses(docs, { strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, instrument, date, status = "active", now } = {}) {
  const strict = Boolean(strategy_id || mode || trading_date || run_id || backtest_id || master_id || as_of_utc);
  const filtered = docs
    .filter((doc) => !strategy_id || doc.strategy_id === strategy_id)
    .filter((doc) => !session || doc.session === session || (!strict && doc.session == null))
    .filter((doc) => !mode || doc.mode === mode)
    .filter((doc) => !trading_date || (doc.trading_date || doc.date) === trading_date)
    .filter((doc) => !run_id || doc.run_id === run_id || doc.replay_run_id === run_id)
    .filter((doc) => !backtest_id || doc.backtest_id === backtest_id)
    .filter((doc) => !master_id || doc.linked_master_analysis_id === master_id)
    .filter((doc) => isDocumentAtOrBefore(doc, as_of_utc))
    .filter((doc) => !instrument || doc.instrument === instrument)
    .filter((doc) => strict || !date || String(doc.valid_from || doc.created_at || "").startsWith(date))
    .filter((doc) => status === "any" || ACTIVE_THESIS_STATUS_SET.has(doc.status))
    .filter((doc) => status === "any" || !isThesisExpired(doc, now))
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
  return { ok: true, count: filtered.length, theses: filtered, active_thesis: filtered[0] || null };
}

function selectLatestMasterAnalysis(docs, { strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, before_date, instrument } = {}) {
  const filtered = docs
    .filter((doc) => !strategy_id || doc.strategy_id === strategy_id)
    .filter((doc) => !session || doc.session === session)
    .filter((doc) => !mode || doc.mode === mode)
    .filter((doc) => !trading_date || (doc.trading_date || doc.date) === trading_date)
    .filter((doc) => !run_id || doc.run_id === run_id || doc.replay_run_id === run_id)
    .filter((doc) => !backtest_id || doc.backtest_id === backtest_id)
    .filter((doc) => !master_id || doc.analysis_id === master_id)
    .filter((doc) => isDocumentAtOrBefore(doc, as_of_utc))
    .filter((doc) => !before_date || String(doc.date || "") <= before_date)
    .filter((doc) => !instrument || doc.full_analysis?.executive_summary?.final_instrument === instrument || doc.instrument === instrument)
    .sort((left, right) => documentTimestampUtc(right).localeCompare(documentTimestampUtc(left)));
  return { ok: true, analysis: filtered[0] || null };
}

function selectLatestHourlyMonitors(docs, { thesis_id, strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, limit = 1 }) {
  const max = Math.max(1, Math.min(Number(limit) || 1, 50));
  const monitors = docs
    .filter((doc) => !thesis_id || doc.linked_active_thesis_id === thesis_id || doc.thesis_id === thesis_id)
    .filter((doc) => !strategy_id || doc.strategy_id === strategy_id)
    .filter((doc) => !session || doc.session === session)
    .filter((doc) => !mode || doc.mode === mode)
    .filter((doc) => !trading_date || (doc.trading_date || doc.date) === trading_date)
    .filter((doc) => !run_id || doc.run_id === run_id || doc.replay_run_id === run_id)
    .filter((doc) => !backtest_id || doc.backtest_id === backtest_id)
    .filter((doc) => !master_id || doc.linked_master_analysis_id === master_id || doc.master_id === master_id)
    .filter((doc) => isDocumentAtOrBefore(doc, as_of_utc))
    .sort((left, right) => String(right.timestamp_paris || right.created_at || "").localeCompare(String(left.timestamp_paris || left.created_at || "")))
    .slice(0, max);
  return { ok: true, count: monitors.length, monitors, latest_monitor: monitors[0] || null };
}

function selectLevelMap(docs, { date, session = "asia_open", instrument }) {
  const maps = docs
    .filter((doc) => !date || doc.date === date)
    .filter((doc) => !session || doc.session === session)
    .filter((doc) => !instrument || doc.instrument === instrument)
    .sort((left, right) => String(right.computed_at || right.updated_at || "").localeCompare(String(left.computed_at || left.updated_at || "")));
  return {
    ok: true,
    count: maps.length,
    level_map: maps[0] || null,
    warning: maps.length ? null : "level_map_not_available_until_feature_engine_runs",
  };
}

function selectTechnicalEvents(docs, { date, session = "asia_open", instrument, from, to, event_type }) {
  const events = docs
    .filter((doc) => !date || String(doc.time_paris || doc.timestamp_paris || "").startsWith(date) || doc.date === date)
    .filter((doc) => !session || doc.session === session || doc.session == null)
    .filter((doc) => !instrument || doc.instrument === instrument)
    .filter((doc) => !event_type || doc.event_type === event_type)
    .filter((doc) => !from || String(doc.time_paris || doc.timestamp_paris || "") >= from)
    .filter((doc) => !to || String(doc.time_paris || doc.timestamp_paris || "") <= to)
    .sort((left, right) => String(right.time_paris || right.timestamp_paris || "").localeCompare(String(left.time_paris || left.timestamp_paris || "")));
  return {
    ok: true,
    count: events.length,
    events,
    warning: events.length ? null : "technical_events_not_available_until_feature_engine_runs",
  };
}

function selectCrossAssetDelta(docs, { timestamp_paris, window = "1h" }) {
  const deltas = docs
    .filter((doc) => !window || doc.window === window)
    .filter((doc) => !timestamp_paris || String(doc.timestamp_paris || "") <= timestamp_paris)
    .sort((left, right) => String(right.timestamp_paris || right.computed_at || "").localeCompare(String(left.timestamp_paris || left.computed_at || "")));
  const selected = deltas[0] || null;
  return crossAssetDeltaResult(selected, { timestamp_paris, window, count: deltas.length, source: "desk_cross_asset_deltas" });
}

function crossAssetDeltaReady(result) {
  return Boolean(result?.delta && result?.stale_check?.is_stale !== true);
}

async function buildFreshCrossAssetDelta(store, { timestamp_paris, window = "1h", computed_at, raw_scope }) {
  const rowsByAsset = await loadCrossAssetRowsFromRawWindows(store, timestamp_paris, raw_scope);
  const deltas = buildCrossAssetDeltaDocs({
    timestamp_paris,
    rowsByAsset,
    computed_at,
  });
  const selected = deltas.find((delta) => delta.window === window) || null;
  return {
    deltas,
    result: crossAssetDeltaResult(selected, {
      timestamp_paris,
      window,
      count: selected ? 1 : 0,
      source: "computed_from_raw_market_feeds",
    }),
  };
}

async function loadCrossAssetRowsFromRawWindows(store, cutoffParis, rawScope) {
  const output = {};
  if (!rawScope) return output;
  for (const asset of ["DXY", "VIX", "US10Y", "US02Y", "GC", "CL"]) {
    const raw = await safeRead(store.getRawWindow({
      ...rawScope,
      instrument: asset,
      timeframe: "M5",
      from: offsetIso(cutoffParis, -96 * 60 * 60 * 1000),
      to: cutoffParis,
      max_rows: 2000,
    }), { rows: [] });
    output[asset] = normalizeFeatureRows(raw.rows || [], { instrument: asset, timeframe: "5", rawRef: null });
  }
  return output;
}

function crossAssetDeltaResult(delta, { timestamp_paris, window = "1h", count = 0, source = null } = {}) {
  const stale_check = crossAssetStaleCheck(delta, { timestamp_paris, window });
  const isStale = stale_check.status === "stale" || stale_check.status === "missing";
  if (isStale) {
    return {
      ok: true,
      count,
      delta: null,
      stale_check,
      status: stale_check.status,
      warning: stale_check.reason,
      source,
    };
  }
  const missingAssets = crossAssetDeltaMissingAssets(delta);
  if (delta && missingAssets.length) {
    return {
      ok: true,
      count,
      delta: null,
      stale_check: {
        ...stale_check,
        status: "missing",
        is_stale: true,
        execution_allowed: false,
        reason: `cross_asset_delta_critical_assets_missing:${missingAssets.join(",")}`,
        missing_assets: missingAssets,
      },
      status: "missing",
      warning: `cross_asset_delta_critical_assets_missing:${missingAssets.join(",")}`,
      source,
    };
  }
  const optionalMissingAssets = crossAssetDeltaOptionalMissingAssets(delta);
  if (delta && optionalMissingAssets.length) {
    const warning = `cross_asset_delta_partial_missing_assets:${optionalMissingAssets.join(",")}`;
    return {
      ok: true,
      count,
      delta: {
        ...delta,
        quality: {
          ...(delta.quality || {}),
          status: "partial",
          execution_allowed: true,
          missing_assets: optionalMissingAssets,
          warning,
        },
      },
      stale_check: {
        ...stale_check,
        status: "partial",
        is_stale: false,
        execution_allowed: true,
        reason: warning,
        missing_assets: optionalMissingAssets,
      },
      status: "partial",
      warning,
      source,
    };
  }
  return {
    ok: true,
    count,
    delta,
    stale_check,
    status: "ready",
    warning: null,
    source,
  };
}

function crossAssetDeltaMissingAssets(delta) {
  if (!delta) {
    return [];
  }
  const assets = delta.assets || {};
  return ["DXY"].filter((asset) => !assets[asset]?.row_count);
}

function crossAssetDeltaOptionalMissingAssets(delta) {
  if (!delta) {
    return [];
  }
  const assets = delta.assets || {};
  return ["VIX", "US10Y", "US02Y"].filter((asset) => !assets[asset]?.row_count);
}

function crossAssetStaleCheck(delta, { timestamp_paris, window }) {
  const maxLagMinutes = { "15m": 15, "1h": 60, "4h": 240, session: 1440 }[window] || 60;
  const requestedMs = timestamp_paris ? Date.parse(timestamp_paris) : NaN;
  const deltaMs = Date.parse(delta?.timestamp_paris || delta?.computed_with_cutoff || delta?.computed_at || "");
  if (!delta) {
    return {
      status: "missing",
      is_stale: true,
      requested_timestamp_paris: timestamp_paris || null,
      delta_timestamp_paris: null,
      returned_timestamp_paris: null,
      max_lag_minutes: maxLagMinutes,
      max_allowed_lag_minutes: maxLagMinutes,
      age_minutes: null,
      execution_allowed: false,
      reason: "cross_asset_delta_not_available_until_feature_engine_runs",
    };
  }
  if (!timestamp_paris || !Number.isFinite(requestedMs) || !Number.isFinite(deltaMs)) {
    return {
      status: "ready",
      is_stale: false,
      requested_timestamp_paris: timestamp_paris || null,
      delta_timestamp_paris: delta.timestamp_paris || null,
      returned_timestamp_paris: delta.timestamp_paris || delta.computed_with_cutoff || null,
      max_lag_minutes: maxLagMinutes,
      max_allowed_lag_minutes: maxLagMinutes,
      age_minutes: null,
      execution_allowed: true,
      reason: null,
    };
  }
  const ageMinutes = (requestedMs - deltaMs) / 60000;
  const stale = ageMinutes < 0 || ageMinutes > maxLagMinutes;
  return {
    status: stale ? "stale" : "ready",
    is_stale: stale,
    requested_timestamp_paris: timestamp_paris,
    delta_timestamp_paris: delta.timestamp_paris || null,
    returned_timestamp_paris: delta.timestamp_paris || delta.computed_with_cutoff || null,
    max_lag_minutes: maxLagMinutes,
    max_allowed_lag_minutes: maxLagMinutes,
    age_minutes: roundNumber(ageMinutes, 2),
    execution_allowed: !stale,
    reason: stale ? "cross_asset_delta_stale_for_requested_timestamp" : null,
  };
}

function selectConditionStatus(docs, { thesis_id, timestamp_paris }) {
  const statuses = docs
    .filter((doc) => !thesis_id || doc.linked_thesis_id === thesis_id)
    .filter((doc) => !timestamp_paris || String(doc.timestamp_paris || "") <= timestamp_paris)
    .sort((left, right) => String(right.timestamp_paris || right.computed_at || "").localeCompare(String(left.timestamp_paris || left.computed_at || "")));
  return {
    ok: true,
    count: statuses.length,
    condition_status: statuses[0] || null,
    warning: statuses.length ? null : "condition_status_not_available_until_condition_engine_runs",
  };
}

function selectSessionSnapshot(docs, { date, session = "asia_open", instrument }) {
  const snapshots = (docs || [])
    .filter((doc) => !date || doc.date === date)
    .filter((doc) => !session || doc.session === session)
    .filter((doc) => !instrument || doc.instrument === instrument)
    .sort((left, right) => String(right.timestamp_paris || right.computed_at || "").localeCompare(String(left.timestamp_paris || left.computed_at || "")));
  return {
    ok: true,
    count: snapshots.length,
    session_snapshot: snapshots[0] || null,
    warning: snapshots.length ? null : "session_snapshot_not_available_until_feature_engine_runs",
  };
}

function featureRunStarted(args, tick) {
  const run_id = stableVNextId("feature_run", args.date, `${args.session || "asia_open"}_${args.cutoff_paris || tick.paris}`);
  return {
    run_id,
    date: args.date,
    session: args.session || "asia_open",
    cutoff_paris: args.cutoff_paris || tick.paris,
    status: "RUNNING",
    instruments: args.instruments || ["MNQ", "MES"],
    save: args.save !== false,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function featureRunCompleted(run, result, tick) {
  return {
    ...run,
    status: "DONE",
    summary: {
      instruments: Object.fromEntries(Object.entries(result.instruments || {}).map(([instrument, item]) => [instrument, {
        level_count: item.level_count,
        technical_event_count: item.technical_event_count,
        rows: item.rows,
      }])),
      cross_asset_windows: Object.keys(result.cross_asset_deltas || {}),
      condition_status_id: result.condition_status?.condition_status_id || null,
    },
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function featureRunFailed(run, error, tick) {
  const error_id = stableVNextId("feature_error", run.run_id, tick.utc);
  return {
    ...run,
    status: "FAILED",
    error_id,
    error: {
      error_id,
      source: "run_feature_engine",
      message: publicReplayError(error),
      date: run.date,
      session: run.session,
      created_at: tick.utc,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    },
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function featureDatasetCandidates(instrument) {
  return {
    "5": [`${instrument}_M5`, `${instrument}_5`, `${instrument}_5m`, `${instrument}_m5`],
    "15": [`${instrument}_M15`, `${instrument}_15`, `${instrument}_15m`, `${instrument}_m15`],
    "1H": [`${instrument}_H1`, `${instrument}_1H`, `${instrument}_60`, `${instrument}_h1`],
    "4H": [`${instrument}_H4`, `${instrument}_4H`, `${instrument}_240`, `${instrument}_h4`],
  };
}

function normalizeFeatureRows(rows, { instrument, timeframe, rawRef }) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const timestamp_utc = normalizeUtcIso(row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time || row.date);
      const epochMs = Date.parse(timestamp_utc);
      return {
        ...row,
        instrument,
        timeframe: canonicalTimeframe(row.timeframe || timeframe),
        timestamp_utc,
        timestamp_paris: Number.isFinite(epochMs) ? toParisIso(epochMs) : row.timestamp_paris || null,
        open: numeric(row.open),
        high: numeric(row.high),
        low: numeric(row.low),
        close: numeric(row.close),
        volume: numeric(row.volume),
        raw_ref: row.raw_ref || rawRef || null,
      };
    })
    .filter((row) => row.timestamp_utc && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close))
    .sort((left, right) => String(left.timestamp_utc).localeCompare(String(right.timestamp_utc)));
}

function buildDeterministicFeatureSet({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at }) {
  const mainRows = candlesByTimeframe["5"] || candlesByTimeframe.M5 || candlesByTimeframe["15"] || [];
  const session_snapshot = buildSessionSnapshotDoc({ date, session, instrument, rows: mainRows, cutoff_paris, computed_at });
  const level_map = buildLevelMapDoc({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at });
  const technical_events = buildTechnicalEventDocs({ date, session, instrument, rows: mainRows, levels: level_map.levels, cutoff_paris, computed_at });
  return { session_snapshot, level_map, technical_events };
}

function buildSessionSnapshotDoc({ date, session, instrument, rows, cutoff_paris, computed_at }) {
  const latest = rows.at(-1) || {};
  const sessionRows = rows.filter((row) => String(row.timestamp_paris || "").startsWith(date));
  return {
    snapshot_id: `${date}_${session}_${instrument}_snapshot`,
    date,
    session,
    timestamp_paris: cutoff_paris,
    instrument,
    instruments: {
      [instrument]: {
        latest_close: latest.close ?? null,
        latest_timestamp_paris: latest.timestamp_paris || null,
      },
    },
    session_high_low: highLowBlock(sessionRows.length ? sessionRows : rows),
    asia_high_low: highLowBlock(rowsBetweenParis(sessionRows, "00:00", "08:00")),
    overnight_high_low: highLowBlock(rowsBetweenParis(sessionRows, "00:00", "09:30")),
    previous_ny_high_low: highLowBlock(rowsBetweenParis(rows, "15:30", "22:00", { beforeDate: date })),
    vwap: vwapValue(sessionRows.length ? sessionRows : rows),
    poc_vah_val: {},
    range_state: rangeState(sessionRows.length ? sessionRows : rows),
    volatility_state: volatilityState(sessionRows.length ? sessionRows : rows),
    computed_with_cutoff: cutoff_paris,
    anti_lookahead_compliant: true,
    computed_at,
  };
}

function buildLevelMapDoc({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at }) {
  const candidates = [];
  for (const [timeframe, rows] of Object.entries(candlesByTimeframe || {})) {
    candidates.push(...levelCandidatesFromRows(rows, timeframe, date));
  }
  const baseRows = candlesByTimeframe["5"] || candlesByTimeframe.M5 || candlesByTimeframe["15"] || [];
  const atr = recentAverageRange(baseRows) || 1;
  const tolerance = Math.max(atr * 0.35, ["MNQ", "NQ", "MES", "ES"].includes(instrument) ? 2 : 0.1);
  const clusters = clusterFeatureCandidates(candidates, tolerance);
  const levels = clusters.map((cluster, index) => scoreFeatureCluster({
    cluster,
    rows: baseRows,
    tolerance,
    index: index + 1,
    computed_at,
  })).sort((left, right) => Number(right.technical_weight_raw) - Number(left.technical_weight_raw));
  levels.forEach((level, index) => {
    level.rank = index + 1;
  });
  return {
    level_map_id: `${date}_${session}_${instrument}_levels`,
    date,
    session,
    instrument,
    method: {
      name: "mcp_pivot_cluster_v1",
      cluster_tolerance_points: roundNumber(tolerance),
    },
    levels,
    quality: {
      status: levels.length ? "ready" : "missing",
      level_count: levels.length,
    },
    computed_with_cutoff: cutoff_paris,
    anti_lookahead_compliant: true,
    computed_at,
  };
}

function levelCandidatesFromRows(rows, timeframe, date) {
  const sorted = normalizeFeatureRows(rows || [], { instrument: null, timeframe, rawRef: null });
  const out = [];
  for (let i = 2; i < sorted.length - 2; i += 1) {
    const center = sorted[i];
    const window = sorted.slice(i - 2, i + 3);
    if (center.high >= Math.max(...window.map((row) => row.high))) {
      out.push(featureCandidate(center.high, "resistance", timeframe, "swing_high", center));
    }
    if (center.low <= Math.min(...window.map((row) => row.low))) {
      out.push(featureCandidate(center.low, "support", timeframe, "swing_low", center));
    }
  }
  const sessionRows = sorted.filter((row) => String(row.timestamp_paris || "").startsWith(date));
  const scoped = sessionRows.length ? sessionRows : sorted;
  if (scoped.length) {
    const high = maxBy(scoped, (row) => row.high);
    const low = maxBy(scoped, (row) => -row.low);
    out.push(featureCandidate(high.high, "resistance", timeframe, "session_high", high));
    out.push(featureCandidate(low.low, "support", timeframe, "session_low", low));
  }
  const latest = sorted.at(-1);
  for (const field of ["vwap", "poc", "vah", "val"]) {
    const price = numeric(latest?.[field] ?? latest?.studies?.[field], NaN);
    if (Number.isFinite(price)) {
      out.push(featureCandidate(price, "mixed", timeframe, field.toUpperCase(), latest));
    }
  }
  return out;
}

function featureCandidate(price, role, timeframe, source, row) {
  return {
    price,
    role,
    timeframe: canonicalTimeframe(timeframe),
    source,
    raw_ref: {
      timestamp_utc: row.timestamp_utc || null,
      timestamp_paris: row.timestamp_paris || null,
      timeframe: canonicalTimeframe(timeframe),
      price,
      raw_ref: row.raw_ref || null,
    },
  };
}

function clusterFeatureCandidates(candidates, tolerance) {
  const clusters = [];
  for (const candidate of [...candidates].sort((left, right) => left.price - right.price)) {
    const last = clusters.at(-1);
    const lastMid = last ? average(last.map((item) => item.price)) : null;
    if (!last || Math.abs(lastMid - candidate.price) > tolerance) {
      clusters.push([candidate]);
    } else {
      last.push(candidate);
    }
  }
  return clusters;
}

function scoreFeatureCluster({ cluster, rows, tolerance, index, computed_at }) {
  const prices = cluster.map((item) => item.price);
  const level_from = Math.min(...prices) - tolerance / 2;
  const level_to = Math.max(...prices) + tolerance / 2;
  const mid = average(prices);
  const roleVotes = {
    support: cluster.filter((item) => item.role === "support").length,
    resistance: cluster.filter((item) => item.role === "resistance").length,
    mixed: cluster.filter((item) => item.role === "mixed").length,
  };
  const type = roleVotes.support > roleVotes.resistance ? "support" : roleVotes.resistance > roleVotes.support ? "resistance" : "mixed";
  const touches = (rows || []).filter((row) => row.low <= level_to && row.high >= level_from);
  const reaction_stats = {
    sample_size: touches.length,
    avg_reaction_points: roundNumber(average(touches.slice(-8).map((row) => Math.max(Math.abs(row.high - mid), Math.abs(row.low - mid)))) || 0),
    breach_rate: 0,
    reaction_hit_rate: touches.length ? 1 : 0,
  };
  const mtf = new Set(cluster.map((item) => item.timeframe));
  const weight = cluster.length + touches.length * 0.4 + mtf.size * 1.2;
  return {
    level_id: `level_${String(index).padStart(3, "0")}_${type}_${roundNumber(mid)}`,
    level_from: roundNumber(level_from),
    level_to: roundNumber(level_to),
    mid: roundNumber(mid),
    type,
    timeframe: [...mtf].sort().join(","),
    source: [...new Set(cluster.map((item) => item.source))].sort().join(","),
    touch_count: touches.length,
    reaction_stats,
    last_test: touches.at(-1) ? rawRefForRow(touches.at(-1)) : {},
    technical_weight_raw: roundNumber(weight),
    actionability: type === "mixed" ? "reference" : touches.length >= 2 ? "actionable" : "watch",
    evidence: {
      candidate_count: cluster.length,
      cluster_prices: prices.map(roundNumber),
      multi_timeframe_count: mtf.size,
      role_votes: roleVotes,
    },
    raw_data_refs: {
      candidate_refs: cluster.slice(0, 20).map((item) => item.raw_ref),
    },
    computed_at,
    anti_lookahead_compliant: true,
  };
}

function buildTechnicalEventDocs({ date, session, instrument, rows, levels, cutoff_paris, computed_at }) {
  const events = [];
  const sorted = rows || [];
  for (const level of (levels || []).slice(0, 12)) {
    let previousClose = null;
    for (const row of sorted) {
      if (previousClose == null) {
        previousClose = row.close;
        continue;
      }
      const event_type = technicalEventType({ row, previousClose, level });
      if (event_type) {
        const accepted = ["breakout", "breakdown", "reclaim", "acceptance"].includes(event_type);
        events.push({
          event_id: `${date}_${instrument}_${event_type}_${level.level_id}_${compactTimestamp(row.timestamp_paris || row.timestamp_utc)}`,
          date,
          session,
          time_paris: row.timestamp_paris,
          timestamp_paris: row.timestamp_paris,
          instrument,
          event_type,
          level_id: level.level_id,
          timeframe: row.timeframe || "5",
          evidence: {
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            previous_close: previousClose,
            level_from: level.level_from,
            level_to: level.level_to,
          },
          raw_data_refs: rawRefForRow(row),
          accepted,
          rejected: !accepted,
          follow_through_points: 0,
          retest_done: event_type === "retest",
          computed_with_cutoff: cutoff_paris,
          anti_lookahead_compliant: true,
          computed_at,
        });
      }
      previousClose = row.close;
    }
  }
  return dedupeBy(events, (event) => event.event_id).slice(-200);
}

function technicalEventType({ row, previousClose, level }) {
  if (previousClose <= level.level_to && row.close > level.level_to) return "breakout";
  if (previousClose >= level.level_from && row.close < level.level_from) return "breakdown";
  if (row.high > level.level_to && row.close < level.mid) return "sweep";
  if (row.low < level.level_from && row.close > level.mid) return "reclaim";
  if (row.low <= level.level_to && row.high >= level.level_from) return "retest";
  return null;
}

function buildCrossAssetDeltaDocs({ timestamp_paris, rowsByAsset, computed_at }) {
  return ["15m", "1h", "4h", "session"].map((window) => {
    const sinceMs = Date.parse(timestamp_paris) - ({ "15m": 0.25, "1h": 1, "4h": 4, session: 96 }[window] * 60 * 60 * 1000);
    const assets = {};
    for (const [asset, rows] of Object.entries(rowsByAsset || {})) {
      const scoped = (rows || []).filter((row) => Date.parse(row.timestamp_paris || row.timestamp_utc) >= sinceMs);
      assets[asset] = deltaBlock(scoped);
    }
    return {
      delta_id: `${compactTimestamp(timestamp_paris)}_${window}`,
      timestamp_paris,
      window,
      assets,
      ...assets,
      summary: summarizeAssetDeltas(assets),
      computed_with_cutoff: timestamp_paris,
      anti_lookahead_compliant: true,
      computed_at,
    };
  });
}

function buildConditionStatusDoc({ thesis, timestamp_paris, latest_price, computed_at }) {
  const conditions_go = (thesis.wait_to_go_conditions || []).map((condition, index) => evaluateConditionItem(condition, { latest_price, index, kind: "go" }));
  const invalidations = (thesis.invalidation_conditions || []).map((condition, index) => evaluateConditionItem(condition, { latest_price, index, kind: "invalidation" }));
  return {
    condition_status_id: `${thesis.thesis_id || "thesis"}_${compactTimestamp(timestamp_paris)}`,
    linked_thesis_id: thesis.thesis_id || null,
    timestamp_paris,
    conditions_go,
    wait_to_go: conditions_go,
    invalidations,
    summary: {
      go_validated: conditions_go.filter((item) => item.status === "validated").length,
      go_total: conditions_go.length,
      invalidations_triggered: invalidations.filter((item) => item.status === "triggered").length,
      invalidations_total: invalidations.length,
    },
    computed_with_cutoff: timestamp_paris,
    anti_lookahead_compliant: true,
    computed_at,
  };
}

function evaluateConditionItem(condition, { latest_price, index, kind }) {
  const text = typeof condition === "string" ? condition : condition?.condition || condition?.label || condition?.description || JSON.stringify(condition);
  const target = numeric(condition?.price ?? condition?.level ?? condition?.target ?? condition?.from ?? condition?.to, NaN);
  const operator = condition?.operator || condition?.comparison || null;
  let status = "unknown";
  if (Number.isFinite(latest_price) && Number.isFinite(target) && operator) {
    const ok = compareNumber(latest_price, operator, target);
    status = kind === "invalidation" ? ok ? "triggered" : "not_triggered" : ok ? "validated" : "not_validated";
  }
  return {
    condition_id: condition?.condition_id || `${kind}_${index + 1}`,
    label: text,
    status,
    latest_price: Number.isFinite(latest_price) ? latest_price : null,
    target: Number.isFinite(target) ? target : null,
    operator,
    evidence: {
      source: "deterministic_condition_engine_v1",
      raw_condition: condition,
    },
    raw_refs: [],
  };
}

function compareNumber(left, operator, right) {
  return {
    ">": left > right,
    ">=": left >= right,
    "<": left < right,
    "<=": left <= right,
    "==": left === right,
  }[String(operator)] ?? false;
}

function summarizeFeatureOutput(features, candlesByTimeframe) {
  return {
    ok: true,
    rows: Object.fromEntries(Object.entries(candlesByTimeframe || {}).map(([timeframe, rows]) => [timeframe, rows.length])),
    snapshot_id: features.session_snapshot.snapshot_id,
    level_map_id: features.level_map.level_map_id,
    level_count: features.level_map.levels.length,
    level_quality: features.level_map.quality,
    technical_event_count: features.technical_events.length,
    top_levels: features.level_map.levels.slice(0, 5),
  };
}

function summarizeCrossAssetDelta(delta) {
  return {
    delta_id: delta.delta_id,
    window: delta.window,
    assets: Object.keys(delta.assets || {}).sort(),
    rows: Object.fromEntries(Object.entries(delta.assets || {}).map(([asset, item]) => [asset, item.row_count || 0])),
  };
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function highLowBlock(rows) {
  if (!rows?.length) {
    return {};
  }
  const high = maxBy(rows, (row) => row.high);
  const low = maxBy(rows, (row) => -row.low);
  return {
    high: high.high,
    high_time_paris: high.timestamp_paris || null,
    low: low.low,
    low_time_paris: low.timestamp_paris || null,
    range_points: roundNumber(high.high - low.low),
  };
}

function rowsBetweenParis(rows, startHm, endHm, { beforeDate } = {}) {
  return (rows || []).filter((row) => {
    const ts = String(row.timestamp_paris || "");
    if (beforeDate && ts.slice(0, 10) >= beforeDate) {
      return false;
    }
    const hm = ts.slice(11, 16);
    return hm >= startHm && hm <= endHm;
  });
}

function vwapValue(rows) {
  let weighted = 0;
  let volume = 0;
  for (const row of rows || []) {
    const vol = numeric(row.volume, 0);
    const typical = (row.high + row.low + row.close) / 3;
    weighted += typical * vol;
    volume += vol;
  }
  return volume ? roundNumber(weighted / volume) : null;
}

function rangeState(rows) {
  const block = highLowBlock(rows);
  const atr = recentAverageRange(rows);
  return {
    range_points: block.range_points || 0,
    atr_14: atr,
    range_vs_atr: atr ? roundNumber((block.range_points || 0) / atr) : null,
  };
}

function volatilityState(rows) {
  const avgRange = recentAverageRange(rows, 20);
  const atr = recentAverageRange(rows, 14);
  const ratio = atr ? avgRange / atr : 0;
  return {
    atr_14: atr,
    avg_recent_range: avgRange,
    regime: ratio > 1.2 ? "expanded" : ratio < 0.7 ? "compressed" : rows?.length ? "normal" : "unknown",
  };
}

function recentAverageRange(rows, count = 14) {
  const ranges = (rows || []).slice(-count).map((row) => numeric(row.high, 0) - numeric(row.low, 0)).filter((value) => value > 0);
  return ranges.length ? roundNumber(average(ranges)) : 0;
}

function average(values) {
  const valid = (values || []).filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function maxBy(values, score) {
  return [...(values || [])].sort((left, right) => score(right) - score(left))[0] || {};
}

function rawRefForRow(row) {
  return {
    timestamp_utc: row?.timestamp_utc || null,
    timestamp_paris: row?.timestamp_paris || null,
    timeframe: row?.timeframe || null,
    raw_ref: row?.raw_ref || null,
  };
}

function dedupeBy(values, keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function compactTimestamp(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "time";
}

function deltaBlock(rows) {
  const first = (rows || [])[0];
  const last = (rows || []).at(-1);
  if (!first || !last) {
    return { row_count: 0, first_close: null, last_close: null, delta_points: null, delta_pct: null };
  }
  const delta = numeric(last.close, 0) - numeric(first.close, 0);
  return {
    row_count: rows.length,
    first_close: first.close,
    last_close: last.close,
    first_timestamp_paris: first.timestamp_paris || null,
    last_timestamp_paris: last.timestamp_paris || null,
    delta_points: roundNumber(delta),
    delta_pct: first.close ? roundNumber((delta / first.close) * 100) : null,
  };
}

function summarizeAssetDeltas(assets) {
  const parts = Object.entries(assets || {})
    .filter(([, item]) => item.row_count)
    .map(([asset, item]) => `${asset}:${item.delta_points ?? "n/a"}`);
  return parts.length ? parts.join(" ") : "cross_asset_data_missing";
}

function latestClose(rows) {
  const latest = (rows || []).at(-1);
  return latest ? latest.close : null;
}

function offsetIso(value, offsetMs) {
  const base = Date.parse(value);
  if (!Number.isFinite(base)) {
    return value;
  }
  return toParisIso(base + offsetMs);
}

function isThesisExpired(thesis, now = new SystemClock().now()) {
  const validUntil = thesis?.valid_until || thesis?.setup_expiry_time || thesis?.requires_replan_after || null;
  if (!validUntil) {
    return false;
  }
  const validUntilMs = Date.parse(validUntil);
  const nowMs = Date.parse(now?.paris || now?.utc || now);
  return Number.isFinite(validUntilMs) && Number.isFinite(nowMs) && validUntilMs < nowMs;
}

function selectExpiredTheses(docs, { session, now } = {}) {
  return (docs || [])
    .filter((doc) => !session || doc.session === session || doc.session == null)
    .filter((doc) => ACTIVE_THESIS_STATUS_SET.has(doc.status))
    .filter((doc) => isThesisExpired(doc, now))
    .sort((left, right) => String(right.valid_until || right.updated_at || "").localeCompare(String(left.valid_until || left.updated_at || "")));
}

function markThesisExpired(thesis, tick) {
  return {
    ...thesis,
    status: "EXPIRED",
    archived_reason: thesis.archived_reason || "valid_until_elapsed",
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function normalizeDeskJob(job, tick) {
  const job_id = job.job_id || stableVNextId("job", `${job.job_type}_${job.date || tick.paris.slice(0, 10)}`, job.session || "desk");
  return {
    ...job,
    job_id,
    status: job.status || "QUEUED",
    session: job.session || "asia_open",
    mode: job.mode || "live",
    result_ref: job.result_ref ?? null,
    error: job.error ?? null,
    metadata: job.metadata || {},
    created_at: job.created_at ?? tick.utc,
    created_at_utc: job.created_at_utc ?? tick.utc,
    created_at_paris: job.created_at_paris ?? tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function patchDeskJob(existing, update, tick) {
  return {
    ...existing,
    ...update,
    metadata: {
      ...(existing.metadata || {}),
      ...(update.metadata || {}),
    },
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    created_at: existing.created_at ?? tick.utc,
    created_at_utc: existing.created_at_utc ?? tick.utc,
    created_at_paris: existing.created_at_paris ?? tick.paris,
  };
}

function selectDeskJobs(docs, { job_type, status, date, session, mode, limit = 50 } = {}) {
  const jobs = (docs || [])
    .filter((job) => !job_type || job.job_type === job_type)
    .filter((job) => !status || job.status === status)
    .filter((job) => !date || job.date === date)
    .filter((job) => !session || job.session === session)
    .filter((job) => !mode || job.mode === mode)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return { ok: true, count: jobs.length, jobs };
}

function selectAlerts(docs, { date, thesis_id, limit = 50 } = {}) {
  const alerts = (docs || [])
    .filter((alert) => !date || String(alert.timestamp_paris || alert.created_at_paris || alert.created_at || "").startsWith(date))
    .filter((alert) => !thesis_id || alert.linked_thesis_id === thesis_id)
    .sort((left, right) => String(right.timestamp_paris || right.created_at || "").localeCompare(String(left.timestamp_paris || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return { ok: true, count: alerts.length, alerts };
}

function selectActivePosition(docs, { thesis_id } = {}) {
  const positions = (docs || [])
    .filter((position) => !thesis_id || position.linked_thesis_id === thesis_id)
    .filter((position) => ["active", "protected", "partial_taken"].includes(position.status))
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
  return { ok: true, position: positions[0] || null };
}

async function safeRead(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}


async function resolveFeatureEngineActiveThesis(store, args) {
  const required = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc", "master_id"];
  if (required.some((field) => args[field] === undefined || args[field] === null || String(args[field]).trim() === "")) {
    return null;
  }
  const thesis = await store.getActiveThesis({
    strategy_id: args.strategy_id,
    session: args.session,
    mode: args.mode,
    trading_date: args.trading_date,
    run_id: args.run_id,
    as_of_utc: args.as_of_utc,
    master_id: args.master_id,
    status: "active",
  }).then((result) => result.active_thesis);
  if (args.thesis_id && thesis?.thesis_id !== args.thesis_id) {
    throw deskError("THESIS_SCOPE_MISMATCH", "The feature engine did not resolve the requested active thesis.", {
      expected_thesis_id: args.thesis_id,
      actual_thesis_id: thesis?.thesis_id || null,
      master_id: args.master_id,
    });
  }
  return thesis;
}

function dateForState(args, tick) {
  return args.trading_date || args.date || String(tick.paris || tick.utc).slice(0, 10);
}

async function resolvePackForState(store, { date, session, timezone }) {
  if (session === "asia_open") {
    return safeRead(
      store.getLatestAsiaOpenPack({ date, timezone }).then((summary) => store.getDeskPack({ pack_id: summary.pack_id })),
      null,
    );
  }
  return safeRead(store.getDeskPack({ pack_id: `${date}_${session}` }), null);
}

function contractSummary(contracts) {
  return {
    master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
    monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
  };
}

function featureInstrument(activeThesis, latestMaster) {
  const value = activeThesis?.instrument ||
    latestMaster?.full_analysis?.executive_summary?.final_instrument ||
    latestMaster?.instrument ||
    "MNQ";
  return ["MNQ", "MES", "NQ", "ES"].includes(value) ? value : "MNQ";
}

async function readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris }) {
  const instrument = featureInstrument(activeThesis, latestMaster);
  const crossReader = typeof store.ensureCrossAssetDelta === "function" ? store.ensureCrossAssetDelta.bind(store) : store.getCrossAssetDelta.bind(store);
  const [level, technical, cross, snapshot, condition] = await Promise.all([
    safeRead(store.getLevelMap({ date, session, instrument }), { ok: true, count: 0, level_map: null, warning: "level_map_not_available_until_feature_engine_runs" }),
    safeRead(store.getTechnicalEvents({ date, session, instrument }), { ok: true, count: 0, events: [], warning: "technical_events_not_available_until_feature_engine_runs" }),
    safeRead(crossReader({ timestamp_paris, window: crossAssetWindowForSession(session, timestamp_paris) }), { ok: true, count: 0, delta: null, stale_check: { is_stale: true, reason: "cross_asset_delta_not_available_until_feature_engine_runs" }, warning: "cross_asset_delta_not_available_until_feature_engine_runs" }),
    safeRead(store.getSessionSnapshot({ date, session, instrument }), { ok: true, count: 0, session_snapshot: null, warning: "session_snapshot_not_available_until_feature_engine_runs" }),
    activeThesis?.thesis_id
      ? safeRead(store.getConditionStatus({ thesis_id: activeThesis.thesis_id, timestamp_paris }), { ok: true, count: 0, condition_status: null, warning: "condition_status_not_available_until_condition_engine_runs" })
      : Promise.resolve({ ok: true, count: 0, condition_status: null, warning: "active_thesis_not_found" }),
  ]);
  return { instrument, level, technical, cross, snapshot, condition };
}

function crossAssetWindowForSession(session, timestampParis) {
  if (session !== "asia_open") {
    return "1h";
  }
  return parisDateWeekday(timestampParis) === 1 ? "session" : "4h";
}

function parisDateWeekday(timestampParis) {
  const [year, month, day] = String(timestampParis || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dataReadiness({ pack, level, technical, cross, condition, rawWindow }) {
  return {
    pack: pack ? "ready" : "missing",
    level_map: level?.level_map ? "ready" : "missing",
    technical_events: technical?.events?.length ? "ready" : "missing",
    cross_asset_delta: cross?.delta ? "ready" : "missing",
    condition_status: condition?.condition_status ? "ready" : "not_applicable",
    raw_window: rawWindow?.ok === false ? "failing" : "unknown",
  };
}

function datasetReadinessStatus(ref) {
  if (!ref) {
    return "missing";
  }
  return ref.status === "not_configured" || ref.empty_ok === true ? "not_configured" : "ready";
}

function compactMasterAnalysis(analysis) {
  if (!analysis) {
    return null;
  }
  const full = analysis.full_analysis || {};
  const executive = full.executive_summary || analysis.executive_summary || {};
  const thesis = full.active_thesis || analysis.active_thesis || {};
  const setup = preferredSetupFromMasterFull(full);
  return {
    analysis_id: analysis.analysis_id || null,
    pack_id: analysis.pack_id || null,
    created_at_paris: analysis.created_at_paris || analysis.created_at || null,
    decision: firstNonEmpty(executive.final_decision, full.final_decision, analysis.final_decision, setup?.decision, setup ? "setup_candidate" : null),
    instrument: firstNonEmpty(executive.final_instrument, analysis.final_instrument, thesis.instrument, setup?.instrument),
    direction: firstNonEmpty(executive.final_direction, analysis.final_direction, thesis.direction, setup?.direction),
    confidence_pct: firstNumber(executive.confidence_pct, analysis.confidence_pct, thesis.confidence_pct, setup?.confidence_pct),
    health_score: firstNumber(thesis.health_score, analysis.health_score, executive.health_score),
    summary: firstNonEmpty(executive.summary, analysis.summary, thesis.dominant_scenario, thesis.summary, setup?.label, setup?.setup_id),
  };
}

function preferredSetupFromMasterFull(full = {}) {
  const setups = firstArray(full.setups, full.candidate_setups, full.setup_candidates, full.active_thesis?.setups);
  if (!setups.length) return null;
  const primaryId = full.primary_setup_id || full.executive_summary?.primary_setup_id || full.final_setup_id || null;
  return setups.find((setup) => primaryId && setup?.setup_id === primaryId) ||
    setups.find((setup) => setup?.is_primary === true) ||
    setups.find(isStrictReplayCandidateSetup) ||
    setups[0] ||
    null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function compactMonitor(monitor) {
  if (!monitor) {
    return null;
  }
  return {
    monitor_id: monitor.monitor_id || null,
    timestamp_paris: monitor.timestamp_paris || monitor.created_at_paris || null,
    decision: monitor.monitor_decision?.decision || monitor.monitor_decision?.action || monitor.status || null,
    action: monitor.monitor_decision?.action || monitor.monitor_decision?.action_now || monitor.monitor_decision?.decision || null,
    health_score: monitor.thesis_health_score?.score ?? monitor.thesis_update?.health_score ?? monitor.health_score ?? null,
    summary: monitor.monitor_decision?.summary || monitor.monitor_decision?.reason_summary || monitor.summary || null,
  };
}

async function getLatestOperationalMonitor(store, args = {}) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 1, 50));
  const hourlyResult = await store.getLatestHourlyMonitor({ ...args, limit });
  if (["replay", "backtest"].includes(args.mode)) {
    return hourlyResult;
  }
  const manualResult = await store.getLatestManualMonitor({ ...args, limit });
  const candidates = [
    ...(manualResult.monitors || []).map((monitor) => ({ monitor, priority: 1 })),
    ...(hourlyResult.monitors || []).map((monitor) => ({ monitor, priority: 0 })),
  ].sort((left, right) => {
    const byTimestamp = String(right.monitor.timestamp_paris || right.monitor.saved_at || right.monitor.created_at || "")
      .localeCompare(String(left.monitor.timestamp_paris || left.monitor.saved_at || left.monitor.created_at || ""));
    return byTimestamp || right.priority - left.priority;
  });
  const seen = new Set();
  const monitors = [];
  for (const candidate of candidates) {
    const monitor = candidate.monitor;
    const identity = monitor.monitor_id || `${monitor.bundle_id || "monitor"}:${monitor.timestamp_paris || monitor.created_at || monitors.length}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    monitors.push(monitor);
    if (monitors.length >= limit) break;
  }
  return { ok: true, count: monitors.length, monitors, latest_monitor: monitors[0] || null };
}

function conditionList(activeThesis, conditionStatus, monitor, key) {
  const fromCondition = conditionStatus?.condition_status?.[key];
  if (Array.isArray(fromCondition)) {
    return fromCondition;
  }
  if (key === "conditions_go" && Array.isArray(activeThesis?.wait_to_go_conditions)) {
    return activeThesis.wait_to_go_conditions;
  }
  if (key === "invalidations" && Array.isArray(activeThesis?.invalidation_conditions)) {
    return activeThesis.invalidation_conditions;
  }
  if (key === "conditions_go" && Array.isArray(monitor?.wait_to_go_check)) {
    return monitor.wait_to_go_check;
  }
  if (key === "invalidations" && Array.isArray(monitor?.invalidation_check)) {
    return monitor.invalidation_check;
  }
  return [];
}

function keyLevels(activeThesis, levelMap, latestMaster) {
  if (Array.isArray(activeThesis?.key_levels) && activeThesis.key_levels.length) {
    return activeThesis.key_levels;
  }
  if (Array.isArray(levelMap?.level_map?.levels)) {
    return levelMap.level_map.levels;
  }
  const masterLevels = latestMaster?.full_analysis?.key_levels || latestMaster?.full_analysis?.levels || null;
  if (Array.isArray(masterLevels)) {
    return masterLevels;
  }
  return [];
}

function deriveDeskStatus({ activeThesis, latestMonitor, latestExpiredThesis, activePosition }) {
  if (activePosition?.status === "active") return "POSITION_ACTIVE";
  if (activePosition?.status === "protected") return "POSITION_PROTECTED";
  if (!activeThesis) return latestExpiredThesis ? "EXPIRED" : "NO_ACTIVE_THESIS";
  const monitorAction = String(latestMonitor?.monitor_decision?.action || latestMonitor?.monitor_decision?.decision || "").toUpperCase();
  if (monitorAction.includes("REPLAN") || activeThesis.status === "REPLAN_REQUIRED") return "REPLAN_REQUIRED";
  if (monitorAction.includes("TRIGGER_GO") || activeThesis.status === "SETUP_TRIGGERED") return "TRIGGER_GO";
  return activeThesis.status || "WAIT";
}

function deskColor(status) {
  return {
    TRIGGER_GO: "green",
    SETUP_ARMED: "yellow",
    SETUP_CANDIDATE: "yellow",
    WAIT_MONITORED: "yellow",
    THESIS_WEAKENED: "orange",
    POSITION_ACTIVE: "orange",
    POSITION_PROTECTED: "orange",
    REPLAN_REQUIRED: "red",
    THESIS_INVALIDATED: "red",
    EXPIRED: "red",
    NO_ACTIVE_THESIS: "grey",
    WAIT: "grey",
  }[status] || "grey";
}

function deriveActionNow({ desk_status, activeThesis, latestMonitor }) {
  if (desk_status === "NO_ACTIVE_THESIS") {
    return { decision: "NO_ACTION", message: "Run Master to create a current thesis.", next_condition: "Master analysis required", action_required: true };
  }
  if (desk_status === "EXPIRED") {
    return { decision: "REPLAN_FULL", message: "Active thesis expired. Run a new Master.", next_condition: "New Master analysis", action_required: true };
  }
  if (desk_status === "REPLAN_REQUIRED") {
    return { decision: "REPLAN_FULL", message: "Latest monitor or thesis requires replan.", next_condition: "Run Master/Replan workflow", action_required: true };
  }
  const monitorAction = latestMonitor?.monitor_decision?.action || latestMonitor?.monitor_decision?.decision || null;
  const message = latestMonitor?.monitor_decision?.action_now ||
    latestMonitor?.monitor_decision?.summary ||
    activeThesis?.monitoring_playbook?.[0]?.action ||
    "Monitor active thesis and wait for stored GO conditions.";
  return {
    decision: monitorAction || (desk_status === "TRIGGER_GO" ? "TRIGGER_GO" : "WAIT_MORE"),
    message,
    next_condition: activeThesis?.wait_to_go_conditions?.[0]?.condition || activeThesis?.wait_to_go_conditions?.[0] || null,
    action_required: ["TRIGGER_GO", "REPLAN_REQUIRED"].includes(desk_status),
  };
}

function macroCrossAssetSummary(crossAssetDelta) {
  const delta = crossAssetDelta?.delta || {};
  return {
    calendar: delta.calendar || delta.macro_calendar || null,
    DXY: delta.DXY || delta.dxy || null,
    VIX: delta.VIX || delta.vix || null,
    US10Y: delta.US10Y || delta.us10y || null,
    summary: delta.summary || null,
  };
}

async function buildLiveDeskState(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const resolvedScope = resolveOperationalReadScope(args);
  const date = resolvedScope.trading_date;
  const session = resolvedScope.session;
  const timezone = resolvedScope.timezone;
  const mode = resolvedScope.mode;
  const requested_cutoff = resolvedScope.cutoff_paris;
  const selector = operationalSelectorArgs(resolvedScope);
  const contracts = await safeRead(store.getActiveContracts(), {});
  const pack = await resolvePackForState(store, { date, session, timezone });
  const latestMasterResult = await store.getLatestMasterAnalysis(selector);
  const latestMaster = latestMasterResult.analysis || null;
  const activeResult = latestMaster?.analysis_id
    ? await store.getActiveThesis({ ...selector, master_id: latestMaster.analysis_id, status: "active" })
    : { active_thesis: null, theses: [] };
  const anyTheses = latestMaster?.analysis_id
    ? await store.getActiveThesis({ ...selector, master_id: latestMaster.analysis_id, status: "any" })
    : { active_thesis: null, theses: [] };
  const activeThesis = activeResult.active_thesis || null;
  const latestExpiredThesis = selectExpiredTheses(anyTheses.theses || [], { session, now: tick })[0] || null;
  const latestMonitor = activeThesis?.thesis_id
    ? await getLatestOperationalMonitor(store, { ...selector, thesis_id: activeThesis.thesis_id, master_id: latestMaster.analysis_id, limit: 1 }).then((result) => result.latest_monitor)
    : null;
  const activePosition = activeThesis?.thesis_id
    ? await safeRead(store.getActivePosition({ thesis_id: activeThesis.thesis_id }).then((result) => result.position), null)
    : null;
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: requested_cutoff || tick.paris });
  const jobs = await safeRead(store.listDeskJobs({ date, session, limit: 20 }).then((result) => result.jobs), []);
  const alerts = await safeRead(store.listAlerts({ date, thesis_id: activeThesis?.thesis_id, limit: 20 }).then((result) => result.alerts), []);
  const desk_status = deriveDeskStatus({ activeThesis, latestMonitor, latestExpiredThesis, activePosition });
  return {
    ok: true,
    date,
    trading_date: date,
    strategy_id: resolvedScope.strategy_id,
    run_id: resolvedScope.run_id,
    session,
    mode,
    timezone,
    as_of_utc: resolvedScope.as_of_utc,
    resolved_scope: resolvedScope,
    scope_hash: resolvedScope.scope_hash,
    pack_build_id: pack?.pack_build_id || null,
    source_manifest_hash: pack?.source_manifest_hash || pack?.manifest?.source_manifest_hash || null,
    contracts: contractSummary(contracts),
    pack: pack ? compactPackHeaderForFront(pack) : null,
    desk_status,
    desk_color: deskColor(desk_status),
    action_now: deriveActionNow({ desk_status, activeThesis, latestMonitor }),
    active_thesis: activeThesis,
    latest_master: compactMasterAnalysis(latestMaster),
    latest_monitor: compactMonitor(latestMonitor),
    conditions_go: conditionList(activeThesis, features.condition, latestMonitor, "conditions_go"),
    invalidations: conditionList(activeThesis, features.condition, latestMonitor, "invalidations"),
    key_levels: keyLevels(activeThesis, features.level, latestMaster),
    risk_order: activeThesis?.risk_order || latestMaster?.full_analysis?.risk_management || {},
    active_position: activePosition || {},
    macro_cross_asset_summary: macroCrossAssetSummary(features.cross),
    authorized_windows: latestMaster?.full_analysis?.authorized_windows || latestMaster?.full_analysis?.authorized_windows_summary || [],
    current_window: features.condition?.condition_status?.current_window || { status: activeThesis ? "yellow" : "grey", rule: activeThesis ? "monitor thesis conditions" : "no active thesis" },
    jobs,
    alerts,
    next_revalidation_time: activeThesis?.requires_replan_after || activeThesis?.valid_until || null,
    data_readiness: dataReadiness({ pack, level: features.level, technical: features.technical, cross: features.cross, condition: features.condition }),
  };
}

async function buildFrontMasterState(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const resolvedScope = resolveOperationalReadScope(args);
  const date = resolvedScope.trading_date;
  const session = resolvedScope.session;
  const timezone = resolvedScope.timezone;
  const requested_cutoff = args.cutoff_paris || resolvedScope.cutoff_paris;
  if (Date.parse(requested_cutoff) !== Date.parse(resolvedScope.as_of_utc)) {
    throw deskError("INVALID_SCOPE", "cutoff_paris and as_of_utc must identify the same instant.", { cutoff_paris: requested_cutoff, as_of_utc: resolvedScope.as_of_utc });
  }
  const selector = operationalSelectorArgs(resolvedScope);
  const contracts = await safeRead(store.getActiveContracts(), {});
  const pack = await resolvePackForState(store, { date, session, timezone });
  const cutoffBundle = await store.getMasterCutoffBundle({ ...args, cutoff_paris: requested_cutoff });
  const latestMaster = await store.getLatestMasterAnalysis(selector).then((result) => result.analysis);
  const activeThesis = latestMaster?.analysis_id
    ? await store.getActiveThesis({ ...selector, master_id: latestMaster.analysis_id, status: "active" }).then((result) => result.active_thesis)
    : null;
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: requested_cutoff || tick.paris });
  const jobs = await safeRead(store.listDeskJobs({ date, session, limit: 20 }).then((result) => result.jobs), []);
  const latestMasterJob = jobs.find((job) => job.job_type === "MASTER_ANALYSIS") || null;
  const setups = latestMaster?.analysis_id
    ? await safeRead(store.getDeskSetups({ analysis_id: latestMaster.analysis_id, limit: 100 }).then((result) => result.setups), [])
    : [];
  return {
    ok: true,
    date,
    trading_date: date,
    strategy_id: resolvedScope.strategy_id,
    run_id: resolvedScope.run_id,
    session,
    mode: resolvedScope.mode,
    as_of_utc: resolvedScope.as_of_utc,
    resolved_scope: resolvedScope,
    scope_hash: resolvedScope.scope_hash,
    pack_build_id: pack?.pack_build_id || null,
    source_manifest_hash: pack?.source_manifest_hash || pack?.manifest?.source_manifest_hash || null,
    requested_cutoff,
    bundle_status: cutoffBundle?.data_quality?.status || (cutoffBundle ? "missing" : "not_requested"),
    missing_blocks: cutoffBundle?.data_quality?.missing || [],
    stale_blocks: cutoffBundle?.data_quality?.stale || [],
    can_run_gpt_master: cutoffBundle ? cutoffBundle.data_quality?.execution_allowed === true : Boolean(pack),
    reason_if_false: cutoffBundle && cutoffBundle.data_quality?.execution_allowed !== true
      ? (cutoffBundle.data_quality?.blockers || cutoffBundle.data_quality?.missing || ["master_cutoff_bundle_not_ready"]).join(", ")
      : !pack ? "desk_pack_missing" : null,
    next_action: cutoffBundle
      ? (cutoffBundle.data_quality?.execution_allowed === true ? "copy_master_prompt_for_chatgpt" : "prepare_master_cutoff_bundle_job")
      : "prepare_master_cutoff_bundle_job",
    latest_master_cutoff_bundle: cutoffBundle,
    contract: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
    pack: pack ? compactPackHeaderForFront(pack) : null,
    data_readiness: {
      ...dataReadiness({ pack, level: features.level, technical: features.technical, cross: features.cross, condition: features.condition }),
      macro_calendar: pack?.datasets?.macro_calendar ? "ready" : "missing",
      news_digest: pack ? datasetReadinessStatus(pack.datasets?.news_digest || { status: "not_configured", empty_ok: true }) : "missing",
      previous_context: activeThesis || latestMaster ? "ready" : "not_applicable",
      anti_lookahead: pack?.data_cutoff ? "ok" : "warning",
    },
    latest_master: compactMasterAnalysis(latestMaster),
    active_thesis: activeThesis,
    scenarios: latestMaster?.full_analysis?.scenarios || latestMaster?.full_analysis?.scenario_transformation_map || [],
    candidate_setups: setups,
    key_levels: keyLevels(activeThesis, features.level, latestMaster),
    authorized_windows: latestMaster?.full_analysis?.authorized_windows || latestMaster?.full_analysis?.authorized_windows_summary || [],
    update_agenda: latestMaster?.full_analysis?.update_agenda || [],
    jobs: {
      latest_master_job: latestMasterJob,
      can_run_master: !latestMasterJob || ["DONE", "FAILED", "CANCELLED"].includes(latestMasterJob.status),
      reason_if_not: latestMasterJob && !["DONE", "FAILED", "CANCELLED"].includes(latestMasterJob.status) ? `job_${latestMasterJob.status.toLowerCase()}` : null,
    },
  };
}

async function buildFrontMonitorState(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const resolvedScope = resolveOperationalReadScope(args, { requireMaster: true, requireThesis: true });
  const session = resolvedScope.session;
  const date = resolvedScope.trading_date;
  const context = await resolveMonitorContext(store, args);
  const activeThesis = context.activeThesis;
  const latestMaster = context.latestMaster;
  const selector = operationalSelectorArgs(resolvedScope);
  const monitorResult = await getLatestOperationalMonitor(store, {
    ...selector,
    thesis_id: activeThesis.thesis_id,
    master_id: latestMaster.analysis_id,
    limit: 20,
  });
  const latestMonitor = monitorResult.latest_monitor || null;
  const timeline = (monitorResult.monitors || []).map(compactMonitor);
  const checkpoint = args.timestamp_paris || resolvedScope.cutoff_paris;
  if (Date.parse(checkpoint) !== Date.parse(resolvedScope.as_of_utc)) {
    throw deskError("INVALID_SCOPE", "timestamp_paris and as_of_utc must identify the same instant.", { timestamp_paris: checkpoint, as_of_utc: resolvedScope.as_of_utc });
  }
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: checkpoint });
  const previewBundle = await store.getManualMonitorBundle({
    ...args,
    timestamp_paris: checkpoint,
    include_raw_refs: false,
  });
  const jobs = await safeRead(store.listDeskJobs({ date, session, limit: 20 }).then((result) => result.jobs), []);
  const latestMonitorJob = jobs.find((job) => job.job_type === "HOURLY_MONITOR") || null;
  const alerts = await safeRead(store.listAlerts({ date, thesis_id: activeThesis?.thesis_id, limit: 20 }).then((result) => result.alerts), []);
  const activePosition = activeThesis?.thesis_id
    ? await safeRead(store.getActivePosition({ thesis_id: activeThesis.thesis_id }).then((result) => result.position), null)
    : null;
  return {
    ok: true,
    strategy_id: resolvedScope.strategy_id,
    trading_date: resolvedScope.trading_date,
    run_id: resolvedScope.run_id,
    mode: resolvedScope.mode,
    as_of_utc: resolvedScope.as_of_utc,
    resolved_scope: resolvedScope,
    scope_hash: resolvedScope.scope_hash,
    pack_build_id: previewBundle?.pack_build_id || null,
    source_manifest_hash: previewBundle?.source_manifest_hash || null,
    latest_bundle_id: previewBundle?.bundle_id || null,
    latest_bundle_status: previewBundle?.data_quality?.status || "missing",
    next_checkpoint: checkpoint,
    data_quality: previewBundle?.data_quality || { status: "missing", execution_allowed: false, blockers: ["manual_monitor_bundle_unavailable"] },
    can_run_gpt_monitor: previewBundle?.data_quality?.execution_allowed === true,
    missing_blocks: previewBundle?.data_quality?.missing || [],
    stale_blocks: previewBundle?.data_quality?.stale || [],
    next_action: previewBundle?.data_quality?.execution_allowed === true ? "copy_manual_monitor_prompt_for_chatgpt" : "prepare_m15_monitor_bundle_job",
    active_thesis: activeThesis,
    latest_master: compactMasterAnalysis(latestMaster),
    latest_monitor: compactMonitor(latestMonitor),
    monitor_status: {
      thesis_status: activeThesis?.status || "NO_ACTIVE_THESIS",
      health_score: latestMonitor?.thesis_health_score?.score ?? latestMonitor?.thesis_update?.health_score ?? activeThesis?.health_score ?? null,
      score_delta: latestMonitor?.thesis_health_score?.delta ?? latestMonitor?.context_transmission?.score_delta ?? null,
      decision: latestMonitor?.monitor_decision?.decision || latestMonitor?.monitor_decision?.action || null,
      action_now: latestMonitor?.monitor_decision?.action_now || latestMonitor?.monitor_decision?.next_action || latestMonitor?.monitor_decision?.summary || latestMonitor?.monitor_decision?.reason_summary || null,
    },
    conditions_go: conditionList(activeThesis, features.condition, latestMonitor, "conditions_go"),
    invalidations: conditionList(activeThesis, features.condition, latestMonitor, "invalidations"),
    level_status: features.level?.level_map?.levels || [],
    cross_asset_delta: features.cross?.delta || {},
    macro_horizon: latestMonitor?.macro_update || {},
    technical_events: features.technical?.events || [],
    weak_signals: latestMonitor?.weak_signals || [],
    active_position: activePosition || {},
    timeline,
    jobs: {
      latest_monitor_job: latestMonitorJob,
      can_run_monitor: Boolean(activeThesis) && (!latestMonitorJob || ["DONE", "FAILED", "CANCELLED"].includes(latestMonitorJob.status)),
      reason_if_not: !activeThesis ? "active_thesis_missing" : latestMonitorJob && !["DONE", "FAILED", "CANCELLED"].includes(latestMonitorJob.status) ? `job_${latestMonitorJob.status.toLowerCase()}` : null,
    },
    alerts,
  };
}

async function buildAuditState(store, args = {}, featureDocs = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const date = dateForState(args, tick);
  const session = args.session || "asia_open";
  const [contracts, pack, activeThesis, latestMaster, jobs] = await Promise.all([
    safeRead(store.getActiveContracts(), {}),
    resolvePackForState(store, { date, session, timezone: args.timezone || "Europe/Paris" }),
    safeRead(store.getActiveThesis({ session, status: "active" }).then((result) => result.active_thesis), null),
    safeRead(store.getLatestMasterAnalysis({ session, before_date: date }).then((result) => result.analysis), null),
    safeRead(store.listDeskJobs({ date, session, limit: 100 }).then((result) => result.jobs), []),
  ]);
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: tick.paris });
  return {
    ok: true,
    contracts: contractSummary(contracts),
    data_quality: {
      datasets: Object.keys(pack?.datasets || {}),
      missing: pack ? [] : ["desk_pack"],
      warnings: pack?.quality?.warnings || [],
      pack_quality: pack?.quality || null,
    },
    feature_engine: {
      level_map: features.level,
      technical_events: features.technical,
      cross_asset_delta: features.cross,
      session_snapshot: features.snapshot,
      condition_status: features.condition,
      feature_runs: featureDocs.feature_runs || [],
    },
    jobs,
    raw_refs: Object.entries(pack?.datasets || {}).map(([dataset, ref]) => ({
      dataset,
      storage_path: ref.storage_path || null,
      row_count: ref.row_count ?? null,
      from_time: ref.from_time || null,
      to_time: ref.to_time || null,
    })),
    anti_lookahead: {
      pack_cutoff_ok: Boolean(pack?.data_cutoff),
      features_cutoff_ok: Boolean(features.level?.level_map?.computed_with_cutoff || features.condition?.condition_status?.computed_with_cutoff),
      no_actual_j_jplus1: true,
      no_post_cutoff_candles: true,
    },
    errors: featureDocs.errors || [],
  };
}

async function buildNyOpenStrategyState(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const date = dateForState(args, tick);
  const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
  const session = NY_OPEN_SESSION;
  const timezone = args.timezone || "Europe/Paris";
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const cutoff_paris = args.cutoff_paris || nyOpenCutoffParis(date);
  const bundleScope = nyOpenOperationalScope(date, cutoff_paris);
  const stateScope = nyOpenOperationalScope(date, nyOpenStateAsOfParis(date, tick));
  const contracts = await safeRead(store.getActiveContracts(), {});
  const pack = await resolvePackForState(store, { date, session, timezone });
  const bundle = await safeRead(
    store.getMasterCutoffBundle({ ...bundleScope, cutoff_paris }),
    missingMasterCutoffBundle({ ...bundleScope, date, cutoff_paris }),
  );
  const stateSelector = operationalSelectorArgs(resolveOperationalReadScope(stateScope));
  const latestMasterCandidate = await safeRead(store.getLatestMasterAnalysis(stateSelector).then((result) => result.analysis), null);
  const latestMaster = (latestMasterCandidate?.trading_date || latestMasterCandidate?.date) === date && strategyDocMatches(latestMasterCandidate, strategy_id)
    ? latestMasterCandidate
    : null;
  const activeResult = latestMaster?.analysis_id
    ? await safeRead(store.getActiveThesis({ ...stateSelector, master_id: latestMaster.analysis_id, status: "any" }), { active_thesis: null, theses: [] })
    : { active_thesis: null, theses: [] };
  const activeThesis = (activeResult.theses || []).find((thesis) => strategyDocMatches(thesis, strategy_id)) || activeResult.active_thesis || null;
  const latestMonitor = activeThesis?.thesis_id
    ? await safeRead(getLatestOperationalMonitor(store, {
        ...stateSelector,
        master_id: latestMaster.analysis_id,
        thesis_id: activeThesis.thesis_id,
        limit: 1,
      }).then((result) => result.latest_monitor), null)
    : null;
  const day = await safeRead(store.getStrategyDayDetail({ strategy_id, date, pricing_mode }), {
    ok: true,
    strategy_id,
    date,
    master: latestMaster ? compactStrategyMaster(latestMaster) : null,
    thesis: activeThesis ? compactStrategyThesis(activeThesis) : null,
    setups: [],
    monitors: latestMonitor ? [compactStrategyMonitor(latestMonitor)] : [],
    trades: [],
    performance: emptyStrategyPerformance(strategy_id, { from_date: date, to_date: date, pricing_mode }),
    timeline: [],
  });
  const performance = await safeRead(store.getStrategyPerformance({ strategy_id, to_date: date, pricing_mode }), emptyStrategyPerformance(strategy_id, { to_date: date, pricing_mode }));
  const activeTrade = (day.trades || []).find((trade) => isActiveTradeStatus(trade.status)) || null;
  const currentSetup = (day.setups || []).find((setup) => setup.status && setup.status !== "cancelled") || (day.setups || [])[0] || null;
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: cutoff_paris });
  const jobs = await safeRead(store.listDeskJobs({ date, session, limit: 20 }).then((result) => result.jobs), []);
  const alerts = await safeRead(store.listAlerts({ date, thesis_id: activeThesis?.thesis_id, limit: 20 }).then((result) => result.alerts), []);
  const master_status = latestMaster ? "saved" : "not_launched";
  const strategy_status = deriveNyOpenStrategyStatus({ master: latestMaster, setup: currentSetup, trade: activeTrade, activeThesis });
  const prompt = buildNyOpenMasterPrompt({
    strategy_id,
    date,
    cutoff_paris,
    bundle,
    contract_context: bundle?.contract_context || contractContext(contracts, "master", { tick, pinnedForReplay: false }),
  });
  return {
    ok: true,
    strategy_id,
    strategy_name: NY_OPEN_STRATEGY_NAME,
    pricing_mode,
    pricing_modes: NY_OPEN_PRICING_MODES,
    date,
    session,
    timezone,
    cutoff_paris,
    status: strategy_status,
    master_status,
    next_action: nyOpenNextAction({ pack, bundle, master: latestMaster, setup: currentSetup, trade: activeTrade }),
    blockers: nyOpenBlockers({ pack, bundle }),
    warnings: nyOpenWarnings({ pack, bundle, master: latestMaster }),
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    contract_context: prompt.contract_context,
    pack: pack ? compactPackHeaderForFront(pack) : null,
    latest_master_cutoff_bundle: compactMasterCutoffBundleForFront(bundle),
    master: latestMaster ? compactStrategyMaster(latestMaster) : null,
    active_thesis: activeThesis || day.thesis || null,
    setup: currentSetup,
    active_position: activeTrade,
    latest_monitor: latestMonitor ? compactStrategyMonitor(latestMonitor) : (day.monitors || [])[0] || null,
    performance_summary: performance.summary,
    day_performance: day.performance?.summary || null,
    setups: day.setups || [],
    trades: day.trades || [],
    jobs,
    alerts,
    data_readiness: {
      pack: pack ? pack.status || "ready" : "missing",
      master_bundle: bundle?.data_quality?.status || (bundle?.ok ? "ready" : "missing"),
      level_map: features.level?.level_map ? "ready" : "missing",
      technical_events: features.technical?.events?.length ? "ready" : "missing",
      cross_asset_delta: features.cross?.delta ? "ready" : "missing",
      macro_calendar: pack?.datasets?.macro_calendar ? "ready" : "missing",
      news_digest: pack ? datasetReadinessStatus(pack.datasets?.news_digest || { status: "not_configured", empty_ok: true }) : "missing",
      anti_lookahead: bundle?.anti_lookahead_policy?.compliant === false ? "failed" : "ok",
    },
    prompt,
    tabs: {
      live: "/desk/ny-open-strategy/live",
      masters: "/desk/ny-open-strategy/masters",
      performance: "/desk/ny-open-strategy/performance",
      calendar: "/desk/ny-open-strategy/calendar",
      day: `/desk/ny-open-strategy/day/${date}`,
    },
  };
}

function nyOpenCutoffParis(date) {
  return `${date}T${NY_OPEN_CUTOFF_TIME}${parisOffsetForDate(date)}`;
}

function nyOpenOperationalScope(date, asOfParis = nyOpenCutoffParis(date)) {
  const asOfMs = Date.parse(asOfParis);
  if (!Number.isFinite(asOfMs)) throw new Error(`ny_open_as_of_invalid:${asOfParis}`);
  return {
    strategy_id: NY_OPEN_STRATEGY_ID,
    session: NY_OPEN_SESSION,
    mode: "live",
    trading_date: date,
    run_id: `front_live_${date}_${NY_OPEN_SESSION}`,
    as_of_utc: new Date(asOfMs).toISOString(),
    timezone: "Europe/Paris",
  };
}

function nyOpenStateAsOfParis(date, tick) {
  const currentDate = String(tick.paris || tick.utc).slice(0, 10);
  if (date === currentDate) return tick.paris;
  if (date < currentDate) return `${date}T23:59:59${parisOffsetForDate(date)}`;
  return nyOpenCutoffParis(date);
}

function normalizeNyOpenBundlePrep(result, { date, cutoff_paris }) {
  const bundle = result?.bundle || null;
  const data_quality = bundle?.data_quality || {};
  const pack = bundle?.pack_or_source_context?.pack || bundle?.pack || null;
  const ready_for_master = Boolean(pack) && data_quality.execution_allowed !== false && data_quality.status !== "failed";
  const blockers = data_quality.blockers || data_quality.missing || [];
  return {
    ok: result?.ok !== false,
    strategy_id: NY_OPEN_STRATEGY_ID,
    strategy_name: NY_OPEN_STRATEGY_NAME,
    date,
    session: NY_OPEN_SESSION,
    cutoff_paris,
    status: result?.status || bundle?.status || (ready_for_master ? "READY" : "DEGRADED"),
    job_id: result?.job_id || null,
    bundle_id: result?.bundle_id || bundle?.bundle_id || null,
    pack_id: pack?.pack_id || null,
    pack_status: pack?.status || (pack ? "ready" : "missing"),
    data_quality,
    contract_context: bundle?.contract_context || null,
    contract_handshake: bundle?.contract_handshake || null,
    save_target: bundle?.save_target || null,
    ready_for_master,
    reason_if_not_ready: ready_for_master ? null : (blockers.length ? blockers.join(", ") : result?.error?.message || result?.error || "ny_open_master_bundle_not_ready"),
    source_hash: bundle?.source_hash || null,
  };
}

function compactMasterCutoffBundleForFront(bundle) {
  if (!bundle) return null;
  const data_quality = bundle.data_quality || {};
  const pack = bundle.pack_or_source_context?.pack || bundle.pack || null;
  return {
    ok: bundle.ok !== false,
    status: bundle.status || data_quality.status || "unknown",
    bundle_id: bundle.bundle_id || null,
    bundle_type: bundle.bundle_type || "master_cutoff",
    date: bundle.date || null,
    session: bundle.session || null,
    cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris || null,
    mode: bundle.mode || "live",
    contract_context: bundle.contract_context || null,
    pack: pack ? compactPackHeaderForFront(pack) : null,
    data_quality: {
      status: data_quality.status || null,
      execution_allowed: data_quality.execution_allowed ?? null,
      blockers: data_quality.blockers || [],
      missing: data_quality.missing || [],
      stale: data_quality.stale || [],
      warnings: data_quality.warnings || [],
      anti_lookahead_compliant: data_quality.anti_lookahead_compliant ?? bundle.anti_lookahead_policy?.compliant ?? null,
      raw_refs_available: data_quality.raw_refs_available ?? null,
    },
    source_hash: bundle.source_hash || null,
    created_at_paris: bundle.created_at_paris || null,
  };
}

function compactPackHeaderForFront(pack) {
  if (!pack) return null;
  return {
    pack_id: pack.pack_id || null,
    pack_build_id: pack.pack_build_id || pack.active_build_id || null,
    status: pack.status || null,
    date: pack.date || null,
    trading_date: pack.trading_date || pack.date || null,
    strategy_id: pack.strategy_id || pack.resolved_scope?.strategy_id || null,
    session: pack.session || null,
    timezone: pack.timezone || null,
    resolved_scope: pack.resolved_scope || null,
    scope_hash: pack.scope_hash || pack.resolved_scope?.scope_hash || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    data_cutoff: pack.data_cutoff || null,
    quality: {
      status: pack.quality?.status || null,
      row_count_total: pack.quality?.row_count_total ?? null,
      missing_datasets: pack.quality?.missing_datasets || [],
      warnings: pack.quality?.warnings || [],
      source: pack.quality?.source || null,
    },
    datasets: Object.fromEntries(Object.entries(pack.datasets || {}).map(([name, ref]) => [name, {
      row_count: ref?.row_count ?? null,
      status: ref?.status || null,
      source: ref?.source || null,
      from_time: ref?.from_time || ref?.from_time_utc || null,
      to_time: ref?.to_time || ref?.to_time_utc || null,
      empty_ok: ref?.empty_ok === true || undefined,
    }])),
  };
}

function selectStrategyDocuments({
  strategy_id,
  masters = [],
  theses = [],
  setups = [],
  monitors = [],
  trades = [],
  tradeExits = [],
  daily = [],
  equity = [],
  stats = [],
  reviews = [],
  packs = [],
  bundles = [],
  liveCursors = [],
  workEvents = [],
} = {}) {
  const selectedCursors = liveCursors.filter((doc) => strategyDocMatches(doc, strategy_id));
  const cursorIds = new Set(selectedCursors.map((doc) => doc.cursor_id));
  return {
    strategy_id,
    masters: sortStrategyDocs(masters.filter((doc) => strategyDocMatches(doc, strategy_id))),
    theses: sortStrategyDocs(theses.filter((doc) => strategyDocMatches(doc, strategy_id))),
    setups: sortStrategyDocs(setups.filter((doc) => strategyDocMatches(doc, strategy_id))),
    monitors: sortStrategyDocs(monitors.filter((doc) => strategyDocMatches(doc, strategy_id))),
    trades: sortStrategyDocs(trades.filter((doc) => strategyDocMatches(doc, strategy_id))),
    tradeExits: sortStrategyDocs(tradeExits.filter((doc) => strategyDocMatches(doc, strategy_id))),
    daily: sortStrategyDocs(daily.filter((doc) => strategyDocMatches(doc, strategy_id))),
    equity: sortStrategyDocs(equity.filter((doc) => strategyDocMatches(doc, strategy_id))),
    stats: sortStrategyDocs(stats.filter((doc) => strategyDocMatches(doc, strategy_id))),
    reviews: sortStrategyDocs(reviews.filter((doc) => strategyDocMatches(doc, strategy_id))),
    packs: sortStrategyDocs(packs.filter((doc) => strategySessionMatches(doc, NY_OPEN_SESSION))),
    bundles: sortStrategyDocs(bundles.filter((doc) => strategySessionMatches(doc, NY_OPEN_SESSION))),
    liveCursors: sortStrategyDocs(selectedCursors),
    workItems: [],
    workEvents: sortStrategyDocs(workEvents.filter((doc) => doc.scope === "live" && cursorIds.has(doc.cursor_id))),
  };
}

function strategyDocMatches(doc, strategy_id = NY_OPEN_STRATEGY_ID) {
  if (!doc) return false;
  const docStrategy = doc.strategy_id || doc.strategy?.strategy_id || doc.linked_strategy_id || doc.strategy;
  if (docStrategy === strategy_id) return true;
  if (docStrategy && docStrategy !== strategy_id) return false;
  return strategy_id === NY_OPEN_STRATEGY_ID && strategySessionMatches(doc, NY_OPEN_SESSION);
}

function requireStrategyId(args = {}) {
  const strategyId = String(args.strategy_id || "").trim();
  if (!strategyId) throw deskError("SCOPE_REQUIRED", "strategy_id is required.", { field: "strategy_id" });
  return strategyId;
}

function resolveStrategySelection(args = {}) {
  if (args.aggregate_across_strategies === true) return "all";
  return requireStrategyId(args);
}

function strategySessionMatches(doc, session) {
  return doc?.session === session || doc?.desk_session === session || doc?.strategy_session === session;
}

function sortStrategyDocs(docs) {
  return [...(docs || [])].sort((left, right) => String(strategyTimestampFromDoc(right)).localeCompare(String(strategyTimestampFromDoc(left))));
}

function setupDocumentId(setup) {
  return setup?.setup_record_id || setup?.setup_id || setup?.id || stableVNextId("setup", setup?.date || strategyDateFromDoc(setup), setup?.instrument || "setup");
}

function filterStrategyTrades(trades, args = {}, strategy_id = NY_OPEN_STRATEGY_ID) {
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  return (trades || [])
    .filter((trade) => !strategy_id || strategyDocMatches(trade, strategy_id))
    .filter((trade) => withinStrategyDateRange(trade, args))
    .filter((trade) => args.instrument === "all" || !args.instrument || trade.instrument === args.instrument)
    .filter((trade) => args.direction === "all" || !args.direction || trade.direction === args.direction)
    .filter((trade) => !isNyOpenStrictTrade(trade) || tradePricingMode(trade) === pricing_mode)
    .filter((trade) => !args.only_closed_trades || isClosedTrade(trade))
    .sort((left, right) => String(strategyTimestampFromDoc(left)).localeCompare(String(strategyTimestampFromDoc(right))));
}

function filterStrategySetups(setups, args = {}, strategy_id = NY_OPEN_STRATEGY_ID) {
  return (setups || [])
    .filter((setup) => !strategy_id || strategyDocMatches(setup, strategy_id))
    .filter((setup) => withinStrategyDateRange(setup, args))
    .filter((setup) => args.instrument === "all" || !args.instrument || setup.instrument === args.instrument)
    .filter((setup) => args.direction === "all" || !args.direction || setup.direction === args.direction)
    .filter((setup) => !args.setup_type || setup.setup_type === args.setup_type)
    .filter((setup) => !args.only_triggered_setups || isTriggeredSetupForPricingMode(setup, args.pricing_mode))
    .sort((left, right) => String(strategyTimestampFromDoc(left)).localeCompare(String(strategyTimestampFromDoc(right))));
}

function withinStrategyDateRange(doc, { from_date, to_date, date } = {}) {
  const docDate = strategyDateFromDoc(doc);
  if (!docDate) return true;
  if (date && docDate !== date) return false;
  if (from_date && docDate < from_date) return false;
  if (to_date && docDate > to_date) return false;
  return true;
}

function strategyDateFromDoc(doc) {
  return doc?.date || doc?.trade_date || String(strategyTimestampFromDoc(doc) || "").slice(0, 10) || null;
}

function strategyTimestampFromDoc(doc) {
  return doc?.closed_at_paris ||
    doc?.exit_at_paris ||
    doc?.executed_at_paris ||
    doc?.triggered_at_paris ||
    doc?.timestamp_paris ||
    doc?.created_at_paris ||
    doc?.updated_at_paris ||
    doc?.saved_at_paris ||
    doc?.created_at ||
    doc?.updated_at ||
    doc?.date ||
    "";
}

function isTriggeredSetup(setup) {
  const status = String(setup?.status || setup?.lifecycle_status || "").toLowerCase();
  return status.includes("trigger") || status.includes("tp") || status.includes("stop") || Boolean(setup?.triggered_at_paris);
}

function isTriggeredSetupForPricingMode(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  const replay = setup?.strict_replays?.[mode] || (mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup?.strict_replay_result || setup?.replay_result : null);
  if (replay) {
    const status = String(replay.replay_status || "").toLowerCase();
    return Boolean(replay.entry) || ["win", "loss", "open_or_expired"].includes(status);
  }
  return isTriggeredSetup(setup);
}

function isNyOpenStrictTrade(trade) {
  return trade?.strict_mode === true || trade?.source === "nyopen_strict_replay" || String(trade?.trade_id || "").includes("nyopen_strict_v1");
}

function tradePricingMode(trade) {
  return normalizeNyOpenPricingMode(trade?.pricing_mode || trade?.strict_pricing_mode);
}

function isActiveTradeStatus(status) {
  return ["open", "active", "partial", "partial_taken", "tp1_taken", "tp2_taken"].includes(String(status || "").toLowerCase());
}

function isExecutedTrade(trade) {
  return Boolean(trade?.executed_at_paris || trade?.entry_price || trade?.entry || trade?.trade_id || isActiveTradeStatus(trade?.status) || isClosedTrade(trade));
}

function isClosedTrade(trade) {
  const status = String(trade?.status || trade?.lifecycle_status || "").toLowerCase();
  return Boolean(
    trade?.closed_at_paris ||
      trade?.exit_at_paris ||
      trade?.exit_price != null ||
      trade?.result_R != null ||
      trade?.result_r != null ||
      trade?.r_result != null ||
      ["closed", "stopped", "stop", "stopped_out", "tp3_taken", "expired", "completed", "flat", "cancelled"].includes(status),
  );
}

function tradeResultR(trade, exits = []) {
  for (const key of ["result_R", "result_r", "r_result", "realized_R", "realized_r", "pnl_R", "pnl_r", "total_R", "total_r"]) {
    const value = numeric(trade?.[key], NaN);
    if (Number.isFinite(value)) return roundNumber(value, 4);
  }
  const exitValues = (exits || [])
    .filter((exit) => exit.trade_id === trade?.trade_id || exit.linked_trade_id === trade?.trade_id)
    .map((exit) => numeric(exit.result_R ?? exit.result_r ?? exit.r_result, NaN))
    .filter(Number.isFinite);
  if (exitValues.length) {
    return roundNumber(exitValues.reduce((sum, value) => sum + value, 0), 4);
  }
  return tradeResultRFromGeometry(trade);
}

function tradeResultRFromGeometry(trade) {
  const entry = numeric(trade?.entry_price ?? trade?.entry, NaN);
  const stop = numeric(trade?.stop_initial ?? trade?.stop_loss ?? trade?.stop, NaN);
  const exit = numeric(trade?.exit_price ?? trade?.close_price ?? trade?.last_price, NaN);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit)) return null;
  const direction = String(trade?.direction || "").toLowerCase();
  const risk = direction === "short" ? stop - entry : entry - stop;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const points = direction === "short" ? entry - exit : exit - entry;
  return roundNumber(points / risk, 4);
}

function emptyStrategyPerformance(strategy_id, args = {}) {
  return buildStrategyPerformance({ strategy_id, trades: [], setups: [], args });
}

function buildStrategyPerformance({ strategy_id, trades = [], setups = [], tradeExits = [], args = {} } = {}) {
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const executedTrades = (trades || []).filter(isExecutedTrade);
  const closedTrades = executedTrades.filter(isClosedTrade);
  const results = closedTrades
    .map((trade) => ({ trade, result_R: tradeResultR(trade, tradeExits) }))
    .filter((item) => Number.isFinite(item.result_R));
  const rValues = results.map((item) => item.result_R);
  const total_R = roundNumber(rValues.reduce((sum, value) => sum + value, 0), 4) || 0;
  const wins = rValues.filter((value) => value > 0).length;
  const losses = rValues.filter((value) => value < 0).length;
  const flats = rValues.filter((value) => value === 0).length;
  const gross_profit_R = roundNumber(rValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0), 4) || 0;
  const gross_loss_R = Math.abs(roundNumber(rValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0), 4) || 0);
  const equity_curve = equityCurveFromTrades(results, strategy_id, pricing_mode);
  const drawdown = maxDrawdownFromCurve(equity_curve);
  const daily = dailyPerformanceFromResults(results, strategy_id, pricing_mode);
  const summary = {
    strategy_id,
    strategy_name: strategy_id === NY_OPEN_STRATEGY_ID ? NY_OPEN_STRATEGY_NAME : strategy_id,
    pricing_mode,
    from_date: args.from_date || null,
    to_date: args.to_date || null,
    setup_count: setups.length,
    triggered_setups: setups.filter((setup) => isTriggeredSetupForPricingMode(setup, pricing_mode)).length,
    executed_trades: executedTrades.length,
    closed_trades: closedTrades.length,
    open_trades: executedTrades.filter((trade) => !isClosedTrade(trade)).length,
    wins,
    losses,
    flats,
    win_rate: rValues.length ? roundNumber(wins / rValues.length, 4) : null,
    total_R,
    gross_profit_R,
    gross_loss_R,
    profit_factor: gross_loss_R > 0 ? roundNumber(gross_profit_R / gross_loss_R, 4) : gross_profit_R > 0 ? null : 0,
    expectancy_R: rValues.length ? roundNumber(total_R / rValues.length, 4) : 0,
    avg_win_R: wins ? roundNumber(gross_profit_R / wins, 4) : 0,
    avg_loss_R: losses ? roundNumber(-gross_loss_R / losses, 4) : 0,
    max_drawdown_R: drawdown.max_drawdown_R,
    current_drawdown_R: drawdown.current_drawdown_R,
    last_trade_at_paris: closedTrades.at(-1) ? strategyTimestampFromDoc(closedTrades.at(-1)) : null,
  };
  return {
    ok: true,
    strategy_id,
    filters: {
      from_date: args.from_date || null,
      to_date: args.to_date || null,
      instrument: args.instrument || "all",
      direction: args.direction || "all",
      setup_type: args.setup_type || null,
      pricing_mode,
    },
    summary,
    equity_curve,
    daily,
    trades: closedTrades.map((trade) => compactStrategyTrade({ ...trade, result_R: tradeResultR(trade, tradeExits) })),
    setups: setups.map((setup) => compactStrategySetup(setup, { pricing_mode })),
  };
}

function equityCurveFromTrades(results, strategy_id, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  let cumulative = 0;
  let peak = 0;
  return results
    .slice()
    .sort((left, right) => String(strategyTimestampFromDoc(left.trade)).localeCompare(String(strategyTimestampFromDoc(right.trade))))
    .map((item, index) => {
      cumulative = roundNumber(cumulative + item.result_R, 4) || 0;
      peak = Math.max(peak, cumulative);
      const sequence = String(index + 1).padStart(4, "0");
      return {
        point_id: mode === NY_OPEN_DEFAULT_PRICING_MODE
          ? stableVNextId("strategy_equity", `${strategy_id}_${sequence}`, item.trade.trade_id || strategyTimestampFromDoc(item.trade))
          : stableVNextId("strategy_equity", `${strategy_id}_${mode}_${sequence}`, item.trade.trade_id || strategyTimestampFromDoc(item.trade)),
        strategy_id,
        pricing_mode: mode,
        sequence: index + 1,
        date: strategyDateFromDoc(item.trade),
        timestamp_paris: strategyTimestampFromDoc(item.trade),
        trade_id: item.trade.trade_id || null,
        result_R: item.result_R,
        cumulative_R: cumulative,
        drawdown_R: roundNumber(cumulative - peak, 4) || 0,
      };
    });
}

function maxDrawdownFromCurve(curve) {
  const values = (curve || []).map((point) => numeric(point.drawdown_R, 0));
  const max_drawdown_R = values.length ? Math.min(...values) : 0;
  return {
    max_drawdown_R: roundNumber(max_drawdown_R, 4) || 0,
    current_drawdown_R: curve?.length ? roundNumber(curve.at(-1).drawdown_R, 4) || 0 : 0,
  };
}

function dailyPerformanceFromResults(results, strategy_id, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  const grouped = new Map();
  for (const item of results || []) {
    const date = strategyDateFromDoc(item.trade) || "unknown";
    const bucket = grouped.get(date) || [];
    bucket.push(item);
    grouped.set(date, bucket);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, items]) => {
    const values = items.map((item) => item.result_R).filter(Number.isFinite);
    const total_R = roundNumber(values.reduce((sum, value) => sum + value, 0), 4) || 0;
    return {
      perf_day_id: mode === NY_OPEN_DEFAULT_PRICING_MODE
        ? stableVNextId("strategy_day", strategy_id, date)
        : stableVNextId("strategy_day", strategy_id, mode, date),
      strategy_id,
      pricing_mode: mode,
      date,
      closed_trades: values.length,
      wins: values.filter((value) => value > 0).length,
      losses: values.filter((value) => value < 0).length,
      total_R,
      avg_R: values.length ? roundNumber(total_R / values.length, 4) : 0,
      trade_ids: items.map((item) => item.trade.trade_id).filter(Boolean),
    };
  });
}

function recomputeStrategyPerformanceDocs(docs, args = {}, tick = new SystemClock().now()) {
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const trades = filterStrategyTrades(docs.trades, { ...args, only_closed_trades: false }, args.strategy_id);
  const setups = filterStrategySetups(docs.setups, args, args.strategy_id);
  const performance = buildStrategyPerformance({ strategy_id: args.strategy_id, trades, setups, tradeExits: docs.tradeExits, args });
  const daily_performance = performance.daily.map((day) => ({
    ...day,
    source: "recompute_strategy_performance",
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  }));
  const equity_curve = performance.equity_curve.map((point) => ({
    ...point,
    source: "recompute_strategy_performance",
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  }));
  const stats = {
    ...performance.summary,
    stats_id: pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE ? args.strategy_id : `${args.strategy_id}_${pricing_mode}`,
    strategy_id: args.strategy_id,
    pricing_mode,
    source: "recompute_strategy_performance",
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const audit = strategyAuditLog({
    strategy_id: args.strategy_id,
    action: "recompute_strategy_performance",
    document_type: "strategy_stats",
    document_id: stats.stats_id,
    previous_value: null,
    new_value: "recomputed",
    performed_by: args.performed_by || "dashboard_operator",
    tick,
  });
  return {
    summary: performance.summary,
    daily_performance,
    equity_curve,
    stats,
    audit,
  };
}

function buildStrategyCalendar(docs, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const strategy_id = args.strategy_id || docs.strategy_id || NY_OPEN_STRATEGY_ID;
  const today = String(tick.paris || tick.utc).slice(0, 10);
  const year = Number(args.year || today.slice(0, 4));
  const month = Number(args.month || today.slice(5, 7));
  const from_date = `${year}-${String(month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to_date = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const perf = buildStrategyPerformance({
    strategy_id,
    trades: filterStrategyTrades(docs.trades, { from_date, to_date, pricing_mode }, strategy_id),
    setups: filterStrategySetups(docs.setups, { from_date, to_date }, strategy_id),
    tradeExits: docs.tradeExits,
    args: { from_date, to_date, pricing_mode },
  });
  const dailyMap = new Map((perf.daily || []).map((day) => [day.date, day]));
  const mastersByDate = groupByDate(docs.masters);
  const setupsByDate = groupByDate(docs.setups);
  const tradesByDate = groupByDate(filterStrategyTrades(docs.trades, { from_date, to_date, pricing_mode }, strategy_id));
  const packsByDate = groupByDate(docs.packs);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
    const dayPerf = dailyMap.get(date) || null;
    const dayTrades = tradesByDate.get(date) || [];
    const daySetups = setupsByDate.get(date) || [];
    const dayMaster = (mastersByDate.get(date) || [])[0] || null;
    const dayPack = (packsByDate.get(date) || [])[0] || null;
    return {
      date,
      status: strategyDailyStatus({ dayPerf, trades: dayTrades, master: dayMaster, pack: dayPack }),
      total_R: dayPerf?.total_R ?? 0,
      closed_trades: dayPerf?.closed_trades ?? 0,
      setup_count: daySetups.length,
      has_master: Boolean(dayMaster),
      has_trade: dayTrades.length > 0,
      has_open_position: dayTrades.some((trade) => isActiveTradeStatus(trade.status)),
      pack_status: dayPack?.status || null,
      master_decision: dayMaster ? compactStrategyMaster(dayMaster).decision : null,
      setup_status: daySetups[0]?.status || daySetups[0]?.lifecycle_status || null,
    };
  });
  return {
    ok: true,
    strategy_id,
    pricing_mode,
    year,
    month,
    from_date,
    to_date,
    summary: perf.summary,
    days,
  };
}

function buildStrategyDayDetail(docs, args = {}) {
  const strategy_id = args.strategy_id || docs.strategy_id || NY_OPEN_STRATEGY_ID;
  const date = args.date;
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const masters = filterStrategyDate(docs.masters, date);
  const theses = filterStrategyDate(docs.theses, date);
  const setups = filterStrategySetups(docs.setups, { date }, strategy_id);
  const monitors = filterStrategyDate(docs.monitors, date);
  const trades = filterStrategyTrades(docs.trades, { date, pricing_mode }, strategy_id);
  const reviews = filterStrategyDate(docs.reviews, date);
  const performance = buildStrategyPerformance({
    strategy_id,
    trades,
    setups,
    tradeExits: docs.tradeExits,
    args: { from_date: date, to_date: date, pricing_mode },
  });
  const master = masters[0] || null;
  return {
    ok: true,
    strategy_id,
    pricing_mode,
    date,
    master: master ? compactStrategyMaster(master) : null,
    thesis: theses[0] ? compactStrategyThesis(theses[0]) : deriveActiveThesisFromMaster(master),
    setups: setups.map((setup) => compactStrategySetup(setup, { pricing_mode })),
    monitors: monitors.map(compactStrategyMonitor),
    trades: trades.map((trade) => compactStrategyTrade({ ...trade, result_R: tradeResultR(trade, docs.tradeExits) })),
    performance,
    timeline: buildStrategyTimeline({ masters, theses, setups, monitors, trades }),
    timeline_events: buildLiveSessionTimelineEvents(docs, args),
    continuity: buildLiveContinuitySummary(docs, args),
    authorized_windows: master?.full_analysis?.authorized_windows || master?.full_analysis?.authorized_windows_summary || [],
    update_agenda: master?.full_analysis?.update_agenda || [],
    review: reviews[0] || null,
  };
}

function buildLiveTimelineEventDetail(docs, args = {}) {
  const events = buildLiveSessionTimelineEvents(docs, args);
  const event = events.find((item) => item.event_id === args.event_id) || null;
  if (!event) {
    throw deskError("TIMELINE_EVENT_NOT_FOUND", "The requested live timeline event was not found.", { event_id: args.event_id });
  }
  const entityType = event.entity_type;
  const entityId = event.entity_id;
  let detail;
  if (entityType === "monitor") {
    const monitor = docs.monitors.find((item) => (item.monitor_id || item.id) === entityId) || null;
    const monitorTimestamp = strategyTimestampFromDoc(monitor);
    const previous = docs.monitors
      .filter((item) => monitorTimestamp && strategyDateFromDoc(item) === args.date && strategyTimestampFromDoc(item) < monitorTimestamp)
      .sort((left, right) => strategyTimestampFromDoc(right).localeCompare(strategyTimestampFromDoc(left)))[0] || null;
    detail = projectMonitorTimelineDetail(monitor, previous, event);
  } else if (entityType === "work" || entityType === "work_event") {
    const workItemId = event.work_item_id || entityId;
    const workItem = docs.workItems.find((item) => item.work_item_id === workItemId) || null;
    const workEvent = docs.workEvents.find((item) => item.event_id === entityId) || null;
    detail = projectWorkTimelineDetail(workItem, workEvent, event);
  } else if (entityType === "gap") {
    detail = projectGapTimelineDetail(event);
  } else {
    detail = projectGenericTimelineDetail(docs, event);
  }
  return { ok: true, strategy_id: args.strategy_id, date: args.date, ...detail };
}

function filterStrategyDate(docs, date) {
  return sortStrategyDocs((docs || []).filter((doc) => !date || strategyDateFromDoc(doc) === date));
}

function groupByDate(docs) {
  const map = new Map();
  for (const doc of docs || []) {
    const date = strategyDateFromDoc(doc);
    if (!date) continue;
    const bucket = map.get(date) || [];
    bucket.push(doc);
    map.set(date, bucket);
  }
  return map;
}

function strategyDailyStatus({ dayPerf, trades, master, pack }) {
  if ((trades || []).some((trade) => isActiveTradeStatus(trade.status))) return "open_position";
  if (dayPerf?.total_R > 0) return "win";
  if (dayPerf?.total_R < 0) return "loss";
  if (dayPerf?.closed_trades > 0) return "flat";
  if (pack && pack.status && pack.status !== "ready") return "data_degraded";
  if (!master) return "master_missing";
  return "no_trade";
}

function buildStrategyTimeline({ masters, theses, setups, monitors, trades }) {
  const events = [
    ...(masters || []).map((doc) => ({ time: strategyTimestampFromDoc(doc), type: "Master", title: compactStrategyMaster(doc).decision || "Master sauvegarde", status: doc.status || "saved" })),
    ...(theses || []).map((doc) => ({ time: strategyTimestampFromDoc(doc), type: "These", title: doc.status || "These active", status: doc.status || "active" })),
    ...(setups || []).map((doc) => ({ time: strategyTimestampFromDoc(doc), type: "Setup", title: doc.label || doc.setup_id || "Setup", status: doc.status || doc.lifecycle_status || "candidate" })),
    ...(monitors || []).map((doc) => ({ time: strategyTimestampFromDoc(doc), type: "Monitor", title: doc.monitor_decision?.action || doc.monitor_decision?.decision || "Monitor", status: doc.status || "saved" })),
    ...(trades || []).map((doc) => ({ time: strategyTimestampFromDoc(doc), type: "Trade", title: doc.trade_id || doc.status || "Trade", status: doc.status || "executed", result_R: tradeResultR(doc) })),
  ];
  return events
    .filter((event) => event.time)
    .sort((left, right) => String(left.time).localeCompare(String(right.time)));
}

function buildLiveSessionTimelineEvents(docs, args = {}) {
  const date = args.date;
  const masters = filterStrategyDate(docs.masters, date);
  const theses = filterStrategyDate(docs.theses, date);
  const setups = filterStrategyDate(docs.setups, date);
  const monitors = filterStrategyDate(docs.monitors, date);
  const trades = filterStrategyDate(docs.trades, date);
  const liveCursors = (docs.liveCursors || []).filter((cursor) => !date || cursor.trading_date === date);
  const cursorIds = new Set(liveCursors.map((cursor) => cursor.cursor_id));
  const workEvents = (docs.workEvents || []).filter((item) => item.scope === "live" && cursorIds.has(item.cursor_id));
  const events = [
    ...masters.map((doc) => liveTimelineEvent("master", doc.analysis_id || doc.master_id, strategyTimestampFromDoc(doc), {
      headline: "Plan Master",
      summary: compactStrategyMaster(doc).summary,
      status: doc.status || compactStrategyMaster(doc).decision || "saved",
      details_available: true,
    })),
    ...theses.map((doc) => liveTimelineEvent("thesis", doc.thesis_id, strategyTimestampFromDoc(doc), {
      headline: "Thèse",
      summary: doc.dominant_scenario || doc.bias_summary || doc.summary,
      status: doc.status || doc.thesis_status || "active",
      health_score: doc.health_score ?? null,
      details_available: true,
    })),
    ...monitors.map((doc) => liveTimelineEvent("monitor", doc.monitor_id || doc.id, strategyTimestampFromDoc(doc), {
      headline: `Monitor ${String(doc.timestamp_paris || "").slice(11, 16)}`,
      summary: doc.monitor_decision?.reason_summary || doc.monitor_decision?.summary || doc.summary,
      status: doc.monitor_decision?.action || doc.monitor_decision?.decision || doc.status || "saved",
      action: doc.monitor_decision?.action || doc.monitor_decision?.decision || null,
      health_score: doc.thesis_health_score?.current_score ?? doc.thesis_health_score?.score ?? doc.thesis_update?.health_score ?? doc.health_score ?? null,
      previous_health_score: doc.thesis_health_score?.previous_score ?? null,
      details_available: true,
    })),
    ...setups.map((doc) => liveTimelineEvent("setup", doc.setup_record_id || doc.setup_id, strategyTimestampFromDoc(doc), {
      headline: doc.label || "Setup",
      summary: doc.setup_type || doc.direction || null,
      status: doc.status || doc.lifecycle_status || "candidate",
      details_available: true,
    })),
    ...trades.map((doc) => liveTimelineEvent("trade", doc.trade_id, strategyTimestampFromDoc(doc), {
      headline: `${doc.instrument || "Trade"} ${doc.direction || ""}`.trim(),
      summary: Number.isFinite(tradeResultR(doc)) ? `${tradeResultR(doc)}R` : doc.close_reason || null,
      status: doc.status || "executed",
      details_available: true,
    })),
    ...workEvents
      .filter((doc) => ["CURSOR_RETRY_SCHEDULED", "CURSOR_DEAD_LETTER", "CURSOR_DEGRADED", "CURSOR_LIVENESS_ALERT", "CURSOR_CLOSED"].includes(doc.event_type))
      .map((doc) => liveTimelineEvent("work_event", doc.event_id, doc.at_utc || doc.created_at_utc, {
        headline: doc.event_type === "CURSOR_RETRY_SCHEDULED" ? "Nouvel essai planifié" : doc.event_type === "CURSOR_CLOSED" ? "Session fermée" : "Incident worker",
        summary: doc.details?.error_message || doc.details?.error_code || doc.event_type,
        status: doc.event_type,
        details_available: true,
      })),
  ].filter((event) => event.timestamp_paris);

  events.push(...buildMissingMonitorEvents(monitors, { ...args, master: masters[0] || null }));
  const unique = new Map();
  for (const event of events) unique.set(event.event_id, event);
  const sorted = [...unique.values()].sort((left, right) => String(left.timestamp_paris).localeCompare(String(right.timestamp_paris)));
  return sorted.map((event, index) => ({
    ...event,
    previous_event_id: sorted[index - 1]?.event_id || null,
    next_event_id: sorted[index + 1]?.event_id || null,
  }));
}

function liveTimelineEvent(entityType, entityId, timestampParis, fields = {}) {
  const status = String(fields.status || "unknown");
  return {
    event_id: `${entityType}:${entityId || timestampParis}`,
    entity_type: entityType,
    entity_id: entityId || null,
    timestamp_paris: timestampParis || null,
    headline: fields.headline || entityType,
    summary: fields.summary || null,
    status,
    action: fields.action || null,
    tone: timelineEventTone(status),
    health_score: fields.health_score ?? null,
    previous_health_score: fields.previous_health_score ?? null,
    work_item_id: fields.work_item_id || null,
    details_available: fields.details_available === true,
  };
}

function buildMissingMonitorEvents(monitors, args = {}) {
  const session = args.strategy_id === NY_OPEN_STRATEGY_ID
    ? NY_OPEN_SESSION
    : monitors[0]?.session || args.master?.session || "asia_open";
  const checkpoints = monitors
    .map((monitor) => Date.parse(monitor.timestamp_paris || monitor.created_at_paris || ""))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const gaps = [];
  for (let index = 1; index < checkpoints.length; index += 1) {
    for (let cursor = checkpoints[index - 1] + 15 * 60 * 1000; cursor < checkpoints[index]; cursor += 15 * 60 * 1000) {
      const timestamp = toParisIso(cursor).replace(/\.\d{3}/, "");
      if (!isLiveMonitorCheckpointInWindow(session, timestamp)) continue;
      gaps.push(liveTimelineEvent("gap", timestamp, timestamp, {
        headline: `Checkpoint ${timestamp.slice(11, 16)}`,
        summary: "Aucun Monitor n'a été matérialisé pour ce checkpoint.",
        status: "MISSING_MONITOR",
        details_available: true,
      }));
    }
  }

  const date = args.date;
  const asOfParis = args.as_of_paris || new SystemClock().now().paris;
  const asOfDate = String(asOfParis).slice(0, 10);
  if (!date || date > asOfDate) return gaps;
  const anchorMs = checkpoints.at(-1) ?? Date.parse(args.master?.cutoff_paris || args.master?.created_at_paris || "");
  if (!Number.isFinite(anchorMs)) return gaps;
  const upperBoundMs = date < asOfDate
    ? Number.POSITIVE_INFINITY
    : Date.parse(floorParisCheckpoint(Date.parse(asOfParis) - 2 * 60 * 1000, 15));
  for (let cursor = anchorMs + 15 * 60 * 1000, count = 0; count < 96; cursor += 15 * 60 * 1000, count += 1) {
    const timestamp = toParisIso(cursor).replace(/\.\d{3}/, "");
    if (timestamp.slice(0, 10) !== date || cursor > upperBoundMs) break;
    if (!isLiveMonitorCheckpointInWindow(session, timestamp)) break;
    gaps.push(liveTimelineEvent("gap", timestamp, timestamp, {
      headline: `Checkpoint ${timestamp.slice(11, 16)}`,
      summary: "Aucun Monitor n'a été matérialisé pour ce checkpoint.",
      status: "MISSING_MONITOR",
      details_available: true,
    }));
  }
  return gaps;
}

function buildLiveContinuitySummary(docs, args = {}) {
  const date = args.date;
  const cursor = (docs.liveCursors || [])
    .filter((item) => !date || item.trading_date === date)
    .sort((left, right) => String(right.updated_at_utc || "").localeCompare(String(left.updated_at_utc || "")))[0] || null;
  const master = filterStrategyDate(docs.masters, date)[0] || null;
  const thesis = filterStrategyDate(docs.theses, date)[0] || null;
  const monitor = filterStrategyDate(docs.monitors, date)[0] || null;
  const thesisStatus = String(thesis?.status || thesis?.thesis_status || "").toUpperCase();
  const masterTimestamp = Date.parse(strategyTimestampFromDoc(master));
  const monitorTimestamp = Date.parse(strategyTimestampFromDoc(monitor));
  const monitorRequestsReplan = Number.isFinite(monitorTimestamp)
    && (!Number.isFinite(masterTimestamp) || monitorTimestamp > masterTimestamp)
    && /(REPLAN|NEW_MASTER|INVALIDATE|EXPIRE)/.test(String(monitor?.monitor_decision?.action || monitor?.monitor_decision?.decision || "").toUpperCase());
  const recoveryNeeded = Boolean(master) && (!thesis || /(EXPIRED|INVALID|REPLAN)/.test(thesisStatus) || monitorRequestsReplan);
  const gaps = buildMissingMonitorEvents(filterStrategyDate(docs.monitors, date), { ...args, master });
  const status = cursor?.cursor_status === "LEASED" && cursor?.attempt?.workflow === "LIVE_MASTER"
    ? "RECOVERING"
    : recoveryNeeded
      ? "RECOVERY_REQUIRED"
      : ["RETRY", "BLOCKED", "DEGRADED"].includes(cursor?.cursor_status) || gaps.length
        ? "DEGRADED"
        : "HEALTHY";
  return {
    status,
    recovery_mode: status !== "HEALTHY",
    cursor_id: cursor?.cursor_id || null,
    cursor_status: cursor?.cursor_status || null,
    workflow: cursor?.attempt?.workflow || null,
    target_checkpoint: cursor?.target_checkpoint || null,
    last_completed_checkpoint: cursor?.last_completed_checkpoint || null,
    pending_work_item: null,
    failed_work_item: null,
    missing_checkpoint_count: gaps.length,
    latest_missing_checkpoint_paris: gaps.at(-1)?.timestamp_paris || null,
    last_error: cursor?.attempt?.last_error || null,
    next_action: status === "RECOVERING"
      ? "complete_live_master_then_roll_forward"
      : status === "RECOVERY_REQUIRED"
        ? "rearm_live_master"
        : status === "DEGRADED"
          ? "reconcile_missing_live_checkpoint"
          : "continue_normal_m15_cadence",
  };
}

function projectMonitorTimelineDetail(monitor, previous, event) {
  if (!monitor) return projectGapTimelineDetail(event);
  const raw = monitor.raw_chatgpt_output && typeof monitor.raw_chatgpt_output === "object" ? monitor.raw_chatgpt_output : {};
  const source = { ...raw, ...monitor };
  const decision = source.monitor_decision || {};
  const update = source.active_thesis_update || source.thesis_update || {};
  const health = source.thesis_health_score || {};
  const transmission = source.monitor_context_transmission || source.context_transmission || {};
  const previousScore = firstNumber(health.previous_score, previous?.thesis_health_score?.current_score, previous?.thesis_health_score?.score, previous?.thesis_update?.health_score);
  const currentScore = firstNumber(health.current_score, health.score, update.health_score, event.health_score);
  const sections = [
    timelineDetailSection("before", "Situation avant", firstNarrative(source.previous_monitor_summary, source.active_thesis_before, source.master_context_summary, previous?.monitor_decision), [
      detailItem("Santé précédente", previousScore != null ? `${previousScore}/100` : null),
      detailItem("Thèse précédente", firstNarrative(source.active_thesis_before, transmission.previous_thesis_status, previous?.thesis_update)),
      ...detailItemsFromValue("Plan en cours", source.active_thesis_before?.monitoring_playbook || source.master_context_summary, 5),
    ]),
    timelineDetailSection("observed", "Ce qui s'est passé", firstNarrative(decision.reason_summary, decision.summary, source.session_context_summary), [
      ...detailItemsFromValue("Attendu / réalisé", source.expected_vs_realized, 8),
      ...detailItemsFromValue("Snapshots marché", source.rolling_1h_snapshot_summary || source.rolling_4h_snapshot_summary, 6),
    ]),
    timelineDetailSection("market", "Marché, macro et cross-asset", firstNarrative(source.macro_update, source.cross_asset_delta, source.technical_delta), [
      ...detailItemsFromValue("Macro", source.macro_update || source.macro_horizon, 5),
      ...detailItemsFromValue("Cross-asset", source.cross_asset_delta, 6),
      ...detailItemsFromValue("Technique", source.technical_delta, 6),
      ...detailItemsFromValue("Causalité", source.macro_technical_causality, 4),
    ]),
    timelineDetailSection("deduction", "Déduction", firstNarrative(decision.detailed_reason, decision.reason_summary), [
      detailItem("Santé", currentScore != null ? `${previousScore ?? "--"} → ${currentScore}/100` : null),
      ...detailItemsFromValue("Facteurs positifs", health.score_drivers_positive, 5, "success"),
      ...detailItemsFromValue("Facteurs négatifs", health.score_drivers_negative, 5, "critical"),
      ...detailItemsFromValue("Invalidations", source.invalidation_check, 5, "critical"),
      ...detailItemsFromValue("Signaux faibles", source.weak_signals, 4, "warning"),
    ]),
    timelineDetailSection("decision", "Décision", firstNarrative(decision.reason_summary, decision.detailed_reason), [
      detailItem("Action", decision.action || decision.decision, timelineEventTone(decision.action || decision.decision)),
      detailItem("Thèse après", decision.thesis_status_after || update.status || update.thesis_status),
      detailItem("Alerte", decision.alert_level || source.alert?.severity),
      detailItem("Action immédiate", decision.next_action || decision.action_now),
    ]),
    timelineDetailSection("next", "Suite attendue", firstNarrative(decision.next_monitoring_focus, update.next_focus, transmission.next_monitor_focus), [
      ...detailItemsFromValue("Points de surveillance", decision.next_monitoring_focus || update.next_focus || transmission.next_monitor_focus, 8),
      detailItem("Prochaine revalidation", decision.next_revalidation_time || update.next_revalidation_time),
      ...detailItemsFromValue("Conditions", update.wait_to_go_conditions || source.wait_to_go_check, 5),
    ]),
  ].filter((section) => section.summary || section.items.length);
  return {
    event,
    headline: event.headline,
    summary: event.summary,
    timestamp_paris: event.timestamp_paris,
    status: event.status,
    tone: event.tone,
    sections,
    data_quality: source.data_quality || null,
  };
}

function projectWorkTimelineDetail(workItem, workEvent, event) {
  const error = workItem?.last_error || workEvent?.details || {};
  return {
    event,
    headline: event.headline,
    summary: event.summary || error.message || "Événement d'orchestration du desk.",
    timestamp_paris: event.timestamp_paris,
    status: event.status,
    tone: event.tone,
    sections: [
      timelineDetailSection("incident", "Incident et portée", error.message || event.summary, [
        detailItem("Workflow", workItem?.workflow || workEvent?.workflow),
        detailItem("Code", error.code || error.error_code),
        detailItem("Tentative", workItem?.attempt_count ?? workEvent?.attempt_count),
        detailItem("Échecs", workItem?.failure_count),
      ]),
      timelineDetailSection("recovery", "Résilience", continuityWorkSummary(workItem), [
        detailItem("État", workItem?.status || workEvent?.status),
        detailItem("Prochain essai", workItem?.retry_after_utc),
        detailItem("Mode", "borné"),
        detailItem("Action suivante", "Reprendre le prochain step replay séquentiel"),
      ]),
    ],
  };
}

function projectGapTimelineDetail(event) {
  return {
    event,
    headline: event.headline,
    summary: event.summary,
    timestamp_paris: event.timestamp_paris,
    status: event.status,
    tone: "critical",
    sections: [timelineDetailSection("gap", "Checkpoint non matérialisé", event.summary, [
      detailItem("Conséquence", "Ce point ne doit pas être confondu avec une décision NO_ACTION."),
      detailItem("Continuité", "Le prochain Master ou Monitor valide doit couvrir cette période dans son analyse de rattrapage."),
    ])],
  };
}

function projectGenericTimelineDetail(docs, event) {
  const collections = { master: docs.masters, thesis: docs.theses, setup: docs.setups, trade: docs.trades };
  const source = (collections[event.entity_type] || []).find((item) => [item.analysis_id, item.master_id, item.thesis_id, item.setup_record_id, item.setup_id, item.trade_id].includes(event.entity_id)) || {};
  return {
    event,
    headline: event.headline,
    summary: event.summary,
    timestamp_paris: event.timestamp_paris,
    status: event.status,
    tone: event.tone,
    sections: [timelineDetailSection("summary", "Synthèse", event.summary, detailItemsFromValue("Détails", source.full_analysis || source, 12))],
  };
}

function timelineDetailSection(key, title, summary, items = []) {
  return { key, title, summary: summary || null, items: items.filter((item) => item?.value) };
}

function detailItem(label, value, tone = "neutral") {
  const readable = readableTimelineValue(value);
  return readable ? { label, value: readable, tone } : null;
}

function detailItemsFromValue(label, value, limit = 6, tone = "neutral") {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.slice(0, limit).map((item, index) => detailItem(`${label} ${index + 1}`, item, tone)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value).slice(0, limit).map(([key, item]) => detailItem(humanTimelineLabel(key), item, tone)).filter(Boolean);
  }
  return [detailItem(label, value, tone)].filter(Boolean);
}

function readableTimelineValue(value) {
  if (value == null || value === "") return null;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(readableTimelineValue).filter(Boolean).slice(0, 5).join(" · ") || null;
  if (typeof value === "object") {
    const direct = firstNonEmpty(value.summary, value.reason_summary, value.detailed_reason, value.condition, value.label, value.message, value.action, value.decision, value.value);
    if (direct != null && typeof direct !== "object") return String(direct);
    return Object.entries(value)
      .filter(([, item]) => item != null && typeof item !== "object")
      .slice(0, 4)
      .map(([key, item]) => `${humanTimelineLabel(key)} : ${item}`)
      .join(" · ") || null;
  }
  return null;
}

function firstNarrative(...values) {
  for (const value of values) {
    const readable = readableTimelineValue(value);
    if (readable) return readable;
  }
  return null;
}

function humanTimelineLabel(value) {
  const labels = {
    previous_score: "Santé précédente",
    current_score: "Santé actuelle",
    expected: "Attendu",
    realized: "Réalisé",
    next_action: "Action suivante",
    next_revalidation_time: "Prochaine revalidation",
    dominant_scenario: "Scénario dominant",
    validated_elements: "Éléments validés",
    weakened_elements: "Éléments affaiblis",
    invalidated_elements: "Éléments invalidés",
  };
  return labels[value] || String(value || "Détail").replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

function timelineEventTone(value) {
  const status = String(value || "").toUpperCase();
  if (/(FAILED|MISSING|INVALID|EXPIRE|REPLAN|CANCEL|CRITICAL)/.test(status)) return "critical";
  if (/(RISK|WEAK|WAIT|RETRY|WARNING|READY)/.test(status)) return "warning";
  if (/(TRIGGER|ACTIVE|COMPLETED|HEALTHY|SUCCESS)/.test(status)) return "success";
  return "info";
}


function continuityWorkSummary(item) {
  if (!item) return "Aucun travail d'orchestration associé.";
  if (item.status === "CLAIMED") return "Le worker traite actuellement ce travail.";
  if (item.status === "READY") return "Le travail est prêt pour le prochain réveil du worker.";
  if (item.status === "FAILED") return "Le travail requiert un réarmement avant reprise.";
  return `État du travail : ${item.status || "inconnu"}.`;
}

function compactStrategyMaster(master) {
  const compact = compactMasterAnalysis(master) || {};
  const full = master?.full_analysis || {};
  const executive = full.executive_summary || {};
  const thesis = full.active_thesis || master?.active_thesis || {};
  const setup = preferredSetupFromMasterFull(full);
  return {
    ...compact,
    analysis_id: compact.analysis_id || master?.analysis_id || null,
    status: master?.status || "saved",
    decision: firstNonEmpty(compact.decision, executive.final_decision, master?.final_decision, setup ? "setup_candidate" : null),
    setup_decision: firstNonEmpty(full.setup_decision, master?.setup_decision, setup ? "setup_candidate" : null),
    position_decision: firstNonEmpty(full.position_decision, master?.position_decision, "no_position"),
    instrument: firstNonEmpty(compact.instrument, thesis.instrument, setup?.instrument),
    direction: firstNonEmpty(compact.direction, thesis.direction, setup?.direction),
    confidence_pct: firstNumber(compact.confidence_pct, thesis.confidence_pct, setup?.confidence_pct),
    summary: firstNonEmpty(compact.summary, executive.summary, master?.summary, thesis.dominant_scenario, thesis.summary, setup?.label, setup?.setup_id),
    scenarios: full.scenarios || full.scenario_transformation_map || [],
  };
}

function compactStrategyThesis(thesis) {
  if (!thesis) return null;
  return {
    thesis_id: thesis.thesis_id || null,
    status: thesis.status || null,
    instrument: thesis.instrument || null,
    direction: thesis.direction || null,
    dominant_scenario: thesis.dominant_scenario || thesis.summary || null,
    confidence_pct: thesis.confidence_pct ?? null,
    health_score: thesis.health_score ?? null,
    valid_from: thesis.valid_from || thesis.created_at_paris || null,
    valid_until: thesis.valid_until || thesis.requires_replan_after || null,
  };
}

function compactStrategySetup(setup, args = {}) {
  if (!setup) return null;
  const pricing_mode = normalizeNyOpenPricingMode(args.pricing_mode);
  const takeProfits = setup.take_profits || setup.targets || setup.take_profit || setup.tp || [];
  const targetMap = setupTakeProfitMap(takeProfits);
  const selectedReplay = setup.strict_replays?.[pricing_mode] || (pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup.strict_replay_result || setup.replay_result : null);
  const selectedTradeId = setup.strict_trade_ids?.[pricing_mode] || (pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup.strict_trade_id : null);
  const selectedResultR = setup.strict_results_R?.[pricing_mode] ?? selectedReplay?.r_result ?? (pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup.strict_replay_result?.r_result ?? setup.replay_result?.r_result : null);
  return {
    setup_id: setup.setup_id || setup.setup_record_id || null,
    setup_record_id: setup.setup_record_id || null,
    label: setup.label || setup.name || setup.setup_id || null,
    status: setup.status || setup.lifecycle_status || null,
    instrument: setup.instrument || null,
    direction: setup.direction || null,
    setup_type: setup.setup_type || null,
    entry_zone: setup.entry_zone || setup.entry || null,
    entry: setup.entry ?? setup.entry_price ?? null,
    stop_loss: setup.stop_loss ?? setup.stop ?? null,
    take_profits: takeProfits,
    tp1: targetMap.tp1 ?? null,
    tp2: targetMap.tp2 ?? null,
    tp3: targetMap.tp3 ?? null,
    confidence_pct: setup.confidence_pct ?? null,
    risk_pct: setup.risk_pct ?? null,
    rr_minimum: setup.rr_minimum ?? setup.rr ?? null,
    triggered_at_paris: setup.triggered_at_paris || null,
    strict_mode: setup.strict_mode === true,
    pricing_mode,
    strict_pricing_mode: pricing_mode,
    strict_replay_status: selectedReplay?.replay_status || (pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup.strict_replay_status || setup.replay_status : null),
    strict_trade_id: selectedTradeId || null,
    strict_result_R: selectedResultR ?? null,
    strict_replays: setup.strict_replays || null,
    strict_results_R: setup.strict_results_R || null,
  };
}

function setupTakeProfitMap(value) {
  const output = {};
  const items = Array.isArray(value)
    ? value.map((item, index) => [String(item?.name || `tp${index + 1}`).toLowerCase(), item?.target ?? item?.price ?? item?.level ?? item])
    : value && typeof value === "object"
      ? Object.entries(value).map(([key, item]) => [String(key).toLowerCase(), item?.target ?? item?.price ?? item?.level ?? item])
      : value != null ? [["tp1", value]] : [];
  for (const [key, item] of items) {
    if (key.includes("1")) output.tp1 = item;
    else if (key.includes("2")) output.tp2 = item;
    else if (key.includes("3")) output.tp3 = item;
  }
  return output;
}

function compactStrategyMonitor(monitor) {
  if (!monitor) return null;
  return {
    monitor_id: monitor.monitor_id || monitor.id || null,
    timestamp_paris: monitor.timestamp_paris || monitor.created_at_paris || null,
    status: monitor.status || "saved",
    action: monitor.monitor_decision?.action || monitor.monitor_decision?.decision || monitor.action || null,
    summary: monitor.monitor_decision?.summary || monitor.monitor_decision?.reason_summary || monitor.summary || null,
    health_score: monitor.thesis_health_score?.score ?? monitor.thesis_health_score?.current_score ?? monitor.thesis_update?.health_score ?? monitor.health_score ?? null,
  };
}

function compactStrategyTrade(trade) {
  if (!trade) return null;
  return {
    trade_id: trade.trade_id || null,
    setup_id: trade.setup_id || trade.setup_record_id || null,
    date: strategyDateFromDoc(trade),
    instrument: trade.instrument || null,
    direction: trade.direction || null,
    status: trade.status || null,
    entry_price: trade.entry_price ?? trade.entry ?? null,
    exit_price: trade.exit_price ?? null,
    stop_loss: trade.stop_loss ?? trade.stop_initial ?? null,
    result_R: trade.result_R ?? trade.result_r ?? trade.r_result ?? null,
    close_reason: trade.close_reason || null,
    strict_mode: trade.strict_mode === true,
    pricing_mode: tradePricingMode(trade),
    replay_id: trade.replay_id || null,
    opened_at_paris: trade.opened_at_paris || trade.executed_at_paris || null,
    closed_at_paris: trade.closed_at_paris || trade.exit_at_paris || null,
  };
}

function deriveNyOpenStrategyStatus({ master, setup, trade, activeThesis }) {
  if (trade && isActiveTradeStatus(trade.status)) return "POSITION_ACTIVE";
  if (trade && isClosedTrade(trade)) return "TRADE_CLOSED";
  if (setup && isTriggeredSetup(setup)) return "SETUP_TRIGGERED";
  if (setup) return "SETUP_CANDIDATE";
  if (activeThesis) return activeThesis.status || "WAIT_MONITORED";
  if (master) return "MASTER_SAVED";
  return "MASTER_NOT_LAUNCHED";
}

function nyOpenNextAction({ pack, bundle, master, setup, trade }) {
  if (!pack) return "generate_ny_open_pack";
  if (!bundle || bundle?.data_quality?.execution_allowed === false) return "prepare_nyopen_master_bundle";
  if (!master) return "copy_prompt_to_chatgpt_and_run_master";
  if (trade && isActiveTradeStatus(trade.status)) return "manage_active_position";
  if (setup && isTriggeredSetup(setup)) return "track_trade_or_mark_result";
  if (setup) return "wait_for_trigger_or_mark_setup_triggered";
  return "wait_for_setup_or_run_monitor";
}

function nyOpenBlockers({ pack, bundle }) {
  const blockers = [];
  if (!pack) blockers.push("ny_open_pack_missing");
  if (bundle?.data_quality?.execution_allowed === false) blockers.push(...(bundle.data_quality.blockers || bundle.data_quality.missing || ["master_bundle_degraded"]));
  return dedupeBy(blockers, (item) => item);
}

function nyOpenWarnings({ pack, bundle, master }) {
  const warnings = [];
  if (pack?.status && pack.status !== "ready") warnings.push(`pack_${pack.status}`);
  warnings.push(...(bundle?.data_quality?.warnings || []));
  if (!master) warnings.push("master_non_lance");
  return dedupeBy(warnings, (item) => item);
}

function normalizeNyOpenAction(args = {}) {
  const action = args.action || "mark_setup_triggered";
  const allowed = new Set(["mark_setup_triggered", "mark_tp1", "mark_tp2", "mark_tp3", "mark_stopped", "mark_expired", "mark_cancelled", "replay_strict_setup", "recompute_strategy_performance"]);
  if (!allowed.has(action)) {
    throw new Error(`unsupported_strategy_action:${action}`);
  }
  return action;
}

function strategyActionPatch(action, tick) {
  const common = {
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  if (action === "mark_setup_triggered") {
    return {
      ...common,
      status: "SETUP_TRIGGERED",
      lifecycle_status: "SETUP_TRIGGERED",
      triggered_at: tick.utc,
      triggered_at_utc: tick.utc,
      triggered_at_paris: tick.paris,
    };
  }
  if (action === "mark_tp1") return { ...common, status: "TP1_TAKEN", tp1_at_paris: tick.paris };
  if (action === "mark_tp2") return { ...common, status: "TP2_TAKEN", tp2_at_paris: tick.paris };
  if (action === "mark_tp3") return { ...common, status: "CLOSED", close_reason: "TP3", tp3_at_paris: tick.paris, closed_at_paris: tick.paris };
  if (action === "mark_stopped") return { ...common, status: "STOPPED", close_reason: "STOP", stopped_at_paris: tick.paris, closed_at_paris: tick.paris };
  if (action === "mark_expired") return { ...common, status: "EXPIRED", expired_at_paris: tick.paris };
  if (action === "mark_cancelled") return { ...common, status: "CANCELLED", cancelled_at_paris: tick.paris };
  return common;
}

function strategyAuditLog({ strategy_id, action, document_type, document_id, previous_value, new_value, performed_by, reason, tick }) {
  return {
    audit_id: stableVNextId("strategy_audit", `${strategy_id}_${action}`, `${document_id || "strategy"}_${tick.utc}`),
    strategy_id,
    event_type: action,
    document_type,
    document_id,
    previous_value,
    new_value,
    reason: reason || null,
    performed_by: performed_by || "dashboard_operator",
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

function buildNyOpenMasterPrompt({ strategy_id, date, cutoff_paris, bundle, contract_context }) {
  const context = contract_context || bundle?.contract_context || null;
  const scope = bundle?.resolved_scope || nyOpenOperationalScope(date, cutoff_paris);
  const savePayload = bundle?.save_target?.suggested_payload || contractSavePayload(context);
  const payload = {
    workflow: "NY_OPEN_STRATEGY_MASTER_1530",
    strategy_id,
    strategy_name: NY_OPEN_STRATEGY_NAME,
    date,
    session: NY_OPEN_SESSION,
    cutoff_paris,
    required_first_tool: "get_active_contracts",
    required_data_tool: "get_master_cutoff_bundle avec le scope exact; prepare_nyopen_master_bundle uniquement si le bundle est absent ou degrade",
    save_tool: "save_master_analysis",
    save_must_include: {
      ...savePayload,
      strategy_id,
      session: NY_OPEN_SESSION,
      date,
      trading_date: date,
      run_id: scope.run_id,
      as_of_utc: scope.as_of_utc,
    },
    bundle_read_scope: {
      strategy_id,
      session: NY_OPEN_SESSION,
      mode: "live",
      trading_date: date,
      run_id: scope.run_id,
      as_of_utc: scope.as_of_utc,
      timezone: "Europe/Paris",
      cutoff_paris,
    },
    backend_bundle: {
      bundle_id: bundle?.bundle_id || null,
      status: bundle?.data_quality?.status || bundle?.status || "missing",
      execution_allowed: bundle?.data_quality?.execution_allowed ?? false,
      missing: bundle?.data_quality?.missing || [],
      blockers: bundle?.data_quality?.blockers || [],
      source_hash: bundle?.source_hash || null,
      pack_build_id: bundle?.pack_build_id || null,
      source_coverage: bundle?.pack_or_source_context?.pack?.source_coverage || null,
      market_availability: bundle?.market_availability || null,
    },
    rules: [
      "Appeler get_active_contracts au debut du run et verifier le contrat Master actif.",
      "Utiliser uniquement les donnees visibles au cutoff_paris. Aucun lookahead.",
      "Verifier que le pack immuable couvre as_of_utc; ne jamais reutiliser un ancien pack de cutoff pour un replan ulterieur.",
      "Seul missing_unexpected est une panne. stale_market_closed et not_yet_open sont des etats normaux de session.",
      "Utiliser last_known/H4 comme contexte seulement, jamais comme confirmation fraiche ou trigger.",
      "Un gap technologique est non applicable avant la premiere cotation de session; un VIX cash ferme ne bloque pas seul l'analyse.",
      "Produire un Master NY Open 15:30 avec these, setup et position separes.",
      "Ne pas inventer de trade execute. Les performances viennent uniquement des trades executes sauvegardes.",
      "Chaque save doit inclure contract_name, schema_version et contract_hash.",
    ],
  };
  return {
    contract_context: context,
    title: `NY Open Master ${date} 15:30`,
    text: [
      "Tu es ChatGPT dans un nouveau chat sans contexte prealable.",
      "Objectif: lancer le workflow Master de la strategie NY Open 15:30.",
      "Etapes obligatoires:",
      "1. Appelle get_active_contracts.",
      "2. Appelle get_nyopen_strategy_state avec la date ci-dessous.",
      "3. Si le bundle Master n'est pas ready, appelle prepare_nyopen_master_bundle.",
      "4. Appelle get_master_cutoff_bundle avec bundle_read_scope exactement, puis verifie market_availability et la couverture du pack.",
      "5. Realise l'analyse Master en respectant le contrat actif et le cutoff.",
      "6. Pars de save_target.suggested_payload et sauvegarde avec save_master_analysis sans modifier le scope ni le pack_build_id.",
      "",
      promptJson(payload),
    ].join("\n"),
    payload,
  };
}

function promptJson(value) {
  return JSON.stringify(value, null, 2);
}

function assertRunPackScope(run, pack) {
  const mismatches = [];
  const expectedDate = run.trading_date || run.date;
  const actualDate = pack.trading_date || pack.date || pack.resolved_scope?.trading_date;
  for (const [field, expected, actual] of [
    ["pack_id", run.pack_id, pack.pack_id],
    ["pack_build_id", run.pack_build_id, pack.pack_build_id],
    ["strategy_id", run.strategy_id, pack.strategy_id || pack.resolved_scope?.strategy_id],
    ["session", run.session, pack.session || pack.resolved_scope?.session],
    ["trading_date", expectedDate, actualDate],
  ]) {
    if (expected !== actual) mismatches.push({ field, expected, actual: actual ?? null });
  }
  if (mismatches.length) {
    throw deskError("PACK_BUILD_MISMATCH", "Pinned pack build does not match the replay scope.", { mismatches });
  }
  if (!pack.source_manifest_hash && !pack.manifest?.source_manifest_hash) {
    throw deskError("DATASET_SCHEMA_MISMATCH", "Pinned pack build has no source_manifest_hash.", {
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
    });
  }
  assertReplaySourceCoverage(run, pack, run.end_time || run.current_replay_time || run.cutoff_utc);
  return true;
}

function assertReplaySourceCoverage(run, pack, requiredCutoff) {
  const coverage = replaySourceCoverage(pack);
  const requiredMs = Date.parse(requiredCutoff || "");
  const coverageMs = Date.parse(coverage.end_utc || "");
  const coreToleranceMs = 10 * 60 * 1000;
  const requiredDatasets = new Set((run.instruments || ["MNQ", "MES"]).map((instrument) => ({
    MNQ: "MNQ_M5",
    MES: "MES_M5",
    NQ: "NQ_M15",
    ES: "ES_M15",
  })[instrument]).filter(Boolean));
  const coreFailures = Object.entries(coverage.core_market_max_utc)
    .filter(([dataset]) => requiredDatasets.has(dataset))
    .filter(([, value]) => !Number.isFinite(Date.parse(value || "")) || (Number.isFinite(requiredMs) && Date.parse(value) < requiredMs - coreToleranceMs))
    .map(([dataset, value]) => ({ dataset, max_timestamp_utc: value || null }));
  if (!Number.isFinite(coverageMs) || (Number.isFinite(requiredMs) && coverageMs < requiredMs) || coreFailures.length) {
    throw deskError("REPLAY_SOURCE_COVERAGE_INSUFFICIENT", "Pinned source pack does not cover the requested replay range.", {
      backtest_id: run.backtest_id || null,
      pack_id: pack.pack_id || null,
      pack_build_id: pack.pack_build_id || null,
      pack_purpose: coverage.pack_purpose,
      requested_until_utc: Number.isFinite(requiredMs) ? new Date(requiredMs).toISOString() : requiredCutoff || null,
      source_coverage_end_utc: coverage.end_utc,
      core_market_failures: coreFailures,
      next_action: "build_and_pin_full_replay_source_pack",
    });
  }
  return coverage;
}

function pinReplaySources(run, pack, contracts, creationHash, tick) {
  if (!contracts?.master_contract || !contracts?.monitor_contract) {
    throw deskError("CONTRACT_MISMATCH", "Both active Master and Monitor contracts must be pinned when the replay is created.");
  }
  const sourceCoverage = replaySourceCoverage(pack);
  return {
    ...run,
    creation_request_hash: creationHash,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    pinned_contracts: {
      master_contract: compactContract(contracts.master_contract),
      monitor_contract: compactContract(contracts.monitor_contract),
    },
    contract_snapshot_ref: {
      master: contracts.master_contract.contract_id || null,
      monitor: contracts.monitor_contract.contract_id || null,
      pinned_at_utc: tick.utc,
    },
    source_pack_purpose: sourceCoverage.pack_purpose,
    source_coverage: sourceCoverage,
    sources_pinned: true,
  };
}

function replayCreationResult(run, step, extra = {}) {
  return {
    ok: true,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id,
    strategy_id: run.strategy_id,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    scope_hash: run.scope_hash,
    resolved_scope: run.resolved_scope,
    status: run.status,
    revision: Number(run.revision || 0),
    current_step_id: step?.step_id || run.current_step_id || null,
    current_replay_time: run.current_replay_time,
    setup_count: Number(run.setup_count || 0),
    replay_run: run,
    step: step || null,
    next_action: nextReplayAction(run.status),
    ...extra,
  };
}

function buildOrchestratedReplayRunDoc(args, tick) {
  const date = args.trading_date || args.date || args.date_from;
  const session = args.session;
  const strategy_id = args.strategy_id;
  const cutoff = normalizeReplayTimestamp(args.cutoff_paris || args.initial_cutoff || args.start_time, date);
  const cutoffUtc = args.cutoff_utc || normalizeUtcIso(cutoff);
  const endTime = normalizeReplayTimestamp(args.end_time, date);
  const backtest_id = args.backtest_id;
  const scope = createDeskExecutionScope({
    strategy_id,
    session,
    mode: "replay",
    trading_date: date,
    timezone: args.timezone,
    cutoff_paris: cutoff,
    cutoff_utc: cutoffUtc,
    run_id: args.run_id || backtest_id,
    backtest_id,
    pack_id: args.pack_id,
    pack_build_id: args.pack_build_id,
  });
  return {
    replay_schema_version: "2.0.0",
    backtest_id,
    replay_run_id: args.replay_run_id || backtest_id,
    run_id: args.run_id || backtest_id,
    strategy_id,
    trading_date: date,
    date,
    date_from: date,
    date_to: date,
    session,
    mode: "replay",
    replay_mode: "orchestrated_gpt_in_the_loop",
    automation_enabled: args.automation_enabled !== false,
    automation_mode: args.automation_mode || "gpt_scheduled_task",
    automation_status: args.automation_enabled === false ? "paused" : "running",
    allowed_agent_workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
    current_work_item_id: null,
    last_completed_work_item_id: null,
    last_automation_error: null,
    cadence: normalizeMonitorCadence(args.cadence),
    monitor_cadence: normalizeMonitorCadence(args.cadence),
    timezone: args.timezone || "Europe/Paris",
    cutoff_paris: scope.cutoff_paris,
    cutoff_utc: scope.cutoff_utc,
    pack_id: scope.pack_id,
    pack_build_id: scope.pack_build_id,
    resolved_scope: scope,
    scope_hash: scope.scope_hash,
    start_time: cutoff,
    end_time: endTime,
    initial_cutoff: cutoff,
    current_replay_time: cutoff,
    status: "MASTER_DATA_PREPARING",
    revision: 0,
    lease_owner: null,
    lease_expires_at: null,
    next_action: "prepare_replay_master_bundle",
    current_step_id: null,
    linked_master_analysis_id: null,
    active_replay_thesis_id: null,
    setup_count: 0,
    steps_total: 0,
    steps_done: 0,
    instruments: args.instruments || ["MNQ", "MES", "NQ", "ES"],
    risk_model: args.risk_model || "0.5pct_fixed",
    source_collection: COLLECTIONS.deskReplaySetups,
    source_setup_ids: [],
    gpt_in_the_loop: true,
    automatic_openai_api_decision: false,
    creation_idempotency_key: args.idempotency_key,
    creation_request_hash: hashObject(sourceHashPayload(args)),
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function normalizeReplayTimestamp(value, date) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  if (/^\d{2}:\d{2}/.test(text)) return `${date}T${text.length === 5 ? `${text}:00` : text}${parisOffsetForDate(date)}`;
  return text;
}

function buildReplayStepDoc(run, { sequence, step_type, status, timestamp_paris, previous_step_id } = {}, tick) {
  const step_id = `${run.backtest_id}__step__${String(sequence).padStart(4, "0")}__${String(step_type || "STEP").toLowerCase()}__${compactTimestamp(timestamp_paris || run.current_replay_time)}`;
  return {
    step_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    sequence,
    step_type,
    task_type: step_type,
    job_type: step_type === "MASTER" ? "REPLAY_MASTER_PREP" : "REPLAY_MONITOR_PREP",
    status,
    mode: "replay",
    session: run.session,
    date: run.date,
    timestamp_paris: timestamp_paris || run.current_replay_time,
    cutoff_paris: timestamp_paris || run.current_replay_time,
    as_of_utc: normalizeUtcIso(timestamp_paris || run.current_replay_time),
    previous_step_id: previous_step_id || null,
    previous_timestamp_paris: previous_step_id ? run.current_replay_time : null,
    anti_lookahead_compliant: false,
    validation_result: "pending",
    bundle_id: null,
    bundle_ref: null,
    input_ref: null,
    output_ref: null,
    raw_refs: [],
    source_hash: null,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function patchReplayRun(run, patch, tick) {
  return {
    ...run,
    ...patch,
    next_action: nextReplayAction(patch.status || run.status),
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function patchReplayStep(step, patch, tick) {
  return {
    ...step,
    ...patch,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function resolveReplayStep(steps, run, stepId, expectedType) {
  const step = stepId
    ? (steps || []).find((item) => item.step_id === stepId)
    : (steps || []).find((item) => item.step_id === run.current_step_id) || (steps || []).at(-1);
  if (!step) throw new Error("replay_step_not_found");
  if (expectedType && step.step_type !== expectedType) {
    throw new Error(`replay_step_type_mismatch:${step.step_type || "unknown"}`);
  }
  return step;
}

function resolveReplayMasterPreparation(steps, run, stepId, tick) {
  if (run.status !== "REPLAN_REQUIRED") {
    return {
      step: resolveReplayStep(steps, run, stepId, "MASTER"),
      is_replan: false,
      source_step: null,
    };
  }

  const sourceStep = stepId
    ? (steps || []).find((item) => item.step_id === stepId)
    : (steps || []).find((item) => item.step_id === run.current_step_id) || (steps || []).at(-1);
  if (!sourceStep) throw new Error("replay_replan_source_step_not_found");
  const sequence = Math.max(0, ...(steps || []).map((item) => Number(item.sequence) || 0)) + 1;
  const step = buildReplayStepDoc(run, {
    sequence,
    step_type: "MASTER",
    status: "MASTER_DATA_PREPARING",
    timestamp_paris: run.current_replay_time,
    previous_step_id: sourceStep.step_id,
  }, tick);
  return {
    step: {
      ...step,
      is_replan: true,
      replan_source_step_id: sourceStep.step_id,
      previous_master_analysis_id: run.linked_master_analysis_id || null,
    },
    is_replan: true,
    source_step: sourceStep,
  };
}

function buildReplayReplanContext(run, preparation, docs = {}) {
  return {
    requested: true,
    reason: docs.monitor?.monitor_decision?.action || docs.monitor?.monitor_decision?.decision || "REPLAN_REQUIRED",
    requested_at_paris: run.current_replay_time,
    source_step_id: preparation.source_step?.step_id || run.current_step_id || null,
    previous_master_analysis: docs.master || null,
    previous_active_thesis: docs.thesis || null,
    previous_setups: docs.setups || [],
    triggering_monitor: docs.monitor || null,
    current_position: docs.position || null,
  };
}

function replayTimelineEvent(run, step, event, tick) {
  const event_id = scopedReplayChildId(run, "event", `${String(step?.sequence || 0).padStart(4, "0")}_${event.event_type}_${tick.utc}`);
  return {
    event_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    step_id: step?.step_id || null,
    sequence: step?.sequence || null,
    mode: "replay",
    session: run.session,
    timestamp_paris: step?.timestamp_paris || run.current_replay_time || tick.paris,
    cutoff_paris: step?.cutoff_paris || step?.timestamp_paris || run.current_replay_time || tick.paris,
    time: step?.timestamp_paris || run.current_replay_time || tick.paris,
    phase: event.phase || event.event_type,
    action: event.action || event.event_type,
    event_type: event.event_type,
    event_rank: replayEventRank(event.event_type),
    status: event.status || run.status,
    note: event.note || "",
    ref: event.ref || null,
    anti_lookahead_compliant: event.anti_lookahead_compliant === true,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

function nextReplayAction(status) {
  const map = {
    CREATED: "prepare_replay_master_bundle",
    MASTER_DATA_PREPARING: "prepare_replay_master_bundle",
    MASTER_DATA_READY: "copy_master_prompt_for_chatgpt",
    WAITING_GPT_MASTER: "copy_master_prompt_then_gpt_reads_bundle_and_saves_replay_master_analysis",
    MASTER_RUNNING_MANUAL: "save_replay_master_analysis",
    MASTER_SAVED: "materialize_replay_master",
    MASTER_MATERIALIZED: "advance_replay_clock",
    READY_FOR_NEXT_MONITOR: "advance_replay_clock",
    ADVANCING_CLOCK: "prepare_replay_monitor_bundle",
    MONITOR_DATA_PREPARING: "prepare_replay_monitor_bundle",
    MONITOR_DATA_READY: "copy_monitor_prompt_for_chatgpt",
    WAITING_GPT_MONITOR: "copy_monitor_prompt_then_gpt_reads_bundle_and_saves_replay_monitor",
    MONITOR_RUNNING_MANUAL: "save_replay_monitor",
    MONITOR_SAVED: "apply_replay_monitor_result",
    MONITOR_APPLIED: "apply_replay_monitor_result",
    SIMULATION_UPDATED: "advance_replay_clock",
    WAITING_NEXT_STEP: "advance_replay_clock",
    REPLAN_REQUIRED: "prepare_replay_master_bundle",
    DAY_END: "review_replay_report",
    COMPLETED: "review_replay_report",
    FAILED: "inspect_replay_error",
    CANCELLED: "start_new_replay",
  };
  return map[status] || "refresh_replay_state";
}

function replayEventRank(eventType) {
  const ranks = {
    RUN_CREATED: 10,
    MASTER_BUNDLE_READY: 20,
    GPT_MASTER_SAVED: 30,
    CLOCK_ADVANCED: 40,
    MONITOR_BUNDLE_READY: 50,
    GPT_MONITOR_SAVED: 60,
    MONITOR_RESULT_APPLIED: 70,
    INTERVAL_SIMULATED: 80,
    REPLAY_CANCELLED: 90,
  };
  return ranks[eventType] || 999;
}

async function buildReplayMasterBundle(store, run, step, args = {}, clock = new SystemClock(), replanContext = null) {
  const tick = clock.now();
  const cutoff = step.cutoff_paris || step.timestamp_paris || run.current_replay_time;
  const date = run.date || String(cutoff).slice(0, 10);
  const session = run.session;
  const contracts = run.pinned_contracts || await store.getActiveContracts();
  const contract_context = contractContext(contracts, "master", { tick, pinnedForReplay: true, backtestId: run.backtest_id });
  const asOfUtc = normalizeUtcIso(cutoff);
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  const sourceCoverage = assertReplaySourceCoverage(run, pack, cutoff);
  const rolling = await buildPinnedReplaySnapshots(store, run, pack, cutoff, args.include_raw_refs !== false);
  const macro = pack.datasets?.macro_calendar
    ? await store.getMacroCalendar({ pack_id: run.pack_id, pack_build_id: run.pack_build_id, date, as_of_utc: asOfUtc, mode: "replay" })
    : { events: [], warning: "macro_calendar_not_available" };
  const news = pack.datasets?.news_digest
    ? await store.getNewsDigest({ pack_id: run.pack_id, pack_build_id: run.pack_build_id, date, session, as_of_utc: asOfUtc, mode: "replay" })
    : { items: [], warning: "news_digest_not_available" };
  const visibleMacro = macro.events || [];
  const visibleNews = news.items || [];
  const base = {
    ok: true,
    bundle_id: replayBundleId(run, step, "master"),
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    step_id: step.step_id,
    replay_time: cutoff,
    timestamp_paris: cutoff,
    cutoff_paris: cutoff,
    mode: "replay",
    bundle_type: "master",
    session,
    date,
    timezone: run.timezone || "Europe/Paris",
    contract_name: "DeskReplayMasterBundleTransport",
    schema_version: "2.0.0",
    transport_contract: replayTransportContract("master"),
    contract_context,
    contract_handshake: contractHandshake("replay_master", contract_context, {
      saveTool: "save_replay_master_analysis",
      backtestId: run.backtest_id,
    }),
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    is_replan: Boolean(replanContext),
    replan_context: replanContext,
    previous_replay_master_analysis: replanContext?.previous_master_analysis || null,
    previous_replay_active_thesis: replanContext?.previous_active_thesis || null,
    previous_replay_setups: replanContext?.previous_setups || [],
    triggering_replay_monitor: replanContext?.triggering_monitor || null,
    replay_position: replanContext?.current_position || null,
    pack: compactPack(pack),
    data: {
      pack: compactPack(pack),
      dataset_integrity: rolling.integrity,
      macro_calendar: { ...macro, events: visibleMacro },
      news_digest: { ...news, items: visibleNews },
      market_availability: rolling.market_availability,
      rolling_snapshots: rolling.snapshots,
      rolling_15m_snapshot: rolling.snapshots["15m"] || null,
      rolling_1h_snapshot: rolling.snapshots["1h"] || null,
      rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    },
    data_quality: replayBundleQuality({ pack, rolling, macro: visibleMacro, news: visibleNews, sourceCoverage }),
    anti_lookahead_policy: buildAntiLookaheadPolicy({
      cutoff,
      rolling,
      macro: visibleMacro,
      news: visibleNews,
    }),
    raw_refs: args.include_raw_refs === false ? [] : rolling.raw_refs,
    chatgpt_replay_instructions: {
      required_mode: replanContext ? "manual_gpt_master_replan_replay" : "manual_gpt_master_replay",
      save_tool: "save_replay_master_analysis",
      required_payload_keys: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "pack_build_id", "contract_name", "schema_version", "contract_hash", "analysis_id", "full_analysis", "active_thesis", "setups"],
      contract_handshake: contractHandshake("replay_master", contract_context, {
        saveTool: "save_replay_master_analysis",
        backtestId: run.backtest_id,
      }),
      decision_boundary: replanContext
        ? "Backend prepared a new cutoff-scoped Master step. GPT must replan this backtest_id from the prior Master, thesis, triggering Monitor, current position, and newly visible data."
        : "Backend prepares data only. GPT creates the Master inside this backtest_id.",
    },
    save_target: {
      tool: "save_replay_master_analysis",
      collection: COLLECTIONS.deskReplayMasterAnalyses,
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: Number(run.revision || 0) + 1,
        idempotency_key: `save-master:${run.backtest_id}:${step.step_id}`,
        analysis_id: scopedReplayChildId(run, "master", step.step_id),
        pack_build_id: run.pack_build_id,
        ...contractSavePayload(contract_context),
        mode: "replay",
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return canonicalizeReplayBundle({ ...base, source_hash: hashObject(sourceHashPayload(base)) });
}

async function buildReplayMonitorBundle(store, run, step, replayDocs, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const checkpoint = args.timestamp_paris || step.timestamp_paris || run.current_replay_time;
  const date = run.date || String(checkpoint).slice(0, 10);
  const session = run.session;
  const contracts = run.pinned_contracts || await store.getActiveContracts();
  const contract_context = contractContext(contracts, "monitor", { tick, pinnedForReplay: true, backtestId: run.backtest_id });
  const master = replayDocs.master || null;
  const thesis = projectReplayActiveThesis(replayDocs.thesis || null, replayDocs.monitors || []);
  const setups = replayDocs.setups || [];
  const previousMonitor = (replayDocs.monitors || []).find((monitor) => monitor.step_id !== step.step_id) || null;
  const position = (replayDocs.positions || [])[0] || null;
  const replayContinuity = buildReplayContinuityState({
    run,
    currentStep: step,
    activeThesis: thesis,
    setups,
    positions: replayDocs.positions || [],
    monitors: replayDocs.monitors || [],
  });
  const cadenceRecommendation = recommendReplayCadenceMinutes({
    run,
    activeThesis: thesis,
    setups,
    positions: replayDocs.positions || [],
    monitors: replayDocs.monitors || [],
  });
  const eventCheckpoints = buildReplayEventCheckpoints({
    activeThesis: thesis,
    latestMonitor: previousMonitor,
    run,
  });
  assertReplayLineage(run, { master, thesis, monitors: replayDocs.monitors || [], positions: replayDocs.positions || [] });
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  const sourceCoverage = assertReplaySourceCoverage(run, pack, checkpoint);
  const rolling = await buildPinnedReplaySnapshots(store, run, pack, checkpoint, args.include_raw_refs !== false);
  const base = {
    ok: true,
    bundle_id: replayBundleId(run, step, "monitor"),
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    step_id: step.step_id,
    timestamp_paris: checkpoint,
    cutoff_paris: checkpoint,
    cadence: run.cadence || "15m",
    mode: "replay",
    bundle_type: "monitor",
    contract_name: "DeskReplayMonitorBundleTransport",
    schema_version: "2.0.0",
    transport_contract: replayTransportContract("monitor"),
    session,
    date,
    timezone: run.timezone || "Europe/Paris",
    contract_context,
    contract_handshake: contractHandshake("replay_monitor", contract_context, {
      saveTool: "save_replay_monitor",
      backtestId: run.backtest_id,
    }),
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    replay_master_analysis: master,
    replay_active_thesis: thesis,
    replay_setups: setups,
    replay_continuity: replayContinuity,
    active_setup: replayContinuity.active_setup,
    armed_setup: replayContinuity.armed_setup,
    recommended_replay_cadence: cadenceRecommendation,
    event_checkpoints: eventCheckpoints,
    previous_replay_monitor: previousMonitor,
    replay_position: position,
    rolling_snapshots: rolling.snapshots,
    market_availability: rolling.market_availability,
    rolling_15m_snapshot: rolling.snapshots["15m"] || null,
    rolling_1h_snapshot: rolling.snapshots["1h"] || null,
    rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    dataset_integrity: rolling.integrity,
    macro_horizon: null,
    cross_asset_delta: null,
    level_test_events: [],
    technical_events: [],
    condition_status: null,
    data_quality: replayBundleQuality({ pack, rolling, thesis, master, sourceCoverage }),
    anti_lookahead_policy: buildAntiLookaheadPolicy({ cutoff: checkpoint, rolling }),
    raw_refs: args.include_raw_refs === false ? [] : rolling.raw_refs,
    chatgpt_replay_instructions: {
      required_mode: "manual_gpt_monitor_replay",
      save_tool: "save_replay_monitor",
      required_payload_keys: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "monitor_id", "master_id", "thesis_id", "sequence", "scheduled_for_utc", "as_of_utc", "pack_build_id", "contract_name", "schema_version", "contract_hash", "monitor_decision"],
      setup_continuity_contract: {
        note: "If a setup becomes candidate, pre-armed or conditionally armed, persist it as structured setup_candidate/setup_transition/armed_setup; classify each condition importance as HARD_BLOCKER, MANDATORY, PRIMARY, SECONDARY, OPTIONAL or ADVISORY.",
        backend_between_monitors: "Only structured backend-evaluable conditions and entry/stop/target fields can be simulated between two Monitor cutoffs.",
      },
      contract_handshake: contractHandshake("replay_monitor", contract_context, {
        saveTool: "save_replay_monitor",
        backtestId: run.backtest_id,
      }),
      decision_boundary: "GPT can only update this replay run; live thesis/monitors are not inputs.",
    },
    save_target: {
      tool: "save_replay_monitor",
      collection: COLLECTIONS.deskReplayMonitors,
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: Number(run.revision || 0) + 1,
        idempotency_key: `save-monitor:${run.backtest_id}:${step.step_id}`,
        monitor_id: scopedReplayChildId(run, "monitor", step.step_id),
        master_id: master?.analysis_id || null,
        thesis_id: thesis?.thesis_id || null,
        sequence: step.sequence,
        scheduled_for_utc: normalizeUtcIso(checkpoint),
        as_of_utc: normalizeUtcIso(checkpoint),
        pack_build_id: run.pack_build_id,
        ...contractSavePayload(contract_context),
        timestamp_paris: checkpoint,
        cadence: run.cadence || "15m",
        manual_triggered: true,
        triggered_by: "user_chatgpt",
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return canonicalizeReplayBundle({ ...base, source_hash: hashObject(sourceHashPayload(base)) });
}

function replayBundleId(run, step, type) {
  return scopedReplayChildId(run, "bundle", `${step.step_id}_${type}`);
}

function scopedReplayChildId(run, type, value) {
  const existing = String(value || "").trim();
  if (existing.startsWith(`${run.backtest_id}__`)) return existing;
  return `${run.backtest_id}__${sanitizeId(type)}__${sanitizeId(existing || type)}`;
}


function buildAntiLookaheadPolicy({ cutoff, rolling, macro = [], news = [] }) {
  const maxPrice = maxRollingTimestamp(rolling);
  return {
    cutoff_paris: cutoff,
    max_price_timestamp_used: maxPrice || null,
    max_macro_timestamp_used: maxTimestamp(macro, ["published_at_paris", "timestamp_paris", "time_paris", "scheduled_at_paris"]),
    max_news_timestamp_used: maxTimestamp(news, ["published_at_paris", "timestamp_paris", "created_at_paris", "time_paris"]),
    actual_j_jplus1_hidden: true,
    actual_j_jplus1_visibility_rule: "actuals_visible_when_published_lte_cutoff_else_hidden",
    macro_actuals_visible_until_cutoff: true,
    macro_actuals_after_cutoff_hidden: true,
    future_prices_used: Boolean(maxPrice && Date.parse(maxPrice) > Date.parse(cutoff)),
    future_news_used: false,
    compliant: !(maxPrice && Date.parse(maxPrice) > Date.parse(cutoff)),
  };
}

function maxRollingTimestamp(rolling) {
  const values = [];
  for (const snapshot of Object.values(rolling?.snapshots || {})) {
    for (const instrument of Object.values(snapshot?.instruments || {})) {
      if (instrument?.last_timestamp_paris) values.push(instrument.last_timestamp_paris);
    }
  }
  return values.sort().at(-1) || null;
}

function maxTimestamp(items, keys) {
  return (items || [])
    .map((item) => keys.map((key) => item?.[key]).find(Boolean))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function replayBundleQuality({ pack, rolling, thesis, master, macro, news, sourceCoverage }) {
  const missing = [];
  const warnings = [];
  const stale = [];
  const informational = [];
  if (!pack) missing.push("desk_pack");
  if (thesis === null) missing.push("replay_active_thesis");
  if (master === null) missing.push("replay_master_analysis");
  if (Array.isArray(macro) && !macro.length) warnings.push("macro_calendar_empty_or_hidden_by_cutoff");
  if (Array.isArray(news) && !news.length) warnings.push("news_digest_empty_or_hidden_by_cutoff");
  for (const [window, snapshot] of Object.entries(rolling?.snapshots || {})) {
    if (snapshot?.data_quality?.missing_instruments?.length) {
      warnings.push(`rolling_${window}_missing:${snapshot.data_quality.missing_instruments.join(",")}`);
    }
    if (snapshot?.data_quality?.closed_instruments?.length) {
      informational.push(`rolling_${window}_market_closed:${snapshot.data_quality.closed_instruments.join(",")}`);
    }
    if (snapshot?.data_quality?.stale_context_instruments?.length) {
      stale.push(...snapshot.data_quality.stale_context_instruments.map((instrument) => `${window}:${instrument}`));
    }
  }
  const criticalMissing = (rolling?.snapshots?.["15m"]?.data_quality?.missing_instruments || [])
    .filter((instrument) => ["MNQ", "MES"].includes(instrument));
  if (criticalMissing.length) missing.push(`rolling_15m_critical_market_missing:${criticalMissing.join(",")}`);
  const integrityEntries = Object.values(rolling?.integrity || {});
  const integrityValid = integrityEntries.length > 0 && integrityEntries.every((item) => item?.valid === true);
  if (!integrityValid) missing.push("dataset_integrity");
  const status = missing.length ? "degraded" : warnings.length ? "degraded" : stale.length ? "stale" : "ready";
  return {
    status,
    execution_allowed: missing.length === 0 && integrityValid,
    missing,
    stale: dedupeBy(stale, (item) => item),
    warnings,
    informational: dedupeBy(informational, (item) => item),
    anti_lookahead_compliant: integrityValid,
    source_coverage: sourceCoverage || (pack ? replaySourceCoverage(pack) : null),
  };
}

function assertReplayBundleExecutable(bundle) {
  if (bundle?.anti_lookahead_policy?.compliant !== true || bundle?.data_quality?.execution_allowed !== true) {
    throw deskError("PACK_BUILD_NOT_READY", "Replay bundle failed integrity or anti-lookahead validation.", {
      bundle_id: bundle?.bundle_id || null,
      data_quality: bundle?.data_quality || null,
      anti_lookahead_policy: bundle?.anti_lookahead_policy || null,
    });
  }
  return true;
}

function assertReplayContractSave(run, args, type, step) {
  const expected = type === "monitor" ? run.pinned_contracts?.monitor_contract : run.pinned_contracts?.master_contract;
  if (!expected) throw deskError("CONTRACT_MISMATCH", `Pinned ${type} contract is missing from the replay run.`);
  const mismatches = [];
  for (const [field, actual, wanted] of [
    ["contract_name", args.contract_name, expected.contract_name],
    ["schema_version", args.schema_version, expected.schema_version],
    ["contract_hash", args.contract_hash, contractHash(expected)],
  ]) {
    if (actual !== wanted) mismatches.push({ field, expected: wanted || null, actual: actual || null });
  }
  if (args.pack_build_id && args.pack_build_id !== run.pack_build_id) {
    mismatches.push({ field: "pack_build_id", expected: run.pack_build_id, actual: args.pack_build_id });
  }
  if (mismatches.length) {
    throw deskError("CONTRACT_MISMATCH", "Save payload does not match the replay-pinned contract or pack build.", { mismatches });
  }
  const explicitId = type === "monitor" ? args.monitor_id : args.analysis_id;
  if (!explicitId || !String(explicitId).startsWith(`${run.backtest_id}__`)) {
    throw deskError("CROSS_SCOPE_REFERENCE", `${type}_id must be explicitly prefixed by backtest_id.`, {
      backtest_id: run.backtest_id,
      id: explicitId || null,
    });
  }
  if (type === "monitor") {
    if (args.master_id !== run.linked_master_analysis_id || args.thesis_id !== run.active_replay_thesis_id) {
      throw deskError("CROSS_SCOPE_REFERENCE", "Monitor parent IDs do not match the replay run.", {
        expected_master_id: run.linked_master_analysis_id || null,
        actual_master_id: args.master_id || null,
        expected_thesis_id: run.active_replay_thesis_id || null,
        actual_thesis_id: args.thesis_id || null,
      });
    }
    const stepAsOfUtc = normalizeUtcIso(step.cutoff_paris || step.timestamp_paris);
    if (Number(args.sequence) !== Number(step.sequence) || normalizeUtcIso(args.as_of_utc) !== stepAsOfUtc || normalizeUtcIso(args.scheduled_for_utc) !== stepAsOfUtc) {
      throw deskError("CLOCK_REGRESSION_FORBIDDEN", "Monitor sequence and timestamps must match the current replay step.", {
        expected_sequence: step.sequence,
        actual_sequence: args.sequence,
        expected_as_of_utc: stepAsOfUtc,
        actual_as_of_utc: args.as_of_utc,
        scheduled_for_utc: args.scheduled_for_utc,
      });
    }
  }
  return true;
}

function normalizeReplayMasterAnalysis(args, run, step, tick) {
  const analysis_id = args.analysis_id;
  const full = {
    ...(args.full_analysis || {}),
    setups: firstArray(args.setups, args.full_analysis?.setups, args.full_analysis?.candidate_setups, args.full_analysis?.setup_candidates),
  };
  return {
    ...args,
    analysis_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    date: run.date,
    timestamp_paris: step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    full_analysis: full,
    active_thesis: args.active_thesis || full.active_thesis || null,
    setups: full.setups || [],
    anti_lookahead_compliant: true,
    source_hash: hashObject(sourceHashPayload({ ...args, backtest_id: run.backtest_id, step_id: step.step_id })),
    saved_at: tick.utc,
    saved_at_utc: tick.utc,
    saved_at_paris: tick.paris,
    created_at: args.created_at ?? tick.utc,
    created_at_utc: args.created_at_utc ?? tick.utc,
    created_at_paris: args.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function buildReplaySetupDocs(master, run, step, tick) {
  return buildMasterSetupDocs(master, { analysis_id: master.analysis_id }, tick).map((setup) => ({
    ...setup,
    setup_record_id: scopedReplayChildId(run, "setup", setup.setup_id || setup.setup_record_id),
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    mode: "replay",
    source_analysis_collection: COLLECTIONS.deskReplayMasterAnalyses,
    source_collection: COLLECTIONS.deskReplaySetups,
    anti_lookahead_compliant: true,
  }));
}

function normalizeReplayActiveThesis(thesis, master, run, step, tick) {
  if (!thesis) return null;
  const thesis_id = scopedReplayChildId(run, "thesis", thesis.thesis_id || master.analysis_id);
  return {
    ...thesis,
    thesis_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    date: run.date,
    timezone: run.timezone || "Europe/Paris",
    linked_master_analysis_id: master.analysis_id,
    status: thesis.status || "WAIT_MONITORED",
    anti_lookahead_compliant: true,
    created_at: thesis.created_at ?? tick.utc,
    created_at_utc: thesis.created_at_utc ?? tick.utc,
    created_at_paris: thesis.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function normalizeReplayContextTransmission(context, run, step, links, tick) {
  const context_id = scopedReplayChildId(run, "context", context.context_id || `${step.step_id}_${links.linked_analysis_id || links.linked_monitor_id || "context"}`);
  return {
    ...context,
    ...links,
    context_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    timestamp_paris: step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    anti_lookahead_compliant: true,
    created_at: context.created_at ?? tick.utc,
    created_at_utc: context.created_at_utc ?? tick.utc,
    created_at_paris: context.created_at_paris ?? tick.paris,
  };
}

function assertReplayCanAdvance(run, args) {
  if (!run.linked_master_analysis_id && args.force !== true) {
    throw new Error("replay_master_required_before_advance");
  }
  if (["FAILED", "CANCELLED", "DAY_END"].includes(run.status)) {
    throw new Error(`replay_not_advanceable:${run.status}`);
  }
  const allowed = new Set(["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"]);
  if (!allowed.has(run.status) && args.force !== true) {
    throw new Error(`replay_step_not_ready_to_advance:${run.status}`);
  }
}

function normalizeReplayMonitor(args, run, step, tick) {
  const monitor_id = args.monitor_id;
  return {
    ...args,
    monitor_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    master_id: args.master_id,
    thesis_id: args.thesis_id,
    sequence: args.sequence,
    scheduled_for_utc: args.scheduled_for_utc,
    as_of_utc: args.as_of_utc,
    mode: "replay",
    session: run.session,
    timestamp_paris: args.timestamp_paris || step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    cadence: normalizeMonitorCadence(args.cadence || run.cadence),
    manual_triggered: args.manual_triggered !== false,
    triggered_by: args.triggered_by || "user_chatgpt",
    monitor_decision: args.monitor_decision || {},
    anti_lookahead_compliant: true,
    source_hash: hashObject(sourceHashPayload({ ...args, backtest_id: run.backtest_id, step_id: step.step_id })),
    saved_at: tick.utc,
    saved_at_utc: tick.utc,
    saved_at_paris: tick.paris,
    created_at: args.created_at ?? tick.utc,
    created_at_utc: args.created_at_utc ?? tick.utc,
    created_at_paris: args.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function patchReplayThesis(thesis, monitor, tick) {
  return {
    ...thesis,
    ...(monitor.thesis_update || {}),
    latest_monitor_id: monitor.monitor_id,
    latest_monitor_step_id: monitor.step_id,
    health_score: typeof monitor.thesis_health_score === "number"
      ? monitor.thesis_health_score
      : monitor.thesis_health_score?.score ?? thesis.health_score,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function buildReplayMonitorApplication(run, step, monitor, positions, tick) {
  const action = normalizeReplayMonitorAction(monitor.monitor_decision);
  const existing = positions[0] || null;
  if (action === "TRIGGER_GO") {
    const position = {
      ...(existing || {}),
      position_id: existing?.position_id || scopedReplayChildId(run, "position", step.step_id),
      backtest_id: run.backtest_id,
      replay_run_id: run.replay_run_id || run.backtest_id,
      strategy_id: run.strategy_id,
      trading_date: run.trading_date || run.date,
      resolved_scope: run.resolved_scope,
      scope_hash: run.scope_hash,
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      source_manifest_hash: run.source_manifest_hash,
      step_id: step.step_id,
      monitor_id: monitor.monitor_id,
      mode: "replay",
      status: "OPEN",
      instrument: monitor.monitor_decision?.instrument || monitor.instrument || null,
      direction: monitor.monitor_decision?.direction || monitor.direction || null,
      entry_price: monitor.monitor_decision?.entry_price ?? monitor.monitor_decision?.entry ?? null,
      stop_loss: monitor.monitor_decision?.stop_loss ?? null,
      take_profit_1: monitor.monitor_decision?.take_profit_1 ?? monitor.monitor_decision?.tp1 ?? null,
      opened_at_paris: step.timestamp_paris,
      anti_lookahead_compliant: true,
      created_at: existing?.created_at || tick.utc,
      created_at_utc: existing?.created_at_utc || tick.utc,
      created_at_paris: existing?.created_at_paris || tick.paris,
      updated_at: tick.utc,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    return { action, position, run_status: "WAITING_NEXT_STEP", note: "Replay position created from GPT monitor decision." };
  }
  if (action === "REPLAN_FULL") {
    return { action, position: existing, run_status: "REPLAN_REQUIRED", note: "GPT monitor requested a full replan." };
  }
  if (action === "INVALIDATE_THESIS") {
    return { action, position: existing, run_status: "REPLAN_REQUIRED", note: "Replay thesis invalidated by GPT monitor." };
  }
  if (action === "EXIT_POSITION" && existing) {
    return {
      action,
      position: { ...existing, status: "CLOSED", closed_at_paris: step.timestamp_paris, updated_at: tick.utc, updated_at_utc: tick.utc, updated_at_paris: tick.paris },
      run_status: "WAITING_NEXT_STEP",
      note: "Replay position closed by GPT monitor decision.",
    };
  }
  if (action === "MOVE_STOP_BE" && existing) {
    return {
      action,
      position: {
        ...existing,
        status: "PROTECTED",
        stop_loss: existing.entry_price ?? existing.entry ?? existing.stop_loss,
        latest_management_action: action,
        updated_at: tick.utc,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      },
      run_status: "WAITING_NEXT_STEP",
      note: "Replay stop moved to breakeven by GPT monitor decision.",
    };
  }
  if (action === "TAKE_PARTIAL" && existing) {
    return {
      action,
      position: {
        ...existing,
        status: "PARTIAL_TAKEN",
        partial_taken: true,
        latest_management_action: action,
        updated_at: tick.utc,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      },
      run_status: "WAITING_NEXT_STEP",
      note: "Replay partial take-profit applied from GPT monitor decision.",
    };
  }
  return { action, position: existing, run_status: "WAITING_NEXT_STEP", note: "Replay monitor applied without opening a new position." };
}

function normalizeReplayMonitorAction(decision = {}) {
  return String(decision.action || decision.decision || decision.action_now || "WAIT_MORE").trim().toUpperCase();
}

async function buildReplayIntervalSimulation(store, run, step, position, setups = [], { from, to }, tick) {
  assertReplayIntervalBounds(run, step, { from, to });
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  assertRunPackScope(run, pack);
  const activeSetups = selectActiveReplaySetups(setups);
  const instruments = [...new Set([
    position?.instrument,
    ...activeSetups.map((setup) => setup.instrument),
  ].filter(Boolean).map((instrument) => String(instrument).toUpperCase()))];
  const datasets = [];
  for (const instrument of instruments) {
    const datasetName = replayPositionDataset(pack, instrument);
    const dataset = await store.getDataset({
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      dataset: datasetName,
      as_of_utc: normalizeUtcIso(to),
      mode: "replay",
      format: "json",
      max_rows: Number.MAX_SAFE_INTEGER,
    });
    const intervalRows = filterRawWindowRows(dataset?.rows || [], { from, to });
    datasets.push({ instrument, datasetName, dataset, intervalRows });
  }
  const allRows = datasets.flatMap((item) => item.intervalRows || []);
  const maxTimestampUsed = allRows
    .map((row) => row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const futurePricesUsed = Boolean(maxTimestampUsed && Date.parse(maxTimestampUsed) > Date.parse(to));
  if (futurePricesUsed) {
    throw deskError("LOOKAHEAD_DETECTED", "Replay interval contains a price observation after the step cutoff.", {
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      max_timestamp_utc: normalizeUtcIso(maxTimestampUsed),
      allowed_until_utc: normalizeUtcIso(to),
    });
  }
  const sourceManifestHash = pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null;
  const rawRefs = datasets.map(({ datasetName }) => ({
    dataset: datasetName,
    object_path: pack.datasets?.[datasetName]?.object_path || pack.datasets?.[datasetName]?.storage_path || null,
    gcs_generation: pack.datasets?.[datasetName]?.gcs_generation || null,
    sha256: pack.datasets?.[datasetName]?.sha256 || null,
  }));
  const rowsByInstrument = new Map(datasets.map((item) => [item.instrument, item.intervalRows || []]));
  let positionUpdate = null;
  let simulationStatus = position ? "UNCHANGED" : "NO_POSITION";
  let simulationNote = position ? "Interval recorded from the immutable dataset pinned to this replay." : "No replay position to simulate.";
  if (position) {
    const instrumentRows = rowsByInstrument.get(String(position.instrument || "").toUpperCase()) || [];
    const positionEvaluation = evaluateReplayPositionOnRows(position, instrumentRows, { tick });
    if (positionEvaluation.changed) {
      positionUpdate = positionEvaluation.position;
      simulationStatus = positionEvaluation.reason;
      simulationNote = `Replay position updated during interval: ${positionEvaluation.reason}.`;
    }
  }
  const setupEvaluations = [];
  let triggeredPosition = null;
  for (const setup of activeSetups) {
    const instrumentRows = rowsByInstrument.get(String(setup.instrument || "").toUpperCase()) || [];
    const evaluation = evaluateReplaySetupOnRows(setup, instrumentRows, { tick });
    setupEvaluations.push(evaluation);
    if (!position && !triggeredPosition && evaluation.triggered) {
      triggeredPosition = buildReplayPositionFromTriggeredSetup({
        setup: evaluation.setup,
        run,
        step,
        monitor: { monitor_id: setup.monitor_id || null },
        trigger: evaluation,
        tick,
        makePositionId: (value) => scopedReplayChildId(run, "position", `${step.step_id}_${value}`),
      });
      positionUpdate = triggeredPosition;
      simulationStatus = "SETUP_TRIGGERED";
      simulationNote = "Conditional replay setup triggered from immutable interval prices.";
    }
  }
  const setupUpdates = setupEvaluations
    .filter((evaluation) => evaluation.setup && (evaluation.triggered || evaluation.setup.condition_summary))
    .map((evaluation) => evaluation.setup);
  return {
    simulation_id: scopedReplayChildId(run, "simulation", `${step.sequence || 0}_${compactTimestamp(to)}`),
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    session: run.session,
    trading_date: run.trading_date || run.date,
    run_id: run.replay_run_id || run.backtest_id,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: sourceManifestHash,
    step_id: step.step_id,
    mode: "replay",
    from_timestamp: from,
    to_timestamp: to,
    as_of_utc: normalizeUtcIso(to),
    cutoff_paris: to,
    position_id: positionUpdate?.position_id || position?.position_id || null,
    position: position || null,
    position_update: positionUpdate,
    setup_updates: setupUpdates,
    active_setup_count: activeSetups.length,
    setup_evaluations: setupEvaluations.map((evaluation) => ({
      setup_record_id: evaluation.setup?.setup_record_id || null,
      setup_id: evaluation.setup?.setup_id || null,
      status: evaluation.status || evaluation.setup?.status || null,
      triggered: evaluation.triggered === true,
      reason: evaluation.reason,
      condition_summary: evaluation.setup?.condition_summary || null,
    })),
    dataset: datasets[0]?.datasetName || null,
    datasets: datasets.map((item) => ({ instrument: item.instrument, dataset: item.datasetName, row_count: item.intervalRows.length })),
    row_count: allRows.length,
    max_price_timestamp_used: maxTimestampUsed,
    future_prices_used: false,
    integrity: datasets.map((item) => item.dataset?.integrity).filter(Boolean)[0] || null,
    data_quality: rawWindowQuality(allRows, { reason: instruments.length ? "pinned_dataset_has_no_rows_in_interval" : "no_replay_position_or_setup" }),
    raw_refs: rawRefs,
    result: {
      status: simulationStatus,
      note: simulationNote,
    },
    anti_lookahead_compliant: true,
    computed_with_cutoff: to,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

function assertReplayIntervalBounds(run, step, { from, to }) {
  const fromMs = Date.parse(String(from || ""));
  const toMs = Date.parse(String(to || ""));
  const stepCutoff = step.as_of_utc || step.cutoff_paris || step.timestamp_paris;
  const stepMs = Date.parse(String(stepCutoff || ""));
  const runClockMs = Date.parse(String(run.current_replay_time || ""));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw deskError("INVALID_SCOPE", "Replay interval bounds must be valid and ordered.", { from, to });
  }
  if (!Number.isFinite(stepMs) || toMs > stepMs || (Number.isFinite(runClockMs) && toMs > runClockMs)) {
    throw deskError("CLOCK_LIMIT_EXCEEDED", "Replay interval exceeds the current step cutoff.", {
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      to,
      step_cutoff: stepCutoff || null,
      current_replay_time: run.current_replay_time || null,
    });
  }
  if (run.end_time && toMs > Date.parse(run.end_time)) {
    throw deskError("CLOCK_LIMIT_EXCEEDED", "Replay interval exceeds the run end time.", { to, end_time: run.end_time });
  }
  return true;
}

function replayPositionDataset(pack, instrument) {
  const candidates = {
    MNQ: ["MNQ_M5"],
    NQ: ["NQ_M15", "MNQ_M5"],
    MES: ["MES_M5"],
    ES: ["ES_M15", "MES_M5"],
  }[String(instrument || "").toUpperCase()] || [localM5DatasetName(instrument)];
  const dataset = candidates.find((name) => pack.datasets?.[name]);
  if (!dataset) {
    throw deskError("DATASET_NOT_FOUND", "Pinned pack has no price dataset for the replay position.", {
      pack_id: pack.pack_id,
      pack_build_id: pack.pack_build_id,
      instrument,
      attempted_datasets: candidates,
    });
  }
  return dataset;
}

function selectReplayTimeline(docs, backtestId) {
  return (docs || [])
    .filter((event) => event.backtest_id === backtestId)
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)
      || String(left.timestamp_paris || "").localeCompare(String(right.timestamp_paris || ""))
      || Number(left.event_rank || 999) - Number(right.event_rank || 999)
      || String(left.created_at || "").localeCompare(String(right.created_at || "")));
}

function selectReplayBundles(docs, backtestId) {
  return (docs || [])
    .filter((bundle) => bundle.backtest_id === backtestId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function selectReplayBundle(bundles, { step_id, bundle_type }) {
  return (bundles || []).find((bundle) => (!step_id || bundle.step_id === step_id) && bundle.bundle_type === bundle_type) || null;
}

function selectReplayBundleForRead(docs, args = {}) {
  const bundles = selectReplayBundles(docs, args.backtest_id);
  const bundle = selectReplayBundle(bundles, {
    step_id: args.step_id,
    bundle_type: args.bundle_type,
  });
  if (!bundle) {
    throw new Error(`replay_${args.bundle_type || "unknown"}_bundle_not_found`);
  }
  return bundle;
}

function selectLatestReplayMaster(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.saved_at || right.created_at || "").localeCompare(String(left.saved_at || left.created_at || "")))[0] || null;
}

function selectReplayActiveThesis(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))[0] || null;
}

function selectReplayScopedSetups(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
}

function selectReplayMonitors(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.timestamp_paris || right.saved_at || "").localeCompare(String(left.timestamp_paris || left.saved_at || "")));
}

function selectReplayMonitorForStep(docs, backtestId, stepId) {
  return selectReplayMonitors(docs, backtestId).find((monitor) => monitor.step_id === stepId) || null;
}

function selectReplayPositions(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
}

function selectReplaySimulations(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(left.to_timestamp || left.created_at || "").localeCompare(String(right.to_timestamp || right.created_at || "")));
}

async function claimNextDeskWorkFacade(store, args, tick) {
  const workflows = args.workflows || ["LIVE_MASTER", "LIVE_M15_MONITOR", "REPLAY_MASTER", "REPLAY_MONITOR"];
  const liveWorkflows = workflows.filter((workflow) => workflow.startsWith("LIVE_"));
  const replayWorkflows = workflows.filter((workflow) => workflow.startsWith("REPLAY_"));
  const attempts = [];

  if (liveWorkflows.length) {
    const paris = tick.paris || toParisIso(tick.epochMs);
    const parisTime = paris.slice(11, 16);
    const session = args.session || (parisTime >= "15:30" ? "ny_open" : "asia_open");
    const tradingDate = args.trading_date || paris.slice(0, 10);
    const live = await store.claimNextLive({
      worker_id: args.worker_id,
      session,
      trading_date: tradingDate,
      lease_seconds: Math.min(args.lease_seconds || 660, 840),
    });
    attempts.push({ scope: "live", session, trading_date: tradingDate, status: live.status, reason: live.reason || null });
    if (live.status === "WORK_CLAIMED") return unifiedClaimResponse(live, args.worker_id);
  }

  if (replayWorkflows.length) {
    const replay = await store.claimNextReplay({
      worker_id: args.worker_id,
      workflows: replayWorkflows,
      backtest_id: args.backtest_id,
      lease_seconds: args.lease_seconds || 660,
    });
    attempts.push({ scope: "replay", status: replay.status, reason: replay.reason || null, backtest_id: args.backtest_id || null });
    if (replay.status === "WORK_CLAIMED") return unifiedClaimResponse(replay, args.worker_id);
  }

  return {
    ok: true,
    status: "NO_WORK",
    scope: liveWorkflows.length && replayWorkflows.length ? "all" : liveWorkflows.length ? "live" : "replay",
    reason: "no_fresh_work_due",
    attempts,
  };
}

function unifiedClaimResponse(result, workerId) {
  const isLive = result.scope === "live" || Boolean(result.claim_handle?.cursor_id);
  const executionPrompt = isLive
    ? String(result.execution_prompt || "")
      .replaceAll("heartbeat_live", "heartbeat_desk_work")
      .replaceAll("complete_live", "complete_desk_work")
      .replaceAll("fail_live", "fail_desk_work")
    : result.execution_prompt;
  return {
    ...result,
    claim_handle: {
      ...result.claim_handle,
      worker_id: workerId,
    },
    execution_prompt: executionPrompt,
    prompt_hash: executionPrompt
      ? createHash("sha256").update(executionPrompt).digest("hex")
      : result.prompt_hash,
    worker_api: {
      claim: "claim_next_desk_work",
      heartbeat: "heartbeat_desk_work",
      complete: "complete_desk_work",
      fail: "fail_desk_work",
    },
  };
}

function buildOrchestratedReplayState({ runs, selectedRun, steps, timeline, monitors, positions, setups = [], simulations, activeThesis, bundles, workItems = [] }) {
  const latestBundle = bundles[0]
    ? projectReplayBundle(bundles[0], { view: "compact", include_raw_refs: false, max_response_bytes: 120000 })
    : null;
  const currentStep = steps.find((step) => step.step_id === selectedRun.current_step_id) || steps.at(-1) || null;
  const projectedThesis = projectReplayActiveThesis(activeThesis, monitors);
  const replayContinuity = buildReplayContinuityState({
    run: selectedRun,
    currentStep,
    activeThesis: projectedThesis,
    setups,
    positions,
    monitors,
  });
  const cadenceRecommendation = recommendReplayCadenceMinutes({
    run: selectedRun,
    activeThesis: projectedThesis,
    setups,
    positions,
    monitors,
  });
  const eventCheckpoints = buildReplayEventCheckpoints({
    activeThesis: projectedThesis,
    latestMonitor: monitors[0] || null,
    run: selectedRun,
  });
  const currentWorkItem = workItems.find((item) => item.work_item_id === selectedRun.current_work_item_id)
    || workItems.find((item) => item.step_id === selectedRun.current_step_id && !["COMPLETED", "SUPERSEDED"].includes(item.status))
    || null;
  return {
    ok: true,
    mode: "replay",
    replay_mode: "orchestrated_gpt_in_the_loop",
    date: selectedRun.date || selectedRun.date_from || null,
    session: selectedRun.session,
    replay_time: selectedRun.current_replay_time,
    interval: selectedRun.cadence || selectedRun.monitor_cadence || "15m",
    recommended_replay_cadence: cadenceRecommendation,
    event_checkpoints: eventCheckpoints,
    status: selectedRun.status,
    current_step_id: selectedRun.current_step_id,
    current_step: currentStep,
    next_action: selectedRun.next_action || nextReplayAction(selectedRun.status),
    gpt_action_required: ["WAITING_GPT_MASTER", "WAITING_GPT_MONITOR"].includes(selectedRun.status),
    automation_enabled: selectedRun.automation_enabled === true,
    automation: {
      enabled: selectedRun.automation_enabled === true,
      mode: selectedRun.automation_mode || "manual",
      status: selectedRun.automation_status || (selectedRun.automation_enabled ? "running" : "paused"),
      current_work_item_id: currentWorkItem?.work_item_id || null,
      current_workflow: currentWorkItem?.workflow || null,
      work_status: currentWorkItem?.status || null,
      claimed_by: currentWorkItem?.claimed_by || null,
      lease_expires_at_utc: currentWorkItem?.lease_expires_at_utc || null,
      last_error: currentWorkItem?.last_error || selectedRun.last_automation_error || null,
    },
    current_work_item: currentWorkItem,
    work_queue: workItems,
    backtests: runs,
    selected_backtest: selectedRun,
    timeline,
    replay_timeline: timeline,
    replay_steps: steps,
    latest_bundle: latestBundle,
    current_step_bundle_status: latestBundle ? latestBundle.data_quality?.status || "ready" : "missing",
    latest_monitor: monitors[0] || null,
    replay_setups: setups,
    active_setup: replayContinuity.active_setup,
    armed_setup: replayContinuity.armed_setup,
    replay_continuity: replayContinuity,
    simulated_trades: simulations,
    simulated_position: replayContinuity.active_position || positions[0] || null,
    active_thesis: projectedThesis,
    conditions_go: projectedThesis?.wait_to_go_conditions || [],
    invalidations: projectedThesis?.invalidation_conditions || [],
    summary_stats: {
      steps_total: steps.length,
      steps_done: steps.filter((step) => ["MASTER_MATERIALIZED", "SIMULATION_UPDATED", "DONE"].includes(step.status)).length,
      monitors_saved: monitors.length,
      simulations: simulations.length,
    },
    audit: latestBundle?.anti_lookahead_policy || { compliant: true, cutoff_paris: selectedRun.current_replay_time },
    data_quality: latestBundle?.data_quality || { status: "missing", warnings: ["bundle_not_prepared"] },
  };
}

function selectBacktestCandidateSetups(docs, {
  date_from,
  date_to,
  session = "asia_open",
  instrument_mode = "auto",
  limit = 200,
} = {}) {
  const instrumentFilter = instrument_mode && instrument_mode !== "auto" ? instrument_mode : null;
  return (docs || [])
    .filter((setup) => !date_from || String(setup.date || "") >= date_from)
    .filter((setup) => !date_to || String(setup.date || "") <= date_to)
    .filter((setup) => !session || setup.session === session)
    .filter((setup) => !instrumentFilter || setup.instrument === instrumentFilter)
    .filter((setup) => setup.replayable === true || hasReplayGeometry(setup))
    .filter((setup) => setup.instrument !== "WAIT" && setup.direction !== "wait")
    .sort((left, right) => {
      const leftDate = String(left.date || left.saved_at || left.created_at || "");
      const rightDate = String(right.date || right.saved_at || right.created_at || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return Number(left.priority || 999) - Number(right.priority || 999);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)));
}

function buildBacktestRunDoc(args, setups, tick) {
  const backtest_id = args.backtest_id || stableVNextId("backtest", `${args.date_from}_${args.date_to}`, `${args.session || "asia_open"}_${tick.utc}`);
  return {
    backtest_id,
    label: args.label || `${args.date_from} -> ${args.date_to} ${args.session || "asia_open"}`,
    date_from: args.date_from,
    date_to: args.date_to,
    session: args.session || "asia_open",
    instrument_mode: args.instrument_mode || "auto",
    master_contract: args.master_contract || "4.0.0",
    monitor_contract: args.monitor_contract || "1.0.0",
    monitor_cadence: args.monitor_cadence || "1h",
    mode: args.mode || "backforward_strict",
    risk_model: args.risk_model || "0.5pct_fixed",
    status: setups.length ? "QUEUED" : "DONE",
    steps_total: setups.length,
    steps_done: 0,
    trades_count: 0,
    source_collection: COLLECTIONS.deskSetups,
    source_setup_ids: setups.map((setup) => setup.setup_record_id),
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function buildBacktestStepDoc(run, setup, index, tick) {
  const step_id = `${run.backtest_id}_step_${String(index + 1).padStart(4, "0")}_${sanitizeId(setup.setup_record_id)}`;
  return {
    step_id,
    backtest_id: run.backtest_id,
    sequence: index + 1,
    status: "QUEUED",
    job_type: "SIMULATE_TRADE",
    task_type: "SIMULATE_TRADE",
    date: setup.date || null,
    session: setup.session || run.session,
    instrument: setup.instrument || null,
    direction: setup.direction || null,
    source_setup_id: setup.setup_record_id,
    source_setup_ref: { collection: COLLECTIONS.deskSetups, document_id: setup.setup_record_id },
    input_ref: { collection: COLLECTIONS.deskSetups, document_id: setup.setup_record_id },
    output_ref: null,
    pack_id: setup.pack_id || null,
    analysis_id: setup.analysis_id || null,
    decision_id: setup.decision_id || null,
    timestamp_paris: setup.created_at_paris || setup.saved_at_paris || tick.paris,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function markBacktestStepRunning(step, tick) {
  return {
    ...step,
    status: "RUNNING",
    started_at: tick.utc,
    started_at_utc: tick.utc,
    started_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function markBacktestStepDone(step, { output_ref, replay }, tick) {
  return {
    ...step,
    status: "DONE",
    output_ref,
    replay_status: replay?.replay_status || null,
    r_result: replay?.r_result ?? null,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function markBacktestStepFailed(step, error, tick) {
  return {
    ...step,
    status: "FAILED",
    error: publicReplayError(error),
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function simulatedTradeFromReplay({ replay, run, step, setup, tick }) {
  const trade_id = `${run.backtest_id}_${sanitizeId(step.source_setup_id)}_${sanitizeId(replay.replay_id || replay.content_hash || tick.utc)}`;
  return {
    trade_id,
    backtest_id: run.backtest_id,
    step_id: step.step_id,
    setup_record_id: setup.setup_record_id,
    setup_id: setup.setup_id || null,
    analysis_id: setup.analysis_id || null,
    decision_id: setup.decision_id || null,
    pack_id: setup.pack_id || null,
    date: setup.date || step.date || null,
    session: setup.session || run.session,
    instrument: setup.instrument || replay.instrument || null,
    direction: setup.direction || replay.direction || null,
    status: replayOutcomeToTradeOutcome(replay),
    replay_status: replay.replay_status || null,
    outcome: replay.outcome || null,
    outcome_status: replay.outcome_status || null,
    r_result: Number.isFinite(Number(replay.r_result)) ? roundNumber(Number(replay.r_result), 4) : null,
    max_favorable_r: Number.isFinite(Number(replay.max_favorable_r)) ? roundNumber(Number(replay.max_favorable_r), 4) : null,
    entry_price: replay.entry?.price ?? replay.plan?.entry_price ?? null,
    entry_time: replay.entry?.time ?? null,
    exit_price: replay.exit?.price ?? replay.evidence?.exit_price ?? null,
    exit_time: replay.exit?.time ?? replay.evidence?.exit_timestamp ?? null,
    reason: replay.reason || null,
    content_hash: replay.content_hash || null,
    replay,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function replayOutcomeToTradeOutcome(replay) {
  const status = String(replay?.replay_status || "");
  if (status === "win") return "WIN";
  if (status === "loss") return "LOSS";
  if (status === "no_fill") return "NO_FILL";
  if (status === "wait") return "WAIT";
  if (["no_data", "not_replayable", "rejected", "review_required"].includes(status)) return "REVIEW";
  return "OPEN_OR_EXPIRED";
}

function updateBacktestProgress(run, steps, trades, tick) {
  const steps_done = (steps || []).filter((step) => ["DONE", "FAILED"].includes(step.status)).length;
  const hasFailed = (steps || []).some((step) => step.status === "FAILED");
  const allDone = Number(run.steps_total || 0) > 0 && steps_done >= Number(run.steps_total || 0);
  const summary = allDone || hasFailed ? summarizeBacktestTrades(trades, { backtest_id: run.backtest_id, tick }) : run.summary || null;
  return {
    ...run,
    status: hasFailed ? "FAILED" : allDone ? "DONE" : "RUNNING",
    steps_done,
    trades_count: (trades || []).length,
    summary,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function finalizeBacktestRun(run, steps, trades, tick) {
  const summary = summarizeBacktestTrades(trades, { backtest_id: run.backtest_id, tick });
  return {
    ...run,
    status: (steps || []).some((step) => step.status === "FAILED") ? "FAILED" : "DONE",
    steps_done: (steps || []).filter((step) => ["DONE", "FAILED"].includes(step.status)).length,
    trades_count: (trades || []).length,
    summary,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
  };
}

function summarizeBacktestTrades(trades, { backtest_id, tick } = {}) {
  const list = trades || [];
  const numericResults = list.map((trade) => Number(trade.r_result)).filter(Number.isFinite);
  const total_r = roundNumber(numericResults.reduce((sum, value) => sum + value, 0), 4);
  const wins = list.filter((trade) => Number(trade.r_result) > 0).length;
  const losses = list.filter((trade) => Number(trade.r_result) < 0).length;
  const no_fills = list.filter((trade) => trade.status === "NO_FILL" || trade.replay_status === "no_fill").length;
  const inferredBacktestId = backtest_id || list[0]?.backtest_id || null;
  const updated = tick || new SystemClock().now();
  return {
    result_id: inferredBacktestId ? `${inferredBacktestId}_summary` : null,
    backtest_id: inferredBacktestId,
    trades: list.length,
    wins,
    losses,
    no_fills,
    total_r,
    avg_r: numericResults.length ? roundNumber(total_r / numericResults.length, 4) : 0,
    win_rate: list.length ? roundNumber(wins / list.length, 4) : null,
    summary_stats: {
      total_r,
      trades: list.length,
      win_rate: list.length ? roundNumber(wins / list.length, 4) : null,
    },
    updated_at: updated.utc,
    updated_at_utc: updated.utc,
    updated_at_paris: updated.paris,
  };
}

function selectBacktests(docs, { date_from, date_to, session, status, limit = 50 } = {}) {
  const backtests = (docs || [])
    .filter((run) => !date_from || String(run.date_to || run.date_from || "") >= date_from)
    .filter((run) => !date_to || String(run.date_from || run.date_to || "") <= date_to)
    .filter((run) => !session || run.session === session)
    .filter((run) => !status || run.status === status)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  return { ok: true, count: backtests.length, backtests };
}

function selectBacktest(backtests, backtestId) {
  if (backtestId) {
    return (backtests || []).find((run) => run.backtest_id === backtestId) || null;
  }
  return (backtests || [])[0] || null;
}

function selectBacktestSteps(docs, backtestId) {
  return (docs || [])
    .filter((step) => step.backtest_id === backtestId)
    .sort((left, right) => String(left.timestamp_paris || left.created_at || "").localeCompare(String(right.timestamp_paris || right.created_at || "")));
}

function selectSimulatedTrades(docs, backtestId) {
  return (docs || [])
    .filter((trade) => trade.backtest_id === backtestId)
    .sort((left, right) => String(left.trigger_time || left.created_at || "").localeCompare(String(right.trigger_time || right.created_at || "")));
}

function selectBacktestResults(docs, backtestId) {
  return (docs || [])
    .filter((result) => result.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
}

function summarizeReplayState(backtest, trades, results) {
  const latestResult = results[0] || null;
  if (latestResult?.summary_stats) {
    return latestResult.summary_stats;
  }
  const totalR = (trades || []).reduce((sum, trade) => sum + (Number(trade.r_result) || 0), 0);
  const wins = (trades || []).filter((trade) => Number(trade.r_result) > 0).length;
  return {
    total_r: backtest?.result?.total_r ?? backtest?.summary?.total_r ?? totalR,
    trades: backtest?.result?.trades ?? trades.length,
    win_rate: trades.length ? wins / trades.length : backtest?.result?.win_rate ?? null,
  };
}


function rawWindowQuality(rows, { reason, attempted_raw_refs = [] } = {}) {
  const rowCount = rows?.length || 0;
  return {
    status: rowCount ? "ready" : "missing",
    execution_allowed: rowCount > 0,
    row_count: rowCount,
    missing_reason: rowCount ? null : reason,
    attempted_raw_refs,
    raw_refs_available: rowCount > 0,
  };
}

function assertRawWindowQuery(args, query, run = null) {
  const fromMs = Date.parse(args.from);
  const toMs = Date.parse(args.to);
  const asOfMs = Date.parse(query.as_of_utc);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw deskError("INVALID_SCOPE", "Raw-window bounds must be valid and ordered.", { from: args.from, to: args.to });
  }
  if (toMs > asOfMs) {
    throw deskError("LOOKAHEAD_DETECTED", "Raw-window end exceeds as_of_utc.", { to: args.to, as_of_utc: query.as_of_utc });
  }
  if (run) {
    const runClockMs = Date.parse(run.current_replay_time || run.cutoff_utc);
    if (Number.isFinite(runClockMs) && toMs > runClockMs) {
      throw deskError("CLOCK_LIMIT_EXCEEDED", "Raw-window end exceeds the replay clock.", {
        to: args.to,
        current_replay_time: run.current_replay_time || null,
      });
    }
    if (args.pack_id !== run.pack_id || args.pack_build_id !== run.pack_build_id) {
      throw deskError("PACK_BUILD_MISMATCH", "Raw-window pack does not match the replay-pinned build.", {
        expected_pack_id: run.pack_id,
        actual_pack_id: args.pack_id || null,
        expected_pack_build_id: run.pack_build_id,
        actual_pack_build_id: args.pack_build_id || null,
      });
    }
  }
  return true;
}

async function buildScopedPackRawWindow(store, args, query, run = null) {
  const pack = await store.getDeskPack({
    pack_id: args.pack_id,
    pack_build_id: args.pack_build_id,
    mode: query.mode,
  });
  if (!pack.pack_build_id) {
    throw deskError("PACK_BUILD_NOT_READY", "Operational raw windows require an immutable V2 pack build.", { pack_id: args.pack_id });
  }
  if (run) assertRunPackScope(run, pack);
  const timeframe = canonicalTimeframe(args.timeframe);
  const candidates = rawWindowDatasetCandidates(args.instrument, timeframe);
  const selectedDataset = candidates.find((dataset) => DATASETS.includes(dataset) && datasetRef(pack, dataset));
  if (!selectedDataset) {
    throw deskError("DATASET_NOT_FOUND", "No immutable dataset can satisfy this raw-window request.", {
      pack_id: pack.pack_id,
      pack_build_id: pack.pack_build_id,
      instrument: args.instrument,
      timeframe,
      attempted_datasets: candidates,
    });
  }
  const dataset = await store.getDataset({
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    dataset: selectedDataset,
    as_of_utc: query.as_of_utc,
    mode: query.mode,
    format: "json",
    max_rows: Number.MAX_SAFE_INTEGER,
  });
  const ref = datasetRef(pack, selectedDataset);
  const sourceRows = (dataset.rows || []).filter((row) => rowMatchesInstrument(row, args.instrument, selectedDataset));
  const normalized = normalizeFeatureRows(sourceRows, {
    instrument: args.instrument,
    timeframe: datasetTimeframe(selectedDataset, timeframe),
    rawRef: ref.object_path || ref.storage_path || null,
  });
  const direct = normalized.filter((row) => canonicalTimeframe(row.timeframe) === timeframe);
  const baseRows = direct.length ? direct : normalized.filter((row) => canonicalTimeframe(row.timeframe) === "5");
  const derived = direct.length || timeframe === "5" ? baseRows : resampleRows(baseRows, timeframe);
  const rows = filterRawWindowRows(derived, args).slice(0, Math.max(1, Math.min(Number(args.max_rows) || 500, 5000)));
  const objectRef = {
    dataset: selectedDataset,
    object_path: ref.object_path || ref.storage_path || null,
    gcs_generation: ref.gcs_generation || null,
    sha256: ref.sha256 || null,
  };
  const resolved_scope = run
    ? { ...(run.resolved_scope || {}), run_id: query.run_id, as_of_utc: query.as_of_utc }
    : operationalQueryScope(query);
  return {
    ok: rows.length > 0,
    status: rows.length ? "ready" : "missing",
    source: direct.length || timeframe === "5" ? "immutable_pack_dataset" : `derived_from_${datasetTimeframe(selectedDataset, "5")}`,
    strategy_id: query.strategy_id,
    session: query.session,
    mode: query.mode,
    trading_date: query.trading_date,
    run_id: query.run_id,
    backtest_id: query.backtest_id || null,
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    resolved_scope,
    scope_hash: run?.scope_hash || resolved_scope.scope_hash || null,
    as_of_utc: query.as_of_utc,
    instrument: args.instrument,
    symbol: marketFeedSymbol(args.instrument),
    timeframe,
    from: args.from,
    to: args.to,
    row_count: rows.length,
    rows,
    integrity: dataset.integrity,
    raw_ref: objectRef,
    raw_refs: [objectRef],
    attempted_raw_refs: candidates,
    missing_reason: rows.length ? null : "immutable_pack_dataset_has_no_rows_in_window",
    data_quality: rawWindowQuality(rows, {
      reason: "immutable_pack_dataset_has_no_rows_in_window",
      attempted_raw_refs: candidates,
    }),
    anti_lookahead_compliant: true,
    computed_with_cutoff: query.as_of_utc,
  };
}

function rawWindowDatasetCandidates(instrument, timeframe) {
  const exact = featureDatasetCandidates(instrument)[timeframe] || [];
  const m5 = featureDatasetCandidates(instrument)["5"] || [];
  const combined = [];
  if (["DXY", "VIX", "GC", "CL"].includes(instrument)) {
    combined.push(timeframe === "4H" ? "DXY_CL_GC_VIX_H4" : "DXY_CL_GC_VIX");
  }
  if (["US10Y", "US02Y"].includes(instrument)) {
    combined.push(timeframe === "4H" ? "US10Y_US02Y_H4" : "US10Y_US02Y");
  }
  return dedupeBy([...exact, ...combined, ...m5], (item) => item);
}

function rowMatchesInstrument(row, instrument, dataset) {
  const actual = String(row.asset || row.instrument || row.symbol || "").toUpperCase().replace("1!", "");
  const expected = String(instrument || "").toUpperCase().replace("1!", "");
  if (!actual) return String(dataset).startsWith(expected);
  return actual === expected;
}

function datasetTimeframe(dataset, fallback) {
  const match = String(dataset || "").toUpperCase().match(/_(M5|M15|H1|H4)$/);
  return match ? canonicalTimeframe(match[1]) : canonicalTimeframe(fallback);
}

function filterRawWindowRows(rows, { from, to }) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return (rows || [])
    .filter((row) => {
      const rowMs = Date.parse(row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time);
      if (!Number.isFinite(rowMs)) return false;
      if (Number.isFinite(fromMs) && rowMs < fromMs) return false;
      if (Number.isFinite(toMs) && rowMs > toMs) return false;
      return true;
    })
    .sort((left, right) => String(left.timestamp_utc || left.timestamp_paris).localeCompare(String(right.timestamp_utc || right.timestamp_paris)));
}

function marketFeedSymbol(instrument) {
  const mapping = {
    MNQ: "MNQ1!",
    MES: "MES1!",
    NQ: "NQ1!",
    ES: "ES1!",
    GC: "GC1!",
    CL: "CL1!",
    DXY: "DXY",
    VIX: "VIX",
    US10Y: "US10Y",
    US02Y: "US02Y",
  };
  return mapping[instrument] || instrument;
}

function marketFeedCandidates(instrument, timeframe) {
  const symbol = marketFeedSymbol(instrument);
  const cleanSymbol = symbol.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tf = canonicalTimeframe(timeframe);
  const readableTf = { "5": "M5", "15": "M15", "1H": "H1", "4H": "H4" }[tf] || tf;
  return dedupeBy([
    writerDocumentId("prod", "tradingview", symbol, tf),
    writerDocumentId("prod", "tradingview", symbol, readableTf),
    safeDocId("prod", "tradingview", symbol, tf),
    safeDocId("prod", "tradingview", symbol, readableTf),
    writerDocumentId("tradingview", symbol, tf),
    writerDocumentId("tradingview", symbol, readableTf),
    safeDocId("tradingview", symbol, tf),
    safeDocId("tradingview", symbol, readableTf),
    `${cleanSymbol}_${tf}`,
    `${cleanSymbol}_${readableTf}`,
    `${symbol}_${tf}`,
    `${symbol}_${readableTf}`,
  ], (item) => item);
}

function writerDocumentId(...parts) {
  return parts.map((part) => {
    const text = String(part ?? "").trim()
      .replaceAll("/", "_")
      .replaceAll("\\", "_")
      .replaceAll(" ", "_");
    return text || "_";
  }).join("__");
}

function canonicalTimeframe(value) {
  const text = String(value || "").trim().toUpperCase();
  return {
    M1: "1",
    "1M": "1",
    "1": "1",
    M5: "5",
    "5M": "5",
    "5": "5",
    M15: "15",
    "15M": "15",
    "15": "15",
    H1: "1H",
    "1H": "1H",
    "60": "1H",
    H4: "4H",
    "4H": "4H",
    "240": "4H",
  }[text] || text;
}

function timeframeMinutes(timeframe) {
  return {
    "1": 1,
    "5": 5,
    "15": 15,
    "1H": 60,
    "4H": 240,
  }[canonicalTimeframe(timeframe)] || 5;
}

function resampleRows(rows, targetTimeframe) {
  const bucketMs = timeframeMinutes(targetTimeframe) * 60 * 1000;
  const buckets = new Map();
  for (const row of rows || []) {
    const epochMs = Date.parse(row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time);
    if (!Number.isFinite(epochMs)) continue;
    const bucketStart = Math.floor(epochMs / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStart) || [];
    bucket.push(row);
    buckets.set(bucketStart, bucket);
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).map(([bucketStart, bucket]) => {
    const sorted = bucket.slice().sort((left, right) => String(left.timestamp_utc || left.timestamp_paris).localeCompare(String(right.timestamp_utc || right.timestamp_paris)));
    const first = sorted[0];
    const last = sorted.at(-1);
    const high = maxBy(sorted, (row) => numeric(row.high, Number.NEGATIVE_INFINITY));
    const low = maxBy(sorted, (row) => -numeric(row.low, Number.POSITIVE_INFINITY));
    return {
      ...last,
      timeframe: canonicalTimeframe(targetTimeframe),
      timestamp_utc: normalizeUtcIso(new Date(bucketStart).toISOString()),
      timestamp_paris: toParisIso(bucketStart),
      open: first.open,
      high: high?.high ?? null,
      low: low?.low ?? null,
      close: last.close,
      volume: sorted.reduce((sum, row) => sum + numeric(row.volume, 0), 0),
      source: `derived_from_${canonicalTimeframe(first.timeframe || "5")}`,
      derived_from_timeframe: canonicalTimeframe(first.timeframe || "5"),
      raw_refs: dedupeBy(sorted.flatMap((row) => row.raw_refs || (row.raw_ref ? [row.raw_ref] : [])), (item) => item),
    };
  });
}

function safeDocId(...parts) {
  return parts.map((part) => {
    const text = String(part ?? "").trim()
      .replaceAll("/", "_")
      .replaceAll("\\", "_")
      .replaceAll(" ", "_")
      .replaceAll("!", "_")
      .replaceAll(":", "_");
    return text || "_";
  }).join("__");
}


async function buildMasterCutoffBundle(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const resolvedScope = resolveOperationalReadScope(args);
  const cutoff = args.cutoff_paris || resolvedScope.cutoff_paris;
  if (Date.parse(cutoff) !== Date.parse(resolvedScope.as_of_utc)) {
    throw deskError("INVALID_SCOPE", "cutoff_paris and as_of_utc must identify the same instant.", {
      cutoff_paris: cutoff,
      as_of_utc: resolvedScope.as_of_utc,
    });
  }
  const date = resolvedScope.trading_date;
  const session = resolvedScope.session;
  const mode = resolvedScope.mode;
  const timezone = resolvedScope.timezone;
  const instruments = args.instruments?.length ? args.instruments : ["MNQ", "MES", "NQ", "ES"];
  const contracts = await safeRead(store.getActiveContracts(), {});
  const contract_context = contractContext(contracts, "master", { tick, pinnedForReplay: false });
  const pack = args.pack_id
    ? await safeRead(store.getDeskPack({ pack_id: args.pack_id, mode, include_draft: false }), null)
    : await resolvePackForState(store, { date, session, timezone });
  const macro_calendar = pack
    ? await safeRead(store.getMacroCalendar({ pack_id: pack.pack_id, pack_build_id: pack.pack_build_id, date, as_of_utc: resolvedScope.as_of_utc, mode }), { warning: "macro_calendar_not_available", events: [] })
    : { warning: "pack_not_found_for_macro_calendar", events: [] };
  const news_digest = pack
    ? await safeRead(store.getNewsDigest({ pack_id: pack.pack_id, pack_build_id: pack.pack_build_id, date, session, as_of_utc: resolvedScope.as_of_utc, mode }), { warning: "news_digest_not_available", items: [] })
    : { warning: "pack_not_found_for_news_digest", items: [], status: "missing", reason: "source_not_configured_or_pack_missing" };
  const selector = operationalSelectorArgs(resolvedScope);
  const latest_master_analysis = await safeRead(store.getLatestMasterAnalysis(selector).then((result) => result.analysis), null);
  const active_thesis = latest_master_analysis?.analysis_id
    ? await safeRead(store.getActiveThesis({ ...selector, master_id: latest_master_analysis.analysis_id, status: "active" }).then((result) => result.active_thesis), null)
    : null;
  const raw_scope = pack ? { ...selector, timezone, pack_id: pack.pack_id, pack_build_id: pack.pack_build_id } : null;
  const futures_core = await buildMasterCutoffRawWindows(store, { cutoff, instruments, raw_scope });
  const cross_asset = await buildCrossAssetRawWindows(store, { cutoff, raw_scope });
  const rolling = pack
    ? await buildPinnedReplaySnapshots(store, {
        run_id: resolvedScope.run_id,
        strategy_id: resolvedScope.strategy_id,
        scope_hash: resolvedScope.scope_hash,
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        date,
        session,
      }, pack, cutoff, args.include_raw_refs !== false, mode)
    : await buildRollingSnapshots(store, {
        date,
        session,
        timestamp_paris: cutoff,
        instrument: instruments[0] || "MNQ",
        include_raw_refs: args.include_raw_refs !== false,
        raw_scope,
      });
  const features = await readFeatureContext(store, { date, session, activeThesis: active_thesis, latestMaster: latest_master_analysis, timestamp_paris: cutoff });
  const cross_delta = await safeRead(store.ensureCrossAssetDelta({ timestamp_paris: cutoff, window: crossAssetWindowForSession(session, cutoff), save: args.save !== false, raw_scope }), { status: "missing", delta: null, stale_check: { is_stale: true, execution_allowed: false, reason: "cross_asset_delta_missing" } });
  const raw_refs = dedupeBy([
    ...Object.values(futures_core).flatMap((item) => item.raw_refs || []),
    ...Object.values(cross_asset).flatMap((item) => item.raw_refs || []),
    ...(args.include_raw_refs === false ? [] : rolling.raw_refs || []),
  ], (item) => item);
  const data_quality = masterCutoffDataQuality({
    pack,
    futures_core,
    cross_asset,
    rolling,
    cross_delta,
    macro_calendar,
    news_digest,
  });
  const bundle_id = masterCutoffBundleId({ date, session, cutoff_paris: cutoff, mode });
  const base = {
    ok: data_quality.status !== "failed",
    status: data_quality.status,
    bundle_id,
    bundle_type: "master_cutoff",
    date,
    trading_date: date,
    strategy_id: resolvedScope.strategy_id,
    run_id: resolvedScope.run_id,
    session,
    cutoff_paris: cutoff,
    timestamp_paris: cutoff,
    timestamp_utc: normalizeUtcIso(cutoff),
    mode,
    timezone,
    as_of_utc: resolvedScope.as_of_utc,
    resolved_scope: resolvedScope,
    scope_hash: resolvedScope.scope_hash,
    pack_build_id: pack?.pack_build_id || null,
    source_manifest_hash: pack?.source_manifest_hash || pack?.manifest?.source_manifest_hash || null,
    contract_context,
    contract_handshake: contractHandshake("master_cutoff", contract_context, {
      saveTool: "save_master_analysis",
      backtestId: args.backtest_id || null,
    }),
    pack_or_source_context: {
      status: pack ? "ready" : "missing",
      pack: pack ? compactPack(pack) : null,
      fallback: false,
      execution_allowed: Boolean(pack),
      missing_reason: pack ? null : `pack_not_found:${date}:${session}`,
    },
    latest_master_analysis,
    active_thesis,
    macro_calendar,
    macro_horizon: buildMacroHorizon({ timestamp_paris: cutoff, macro_calendar }),
    news_digest,
    futures_core,
    cross_asset,
    indices_global: Object.fromEntries(["NI225", "HSI", "DAX", "SX5E"].map((instrument) => [instrument, rolling.market_availability?.instruments?.[instrument] || null])),
    mega_caps_semis: rolling.market_availability?.tech_gap_context || {},
    market_availability: rolling.market_availability || null,
    rolling_snapshots: rolling.snapshots,
    rolling_15m_snapshot: rolling.snapshots["15m"] || null,
    rolling_1h_snapshot: rolling.snapshots["1h"] || null,
    rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    level_map: features.level?.level_map || null,
    technical_events: features.technical?.events || [],
    cross_asset_delta: cross_delta.delta || null,
    cross_asset_stale_check: cross_delta.stale_check || null,
    data_quality,
    anti_lookahead_policy: {
      cutoff_paris: cutoff,
      max_price_timestamp_used: maxMasterRawTimestamp({ futures_core, cross_asset, rolling }),
      max_macro_timestamp_used: maxTimestamp(macro_calendar.events || [], ["published_at_paris", "timestamp_paris", "time_paris", "scheduled_at_paris"]),
      actual_j_jplus1_hidden: true,
      actual_j_jplus1_visibility_rule: "actuals_visible_when_published_lte_cutoff_else_hidden",
      macro_actuals_visible_until_cutoff: true,
      macro_actuals_after_cutoff_hidden: true,
      compliant: true,
      fallback_used: false,
    },
    chatgpt_master_instructions: {
      required_mode: "live_master_cutoff",
      required_first_tool: "get_active_contracts",
      required_bundle_tool: "get_master_cutoff_bundle",
      save_tool: "save_master_analysis",
      source_coverage_rule: "The immutable active live pack must cover as_of_utc. Never reuse an earlier decision-cutoff build for a later revalidation.",
      market_availability_rule: "Only missing_unexpected is a feed failure. stale_market_closed and not_yet_open are normal session states and do not justify DATA_NOT_READY by themselves.",
      stale_context_rule: "Use last_known/H4 only for regime context, never as a fresh trigger.",
      tech_gap_rule: "A not_yet_open tech gap is not applicable until a current-session quote exists.",
      vix_rule: "Cash VIX may be closed; report fresh confirmation as unavailable without treating the source as broken.",
      save_scope_rule: "Start from save_target.suggested_payload and preserve its identifiers, operational scope, pack_build_id and contract handshake.",
    },
    raw_refs,
    save_target: {
      tool: "save_master_analysis",
      collection: COLLECTIONS.deskMasterAnalyses,
      suggested_payload: {
        ...contractSavePayload(contract_context),
        bundle_id,
        strategy_id: resolvedScope.strategy_id,
        date,
        trading_date: date,
        session,
        run_id: resolvedScope.run_id,
        as_of_utc: resolvedScope.as_of_utc,
        timezone,
        pack_id: pack?.pack_id || null,
        pack_build_id: pack?.pack_build_id || null,
        created_at_paris: cutoff,
        mode,
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  const withHash = { ...base, source_hash: hashObject(sourceHashPayload(base)) };
  return {
    ...withHash,
    data_quality_audit: buildBundleDataQualityAudit({
      bundle_id,
      data_quality,
      checkpoint_paris: cutoff,
      source_hash: withHash.source_hash,
      tick,
    }),
  };
}


async function buildManualMonitorBundle(store, args = {}, clock = new SystemClock()) {
  const tick = clock.now();
  const resolvedScope = resolveOperationalReadScope(args, { requireMaster: true, requireThesis: true });
  const checkpoint = manualMonitorCheckpoint(args, tick);
  if (Date.parse(checkpoint.timestamp_paris) !== Date.parse(resolvedScope.as_of_utc)) {
    throw deskError("INVALID_SCOPE", "Monitor checkpoint and as_of_utc must identify the same instant.", {
      timestamp_paris: checkpoint.timestamp_paris,
      as_of_utc: resolvedScope.as_of_utc,
    });
  }
  const date = resolvedScope.trading_date;
  const session = resolvedScope.session;
  const mode = resolvedScope.mode;
  const timezone = resolvedScope.timezone;
  const contracts = await safeRead(store.getActiveContracts(), {});
  const contract_context = contractContext(contracts, "monitor", { tick, pinnedForReplay: false });
  const pack = args.pack_id
    ? await safeRead(store.getDeskPack({ pack_id: args.pack_id, mode, include_draft: false }), null)
    : await resolvePackForState(store, { date, session, timezone });
  const context = await resolveMonitorContext(store, args);
  const activeThesis = context.activeThesis;
  const latestMaster = context.latestMaster;
  const latestMonitor = await safeRead(getLatestOperationalMonitor(store, {
    ...operationalSelectorArgs(resolvedScope),
    thesis_id: activeThesis.thesis_id,
    master_id: latestMaster.analysis_id,
    limit: 1,
  }).then((result) => result.latest_monitor), null);
  const previousManualMonitor = activeThesis?.thesis_id || args.bundle_id
    ? await safeRead(store.getLatestManualMonitor({ thesis_id: activeThesis?.thesis_id, limit: 1 }).then((result) => result.latest_monitor), null)
    : null;
  const macro_calendar = pack
    ? await safeRead(store.getMacroCalendar({ pack_id: pack.pack_id, pack_build_id: pack.pack_build_id, date, as_of_utc: resolvedScope.as_of_utc, mode }), { warning: "macro_calendar_not_available", events: [] })
    : { warning: "pack_not_found_for_macro_calendar", events: [] };
  const news_digest = pack
    ? await safeRead(store.getNewsDigest({ pack_id: pack.pack_id, pack_build_id: pack.pack_build_id, date, session, as_of_utc: resolvedScope.as_of_utc, mode }), { warning: "news_digest_not_available", items: [] })
    : { warning: "pack_not_found_for_news_digest", items: [] };
  const features = await readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris: checkpoint.timestamp_paris });
  const raw_scope = pack ? {
    ...operationalSelectorArgs(resolvedScope),
    timezone,
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
  } : null;
  const rolling = pack
    ? await buildPinnedReplaySnapshots(store, {
        run_id: resolvedScope.run_id,
        strategy_id: resolvedScope.strategy_id,
        scope_hash: resolvedScope.scope_hash,
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        date,
        session,
      }, pack, checkpoint.timestamp_paris, args.include_raw_refs !== false, mode)
    : await buildRollingSnapshots(store, {
        date,
        session,
        timestamp_paris: checkpoint.timestamp_paris,
        instrument: featureInstrument(activeThesis, latestMaster),
        include_raw_refs: args.include_raw_refs !== false,
        raw_scope,
      });
  const data_quality = manualBundleDataQuality({
    pack,
    activeThesis,
    latestMaster,
    macro_calendar,
    news_digest,
    features,
    rolling,
  });
  const bundle_id = manualMonitorBundleId({ session, mode, checkpoint });
  const catchup_context = args.catchup_mode === true ? args.catchup_context || null : null;
  const base = {
    ok: true,
    contract_name: "DeskManualMonitorBundle",
    schema_version: "1.0.0",
    contract_context,
    contract_handshake: contractHandshake("manual_m15_monitor", contract_context, {
      saveTool: "save_manual_monitor",
    }),
    bundle_id,
    strategy_id: resolvedScope.strategy_id,
    trading_date: resolvedScope.trading_date,
    run_id: resolvedScope.run_id,
    session,
    date,
    timestamp_paris: checkpoint.timestamp_paris,
    cadence: checkpoint.cadence,
    mode,
    timezone,
    as_of_utc: resolvedScope.as_of_utc,
    catchup_context,
    resolved_scope: resolvedScope,
    scope_hash: resolvedScope.scope_hash,
    pack_build_id: pack?.pack_build_id || null,
    source_manifest_hash: pack?.source_manifest_hash || pack?.manifest?.source_manifest_hash || null,
    policy: {
      backend_role: "prepare_data_only",
      chatgpt_decides_on_go_monitor: true,
      automatic_openai_api_decision: false,
      no_double_raw_ohlc_base: true,
      catchup_mode: Boolean(catchup_context),
    },
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    pack: pack ? compactPack(pack) : null,
    active_thesis: activeThesis,
    thesis_context_source: context.source,
    latest_master_analysis: latestMaster,
    candidate_setups: context.candidateSetups,
    latest_monitor: latestMonitor,
    previous_manual_monitor: previousManualMonitor,
    macro_calendar,
    news_digest,
    features: {
      level_map: features.level?.level_map || null,
      technical_events: features.technical?.events || [],
      cross_asset_delta: features.cross?.delta || null,
      cross_asset_stale_check: features.cross?.stale_check || null,
      condition_status: features.condition?.condition_status || null,
      session_snapshot: features.snapshot?.session_snapshot || null,
    },
    rolling_snapshots: rolling.snapshots,
    market_availability: rolling.market_availability || null,
    rolling_15m_snapshot: rolling.snapshots["15m"] || null,
    rolling_1h_snapshot: rolling.snapshots["1h"] || null,
    rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    raw_refs: args.include_raw_refs === false ? [] : rolling.raw_refs,
    data_quality,
    data_quality_audit: {
      audit_id: stableVNextId("data_quality", bundle_id, checkpoint.timestamp_paris),
      bundle_id,
      status: data_quality.status,
      execution_allowed: data_quality.execution_allowed,
      blockers: data_quality.blockers,
      missing: data_quality.missing,
      stale: data_quality.stale,
      warnings: data_quality.warnings,
      explicit_missing_data: data_quality.explicit_missing_data,
      anti_lookahead_compliant: data_quality.anti_lookahead_compliant,
      raw_refs_available: data_quality.raw_refs_available,
      checkpoint_paris: checkpoint.timestamp_paris,
      created_at: tick.utc,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    },
    chatgpt_manual_monitor_instructions: {
      required_mode: "manual_chatgpt_m15_monitor",
      final_report_required_sections: ["Decision executable", "Regle finale"],
      save_tool: "save_manual_monitor",
      required_payload_keys: ["contract_name", "schema_version", "contract_hash", "timestamp_paris", "monitor_decision"],
      contract_handshake: contractHandshake("manual_m15_monitor", contract_context, {
        saveTool: "save_manual_monitor",
      }),
      decision_boundary: "ChatGPT decides after the operator launches the monitor; backend never auto-decides in V1.",
      market_availability_rule: "Only missing_unexpected is a feed failure. stale_market_closed and not_yet_open are normal session states and do not justify DATA_NOT_READY by themselves.",
      stale_context_rule: "Use last_known/H4 only for regime context, never as a fresh trigger.",
      tech_gap_rule: "A not_yet_open tech gap is not applicable until a current-session quote exists.",
      vix_rule: "Cash VIX may be closed; report fresh confirmation as unavailable without treating the source as broken.",
    },
    save_target: {
      tool: "save_manual_monitor",
      collection: COLLECTIONS.deskManualMonitors,
      suggested_payload: {
        ...contractSavePayload(contract_context),
        bundle_id,
        linked_active_thesis_id: activeThesis?.thesis_id || null,
        linked_master_analysis_id: latestMaster?.analysis_id || null,
        pack_id: pack?.pack_id || null,
        pack_build_id: pack?.pack_build_id || null,
        strategy_id: resolvedScope.strategy_id,
        trading_date: resolvedScope.trading_date,
        run_id: resolvedScope.run_id,
        session,
        timestamp_paris: checkpoint.timestamp_paris,
        as_of_utc: resolvedScope.as_of_utc,
        cadence: checkpoint.cadence,
        mode,
        status: "SAVED",
        ...(catchup_context ? { catchup_context } : {}),
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return { ...base, source_hash: hashObject(sourceHashPayload(base)) };
}

async function resolveMonitorContext(store, args = {}) {
  const queryScope = resolveOperationalReadScope(args, { requireMaster: true, requireThesis: true });
  const query = operationalSelectorArgs(queryScope);
  const latestMaster = await store.getLatestMasterAnalysis({ ...query, master_id: args.master_id }).then((result) => result.analysis);
  if (!latestMaster || latestMaster.analysis_id !== args.master_id) {
    throw deskError("MASTER_SCOPE_MISMATCH", "The requested Master does not exist in the exact monitor scope.", {
      master_id: args.master_id,
      resolved_master_id: latestMaster?.analysis_id || null,
      resolved_scope: queryScope,
    });
  }
  assertOperationalDocumentScope(latestMaster, queryScope, "MASTER_SCOPE_MISMATCH");

  const thesisResult = await store.getActiveThesis({
    ...query,
    master_id: args.master_id,
    status: "any",
  });
  const activeThesis = (thesisResult.theses || []).find((thesis) => thesis.thesis_id === args.thesis_id) || null;
  if (!activeThesis) {
    throw deskError("THESIS_SCOPE_MISMATCH", "The requested thesis does not exist in the exact monitor scope.", {
      thesis_id: args.thesis_id,
      master_id: args.master_id,
      resolved_scope: queryScope,
    });
  }
  assertOperationalDocumentScope(activeThesis, queryScope, "THESIS_SCOPE_MISMATCH");
  if (activeThesis.linked_master_analysis_id !== latestMaster.analysis_id) {
    throw deskError("CROSS_SCOPE_REFERENCE", "The thesis is not linked to the requested Master.", {
      thesis_id: activeThesis.thesis_id,
      expected_master_id: latestMaster.analysis_id,
      actual_master_id: activeThesis.linked_master_analysis_id || null,
    });
  }
  return {
    activeThesis,
    latestMaster,
    candidateSetups: candidateSetupsFromMaster(latestMaster),
    source: "exact_operational_scope",
    resolvedScope: queryScope,
  };
}

function resolveOperationalReadScope(args = {}, { requireMaster = false, requireThesis = false } = {}) {
  if (["replay", "backtest"].includes(args.mode)) {
    throw deskError("RUN_SCOPE_MISMATCH", "Generic live/front bundles cannot read replay data; use the replay-scoped bundle tools.", {
      mode: args.mode,
      backtest_id: args.backtest_id || null,
    });
  }
  const required = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc"];
  if (requireMaster) required.push("master_id");
  if (requireThesis) required.push("thesis_id");
  const missing = required.filter((field) => args[field] === undefined || args[field] === null || String(args[field]).trim() === "");
  if (missing.length) {
    throw deskError("SCOPE_REQUIRED", "A complete operational scope is required.", { missing });
  }
  const asOfMs = Date.parse(args.as_of_utc);
  if (!Number.isFinite(asOfMs)) {
    throw deskError("INVALID_SCOPE", "as_of_utc must be a valid ISO timestamp.", { as_of_utc: args.as_of_utc });
  }
  const scope = createDeskExecutionScope({
    strategy_id: args.strategy_id,
    session: args.session,
    mode: args.mode,
    trading_date: args.trading_date,
    timezone: args.timezone || "Europe/Paris",
    cutoff_paris: toParisIso(asOfMs),
    cutoff_utc: new Date(asOfMs).toISOString(),
    run_id: args.run_id,
  }, { requireRun: true });
  return { ...scope, as_of_utc: new Date(asOfMs).toISOString() };
}

function operationalSelectorArgs(scope) {
  return {
    strategy_id: scope.strategy_id,
    session: scope.session,
    mode: scope.mode,
    trading_date: scope.trading_date,
    run_id: scope.run_id,
    backtest_id: scope.backtest_id || undefined,
    as_of_utc: scope.as_of_utc || scope.cutoff_utc,
  };
}

function assertOperationalDocumentScope(document, scope, errorCode = "CROSS_SCOPE_REFERENCE") {
  const mismatches = [];
  for (const [field, expected, actual] of [
    ["strategy_id", scope.strategy_id, document.strategy_id],
    ["session", scope.session, document.session],
    ["mode", scope.mode, document.mode],
    ["trading_date", scope.trading_date, document.trading_date || document.date],
    ["run_id", scope.run_id, document.run_id || document.replay_run_id],
    ["backtest_id", scope.backtest_id || null, document.backtest_id || null],
  ]) {
    if ((actual ?? null) !== (expected ?? null)) mismatches.push({ field, expected: expected ?? null, actual: actual ?? null });
  }
  const timestamp = documentTimestampUtc(document);
  if (timestamp && Date.parse(timestamp) > Date.parse(scope.as_of_utc || scope.cutoff_utc)) {
    mismatches.push({ field: "as_of_utc", expected: scope.as_of_utc || scope.cutoff_utc, actual: timestamp });
  }
  if (mismatches.length) {
    throw deskError(errorCode, "Document does not belong to the requested operational scope.", {
      document_id: document.analysis_id || document.thesis_id || document.monitor_id || null,
      mismatches,
    });
  }
  return true;
}

function deriveActiveThesisFromMaster(master) {
  if (!master) {
    return null;
  }
  const full = master.full_analysis || master;
  const thesis = full.active_thesis || master.active_thesis || null;
  if (!thesis || typeof thesis !== "object") {
    return null;
  }
  return {
    ...thesis,
    thesis_id: thesis.thesis_id || activeThesisVNextId({
      ...thesis,
      linked_master_analysis_id: master.analysis_id,
      valid_from: thesis.valid_from || master.created_at_paris || master.created_at,
      instrument: thesis.instrument || full.executive_summary?.final_instrument || "MNQ",
    }),
    linked_master_analysis_id: thesis.linked_master_analysis_id || master.analysis_id || null,
    pack_id: thesis.pack_id || master.pack_id || null,
    date: thesis.date || master.date || null,
    session: thesis.session || master.session || "asia_open",
    timezone: thesis.timezone || master.timezone || "Europe/Paris",
    status: thesis.status || "WAIT_MONITORED",
  };
}

function candidateSetupsFromMaster(master) {
  const full = master?.full_analysis || {};
  return firstArray(full.setups, full.candidate_setups, full.setup_candidates, full.active_thesis?.setups).slice(0, 20);
}

function manualMonitorCheckpoint(args = {}, tick = new SystemClock().now()) {
  const cadence = normalizeMonitorCadence(args.cadence);
  if (args.timestamp_paris) {
    return { cadence, timestamp_paris: args.timestamp_paris };
  }
  if (args.as_of_utc) {
    const value = Date.parse(args.as_of_utc);
    if (!Number.isFinite(value)) throw deskError("INVALID_SCOPE", "as_of_utc must be a valid instant.", { as_of_utc: args.as_of_utc });
    return { cadence, timestamp_paris: toParisIso(value) };
  }
  const stepMs = cadence === "15m" ? 15 * 60 * 1000 : 15 * 60 * 1000;
  const rounded = Math.floor(tick.epochMs / stepMs) * stepMs;
  return { cadence, timestamp_paris: toParisIso(rounded) };
}

function normalizeMonitorCadence(value) {
  const normalized = String(value || "15m").trim().toLowerCase();
  if (["m15", "15", "15m"].includes(normalized)) return "15m";
  if (["m30", "30", "30m"].includes(normalized)) return "30m";
  if (["h1", "1h", "60", "60m"].includes(normalized)) return "60m";
  return "15m";
}

function manualMonitorBundleId({ session, mode, checkpoint }) {
  const date = String(checkpoint.timestamp_paris).slice(0, 10);
  const hm = String(checkpoint.timestamp_paris).slice(11, 16).replace(":", "");
  return stableVNextId("manual_monitor_bundle", `${date}_${session}_${hm}`, `${checkpoint.cadence}_${mode}`);
}

function masterCutoffBundleId({ date, session, cutoff_paris, mode }) {
  const hm = String(cutoff_paris).slice(11, 16).replace(":", "") || "cutoff";
  return stableVNextId("master_cutoff_bundle", `${date}_${session}_${hm}`, mode || "live");
}

function selectMasterCutoffBundle(docs, args = {}) {
  if (args.bundle_id) {
    return (docs || []).find((doc) => doc.bundle_id === args.bundle_id && masterCutoffBundleMatchesScope(doc, args)) || null;
  }
  const tradingDate = args.trading_date || args.date;
  const expectedId = tradingDate && args.session && args.cutoff_paris
    ? masterCutoffBundleId({ date: tradingDate, session: args.session, cutoff_paris: args.cutoff_paris, mode: args.mode || "live" })
    : null;
  return (docs || [])
    .filter((doc) => !expectedId || doc.bundle_id === expectedId)
    .filter((doc) => masterCutoffBundleMatchesScope(doc, args))
    .sort((left, right) => String(right.created_at || right.created_at_paris || "").localeCompare(String(left.created_at || left.created_at_paris || "")))[0] || null;
}

function masterCutoffBundleMatchesScope(doc, args) {
  const tradingDate = args.trading_date || args.date;
  return (!tradingDate || (doc.trading_date || doc.date) === tradingDate) &&
    (!args.strategy_id || doc.strategy_id === args.strategy_id) &&
    (!args.session || doc.session === args.session) &&
    (!args.run_id || doc.run_id === args.run_id) &&
    (!args.cutoff_paris || Date.parse(doc.cutoff_paris) === Date.parse(args.cutoff_paris)) &&
    (!args.as_of_utc || Date.parse(doc.as_of_utc || doc.timestamp_utc || doc.cutoff_paris) === Date.parse(args.as_of_utc)) &&
    (!args.mode || doc.mode === args.mode);
}

function missingMasterCutoffBundle(args = {}) {
  const date = args.trading_date || args.date || String(args.cutoff_paris || "").slice(0, 10) || null;
  const session = args.session || null;
  const cutoff = args.cutoff_paris || null;
  return {
    ok: false,
    status: "missing",
    bundle_id: args.bundle_id || (date && session && cutoff ? masterCutoffBundleId({ date, session, cutoff_paris: cutoff, mode: args.mode || "live" }) : null),
    bundle_type: "master_cutoff",
    date,
    trading_date: date,
    strategy_id: args.strategy_id || null,
    run_id: args.run_id || null,
    session,
    cutoff_paris: cutoff,
    mode: args.mode || "live",
    as_of_utc: args.as_of_utc || null,
    resolved_scope: args.resolved_scope || null,
    scope_hash: args.resolved_scope?.scope_hash || null,
    fallback: false,
    execution_allowed: false,
    missing_reason: "master_cutoff_bundle_not_found",
    data_quality: {
      status: "missing",
      execution_allowed: false,
      blockers: ["master_cutoff_bundle_not_found"],
      warnings: [],
      missing: ["master_cutoff_bundle"],
      stale: [],
      explicit_missing_data: ["master_cutoff_bundle_not_found"],
      anti_lookahead_compliant: true,
      raw_refs_available: false,
      checkpoint_paris: cutoff,
    },
    next_action: "prepare_master_cutoff_bundle_job",
  };
}

async function buildMasterCutoffRawWindows(store, { cutoff, instruments, raw_scope }) {
  const specs = [
    ...instruments.map((instrument) => ({ key: `${instrument}_M5`, instrument, timeframe: "M5", minutes: 240 })),
    { key: "NQ_M15", instrument: "NQ", timeframe: "M15", minutes: 240 },
    { key: "ES_M15", instrument: "ES", timeframe: "M15", minutes: 240 },
    { key: "NQ_H1", instrument: "NQ", timeframe: "H1", minutes: 24 * 60 },
    { key: "ES_H1", instrument: "ES", timeframe: "H1", minutes: 24 * 60 },
    { key: "NQ_H4", instrument: "NQ", timeframe: "H4", minutes: 48 * 60 },
    { key: "ES_H4", instrument: "ES", timeframe: "H4", minutes: 48 * 60 },
    { key: "MNQ_H4", instrument: "MNQ", timeframe: "H4", minutes: 48 * 60 },
    { key: "MES_H4", instrument: "MES", timeframe: "H4", minutes: 48 * 60 },
  ];
  const output = {};
  for (const spec of specs) {
    output[spec.key] = summarizeRawWindow(raw_scope ? await safeRead(store.getRawWindow({
      ...raw_scope,
      instrument: spec.instrument,
      timeframe: spec.timeframe,
      from: offsetIso(cutoff, -spec.minutes * 60 * 1000),
      to: cutoff,
      max_rows: 500,
    }), { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "raw_window_query_failed" }) : { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "immutable_pack_missing" });
  }
  return output;
}

async function buildCrossAssetRawWindows(store, { cutoff, raw_scope }) {
  const output = {};
  for (const asset of ["DXY", "VIX", "US10Y", "US02Y", "CL", "GC"]) {
    output[asset] = summarizeRawWindow(raw_scope ? await safeRead(store.getRawWindow({
      ...raw_scope,
      instrument: asset,
      timeframe: "M5",
      from: offsetIso(cutoff, -4 * 60 * 60 * 1000),
      to: cutoff,
      max_rows: 500,
    }), { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "raw_window_query_failed" }) : { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "immutable_pack_missing" });
  }
  return output;
}

function summarizeRawWindow(raw) {
  const rows = raw.rows || [];
  return {
    status: rows.length ? "ready" : "missing",
    source: raw.source || null,
    row_count: rows.length,
    first_timestamp_paris: rows[0]?.timestamp_paris || null,
    last_timestamp_paris: rows.at(-1)?.timestamp_paris || null,
    raw_refs: raw.raw_refs || (raw.raw_ref ? [raw.raw_ref] : []),
    attempted_raw_refs: raw.attempted_raw_refs || [],
    missing_reason: rows.length ? null : raw.missing_reason || raw.warning || "source_missing",
    data_quality: raw.data_quality || rawWindowQuality(rows, { reason: raw.missing_reason || "source_missing", attempted_raw_refs: raw.attempted_raw_refs || [] }),
  };
}

function masterCutoffDataQuality({ pack, futures_core, cross_asset, rolling, cross_delta, macro_calendar, news_digest }) {
  const missing = [];
  const stale = [];
  const warnings = [];
  const informational = [];
  const blockers = [];
  for (const key of ["MNQ_M5", "MES_M5"]) {
    if (!futures_core[key] || futures_core[key].status !== "ready") {
      missing.push(key);
      blockers.push(`${key}:source_missing`);
    }
  }
  if (!pack) warnings.push("desk_pack_missing_for_cutoff_source_context");
  if (!macro_calendar?.events?.length) warnings.push(macro_calendar?.warning || "macro_calendar_empty_or_missing");
  if (!news_digest?.items?.length) {
    if (isOptionalEmptyNewsDigest(news_digest)) {
      informational.push(news_digest.reason || "news_digest_not_configured");
    } else {
      warnings.push(news_digest?.warning || "news_digest_missing");
    }
  }
  if (cross_delta?.stale_check?.is_stale) {
    const unexpectedCrossMissing = ["DXY", "VIX", "US10Y", "US02Y", "CL", "GC"]
      .filter((instrument) => rolling?.snapshots?.["15m"]?.instruments?.[instrument]?.availability === "missing_unexpected");
    if (unexpectedCrossMissing.length) {
      stale.push("cross_asset_delta");
      blockers.push(`cross_asset_delta_missing_open_sources:${unexpectedCrossMissing.join(",")}`);
    } else {
      informational.push("cross_asset_delta_partial_only_for_closed_or_not_yet_open_sources");
    }
  }
  if (cross_delta?.delta?.quality?.missing_assets?.length) {
    informational.push(`cross_asset_delta_partial:${cross_delta.delta.quality.missing_assets.join(",")}`);
  }
  for (const [key, item] of Object.entries(cross_asset || {})) {
    if (item.status !== "ready") informational.push(`${key}:source_missing`);
  }
  for (const [window, snapshot] of Object.entries(rolling?.snapshots || {})) {
    if (snapshot?.data_quality?.missing_instruments?.length) {
      const warning = `rolling_${window}_missing:${snapshot.data_quality.missing_instruments.join(",")}`;
      if (snapshot.data_quality.missing_instruments.some((instrument) => ["MNQ", "MES"].includes(instrument))) {
        warnings.push(warning);
      } else {
        informational.push(warning);
      }
    }
  }
  const execution_allowed = blockers.length === 0;
  const status = blockers.length ? "missing" : stale.length ? "stale" : warnings.length || missing.length ? "degraded" : "ready";
  return {
    status,
    execution_allowed,
    blockers,
    warnings,
    informational: dedupeBy(informational, (item) => item),
    missing,
    stale,
    explicit_missing_data: dedupeBy([...blockers, ...warnings, ...missing, ...stale], (item) => item),
    anti_lookahead_compliant: true,
    raw_refs_available: Object.values(futures_core || {}).some((item) => item.raw_refs?.length),
  };
}

function buildMacroHorizon({ timestamp_paris, macro_calendar }) {
  const events = macro_calendar?.events || [];
  const now = Date.parse(timestamp_paris);
  const inMinutes = (event) => (Date.parse(event.scheduled_at_paris || event.timestamp_paris || event.time_paris || "") - now) / 60000;
  return {
    timestamp_paris,
    status: events.length ? "ready" : "missing",
    events_since_last_check: events.filter((event) => inMinutes(event) <= 0 && inMinutes(event) >= -30),
    events_next_30m: events.filter((event) => inMinutes(event) > 0 && inMinutes(event) <= 30),
    events_next_2h: events.filter((event) => inMinutes(event) > 30 && inMinutes(event) <= 120),
    events_rest_of_day: events.filter((event) => inMinutes(event) > 120),
    data_quality: {
      status: events.length ? "ready" : "missing",
      warning: events.length ? null : macro_calendar?.warning || "macro_calendar_empty_or_missing",
    },
  };
}

function maxMasterRawTimestamp({ futures_core, cross_asset, rolling }) {
  const values = [
    ...Object.values(futures_core || {}).map((item) => item.last_timestamp_paris),
    ...Object.values(cross_asset || {}).map((item) => item.last_timestamp_paris),
    maxRollingTimestamp(rolling),
  ].filter(Boolean);
  return values.sort().at(-1) || null;
}

function buildBundleDataQualityAudit({ bundle_id, data_quality, checkpoint_paris, source_hash, tick }) {
  return {
    audit_id: stableVNextId("data_quality", bundle_id, checkpoint_paris),
    bundle_id,
    status: data_quality.status,
    execution_allowed: data_quality.execution_allowed,
    blockers: data_quality.blockers || [],
    warnings: data_quality.warnings || [],
    missing: data_quality.missing || [],
    stale: data_quality.stale || [],
    explicit_missing_data: data_quality.explicit_missing_data || [],
    anti_lookahead_compliant: data_quality.anti_lookahead_compliant !== false,
    raw_refs_available: data_quality.raw_refs_available === true,
    source_hash,
    checkpoint_paris,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

async function buildPinnedReplaySnapshots(store, run, pack, timestampParis, includeRawRefs, readMode = "replay") {
  const rows = [];
  const integrity = {};
  const rawRefs = [];
  const seenObjects = new Set();
  for (const [dataset, ref] of Object.entries(pack.datasets || {})) {
    if (["macro_calendar", "news_digest"].includes(dataset)) continue;
    if (!DATASETS.includes(dataset)) continue;
    const objectKey = `${ref.object_path || ref.storage_path || dataset}@${ref.gcs_generation || "unknown"}`;
    if (seenObjects.has(objectKey)) continue;
    seenObjects.add(objectKey);
    const result = await store.getDataset({
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      dataset,
      as_of_utc: normalizeUtcIso(timestampParis),
      mode: readMode,
      format: "json",
      max_rows: 5000,
    });
    integrity[dataset] = result.integrity;
    rows.push(...(result.rows || []));
    if (includeRawRefs) {
      rawRefs.push({
        dataset,
        object_path: ref.object_path || ref.storage_path || null,
        gcs_generation: ref.gcs_generation || null,
        sha256: ref.sha256 || null,
      });
    }
  }

  const configs = [
    { key: "15m", timeframes: ["M5", "M15"], minutes: 15 },
    { key: "1h", timeframes: ["M5", "M15"], minutes: 60 },
    { key: "4h", timeframes: ["M15", "M5"], minutes: 240, fallback_timeframe: "H4" },
  ];
  const instruments = dedupeBy(rows.map((row) => row.asset || row.instrument).filter(Boolean), (item) => item);
  const rowsByInstrument = Object.fromEntries(instruments.map((instrument) => [instrument, rows
    .filter((row) => (row.asset || row.instrument) === instrument)
    .filter((row) => rowVisibleAtReplayCutoff(row, timestampParis))
    .sort(compareReplayRows)]));
  const snapshots = {};
  for (const config of configs) {
    const fromMs = Date.parse(offsetIso(timestampParis, -config.minutes * 60 * 1000));
    const toMs = Date.parse(timestampParis);
    const blocks = {};
    const missing = [];
    const closed = [];
    const stale = [];
    for (const instrument of instruments) {
      const instrumentRows = rowsByInstrument[instrument] || [];
      let selected = [];
      let timeframeUsed = null;
      for (const timeframe of config.timeframes) {
        const candidates = instrumentRows.filter((row) => timeframeMatches(row.timeframe, timeframe)).filter((row) => {
          const value = replayRowTimestampMs(row);
          return Number.isFinite(value) && value >= fromMs && value <= toMs;
        });
        if (candidates.length) {
          selected = candidates;
          timeframeUsed = timeframe;
          break;
        }
      }
      let fallbackUsed = false;
      if (!selected.length && config.fallback_timeframe) {
        const fallback = instrumentRows
          .filter((row) => timeframeMatches(row.timeframe, config.fallback_timeframe))
          .filter((row) => replayBarClosedAtCutoff(row, timestampParis))
          .slice(-1);
        if (fallback.length) {
          selected = fallback;
          timeframeUsed = config.fallback_timeframe;
          fallbackUsed = true;
        }
      }
      const marketState = replayMarketState(instrument, timestampParis);
      const lastKnown = latestReplayObservation(instrumentRows, timestampParis);
      const availability = replayAvailability({ selected, fallbackUsed, marketState, lastKnown });
      blocks[instrument] = rollingInstrumentBlock(selected, {
        raw_refs: [],
        missing_reason: availability === "missing_unexpected" ? "pinned_replay_window_empty" : null,
      }, {
        availability,
        market_state: marketState,
        last_known: replayLastKnownSummary(lastKnown, timestampParis),
        timeframe_used: timeframeUsed,
        fallback_used: fallbackUsed,
      });
      if (availability === "missing_unexpected") missing.push(instrument);
      if (["stale_market_closed", "not_yet_open"].includes(availability)) closed.push(instrument);
      if (availability === "stale_market_closed" || fallbackUsed) stale.push(instrument);
    }
    snapshots[config.key] = {
      snapshot_id: stableVNextId(readMode === "replay" ? "replay_rolling_snapshot" : "rolling_snapshot", `${run.backtest_id || run.run_id || run.date}_${config.key}`, timestampParis),
      backtest_id: run.backtest_id || null,
      step_id: run.current_step_id || null,
      strategy_id: run.strategy_id,
      scope_hash: run.scope_hash,
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
      date: run.date,
      session: run.session,
      window: config.key,
      timeframe: config.timeframes.join("|"),
      timestamp_paris: timestampParis,
      timestamp_utc: normalizeUtcIso(timestampParis),
      instruments: blocks,
      raw_refs: includeRawRefs ? rawRefs : [],
      data_quality: {
        status: missing.length ? "degraded" : "ready",
        missing_instruments: missing,
        closed_instruments: closed,
        stale_context_instruments: stale,
        execution_allowed: ["MNQ", "MES", "NQ", "ES"].some((instrument) => blocks[instrument]?.availability === "fresh"),
      },
      anti_lookahead_compliant: true,
      computed_with_cutoff: timestampParis,
    };
  }
  const marketAvailability = buildReplayMarketAvailability(rowsByInstrument, snapshots, timestampParis);
  return { snapshots, integrity, raw_refs: rawRefs, market_availability: marketAvailability };
}

const REPLAY_TECH_INSTRUMENTS = Object.freeze(["AAPL", "MSFT", "NVDA", "SMH", "SOXX", "TSLA"]);
const REPLAY_US_CASH_INSTRUMENTS = new Set(["VIX", "US02Y", "US10Y", ...REPLAY_TECH_INSTRUMENTS]);
const REPLAY_EU_CASH_INSTRUMENTS = new Set(["DAX", "SX5E"]);
const REPLAY_ASIA_CASH_INSTRUMENTS = new Set(["NI225", "HSI"]);
const REPLAY_US_CASH_HOLIDAYS = new Set([
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

function replayMarketState(instrument, timestampParis) {
  const parts = replayParisClock(timestampParis);
  const weekend = parts.day_of_week === 0 || parts.day_of_week === 6;
  let profile = "futures_24x5";
  let start = 0;
  let end = 24 * 60;
  if (REPLAY_US_CASH_INSTRUMENTS.has(instrument)) {
    profile = "us_cash";
    start = 15 * 60 + 30;
    end = 22 * 60 + 15;
  } else if (REPLAY_EU_CASH_INSTRUMENTS.has(instrument)) {
    profile = "europe_cash";
    start = 9 * 60;
    end = 17 * 60 + 35;
  } else if (REPLAY_ASIA_CASH_INSTRUMENTS.has(instrument)) {
    profile = "asia_cash";
    start = instrument === "HSI" ? 3 * 60 + 30 : 2 * 60;
    end = instrument === "HSI" ? 10 * 60 : 8 * 60;
  }
  const holiday = profile === "us_cash" && REPLAY_US_CASH_HOLIDAYS.has(parts.date);
  const expectedOpen = !weekend && !holiday && parts.minutes >= start && parts.minutes <= end;
  const phase = expectedOpen
    ? "open"
    : weekend || holiday || parts.minutes > end
      ? "market_closed"
      : "not_yet_open";
  return {
    profile,
    phase,
    expected_open: expectedOpen,
    reason: weekend ? "weekend" : holiday ? "cash_market_holiday" : expectedOpen ? "inside_expected_session" : phase,
  };
}

function replayParisClock(timestampParis) {
  const match = String(timestampParis || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { date: null, minutes: 0, day_of_week: 0 };
  const [year, month, day] = match[1].split("-").map(Number);
  return {
    date: match[1],
    minutes: Number(match[2]) * 60 + Number(match[3]),
    day_of_week: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function replayAvailability({ selected, fallbackUsed, marketState, lastKnown }) {
  if (selected.length && !fallbackUsed) return "fresh";
  if (selected.length || lastKnown) return marketState.expected_open ? "missing_unexpected" : "stale_market_closed";
  return marketState.expected_open ? "missing_unexpected" : "not_yet_open";
}

function replayRowTimestampMs(row) {
  return Date.parse(row?.timestamp_utc || row?.timestamp_paris || "");
}

function compareReplayRows(left, right) {
  const delta = replayRowTimestampMs(left) - replayRowTimestampMs(right);
  if (delta) return delta;
  return replayTimeframeMinutes(left?.timeframe) - replayTimeframeMinutes(right?.timeframe);
}

function rowVisibleAtReplayCutoff(row, timestampParis) {
  const value = replayRowTimestampMs(row);
  return Number.isFinite(value) && value <= Date.parse(timestampParis);
}

function replayBarClosedAtCutoff(row, timestampParis) {
  const timestamp = replayRowTimestampMs(row);
  const duration = replayTimeframeMinutes(row?.timeframe);
  return Number.isFinite(timestamp) && timestamp + duration * 60 * 1000 <= Date.parse(timestampParis);
}

function replayTimeframeMinutes(value) {
  const text = String(value || "").toUpperCase();
  if (["5", "5M", "M5"].includes(text)) return 5;
  if (["15", "15M", "M15"].includes(text)) return 15;
  if (["60", "1H", "H1"].includes(text)) return 60;
  if (["240", "4H", "H4"].includes(text)) return 240;
  return 0;
}

function latestReplayObservation(rows, timestampParis) {
  return (rows || []).filter((row) => {
    if (!rowVisibleAtReplayCutoff(row, timestampParis)) return false;
    const duration = replayTimeframeMinutes(row?.timeframe);
    return duration < 60 || replayBarClosedAtCutoff(row, timestampParis);
  }).sort(compareReplayRows).at(-1) || null;
}

function replayLastKnownSummary(row, timestampParis) {
  if (!row) return null;
  const timestamp = row.timestamp_paris || row.timestamp_utc || null;
  return {
    timeframe: String(row.timeframe || ""),
    timestamp_paris: timestamp,
    age_minutes: timestamp ? Math.max(0, Math.round((Date.parse(timestampParis) - Date.parse(timestamp)) / 60000)) : null,
    open: row.open ?? null,
    high: row.high ?? null,
    low: row.low ?? null,
    close: row.close ?? null,
  };
}

function buildReplayMarketAvailability(rowsByInstrument, snapshots, timestampParis) {
  const instrumentAvailability = Object.fromEntries(Object.entries(snapshots["15m"]?.instruments || {}).map(([instrument, block]) => [instrument, {
    availability: block.availability,
    market_state: block.market_state,
    last_known: block.last_known,
    fresh_confirmation_available: block.availability === "fresh",
    usable_as_context: block.usable_as_context === true,
  }]));
  const cutoffDate = String(timestampParis).slice(0, 10);
  const techGaps = Object.fromEntries(REPLAY_TECH_INSTRUMENTS.map((instrument) => {
    const rows = (rowsByInstrument[instrument] || []).filter((row) => timeframeMatches(row.timeframe, "M5"));
    const current = rows.filter((row) => String(row.timestamp_paris || "").slice(0, 10) === cutoffDate);
    const previous = rows.filter((row) => String(row.timestamp_paris || "").slice(0, 10) < cutoffDate);
    const firstCurrent = current[0] || null;
    const previousClose = previous.at(-1) || null;
    const gapPoints = firstCurrent && previousClose ? Number(firstCurrent.open) - Number(previousClose.close) : null;
    const gapPct = Number.isFinite(gapPoints) && Number(previousClose?.close)
      ? roundNumber((gapPoints / Number(previousClose.close)) * 100, 4)
      : null;
    return [instrument, {
      status: firstCurrent && previousClose ? "ready" : "not_yet_open",
      previous_close: previousClose?.close ?? null,
      previous_close_timestamp_paris: previousClose?.timestamp_paris || null,
      current_session_open: firstCurrent?.open ?? null,
      current_session_open_timestamp_paris: firstCurrent?.timestamp_paris || null,
      gap_points: gapPoints,
      gap_pct: gapPct,
      usable_for_confirmation: Boolean(firstCurrent && previousClose),
    }];
  }));
  const vix = instrumentAvailability.VIX || { availability: "not_yet_open", last_known: null, fresh_confirmation_available: false };
  return {
    as_of_paris: timestampParis,
    instruments: instrumentAvailability,
    vix_context: {
      source_type: "cash_index",
      availability: vix.availability,
      last_known: vix.last_known,
      fresh_confirmation_available: vix.fresh_confirmation_available,
      overnight_proxy_available: false,
    },
    tech_gap_context: techGaps,
    interpretation_rules: {
      missing_unexpected: "Critical source expected to be open but absent; DATA_NOT_READY may be required.",
      stale_market_closed: "Use last_known for regime/context only; do not use it as a fresh trigger and do not classify it as a feed outage.",
      not_yet_open: "The current-session gap or confirmation is not applicable yet; do not treat it as missing data.",
      fresh: "The source has observations inside the requested replay window.",
    },
  };
}

function timeframeMatches(value, expected) {
  const text = String(value || "").toUpperCase();
  if (expected === "M5") return ["5", "5M", "M5"].includes(text);
  if (expected === "M15") return ["15", "15M", "M15"].includes(text);
  if (expected === "H1") return ["60", "1H", "H1"].includes(text);
  if (expected === "H4") return ["240", "4H", "H4"].includes(text);
  return text === expected;
}

function assertReplayLineage(run, { master, thesis, monitors = [], positions = [] }) {
  if (!master) throw deskError("MASTER_SCOPE_MISMATCH", "Replay Master is required for a monitor bundle.", { backtest_id: run.backtest_id });
  if (!thesis) throw deskError("THESIS_SCOPE_MISMATCH", "Replay thesis is required for a monitor bundle.", { backtest_id: run.backtest_id });
  const documents = [master, thesis, ...monitors, ...positions].filter(Boolean);
  for (const document of documents) {
    if (document.backtest_id !== run.backtest_id || (document.scope_hash && document.scope_hash !== run.scope_hash)) {
      throw deskError("CROSS_SCOPE_REFERENCE", "Replay document belongs to another run or strategy scope.", {
        backtest_id: run.backtest_id,
        document_id: document.analysis_id || document.thesis_id || document.monitor_id || document.position_id || null,
        document_backtest_id: document.backtest_id || null,
      });
    }
  }
  if (thesis.linked_master_analysis_id !== master.analysis_id) {
    throw deskError("THESIS_SCOPE_MISMATCH", "Replay thesis is not linked to the pinned Master.", {
      master_id: master.analysis_id,
      linked_master_analysis_id: thesis.linked_master_analysis_id || null,
    });
  }
  return true;
}

async function buildRollingSnapshots(store, { date, session, timestamp_paris, instrument, include_raw_refs, raw_scope }) {
  const configs = [
    { key: "15m", timeframe: "M5", minutes: 15 },
    { key: "1h", timeframe: "M5", minutes: 60 },
    { key: "4h", timeframe: "M15", minutes: 240 },
  ];
  const instruments = dedupeBy([instrument, "MNQ", "MES", "DXY", "VIX", "US10Y", "US02Y", "CL", "GC"].filter(Boolean), (item) => item);
  const snapshots = {};
  const raw_refs = [];
  for (const config of configs) {
    const blocks = {};
    const missing = [];
    for (const item of instruments) {
      const raw = raw_scope ? await safeRead(store.getRawWindow({
        ...raw_scope,
        instrument: item,
        timeframe: config.timeframe,
        from: offsetIso(timestamp_paris, -config.minutes * 60 * 1000),
        to: timestamp_paris,
        max_rows: 200,
      }), { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "raw_window_query_failed" }) : { ok: false, rows: [], raw_refs: [], attempted_raw_refs: [], missing_reason: "immutable_pack_missing" };
      const rows = raw.rows || [];
      blocks[item] = rollingInstrumentBlock(rows, raw);
      if (!rows.length) {
        missing.push(item);
      }
      if (include_raw_refs) {
        raw_refs.push(...(raw.raw_refs || (raw.raw_ref ? [raw.raw_ref] : [])));
      }
    }
    snapshots[config.key] = {
      snapshot_id: stableVNextId("rolling_snapshot", `${date}_${session}_${config.key}`, timestamp_paris),
      date,
      session,
      window: config.key,
      timeframe: config.timeframe,
      timeframe_used: config.timeframe,
      timestamp_paris,
      timestamp_utc: normalizeUtcIso(timestamp_paris),
      instruments: blocks,
      data_quality: {
        status: missing.length ? "degraded" : "ready",
        missing_instruments: missing,
        execution_allowed: !missing.includes("MNQ") && !missing.includes("MES"),
      },
      anti_lookahead_compliant: true,
      computed_with_cutoff: timestamp_paris,
    };
  }
  return { snapshots, raw_refs: dedupeBy(raw_refs, (item) => item) };
}

function rollingInstrumentBlock(rows, raw, context = {}) {
  const first = rows[0] || null;
  const last = rows.at(-1) || null;
  const high = maxBy(rows, (row) => numeric(row.high, Number.NEGATIVE_INFINITY));
  const low = maxBy(rows, (row) => -numeric(row.low, Number.POSITIVE_INFINITY));
  const availability = context.availability || (rows.length ? "fresh" : "missing_unexpected");
  return {
    status: availability === "fresh" ? "ready" : availability === "missing_unexpected" ? "missing" : "stale",
    availability,
    market_state: context.market_state || null,
    timeframe_used: context.timeframe_used || (last?.timeframe ? String(last.timeframe) : null),
    fallback_used: context.fallback_used === true,
    row_count: rows.length,
    open: first?.open ?? null,
    high: high?.high ?? null,
    low: low?.low ?? null,
    close: last?.close ?? null,
    first_timestamp_paris: first?.timestamp_paris || null,
    last_timestamp_paris: last?.timestamp_paris || null,
    range_points: rows.length ? roundNumber((high?.high ?? 0) - (low?.low ?? 0)) : null,
    missing_reason: availability === "missing_unexpected" ? raw.missing_reason || raw.warning || "raw_window_missing" : null,
    last_known: context.last_known || null,
    usable_as_context: Boolean(rows.length || context.last_known),
    usable_for_fresh_confirmation: availability === "fresh",
    raw_refs: raw.raw_refs || (raw.raw_ref ? [raw.raw_ref] : []),
    attempted_raw_refs: raw.attempted_raw_refs || [],
  };
}

function manualBundleDataQuality({ pack, activeThesis, latestMaster, macro_calendar, news_digest, features, rolling }) {
  const missing = [];
  const stale = [];
  const warnings = [];
  const informational = [];
  const blockers = [];
  if (!pack) missing.push("desk_pack");
  if (!activeThesis && !latestMaster) missing.push("thesis_or_master_context");
  if (!activeThesis && latestMaster) warnings.push("active_thesis_missing_using_master_fallback");
  if (!macro_calendar?.events?.length) warnings.push(macro_calendar?.warning || "macro_calendar_empty_or_missing");
  if (!news_digest?.items?.length) {
    if (isOptionalEmptyNewsDigest(news_digest)) {
      informational.push(news_digest.reason || "news_digest_not_configured");
    } else {
      warnings.push(news_digest?.warning || "news_digest_empty_or_missing");
    }
  }
  if (!features.level?.level_map) missing.push("level_map");
  if (!features.technical?.events?.length) warnings.push("technical_events_empty_or_missing");
  if (!features.cross?.delta) {
    (features.cross?.stale_check?.is_stale ? stale : missing).push("cross_asset_delta");
  }
  if (features.cross?.delta?.quality?.missing_assets?.length) {
    informational.push(`cross_asset_delta_partial:${features.cross.delta.quality.missing_assets.join(",")}`);
  }
  for (const [window, snapshot] of Object.entries(rolling.snapshots || {})) {
    if (snapshot?.data_quality?.missing_instruments?.length) {
      if (snapshot.data_quality.missing_instruments.includes("MNQ") || snapshot.data_quality.missing_instruments.includes("MES")) {
        warnings.push(`rolling_${window}_missing:${snapshot.data_quality.missing_instruments.join(",")}`);
        blockers.push(`rolling_${window}_critical_market_missing`);
      } else {
        informational.push(`rolling_${window}_missing:${snapshot.data_quality.missing_instruments.join(",")}`);
      }
    }
  }
  if (features.cross?.stale_check?.is_stale) {
    const unexpectedCrossMissing = ["DXY", "VIX", "US10Y", "US02Y", "CL", "GC"]
      .filter((instrument) => rolling?.snapshots?.["15m"]?.instruments?.[instrument]?.availability === "missing_unexpected");
    if (unexpectedCrossMissing.length) {
      blockers.push(`cross_asset_delta_missing_open_sources:${unexpectedCrossMissing.join(",")}`);
    } else {
      informational.push("cross_asset_delta_partial_only_for_closed_or_not_yet_open_sources");
    }
  }
  const execution_allowed = blockers.length === 0;
  const status = blockers.length ? "missing" : missing.length ? "degraded" : stale.length ? "stale" : warnings.length ? "degraded" : "ready";
  return {
    status,
    execution_allowed,
    blockers,
    missing,
    stale,
    warnings,
    informational: dedupeBy(informational, (item) => item),
    timezone: "Europe/Paris",
    explicit_missing_data: missing.concat(stale).concat(warnings),
    anti_lookahead_compliant: true,
    raw_refs_available: Object.values(rolling.snapshots || {}).some((snapshot) => Object.values(snapshot.instruments || {}).some((item) => item.raw_refs?.length)),
  };
}

function sourceHashPayload(bundle) {
  return stripVolatileSourceFields(bundle);
}

const VOLATILE_SOURCE_HASH_KEYS = new Set([
  "source_hash",
  "created_at",
  "created_at_utc",
  "created_at_paris",
  "updated_at",
  "updated_at_utc",
  "updated_at_paris",
  "saved_at",
  "saved_at_utc",
  "saved_at_paris",
  "completed_at",
  "completed_at_utc",
  "completed_at_paris",
  "locked_until_paris",
]);

function stripVolatileSourceFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripVolatileSourceFields);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_SOURCE_HASH_KEYS.has(key))
        .map(([key, item]) => [key, stripVolatileSourceFields(item)]),
    );
  }
  return value;
}

function hashObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function monitorPrepJobStarted(args, checkpoint, tick) {
  const job_id = stableVNextId("monitor_prep_job", `${String(checkpoint.timestamp_paris).slice(0, 10)}_${args.session || "asia_open"}`, `${String(checkpoint.timestamp_paris).slice(11, 16)}_${args.mode || "live"}`);
  return {
    job_id,
    job_type: "M15_MONITOR_PREP",
    status: "LOCKED",
    date: String(checkpoint.timestamp_paris).slice(0, 10),
    session: args.session || "asia_open",
    mode: args.mode || "live",
    cadence: checkpoint.cadence,
    timestamp_paris: checkpoint.timestamp_paris,
    thesis_id: args.thesis_id || null,
    pack_id: args.pack_id || null,
    analysis_id: args.analysis_id || null,
    locked_until_paris: toParisIso(tick.epochMs + (Number(args.lock_ttl_seconds) || 180) * 1000),
    result_ref: null,
    metadata: {
      force_rebuild: args.force_rebuild === true,
      backend_role: "prepare_data_only",
      catchup_mode: args.catchup_mode === true,
      catchup_context: args.catchup_context || null,
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function masterPrepJobStarted(args, tick) {
  const cutoff = args.cutoff_paris || tick.paris;
  const date = args.date || String(cutoff).slice(0, 10);
  const session = args.session || "asia_open";
  const mode = args.mode || "live";
  const job_id = stableVNextId("master_prep_job", `${date}_${session}_${String(cutoff).slice(11, 16).replace(":", "")}`, mode);
  return {
    job_id,
    job_type: "MASTER_ANALYSIS",
    status: "LOCKED",
    date,
    session,
    mode,
    cutoff_paris: cutoff,
    instruments: args.instruments || ["MNQ", "MES", "NQ", "ES"],
    locked_until_paris: toParisIso(tick.epochMs + (Number(args.lock_ttl_seconds) || 180) * 1000),
    result_ref: null,
    metadata: {
      force_rebuild: args.force_rebuild === true,
      backend_role: "prepare_data_only",
      workflow: "master_cutoff_bundle",
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function monitorPrepJobLocked(existingJob, tick) {
  if (!existingJob || existingJob.status !== "LOCKED") {
    return false;
  }
  const untilMs = Date.parse(existingJob.locked_until_paris || existingJob.locked_until_utc || "");
  return Number.isFinite(untilMs) && untilMs > tick.epochMs;
}

function monitorPrepJobCompleted(job, bundle, tick, { noRecalculation = false, featureRun = null } = {}) {
  return {
    ...job,
    status: bundle?.data_quality?.status === "ready" ? "READY" : bundle?.data_quality?.status === "stale" ? "STALE" : "DEGRADED",
    bundle_id: bundle?.bundle_id || null,
    source_hash: bundle?.source_hash || null,
    no_recalculation: noRecalculation,
    feature_engine: featureRunSummary(featureRun),
    result_ref: bundle?.bundle_id ? { collection: COLLECTIONS.deskManualMonitorBundles, document_id: bundle.bundle_id } : null,
    locked_until_paris: null,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
  };
}

function masterPrepJobCompleted(job, bundle, tick, { noRecalculation = false, featureRun = null } = {}) {
  return {
    ...job,
    status: bundle?.data_quality?.status === "ready" ? "READY" : bundle?.data_quality?.status === "stale" ? "STALE" : "DEGRADED",
    bundle_id: bundle?.bundle_id || null,
    source_hash: bundle?.source_hash || null,
    no_recalculation: noRecalculation,
    feature_engine: featureRunSummary(featureRun),
    result_ref: bundle?.bundle_id ? { collection: COLLECTIONS.deskMasterCutoffBundles, document_id: bundle.bundle_id } : null,
    locked_until_paris: null,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
  };
}

function featureRunSummary(featureRun) {
  if (!featureRun) return null;
  return {
    run_id: featureRun.run_id || null,
    status: featureRun.ok === false ? "FAILED" : "DONE",
    cutoff_paris: featureRun.cutoff_paris || null,
    instruments: Object.keys(featureRun.instruments || {}),
    cross_asset_windows: Object.keys(featureRun.cross_asset_deltas || {}),
    condition_status_id: featureRun.condition_status?.condition_status_id || null,
    error: featureRun.ok === false ? featureRun.error || "feature_engine_failed" : null,
  };
}

function monitorPrepJobFailed(job, error, tick) {
  return {
    ...job,
    status: "FAILED",
    error: publicReplayError(error),
    locked_until_paris: null,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function summarizeReplayBundlePrep(args, results) {
  const okCount = results.filter((result) => result.ok).length;
  return {
    ok: okCount === results.length,
    session: args.session || "asia_open",
    mode: args.mode || "replay",
    cadence: normalizeMonitorCadence(args.cadence),
    requested_count: (args.timestamps_paris || []).length,
    prepared_count: okCount,
    failed_count: results.length - okCount,
    results,
  };
}

function normalizeManualMonitor(monitor, tick) {
  const cadence = normalizeMonitorCadence(monitor.cadence);
  const monitor_id = monitor.monitor_id || stableVNextId("manual_monitor", monitor.bundle_id || monitor.timestamp_paris, monitor.linked_active_thesis_id || monitor.session || "desk");
  return {
    ...monitor,
    monitor_id,
    cadence,
    status: monitor.status || "SAVED",
    session: monitor.session || "asia_open",
    mode: monitor.mode || "live",
    timezone: monitor.timezone || "Europe/Paris",
    saved_at: tick.utc,
    saved_at_utc: tick.utc,
    saved_at_paris: tick.paris,
    created_at: monitor.created_at ?? tick.utc,
    created_at_utc: monitor.created_at_utc ?? tick.utc,
    created_at_paris: monitor.created_at_paris ?? tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function selectLatestManualMonitors(docs, {
  thesis_id,
  bundle_id,
  strategy_id,
  session,
  mode,
  trading_date,
  run_id,
  master_id,
  as_of_utc,
  limit = 1,
} = {}) {
  const monitors = (docs || [])
    .filter((doc) => !thesis_id || doc.linked_active_thesis_id === thesis_id)
    .filter((doc) => !bundle_id || doc.bundle_id === bundle_id)
    .filter((doc) => !strategy_id || doc.strategy_id === strategy_id)
    .filter((doc) => !session || doc.session === session)
    .filter((doc) => !mode || doc.mode === mode)
    .filter((doc) => !trading_date || (doc.trading_date || doc.date) === trading_date)
    .filter((doc) => !run_id || doc.run_id === run_id)
    .filter((doc) => !master_id || doc.linked_master_analysis_id === master_id || doc.master_id === master_id)
    .filter((doc) => isDocumentAtOrBefore(doc, as_of_utc))
    .sort((left, right) => String(right.timestamp_paris || right.saved_at || right.created_at || "").localeCompare(String(left.timestamp_paris || left.saved_at || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 1, 50)));
  return { ok: true, count: monitors.length, monitors, latest_monitor: monitors[0] || null };
}


function isOptionalEmptyNewsDigest(newsDigest) {
  return newsDigest?.empty_ok === true ||
    newsDigest?.status === "not_configured" ||
    newsDigest?.source === "no_historical_news_source_configured" ||
    newsDigest?.reason === "historical_news_digest_source_not_configured";
}



function stableLocalId(prefix, date, session, tick = new SystemClock().now(), runId = null) {
  const stamp = tick.utc.replace(/[-:.TZ]/g, "").slice(0, 14);
  const scopedSession = runId ? `${session || "session"}_${runId}` : session || "session";
  return `${prefix}_${sanitizeId(scopedSession)}_${date || "date"}_${stamp}`;
}

function normalizeDeskAnalysis(analysis) {
  const executive = analysis.executive_summary || {};
  return {
    ...analysis,
    summary: analysis.summary || executive.summary,
    primary_setup_id: analysis.primary_setup_id || executive.primary_setup_id,
    final_decision: analysis.final_decision || executive.final_decision,
    final_instrument: analysis.final_instrument || executive.final_instrument,
    final_direction: analysis.final_direction || executive.final_direction,
  };
}

function buildMasterSetupDocs(masterAnalysis, { analysis_id } = {}, tick = new SystemClock().now()) {
  const full = masterAnalysis.full_analysis || {};
  const setups = firstArray(full.setups, full.candidate_setups, full.setup_candidates, full.active_thesis?.setups);
  if (!setups.length) {
    return [];
  }
  const executive = full.executive_summary || {};
  const analysis = {
    ...full,
    ...executionScopeFields(masterAnalysis),
    analysis_id,
    pack_id: masterAnalysis.pack_id,
    pack_build_id: masterAnalysis.pack_build_id,
    report_id: masterAnalysis.report_id,
    decision_id: masterAnalysis.decision_id || full.decision_id || null,
    date: masterAnalysis.date || masterAnalysis.trading_date,
    trading_date: masterAnalysis.trading_date || masterAnalysis.date,
    session: masterAnalysis.session,
    timezone: masterAnalysis.timezone || "Europe/Paris",
    source_contract: masterAnalysis.contract_name || "DeskMasterAnalysisContract",
    schema_version: masterAnalysis.schema_version || "4.0.0",
    primary_setup_id: full.primary_setup_id || executive.primary_setup_id || full.final_setup_id || null,
    executive_summary: {
      ...executive,
      primary_setup_id: full.primary_setup_id || executive.primary_setup_id || full.final_setup_id || null,
    },
    setups,
  };
  return buildSetupDocs(analysis, { analysis_id, decision_id: analysis.decision_id }, tick).map((setup) => decorateMasterSetupDoc(setup, masterAnalysis));
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function decorateMasterSetupDoc(setup, masterAnalysis) {
  const waitSetup = setup.instrument === "WAIT" || setup.direction === "wait" || ["wait", "wait_only", "no_trade"].includes(setup.setup_type);
  const replayable = !waitSetup && hasReplayGeometry(setup);
  const status = setup.status || (waitSetup ? "wait" : setup.executable ? "executable" : "candidate");
  const inheritedReplayStatus = setup.replay_status && setup.replay_status !== "pending" ? setup.replay_status : null;
  return {
    ...setup,
    source_contract: masterAnalysis.contract_name || "DeskMasterAnalysisContract",
    schema_version: masterAnalysis.schema_version || "4.0.0",
    source_analysis_collection: COLLECTIONS.deskMasterAnalyses,
    status,
    lifecycle_status: setup.lifecycle_status || status,
    replayable,
    replay_status: inheritedReplayStatus || (waitSetup ? "wait" : replayable ? "not_replayed" : "not_replayable"),
    replay_result: setup.replay_result ?? null,
  };
}

function hasReplayGeometry(setup) {
  return Boolean(setup.entry_zone && setup.stop_loss != null && hasTakeProfitGeometry(setup.take_profits || setup.targets || setup.tp1 || setup.target));
}

function hasTakeProfitGeometry(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value != null && value !== "";
}

function buildSetupDocs(analysis, { analysis_id, decision_id } = {}, tick = new SystemClock().now()) {
  const primarySetupId = analysis.primary_setup_id || analysis.executive_summary?.primary_setup_id || analysis.executable_decision?.setup_id || null;
  return (analysis.setups || []).map((setup, index) => {
    const setup_id = String(setup.setup_id || `setup_${index + 1}`);
    const setup_record_id = setup.setup_record_id || `${sanitizeId(analysis_id)}_${sanitizeId(setup_id)}`;
    return {
      ...setup,
      ...executionScopeFields(analysis),
      setup_record_id,
      setup_id,
      analysis_id,
      pack_id: setup.pack_id || analysis.pack_id,
      pack_build_id: setup.pack_build_id || analysis.pack_build_id,
      decision_id: setup.decision_id || decision_id || null,
      report_id: setup.report_id || analysis.report_id || null,
      date: setup.date || analysis.date,
      trading_date: setup.trading_date || analysis.trading_date || analysis.date,
      session: setup.session || analysis.session,
      timezone: setup.timezone || analysis.timezone || "Europe/Paris",
      source: setup.source || "chatgpt_desk",
      environment: setup.environment || analysis.environment || deskEnvironment(),
      priority: setup.priority ?? index + 1,
      is_primary: setup_id === primarySetupId,
      lifecycle_status: setup.lifecycle_status || setup.status || "draft",
      replay_status: setup.replay_status || "pending",
      created_at: setup.created_at ?? tick.utc,
      created_at_utc: setup.created_at_utc ?? tick.utc,
      created_at_paris: setup.created_at_paris ?? tick.paris,
      saved_at: tick.utc,
      saved_at_utc: tick.utc,
      saved_at_paris: tick.paris,
    };
  });
}

function executionScopeFields(source = {}) {
  return stripUndefined({
    strategy_id: source.strategy_id,
    session: source.session,
    mode: source.mode,
    trading_date: source.trading_date || source.date,
    run_id: source.run_id || source.replay_run_id,
    replay_run_id: source.replay_run_id,
    backtest_id: source.backtest_id,
    as_of_utc: source.as_of_utc,
    cutoff_paris: source.cutoff_paris,
    cutoff_utc: source.cutoff_utc,
    timezone: source.timezone,
    resolved_scope: source.resolved_scope,
    scope_hash: source.scope_hash || source.resolved_scope?.scope_hash,
    pack_build_id: source.pack_build_id,
  });
}

function filterSetupDocs(docs, { pack_id, analysis_id, decision_id, status = "any", primary_only = false, limit = 50 } = {}) {
  const filtered = (docs || [])
    .filter((setup) => !pack_id || setup.pack_id === pack_id)
    .filter((setup) => !analysis_id || setup.analysis_id === analysis_id)
    .filter((setup) => !decision_id || setup.decision_id === decision_id)
    .filter((setup) => !primary_only || setup.is_primary === true)
    .filter((setup) => status === "any" || setup.lifecycle_status === status || setup.status === status)
    .sort((left, right) => {
      const leftDate = String(left.saved_at || left.created_at || "");
      const rightDate = String(right.saved_at || right.created_at || "");
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }
      return Number(left.priority || 999) - Number(right.priority || 999);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return {
    ok: true,
    count: filtered.length,
    filters: {
      pack_id: pack_id || null,
      analysis_id: analysis_id || null,
      decision_id: decision_id || null,
      status,
      primary_only: Boolean(primary_only),
    },
    setups: filtered,
  };
}


function replaySetupOnCandles(setup, rows, meta = {}, clock = new SystemClock()) {
  return replaySetupOutcome({ setup, candles: rows, cutoff: meta.replay_window?.to, meta, clock });
}


function replayWindowForSetup(setup, args = {}, pack = null, clock = new SystemClock()) {
  const date = setup.date || pack?.date || clock.now().utc.slice(0, 10);
  const offset = parisOffsetForDate(date);
  const cutoffParis = pack?.data_cutoff?.cutoff_paris || pack?.data_cutoff?.to_paris || pack?.data_cutoff?.timestamp_paris;
  return {
    from: args.replay_from || setup.replay_from || cutoffParis || `${date}T00:15:00${offset}`,
    to: args.replay_to || setup.replay_to || `${date}T22:30:00${offset}`,
  };
}



function strictReplaySetupFilters(args = {}) {
  const date = args.date || (!args.from_date && args.to_date ? args.to_date : (args.from_date && args.from_date === args.to_date ? args.to_date : null));
  return {
    date: date || undefined,
    from_date: date ? undefined : args.from_date,
    to_date: date ? undefined : args.to_date,
    instrument: args.instrument || "all",
    direction: args.direction || "all",
  };
}

function normalizeNyOpenPricingMode(value) {
  const text = String(value || NY_OPEN_DEFAULT_PRICING_MODE).trim().toLowerCase();
  if (["middle", "mid", "midpoint"].includes(text)) return "middle";
  if (["optimistic", "best", "best_case"].includes(text)) return "optimistic";
  return NY_OPEN_DEFAULT_PRICING_MODE;
}

function nyOpenStrictPricingModes() {
  return NY_OPEN_PRICING_MODES;
}

function selectedStrictModeResult(modeResults = [], pricing_mode) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  return modeResults.find((item) => item.pricing_mode === mode) ||
    modeResults.find((item) => item.pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE) ||
    modeResults[0] ||
    { pricing_mode: mode, replay: null, trade: null };
}

function selectNyOpenStrictSetup(setups = [], args = {}) {
  const requestedId = args.setup_id || args.setup_record_id;
  return [...(setups || [])]
    .filter((setup) => strategyDocMatches(setup, NY_OPEN_STRATEGY_ID))
    .filter((setup) => !requestedId || setupDocumentId(setup) === requestedId || setup.setup_id === requestedId || setup.setup_record_id === requestedId)
    .filter((setup) => !args.analysis_id || setup.analysis_id === args.analysis_id)
    .filter((setup) => !args.date || strategyDateFromDoc(setup) === args.date)
    .filter(isStrictReplayCandidateSetup)
    .sort((left, right) => strictSetupScore(right) - strictSetupScore(left))
    .at(0) || null;
}

function isStrictReplayCandidateSetup(setup) {
  const instrument = String(setup?.instrument || "").toUpperCase();
  const direction = String(setup?.direction || "").toLowerCase();
  const status = String(setup?.status || setup?.lifecycle_status || "").toLowerCase();
  if (!["MNQ", "MES", "NQ", "ES"].includes(instrument)) return false;
  if (!["long", "short"].includes(direction)) return false;
  if (["cancelled", "expired", "no_trade"].some((item) => status.includes(item))) return false;
  return hasReplayGeometry(setup);
}

function strictSetupScore(setup) {
  const primary = setup?.is_primary === true ? 1_000_000 : 0;
  const replayable = setup?.replayable === true ? 100_000 : 0;
  const priority = Math.max(0, 10_000 - Number(setup?.priority || 999));
  const confidence = Number(setup?.confidence_pct || 0);
  return primary + replayable + priority + confidence;
}

function nyOpenStrictReplayWindow(setup, args = {}) {
  const date = args.date || setup?.date || strategyDateFromDoc(setup) || String(new SystemClock().now().paris).slice(0, 10);
  const offset = parisOffsetForDate(date);
  return {
    from: args.replay_from || `${date}T${NY_OPEN_STRICT_ENTRY_TIME}${offset}`,
    to: args.replay_to || `${date}T${NY_OPEN_STRICT_END_TIME}${offset}`,
  };
}

function strictSetupForReplay(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  return {
    ...setup,
    executable: true,
    decision: "strict_limit_order",
    final_decision: "strict_limit_order",
    strict_mode: true,
    pricing_mode: normalizeNyOpenPricingMode(pricing_mode),
    strict_pricing_mode: normalizeNyOpenPricingMode(pricing_mode),
  };
}

function nyOpenStrictSetupPatch({ setup, modeResults = [], replayWindow, strategy_id, tick, pricing_mode }) {
  const selected = selectedStrictModeResult(modeResults, pricing_mode);
  const replay = selected.replay || null;
  const trade = selected.trade || null;
  const status = strictSetupStatusFromReplay(replay);
  const entryTime = replay?.entry?.time || null;
  const replayMap = Object.fromEntries(modeResults.map((item) => [item.pricing_mode, item.replay]).filter(([, item]) => Boolean(item)));
  const tradeIdMap = Object.fromEntries(modeResults.map((item) => [item.pricing_mode, item.trade?.trade_id || null]));
  const resultMap = Object.fromEntries(modeResults.map((item) => [item.pricing_mode, item.trade?.result_R ?? item.replay?.r_result ?? null]));
  const mode = selected.pricing_mode || normalizeNyOpenPricingMode(pricing_mode);
  return stripUndefined({
    strategy_id,
    strict_mode: true,
    strict_mode_version: "ny_open_strict_v1",
    strict_assumption: "limit_order_working_from_1535",
    strict_pricing_mode: mode,
    strict_replay_window: replayWindow,
    strict_replays: replayMap,
    strict_trade_ids: tradeIdMap,
    strict_results_R: resultMap,
    strict_replay_status: replay?.replay_status || null,
    strict_replay_result: replay || null,
    strict_trade_id: trade?.trade_id || null,
    status,
    lifecycle_status: status,
    replayable: true,
    replay_status: replay?.replay_status || null,
    replay_result: replay || null,
    triggered_at: entryTime ? normalizeUtcIso(entryTime) : undefined,
    triggered_at_utc: entryTime ? normalizeUtcIso(entryTime) : undefined,
    triggered_at_paris: entryTime || undefined,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  });
}

function strictSetupStatusFromReplay(replay) {
  const status = String(replay?.replay_status || "").toLowerCase();
  if (status === "win") return `${strictBestTargetName(replay)}_TAKEN`;
  if (status === "loss") return "STOPPED";
  if (status === "open_or_expired") return "STRICT_EOD_MARK";
  if (status === "no_fill") return "STRICT_NO_FILL";
  if (status === "review_required") return "STRICT_REVIEW_REQUIRED";
  if (status === "not_replayable") return "STRICT_NOT_REPLAYABLE";
  if (status === "rejected") return "STRICT_REJECTED";
  return "STRICT_REPLAYED";
}

function strictBestTargetName(replay) {
  return String(replay?.best_target_hit?.name || replay?.evidence?.best_target_hit?.name || replay?.evidence?.outcome || "TP1").toUpperCase();
}

function nyOpenStrictTradeFromReplay({ setup, replay, replayWindow, strategy_id, tick, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE }) {
  if (!replay?.entry || !["win", "loss", "open_or_expired"].includes(replay.replay_status)) {
    return null;
  }
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  const result_R = Number.isFinite(Number(replay.r_result)) ? roundNumber(Number(replay.r_result), 4) : null;
  const exitPrice = replay.exit?.price ?? replay.evidence?.exit_price ?? null;
  const exitTime = replay.exit?.time || replay.evidence?.exit_timestamp || replayWindow.to;
  const status = replay.replay_status === "loss" ? "STOPPED" : "CLOSED";
  const closeReason = replay.replay_status === "loss"
    ? "STOP"
    : replay.replay_status === "open_or_expired" ? "EOD_MARK" : strictBestTargetName(replay);
  return stripUndefined({
    trade_id: nyOpenStrictTradeId(setup, mode),
    strategy_id,
    strategy_name: NY_OPEN_STRATEGY_NAME,
    source: "nyopen_strict_replay",
    strict_mode: true,
    strict_mode_version: "ny_open_strict_v1",
    pricing_mode: mode,
    strict_pricing_mode: mode,
    replay_id: replay.replay_id || null,
    setup_id: setup.setup_id || setup.setup_record_id || null,
    setup_record_id: setup.setup_record_id || null,
    analysis_id: setup.analysis_id || null,
    pack_id: setup.pack_id || null,
    date: setup.date || strategyDateFromDoc(setup),
    session: NY_OPEN_SESSION,
    instrument: setup.instrument || replay.instrument || null,
    direction: setup.direction || replay.direction || null,
    status,
    close_reason: closeReason,
    entry_price: replay.entry?.price ?? replay.plan?.entry_price ?? null,
    entry_zone: setup.entry_zone || null,
    stop_loss: setup.stop_loss ?? setup.stop ?? replay.plan?.stop_loss ?? null,
    take_profits: setup.take_profits || setup.targets || [],
    exit_price: exitPrice,
    result_R,
    r_result: result_R,
    opened_at_paris: replay.entry?.time || replayWindow.from,
    executed_at_paris: replay.entry?.time || replayWindow.from,
    closed_at_paris: exitTime,
    replay_window: replayWindow,
    replay_result: replay,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  });
}

function nyOpenStrictTradeId(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  return stableVNextId("strategy_trade", setupDocumentId(setup), mode === NY_OPEN_DEFAULT_PRICING_MODE ? "nyopen_strict_v1" : `nyopen_strict_v1_${mode}`);
}

function nyOpenStrictReplayId(setup, pricing_mode, tick = new SystemClock().now()) {
  const stamp = tick.utc.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${setupDocumentId(setup)}_${normalizeNyOpenPricingMode(pricing_mode)}_${stamp}`;
}

function summarizeNyOpenStrictReplay({ setup, modeResults = [], audit, replayWindow, strategy_id, pricing_mode }) {
  const selected = selectedStrictModeResult(modeResults, pricing_mode);
  return {
    ok: true,
    strategy_id,
    strict_mode: true,
    pricing_mode: selected.pricing_mode,
    pricing_modes: NY_OPEN_PRICING_MODES,
    setup_id: setup.setup_id || null,
    setup_record_id: setup.setup_record_id || null,
    trade_id: selected.trade?.trade_id || null,
    replay_id: selected.replay?.replay_id || null,
    replay_status: selected.replay?.replay_status || null,
    outcome: selected.replay?.outcome || null,
    result_R: selected.trade?.result_R ?? selected.replay?.r_result ?? null,
    modes: Object.fromEntries(modeResults.map((item) => [item.pricing_mode, {
      trade_id: item.trade?.trade_id || null,
      replay_id: item.replay?.replay_id || null,
      replay_status: item.replay?.replay_status || null,
      outcome: item.replay?.outcome || null,
      result_R: item.trade?.result_R ?? item.replay?.r_result ?? null,
    }])),
    replay_window: replayWindow,
    audit_id: audit?.audit_id || null,
  };
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function stripDeskWorkLease(value = {}) {
  const { work_item_id: _workItemId, worker_id: _workerId, lease_token: _leaseToken, ...payload } = value;
  return payload;
}


function publicReplayError(error) {
  return String(error?.message || error || "replay_failed").slice(0, 500);
}

function localM5DatasetName(instrument) {
  const name = String(instrument || "").toUpperCase();
  if (name === "MNQ" || name === "MNQ1!") return "MNQ_M5";
  if (name === "MES" || name === "MES1!") return "MES_M5";
  return `${name}_M5`;
}

function parisOffsetForDate(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const dstStart = lastSundayUtc(year, 2);
  const dstEnd = lastSundayUtc(year, 9);
  return date >= dstStart && date < dstEnd ? "+02:00" : "+01:00";
}

function lastSundayUtc(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function sanitizeId(value) {
  return String(value || "id")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "id";
}
