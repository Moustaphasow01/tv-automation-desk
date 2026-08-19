#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  canonicalJson,
  canonicalSha256,
  compileStrategyVersionToDeterministicPlanV1,
} from "@tv-automation/desk-domain";
import { buildVersionedSimulationMetricsV1, runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { createDeskStoreFromEnv } from "../src/store.js";

const VERSION = "data_driven_robust_cohort_full_history_validation_v1";

const DEFAULTS = Object.freeze({
  cohortPath: "reports/research/mega-1000-mnq-m5-20260817b-robust-pass-cohort.json",
  symbolCode: "MNQ1!",
  instrument: "MNQ",
  timeframe: "5",
  startUtc: "2026-06-01T00:00:00.000Z",
  endUtc: "2026-08-18T00:00:00.000Z",
  minFullDayRows: 240,
  fullDaysOnly: true,
  jsonOut: "reports/research/mega-1000-mnq-m5-20260817b-robust-pass-cohort-full-history-validation.json",
  markdownOut: "reports/research/mega-1000-mnq-m5-20260817b-robust-pass-cohort-full-history-validation.md",
});

const FAMILIES = Object.freeze([
  family("opening_range_breakout_long", "Opening range breakout long", "long", "OPENING_RANGE_HIGH"),
  family("opening_range_breakout_short", "Opening range breakout short", "short", "OPENING_RANGE_LOW"),
  family("asia_range_breakout_long", "Asia range breakout long", "long", "ASIA_RANGE_HIGH"),
  family("asia_range_breakout_short", "Asia range breakout short", "short", "ASIA_RANGE_LOW"),
  family("ny_opening_drive_long", "NY opening drive long", "long", "NY_OPENING_HIGH"),
  family("ny_opening_drive_short", "NY opening drive short", "short", "NY_OPENING_LOW"),
  family("previous_day_high_reclaim", "Previous day high reclaim", "long", "PREVIOUS_DAY_HIGH"),
  family("previous_day_low_break", "Previous day low break", "short", "PREVIOUS_DAY_LOW"),
  family("previous_day_mid_reclaim_long", "Previous day midpoint reclaim long", "long", "PREVIOUS_DAY_MID"),
  family("previous_day_mid_reject_short", "Previous day midpoint reject short", "short", "PREVIOUS_DAY_MID"),
  family("prior_close_reclaim_long", "Prior close reclaim long", "long", "PREVIOUS_DAY_CLOSE"),
  family("prior_close_reject_short", "Prior close reject short", "short", "PREVIOUS_DAY_CLOSE"),
  family("vwap_proxy_reclaim_long", "VWAP proxy reclaim long", "long", "ROLLING_VWAP"),
  family("vwap_proxy_reject_short", "VWAP proxy reject short", "short", "ROLLING_VWAP"),
  family("vwap_deviation_fade_long", "VWAP lower deviation fade long", "long", "VWAP_LOWER_DEVIATION"),
  family("vwap_deviation_fade_short", "VWAP upper deviation fade short", "short", "VWAP_UPPER_DEVIATION"),
  family("compression_breakout_long", "Compression breakout long", "long", "COMPRESSION_HIGH"),
  family("compression_breakout_short", "Compression breakout short", "short", "COMPRESSION_LOW"),
  family("weekly_anchor_breakout_long", "Weekly anchor breakout long", "long", "ROLLING_WEEK_HIGH"),
  family("weekly_anchor_breakout_short", "Weekly anchor breakout short", "short", "ROLLING_WEEK_LOW"),
]);

const PARAMETER_GRID = Object.freeze({
  openingBars: [4, 6, 8, 12, 18],
  tolerancePoints: [2, 3, 4, 5, 6, 8, 10, 12],
  maxBars: [12, 18, 24, 36, 48, 72, 96, 144],
  riskPoints: [10, 14, 18, 22, 28, 34, 42, 55],
  targetRr: [1.2, 1.5, 1.8, 2.1, 2.4, 2.8, 3.2],
  offsets: [-6, -3, 0, 3, 6],
  orderTypes: ["LIMIT", "MARKET"],
  requireRejection: [false, true],
});

const args = parseArgs(process.argv.slice(2));
const input = normalizeInput(args);
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const result = await validateFullHistory({ pool: store.persistence.pool, input });
  await writeReport(result, input);
  console.log(JSON.stringify({
    status: result.status,
    candidates: result.summary.candidate_count,
    survivors_min_8_trades: result.summary.survivors_min_8_trades,
    survivors_min_15_trades: result.summary.survivors_min_15_trades,
    json_out: input.jsonOut,
    markdown_out: input.markdownOut,
  }, null, 2));
} finally {
  await store.persistence.close?.();
}

async function validateFullHistory({ pool, input }) {
  const cohort = JSON.parse(await readFile(input.cohortPath, "utf8"));
  const retained = array(cohort.retained_candidates);
  const rows = await loadMarketRows(pool, input);
  const rawDays = buildTradingDays(rows);
  const tradingDays = input.fullDaysOnly
    ? rawDays.filter((day) => day.rows.length >= input.minFullDayRows)
    : rawDays;
  if (tradingDays.length < 15) {
    throw coded("FULL_HISTORY_VALIDATION_COVERAGE_INSUFFICIENT", "Not enough trading days for full-history validation.", {
      raw_days: rawDays.length,
      selected_days: tradingDays.length,
      min_full_day_rows: input.minFullDayRows,
    });
  }
  const rowsBySelectedDay = new Set(tradingDays.map((day) => day.trading_date));
  const selectedRows = rows.filter((row) => rowsBySelectedDay.has(row.trading_date));
  const versionRows = await loadVersions(pool, retained.map((candidate) => candidate.strategy_version_id));
  const versionById = new Map(versionRows.map((row) => [row.strategy_version_id, row]));
  const results = [];
  for (const candidate of retained) {
    const versionRow = versionById.get(candidate.strategy_version_id);
    const familySpec = FAMILIES.find((item) => item.family_id === candidate.family_id);
    if (!versionRow || !familySpec) {
      results.push({
        candidate_key: candidate.candidate_key,
        strategy_version_id: candidate.strategy_version_id,
        family_id: candidate.family_id,
        variant_index: candidate.variant_index,
        status: "SKIPPED",
        reasons: [!versionRow ? "STRATEGY_VERSION_NOT_FOUND" : "FAMILY_NOT_FOUND"],
      });
      continue;
    }
    const variantIndexZeroBased = Number(candidate.variant_index) - 1;
    const familyIndex = FAMILIES.findIndex((item) => item.family_id === candidate.family_id);
    const parameters = parameterCombination(familyIndex, variantIndexZeroBased);
    const setups = buildDailySetups({
      familySpec,
      parameters,
      tradingDays,
      input,
      familyVariantIndex: variantIndexZeroBased,
    });
    const dsl = versionRow.dsl_source || strategyDsl({ input, familySpec, parameters });
    const definition = {
      strategy_definition_id: versionRow.strategy_definition_id,
      external_key: versionRow.external_key,
      name: versionRow.name,
      description: versionRow.description,
      owner: versionRow.owner,
      asset_class: versionRow.asset_class,
      default_instruments: versionRow.default_instruments,
      tags: versionRow.tags,
      metadata: versionRow.definition_metadata,
      created_at: versionRow.definition_created_at,
      updated_at: versionRow.definition_updated_at,
    };
    const dslText = canonicalJson(dsl);
    const version = {
      strategy_version_id: versionRow.strategy_version_id,
      strategy_definition_id: versionRow.strategy_definition_id,
      version_label: versionRow.version_label,
      status: versionRow.status,
      dsl_source: dslText,
      dsl_source_hash: `sha256:${canonicalSha256(dsl)}`,
      compiled_artifact_ref: versionRow.compiled_artifact_ref,
      compiled_artifact_hash: null,
      validated_metrics_ref: versionRow.validated_metrics_ref,
      runtime_contract_bundle_version: versionRow.runtime_contract_bundle_version,
      metadata: versionRow.version_metadata,
      created_at: versionRow.version_created_at,
      updated_at: versionRow.version_updated_at,
    };
    const chunks = chunkArray(setups, 5);
    const allPositions = [];
    const chunkStatuses = [];
    const chunkReasons = [];
    let compilationIssues = [];
    for (const [chunkIndex, chunkSetups] of chunks.entries()) {
      const runtimeBindings = runtimeBindingsFor({ input, candidate, tradingDays, setups: chunkSetups, chunkIndex });
      const compilation = compileStrategyVersionToDeterministicPlanV1({
        strategy_definition: definition,
        strategy_version: version,
        runtime_bindings: runtimeBindings,
        scope: compileScope(input),
        source_mode: "PAPER",
      });
      if (!compilation.ok) {
        chunkStatuses.push("COMPILE_FAILED");
        chunkReasons.push(...array(compilation.reasons));
        compilationIssues = compilationIssues.concat(array(compilation.issues));
        continue;
      }
      const simulation = runCanonicalSimulationV1({
        run_id: `full-history-${input.instrument.toLowerCase()}-m${input.timeframe}-${candidate.strategy_version_id}-${String(chunkIndex + 1).padStart(3, "0")}`,
        strategy_version_id: candidate.strategy_version_id,
        compiled_artifact: compilation.compiled_artifact,
        dataset: simulationDataset(input, selectedRows),
        rows: selectedRows,
        parameters: simulationParameters(),
        reproducibility_seed: `${VERSION}:${candidate.candidate_key}:${chunkIndex + 1}`,
        cutoff_utc: input.effectiveEndUtc,
        cutoff_paris: toParisIso(Date.parse(input.effectiveEndUtc)),
        run_started_at_utc: input.effectiveStartUtc,
      });
      chunkStatuses.push(simulation.status);
      chunkReasons.push(...array(simulation.reasons));
      allPositions.push(...array(simulation.positions));
    }
    if (chunkStatuses.some((status) => status === "COMPILE_FAILED")) {
      results.push({
        candidate_key: candidate.candidate_key,
        strategy_version_id: candidate.strategy_version_id,
        family_id: candidate.family_id,
        variant_index: candidate.variant_index,
        status: "COMPILE_FAILED",
        setup_count: setups.length,
        chunk_count: chunks.length,
        reasons: [...new Set(chunkReasons)],
        issues: compilationIssues.slice(0, 25),
      });
      continue;
    }
    const metrics = buildVersionedSimulationMetricsV1(allPositions, { rows: selectedRows });
    const status = chunkStatuses.every((item) => item === "COMPLETED") ? "COMPLETED" : "DEGRADED";
    results.push({
      candidate_key: candidate.candidate_key,
      strategy_version_id: candidate.strategy_version_id,
      family_id: candidate.family_id,
      variant_index: candidate.variant_index,
      status,
      original: {
        total_r: number(candidate.total_r),
        closed_trade_count: number(candidate.closed_trade_count),
        robustness_score: number(candidate.robustness_score),
        promotion_decision: candidate.promotion_decision,
      },
      full_history: {
        setup_count: setups.length,
        chunk_count: chunks.length,
        total_r: rounded(metrics.total_r),
        closed_trade_count: number(metrics.trade_count),
        win_rate: rounded(metrics.win_rate),
        profit_factor: metrics.profit_factor === null || metrics.profit_factor === undefined ? null : rounded(metrics.profit_factor),
        max_drawdown_r: rounded(metrics.max_drawdown_r),
        expectancy_r: rounded(number(metrics.trade_count) ? number(metrics.total_r) / number(metrics.trade_count) : 0),
      },
      promotion_readiness: readiness(metrics),
      simulation_quality: { chunk_statuses: distribution(chunkStatuses) },
      reasons: status === "COMPLETED" ? [] : [...new Set(chunkReasons)],
    });
  }
  const summary = summarize({ input, rawDays, tradingDays, selectedRows, results });
  return {
    schema_version: VERSION,
    generated_at_utc: new Date().toISOString(),
    status: "READY",
    input: publicInput(input),
    dataset: {
      symbol_code: input.symbolCode,
      instrument: input.instrument,
      timeframe: input.timeframe,
      requested_start_utc: input.startUtc,
      requested_end_utc: input.endUtc,
      effective_start_utc: input.effectiveStartUtc,
      effective_end_utc: input.effectiveEndUtc,
      raw_trading_days: rawDays.length,
      selected_trading_days: tradingDays.length,
      selected_rows: selectedRows.length,
      full_days_only: input.fullDaysOnly,
      min_full_day_rows: input.minFullDayRows,
      first_day: tradingDays[0]?.trading_date || null,
      last_day: tradingDays.at(-1)?.trading_date || null,
      excluded_days: rawDays.filter((day) => !tradingDays.some((selected) => selected.trading_date === day.trading_date)).map((day) => ({ trading_date: day.trading_date, rows: day.rows.length })),
    },
    summary,
    results: results.sort((left, right) => number(right.full_history?.total_r) - number(left.full_history?.total_r)),
    safety: {
      broker_execution_enabled: false,
      strategy_instances_created: 0,
      strategy_signals_emitted: 0,
      database_writes: 0,
      mode: "READ_ONLY_CERTIFICATION",
    },
  };
}

async function loadMarketRows(pool, input) {
  const result = await pool.query(
    `SELECT timestamp_utc, timestamp_paris, trading_date, open, high, low, close, volume, is_closed
       FROM market_candles
      WHERE symbol_code = $1
        AND timeframe = $2
        AND timestamp_utc >= $3::timestamptz
        AND timestamp_utc < $4::timestamptz
        AND is_closed = true
      ORDER BY timestamp_utc ASC`,
    [input.symbolCode, input.timeframe, input.startUtc, input.endUtc],
  );
  return result.rows.map((row) => marketRow(row, input));
}

async function loadVersions(pool, strategyVersionIds) {
  if (!strategyVersionIds.length) return [];
  const result = await pool.query(
    `SELECT v.strategy_version_id::text,
            v.strategy_definition_id::text,
            v.version_label,
            v.status::text,
            v.dsl_source_hash,
            v.compiled_artifact_ref,
            v.compiled_artifact_hash,
            v.validated_metrics_ref,
            v.runtime_contract_bundle_version,
            v.metadata AS version_metadata,
            v.metadata->'dsl_source' AS dsl_source,
            to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS version_created_at,
            to_char(v.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS version_updated_at,
            d.external_key,
            d.name,
            d.description,
            d.owner,
            d.asset_class,
            d.default_instruments,
            d.tags,
            d.metadata AS definition_metadata,
            to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS definition_created_at,
            to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS definition_updated_at
       FROM strategy_versions v
       JOIN strategy_definitions d ON d.strategy_definition_id = v.strategy_definition_id
      WHERE v.strategy_version_id = ANY($1::uuid[])`,
    [strategyVersionIds],
  );
  return result.rows;
}

function buildTradingDays(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.time.slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const days = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([trading_date, dayRows]) => summarizeDay(trading_date, dayRows));
  const ranges = days.map((day) => day.range).sort((a, b) => a - b);
  const p35 = percentile(ranges, 0.35) || 0;
  const highs = days.map((day) => day.high).sort((a, b) => a - b);
  const lows = days.map((day) => day.low).sort((a, b) => a - b);
  for (let index = 0; index < days.length; index += 1) {
    days[index].previous = days[index - 1] || null;
    days[index].dataset_stats = {
      range_p35: p35,
      range_p35_high: percentile(highs, 0.65) || days[index].high,
      range_p35_low: percentile(lows, 0.35) || days[index].low,
    };
  }
  return days;
}

function summarizeDay(trading_date, rows) {
  const sorted = [...rows].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const high = Math.max(...sorted.map((row) => row.high));
  const low = Math.min(...sorted.map((row) => row.low));
  const typicalVolume = sorted.reduce((sum, row) => sum + Math.max(1, row.volume || 1), 0);
  const vwap = sorted.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * Math.max(1, row.volume || 1), 0) / typicalVolume;
  const opening = (bars) => rangeSummary(sorted.slice(0, Math.max(1, bars)));
  return {
    trading_date,
    rows: sorted,
    first_time: sorted[0]?.time,
    last_time: sorted.at(-1)?.time,
    open: sorted[0]?.open,
    high,
    low,
    close: sorted.at(-1)?.close,
    range: high - low,
    vwap: roundPrice(vwap),
    opening,
    asia: rangeSummary(sessionRows(sorted, "09:15", "14:45")),
    nyOpening: rangeSummary(sessionRows(sorted, "15:30", "17:00")),
  };
}

function buildDailySetups({ familySpec, parameters, tradingDays, input, familyVariantIndex }) {
  return tradingDays.flatMap((day, dayIndex) => {
    const anchor = anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
    if (!anchor) return [];
    const level = roundPrice(anchor.level + parameters.break_offset_points);
    const retest = roundPrice(anchor.retest ?? level);
    const direction = familySpec.direction;
    const tolerance = parameters.tolerance_points;
    const entry = entryZone({ direction, retest, tolerance, orderType: parameters.order_type });
    const entryReference = direction === "long" ? entry.upper : entry.lower;
    const stop = direction === "long"
      ? roundPrice(entryReference - parameters.risk_points)
      : roundPrice(entryReference + parameters.risk_points);
    const risk = Math.max(0.25, Math.abs(entryReference - stop));
    const target = direction === "long"
      ? roundPrice(entryReference + risk * parameters.target_rr)
      : roundPrice(entryReference - risk * parameters.target_rr);
    const invalidation = direction === "long"
      ? roundPrice(Math.min(day.low, stop) - Math.max(4, tolerance))
      : roundPrice(Math.max(day.high, stop) + Math.max(4, tolerance));
    return [{
      setup_id: setupId({ familySpec, familyVariantIndex, dayIndex, day }),
      template_id: `${familySpec.family_id}_${familySpec.direction}`,
      instrument: input.instrument,
      direction,
      rank: dayIndex + 1,
      trading_date: day.trading_date,
      valid_from_paris: day.first_time,
      expires_at_paris: day.last_time,
      break_level: level,
      retest_level: retest,
      entry_zone: entry,
      stop_loss: stop,
      take_profit_1: target,
      invalidation_level: invalidation,
      tolerance_points: tolerance,
      max_bars: parameters.max_bars,
      order_type: parameters.order_type,
      require_rejection_confirmation: parameters.require_rejection_confirmation,
      rr_minimum: Math.min(2, parameters.target_rr),
      metadata: {
        source: VERSION,
        family_id: familySpec.family_id,
        anchor_kind: familySpec.anchor_kind,
        anchor_source: anchor.source,
      },
    }];
  });
}

function anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex }) {
  const previous = day.previous || tradingDays[Math.max(0, dayIndex - 1)] || null;
  const week = tradingDays.slice(Math.max(0, dayIndex - 5), dayIndex + 1);
  const compression = previous && previous.range <= day.dataset_stats.range_p35;
  switch (familySpec.anchor_kind) {
    case "OPENING_RANGE_HIGH": return priceAnchor(day.opening(parameters.opening_bars).high, "opening_range_high");
    case "OPENING_RANGE_LOW": return priceAnchor(day.opening(parameters.opening_bars).low, "opening_range_low");
    case "ASIA_RANGE_HIGH": return priceAnchor(day.asia.high ?? day.opening(parameters.opening_bars).high, "asia_range_high");
    case "ASIA_RANGE_LOW": return priceAnchor(day.asia.low ?? day.opening(parameters.opening_bars).low, "asia_range_low");
    case "NY_OPENING_HIGH": return priceAnchor(day.nyOpening.high ?? day.opening(parameters.opening_bars).high, "ny_opening_high");
    case "NY_OPENING_LOW": return priceAnchor(day.nyOpening.low ?? day.opening(parameters.opening_bars).low, "ny_opening_low");
    case "PREVIOUS_DAY_HIGH": return previous ? priceAnchor(previous.high, "previous_day_high") : null;
    case "PREVIOUS_DAY_LOW": return previous ? priceAnchor(previous.low, "previous_day_low") : null;
    case "PREVIOUS_DAY_MID": return previous ? priceAnchor((previous.high + previous.low) / 2, "previous_day_mid") : null;
    case "PREVIOUS_DAY_CLOSE": return previous ? priceAnchor(previous.close, "previous_day_close") : null;
    case "ROLLING_VWAP": return priceAnchor(day.vwap, "daily_vwap_proxy");
    case "VWAP_LOWER_DEVIATION": return priceAnchor(day.vwap - day.range * deviationMultiplier(parameters), "vwap_lower_deviation");
    case "VWAP_UPPER_DEVIATION": return priceAnchor(day.vwap + day.range * deviationMultiplier(parameters), "vwap_upper_deviation");
    case "COMPRESSION_HIGH": return compression ? priceAnchor(day.opening(parameters.opening_bars).high, "compression_high") : priceAnchor(day.dataset_stats.range_p35_high, "fallback_compression_high");
    case "COMPRESSION_LOW": return compression ? priceAnchor(day.opening(parameters.opening_bars).low, "compression_low") : priceAnchor(day.dataset_stats.range_p35_low, "fallback_compression_low");
    case "ROLLING_WEEK_HIGH": return week.length ? priceAnchor(Math.max(...week.map((item) => item.high)), "rolling_week_high") : null;
    case "ROLLING_WEEK_LOW": return week.length ? priceAnchor(Math.min(...week.map((item) => item.low)), "rolling_week_low") : null;
    default: return null;
  }
}

function strategyDsl({ input, familySpec, parameters }) {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    setup_templates: [{
      instrument: input.instrument,
      timeframe: `M${input.timeframe}`,
      rr_minimum: Math.min(2, parameters.target_rr),
      risk_pct: 0.25,
      order_type: parameters.order_type,
      tolerance_points: parameters.tolerance_points,
      max_bars: parameters.max_bars,
      require_rejection_confirmation: parameters.require_rejection_confirmation,
      template_id: `${familySpec.family_id}_${familySpec.direction}`,
      direction: familySpec.direction,
      rank: 1,
    }],
    metadata: {
      generator: VERSION,
      family_id: familySpec.family_id,
      family_label: familySpec.label,
      anchor_kind: familySpec.anchor_kind,
    },
  };
}

function runtimeBindingsFor({ input, candidate, tradingDays, setups }) {
  return {
    valid_from_paris: tradingDays[0]?.first_time || toParisIso(Date.parse(input.effectiveStartUtc)),
    expires_at_paris: tradingDays.at(-1)?.last_time || toParisIso(Date.parse(input.effectiveEndUtc)),
    cutoff_paris: toParisIso(Date.parse(input.effectiveEndUtc)),
    pack_id: `full-history.${input.symbolCode}.m${input.timeframe}.${input.effectiveStartUtc.slice(0, 10)}_${input.effectiveEndUtc.slice(0, 10)}`,
    pack_build_id: `sha256:${canonicalSha256({ version: VERSION, candidate_key: candidate.candidate_key, start: input.effectiveStartUtc, end: input.effectiveEndUtc, setups: setups.length })}`,
    plan_id: `full_history_plan__${candidate.strategy_version_id}`,
    session: "full_history_validation",
    trading_date: tradingDays[0]?.trading_date || input.effectiveStartUtc.slice(0, 10),
    setup_id_prefix: `full_${candidate.family_id}_${candidate.variant_index}`,
    setups,
  };
}

function compileScope(input) {
  return {
    trading_date: input.effectiveStartUtc.slice(0, 10),
    session: "full_history_validation",
    instrument: input.instrument,
    timezone: "Europe/Paris",
    cutoff_utc: input.effectiveEndUtc,
    cutoff_paris: toParisIso(Date.parse(input.effectiveEndUtc)),
    pack_id: `full-history.${input.symbolCode}.m${input.timeframe}`,
    pack_build_id: `full-history.${input.symbolCode}.m${input.timeframe}.${input.effectiveEndUtc}`,
  };
}

function simulationDataset(input, rows) {
  const withoutHash = {
    schema_version: "market_candle_dataset_v1",
    dataset_id: `full-history:${input.symbolCode}:m${input.timeframe}`,
    dataset_key: `full-history.${input.symbolCode}.m${input.timeframe}.${input.effectiveStartUtc.slice(0, 10)}_${input.effectiveEndUtc.slice(0, 10)}`,
    status: "READY",
    sealed: true,
    sealed_at_utc: input.effectiveEndUtc,
    instrument: input.instrument,
    symbol_code: input.symbolCode,
    timeframe: `M${input.timeframe}`,
    start_utc: input.effectiveStartUtc,
    end_utc: input.effectiveEndUtc,
    rows: rows.length,
    source: "market_candles",
  };
  const contentHash = `sha256:${canonicalSha256(withoutHash)}`;
  return {
    ...withoutHash,
    content_hash: contentHash,
    dataset_hash: contentHash,
    provenance_hash: `sha256:${canonicalSha256({ source: "market_candles", content_hash: contentHash })}`,
  };
}

function simulationParameters() {
  return {
    simulation_policy: { position_at_cutoff: "MARK_TO_MARKET_CLOSE" },
    order_simulation_policy: {
      ambiguous_intrabar_policy: "CONSERVATIVE_STOP",
      spread_points: 0.25,
      slippage_points: 0.25,
      commission_r_per_contract: 0.01,
    },
    validation_scope: "full_history_robust_cohort_revalidation",
  };
}

function readiness(metrics = {}) {
  const tradeCount = number(metrics.trade_count);
  const totalR = number(metrics.total_r);
  const drawdown = number(metrics.max_drawdown_r);
  const profitFactor = metrics.profit_factor === null || metrics.profit_factor === undefined ? null : number(metrics.profit_factor);
  const reasons = [];
  if (tradeCount < 8) reasons.push("TRADE_COUNT_BELOW_8");
  if (tradeCount < 15) reasons.push("TRADE_COUNT_BELOW_15");
  if (totalR <= 0) reasons.push("NON_POSITIVE_TOTAL_R");
  if (drawdown < -8) reasons.push("DRAWDOWN_BELOW_FLOOR");
  if (profitFactor !== null && profitFactor < 1.2) reasons.push("PROFIT_FACTOR_BELOW_1_2");
  return {
    min_8_trade_gate: tradeCount >= 8 && totalR > 0 && drawdown >= -8,
    min_15_trade_gate: tradeCount >= 15 && totalR > 0 && drawdown >= -8,
    reasons,
  };
}

function summarize({ rawDays, tradingDays, selectedRows, results }) {
  const completed = results.filter((item) => item.status === "COMPLETED");
  const totalTrades = completed.reduce((sum, item) => sum + number(item.full_history?.closed_trade_count), 0);
  const totalR = completed.reduce((sum, item) => sum + number(item.full_history?.total_r), 0);
  return {
    candidate_count: results.length,
    completed_count: completed.length,
    failed_count: results.length - completed.length,
    raw_trading_days: rawDays.length,
    selected_trading_days: tradingDays.length,
    selected_rows: selectedRows.length,
    aggregate_closed_trade_count: totalTrades,
    average_closed_trade_count: completed.length ? rounded(totalTrades / completed.length) : 0,
    aggregate_total_r: rounded(totalR),
    survivors_min_8_trades: completed.filter((item) => item.promotion_readiness?.min_8_trade_gate).length,
    survivors_min_15_trades: completed.filter((item) => item.promotion_readiness?.min_15_trade_gate).length,
    trade_count_distribution: distribution(completed.map((item) => number(item.full_history?.closed_trade_count))),
  };
}

async function writeReport(result, input) {
  await mkdir(path.dirname(input.jsonOut), { recursive: true });
  await writeFile(input.jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  await mkdir(path.dirname(input.markdownOut), { recursive: true });
  await writeFile(input.markdownOut, renderMarkdown(result));
}

function renderMarkdown(result) {
  const lines = [
    "# Full-history validation — robust cohort",
    "",
    `Generated: ${result.generated_at_utc}`,
    "",
    "## Summary",
    "",
    `- Candidates: ${result.summary.candidate_count}`,
    `- Completed: ${result.summary.completed_count}`,
    `- Trading days selected: ${result.summary.selected_trading_days}/${result.summary.raw_trading_days}`,
    `- Rows selected: ${result.summary.selected_rows}`,
    `- Aggregate trades: ${result.summary.aggregate_closed_trade_count}`,
    `- Average trades/candidate: ${result.summary.average_closed_trade_count}`,
    `- Aggregate R: ${result.summary.aggregate_total_r}`,
    `- Survivors min 8 trades: ${result.summary.survivors_min_8_trades}`,
    `- Survivors min 15 trades: ${result.summary.survivors_min_15_trades}`,
    "",
    "## Safety",
    "",
    "- Read-only certification: yes",
    "- Strategy instances created: 0",
    "- Strategy signals emitted: 0",
    "- Broker commands: 0",
    "",
    "## Results",
    "",
    "| Rank | Candidate | Family | Variant | Orig trades | Full trades | Full R | DD R | PF | Gate 8 | Gate 15 |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|",
  ];
  result.results.forEach((item, index) => {
    lines.push([
      index + 1,
      item.candidate_key || "",
      item.family_id || "",
      item.variant_index || "",
      item.original?.closed_trade_count ?? "",
      item.full_history?.closed_trade_count ?? "",
      item.full_history?.total_r ?? "",
      item.full_history?.max_drawdown_r ?? "",
      item.full_history?.profit_factor ?? "",
      item.promotion_readiness?.min_8_trade_gate ? "PASS" : "FAIL",
      item.promotion_readiness?.min_15_trade_gate ? "PASS" : "FAIL",
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  });
  return `${lines.join("\n")}\n`;
}

function normalizeInput(args) {
  const input = {
    cohortPath: text(args.cohortPath || args.cohort_path, DEFAULTS.cohortPath),
    symbolCode: text(args.symbolCode || args.symbol_code, DEFAULTS.symbolCode),
    instrument: text(args.instrument, DEFAULTS.instrument).toUpperCase(),
    timeframe: text(args.timeframe, DEFAULTS.timeframe),
    startUtc: iso(args.startUtc || args.start_utc, DEFAULTS.startUtc),
    endUtc: iso(args.endUtc || args.end_utc, DEFAULTS.endUtc),
    minFullDayRows: boundedInteger(args.minFullDayRows || args.min_full_day_rows, DEFAULTS.minFullDayRows, 1, 2_000),
    fullDaysOnly: args.fullDaysOnly === false || args.full_days_only === false || args.fullDaysOnly === "false" || args.full_days_only === "false" ? false : DEFAULTS.fullDaysOnly,
    jsonOut: text(args.jsonOut || args.json_out, DEFAULTS.jsonOut),
    markdownOut: text(args.markdownOut || args.markdown_out, DEFAULTS.markdownOut),
  };
  input.effectiveStartUtc = input.startUtc;
  input.effectiveEndUtc = input.endUtc;
  return input;
}

function parameterCombination(familyIndex, index) {
  return {
    opening_bars: pick(PARAMETER_GRID.openingBars, index + familyIndex),
    tolerance_points: pick(PARAMETER_GRID.tolerancePoints, index * 3 + familyIndex),
    max_bars: pick(PARAMETER_GRID.maxBars, index * 5 + familyIndex),
    risk_points: pick(PARAMETER_GRID.riskPoints, index * 7 + familyIndex),
    target_rr: pick(PARAMETER_GRID.targetRr, index * 11 + familyIndex),
    break_offset_points: pick(PARAMETER_GRID.offsets, index * 13 + familyIndex),
    order_type: pick(PARAMETER_GRID.orderTypes, index + familyIndex),
    require_rejection_confirmation: pick(PARAMETER_GRID.requireRejection, index * 17 + familyIndex),
  };
}

function marketRow(row, input) {
  return {
    instrument: input.instrument,
    symbol: input.symbolCode,
    timeframe: `M${input.timeframe}`,
    time: typeof row.timestamp_paris === "string" ? row.timestamp_paris : toParisIso(Date.parse(row.timestamp_utc)),
    timestamp_utc: new Date(row.timestamp_utc).toISOString(),
    timestamp_paris: typeof row.timestamp_paris === "string" ? row.timestamp_paris : toParisIso(Date.parse(row.timestamp_utc)),
    trading_date: typeof row.trading_date === "string" ? row.trading_date.slice(0, 10) : new Date(row.trading_date).toISOString().slice(0, 10),
    open: number(row.open),
    high: number(row.high),
    low: number(row.low),
    close: number(row.close),
    volume: number(row.volume),
    is_closed: row.is_closed === true,
  };
}

function rangeSummary(rows) {
  if (!rows.length) return { high: null, low: null, close: null };
  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: rows.at(-1)?.close ?? null,
  };
}

function sessionRows(rows, fromHm, toHm) {
  return rows.filter((row) => {
    const hm = String(row.timestamp_paris || row.time).slice(11, 16);
    return hm >= fromHm && hm <= toHm;
  });
}

function entryZone({ direction, retest, tolerance, orderType }) {
  const half = orderType === "MARKET" ? Math.max(0.25, tolerance / 4) : Math.max(0.25, tolerance);
  if (direction === "long") {
    return { lower: roundPrice(retest - half), upper: roundPrice(retest + Math.max(0.25, half / 2)) };
  }
  return { lower: roundPrice(retest - Math.max(0.25, half / 2)), upper: roundPrice(retest + half) };
}

function setupId({ familySpec, familyVariantIndex, dayIndex, day }) {
  return [
    "full",
    familySpec.family_id,
    `v${String(familyVariantIndex + 1).padStart(3, "0")}`,
    day.trading_date.replaceAll("-", ""),
    `d${String(dayIndex + 1).padStart(3, "0")}`,
  ].join("_");
}

function deviationMultiplier(parameters) {
  return 0.18 + (parameters.tolerance_points % 5) * 0.04;
}

function priceAnchor(level, source) {
  if (level === null || level === undefined || level === "") return null;
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) return null;
  return { level: parsed, source };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)));
  return values[index];
}

function distribution(items) {
  const result = {};
  for (const item of items) result[item] = (result[item] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort((left, right) => Number(left[0]) - Number(right[0])));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function publicInput(input) {
  return {
    cohort_path: input.cohortPath,
    symbol_code: input.symbolCode,
    instrument: input.instrument,
    timeframe: input.timeframe,
    start_utc: input.startUtc,
    end_utc: input.endUtc,
    full_days_only: input.fullDaysOnly,
    min_full_day_rows: input.minFullDayRows,
  };
}

function parseArgs(args) {
  const input = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) input[key] = true;
    else {
      input[key] = next;
      index += 1;
    }
  }
  return input;
}

function family(family_id, label, direction, anchor_kind) {
  return Object.freeze({ family_id, label, direction, anchor_kind });
}

function pick(items, index) {
  return items[Math.abs(index) % items.length];
}

function rounded(value) {
  return Math.round(number(value) * 10_000) / 10_000;
}

function roundPrice(value) {
  return Math.round(number(value) * 4) / 4;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function iso(value, fallback = null) {
  const parsed = Date.parse(value || fallback || "");
  if (!Number.isFinite(parsed)) throw coded("FULL_HISTORY_VALIDATION_INVALID_TIMESTAMP", "Invalid timestamp.", { value });
  return new Date(parsed).toISOString();
}

function coded(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details, retryable: false });
}
