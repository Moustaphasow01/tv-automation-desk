import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  buildPinnedReplaySnapshots,
  hashObject,
  maxRollingTimestamp,
  maxTimestamp,
  normalizeMonitorCadence,
  rollingInstrumentBlock,
  sourceHashPayload,
} from "./desk-replay-orchestration-algorithms.js";
import {
  compactContract,
  contractContext,
  contractHandshake,
  contractSavePayload,
} from "./desk-contract-service.js";
import { compactPack } from "./desk-pack-service.js";
import { stableVNextId } from "./desk-ids.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import {
  dedupeBy,
  offsetIso,
  publicReplayError,
  rawWindowQuality,
  resolvePackForState,
  safeRead,
} from "./desk-market-feature-algorithms.js";
import {
  crossAssetWindowForSession,
  featureInstrument,
  firstArray,
  getLatestOperationalMonitor,
  masterCutoffBundleId,
  operationalSelectorArgs,
  readFeatureContext,
  resolveOperationalReadScope,
} from "./desk-strategy-audit-algorithms.js";
import { documentTimestampUtc, isDocumentAtOrBefore } from "./desk-document-algorithms.js";

const COLLECTIONS = DESK_COLLECTIONS;

export async function buildMasterCutoffBundle(store, args = {}, clock = new SystemClock()) {
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

export async function buildManualMonitorBundle(store, args = {}, clock = new SystemClock()) {
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

export async function resolveMonitorContext(store, args = {}) {
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

export function assertOperationalDocumentScope(document, scope, errorCode = "CROSS_SCOPE_REFERENCE") {
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

export function candidateSetupsFromMaster(master) {
  const full = master?.full_analysis || {};
  return firstArray(full.setups, full.candidate_setups, full.setup_candidates, full.active_thesis?.setups).slice(0, 20);
}

export function manualMonitorCheckpoint(args = {}, tick = new SystemClock().now()) {
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

export function manualMonitorBundleId({ session, mode, checkpoint }) {
  const date = String(checkpoint.timestamp_paris).slice(0, 10);
  const hm = String(checkpoint.timestamp_paris).slice(11, 16).replace(":", "");
  return stableVNextId("manual_monitor_bundle", `${date}_${session}_${hm}`, `${checkpoint.cadence}_${mode}`);
}

export function selectMasterCutoffBundle(docs, args = {}) {
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

export function masterCutoffBundleMatchesScope(doc, args) {
  const tradingDate = args.trading_date || args.date;
  return (!tradingDate || (doc.trading_date || doc.date) === tradingDate) &&
    (!args.strategy_id || doc.strategy_id === args.strategy_id) &&
    (!args.session || doc.session === args.session) &&
    (!args.run_id || doc.run_id === args.run_id) &&
    (!args.cutoff_paris || Date.parse(doc.cutoff_paris) === Date.parse(args.cutoff_paris)) &&
    (!args.as_of_utc || Date.parse(doc.as_of_utc || doc.timestamp_utc || doc.cutoff_paris) === Date.parse(args.as_of_utc)) &&
    (!args.mode || doc.mode === args.mode);
}

export async function buildMasterCutoffRawWindows(store, { cutoff, instruments, raw_scope }) {
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

export async function buildCrossAssetRawWindows(store, { cutoff, raw_scope }) {
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

export function summarizeRawWindow(raw) {
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

export function masterCutoffDataQuality({ pack, futures_core, cross_asset, rolling, cross_delta, macro_calendar, news_digest }) {
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

export function buildMacroHorizon({ timestamp_paris, macro_calendar }) {
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

export function maxMasterRawTimestamp({ futures_core, cross_asset, rolling }) {
  const values = [
    ...Object.values(futures_core || {}).map((item) => item.last_timestamp_paris),
    ...Object.values(cross_asset || {}).map((item) => item.last_timestamp_paris),
    maxRollingTimestamp(rolling),
  ].filter(Boolean);
  return values.sort().at(-1) || null;
}

export function buildBundleDataQualityAudit({ bundle_id, data_quality, checkpoint_paris, source_hash, tick }) {
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

export async function buildRollingSnapshots(store, { date, session, timestamp_paris, instrument, include_raw_refs, raw_scope }) {
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

export function manualBundleDataQuality({ pack, activeThesis, latestMaster, macro_calendar, news_digest, features, rolling }) {
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

export function monitorPrepJobStarted(args, checkpoint, tick) {
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

export function masterPrepJobStarted(args, tick) {
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

export function monitorPrepJobLocked(existingJob, tick) {
  if (!existingJob || existingJob.status !== "LOCKED") {
    return false;
  }
  const untilMs = Date.parse(existingJob.locked_until_paris || existingJob.locked_until_utc || "");
  return Number.isFinite(untilMs) && untilMs > tick.epochMs;
}

export function monitorPrepJobCompleted(job, bundle, tick, { noRecalculation = false, featureRun = null } = {}) {
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

export function masterPrepJobCompleted(job, bundle, tick, { noRecalculation = false, featureRun = null } = {}) {
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

export function featureRunSummary(featureRun) {
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

export function monitorPrepJobFailed(job, error, tick) {
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

export function summarizeReplayBundlePrep(args, results) {
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

export function normalizeManualMonitor(monitor, tick) {
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

export function selectLatestManualMonitors(docs, {
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

export function isOptionalEmptyNewsDigest(newsDigest) {
  return newsDigest?.empty_ok === true ||
    newsDigest?.status === "not_configured" ||
    newsDigest?.source === "no_historical_news_source_configured" ||
    newsDigest?.reason === "historical_news_digest_source_not_configured";
}
