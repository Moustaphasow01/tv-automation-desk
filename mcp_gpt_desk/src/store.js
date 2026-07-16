import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "./persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "./tradingview-webhook.js";
import {
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  createDeskExecutionScope,
  normalizeDecision,
  planThesisSetupPositionSplit,
} from "@tv-automation/desk-domain";
import { projectReplayBundle } from "./replay-bundle-view.js";
import {
  prepareLiveReplanMasterAfterMonitor,
} from "./live-orchestration.js";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  projectReplayActiveThesis,
  recommendReplayCadenceMinutes,
} from "./replay-continuity.js";
import {
  DeskContractService,
  compactContract,
  contractContext,
  contractHandshake,
  contractSavePayload,
} from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import {
  DeskPackService,
  compactPack,
} from "./desk-pack-service.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { DeskLiveService } from "./desk-live-service.js";
import { DeskFrontService } from "./desk-front-service.js";
import { DeskMarketFeatureService } from "./desk-market-feature-service.js";
import {
  assertReplayRunMatchesQuery,
  canonicalTimeframe,
  dedupeBy,
  marketFeedCandidates,
  normalizeOperationalQuery,
  offsetIso,
  operationalQueryScope,
  publicReplayError,
  rawWindowQuality,
  resolvePackForState,
  roundNumber,
  safeRead,
} from "./desk-market-feature-algorithms.js";
import { DeskStrategyAuditService } from "./desk-strategy-audit-service.js";
import {
  activeThesisVNextId,
  compactMasterAnalysis,
  compactPackHeaderForFront,
  contractSummary,
  crossAssetWindowForSession,
  datasetReadinessStatus,
  featureInstrument,
  firstArray,
  getLatestOperationalMonitor,
  hasReplayGeometry,
  masterCutoffBundleId,
  missingMasterCutoffBundle,
  NY_OPEN_STRATEGY_ID,
  operationalSelectorArgs,
  readFeatureContext,
  resolveOperationalReadScope,
} from "./desk-strategy-audit-algorithms.js";
import {
  compareDeskWorkItems,
  DeskReplayService,
} from "./desk-replay-service.js";
import {
  buildMasterSetupDocs,
  buildPinnedReplaySnapshots,
  buildSetupDocs,
  deskEnvironment,
  executionScopeFields,
  hashObject,
  maxRollingTimestamp,
  maxTimestamp,
  nextReplayAction,
  normalizeMonitorCadence,
  patchReplayRun,
  replayTimelineEvent,
  rollingInstrumentBlock,
  sanitizeId,
  selectBacktestSteps,
  selectReplayActiveThesis,
  selectReplayBundles,
  selectReplayMonitors,
  selectReplayPositions,
  selectReplayScopedSetups,
  selectReplayTimeline,
  sourceHashPayload,
} from "./desk-replay-orchestration-algorithms.js";

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

function manualMonitorBundleId({ session, mode, checkpoint }) {
  const date = String(checkpoint.timestamp_paris).slice(0, 10);
  const hm = String(checkpoint.timestamp_paris).slice(11, 16).replace(":", "");
  return stableVNextId("manual_monitor_bundle", `${date}_${session}_${hm}`, `${checkpoint.cadence}_${mode}`);
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

function stripDeskWorkLease(value = {}) {
  const { work_item_id: _workItemId, worker_id: _workerId, lease_token: _leaseToken, ...payload } = value;
  return payload;
}
