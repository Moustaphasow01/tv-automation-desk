import { createHash } from "node:crypto";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { createDeskExecutionScope, planThesisSetupPositionSplit } from "@tv-automation/desk-domain";
import { projectReplayBundle } from "./replay-bundle-view.js";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  projectReplayActiveThesis,
  recommendReplayCadenceMinutes,
} from "./replay-continuity.js";
import { compactContract } from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import { deskError } from "./desk-errors.js";
import {
  operationalQueryScope,
  resolvePackForState,
  safeRead,
} from "./desk-market-feature-algorithms.js";
import {
  compactMasterAnalysis,
  compactPackHeaderForFront,
  contractSummary,
  datasetReadinessStatus,
  getLatestOperationalMonitor,
  operationalSelectorArgs,
  readFeatureContext,
  resolveOperationalReadScope,
} from "./desk-strategy-audit-algorithms.js";
import { nextReplayAction } from "./desk-replay-orchestration-algorithms.js";
import { documentTimestampUtc, isDocumentAtOrBefore } from "./desk-document-algorithms.js";
import { resolveMonitorContext } from "./desk-live-bundle-algorithms.js";

export function assertLiveStoreWriteScope(toolName, payload = {}) {
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

export function masterAnalysisVNextId(masterAnalysis) {
  const run = masterAnalysis.run_id || masterAnalysis.resolved_scope?.run_id || null;
  const session = run ? `${masterAnalysis.session || "session"}_${run}` : masterAnalysis.session;
  return stableVNextId("master", masterAnalysis.trading_date || masterAnalysis.date, session);
}

export function hourlyMonitorVNextId(monitor) {
  return stableVNextId("monitor", monitor.linked_active_thesis_id, monitor.slot_paris || monitor.timestamp_paris);
}

export function writeTimestamps(input, existing, tick) {
  return {
    created_at: input.created_at ?? existing.created_at ?? tick.utc,
    created_at_utc: input.created_at_utc ?? existing.created_at_utc ?? tick.utc,
    created_at_paris: input.created_at_paris ?? existing.created_at_paris ?? tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function splitPositionStateFromThesis(candidate, tick) {
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

export const ACTIVE_THESIS_STATUSES = [
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

export function assertDocumentMatchesOperationalQuery(document, query, { masterId = null, thesisId = null, code = "CROSS_SCOPE_REFERENCE" } = {}) {
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

export function withOperationalMetadata(result, query, run = null) {
  const resolved_scope = operationalQueryScope(query, run);
  return {
    ...result,
    resolved_scope,
    scope_hash: run?.scope_hash || resolved_scope.scope_hash || null,
    pack_build_id: run?.pack_build_id || null,
    source_manifest_hash: run?.source_manifest_hash || null,
  };
}

export function selectActiveTheses(docs, { strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, instrument, date, status = "active", now } = {}) {
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

export function selectLatestMasterAnalysis(docs, { strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, before_date, instrument } = {}) {
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

export function selectLatestHourlyMonitors(docs, { thesis_id, strategy_id, session, mode, trading_date, run_id, backtest_id, master_id, as_of_utc, limit = 1 }) {
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

export function isThesisExpired(thesis, now = new SystemClock().now()) {
  const validUntil = thesis?.valid_until || thesis?.setup_expiry_time || thesis?.requires_replan_after || null;
  if (!validUntil) {
    return false;
  }
  const validUntilMs = Date.parse(validUntil);
  const nowMs = Date.parse(now?.paris || now?.utc || now);
  return Number.isFinite(validUntilMs) && Number.isFinite(nowMs) && validUntilMs < nowMs;
}

export function selectExpiredTheses(docs, { session, now } = {}) {
  return (docs || [])
    .filter((doc) => !session || doc.session === session || doc.session == null)
    .filter((doc) => ACTIVE_THESIS_STATUS_SET.has(doc.status))
    .filter((doc) => isThesisExpired(doc, now))
    .sort((left, right) => String(right.valid_until || right.updated_at || "").localeCompare(String(left.valid_until || left.updated_at || "")));
}

export function markThesisExpired(thesis, tick) {
  return {
    ...thesis,
    status: "EXPIRED",
    archived_reason: thesis.archived_reason || "valid_until_elapsed",
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function normalizeDeskJob(job, tick) {
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

export function patchDeskJob(existing, update, tick) {
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

export function selectDeskJobs(docs, { job_type, status, date, session, mode, limit = 50 } = {}) {
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

export function selectAlerts(docs, { date, thesis_id, limit = 50 } = {}) {
  const alerts = (docs || [])
    .filter((alert) => !date || String(alert.timestamp_paris || alert.created_at_paris || alert.created_at || "").startsWith(date))
    .filter((alert) => !thesis_id || alert.linked_thesis_id === thesis_id)
    .sort((left, right) => String(right.timestamp_paris || right.created_at || "").localeCompare(String(left.timestamp_paris || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return { ok: true, count: alerts.length, alerts };
}

export function selectActivePosition(docs, { thesis_id } = {}) {
  const positions = (docs || [])
    .filter((position) => !thesis_id || position.linked_thesis_id === thesis_id)
    .filter((position) => ["active", "protected", "partial_taken"].includes(position.status))
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
  return { ok: true, position: positions[0] || null };
}

export function dataReadiness({ pack, level, technical, cross, condition, rawWindow }) {
  return {
    pack: pack ? "ready" : "missing",
    level_map: level?.level_map ? "ready" : "missing",
    technical_events: technical?.events?.length ? "ready" : "missing",
    cross_asset_delta: cross?.delta ? "ready" : "missing",
    condition_status: condition?.condition_status ? "ready" : "not_applicable",
    raw_window: rawWindow?.ok === false ? "failing" : "unknown",
  };
}

export function compactMonitor(monitor) {
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

export function conditionList(activeThesis, conditionStatus, monitor, key) {
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

export function keyLevels(activeThesis, levelMap, latestMaster) {
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

export function deriveDeskStatus({ activeThesis, latestMonitor, latestExpiredThesis, activePosition }) {
  if (activePosition?.status === "active") return "POSITION_ACTIVE";
  if (activePosition?.status === "protected") return "POSITION_PROTECTED";
  if (!activeThesis) return latestExpiredThesis ? "EXPIRED" : "NO_ACTIVE_THESIS";
  const monitorAction = String(latestMonitor?.monitor_decision?.action || latestMonitor?.monitor_decision?.decision || "").toUpperCase();
  if (monitorAction.includes("REPLAN") || activeThesis.status === "REPLAN_REQUIRED") return "REPLAN_REQUIRED";
  if (monitorAction.includes("TRIGGER_GO") || activeThesis.status === "SETUP_TRIGGERED") return "TRIGGER_GO";
  return activeThesis.status || "WAIT";
}

export function deskColor(status) {
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

export function deriveActionNow({ desk_status, activeThesis, latestMonitor }) {
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

export function macroCrossAssetSummary(crossAssetDelta) {
  const delta = crossAssetDelta?.delta || {};
  return {
    calendar: delta.calendar || delta.macro_calendar || null,
    DXY: delta.DXY || delta.dxy || null,
    VIX: delta.VIX || delta.vix || null,
    US10Y: delta.US10Y || delta.us10y || null,
    summary: delta.summary || null,
  };
}

export async function buildLiveDeskState(store, args = {}, clock = new SystemClock()) {
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

export async function buildFrontMasterState(store, args = {}, clock = new SystemClock()) {
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

export async function buildFrontMonitorState(store, args = {}, clock = new SystemClock()) {
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

export function selectReplaySimulations(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(left.to_timestamp || left.created_at || "").localeCompare(String(right.to_timestamp || right.created_at || "")));
}

export async function claimNextDeskWorkFacade(store, args, tick) {
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

export function unifiedClaimResponse(result, workerId) {
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

export function buildOrchestratedReplayState({ runs, selectedRun, steps, timeline, monitors, positions, setups = [], simulations, activeThesis, bundles, workItems = [] }) {
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
