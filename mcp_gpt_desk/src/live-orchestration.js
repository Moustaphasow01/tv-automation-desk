import {
  isLiveMonitorCheckpointInWindow,
  liveOperationalSelector,
  resolveLiveMasterJobInput,
  resolveLiveMonitorJobInput,
} from "./live-scope.js";
import { buildAndPublishLiveRollingPack } from "./live-pack-builder.js";
import { CANONICAL_M1_TO_M5_VERSION, CANONICAL_M5_MODE } from "./canonical-market-resampler.js";
import {
  V5_REPLAY_DATA_PROFILE_ID,
  V5_REPLAY_DATA_PROFILE_VERSION,
} from "./v5-replay-data-profile.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "./strategy-runtime-versioning.js";

const CONTINUITY_REPLAN_ACTIONS = new Set([
  "REPLAN_FULL",
  "REPLAN_REQUIRED",
  "NEW_MASTER_REQUIRED",
  "INVALIDATE_THESIS",
  "EXPIRE_SETUP",
]);

export function resolveLiveMonitorReplanAction(monitor = {}) {
  const compiled = compiledMonitorCommand(monitor);
  const nativeReplan = compiled?.replan_request || null;
  const nativeReplanType = String(nativeReplan?.type || nativeReplan?.command || "").trim().toUpperCase();
  if (["REQUEST", "REPLAN", "REPLAN_FULL", "REPLAN_REQUIRED"].includes(nativeReplanType)) return "REPLAN_FULL";

  const nativeThesisCommand = String(compiled?.thesis_command?.type || "").trim().toUpperCase();
  if (nativeThesisCommand === "INVALIDATE") return "INVALIDATE_THESIS";
  if (["REQUIRE_REPLAN", "SUPERSEDE", "EXPIRE"].includes(nativeThesisCommand)) return "REPLAN_FULL";
  if (isMonitorV2(monitor)) return null;

  const directAction = String(
    monitor.monitor_decision?.action
      || monitor.action
      || monitor.decision
      || "",
  ).trim().toUpperCase();
  if (CONTINUITY_REPLAN_ACTIONS.has(directAction)) return directAction;

  const thesisStatus = String(
    monitor.thesis_update?.status
      || monitor.context_transmission?.thesis_status
      || "",
  ).trim().toUpperCase();
  if (["THESIS_INVALIDATED", "INVALIDATED"].includes(thesisStatus)) return "INVALIDATE_THESIS";
  if (["REPLAN_REQUIRED", "REPLAN_FULL", "NEW_MASTER_REQUIRED"].includes(thesisStatus)) {
    return thesisStatus;
  }

  const setupAction = String(monitor.monitor_decision?.setup_action || "").trim().toUpperCase();
  if (setupAction.includes("REPLAN")) return "REPLAN_REQUIRED";
  if (monitor.thesis_update?.requires_replan_after) return "REPLAN_REQUIRED";

  const decision = String(monitor.monitor_decision?.decision || "").trim().toUpperCase();
  return CONTINUITY_REPLAN_ACTIONS.has(decision) ? decision : null;
}
export function resolveLiveMonitorReplanCheckpoint(monitor = {}, fallback = null) {
  const monitorCheckpoint = monitor.timestamp_paris || monitor.checkpoint || monitor.cutoff_paris || fallback;
  const compiledRequest = compiledMonitorCommand(monitor)?.replan_request;
  const requestedCheckpoint = isMonitorV2(monitor)
    ? compiledRequest?.requested_at_paris || monitorCheckpoint
    : compiledRequest?.requested_at_paris
      || monitor.replan_request?.requested_at_paris
      || monitor.monitor_output?.command?.replan_request?.requested_at_paris
      || monitor.thesis_update?.requires_replan_after
      || monitor.context_transmission?.next_checkpoints?.[0]
      || monitorCheckpoint;
  const requestedMs = Date.parse(requestedCheckpoint || "");
  const monitorMs = Date.parse(monitorCheckpoint || "");
  if (!Number.isFinite(requestedMs)) return monitorCheckpoint || null;
  if (Number.isFinite(monitorMs) && requestedMs < monitorMs) return monitorCheckpoint;
  if (monitorCheckpoint && String(requestedCheckpoint).slice(0, 10) !== String(monitorCheckpoint).slice(0, 10)) {
    return monitorCheckpoint;
  }
  return requestedCheckpoint;
}
function isMonitorV2(monitor = {}) {
  return String(monitor.schema_version || monitor.contract_version || "") === ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract
    || String(monitor.monitor_output?.contract?.version || "") === ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract;
}

function compiledMonitorCommand(monitor = {}) {
  const compiled = monitor.deterministic_monitor_command;
  if (compiled && typeof compiled === "object" && !Array.isArray(compiled)) return compiled;
  if (isMonitorV2(monitor)) {
    const error = new Error("live_monitor_v2_compiled_command_missing");
    error.code = "LIVE_MONITOR_V2_COMPILED_COMMAND_MISSING";
    throw error;
  }
  return null;
}

export async function prepareDueLiveMasterBundle(store, args = {}, {
  now = Date.now(),
  buildLiveRollingPack = buildAndPublishLiveRollingPack,
} = {}) {
  const payload = resolveLiveMasterJobInput(args, now);
  const livePack = await ensureLiveRollingPackCoverage(store, {
    ...payload,
    timestamp_paris: payload.cutoff_paris,
  }, { buildLiveRollingPack });
  const result = await store.prepareMasterCutoffBundleJob(payload);
  return {
    ...result,
    workflow: args.workflow || null,
    live_pack: livePack,
    resolved_job_input: payload,
  };
}

export async function prepareLiveReplanMasterAfterMonitor(store, monitor = {}) {
  const action = resolveLiveMonitorReplanAction(monitor);
  if (!action) {
    return { ok: true, status: "skipped", skipped: true, skipped_reason: "monitor_does_not_request_replan" };
  }

  const cutoffParis = resolveLiveMonitorReplanCheckpoint(monitor);
  const session = monitor.session;
  if (!cutoffParis || !["asia_open", "ny_open"].includes(session)) {
    return { ok: false, status: "failed", skipped: false, error: "LIVE_REPLAN_SCOPE_INCOMPLETE" };
  }
  if (Date.parse(cutoffParis) > Date.now()) {
    return {
      ok: true,
      status: "pending",
      skipped: false,
      trigger_action: action,
      replan_cutoff_paris: cutoffParis,
      next_eligible_at_utc: new Date(cutoffParis).toISOString(),
    };
  }

  const tradingDate = monitor.trading_date || monitor.date || String(cutoffParis).slice(0, 10);
  const payload = resolveLiveMasterJobInput({
    workflow: session === "ny_open" ? "ny_open" : "asia_open",
    trading_date: tradingDate,
    cutoff_paris: cutoffParis,
    as_of_utc: new Date(cutoffParis).toISOString(),
    run_id: monitor.run_id,
    mode: "live",
    include_raw_refs: true,
    save: true,
    enqueue_agent_work: false,
  }, cutoffParis);
  const result = await store.prepareMasterCutoffBundleJob(payload);
  return {
    ...result,
    status: result.ok === false ? "failed" : "prepared",
    skipped: false,
    trigger_action: action,
    replan_cutoff_paris: cutoffParis,
    resolved_job_input: payload,
  };
}

export async function resolveDueLiveMonitorContext(store, args = {}, { now = Date.now() } = {}) {
  const scope = resolveLiveMonitorJobInput(args, now);
  if (!isLiveMonitorCheckpointInWindow(scope.session, scope.timestamp_paris)) {
    return skippedMonitor(scope, "outside_live_monitor_window");
  }

  const selector = liveOperationalSelector(scope);
  const master = await store.getLatestMasterAnalysis(selector).then((result) => result.analysis);
  if (!master?.analysis_id) {
    return skippedMonitor(scope, "master_not_materialized");
  }

  const thesis = await store.getActiveThesis({
    ...selector,
    master_id: master.analysis_id,
    status: args.catchup_mode === true ? "any" : "active",
  }).then((result) => result.active_thesis);
  if (!thesis?.thesis_id) {
    return skippedMonitor(scope, "active_thesis_not_materialized", { master_id: master.analysis_id });
  }

  return {
    ok: true,
    status: "ready",
    skipped: false,
    strategy_id: scope.strategy_id,
    session: scope.session,
    trading_date: scope.trading_date,
    checkpoint_paris: scope.timestamp_paris,
    master_id: master.analysis_id,
    thesis_id: thesis.thesis_id,
    payload: {
      ...scope,
      master_id: master.analysis_id,
      thesis_id: thesis.thesis_id,
    },
  };
}

export async function prepareDueLiveMonitorBundle(store, args = {}, {
  now = Date.now(),
  buildLiveRollingPack = buildAndPublishLiveRollingPack,
} = {}) {
  const context = await resolveDueLiveMonitorContext(store, args, { now });
  if (context.skipped) {
    if (!["master_not_materialized", "active_thesis_not_materialized"].includes(context.skipped_reason)) return context;
    const continuity_recovery = await reconcileLiveDeskContinuity(store, args, { now });
    return {
      ...context,
      status: continuity_recovery.status === "prepared" || continuity_recovery.status === "pending" ? "recovery_pending" : context.status,
      continuity_recovery,
    };
  }
  const livePack = await ensureLiveRollingPackCoverage(store, context.payload, { buildLiveRollingPack });
  const paperExecution = typeof store?.reconcileLivePaperExecution === "function"
    ? await store.reconcileLivePaperExecution({
        ...context.payload,
        pack_id: livePack.pack_id,
        pack_build_id: livePack.pack_build_id,
      })
    : null;
  const result = await store.prepareM15MonitorBundleJob(context.payload);
  return {
    ...result,
    skipped: false,
    checkpoint_paris: context.checkpoint_paris,
    master_id: context.master_id,
    thesis_id: context.thesis_id,
    live_pack: livePack,
    paper_execution: paperExecution,
    resolved_job_input: context.payload,
  };
}

export async function reconcileLiveDeskContinuity(store, args = {}, { now = Date.now() } = {}) {
  const scope = resolveLiveMonitorJobInput(args, now);
  const selector = liveOperationalSelector(scope);
  const pending = await readPendingLiveMasterCursor(store, scope);
  if (pending) {
    return {
      ok: true,
      status: "pending",
      recovery_mode: true,
      reason: "live_master_already_pending",
      cursor_id: pending.cursor_id,
      cursor_status: pending.cursor_status,
    };
  }

  const master = await store.getLatestMasterAnalysis(selector).then((result) => result.analysis).catch(() => null);
  if (!master?.analysis_id) {
    const workflow = scope.session === "ny_open" ? "ny_open" : "asia_open";
    const result = await prepareDueLiveMasterBundle(store, {
      workflow,
      trading_date: scope.trading_date,
      run_id: scope.run_id,
      mode: "live",
      include_raw_refs: true,
      save: true,
      enqueue_agent_work: false,
    }, { now });
    return continuityRecoveryResult(result, {
      reason: "master_missing_recovery",
      recovery_cutoff_paris: result.resolved_job_input?.cutoff_paris || null,
    });
  }

  const activeThesis = await store.getActiveThesis({
    ...selector,
    master_id: master.analysis_id,
    status: "active",
  }).then((result) => result.active_thesis).catch(() => null);
  const activeThesisExpired = liveThesisExpiredAt(activeThesis, scope.timestamp_paris || scope.as_of_utc || now);
  if (activeThesis?.thesis_id && !activeThesisExpired) {
    return { ok: true, status: "healthy", recovery_mode: false, reason: "active_thesis_available" };
  }

  const monitorResult = await store.getLatestManualMonitor({
    strategy_id: scope.strategy_id,
    session: scope.session,
    mode: "live",
    trading_date: scope.trading_date,
    run_id: scope.run_id,
    as_of_utc: scope.as_of_utc,
    limit: 50,
  }).catch(() => ({ monitors: [] }));
  const masterCutoffMs = Date.parse(master.as_of_utc || master.cutoff_paris || master.created_at_paris || "");
  const replanMonitor = (monitorResult.monitors || [])
    .filter((monitor) => {
      const checkpointMs = Date.parse(monitor.timestamp_paris || monitor.created_at_paris || "");
      return (!Number.isFinite(masterCutoffMs) || checkpointMs > masterCutoffMs)
        && CONTINUITY_REPLAN_ACTIONS.has(monitorAction(monitor));
    })
    .sort((left, right) => Date.parse(right.timestamp_paris || right.created_at_paris || "") - Date.parse(left.timestamp_paris || left.created_at_paris || ""))[0] || null;

  if (replanMonitor) {
    const result = await prepareLiveReplanMasterAfterMonitor(store, replanMonitor);
    return continuityRecoveryResult(result, {
      reason: "replan_monitor_reconciled",
      trigger_monitor_id: replanMonitor.monitor_id || null,
      trigger_action: monitorAction(replanMonitor),
      recovery_cutoff_paris: replanMonitor.timestamp_paris || replanMonitor.created_at_paris || null,
    });
  }

  const masterCutoff = scope.timestamp_paris || scope.cutoff_paris || scope.as_of_utc;
  const result = await prepareDueLiveMasterBundle(store, {
    workflow: scope.session === "ny_open" ? "ny_open" : "asia_open",
    trading_date: scope.trading_date,
    cutoff_paris: masterCutoff,
    as_of_utc: new Date(masterCutoff).toISOString(),
    run_id: scope.run_id,
    mode: "live",
    include_raw_refs: true,
    save: true,
    enqueue_agent_work: false,
  }, { now });
  return continuityRecoveryResult(result, {
    reason: activeThesisExpired
      ? "expired_thesis_replanned_at_current_checkpoint"
      : "master_without_active_thesis_reconciled",
    expired_thesis_id: activeThesisExpired ? activeThesis?.thesis_id || null : null,
    recovery_cutoff_paris: masterCutoff,
  });
}

function liveThesisExpiredAt(thesis, checkpoint) {
  if (!thesis?.thesis_id) return false;
  const expiry = thesis.valid_until_paris
    || thesis.valid_until
    || thesis.requires_replan_after_paris
    || thesis.requires_replan_after
    || thesis.setup_expiry_time
    || null;
  const expiryMs = Date.parse(expiry || "");
  const checkpointMs = typeof checkpoint === "number" ? checkpoint : Date.parse(checkpoint || "");
  return Number.isFinite(expiryMs)
    && Number.isFinite(checkpointMs)
    && checkpointMs >= expiryMs;
}

export async function ensureLiveRollingPackCoverage(store, scope, {
  buildLiveRollingPack = buildAndPublishLiveRollingPack,
} = {}) {
  const packId = `${scope.trading_date}_${scope.session}`;
  const requestedMs = Date.parse(scope.as_of_utc || scope.timestamp_paris);
  if (!Number.isFinite(requestedMs)) {
    throw new Error(`LIVE_PACK_CHECKPOINT_INVALID:${scope.as_of_utc || scope.timestamp_paris || "missing"}`);
  }

  const existing = await readActivePack(store, packId);
  const existingCoverageMs = packCoverageEndMs(existing);
  if (store?.livePackPublishingEnabled === false) {
    return livePackSummary(existing || { pack_id: packId }, {
      reused: true,
      requestedMs,
      publishingSkipped: true,
    });
  }
  if (isLiveRollingPack(existing) && existingCoverageMs >= requestedMs) {
    if (hasStrictLiveFreshness(existing)) {
      return livePackSummary(existing, { reused: true, requestedMs });
    }
  }

  const buildCheckpoint = existingCoverageMs > requestedMs
    ? existing?.data_cutoff?.end_paris || existing?.source_coverage?.end_paris || scope.timestamp_paris
    : scope.timestamp_paris;
  const publisher = typeof store?.buildAndPublishLiveRollingPack === "function"
    ? store.buildAndPublishLiveRollingPack.bind(store)
    : buildLiveRollingPack;
  await publisher({
    date: scope.trading_date,
    session: scope.session,
    checkpoint_paris: buildCheckpoint,
  });

  const refreshed = await readActivePack(store, packId);
  const refreshedCoverageMs = packCoverageEndMs(refreshed);
  if (!isLiveRollingPack(refreshed) || refreshedCoverageMs < requestedMs || !hasStrictLiveFreshness(refreshed)) {
    throw new Error(`LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT:${packId}:${scope.as_of_utc}`);
  }
  return livePackSummary(refreshed, { reused: false, requestedMs });
}

function skippedMonitor(scope, reason, extra = {}) {
  return {
    ok: true,
    status: "skipped",
    skipped: true,
    skipped_reason: reason,
    strategy_id: scope.strategy_id,
    session: scope.session,
    trading_date: scope.trading_date,
    checkpoint_paris: scope.timestamp_paris,
    ...extra,
  };
}

async function readPendingLiveMasterCursor(store, scope) {
  if (typeof store?.getLiveRunCursor !== "function") return null;
  const result = await store.getLiveRunCursor({
    trading_date: scope.trading_date,
    session: scope.session,
  }).catch(() => null);
  const cursor = result?.cursor || null;
  if (cursor?.attempt?.workflow !== "LIVE_MASTER") return null;
  if (!["PENDING", "LEASED"].includes(cursor.attempt.status)) return null;
  return cursor;
}

function continuityRecoveryResult(result, details = {}) {
  const ok = result?.ok !== false;
  return {
    ok,
    status: ok ? "prepared" : "failed",
    recovery_mode: true,
    cursor_id: result?.cursor_id || null,
    error: result?.error || null,
    ...details,
  };
}

function monitorAction(monitor) {
  return resolveLiveMonitorReplanAction(monitor);
}

async function readActivePack(store, packId) {
  if (typeof store?.getDeskPack !== "function") return null;
  return store.getDeskPack({ pack_id: packId, mode: "live", include_draft: false }).catch(() => null);
}

function isLiveRollingPack(pack) {
  return pack?.pack_purpose === "live_rolling" || pack?.source_coverage?.mode === "live_rolling_checkpoint";
}

function hasStrictLiveFreshness(pack) {
  const quality = pack?.quality || {};
  if (pack?.data_profile_id !== V5_REPLAY_DATA_PROFILE_ID
    || pack?.data_profile_version !== V5_REPLAY_DATA_PROFILE_VERSION
    || quality.freshness_policy_version !== "1.2.0"
    || pack?.canonical_m5_mode !== CANONICAL_M5_MODE
    || pack?.canonical_resampler_version !== CANONICAL_M1_TO_M5_VERSION) {
    return false;
  }
  const freshness = quality.dataset_freshness || {};
  const strictCanonical = ["MNQ_M1", "MES_M1", "MNQ_M5", "MES_M5"];
  const requiredContext = ["NQ_H1", "ES_H1", "MNQ_H4", "MES_H4", "NQ_H4", "ES_H4"];
  const derivedLineage = [
    ["MNQ_M5", "MNQ_M1", "prod__tradingview__MNQ1!__1"],
    ["MES_M5", "MES_M1", "prod__tradingview__MES1!__1"],
  ];
  return strictCanonical.every((dataset) => freshness[dataset]?.status === "fresh")
    && requiredContext.every((dataset) => ["fresh", "stale"].includes(freshness[dataset]?.status))
    && derivedLineage.every(([dataset, sourceDataset, sourceFeedId]) => {
      const ref = pack?.datasets?.[dataset] || {};
      return ref.source === "canonical_derived_m1"
        && ref.source_dataset === sourceDataset
        && ref.derivation_version === CANONICAL_M1_TO_M5_VERSION
        && Array.isArray(ref.source_feed_ids)
        && ref.source_feed_ids.length === 1
        && ref.source_feed_ids[0] === sourceFeedId;
    });
}

function packCoverageEndMs(pack) {
  const value = pack?.source_coverage?.end_utc ||
    pack?.data_cutoff?.end_utc ||
    pack?.cutoff_utc ||
    pack?.resolved_scope?.cutoff_utc ||
    pack?.source_coverage?.end_paris ||
    pack?.data_cutoff?.end_paris ||
    pack?.data_cutoff?.cutoff_paris;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function livePackSummary(pack, { reused, requestedMs, publishingSkipped = false }) {
  const coverageMs = packCoverageEndMs(pack);
  return {
    ok: true,
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id || pack.active_build_id || null,
    pack_purpose: pack.pack_purpose || pack.source_coverage?.mode || null,
    source_coverage_end_utc: Number.isFinite(coverageMs) ? new Date(coverageMs).toISOString() : null,
    requested_as_of_utc: new Date(requestedMs).toISOString(),
    coverage_sufficient: coverageMs >= requestedMs,
    freshness_policy_version: pack.quality?.freshness_policy_version || null,
    strict_freshness_satisfied: hasStrictLiveFreshness(pack),
    publishing_skipped: publishingSkipped,
    reused,
  };
}
