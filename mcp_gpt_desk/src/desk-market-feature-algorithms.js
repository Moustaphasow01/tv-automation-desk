import { createDeskExecutionScope, strategyDefinition } from "@tv-automation/desk-domain";
import { replaySetupOutcome } from "@tv-automation/desk-replay-engine";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DATASETS } from "./schemas.js";
import { datasetRef, replaySourceCoverage } from "./desk-pack-service.js";
import { deskError } from "./desk-errors.js";
import { stableVNextId } from "./desk-ids.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { normalizeDeskInstrumentScopes } from "./data-availability-policy.js";
import { buildDevelopingVolumeProfile } from "./market-derived-features.js";
import { AVERAGE_RANGE_LEGACY_VERSION, buildVolatilityIndicators, recentAverageRange as legacyRecentAverageRange, WILDER_ATR_14_VERSION } from "./market-volatility-indicators.js";
import { lastSundayUtc, parisOffsetForDate } from "./market-feature-time.js";

export { lastSundayUtc, parisOffsetForDate } from "./market-feature-time.js";

export function normalizeOperationalQuery(args = {}, { requireMaster = false, requireThesis = false } = {}) {
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

export function assertReplayRunMatchesQuery(run, query) {
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

export function operationalQueryScope(query, run = null) {
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

export function selectLevelMap(docs, { date, session = "asia_open", instrument }) {
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

export function selectTechnicalEvents(docs, { date, session = "asia_open", instrument, from, to, event_type }) {
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

export function crossAssetDeltaResult(delta, { timestamp_paris, window = "1h", count = 0, source = null } = {}) {
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

export function crossAssetDeltaMissingAssets(delta) {
  if (!delta) {
    return [];
  }
  const assets = delta.assets || {};
  return ["DXY"].filter((asset) => !assets[asset]?.row_count);
}

export function crossAssetDeltaOptionalMissingAssets(delta) {
  if (!delta) {
    return [];
  }
  const assets = delta.assets || {};
  return ["VIX", "US10Y", "US02Y"].filter((asset) => !assets[asset]?.row_count);
}

export function crossAssetStaleCheck(delta, { timestamp_paris, window }) {
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

export function selectConditionStatus(docs, { thesis_id, timestamp_paris }) {
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

export function selectSessionSnapshot(docs, { date, session = "asia_open", instrument }) {
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

export function featureRunStarted(args, tick) {
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

export function featureRunCompleted(run, result, tick) {
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

export function featureRunFailed(run, error, tick) {
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

export function featureDatasetCandidates(instrument) {
  return {
    "5": [`${instrument}_M5`, `${instrument}_5`, `${instrument}_5m`, `${instrument}_m5`],
    "15": [`${instrument}_M15`, `${instrument}_15`, `${instrument}_15m`, `${instrument}_m15`],
    "1H": [`${instrument}_H1`, `${instrument}_1H`, `${instrument}_60`, `${instrument}_h1`],
    "4H": [`${instrument}_H4`, `${instrument}_4H`, `${instrument}_240`, `${instrument}_h4`],
  };
}

export function normalizeFeatureRows(rows, { instrument, timeframe, rawRef }) {
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

export function buildDeterministicFeatureSet({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at }) {
  const mainRows = candlesByTimeframe["5"] || candlesByTimeframe.M5 || candlesByTimeframe["15"] || [];
  const session_snapshot = buildSessionSnapshotDoc({ date, session, instrument, rows: mainRows, cutoff_paris, computed_at });
  const level_map = buildLevelMapDoc({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at });
  const technical_events = buildTechnicalEventDocs({ date, session, instrument, rows: mainRows, levels: level_map.levels, cutoff_paris, computed_at });
  return { session_snapshot, level_map, technical_events };
}

export function buildSessionSnapshotDoc({ date, session, instrument, rows, cutoff_paris, computed_at }) {
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
    poc_vah_val: buildDevelopingVolumeProfile(sessionRows.length ? sessionRows : rows, {
      cutoffUtc: normalizeUtcIso(cutoff_paris || computed_at),
      tickSize: ["MES", "ES"].includes(instrument) ? 0.25 : 0.25,
    }),
    range_state: rangeState(sessionRows.length ? sessionRows : rows),
    volatility_state: volatilityState(sessionRows.length ? sessionRows : rows),
    computed_with_cutoff: cutoff_paris,
    anti_lookahead_compliant: true,
    computed_at,
  };
}

export function buildLevelMapDoc({ date, session, instrument, candlesByTimeframe, cutoff_paris, computed_at }) {
  const candidates = [];
  for (const [timeframe, rows] of Object.entries(candlesByTimeframe || {})) {
    candidates.push(...levelCandidatesFromRows(rows, timeframe, date));
  }
  const baseRows = candlesByTimeframe["5"] || candlesByTimeframe.M5 || candlesByTimeframe["15"] || [];
  const averageRange = recentAverageRange(baseRows) || 1;
  const tolerance = Math.max(averageRange * 0.35, ["MNQ", "NQ", "MES", "ES"].includes(instrument) ? 2 : 0.1);
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

export function levelCandidatesFromRows(rows, timeframe, date) {
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

export function featureCandidate(price, role, timeframe, source, row) {
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

export function clusterFeatureCandidates(candidates, tolerance) {
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

export function scoreFeatureCluster({ cluster, rows, tolerance, index, computed_at }) {
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

export function buildTechnicalEventDocs({ date, session, instrument, rows, levels, cutoff_paris, computed_at }) {
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

export function technicalEventType({ row, previousClose, level }) {
  if (previousClose <= level.level_to && row.close > level.level_to) return "breakout";
  if (previousClose >= level.level_from && row.close < level.level_from) return "breakdown";
  if (row.high > level.level_to && row.close < level.mid) return "sweep";
  if (row.low < level.level_from && row.close > level.mid) return "reclaim";
  if (row.low <= level.level_to && row.high >= level.level_from) return "retest";
  return null;
}

export function buildCrossAssetDeltaDocs({ timestamp_paris, rowsByAsset, computed_at }) {
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

export function buildConditionStatusDoc({ thesis, timestamp_paris, latest_price, computed_at }) {
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

export function evaluateConditionItem(condition, { latest_price, index, kind }) {
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

export function compareNumber(left, operator, right) {
  return {
    ">": left > right,
    ">=": left >= right,
    "<": left < right,
    "<=": left <= right,
    "==": left === right,
  }[String(operator)] ?? false;
}

export function summarizeFeatureOutput(features, candlesByTimeframe) {
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

export function summarizeCrossAssetDelta(delta) {
  return {
    delta_id: delta.delta_id,
    window: delta.window,
    assets: Object.keys(delta.assets || {}).sort(),
    rows: Object.fromEntries(Object.entries(delta.assets || {}).map(([asset, item]) => [asset, item.row_count || 0])),
  };
}

export function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundNumber(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

export function highLowBlock(rows) {
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

export function rowsBetweenParis(rows, startHm, endHm, { beforeDate } = {}) {
  return (rows || []).filter((row) => {
    const ts = String(row.timestamp_paris || "");
    if (beforeDate && ts.slice(0, 10) >= beforeDate) {
      return false;
    }
    const hm = ts.slice(11, 16);
    return hm >= startHm && hm <= endHm;
  });
}

export function vwapValue(rows) {
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

export function rangeState(rows) {
  const block = highLowBlock(rows);
  const volatility = buildVolatilityIndicators(rows);
  const atr = volatility.atr_14;
  const averageRange = volatility.average_range_14;
  const reference = volatility.volatility_reference_points;
  return {
    range_points: block.range_points || 0,
    atr_14: atr,
    atr_14_version: WILDER_ATR_14_VERSION,
    average_range_14: averageRange,
    average_range_legacy_version: AVERAGE_RANGE_LEGACY_VERSION,
    legacy_atr_14: averageRange,
    range_vs_atr: atr ? roundNumber((block.range_points || 0) / atr) : null,
    range_vs_average_range: averageRange ? roundNumber((block.range_points || 0) / averageRange) : null,
    range_vs_volatility_reference: reference ? roundNumber((block.range_points || 0) / reference) : null,
    volatility_reference_source: volatility.volatility_reference_source,
  };
}

export function volatilityState(rows) {
  const volatility = buildVolatilityIndicators(rows);
  const avgRange = volatility.average_range_recent;
  const atr = volatility.atr_14;
  const reference = volatility.volatility_reference_points;
  const ratio = reference ? avgRange / reference : 0;
  return {
    atr_14: atr,
    atr_14_version: WILDER_ATR_14_VERSION,
    average_range_14: volatility.average_range_14,
    average_range_legacy_version: AVERAGE_RANGE_LEGACY_VERSION,
    avg_recent_range: avgRange,
    avg_recent_range_version: AVERAGE_RANGE_LEGACY_VERSION,
    legacy_atr_14: volatility.average_range_14,
    volatility_reference_points: reference,
    volatility_reference_source: volatility.volatility_reference_source,
    regime: ratio > 1.2 ? "expanded" : ratio < 0.7 ? "compressed" : rows?.length ? "normal" : "unknown",
  };
}

export function recentAverageRange(rows, count = 14) {
  return legacyRecentAverageRange(rows, count);
}

export function average(values) {
  const valid = (values || []).filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

export function maxBy(values, score) {
  return [...(values || [])].sort((left, right) => score(right) - score(left))[0] || {};
}

export function rawRefForRow(row) {
  return {
    timestamp_utc: row?.timestamp_utc || null,
    timestamp_paris: row?.timestamp_paris || null,
    timeframe: row?.timeframe || null,
    raw_ref: row?.raw_ref || null,
  };
}

export function dedupeBy(values, keyFn) {
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

export function compactTimestamp(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "time";
}

export function deltaBlock(rows) {
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

export function summarizeAssetDeltas(assets) {
  const parts = Object.entries(assets || {})
    .filter(([, item]) => item.row_count)
    .map(([asset, item]) => `${asset}:${item.delta_points ?? "n/a"}`);
  return parts.length ? parts.join(" ") : "cross_asset_data_missing";
}

export function latestClose(rows) {
  const latest = (rows || []).at(-1);
  return latest ? latest.close : null;
}

export function offsetIso(value, offsetMs) {
  const base = Date.parse(value);
  if (!Number.isFinite(base)) {
    return value;
  }
  return toParisIso(base + offsetMs);
}

export async function safeRead(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}

export async function resolveFeatureEngineActiveThesis(store, args) {
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

export async function resolvePackForState(store, { date, session, timezone }) {
  if (session === "asia_open") {
    return safeRead(
      store.getLatestAsiaOpenPack({ date, timezone }).then((summary) => store.getDeskPack({ pack_id: summary.pack_id })),
      null,
    );
  }
  return safeRead(store.getDeskPack({ pack_id: `${date}_${session}` }), null);
}

export function assertRunPackScope(run, pack) {
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

export function assertReplaySourceCoverage(run, pack, requiredCutoff) {
  const coverage = replaySourceCoverage(pack);
  const requiredMs = Date.parse(requiredCutoff || "");
  const coverageMs = Date.parse(coverage.end_utc || "");
  const coreToleranceMs = 10 * 60 * 1000;
  const requiredDatasets = new Set(normalizeDeskInstrumentScopes(run).trading_instruments.map((instrument) => {
    const canonicalM1 = {
      MNQ: "MNQ_M1",
      MES: "MES_M1",
    }[instrument];
    const legacyM5 = {
      MNQ: "MNQ_M5",
      MES: "MES_M5",
    }[instrument];
    if (canonicalM1 && pack.datasets?.[canonicalM1]) return canonicalM1;
    if (legacyM5 && pack.datasets?.[legacyM5]) return legacyM5;
    return canonicalM1 || legacyM5 || null;
  }).filter(Boolean));
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

export function rawWindowQuality(rows, { reason, attempted_raw_refs = [] } = {}) {
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

export function assertRawWindowQuery(args, query, run = null) {
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

export async function buildScopedPackRawWindow(store, args, query, run = null) {
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

export function rawWindowDatasetCandidates(instrument, timeframe) {
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

export function rowMatchesInstrument(row, instrument, dataset) {
  const actual = String(row.asset || row.instrument || row.symbol || "").toUpperCase().replace("1!", "");
  const expected = String(instrument || "").toUpperCase().replace("1!", "");
  if (!actual) return String(dataset).startsWith(expected);
  return actual === expected;
}

export function datasetTimeframe(dataset, fallback) {
  const match = String(dataset || "").toUpperCase().match(/_(M5|M15|H1|H4)$/);
  return match ? canonicalTimeframe(match[1]) : canonicalTimeframe(fallback);
}

export function filterRawWindowRows(rows, { from, to }) {
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

export function marketFeedSymbol(instrument) {
  const mapping = {
    MNQ: "MNQ1!",
    MES: "MES1!",
    NQ: "NQ1!",
    ES: "ES1!",
    ZC: "ZC1!",
    ZW: "ZW1!",
    GC: "GC1!",
    CL: "CL1!",
    DXY: "DXY",
    VIX: "VIX",
    US10Y: "US10Y",
    US02Y: "US02Y",
  };
  return mapping[instrument] || instrument;
}

export function marketFeedCandidates(instrument, timeframe) {
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

export function writerDocumentId(...parts) {
  return parts.map((part) => {
    const text = String(part ?? "").trim()
      .replaceAll("/", "_")
      .replaceAll("\\", "_")
      .replaceAll(" ", "_");
    return text || "_";
  }).join("__");
}

export function canonicalTimeframe(value) {
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

export function timeframeMinutes(timeframe) {
  return {
    "1": 1,
    "5": 5,
    "15": 15,
    "1H": 60,
    "4H": 240,
  }[canonicalTimeframe(timeframe)] || 5;
}

export function resampleRows(rows, targetTimeframe) {
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

export function safeDocId(...parts) {
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

export function replaySetupOnCandles(setup, rows, meta = {}, clock = new SystemClock()) {
  return replaySetupOutcome({ setup, candles: rows, cutoff: meta.replay_window?.to, meta, clock });
}

export function replayWindowForSetup(setup, args = {}, pack = null, clock = new SystemClock()) {
  const date = setup.date || pack?.date || clock.now().utc.slice(0, 10);
  const offset = parisOffsetForDate(date);
  const cutoffParis = pack?.data_cutoff?.cutoff_paris || pack?.data_cutoff?.to_paris || pack?.data_cutoff?.timestamp_paris;
  return {
    from: args.replay_from || setup.replay_from || cutoffParis || `${date}T00:15:00${offset}`,
    to: args.replay_to || setup.replay_to || `${date}T22:30:00${offset}`,
  };
}

export function publicReplayError(error) {
  return String(error?.message || error || "replay_failed").slice(0, 500);
}

export const MARKET_FEATURE_ALGORITHMS = Object.freeze({
  assertRawWindowQuery,
  assertReplayRunMatchesQuery,
  buildConditionStatusDoc,
  buildCrossAssetDeltaDocs,
  buildDeterministicFeatureSet,
  buildScopedPackRawWindow,
  canonicalTimeframe,
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
  selectLevelMap,
  selectSessionSnapshot,
  selectTechnicalEvents,
  summarizeCrossAssetDelta,
  summarizeFeatureOutput,
});
