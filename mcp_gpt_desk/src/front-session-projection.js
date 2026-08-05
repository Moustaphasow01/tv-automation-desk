const FRONT_API_MAP = [
  ["Live Desk", "/api/v1/live-desk/current"],
  ["Sessions", "/api/v1/sessions"],
  ["Marché", "/api/v1/market/snapshot"],
  ["Position", "/api/v1/positions/current"],
  ["Macro", "/api/v1/macro/calendar"],
  ["News", "/api/v1/news/digest"],
  ["Audit", "/api/v1/audit"],
  ["Commandes opérateur", "/api/v1/operator/commands"],
];

const FRONT_SESSION_CACHE_TTL_MS = boundedTtlMs(process.env.DESK_FRONT_SESSION_CACHE_TTL_MS, 5_000, 0, 60_000);
const FRONT_MARKET_CACHE_TTL_MS = boundedTtlMs(process.env.DESK_FRONT_MARKET_CACHE_TTL_MS, 15_000, 0, 120_000);
const frontSessionCaches = new WeakMap();
const frontMarketCaches = new WeakMap();

export function normalizeFrontApiScope(input = {}, now = new Date()) {
  const session = input.session === "ny_open" ? "ny_open" : "asia_open";
  const tradingDate = isoDate(input.trading_date || input.date) || parisDate(now);
  const strategyId = stringValue(input.strategy_id) || (session === "ny_open" ? "ny_open_1530" : "asia_open");
  const mode = ["live", "paper"].includes(input.mode) ? input.mode : "live";
  return {
    strategy_id: strategyId,
    session,
    mode,
    trading_date: tradingDate,
    date: tradingDate,
    run_id: stringValue(input.run_id) || `front_live_${tradingDate}`,
    as_of_utc: validTimestamp(input.as_of_utc) || now.toISOString(),
    timezone: "Europe/Paris",
  };
}

export async function loadFrontDeskSession(store, scopeInput = {}) {
  const scope = normalizeFrontApiScope(scopeInput);
  if (scopeInput.front_cache === true && FRONT_SESSION_CACHE_TTL_MS > 0) {
    return cachedFrontRead(frontSessionCaches, store, frontScopeCacheKey(scopeInput, scope, FRONT_SESSION_CACHE_TTL_MS), FRONT_SESSION_CACHE_TTL_MS, () => loadFrontDeskSessionUncached(store, scope, scopeInput));
  }
  return loadFrontDeskSessionUncached(store, scope, scopeInput);
}

async function loadFrontDeskSessionUncached(store, scope, scopeInput = {}) {
  const live = await store.getLiveDeskState({
    ...scope,
    front_cache: scopeInput.front_cache === true,
  });
  const resolvedScope = live.resolved_scope || scope;
  const masterResult = await safeRead(() => store.getLatestMasterAnalysis(resolvedScope), {});
  const masterAnalysis = masterResult.analysis || null;
  const masterId = masterAnalysis?.analysis_id || live.latest_master?.analysis_id || null;
  const thesisId = live.active_thesis?.thesis_id || live.latest_thesis?.thesis_id || null;
  const instrument = live.active_thesis?.instrument || live.latest_thesis?.instrument || live.latest_master?.instrument || "MNQ";
  const deferSecondaryResources = scopeInput.defer_secondary_resources === true;
  const [manualResult, hourlyResult, audit, marketSnapshot, macro, news, setups, frontCurrent] = await Promise.all([
    safeRead(() => store.getLatestManualMonitor({
      ...resolvedScope,
      ...(thesisId ? { thesis_id: thesisId } : {}),
      limit: 20,
    }), {}),
    thesisId && masterId
      ? safeRead(() => store.getLatestHourlyMonitor({ ...resolvedScope, thesis_id: thesisId, master_id: masterId, limit: 20 }), {})
      : {},
    deferSecondaryResources ? {} : safeRead(() => store.getAuditState(resolvedScope), {}),
    deferSecondaryResources
      ? {}
      : safeRead(() => loadFrontMarketSnapshot(store, { date: scope.trading_date, session: scope.session, instrument, front_cache: scopeInput.front_cache === true }), {}),
    deferSecondaryResources
      ? {}
      : safeRead(() => loadFrontDailyMacroSource(store, {
        date: scope.trading_date,
        mode: scope.mode,
        as_of_utc: resolvedScope.as_of_utc || scope.as_of_utc,
      }), {}),
    deferSecondaryResources
      ? {}
      : safeRead(() => store.getNewsDigest({
        date: scope.trading_date,
        session: scope.session,
        pack_id: undefined,
        pack_build_id: undefined,
        as_of_utc: undefined,
        mode: scope.mode,
      }), {}),
    masterId ? safeRead(() => store.getDeskSetups({ analysis_id: masterId, limit: 100 }), {}) : {},
    typeof store.getFrontProjectionCurrent === "function"
      ? safeRead(() => store.getFrontProjectionCurrent(resolvedScope), null)
      : null,
  ]);

  const monitors = uniqueMonitors([
    ...(manualResult.monitors || []),
    ...(hourlyResult.monitors || []),
  ]);

  return projectDeskSession({
    live,
    masterAnalysis,
    monitors,
    audit,
    marketSnapshot: marketSnapshot.session_snapshot || null,
    macro,
    news,
    setups: setups.setups || [],
    frontProjection: frontCurrent?.projection || null,
  });
}

export async function loadFrontDailyMacroSource(store, { date, mode = "live", as_of_utc } = {}) {
  const centerUtc = validTimestamp(as_of_utc) || `${date}T12:00:00.000Z`;
  const window = macroWindow(centerUtc, 48, 48);
  let packWarning = null;
  if (mode !== "replay"
    && (typeof store.getFrontMacroCalendarWindow === "function"
      || typeof store.getFrontDailyMacroCalendar === "function")) {
    try {
      const current = typeof store.getFrontMacroCalendarWindow === "function"
        ? await store.getFrontMacroCalendarWindow({
          date,
          as_of_utc: centerUtc,
          before_hours: 48,
          after_hours: 48,
          importance_min: "low",
        })
        : await store.getFrontDailyMacroCalendar({
          date,
          importance_min: "low",
          as_of_utc: centerUtc,
        });
      if (Array.isArray(current?.events) && current.events.length) {
        return {
          ...current,
          window: current.window || window,
          events: current.window
            ? macroEventsInWindow(current.events, current.window)
            : dailyEvents(current.events, date),
        };
      }
      packWarning = "macro_calendar_current_empty";
    } catch (error) {
      packWarning = error?.code || error?.message || "macro_calendar_current_not_available";
    }
  }
  try {
    const packed = await store.getMacroCalendar({
      date,
      pack_id: undefined,
      pack_build_id: undefined,
      as_of_utc: undefined,
      mode,
      importance_min: "low",
    });
    const scoped = {
      ...packed,
      window,
      events: macroEventsInWindow(packed?.events, window),
    };
    if (!packed?.warning) return scoped;
    packWarning = packed.warning || packWarning;
  } catch (error) {
    packWarning = error?.code || error?.message || "macro_calendar_pack_not_available";
  }
  if (typeof store.getFrontMacroCalendarWindow !== "function"
    && typeof store.getFrontDailyMacroCalendar !== "function") {
    throw new Error(packWarning || "macro_calendar_not_available");
  }
  const current = typeof store.getFrontMacroCalendarWindow === "function"
    ? await store.getFrontMacroCalendarWindow({
      date,
      as_of_utc: centerUtc,
      before_hours: 48,
      after_hours: 48,
      importance_min: "low",
    })
    : await store.getFrontDailyMacroCalendar({
      date,
      importance_min: "low",
      as_of_utc: centerUtc,
    });
  return {
    ...current,
    window: current.window || window,
    warning: `macro_calendar_pack_fallback:${packWarning}`,
    events: current.window
      ? macroEventsInWindow(current?.events, current.window)
      : dailyEvents(current?.events, date),
  };
}

export async function loadFrontMarketSnapshot(store, { date, session = "asia_open", instrument = "MNQ", front_cache = false } = {}) {
  if (front_cache === true && FRONT_MARKET_CACHE_TTL_MS > 0) {
    const key = JSON.stringify(["market", isoDate(date) || "", session || "asia_open", String(instrument || "MNQ").toUpperCase()]);
    return cachedFrontRead(frontMarketCaches, store, key, FRONT_MARKET_CACHE_TTL_MS, () => loadFrontMarketSnapshotUncached(store, { date, session, instrument }));
  }
  return loadFrontMarketSnapshotUncached(store, { date, session, instrument });
}

async function loadFrontMarketSnapshotUncached(store, { date, session = "asia_open", instrument = "MNQ" } = {}) {
  const [canonical, liveMarket, passiveSnapshot] = await Promise.all([
    safeRead(() => store.getSessionSnapshot({ date, session, instrument }), {}),
    typeof store.getFrontLiveMarketSnapshot === "function"
      ? safeRead(() => store.getFrontLiveMarketSnapshot({ date }), {})
      : {},
    loadDailyPackMarketSnapshot(store, date).catch(() => ({})),
  ]);
  const canonicalSnapshot = record(canonical.session_snapshot);
  const passiveInstruments = record(passiveSnapshot.instruments);
  const canonicalInstruments = record(canonicalSnapshot.instruments);
  const liveInstruments = record(liveMarket.instruments);
  const instruments = { ...passiveInstruments };
  for (const [symbol, value] of Object.entries(canonicalInstruments)) {
    instruments[symbol] = mergeMarketInstrument(instruments[symbol], value);
  }
  for (const [symbol, value] of Object.entries(liveInstruments)) {
    instruments[symbol] = mergeMarketInstrument(instruments[symbol], value);
  }
  if (!Object.keys(instruments).length) return canonical;
  const sources = [
    Object.keys(passiveInstruments).length ? "daily_pack" : null,
    Object.keys(canonicalInstruments).length ? "canonical_snapshot" : null,
    Object.keys(liveInstruments).length ? "postgres_market_feeds" : null,
  ].filter(Boolean);
  return {
    session_snapshot: {
      ...passiveSnapshot,
      ...canonicalSnapshot,
      instruments,
      timestamp_paris: stringValue(
        liveMarket.timestamp_paris,
        canonicalSnapshot.timestamp_paris,
        canonicalSnapshot.computed_at,
        passiveSnapshot.timestamp_paris,
      ),
      requested_date: stringValue(liveMarket.requested_date, canonicalSnapshot.requested_date, date),
      effective_market_date: stringValue(
        liveMarket.effective_market_date,
        canonicalSnapshot.effective_market_date,
        passiveSnapshot.effective_market_date,
      ),
      market_closed: liveMarket.market_closed === true
        || (liveMarket.market_closed == null && canonicalSnapshot.market_closed === true),
      availability: stringValue(
        liveMarket.availability,
        canonicalSnapshot.availability,
        passiveSnapshot.availability,
      ),
      source: sources.join("+") || "market_snapshot",
    },
  };
}

function cachedFrontRead(caches, store, key, ttlMs, read) {
  if (!store || ttlMs <= 0) return read();
  const cache = frontCacheFor(caches, store);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  const entry = { expiresAt: Number.POSITIVE_INFINITY, promise: null };
  entry.promise = Promise.resolve()
    .then(read)
    .then((value) => {
      if (cache.get(key) === entry) entry.expiresAt = Date.now() + ttlMs;
      return value;
    })
    .catch((error) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
  cache.set(key, entry);
  pruneFrontCache(cache, now);
  return entry.promise;
}

function frontCacheFor(caches, store) {
  let cache = caches.get(store);
  if (!cache) {
    cache = new Map();
    caches.set(store, cache);
  }
  return cache;
}

function pruneFrontCache(cache, now = Date.now()) {
  if (cache.size <= 100) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > 100) {
    cache.delete(cache.keys().next().value);
  }
}

function frontScopeCacheKey(input = {}, scope = {}, ttlMs = 5_000) {
  const explicitAsOf = Boolean(input.as_of_utc);
  const asOfMs = Date.parse(scope.as_of_utc || "");
  const asOfBucket = explicitAsOf && Number.isFinite(asOfMs) ? Math.floor(asOfMs / ttlMs) : "front-now";
  return JSON.stringify([
    "session",
    scope.strategy_id,
    scope.session,
    scope.mode,
    scope.trading_date,
    scope.run_id,
    asOfBucket,
    input.defer_secondary_resources === true ? "deferred" : "full",
  ]);
}

function boundedTtlMs(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function mergeMarketInstrument(base, overlay) {
  const previous = record(base);
  const next = Object.fromEntries(
    Object.entries(record(overlay)).filter(([, field]) => field !== null && field !== undefined && field !== ""),
  );
  return {
    ...previous,
    ...next,
    day_ohlc: hasMaterialValue(next.day_ohlc) ? next.day_ohlc : previous.day_ohlc,
  };
}

async function loadDailyPackMarketSnapshot(store, date) {
  if (!["getLatestAsiaOpenPack", "getDeskPack", "getDataset"].every((name) => typeof store[name] === "function")) return {};
  const summary = await store.getLatestAsiaOpenPack({ date });
  const pack = await store.getDeskPack({ pack_id: summary.pack_id, pack_build_id: summary.pack_build_id, mode: "live" });
  const cutoffUtc = pack.cutoff_utc || pack.resolved_scope?.cutoff_utc || pack.source_coverage?.end_utc;
  const specs = [
    { dataset: "MNQ_M5", assets: { MNQ: "MNQ" } },
    { dataset: "MES_M5", assets: { MES: "MES" } },
    { dataset: "DXY_CL_GC_VIX", assets: { CL: "MCL" } },
    { dataset: "mega_caps_premarket", assets: { NVDA: "NVDA", AAPL: "AAPL", MSFT: "MSFT", TSLA: "TSLA", SMH: "SMH", SOXX: "SOXX" } },
  ];
  const reads = await Promise.all(specs.map(async (spec) => {
    try {
      const dataset = await store.getDataset({
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        dataset: spec.dataset,
        as_of_utc: cutoffUtc,
        mode: "live",
        max_rows: 5000,
      });
      return { spec, rows: array(dataset.rows) };
    } catch {
      return { spec, rows: [] };
    }
  }));
  const instruments = {};
  for (const { spec, rows } of reads) {
    for (const [asset, symbol] of Object.entries(spec.assets)) {
      const summaryValue = summarizeDailyAsset(rows.filter((row) => String(row.asset || "").toUpperCase() === asset), {
        symbol,
        dataset: spec.dataset,
      });
      if (summaryValue) instruments[symbol] = summaryValue;
    }
  }
  return {
    timestamp_paris: pack.cutoff_paris || pack.resolved_scope?.cutoff_paris || null,
    market_date: date,
    source: "daily_pack",
    instruments,
  };
}

function summarizeDailyAsset(rows, { symbol, dataset }) {
  const ordered = rows
    .filter((row) => numberValue(row.close) != null)
    .sort((left, right) => String(left.timestamp_utc || left.timestamp_paris || "").localeCompare(String(right.timestamp_utc || right.timestamp_paris || "")));
  const last = ordered.at(-1);
  if (!last) return null;
  const latestDate = String(last.timestamp_paris || last.timestamp_utc || "").slice(0, 10);
  const daily = ordered.filter((row) => String(row.timestamp_paris || row.timestamp_utc || "").slice(0, 10) === latestDate);
  const first = daily[0] || last;
  const open = numberValue(first.open);
  const close = numberValue(last.close);
  const highs = daily.map((row) => numberValue(row.high)).filter((value) => value != null);
  const lows = daily.map((row) => numberValue(row.low)).filter((value) => value != null);
  const high = highs.length ? Math.max(...highs) : numberValue(last.high);
  const low = lows.length ? Math.min(...lows) : numberValue(last.low);
  const changePct = open && close != null ? ((close - open) / open) * 100 : null;
  return {
    symbol,
    latest_close: close,
    change_pct: changePct,
    latest_timestamp_paris: last.timestamp_paris || null,
    market_date: latestDate,
    day_ohlc: { open, high, low, close },
    rsi_14: numberValue(last.rsi_14),
    atr_14: numberValue(last.atr_14),
    source: dataset,
    availability: "daily_pack",
  };
}

export function projectDeskSession(sources = {}) {
  const live = record(sources.live);
  const masterAnalysis = record(sources.masterAnalysis);
  const fullMaster = {
    ...record(masterAnalysis.full_analysis),
    ...record(masterAnalysis.front_read_projection),
  };
  const compactMaster = record(live.latest_master);
  const thesis = record(live.active_thesis || live.latest_thesis || fullMaster.active_thesis);
  const monitors = uniqueMonitors(sources.monitors || []).map(frontReadableMonitor);
  const latestMonitor = monitors.at(-1) || frontReadableMonitor(live.latest_monitor);
  const setup = selectSetup(sources.setups, thesis, live.risk_order, fullMaster);
  const position = record(live.active_position);
  const audit = record(sources.audit);
  const tradingDate = isoDate(live.trading_date || live.date) || "";
  const macroSource = record(sources.macro);
  const macroEvents = macroSource.window
    ? macroEventsInWindow(macroSource.events, macroSource.window)
    : dailyEvents(macroSource.events, tradingDate);
  const newsItems = array(record(sources.news).items);
  const asOfUtc = stringValue(live.resolved_scope?.as_of_utc, live.as_of_utc) || new Date().toISOString();
  const projectedMacro = projectMacroEvents(macroEvents, asOfUtc);
  const nextMacroEvent = projectedMacro.find((event) => event.isNext);
  const dataQuality = projectDataQuality(live, audit);
  const session = live.session === "ny_open" ? "ny_open" : "asia_open";
  const status = stringValue(live.desk_status) || "NO_ACTIVE_THESIS";
  const severity = severityFrom(live.desk_color, status);
  const action = record(live.action_now);
  const liveClaim = projectLiveClaim({
    ...record(live.next_live_checkpoint),
    schedule: live.live_checkpoint_schedule,
  });
  const masterSummary = stringValue(
    compactMaster.summary,
    fullMaster.executive_summary?.summary,
    fullMaster.decision?.reason,
    masterAnalysis.summary,
  ) || "Aucune analyse Master matérialisée pour cette session.";
  const latestTimestamp = timestampOf(latestMonitor);
  const masterTimestamp = timestampOf(masterAnalysis) || stringValue(compactMaster.created_at_paris);
  const lastDataTimestamp = stringValue(
    record(sources.marketSnapshot).timestamp_paris,
    record(sources.marketSnapshot).computed_at,
    live.pack?.data_cutoff?.cutoff_paris,
    live.pack?.data_cutoff?.end_paris,
  );

  const projected = {
    id: session,
    strategyId: stringValue(live.strategy_id) || (session === "ny_open" ? "ny_open_1530" : "asia_open"),
    label: session === "ny_open" ? "NY Open" : "Asia Open",
    shortLabel: session === "ny_open" ? "NY" : "ASIA",
    date: tradingDate,
    mode: (stringValue(live.mode) || "live").toUpperCase(),
    status,
    severity,
    lastDataAt: timeLabel(lastDataTimestamp),
    lastMonitorAt: timeLabel(latestTimestamp),
    currentCheckpointAt: timeLabel(live.live_checkpoint_schedule?.due_checkpoint),
    lastCompletedCheckpointAt: timeLabel(live.live_checkpoint_schedule?.last_completed_checkpoint),
    nextCheckpointAt: timeLabel(live.live_checkpoint_schedule?.next_checkpoint),
    nextMonitorAt: timeLabel(
      live.live_checkpoint_schedule?.next_monitor_checkpoint
        || live.next_revalidation_time,
    ),
    claim: liveClaim,
    nextMacro: nextMacroEvent?.time || "—",
    dataQuality,
    automation: projectAutomation(live.jobs),
    liveBrief: {
      eyebrow: "Action immédiate",
      headline: stringValue(action.message) || humanize(status),
      action: action.action_required === true ? "ACTION REQUISE" : "SURVEILLER",
      summary: stringValue(action.message) || masterSummary,
      why: monitorNarrative(latestMonitor) || masterSummary,
      nextAction: narrative(action.next_condition) || stringValue(action.message) || "Aucune action backend disponible.",
      decision: stringValue(action.decision, latestMonitor.decision, latestMonitor.monitor_decision?.decision, latestMonitor.monitor_decision?.action) || status,
    },
    thesis: projectThesis(thesis, latestMonitor, status),
    marketBrief: projectMarketBrief(sources.marketSnapshot, fullMaster),
    deskReading: projectDeskReading(fullMaster, latestMonitor, masterSummary),
    market: projectMarket(sources.marketSnapshot, live.macro_cross_asset_summary),
    crossAssetBrief: projectCrossAssetBrief(live.macro_cross_asset_summary),
    latestChange: projectLatestChange(latestMonitor, {
      master: masterAnalysis,
      nextRevalidationTime: live.next_revalidation_time,
    }),
    master: projectMaster(masterAnalysis, compactMaster, fullMaster, masterTimestamp, thesis),
    setup: projectSetup(setup, thesis),
    position: projectPosition(position, setup, live),
    monitors: monitors.map((monitor, index) => projectMonitor(monitor, index)),
    timeline: projectTimeline(masterAnalysis, monitors, live.jobs, live.alerts),
    operationalTimeline: projectOperationalTimeline(live, masterAnalysis, monitors),
    activity: projectActivity(live.jobs),
    levels: projectLevels(live.key_levels),
    macro: projectedMacro,
    news: projectNews(sources.news, newsItems, macroEvents, asOfUtc),
    alerts: array(live.alerts).map(projectAlert),
    audit: projectAudit(live, audit),
  };
  return applyFrontProjection(projected, sources.frontProjection);
}

function projectLiveClaim(value) {
  const checkpoint = record(value);
  const schedule = record(checkpoint.schedule);
  const status = String(checkpoint.task_status || "UNAVAILABLE").toUpperCase();
  const statusMap = {
    WAITING: { key: "waiting", label: "En attente" },
    IN_PROGRESS: { key: "in_progress", label: "En cours" },
    EXECUTED: { key: "executed", label: "Exécuté" },
    LATE: { key: "late", label: "En retard" },
    UNAVAILABLE: { key: "unavailable", label: "Indisponible" },
  };
  const projectedStatus = statusMap[status] || statusMap.UNAVAILABLE;
  const workflow = stringValue(schedule.due_workflow, checkpoint.workflow, checkpoint.last_claimed_workflow);
  return {
    lastClaimAt: timeLabel(checkpoint.last_claimed_at_paris || checkpoint.last_claimed_at_utc),
    lastClaimAtUtc: stringValue(checkpoint.last_claimed_at_utc) || null,
    workerId: stringValue(checkpoint.last_claimed_worker_id) || null,
    nextTaskStatus: projectedStatus.key,
    nextTaskStatusLabel: projectedStatus.label,
    nextTaskWorkflow: workflow || null,
    nextTaskLabel: workflow === "LIVE_MASTER"
      ? "Master"
      : workflow === "LIVE_M15_MONITOR"
        ? "Monitor GPT M15"
        : "Tâche Live",
    lastCompletedCheckpoint: timeLabel(schedule.last_completed_checkpoint || checkpoint.last_completed_checkpoint),
    dueCheckpoint: timeLabel(schedule.due_checkpoint || checkpoint.target_checkpoint),
    nextTaskCheckpoint: timeLabel(schedule.due_checkpoint || checkpoint.target_checkpoint),
    followingTaskCheckpoint: timeLabel(schedule.next_checkpoint),
    followingTaskWorkflow: stringValue(schedule.next_workflow) || null,
    readyAt: timeLabel(schedule.ready_at_paris || schedule.ready_at_utc),
    bundleReadyAt: timeLabel(schedule.bundle_ready_at_paris || schedule.bundle_ready_at_utc),
    latencySeconds: numberValue(schedule.claim_latency_seconds),
    latencyTargetSeconds: numberValue(schedule.claim_latency_target_seconds) ?? 120,
    latencyStatus: stringValue(schedule.claim_latency_status) || "unavailable",
    bundleClaimLatencySeconds: numberValue(schedule.bundle_claim_latency_seconds),
    bundleClaimLatencyStatus: stringValue(schedule.bundle_claim_latency_status) || "unavailable",
  };
}

export function sessionSummary(session) {
  return {
    id: session.id,
    label: session.label,
    shortLabel: session.shortLabel,
    status: session.status,
    severity: session.severity,
    decision: session.liveBrief.decision,
    health: session.thesis.health,
    lastMonitorAt: session.lastMonitorAt,
  };
}

export function applyFrontProjection(session, projectionValue) {
  const projection = record(projectionValue);
  if (projection.contractName !== "DeskFrontProjectionContract" || projection.schemaVersion !== "1.0.0") {
    return session;
  }
  const source = record(projection.source);
  if (source.session !== session.id || source.strategyId !== session.strategyId || source.tradingDate !== session.date) {
    return session;
  }

  const status = record(projection.status);
  const briefs = record(projection.briefs);
  const change = record(projection.latestChange);
  const expectedVsRealized = array(projection.expectedVsRealized).map((item) => ({
    element: stringValue(item.label) || "Observation",
    expected: stringValue(item.expected) || "—",
    realized: stringValue(item.realized) || "—",
    verdict: stringValue(item.verdict) || "partial",
    impact: stringValue(item.impact) || "Non renseigné",
  }));
  const goConditions = array(projection.conditions?.go).map(projectCondition);
  const invalidationConditions = array(projection.conditions?.invalidations).map(projectCondition);
  const monitorIndex = source.sourceType === "MONITOR"
    ? session.monitors.findIndex((item) => item.id === source.monitorId || item.id === source.sourceId)
    : -1;
  const monitors = [...session.monitors];
  if (monitorIndex >= 0) {
    monitors[monitorIndex] = {
      ...monitors[monitorIndex],
      sequence: numberValue(source.sequence) ?? monitors[monitorIndex].sequence,
      summary: stringValue(briefs.oneLiner, briefs.deltaBrief) || monitors[monitorIndex].summary,
      detailedReason: stringValue(briefs.whyNow) || monitors[monitorIndex].detailedReason,
      nextAction: stringValue(briefs.actionNow, status.actionCode) || monitors[monitorIndex].nextAction,
      nextFocus: stringValue(briefs.nextFocus) || monitors[monitorIndex].nextFocus,
      expectedVsRealized: monitors[monitorIndex].expectedVsRealized.length ? monitors[monitorIndex].expectedVsRealized : expectedVsRealized,
      weakSignals: monitors[monitorIndex].weakSignals.length
        ? monitors[monitorIndex].weakSignals
        : [...array(change.weakenedElements), ...array(change.invalidatedElements)].map(String),
      goConditions: monitors[monitorIndex].goConditions.length ? monitors[monitorIndex].goConditions : goConditions,
      invalidationConditions: monitors[monitorIndex].invalidationConditions.length
        ? monitors[monitorIndex].invalidationConditions
        : invalidationConditions,
    };
  }

  const timelineEvent = record(projection.timelineEvent);
  const projectionTimeline = Object.keys(timelineEvent).length ? {
    time: timeLabel(source.timestampParis),
    type: stringValue(timelineEvent.type, source.sourceType) || "PROJECTION",
    title: stringValue(timelineEvent.title) || humanize(source.sourceType),
    status: stringValue(timelineEvent.status, status.deskStatus) || "MATERIALIZED",
    detail: stringValue(timelineEvent.detail, timelineEvent.summary, briefs.whyNow) || "Projection matérialisée.",
    severity: stringValue(timelineEvent.severity, status.alertLevel) || "info",
    summary: stringValue(timelineEvent.summary, briefs.oneLiner) || "Projection matérialisée.",
    sourceType: source.sourceType,
  } : null;
  const timeline = projectionTimeline && !session.timeline.some((item) => (
    item.sourceType === projectionTimeline.sourceType && item.time === projectionTimeline.time
  )) ? [...session.timeline, projectionTimeline] : session.timeline;
  const projectedChangeItems = [
    ...array(change.validatedElements).map((text) => ({ tone: "positive", text: String(text) })),
    ...array(change.weakenedElements).map((text) => ({ tone: "warning", text: String(text) })),
    ...array(change.invalidatedElements).map((text) => ({ tone: "negative", text: String(text) })),
  ];

  return {
    ...session,
    status: session.status,
    severity: session.severity,
    lastMonitorAt: source.sourceType === "MONITOR" ? timeLabel(source.timestampParis) : session.lastMonitorAt,
    liveBrief: {
      ...session.liveBrief,
      headline: stringValue(briefs.headline) || session.liveBrief.headline,
      action: session.liveBrief.action,
      summary: stringValue(briefs.oneLiner) || session.liveBrief.summary,
      why: stringValue(briefs.whyNow) || session.liveBrief.why,
      nextAction: stringValue(briefs.actionNow) || session.liveBrief.nextAction,
      decision: session.liveBrief.decision,
    },
    thesis: session.thesis,
    marketBrief: {
      ...session.marketBrief,
      headline: stringValue(briefs.headline) || session.marketBrief.headline,
      text: stringValue(briefs.marketBrief) || session.marketBrief.text,
    },
    latestChange: {
      title: source.sourceType === "MONITOR" ? `Évolution au ${timeLabel(source.timestampParis)}` : session.latestChange.title,
      items: projectedChangeItems.length ? projectedChangeItems : session.latestChange.items,
      consequence: stringValue(briefs.deltaBrief, briefs.actionNow) || session.latestChange.consequence,
    },
    setup: session.setup,
    position: session.position,
    monitors,
    timeline,
  };
}

function projectThesis(thesis, latestMonitor, deskStatus) {
  const health = numberValue(
    latestMonitor.thesis_health_score?.current_score,
    latestMonitor.thesis_health_score?.score,
    latestMonitor.health_score,
    thesis.health_score,
  ) ?? 0;
  const confidence = numberValue(thesis.confidence_pct) ?? 0;
  const update = record(latestMonitor.active_thesis_update || latestMonitor.thesis_update);
  return {
    id: stringValue(thesis.thesis_id) || "no-active-thesis",
    instrument: stringValue(thesis.instrument) || "—",
    direction: stringValue(thesis.direction) || "wait",
    status: stringValue(update.status, thesis.status) || deskStatus,
    previousStatus: stringValue(latestMonitor.active_thesis_before?.status, latestMonitor.previous_status) || stringValue(thesis.status) || deskStatus,
    dominantScenario: stringValue(thesis.dominant_scenario, thesis.summary) || "Aucune thèse active matérialisée.",
    secondaryScenario: narrative(thesis.secondary_scenario || thesis.scenario_transformation_map) || "Aucun scénario secondaire matérialisé.",
    confidence,
    initialConfidence: numberValue(thesis.initial_confidence_pct, thesis.confidence_pct) ?? 0,
    health,
    initialHealth: numberValue(thesis.initial_health_score, thesis.confidence_pct, thesis.health_score) ?? 0,
    validUntil: timeLabel(thesis.valid_until),
    nextFocus: narrative(
      latestMonitor.monitor_decision?.next_monitoring_focus,
    ) || stringValue(update.next_focus, thesis.requires_replan_after) || "Aucun focus matérialisé.",
    scoreDriversPositive: stringArray(latestMonitor.thesis_health_score?.score_drivers_positive || thesis.score_drivers_positive),
    scoreDriversNegative: stringArray(latestMonitor.thesis_health_score?.score_drivers_negative || thesis.score_drivers_negative),
  };
}

function projectMaster(master, compact, full, timestamp, thesis) {
  const executive = record(full.executive_summary || master.executive_summary);
  const decision = {
    ...record(master.decision),
    ...record(full.decision),
    ...record(master.executable_decision),
    ...record(full.executable_decision),
  };
  const sections = Object.entries(full)
    .filter(([key, value]) => !["setups", "candidate_setups"].includes(key) && narrative(value))
    .slice(0, 20)
    .map(([key, value]) => ({ title: humanize(key), content: narrative(value) }));
  return {
    id: stringValue(master.analysis_id, compact.analysis_id) || "no-master",
    createdAt: timeLabel(timestamp),
    decision: stringValue(executive.final_decision, decision.decision, decision.action, compact.decision, master.final_decision) || "NON DISPONIBLE",
    instrument: stringValue(executive.final_instrument, decision.instrument, compact.instrument, thesis.instrument) || "—",
    direction: stringValue(executive.final_direction, decision.direction, compact.direction, thesis.direction) || "wait",
    confidence: numberValue(executive.confidence_pct, decision.confidence_pct, compact.confidence_pct, master.confidence_pct) ?? 0,
    summary: stringValue(executive.summary, decision.reason, compact.summary, master.summary) || "Aucun Master matérialisé.",
    regime: narrative(full.market_regime || full.regime || full.market_context) || "Non matérialisé",
    macroThesis: narrative(full.macro_thesis || full.macro_context || full.macro_analysis) || "Non matérialisée",
    assetSelection: narrative(full.asset_selection || full.instrument_selection) || "Non matérialisée",
    expectedPath: stringArray(thesis.expected_path || full.expected_path),
    failurePath: stringArray(thesis.failure_path || full.failure_path),
    monitoringPlaybook: stringArray(thesis.monitoring_playbook || full.monitoring_playbook || full.update_agenda),
    sections,
  };
}

function projectSetup(setup, thesis) {
  const zone = record(setup.entry_zone);
  const targets = array(setup.targets || setup.take_profits || setup.take_profit);
  const status = stringValue(setup.status, setup.lifecycle_status) || "NO_SETUP";
  const setupIdentity = stringValue(setup.setup_record_id, setup.setup_id, setup.id);
  const instrument = stringValue(setup.instrument, setup.contract)
    || (setupIdentity ? "—" : stringValue(thesis.instrument))
    || "—";
  const direction = stringValue(setup.direction)
    || (setupIdentity ? "wait" : stringValue(thesis.direction))
    || "wait";
  const rawFrom = numberValue(zone.from, zone.low, zone.min, setup.entry_zone_lower, setup.entry_from);
  const rawTo = numberValue(zone.to, zone.high, zone.max, setup.entry_zone_upper, setup.entry_to);
  const entryLower = rawFrom == null || rawTo == null ? rawFrom ?? rawTo : Math.min(rawFrom, rawTo);
  const entryUpper = rawFrom == null || rawTo == null ? rawFrom ?? rawTo : Math.max(rawFrom, rawTo);
  const directEntry = numberValue(setup.entry_execution_price, setup.entry_price, setup.entry);
  const executionEntry = directEntry ?? (
    entryLower == null || entryUpper == null
      ? entryLower ?? entryUpper
      : direction.toLowerCase() === "short"
        ? entryLower
        : entryUpper
  );
  const stop = numberValue(setup.stop_loss, setup.stop);
  const tp1 = numberValue(setup.take_profit_1, setup.tp1, targetPrice(targets[0]));
  const computedRr = numberValue(setup.computed_rr, setup.rr, setup.risk_reward_ratio);
  const minimumRr = numberValue(setup.rr_minimum, setup.minimum_rr, setup.min_rr, setup.rr_min);
  const riskGeometryInvalid = setup.risk_geometry_status === "RR_BELOW_MINIMUM"
    || (computedRr != null && minimumRr != null && computedRr < minimumRr);
  const missingFields = [
    ...(!instrument || instrument === "—" || instrument.toUpperCase() === "WAIT" ? ["instrument"] : []),
    ...(!["long", "short"].includes(direction.toLowerCase()) ? ["direction"] : []),
    ...(executionEntry == null ? ["entry"] : []),
    ...(stop == null ? ["stop_loss"] : []),
    ...(tp1 == null ? ["take_profit_1"] : []),
    ...(riskGeometryInvalid ? ["risk_reward"] : []),
  ];
  const geometryReady = !riskGeometryInvalid && (
    typeof setup.execution_geometry_ready === "boolean"
      ? setup.execution_geometry_ready
      : missingFields.length === 0
  );
  const requestedStatus = stringValue(setup.requested_status, setup.requestedStatus) || status;
  const incompleteArm = ["ARM_SETUP", "ARMED", "ARMED_CONDITIONAL"].includes(requestedStatus.toUpperCase())
    && !geometryReady;
  const materialized = Boolean(setupIdentity)
    || (["long", "short"].includes(direction.toLowerCase()) && status !== "NO_SETUP");
  const statusLabel = incompleteArm
    ? "Armement incomplet"
    : humanize(status);
  const reason = riskGeometryInvalid
    ? `Armement neutralisé : RR ${computedRr?.toFixed(2) || "—"} inférieur au minimum ${minimumRr?.toFixed(2) || "—"}.`
    : narrative(setup.reason || setup.notes || setup.rationale || setup.trigger)
    || (incompleteArm
      ? `Armement demandé mais incomplet : ${missingFields.join(", ")}. Le moteur ne peut pas déclencher ce setup.`
      : materialized
        ? "Setup canonique matérialisé sans commentaire analytique."
        : "Aucun setup canonique disponible.");
  return {
    id: stringValue(setup.setup_id, setup.id) || "no-setup",
    label: stringValue(setup.label, setup.setup_type, setup.name)
      || (materialized ? `Setup ${instrument} ${direction}` : "Aucun setup matérialisé"),
    instrument,
    direction,
    status,
    statusLabel,
    requestedStatus,
    geometryReady,
    backendCanTrigger: setup.backend_can_trigger === true && geometryReady,
    missingFields,
    minimumRr,
    entryFrom: entryLower ?? directEntry,
    entryTo: entryUpper ?? directEntry,
    entryLower: entryLower ?? directEntry,
    entryUpper: entryUpper ?? directEntry,
    executionEntry,
    executionRule: stringValue(setup.entry_execution_rule) === "short_lower_bound"
      ? "Vente sur la borne basse"
      : stringValue(setup.entry_execution_rule) === "long_upper_bound"
        ? "Achat sur la borne haute"
        : directEntry != null
      ? "Prix explicite du setup"
      : direction.toLowerCase() === "short"
        ? "Vente sur la borne basse"
        : direction.toLowerCase() === "long"
          ? "Achat sur la borne haute"
          : "Borne disponible",
    stop,
    tp1,
    tp2: numberValue(setup.take_profit_2, setup.tp2, targetPrice(targets[1])),
    tp3: numberValue(setup.take_profit_3, setup.tp3, targetPrice(targets[2])),
    risk: numberValue(setup.risk_pct, setup.risk),
    confidence: numberValue(setup.confidence_pct, thesis.confidence_pct),
    rr: materialized ? computedRr : null,
    resultR: numberValue(setup.result_R, setup.result_r),
    reason,
  };
}

function projectPosition(position, setup, live = {}) {
  const status = stringValue(position.status) || "NO_POSITION";
  const normalized = status.toLowerCase();
  const active = ["active", "open", "pending", "running", "protected", "partial_taken", "position_active", "position_protected"].includes(normalized);
  const executionMode = position.paper_simulated === true
    ? "paper"
    : stringValue(position.execution_mode, live.execution_mode) || "live";
  return {
    active,
    status,
    instrument: stringValue(position.instrument, setup.instrument) || "—",
    direction: stringValue(position.direction, setup.direction) || "wait",
    entry: numberValue(position.entry, position.entry_price),
    current: numberValue(position.current, position.current_price, position.mark_price, position.exit_price),
    unrealizedR: numberValue(position.unrealized_R, position.unrealized_r, position.result_R, position.result_r),
    executionMode,
    brokerExecution: position.broker_execution === true,
    note: narrative(position.note || position.notes || position.management_state)
      || (active && executionMode === "paper"
        ? "Position paper suivie par le moteur backend sur les bougies closes."
        : "Aucune position canonique active."),
  };
}

function projectMonitor(monitor, index) {
  const decision = record(monitor.monitor_decision);
  const healthBlock = record(monitor.thesis_health_score);
  const update = record(monitor.active_thesis_update || monitor.thesis_update);
  const healthAfter = numberValue(healthBlock.current_score, healthBlock.score, update.health_score, monitor.health_score) ?? 0;
  const healthBefore = numberValue(healthBlock.previous_score, healthAfter - (numberValue(healthBlock.delta) ?? 0)) ?? healthAfter;
  const statusAfter = stringValue(update.status, monitor.status_after, monitor.thesis_status) || "MONITORED";
  return {
    id: stringValue(monitor.monitor_id, monitor.id) || `monitor-${index + 1}`,
    time: timeLabel(timestampOf(monitor)),
    sequence: numberValue(monitor.sequence, monitor.monitor_sequence) ?? index + 1,
    decision: stringValue(decision.decision, decision.action, monitor.decision, monitor.status) || "MONITOR",
    severity: severityFrom(null, statusAfter),
    statusBefore: stringValue(monitor.active_thesis_before?.status, monitor.status_before) || "—",
    statusAfter,
    healthBefore,
    healthAfter,
    summary: stringValue(decision.summary, decision.reason_summary, decision.reason, decision.rationale, monitor.summary) || "Monitor matérialisé sans résumé.",
    detailedReason: stringValue(decision.detailed_reason, decision.reason_summary, decision.reason, decision.rationale, decision.summary) || "Aucun raisonnement détaillé matérialisé.",
    nextAction: stringValue(decision.action_now, decision.next_action, decision.action) || "Aucune action matérialisée.",
    nextFocus: narrative(decision.next_monitoring_focus || update.next_focus) || "Aucun focus matérialisé.",
    expectedVsRealized: array(monitor.expected_vs_realized).map((item) => ({
      element: stringValue(item.element, item.label, item.condition) || "Observation",
      expected: narrative(item.expected) || "—",
      realized: narrative(item.realized) || "—",
      verdict: stringValue(item.verdict, item.status) || "partial",
      impact: narrative(item.impact) || "Non renseigné",
    })),
    weakSignals: stringArray(monitor.weak_signals),
    goConditions: array(monitor.wait_to_go_check || monitor.conditions_go).map(projectCondition),
    invalidationConditions: array(monitor.invalidation_check || monitor.invalidations).map(projectCondition),
  };
}

function projectCondition(condition) {
  const item = record(condition);
  return {
    label: stringValue(item.label, item.condition, item.condition_id) || "Condition",
    status: stringValue(item.status) || "not_triggered",
    proof: narrative(item.proof || item.realized || item.evidence) || "Aucune preuve matérialisée.",
    impact: narrative(item.impact) || "Impact non renseigné",
    deterministic: item.deterministic !== false,
  };
}

function projectMarket(snapshotValue, crossValue) {
  const snapshot = record(snapshotValue);
  const instruments = record(snapshot.instruments);
  const rows = Object.entries(instruments).map(([symbol, value]) => marketItem(symbol, value));
  const cross = record(crossValue);
  for (const symbol of ["DXY", "VIX", "US10Y", "US02Y", "GC", "CL"]) {
    if (cross[symbol] != null && !rows.some((item) => item.symbol === symbol)) {
      rows.push(marketItem(symbol, cross[symbol]));
    }
  }
  return rows.filter((item) => item.price !== "—");
}

function marketItem(symbol, sourceValue) {
  const source = typeof sourceValue === "number" ? { value: sourceValue } : record(sourceValue);
  const price = numberValue(source.latest_close, source.last_close, source.close, source.price, source.value, source.last);
  const change = numberValue(source.change_pct, source.delta_pct, source.percent_change, source.change, source.delta);
  const ohlc = record(source.day_ohlc || source.ohlc);
  const open = numberValue(ohlc.open, source.day_open, source.open);
  const high = numberValue(ohlc.high, source.day_high, source.high);
  const low = numberValue(ohlc.low, source.day_low, source.low);
  const close = numberValue(ohlc.close, source.day_close, price);
  const marketDate = isoDate(source.market_date || source.session_date || source.latest_timestamp_paris || source.timestamp_paris) || "";
  const series = array(source.intraday_series).map((pointValue) => {
    const point = record(pointValue);
    return {
      time: stringValue(point.timestamp_paris, point.timestamp_utc, point.timestamp) || "",
      open: numberValue(point.open),
      high: numberValue(point.high),
      low: numberValue(point.low),
      close: numberValue(point.close),
    };
  }).filter((point) => point.time && point.close != null);
  return {
    symbol,
    price: price == null ? "—" : formatNumber(price),
    change: change == null ? "—" : `${change > 0 ? "+" : ""}${formatNumber(change)}${source.change_pct != null || source.percent_change != null ? "%" : ""}`,
    trend: change == null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    note: source.availability === "last_closed_session"
      ? `Dernière séance · ${marketDate || "date inconnue"} · ${timeLabel(source.latest_timestamp_paris || source.timestamp_paris)}`
      : timeLabel(source.latest_timestamp_paris || source.timestamp_paris) === "—"
        ? stringValue(source.availability, source.status) || "Source backend"
        : `au ${timeLabel(source.latest_timestamp_paris || source.timestamp_paris)}`,
    ohlc: {
      open: open == null ? "—" : formatNumber(open),
      high: high == null ? "—" : formatNumber(high),
      low: low == null ? "—" : formatNumber(low),
      close: close == null ? "—" : formatNumber(close),
    },
    marketDate,
    asOf: stringValue(source.latest_timestamp_paris, source.timestamp_paris) || "",
    source: stringValue(source.source, source.dataset) || "backend",
    rsi: numberValue(source.rsi_14) == null ? "—" : formatNumber(numberValue(source.rsi_14)),
    atr: numberValue(source.atr_14) == null ? "—" : formatNumber(numberValue(source.atr_14)),
    seriesTimeframe: stringValue(source.series_timeframe, source.timeframe) || "",
    availability: stringValue(source.availability) || "backend",
    series,
  };
}

function projectMarketBrief(snapshotValue, fullMaster) {
  const snapshot = record(snapshotValue);
  const range = record(snapshot.session_high_low);
  const instrumentCount = Object.keys(record(snapshot.instruments)).length;
  const lastClosedSession = snapshot.market_closed === true || snapshot.availability === "last_closed_session";
  const effectiveMarketDate = isoDate(snapshot.effective_market_date) || "";
  const text = narrative(fullMaster.market_context || fullMaster.market_structure) || (
    range.high != null && range.low != null
      ? `Range observé ${formatNumber(range.low)}–${formatNumber(range.high)} au cutoff backend.`
      : instrumentCount
        ? `${instrumentCount} actifs alimentés par les données de marché quotidiennes avec OHLC, variation, RSI et ATR.`
        : "Aucun snapshot de marché matérialisé."
  );
  return {
    headline: lastClosedSession
      ? "Marché fermé · dernière séance"
      : stringValue(snapshot.range_state?.label, snapshot.range_state?.status) || (instrumentCount ? "Prix & évolution" : "Snapshot de session"),
    text: lastClosedSession && effectiveMarketDate
      ? `${text} Données figées sur la dernière séance disponible du ${effectiveMarketDate}.`
      : text,
    verdict: snapshot.anti_lookahead_compliant === false
      ? "Cutoff à vérifier"
      : lastClosedSession
        ? `Dernière séance · ${effectiveMarketDate || "indisponible"}`
        : "Source backend",
  };
}

function projectDeskReading(fullMasterValue, monitorValue, fallbackSummary) {
  const fullMaster = record(fullMasterValue);
  const monitor = record(monitorValue);
  const decision = record(monitor.monitor_decision);
  const update = record(monitor.active_thesis_update || monitor.thesis_update);
  const realizedFacts = array(monitor.expected_vs_realized)
    .map((item) => {
      const row = record(item);
      const label = stringValue(row.element, row.label, row.condition);
      const realized = narrative(row.realized);
      return [label, realized].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
  const facts = compactNarratives([
    ...realizedFacts,
    fullMaster.observable_facts,
    fullMaster.fact_sheet,
    fullMaster.technical_analysis,
    fullMaster.market_structure,
  ], 5);
  const interpretation = compactNarratives([
    fullMaster.interpretations,
    decision.detailed_reason,
    decision.reason_summary,
    decision.rationale,
    fullMaster.market_context,
    fullMaster.market_regime,
    fullMaster.macro_thesis,
    fallbackSummary,
  ], 4);
  const thesisEvolution = compactNarratives([
    update.summary,
    update.dominant_scenario,
    update.notes,
    decision.next_monitoring_focus,
    decision.next_action,
    monitor.weak_signals,
  ], 4);
  return {
    facts: facts.length ? facts : ["Aucun fait structuré supplémentaire n’a été matérialisé."],
    interpretation: interpretation.length ? interpretation : ["Aucune interprétation structurée supplémentaire n’a été matérialisée."],
    thesisEvolution: thesisEvolution.length ? thesisEvolution : ["La thèse n’a pas encore de delta matérialisé."],
  };
}

function compactNarratives(values, limit) {
  const candidates = values.flatMap((value) => {
    if (Array.isArray(value)) return value.map(narrative);
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, item]) => {
        const text = narrative(item);
        return text ? `${humanize(key)} · ${text}` : "";
      });
    }
    return [narrative(value)];
  });
  return [...new Set(candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => value.length > 320 ? `${value.slice(0, 317)}…` : value))]
    .slice(0, limit);
}

function projectCrossAssetBrief(crossValue) {
  const cross = record(crossValue);
  return {
    headline: "Contexte cross-asset",
    text: narrative(cross.summary || cross) || "Aucun contexte cross-asset pack immuable disponible au cutoff.",
    verdict: hasMaterialValue(cross) ? "Pack immuable" : "Donnée indisponible",
  };
}

function projectLatestChange(monitorValue, { master: masterValue, nextRevalidationTime } = {}) {
  const monitor = record(monitorValue);
  if (!Object.keys(monitor).length) {
    const master = record(masterValue);
    const masterTimestamp = timestampOf(master);
    const nextCheckpoint = timeLabel(nextRevalidationTime);
    return {
      title: masterTimestamp ? `Nouveau plan à ${timeLabel(masterTimestamp)}` : "Aucun Monitor disponible",
      items: Object.keys(master).length ? [{
        tone: "neutral",
        text: "Le Master courant attend son premier Monitor ; aucun delta n’est encore applicable.",
      }] : [],
      consequence: nextCheckpoint !== "—"
        ? `Premier delta attendu au prochain checkpoint, à ${nextCheckpoint}.`
        : "Aucune évolution matérialisée.",
    };
  }
  const score = record(monitor.thesis_health_score);
  const decision = record(monitor.monitor_decision);
  const thesisUpdate = record(monitor.active_thesis_update || monitor.thesis_update);
  const assessment = record(decision.setup_assessment);
  const positive = stringArray(score.score_drivers_positive || monitor.validated_elements);
  const negative = stringArray(score.score_drivers_negative || monitor.weak_signals || monitor.invalidated_elements);
  const realized = Object.entries(record(assessment.realized_delta)).map(([instrument, value]) => ({
    tone: "neutral",
    text: `${instrument} · ${narrative(value)}`,
  }));
  const items = [
    ...positive.map((text) => ({ tone: "positive", text })),
    ...negative.map((text) => ({ tone: "negative", text })),
    ...realized,
  ];
  return {
    title: timestampOf(monitor) ? `Évolution au ${timeLabel(timestampOf(monitor))}` : "Aucun Monitor disponible",
    items,
    consequence: monitorNarrative(monitor)
      || narrative(thesisUpdate.dominant_scenario, thesisUpdate.notes)
      || "Aucune évolution matérialisée.",
  };
}

function projectTimeline(master, monitors, jobsValue, alertsValue) {
  const events = [];
  if (master && Object.keys(master).length) {
    events.push({
      time: timeLabel(timestampOf(master)), type: "MASTER", title: "Master Analysis", status: stringValue(master.status) || "SAVED",
      detail: narrative(master.full_analysis || master.summary) || "Master matérialisé.", severity: "info",
      summary: stringValue(master.full_analysis?.executive_summary?.summary, master.summary) || "Master matérialisé.", sourceType: "MASTER",
      _timestamp: timestampOf(master),
    });
  }
  monitors.forEach((monitor, index) => {
    const item = projectMonitor(monitor, index);
    events.push({
      time: item.time, type: "MONITOR", title: `Monitor #${item.sequence}`, status: item.statusAfter,
      detail: item.detailedReason, severity: item.severity, summary: item.summary, sourceType: "MONITOR",
      _timestamp: timestampOf(monitor),
    });
  });
  array(jobsValue).forEach((job) => events.push({
    time: timeLabel(timestampOf(job)), type: "JOB", title: stringValue(job.job_type) || "Worker", status: stringValue(job.status) || "UNKNOWN",
    detail: narrative(job.error || job.detail) || "Événement worker backend.", severity: severityFrom(null, job.status),
    summary: stringValue(job.job_id) || "Job backend", sourceType: "WORKER", _timestamp: timestampOf(job),
  }));
  array(alertsValue).forEach((alert) => events.push({
    time: timeLabel(timestampOf(alert)), type: "ALERT", title: stringValue(alert.title) || "Alerte", status: stringValue(alert.severity) || "warning",
    detail: stringValue(alert.message) || "Alerte backend", severity: severityFrom(alert.severity, alert.status),
    summary: stringValue(alert.message) || "Alerte backend", sourceType: "ALERT", _timestamp: timestampOf(alert),
  }));
  return events
    .sort((left, right) => String(left._timestamp || "").localeCompare(String(right._timestamp || "")))
    .map(({ _timestamp, ...event }) => event);
}

function projectOperationalTimeline(live, master, monitors) {
  const checkpoint = record(live.next_live_checkpoint);
  const schedule = record(live.live_checkpoint_schedule);
  const history = [];
  if (master && Object.keys(record(master)).length) {
    history.push(operationalTimelineItem({
      id: stringValue(master.analysis_id) || "master",
      type: "MASTER",
      label: "Master",
      plannedAt: timestampOf(master),
      actualAt: actualTimestampOf(master),
      summary: stringValue(master.full_analysis?.executive_summary?.summary, master.summary) || "Analyse Master matérialisée.",
      detail: narrative(master.full_analysis?.decision, master.full_analysis?.executive_summary) || "Décision Master enregistrée.",
    }));
  }
  monitors.forEach((monitor, index) => {
    const projected = projectMonitor(monitor, index);
    history.push(operationalTimelineItem({
      id: projected.id,
      type: "MONITOR",
      label: `Monitor ${projected.time}`,
      plannedAt: timestampOf(monitor),
      actualAt: actualTimestampOf(monitor),
      summary: projected.summary,
      detail: projected.detailedReason,
    }));
  });
  const dueCheckpoint = stringValue(schedule.due_checkpoint);
  if (dueCheckpoint && !history.some((item) => sameInstant(item.plannedAt, dueCheckpoint))) {
    history.push(operationalTimelineItem({
      id: `${checkpoint.cursor_id || "live"}:${dueCheckpoint}`,
      type: stringValue(schedule.due_workflow) === "LIVE_MASTER" ? "MASTER" : "MONITOR",
      label: stringValue(schedule.due_workflow) === "LIVE_MASTER" ? "Master à traiter" : "Monitor à traiter",
      plannedAt: dueCheckpoint,
      actualAt: schedule.due_completed === true ? dueCheckpoint : null,
      status: checkpoint.task_status,
      summary: checkpoint.task_status === "LATE"
        ? "Le checkpoint est prêt mais n’a pas encore été finalisé."
        : "Checkpoint opérationnel courant.",
      detail: `État backend : ${checkpoint.task_status || "indisponible"}.`,
    }));
  }
  const nextCheckpoint = stringValue(schedule.next_checkpoint);
  if (nextCheckpoint) {
    history.push(operationalTimelineItem({
      id: `${checkpoint.cursor_id || "live"}:${nextCheckpoint}`,
      type: stringValue(schedule.next_workflow) === "LIVE_MASTER" ? "MASTER" : "MONITOR",
      label: stringValue(schedule.next_workflow) === "LIVE_MASTER" ? "Prochain Master" : "Prochain Monitor",
      plannedAt: nextCheckpoint,
      actualAt: null,
      status: "SCHEDULED",
      summary: "Prochain checkpoint planifié par le backend.",
      detail: `Cadence analytique GPT : ${numberValue(schedule.cadence_minutes) ?? 15} minutes.`,
    }));
  }
  return history
    .filter((item) => item.plannedAt)
    .sort((left, right) => String(left.plannedAt).localeCompare(String(right.plannedAt)))
    .slice(-12);
}

function operationalTimelineItem({ id, type, label, plannedAt, actualAt, status, summary, detail }) {
  const plannedMs = Date.parse(plannedAt || "");
  const actualMs = Date.parse(actualAt || "");
  const latencySeconds = Number.isFinite(plannedMs) && Number.isFinite(actualMs)
    ? Math.max(0, Math.round((actualMs - plannedMs) / 1000))
    : null;
  return {
    id,
    type,
    label,
    plannedAt: plannedAt || null,
    actualAt: actualAt || null,
    plannedTime: timeLabel(plannedAt),
    actualTime: timeLabel(actualAt),
    status: status || (actualAt ? "EXECUTED" : "SCHEDULED"),
    latencySeconds,
    summary,
    detail,
  };
}

function actualTimestampOf(value) {
  const item = record(value);
  return stringValue(
    item.saved_at_paris,
    item.completed_at_paris,
    item.updated_at_paris,
    item.saved_at_utc,
    item.completed_at_utc,
    item.updated_at_utc,
  );
}

function sameInstant(left, right) {
  const leftMs = Date.parse(left || "");
  const rightMs = Date.parse(right || "");
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function projectAutomation(jobsValue) {
  const jobs = array(jobsValue);
  const active = jobs.find((job) => !["DONE", "FAILED", "CANCELLED"].includes(String(job.status || "").toUpperCase()));
  return {
    status: active ? stringValue(active.status) || "active" : jobs.length ? "idle" : "unknown",
    worker: stringValue(active?.claimed_by, active?.worker, active?.job_type) || "Non renseigné",
    cadence: stringValue(active?.cadence) || "Selon workflow backend",
  };
}

function projectActivity(jobsValue) {
  return array(jobsValue).slice(0, 20).map((job) => ({
    time: timeLabel(timestampOf(job)),
    title: humanize(stringValue(job.job_type) || "worker"),
    detail: narrative(job.error || job.detail) || stringValue(job.job_id) || "Job backend",
    status: String(job.status || "unknown").toLowerCase(),
  }));
}

function projectLevels(levelsValue) {
  return array(levelsValue).map((value) => {
    const primitivePrice = typeof value === "object" ? null : numberValue(value);
    if (primitivePrice != null) {
      return {
        price: formatNumber(primitivePrice),
        role: "Niveau clé",
        state: "observed",
      };
    }

    const level = record(value);
    const explicitPrice = numberValue(level.price, level.level, level.value);
    const from = numberValue(level.level_from, level.from);
    const to = numberValue(level.level_to, level.to);
    const midpoint = numberValue(level.mid);
    let price = "—";
    if (explicitPrice != null) {
      price = formatNumber(explicitPrice);
    } else if (from != null && to != null) {
      price = from === to
        ? formatNumber(from)
        : `${formatNumber(from)} – ${formatNumber(to)}`;
    } else {
      price = formatNumber(from ?? to ?? midpoint);
    }

    const instrument = stringValue(level.instrument);
    const levelType = stringValue(level.role, level.label, level.type);
    return {
      price,
      role: [instrument, levelType].filter(Boolean).join(" · ") || "Niveau clé",
      state: stringValue(level.state, level.status, level.actionability) || "observed",
    };
  });
}

function projectMacroEvent(eventValue, isNext = false) {
  const event = record(eventValue);
  const scheduledAt = stringValue(event.timestamp_paris, event.scheduled_at_paris, event.datetime_paris) || "";
  return {
    time: timeLabel(timestampOf(event) || event.time),
    title: stringValue(event.title, event.event, event.name, event.label) || "Événement macro",
    importance: stringValue(event.importance, event.impact) || "unknown",
    impactText: narrative(event.impact_text || event.summary || event.details) || "Impact non renseigné par le backend.",
    scheduledAt,
    date: isoDate(event.date || scheduledAt) || "",
    currency: stringValue(event.currency, event.country) || "—",
    previous: macroValue(event.previous, event.prev),
    forecast: macroValue(event.forecast, event.consensus),
    actual: event.actual_hidden === true || event.actual_visible_at_cutoff === false && event.actual == null ? "—" : macroValue(event.actual),
    isNext,
  };
}

function projectMacroEvents(events, asOfUtc) {
  const nowMs = Date.parse(asOfUtc || "");
  const nextIndex = events.findIndex((event) => {
    const timestamp = Date.parse(timestampOf(event) || "");
    return Number.isFinite(timestamp) && (!Number.isFinite(nowMs) || timestamp >= nowMs);
  });
  const targetIndex = nextIndex >= 0 ? nextIndex : (!Number.isFinite(nowMs) && events.length ? 0 : -1);
  return events.map((event, index) => projectMacroEvent(event, index === targetIndex));
}

function projectNews(newsValue, items, macroEvents = [], asOfUtc = null) {
  const news = record(newsValue);
  const projectedMacro = projectMacroEvents(array(macroEvents), asOfUtc);
  const fallbackItems = items.length ? [] : projectedMacro
    .slice(0, 48)
    .map((event) => ({
      ...event,
      source: "Calendrier macro",
      impact: event.impactText || `Catalyseur macro ${String(event.importance || "important").toLowerCase()}.`,
    }));
  const visibleItems = items.length ? items : fallbackItems;
  const highImpactCount = projectedMacro.filter((event) => ["high", "critical", "red"].includes(event.importance.toLowerCase())).length;
  const fallbackDigest = fallbackItems.length
    ? `${fallbackItems.length} événement${fallbackItems.length > 1 ? "s" : ""} macro dans la fenêtre glissante de 48 h avant/après, dont ${highImpactCount} à fort impact. Flux indépendant du Master et des workers.`
    : "";
  const digest = stringValue(news.digest, news.summary) || narrative(news.macro_context_fallback) || (
    visibleItems.length ? fallbackDigest || "Headlines backend disponibles ; aucun digest agrégé matérialisé." : "Aucun digest news matérialisé."
  );
  return {
    digestUpdatedAt: timeLabel(news.updated_at_paris || news.as_of_utc || news.resolved_scope?.as_of_utc || timestampOf(fallbackItems[0])),
    digest,
    status: stringValue(news.status) || (visibleItems.length ? "ready" : "empty"),
    provider: stringValue(news.provider, news.source) || (items.length ? "backend" : "macro_calendar"),
    freshness: {
      status: stringValue(news.freshness?.status) || (items.length ? "available" : "fallback"),
      ageMinutes: numberValue(news.freshness?.age_minutes),
    },
    headlines: visibleItems.map((item) => ({
      time: timeLabel(timestampOf(item)),
      title: stringValue(item.title, item.headline, item.event) || "Headline",
      source: stringValue(item.source, item.provider) || "Backend",
      impact: narrative(item.impact || item.summary || item.description) || "Impact non renseigné.",
      scheduledAt: stringValue(item.scheduledAt, item.timestamp_paris, item.published_at_paris) || "",
      date: isoDate(item.date || item.scheduledAt || item.timestamp_paris || item.published_at_paris) || "",
      currency: stringValue(item.currency) || "—",
      importance: stringValue(item.importance, item.severity) || "unknown",
      previous: macroValue(item.previous, item.prev),
      forecast: macroValue(item.forecast, item.consensus),
      actual: macroValue(item.actual),
      isNext: item.isNext === true,
      url: stringValue(item.url, item.canonical_url, item.original_url),
      provider: stringValue(item.provider) || (item.source === "Calendrier macro" ? "MACRO_CALENDAR" : "backend"),
      publishedAt: stringValue(item.published_at_utc, item.published_at_paris),
      assets: stringArray(item.assets),
      topics: stringArray(item.topics),
    })),
  };
}

function macroValue(...values) {
  for (const value of values) {
    if (value == null || String(value).trim() === "") continue;
    return String(value);
  }
  return "—";
}

function dailyEvents(eventsValue, date) {
  return array(eventsValue)
    .filter((event) => !date || isoDate(event.date || timestampOf(event)) === date)
    .sort((left, right) => String(timestampOf(left) || left.time_paris || "").localeCompare(String(timestampOf(right) || right.time_paris || "")));
}

function macroEventsInWindow(eventsValue, windowValue) {
  const window = record(windowValue);
  const fromMs = Date.parse(stringValue(window.from_utc));
  const toMs = Date.parse(stringValue(window.to_utc));
  return array(eventsValue)
    .filter((event) => {
      const timestamp = Date.parse(timestampOf(event) || "");
      if (!Number.isFinite(timestamp)) return false;
      return (!Number.isFinite(fromMs) || timestamp >= fromMs)
        && (!Number.isFinite(toMs) || timestamp <= toMs);
    })
    .sort((left, right) => String(timestampOf(left) || left.time_paris || "")
      .localeCompare(String(timestampOf(right) || right.time_paris || "")));
}

function macroWindow(centerUtc, beforeHours, afterHours) {
  const centerMs = Date.parse(centerUtc);
  return {
    before_hours: beforeHours,
    after_hours: afterHours,
    from_utc: new Date(centerMs - beforeHours * 60 * 60_000).toISOString(),
    to_utc: new Date(centerMs + afterHours * 60 * 60_000).toISOString(),
  };
}

function projectAlert(alertValue) {
  const alert = record(alertValue);
  return {
    level: severityFrom(alert.severity, alert.status),
    title: stringValue(alert.title) || "Alerte",
    message: stringValue(alert.message) || "Alerte backend",
    time: timeLabel(timestampOf(alert)),
  };
}

function projectDataQuality(live, audit) {
  const readiness = record(live.data_readiness);
  const coreKeys = new Set(["pack", "market_triggers", "raw_window"]);
  const coreFailures = Object.entries(readiness).filter(([key, value]) => (
    coreKeys.has(key) && ["missing", "failing", "failed"].includes(String(value).toLowerCase())
  ));
  const contextGaps = Object.entries(readiness).filter(([key, value]) => (
    !coreKeys.has(key)
    && ["missing", "last_known", "unknown"].includes(String(value).toLowerCase())
    && !["cross_asset_delta"].includes(key)
  ));
  const packQuality = record(live.pack?.quality);
  const packWarnings = [
    ...stringArray(packQuality.warnings),
    ...stringArray(packQuality.stale_datasets).map((dataset) => `Contexte last-known: ${dataset}`),
  ];
  const warnings = [
    ...coreFailures.map(([key, value]) => `${key}: ${value}`),
    ...contextGaps.map(([key, value]) => `${key}: ${value}`),
    ...packWarnings,
    ...stringArray(audit.data_quality?.warnings),
    ...array(audit.errors).slice(0, 10).map((error) => narrative(error)).filter(Boolean),
  ];
  const anti = record(audit.anti_lookahead);
  const antiLookahead = anti.pack_cutoff_ok !== false && anti.no_actual_j_jplus1 !== false && anti.no_post_cutoff_candles !== false;
  const packDegraded = String(packQuality.status || "").toLowerCase().includes("degrad");
  const hardDegraded = coreFailures.length > 0 || !antiLookahead;
  const contextLimited = !hardDegraded && (
    contextGaps.length > 0
    || packDegraded
    || packWarnings.length > 0
    || array(audit.errors).length > 0
  );
  return {
    label: hardDegraded
      ? "Flux essentiel dégradé"
      : contextLimited
        ? "Contexte partiel"
        : "Données prêtes",
    status: hardDegraded ? "degraded" : contextLimited ? "context_limited" : "ready",
    antiLookahead,
    warnings: [...new Set(warnings)],
    executionReady: !hardDegraded,
    contextLimited,
  };
}

function projectAudit(live, audit) {
  const contracts = record(live.contracts);
  return {
    contracts: Object.values(contracts).filter(Boolean).map((contract) => ({
      name: stringValue(contract.contract_name) || "Contrat",
      version: stringValue(contract.schema_version) || "—",
      status: stringValue(contract.status) || (contract.is_active ? "active" : "unknown"),
    })),
    checks: [
      { label: "Pack cutoff", status: audit.anti_lookahead?.pack_cutoff_ok === false ? "warning" : "ok" },
      { label: "Bougies post-cutoff", status: audit.anti_lookahead?.no_post_cutoff_candles === false ? "warning" : "ok" },
      { label: "Actuals J/J+1", status: audit.anti_lookahead?.no_actual_j_jplus1 === false ? "warning" : "ok" },
      { label: "Erreurs backend", status: array(audit.errors).length ? "warning" : "ok" },
    ],
    apiMap: FRONT_API_MAP.map(([view, endpoint]) => ({ view, endpoint })),
  };
}

function selectSetup(setupsValue, thesis, riskOrderValue, fullMaster) {
  const setups = array(setupsValue);
  const preferredId = stringValue(fullMaster.primary_setup_id, fullMaster.executive_summary?.primary_setup_id);
  return record(
    setups.find((item) => preferredId && item.setup_id === preferredId) ||
    setups.find((item) => item.is_primary === true) ||
    setups[0] ||
    thesis.risk_order ||
    riskOrderValue,
  );
}

function uniqueMonitors(values) {
  const seen = new Set();
  return array(values)
    .filter((item) => item && typeof item === "object")
    .filter((item, index) => {
      const key = stringValue(item.monitor_id, item.id) || `${timestampOf(item)}:${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(timestampOf(left) || "").localeCompare(String(timestampOf(right) || "")));
}

function frontReadableMonitor(value) {
  const monitor = record(value);
  const projection = record(monitor.front_read_projection);
  if (!Object.keys(projection).length) return monitor;
  return {
    ...monitor,
    ...projection,
    monitor_decision: {
      ...record(monitor.monitor_decision),
      ...record(projection.monitor_decision),
    },
  };
}

function monitorNarrative(monitorValue) {
  const monitor = record(monitorValue);
  return stringValue(
    monitor.monitor_decision?.detailed_reason,
    monitor.monitor_decision?.reason_summary,
    monitor.monitor_decision?.rationale,
    monitor.monitor_decision?.summary,
    monitor.summary,
  );
}

function targetPrice(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  const target = record(value);
  return numberValue(target.price, target.level, target.target, target.value);
}

function timestampOf(value) {
  const item = record(value);
  return stringValue(
    item.scheduledAt,
    item.timestamp_paris,
    item.published_at_paris,
    item.published_at_utc,
    item.created_at_paris,
    item.updated_at_paris,
    item.as_of_utc,
    item.created_at_utc,
    item.created_at,
    item.time_paris,
    item.scheduled_at_paris,
    item.time,
  );
}

function severityFrom(colorValue, statusValue) {
  const value = `${colorValue || ""} ${statusValue || ""}`.toLowerCase();
  if (/red|critical|invalid|replan|required|failed|error|expired/.test(value)) return "critical";
  if (/orange|warning|weaken|risk|stale|degraded/.test(value)) return "warning";
  if (/green|positive|ready|done|protected/.test(value)) return "positive";
  if (/yellow|watch|wait|armed/.test(value)) return "watch";
  return "info";
}

function narrative(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) return String(value);
    if (Array.isArray(value)) {
      const text = value.map((item) => narrative(item)).filter(Boolean).join(" · ");
      if (text) return text;
      continue;
    }
    if (typeof value === "object") {
      const preferred = stringValue(
        value.summary,
        value.headline,
        value.text,
        value.description,
        value.reason_summary,
        value.detailed_reason,
        value.label,
      );
      if (preferred) return preferred;
      const entries = Object.entries(value)
        .map(([key, item]) => {
          const text = narrative(item);
          return text ? `${humanize(key)}: ${text}` : "";
        })
        .filter(Boolean)
        .slice(0, 6);
      if (entries.length) return entries.join(" · ");
    }
  }
  return "";
}

function hasMaterialValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.some(hasMaterialValue);
  if (typeof value === "object") return Object.values(value).some(hasMaterialValue);
  return false;
}

function stringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => narrative(item)).filter(Boolean);
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${humanize(key)}: ${narrative(item)}`).filter((item) => !item.endsWith(": "));
  return [String(value)].filter(Boolean);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(...values) {
  for (const value of values) {
    if (["string", "number", "boolean"].includes(typeof value) && String(value).trim()) return String(value).trim();
  }
  return "";
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function formatNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(value));
}

function timeLabel(value) {
  if (!value) return "—";
  const text = String(value);
  const isoMatch = text.match(/T(\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];
  const timeMatch = text.match(/\b(\d{2}:\d{2})\b/);
  return timeMatch ? timeMatch[1] : "—";
}

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isoDate(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function parisDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function safeRead(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}
