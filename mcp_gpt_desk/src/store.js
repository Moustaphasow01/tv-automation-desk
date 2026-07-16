import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "./persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "./tradingview-webhook.js";
import {
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  normalizeDecision,
} from "@tv-automation/desk-domain";
import {
  prepareLiveReplanMasterAfterMonitor,
} from "./live-orchestration.js";
import { DeskContractService } from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import { DeskPackService } from "./desk-pack-service.js";
import { deskError } from "./desk-errors.js";
import { DeskLiveService } from "./desk-live-service.js";
import { DeskFrontService } from "./desk-front-service.js";
import { DeskMarketFeatureService } from "./desk-market-feature-service.js";
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
  missingMasterCutoffBundle,
  NY_OPEN_STRATEGY_ID,
  operationalSelectorArgs,
  resolveOperationalReadScope,
} from "./desk-strategy-audit-algorithms.js";
import {
  compareDeskWorkItems,
  DeskReplayService,
} from "./desk-replay-service.js";
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
  simulatedTradeFromReplay,
  summarizeBacktestTrades,
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
import {
  filterSetupDocs,
  normalizeDeskAnalysis,
  stableLocalId,
  stripDeskWorkLease,
} from "./desk-document-algorithms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(__dirname, "..");
const COLLECTIONS = DESK_COLLECTIONS;

export function createDeskStoreFromEnv() {
  const mode = process.env.DESK_GPT_MCP_STORE || process.env.DESK_MCP_STORE || "postgres";
  if (mode === "postgres" || mode === "postgresql") {
    return new PersistentDeskStore(new SystemClock(), new PostgresDeskPersistence());
  }
  throw new Error(`unsupported_store_mode:${mode}`);
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
    this.market = new DeskMarketFeatureService({ persistence, clock, host: this });
    this.strategy = new DeskStrategyAuditService({ persistence, clock, host: this, market: this.market });
    this.replay = new DeskReplayService({ persistence, clock, host: this });
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

}
