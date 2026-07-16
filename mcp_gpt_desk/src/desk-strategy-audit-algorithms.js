import { createDeskExecutionScope } from "@tv-automation/desk-domain";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { compactContract, contractContext, contractSavePayload } from "./desk-contract-service.js";
import { deskError } from "./desk-errors.js";
import { stableVNextId } from "./desk-ids.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { floorParisCheckpoint, isLiveMonitorCheckpointInWindow } from "./live-scope.js";
import {
  dedupeBy,
  numeric,
  parisOffsetForDate,
  publicReplayError,
  resolvePackForState,
  roundNumber,
  safeRead,
} from "./desk-market-feature-algorithms.js";

export const NY_OPEN_STRATEGY_ID = "ny_open_1530";
export const NY_OPEN_STRATEGY_NAME = "NY Open 15:30";
export const NY_OPEN_SESSION = "ny_open";
export const NY_OPEN_CUTOFF_TIME = "15:30:00";
export const NY_OPEN_STRICT_ENTRY_TIME = "15:35:00";
export const NY_OPEN_STRICT_END_TIME = "22:30:00";
export const NY_OPEN_PRICING_MODES = ["conservative", "middle", "optimistic"];
export const NY_OPEN_DEFAULT_PRICING_MODE = "conservative";

export function activeThesisVNextId(thesis) {
  return stableVNextId("thesis", thesis.linked_master_analysis_id || thesis.valid_from, thesis.instrument);
}

export function dateForState(args, tick) {
  return args.trading_date || args.date || String(tick.paris || tick.utc).slice(0, 10);
}

export function contractSummary(contracts) {
  return {
    master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
    monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
  };
}

export function featureInstrument(activeThesis, latestMaster) {
  const value = activeThesis?.instrument ||
    latestMaster?.full_analysis?.executive_summary?.final_instrument ||
    latestMaster?.instrument ||
    "MNQ";
  return ["MNQ", "MES", "NQ", "ES"].includes(value) ? value : "MNQ";
}

export async function readFeatureContext(store, { date, session, activeThesis, latestMaster, timestamp_paris }) {
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

export function crossAssetWindowForSession(session, timestampParis) {
  if (session !== "asia_open") {
    return "1h";
  }
  return parisDateWeekday(timestampParis) === 1 ? "session" : "4h";
}

export function parisDateWeekday(timestampParis) {
  const [year, month, day] = String(timestampParis || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function datasetReadinessStatus(ref) {
  if (!ref) {
    return "missing";
  }
  return ref.status === "not_configured" || ref.empty_ok === true ? "not_configured" : "ready";
}

export function compactMasterAnalysis(analysis) {
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

export function preferredSetupFromMasterFull(full = {}) {
  const setups = firstArray(full.setups, full.candidate_setups, full.setup_candidates, full.active_thesis?.setups);
  if (!setups.length) return null;
  const primaryId = full.primary_setup_id || full.executive_summary?.primary_setup_id || full.final_setup_id || null;
  return setups.find((setup) => primaryId && setup?.setup_id === primaryId) ||
    setups.find((setup) => setup?.is_primary === true) ||
    setups.find(isStrictReplayCandidateSetup) ||
    setups[0] ||
    null;
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export async function getLatestOperationalMonitor(store, args = {}) {
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

export async function buildAuditState(store, args = {}, featureDocs = {}, clock = new SystemClock()) {
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

export async function buildNyOpenStrategyState(store, args = {}, clock = new SystemClock()) {
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

export function nyOpenCutoffParis(date) {
  return `${date}T${NY_OPEN_CUTOFF_TIME}${parisOffsetForDate(date)}`;
}

export function nyOpenOperationalScope(date, asOfParis = nyOpenCutoffParis(date)) {
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

export function nyOpenStateAsOfParis(date, tick) {
  const currentDate = String(tick.paris || tick.utc).slice(0, 10);
  if (date === currentDate) return tick.paris;
  if (date < currentDate) return `${date}T23:59:59${parisOffsetForDate(date)}`;
  return nyOpenCutoffParis(date);
}

export function normalizeNyOpenBundlePrep(result, { date, cutoff_paris }) {
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

export function compactMasterCutoffBundleForFront(bundle) {
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

export function compactPackHeaderForFront(pack) {
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

export function selectStrategyDocuments({
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

export function strategyDocMatches(doc, strategy_id = NY_OPEN_STRATEGY_ID) {
  if (!doc) return false;
  const docStrategy = doc.strategy_id || doc.strategy?.strategy_id || doc.linked_strategy_id || doc.strategy;
  if (docStrategy === strategy_id) return true;
  if (docStrategy && docStrategy !== strategy_id) return false;
  return strategy_id === NY_OPEN_STRATEGY_ID && strategySessionMatches(doc, NY_OPEN_SESSION);
}

export function requireStrategyId(args = {}) {
  const strategyId = String(args.strategy_id || "").trim();
  if (!strategyId) throw deskError("SCOPE_REQUIRED", "strategy_id is required.", { field: "strategy_id" });
  return strategyId;
}

export function resolveStrategySelection(args = {}) {
  if (args.aggregate_across_strategies === true) return "all";
  return requireStrategyId(args);
}

export function strategySessionMatches(doc, session) {
  return doc?.session === session || doc?.desk_session === session || doc?.strategy_session === session;
}

export function sortStrategyDocs(docs) {
  return [...(docs || [])].sort((left, right) => String(strategyTimestampFromDoc(right)).localeCompare(String(strategyTimestampFromDoc(left))));
}

export function setupDocumentId(setup) {
  return setup?.setup_record_id || setup?.setup_id || setup?.id || stableVNextId("setup", setup?.date || strategyDateFromDoc(setup), setup?.instrument || "setup");
}

export function filterStrategyTrades(trades, args = {}, strategy_id = NY_OPEN_STRATEGY_ID) {
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

export function filterStrategySetups(setups, args = {}, strategy_id = NY_OPEN_STRATEGY_ID) {
  return (setups || [])
    .filter((setup) => !strategy_id || strategyDocMatches(setup, strategy_id))
    .filter((setup) => withinStrategyDateRange(setup, args))
    .filter((setup) => args.instrument === "all" || !args.instrument || setup.instrument === args.instrument)
    .filter((setup) => args.direction === "all" || !args.direction || setup.direction === args.direction)
    .filter((setup) => !args.setup_type || setup.setup_type === args.setup_type)
    .filter((setup) => !args.only_triggered_setups || isTriggeredSetupForPricingMode(setup, args.pricing_mode))
    .sort((left, right) => String(strategyTimestampFromDoc(left)).localeCompare(String(strategyTimestampFromDoc(right))));
}

export function withinStrategyDateRange(doc, { from_date, to_date, date } = {}) {
  const docDate = strategyDateFromDoc(doc);
  if (!docDate) return true;
  if (date && docDate !== date) return false;
  if (from_date && docDate < from_date) return false;
  if (to_date && docDate > to_date) return false;
  return true;
}

export function strategyDateFromDoc(doc) {
  return doc?.date || doc?.trade_date || String(strategyTimestampFromDoc(doc) || "").slice(0, 10) || null;
}

export function strategyTimestampFromDoc(doc) {
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

export function isTriggeredSetup(setup) {
  const status = String(setup?.status || setup?.lifecycle_status || "").toLowerCase();
  return status.includes("trigger") || status.includes("tp") || status.includes("stop") || Boolean(setup?.triggered_at_paris);
}

export function isTriggeredSetupForPricingMode(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  const replay = setup?.strict_replays?.[mode] || (mode === NY_OPEN_DEFAULT_PRICING_MODE ? setup?.strict_replay_result || setup?.replay_result : null);
  if (replay) {
    const status = String(replay.replay_status || "").toLowerCase();
    return Boolean(replay.entry) || ["win", "loss", "open_or_expired"].includes(status);
  }
  return isTriggeredSetup(setup);
}

export function isNyOpenStrictTrade(trade) {
  return trade?.strict_mode === true || trade?.source === "nyopen_strict_replay" || String(trade?.trade_id || "").includes("nyopen_strict_v1");
}

export function tradePricingMode(trade) {
  return normalizeNyOpenPricingMode(trade?.pricing_mode || trade?.strict_pricing_mode);
}

export function isActiveTradeStatus(status) {
  return ["open", "active", "partial", "partial_taken", "tp1_taken", "tp2_taken"].includes(String(status || "").toLowerCase());
}

export function isExecutedTrade(trade) {
  return Boolean(trade?.executed_at_paris || trade?.entry_price || trade?.entry || trade?.trade_id || isActiveTradeStatus(trade?.status) || isClosedTrade(trade));
}

export function isClosedTrade(trade) {
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

export function tradeResultR(trade, exits = []) {
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

export function tradeResultRFromGeometry(trade) {
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

export function emptyStrategyPerformance(strategy_id, args = {}) {
  return buildStrategyPerformance({ strategy_id, trades: [], setups: [], args });
}

export function buildStrategyPerformance({ strategy_id, trades = [], setups = [], tradeExits = [], args = {} } = {}) {
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

export function equityCurveFromTrades(results, strategy_id, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
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

export function maxDrawdownFromCurve(curve) {
  const values = (curve || []).map((point) => numeric(point.drawdown_R, 0));
  const max_drawdown_R = values.length ? Math.min(...values) : 0;
  return {
    max_drawdown_R: roundNumber(max_drawdown_R, 4) || 0,
    current_drawdown_R: curve?.length ? roundNumber(curve.at(-1).drawdown_R, 4) || 0 : 0,
  };
}

export function dailyPerformanceFromResults(results, strategy_id, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
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

export function recomputeStrategyPerformanceDocs(docs, args = {}, tick = new SystemClock().now()) {
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

export function buildStrategyCalendar(docs, args = {}, clock = new SystemClock()) {
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

export function buildStrategyDayDetail(docs, args = {}) {
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

export function buildLiveTimelineEventDetail(docs, args = {}) {
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

export function filterStrategyDate(docs, date) {
  return sortStrategyDocs((docs || []).filter((doc) => !date || strategyDateFromDoc(doc) === date));
}

export function groupByDate(docs) {
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

export function strategyDailyStatus({ dayPerf, trades, master, pack }) {
  if ((trades || []).some((trade) => isActiveTradeStatus(trade.status))) return "open_position";
  if (dayPerf?.total_R > 0) return "win";
  if (dayPerf?.total_R < 0) return "loss";
  if (dayPerf?.closed_trades > 0) return "flat";
  if (pack && pack.status && pack.status !== "ready") return "data_degraded";
  if (!master) return "master_missing";
  return "no_trade";
}

export function buildStrategyTimeline({ masters, theses, setups, monitors, trades }) {
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

export function buildLiveSessionTimelineEvents(docs, args = {}) {
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

export function liveTimelineEvent(entityType, entityId, timestampParis, fields = {}) {
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

export function buildMissingMonitorEvents(monitors, args = {}) {
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

export function buildLiveContinuitySummary(docs, args = {}) {
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

export function projectMonitorTimelineDetail(monitor, previous, event) {
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

export function projectWorkTimelineDetail(workItem, workEvent, event) {
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

export function projectGapTimelineDetail(event) {
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

export function projectGenericTimelineDetail(docs, event) {
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

export function timelineDetailSection(key, title, summary, items = []) {
  return { key, title, summary: summary || null, items: items.filter((item) => item?.value) };
}

export function detailItem(label, value, tone = "neutral") {
  const readable = readableTimelineValue(value);
  return readable ? { label, value: readable, tone } : null;
}

export function detailItemsFromValue(label, value, limit = 6, tone = "neutral") {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.slice(0, limit).map((item, index) => detailItem(`${label} ${index + 1}`, item, tone)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value).slice(0, limit).map(([key, item]) => detailItem(humanTimelineLabel(key), item, tone)).filter(Boolean);
  }
  return [detailItem(label, value, tone)].filter(Boolean);
}

export function readableTimelineValue(value) {
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

export function firstNarrative(...values) {
  for (const value of values) {
    const readable = readableTimelineValue(value);
    if (readable) return readable;
  }
  return null;
}

export function humanTimelineLabel(value) {
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

export function timelineEventTone(value) {
  const status = String(value || "").toUpperCase();
  if (/(FAILED|MISSING|INVALID|EXPIRE|REPLAN|CANCEL|CRITICAL)/.test(status)) return "critical";
  if (/(RISK|WEAK|WAIT|RETRY|WARNING|READY)/.test(status)) return "warning";
  if (/(TRIGGER|ACTIVE|COMPLETED|HEALTHY|SUCCESS)/.test(status)) return "success";
  return "info";
}

export function continuityWorkSummary(item) {
  if (!item) return "Aucun travail d'orchestration associé.";
  if (item.status === "CLAIMED") return "Le worker traite actuellement ce travail.";
  if (item.status === "READY") return "Le travail est prêt pour le prochain réveil du worker.";
  if (item.status === "FAILED") return "Le travail requiert un réarmement avant reprise.";
  return `État du travail : ${item.status || "inconnu"}.`;
}

export function compactStrategyMaster(master) {
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

export function compactStrategyThesis(thesis) {
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

export function compactStrategySetup(setup, args = {}) {
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

export function setupTakeProfitMap(value) {
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

export function compactStrategyMonitor(monitor) {
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

export function compactStrategyTrade(trade) {
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

export function deriveNyOpenStrategyStatus({ master, setup, trade, activeThesis }) {
  if (trade && isActiveTradeStatus(trade.status)) return "POSITION_ACTIVE";
  if (trade && isClosedTrade(trade)) return "TRADE_CLOSED";
  if (setup && isTriggeredSetup(setup)) return "SETUP_TRIGGERED";
  if (setup) return "SETUP_CANDIDATE";
  if (activeThesis) return activeThesis.status || "WAIT_MONITORED";
  if (master) return "MASTER_SAVED";
  return "MASTER_NOT_LAUNCHED";
}

export function nyOpenNextAction({ pack, bundle, master, setup, trade }) {
  if (!pack) return "generate_ny_open_pack";
  if (!bundle || bundle?.data_quality?.execution_allowed === false) return "prepare_nyopen_master_bundle";
  if (!master) return "copy_prompt_to_chatgpt_and_run_master";
  if (trade && isActiveTradeStatus(trade.status)) return "manage_active_position";
  if (setup && isTriggeredSetup(setup)) return "track_trade_or_mark_result";
  if (setup) return "wait_for_trigger_or_mark_setup_triggered";
  return "wait_for_setup_or_run_monitor";
}

export function nyOpenBlockers({ pack, bundle }) {
  const blockers = [];
  if (!pack) blockers.push("ny_open_pack_missing");
  if (bundle?.data_quality?.execution_allowed === false) blockers.push(...(bundle.data_quality.blockers || bundle.data_quality.missing || ["master_bundle_degraded"]));
  return dedupeBy(blockers, (item) => item);
}

export function nyOpenWarnings({ pack, bundle, master }) {
  const warnings = [];
  if (pack?.status && pack.status !== "ready") warnings.push(`pack_${pack.status}`);
  warnings.push(...(bundle?.data_quality?.warnings || []));
  if (!master) warnings.push("master_non_lance");
  return dedupeBy(warnings, (item) => item);
}

export function normalizeNyOpenAction(args = {}) {
  const action = args.action || "mark_setup_triggered";
  const allowed = new Set(["mark_setup_triggered", "mark_tp1", "mark_tp2", "mark_tp3", "mark_stopped", "mark_expired", "mark_cancelled", "replay_strict_setup", "recompute_strategy_performance"]);
  if (!allowed.has(action)) {
    throw new Error(`unsupported_strategy_action:${action}`);
  }
  return action;
}

export function strategyActionPatch(action, tick) {
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

export function strategyAuditLog({ strategy_id, action, document_type, document_id, previous_value, new_value, performed_by, reason, tick }) {
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

export function buildNyOpenMasterPrompt({ strategy_id, date, cutoff_paris, bundle, contract_context }) {
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

export function promptJson(value) {
  return JSON.stringify(value, null, 2);
}

export function resolveOperationalReadScope(args = {}, { requireMaster = false, requireThesis = false } = {}) {
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

export function operationalSelectorArgs(scope) {
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

export function deriveActiveThesisFromMaster(master) {
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

export function masterCutoffBundleId({ date, session, cutoff_paris, mode }) {
  const hm = String(cutoff_paris).slice(11, 16).replace(":", "") || "cutoff";
  return stableVNextId("master_cutoff_bundle", `${date}_${session}_${hm}`, mode || "live");
}

export function missingMasterCutoffBundle(args = {}) {
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

export function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

export function hasReplayGeometry(setup) {
  return Boolean(setup.entry_zone && setup.stop_loss != null && hasTakeProfitGeometry(setup.take_profits || setup.targets || setup.tp1 || setup.target));
}

export function hasTakeProfitGeometry(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value != null && value !== "";
}

export function strictReplaySetupFilters(args = {}) {
  const date = args.date || (!args.from_date && args.to_date ? args.to_date : (args.from_date && args.from_date === args.to_date ? args.to_date : null));
  return {
    date: date || undefined,
    from_date: date ? undefined : args.from_date,
    to_date: date ? undefined : args.to_date,
    instrument: args.instrument || "all",
    direction: args.direction || "all",
  };
}

export function normalizeNyOpenPricingMode(value) {
  const text = String(value || NY_OPEN_DEFAULT_PRICING_MODE).trim().toLowerCase();
  if (["middle", "mid", "midpoint"].includes(text)) return "middle";
  if (["optimistic", "best", "best_case"].includes(text)) return "optimistic";
  return NY_OPEN_DEFAULT_PRICING_MODE;
}

export function nyOpenStrictPricingModes() {
  return NY_OPEN_PRICING_MODES;
}

export function selectedStrictModeResult(modeResults = [], pricing_mode) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  return modeResults.find((item) => item.pricing_mode === mode) ||
    modeResults.find((item) => item.pricing_mode === NY_OPEN_DEFAULT_PRICING_MODE) ||
    modeResults[0] ||
    { pricing_mode: mode, replay: null, trade: null };
}

export function selectNyOpenStrictSetup(setups = [], args = {}) {
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

export function isStrictReplayCandidateSetup(setup) {
  const instrument = String(setup?.instrument || "").toUpperCase();
  const direction = String(setup?.direction || "").toLowerCase();
  const status = String(setup?.status || setup?.lifecycle_status || "").toLowerCase();
  if (!["MNQ", "MES", "NQ", "ES"].includes(instrument)) return false;
  if (!["long", "short"].includes(direction)) return false;
  if (["cancelled", "expired", "no_trade"].some((item) => status.includes(item))) return false;
  return hasReplayGeometry(setup);
}

export function strictSetupScore(setup) {
  const primary = setup?.is_primary === true ? 1_000_000 : 0;
  const replayable = setup?.replayable === true ? 100_000 : 0;
  const priority = Math.max(0, 10_000 - Number(setup?.priority || 999));
  const confidence = Number(setup?.confidence_pct || 0);
  return primary + replayable + priority + confidence;
}

export function nyOpenStrictReplayWindow(setup, args = {}) {
  const date = args.date || setup?.date || strategyDateFromDoc(setup) || String(new SystemClock().now().paris).slice(0, 10);
  const offset = parisOffsetForDate(date);
  return {
    from: args.replay_from || `${date}T${NY_OPEN_STRICT_ENTRY_TIME}${offset}`,
    to: args.replay_to || `${date}T${NY_OPEN_STRICT_END_TIME}${offset}`,
  };
}

export function strictSetupForReplay(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
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

export function nyOpenStrictSetupPatch({ setup, modeResults = [], replayWindow, strategy_id, tick, pricing_mode }) {
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

export function strictSetupStatusFromReplay(replay) {
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

export function strictBestTargetName(replay) {
  return String(replay?.best_target_hit?.name || replay?.evidence?.best_target_hit?.name || replay?.evidence?.outcome || "TP1").toUpperCase();
}

export function nyOpenStrictTradeFromReplay({ setup, replay, replayWindow, strategy_id, tick, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE }) {
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

export function nyOpenStrictTradeId(setup, pricing_mode = NY_OPEN_DEFAULT_PRICING_MODE) {
  const mode = normalizeNyOpenPricingMode(pricing_mode);
  return stableVNextId("strategy_trade", setupDocumentId(setup), mode === NY_OPEN_DEFAULT_PRICING_MODE ? "nyopen_strict_v1" : `nyopen_strict_v1_${mode}`);
}

export function nyOpenStrictReplayId(setup, pricing_mode, tick = new SystemClock().now()) {
  const stamp = tick.utc.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${setupDocumentId(setup)}_${normalizeNyOpenPricingMode(pricing_mode)}_${stamp}`;
}

export function summarizeNyOpenStrictReplay({ setup, modeResults = [], audit, replayWindow, strategy_id, pricing_mode }) {
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

export function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export const STRATEGY_AUDIT_ALGORITHMS = Object.freeze({
  buildAuditState,
  buildLiveTimelineEventDetail,
  buildNyOpenStrategyState,
  buildStrategyCalendar,
  buildStrategyDayDetail,
  buildStrategyPerformance,
  filterStrategySetups,
  filterStrategyTrades,
  normalizeNyOpenAction,
  normalizeNyOpenBundlePrep,
  nyOpenCutoffParis,
  nyOpenOperationalScope,
  nyOpenStrictPricingModes,
  nyOpenStrictReplayId,
  nyOpenStrictReplayWindow,
  nyOpenStrictSetupPatch,
  nyOpenStrictTradeFromReplay,
  publicReplayError,
  recomputeStrategyPerformanceDocs,
  requireStrategyId,
  resolveStrategySelection,
  selectedStrictModeResult,
  selectNyOpenStrictSetup,
  selectStrategyDocuments,
  setupDocumentId,
  strategyActionPatch,
  strategyAuditLog,
  strategyDocMatches,
  strictReplaySetupFilters,
  strictSetupForReplay,
  summarizeNyOpenStrictReplay,
});
