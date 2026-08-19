import { createHash } from "node:crypto";
import {
  canonicalJson,
  canonicalSha256,
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
} from "@tv-automation/desk-domain";
import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { createResearchExperimentRegistryService } from "../research-experiment-registry-service.js";
import { enqueueResearchAgentTask } from "./research-agent-task-queue.js";

export const DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION = "data_driven_mega_research_batch_v1";

const DEFAULT_SCOPE = Object.freeze({
  batch_id: "mega-1000-mnq-m5",
  symbol_code: "MNQ1!",
  instrument: "MNQ",
  timeframe: "5",
  start_utc: "2026-06-01T00:00:00.000Z",
  end_utc: "2026-08-17T00:00:00.000Z",
  dataset_key: "data-driven-mega.mnq.m5.2026-06-01_2026-08-17",
  count: 1_000,
});

export const DATA_DRIVEN_STRATEGY_FAMILIES = Object.freeze([
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

export async function bootstrapDataDrivenMegaResearchBatch({ store, input = {}, actor = {} } = {}) {
  assertStore(store);
  const scope = normalizeScope(input);
  const operationTime = operationTimestamp(store);
  const rows = await loadMarketRows(store.persistence.pool, scope);
  assertResearchCoverage(rows, scope);
  const dataset = buildDataset(scope, rows);
  await upsertDataset(store.persistence.pool, dataset);

  const tradingDays = buildTradingDays(rows);
  const experimentIds = stableExperimentIds(scope);
  const registry = store.researchRegistry || createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
  const command = commandContext(actor, input, experimentIds);
  await registry.registerExperiment(buildExperiment({ scope, dataset, ids: experimentIds, timestamp: operationTime }), command);
  const hypotheses = await registerFamilyHypotheses({ registry, scope, dataset, ids: experimentIds, timestamp: operationTime, command });
  const variants = buildDataDrivenMegaResearchPlan({ scope, dataset, tradingDays, count: scope.count });

  const counters = {
    requested: scope.count,
    generated: variants.length,
    definitions_created: 0,
    versions_created: 0,
    compiled: 0,
    simulations_recorded: 0,
    candidates_recorded: 0,
    validation_reports_recorded: 0,
    agent_tasks_created: 0,
    agent_tasks_existing: 0,
    failed: 0,
  };
  const byFamily = new Map();
  const best = [];
  const failures = [];

  for (const variant of variants) {
    try {
      const familyIds = hypotheses.get(variant.family_id);
      const ids = stableVariantIds(scope, variant);
      const seed = buildVariantSeed({ scope, dataset, tradingDays, variant, ids, familyIds, timestamp: operationTime });
      const definition = await registerDefinition(store, seed, command);
      if (definition.status === "CREATED") counters.definitions_created += 1;
      const version = await registerVersion(store, seed, command);
      if (version.status === "CREATED") counters.versions_created += 1;
      const compilation = await compileVersion(store, seed, command);
      counters.compiled += 1;
      const simulation = runSimulation(seed, dataset, rows, compilation);
      const registered = await registerSimulation(store, seed, dataset, simulation, compilation, command);
      counters.simulations_recorded += 1;
      const research = await registerCandidateAndEvaluation({ registry, seed, registered, simulation, command });
      counters.candidates_recorded += 1;
      counters.validation_reports_recorded += 1;
      const task = await enqueueReviewTask(store.persistence.pool, { seed, dataset, registered, research, operationTime });
      if (task.status === "CREATED") counters.agent_tasks_created += 1;
      if (task.status === "EXISTING") counters.agent_tasks_existing += 1;
      recordFamily(byFamily, variant, simulation.metrics || {});
      pushBest(best, seed, simulation.metrics || {}, registered.run);
    } catch (error) {
      counters.failed += 1;
      if (failures.length < 25) {
        failures.push({
          family_id: variant.family_id,
          variant_index: variant.variant_index,
          code: error?.code || "ERROR",
          message: error?.message || String(error),
          details: error?.details || null,
        });
      }
    }
  }

  store.researchRegistry = registry;
  return {
    status: counters.failed === 0 ? "READY" : "PARTIAL",
    schema_version: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
    generated_at_utc: new Date().toISOString(),
    scope,
    dataset: datasetSummary(dataset, rows),
    diversity: {
      family_count: DATA_DRIVEN_STRATEGY_FAMILIES.length,
      families: [...byFamily.values()].sort((left, right) => left.family_id.localeCompare(right.family_id)),
    },
    counters,
    top_initial_results: best.sort((left, right) => right.total_r - left.total_r).slice(0, 20),
    failures,
    safety: {
      broker_execution_enabled: false,
      broker_commands_created: 0,
      lane: "research",
      execution_mode: "SHADOW",
    },
  };
}

export function buildDataDrivenMegaResearchPlan({ scope = {}, dataset = {}, tradingDays = [], count = 1_000 } = {}) {
  const perFamily = Math.ceil(count / DATA_DRIVEN_STRATEGY_FAMILIES.length);
  const variants = [];
  for (const [familyIndex, familySpec] of DATA_DRIVEN_STRATEGY_FAMILIES.entries()) {
    for (let familyVariantIndex = 0; familyVariantIndex < perFamily && variants.length < count; familyVariantIndex += 1) {
      const parameters = parameterCombination(familyIndex, familyVariantIndex);
      const dailySetups = buildDailySetups({ familySpec, parameters, tradingDays, scope, familyVariantIndex });
      if (dailySetups.length === 0) continue;
      variants.push({
        family_id: familySpec.family_id,
        family_label: familySpec.label,
        family_index: familyIndex + 1,
        variant_index: familyVariantIndex + 1,
        global_index: variants.length + 1,
        direction: familySpec.direction,
        anchor_kind: familySpec.anchor_kind,
        parameters,
        runtime_setups: dailySetups,
        candidate_key: variantCandidateKey(scope, familySpec, familyVariantIndex + 1),
        strategy_external_key: `data-driven.${text(scope.instrument, "MNQ").toLowerCase()}.${familySpec.family_id}`,
        version_label: versionLabel({ familyIndex, familyVariantIndex, scope, familySpec, parameters, dataset }),
        primary_change_summary: `${familySpec.label}: ${dailySetups.length} setups journaliers, ancre ${familySpec.anchor_kind}, tolérance ${parameters.tolerance_points} pts, risk ${parameters.risk_points} pts, RR ${parameters.target_rr}.`,
      });
    }
  }
  return variants.slice(0, count);
}

function family(family_id, label, direction, anchor_kind) {
  return Object.freeze({ family_id, label, direction, anchor_kind });
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

function buildDailySetups({ familySpec, parameters, tradingDays, scope, familyVariantIndex }) {
  return selectTradingDaysForVariant(tradingDays, familyVariantIndex, 5).flatMap(({ day, dayIndex }) => {
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
      template_id: templateId(familySpec),
      instrument: text(scope.instrument, "MNQ"),
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
        source: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
        family_id: familySpec.family_id,
        anchor_kind: familySpec.anchor_kind,
        anchor_source: anchor.source,
      },
    }];
  });
}

function selectTradingDaysForVariant(tradingDays, familyVariantIndex, maxSetups) {
  const days = Array.isArray(tradingDays) ? tradingDays : [];
  if (days.length <= maxSetups) return days.map((day, dayIndex) => ({ day, dayIndex }));
  const selected = [];
  const used = new Set();
  const stride = Math.max(1, Math.floor(days.length / maxSetups));
  const offset = Math.abs(Number(familyVariantIndex) || 0) % days.length;
  for (let slot = 0; slot < maxSetups; slot += 1) {
    let dayIndex = (offset + slot * stride) % days.length;
    while (used.has(dayIndex)) dayIndex = (dayIndex + 1) % days.length;
    used.add(dayIndex);
    selected.push({ day: days[dayIndex], dayIndex });
  }
  return selected.sort((left, right) => left.dayIndex - right.dayIndex);
}

function anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex }) {
  const previous = day.previous || tradingDays[Math.max(0, dayIndex - 1)] || null;
  const week = rollingWindow(tradingDays, dayIndex, 5);
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

function deviationMultiplier(parameters) {
  return 0.18 + (parameters.tolerance_points % 5) * 0.04;
}

function priceAnchor(level, source) {
  if (level === null || level === undefined || level === "") return null;
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) return null;
  return { level: parsed, source };
}

function rollingWindow(items, index, size) {
  return items.slice(Math.max(0, index - size), index + 1);
}

function entryZone({ direction, retest, tolerance, orderType }) {
  const half = orderType === "MARKET" ? Math.max(0.25, tolerance / 4) : Math.max(0.25, tolerance);
  if (direction === "long") {
    return { lower: roundPrice(retest - half), upper: roundPrice(retest + Math.max(0.25, half / 2)) };
  }
  return { lower: roundPrice(retest - Math.max(0.25, half / 2)), upper: roundPrice(retest + half) };
}

function templateId(familySpec) {
  return `${familySpec.family_id}_${familySpec.direction}`;
}

function setupId({ familySpec, familyVariantIndex, dayIndex, day }) {
  return [
    "mega",
    familySpec.family_id,
    `v${String(familyVariantIndex + 1).padStart(3, "0")}`,
    day.trading_date.replaceAll("-", ""),
    `d${String(dayIndex + 1).padStart(3, "0")}`,
  ].join("_");
}

function normalizeScope(input = {}) {
  const start = iso(input.start_utc || input.startUtc, DEFAULT_SCOPE.start_utc);
  const end = iso(input.end_utc || input.endUtc, DEFAULT_SCOPE.end_utc);
  const instrument = text(input.instrument, DEFAULT_SCOPE.instrument).toUpperCase();
  const timeframe = text(input.timeframe, DEFAULT_SCOPE.timeframe);
  const batch = safeKey(text(input.batch_id || input.batchId, DEFAULT_SCOPE.batch_id));
  return {
    batch_id: batch,
    symbol_code: text(input.symbol_code || input.symbolCode, DEFAULT_SCOPE.symbol_code),
    instrument,
    timeframe,
    start_utc: start,
    end_utc: end,
    dataset_key: safeKey(text(input.dataset_key || input.datasetKey, `${batch}.${instrument.toLowerCase()}.m${timeframe}.${start.slice(0, 10)}_${end.slice(0, 10)}`)),
    count: boundedInteger(input.count, DEFAULT_SCOPE.count, 1, 10_000),
  };
}

async function loadMarketRows(pool, scope) {
  const result = await pool.query(
    `SELECT timestamp_utc, timestamp_paris, trading_date, open, high, low, close, volume, is_closed
       FROM market_candles
      WHERE symbol_code = $1
        AND timeframe = $2
        AND timestamp_utc >= $3::timestamptz
        AND timestamp_utc < $4::timestamptz
        AND is_closed = true
      ORDER BY timestamp_utc ASC`,
    [scope.symbol_code, scope.timeframe, scope.start_utc, scope.end_utc],
  );
  return result.rows.map((row) => marketRow(row, scope));
}

function assertResearchCoverage(rows, scope) {
  const rangeDays = (Date.parse(scope.end_utc) - Date.parse(scope.start_utc)) / 86_400_000;
  const tradingDays = new Set(rows.map((row) => row.trading_date).filter(Boolean)).size;
  if (rangeDays < 30 || tradingDays < 15 || rows.length < 1_000) {
    throw coded("DATA_DRIVEN_RESEARCH_COVERAGE_INSUFFICIENT", "Cumulative market dataset is not sufficient for mega research batch.", {
      range_days: rangeDays,
      trading_days: tradingDays,
      rows: rows.length,
      scope,
    });
  }
}

function buildDataset(scope, rows) {
  const contentHash = hashValue({ scope, row_count: rows.length, first: rows[0], last: rows.at(-1) });
  const buildHash = hashValue({ bootstrap: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION, scope });
  return {
    dataset_id: uuidFromValue({ kind: "dataset", key: scope.dataset_key }),
    dataset_key: scope.dataset_key,
    name: `Data-driven mega research ${scope.instrument} M${scope.timeframe}`,
    status: "READY",
    time_range_start_utc: scope.start_utc,
    time_range_end_utc: scope.end_utc,
    cutoff_utc: scope.end_utc,
    cutoff_paris: toParisIso(Date.parse(scope.end_utc)),
    schema_version: "market_candle_dataset_v1",
    source_batch_count: 1,
    content_hash: contentHash,
    provenance_hash: hashValue({ source: "market_candles", content_hash: contentHash }),
    build_parameters_hash: buildHash,
    metadata: { instrument: scope.instrument, symbol_code: scope.symbol_code, timeframe: `M${scope.timeframe}`, rows: rows.length, generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION },
  };
}

async function upsertDataset(pool, dataset) {
  await pool.query(
    `INSERT INTO datasets (
       dataset_id, dataset_key, name, status, time_range_start_utc, time_range_end_utc,
       cutoff_utc, cutoff_paris, schema_version, source_batch_count, content_hash,
       provenance_hash, build_parameters_hash, metadata, created_at_utc, updated_at_utc
     ) VALUES ($1,$2,$3,$4::dataset_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$15)
     ON CONFLICT (dataset_id) DO UPDATE SET
       dataset_key = EXCLUDED.dataset_key, name = EXCLUDED.name, status = EXCLUDED.status,
       time_range_start_utc = EXCLUDED.time_range_start_utc, time_range_end_utc = EXCLUDED.time_range_end_utc,
       cutoff_utc = EXCLUDED.cutoff_utc, cutoff_paris = EXCLUDED.cutoff_paris,
       schema_version = EXCLUDED.schema_version, source_batch_count = EXCLUDED.source_batch_count,
       content_hash = EXCLUDED.content_hash, provenance_hash = EXCLUDED.provenance_hash,
       build_parameters_hash = EXCLUDED.build_parameters_hash, metadata = EXCLUDED.metadata,
       updated_at_utc = EXCLUDED.updated_at_utc`,
    [
      dataset.dataset_id, dataset.dataset_key, dataset.name, dataset.status, dataset.time_range_start_utc,
      dataset.time_range_end_utc, dataset.cutoff_utc, dataset.cutoff_paris, dataset.schema_version,
      dataset.source_batch_count, dataset.content_hash, dataset.provenance_hash,
      dataset.build_parameters_hash, JSON.stringify(dataset.metadata), dataset.cutoff_utc,
    ],
  );
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

function rangeSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { high: null, low: null, open: null, close: null };
  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    open: rows[0]?.open ?? null,
    close: rows.at(-1)?.close ?? null,
  };
}

function sessionRows(rows, fromHm, toHm) {
  return rows.filter((row) => {
    const hm = String(row.time || "").slice(11, 16);
    return hm >= fromHm && hm <= toHm;
  });
}

function buildExperiment({ scope, dataset, ids, timestamp }) {
  return {
    research_experiment_id: ids.experimentId,
    experiment_key: safeKey(`mega:${scope.batch_id}:${scope.dataset_key}`),
    name: `Mega Research ${scope.instrument} M${scope.timeframe} — 1000 familles data-driven`,
    objective: "Tester massivement des familles/variantes déterministes data-driven sans exécution broker.",
    owner: "desk-research",
    status: "ACTIVE",
    comparison_metric: "total_r",
    candidate_selection_cutoff_utc: dataset.cutoff_utc,
    budget: { max_candidates: scope.count, max_compute_jobs: scope.count, broker_execution_enabled: false },
    metadata: { dataset_key: dataset.dataset_key, batch_id: scope.batch_id, generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION },
    created_at_utc: timestamp,
    updated_at_utc: timestamp,
  };
}

async function registerFamilyHypotheses({ registry, scope, ids, timestamp, command }) {
  const results = new Map();
  for (const familySpec of DATA_DRIVEN_STRATEGY_FAMILIES) {
    const hypothesisId = uuidFromValue({ kind: "research_hypothesis", experiment: ids.experimentId, family: familySpec.family_id });
    await registry.registerHypothesis({
      research_hypothesis_id: hypothesisId,
      research_experiment_id: ids.experimentId,
      statement: `${familySpec.label} peut produire une edge exploitable sur ${scope.instrument} M${scope.timeframe}.`,
      falsifiable_question: `La famille ${familySpec.family_id} obtient-elle un total R positif avec drawdown maîtrisé sur le dataset réel ?`,
      instrument_scope: [scope.instrument],
      timeframe_scope: [`M${scope.timeframe}`],
      population_scope: "mega_data_driven_cumulative_research",
      variable_set: { family_id: familySpec.family_id, anchor_kind: familySpec.anchor_kind, direction: familySpec.direction },
      expected_outcome: "Au moins 2 trades fermés, total R positif, drawdown supérieur au floor research.",
      invalidation_criteria: "Total R non positif, drawdown sous le floor ou échantillon insuffisant.",
      status: "TESTING",
      confidence_score: 0.5,
      metadata: { generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION, family: familySpec },
      created_at_utc: timestamp,
      updated_at_utc: timestamp,
    }, command);
    results.set(familySpec.family_id, { experimentId: ids.experimentId, hypothesisId });
  }
  return results;
}

function buildVariantSeed({ scope, dataset, tradingDays, variant, ids, familyIds, timestamp }) {
  const dsl = variantStrategyDsl({ scope, variant });
  const runtimeBindings = variantRuntimeBindings({ scope, dataset, variant });
  return {
    scope,
    dataset,
    tradingDays,
    variant,
    ids,
    familyIds,
    timestamp,
    dsl,
    dslText: canonicalJson(dsl),
    runtimeBindings,
    parameters: simulationParameters(),
  };
}

function variantStrategyDsl({ scope, variant }) {
  const base = {
    instrument: scope.instrument,
    timeframe: `M${scope.timeframe}`,
    rr_minimum: Math.min(2, variant.parameters.target_rr),
    risk_pct: 0.25,
    order_type: variant.parameters.order_type,
    tolerance_points: variant.parameters.tolerance_points,
    max_bars: variant.parameters.max_bars,
    require_rejection_confirmation: variant.parameters.require_rejection_confirmation,
  };
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [
      { ...base, template_id: templateId(variant), direction: variant.direction, rank: 1 },
    ],
    metadata: {
      generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      family_id: variant.family_id,
      family_label: variant.family_label,
      anchor_kind: variant.anchor_kind,
      note: "Compiler currently supports BREAKOUT_RETEST primitives; research family diversity is expressed through data-derived anchors and runtime bindings.",
    },
  };
}

function variantRuntimeBindings({ scope, dataset, variant }) {
  return {
    valid_from_paris: toParisIso(Date.parse(scope.start_utc)),
    expires_at_paris: dataset.cutoff_paris,
    cutoff_paris: dataset.cutoff_paris,
    pack_id: dataset.dataset_key,
    pack_build_id: dataset.dataset_id,
    plan_id: `plan__${variant.candidate_key}`,
    session: "mega_data_driven_research",
    trading_date: scope.start_utc.slice(0, 10),
    setup_id_prefix: `mega_${variant.family_id}_${variant.variant_index}`,
    setups: variant.runtime_setups,
  };
}

async function registerDefinition(store, seed, command) {
  const existing = await store.strategyKernel.getDefinitionByExternalKey?.(seed.variant.strategy_external_key);
  if (existing) return { status: "EXISTING_BY_EXTERNAL_KEY", definition: existing, audit: null };
  return store.strategyKernel.registerDefinition({
    strategy_definition_id: seed.ids.definitionId,
    external_key: seed.variant.strategy_external_key,
    name: `Data-driven ${seed.scope.instrument} — ${seed.variant.family_label}`,
    description: `Famille data-driven ${seed.variant.family_label}, générée par ${DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION}.`,
    owner: "desk-research",
    asset_class: "FUTURES",
    default_instruments: [seed.scope.instrument],
    tags: ["mega-research", "data-driven", seed.variant.family_id],
    metadata: {
      batch_id: seed.scope.batch_id,
      dataset_key: seed.dataset.dataset_key,
      generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      family_id: seed.variant.family_id,
      anchor_kind: seed.variant.anchor_kind,
    },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function registerVersion(store, seed, command) {
  const existing = (await store.strategyKernel.listVersions({ strategyDefinitionId: seed.ids.definitionId, limit: 2_000 }))
    .find((item) => item.version_label === seed.variant.version_label);
  if (existing) return { status: "EXISTING_BY_VERSION_LABEL", version: existing, audit: null };
  return store.strategyKernel.registerVersion({
    strategy_version_id: seed.ids.versionId,
    strategy_definition_id: seed.ids.definitionId,
    version_label: seed.variant.version_label,
    status: "VALIDATED",
    dsl_source_hash: sha256Text(seed.dslText),
    compiled_artifact_ref: `strategy://mega-research/${seed.ids.versionId}/compiled-artifact`,
    compiled_artifact_hash: null,
    validated_metrics_ref: seed.ids.simulationRunId,
    runtime_contract_bundle_version: "deterministic_execution_plan_v1_4",
    metadata: {
      dsl_source: seed.dsl,
      validation_scope: "mega_data_driven_research",
      research_candidate_id: seed.ids.candidateId,
      batch_id: seed.scope.batch_id,
      family_id: seed.variant.family_id,
      variant_index: seed.variant.variant_index,
    },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function compileVersion(store, seed, command) {
  const result = await store.strategyKernel.compileVersion({
    strategy_version_id: seed.ids.versionId,
    dsl_source: seed.dslText,
    runtime_bindings: seed.runtimeBindings,
    scope: compileScope(seed),
    source_mode: "PAPER",
  }, command);
  if (result.status !== "COMPILED") {
    throw coded("MEGA_RESEARCH_STRATEGY_COMPILE_REJECTED", "Mega research strategy cannot compile.", {
      reasons: result.compilation?.reasons,
      issues: result.compilation?.issues,
    });
  }
  return result;
}

function runSimulation(seed, dataset, rows, compilation) {
  return runCanonicalSimulationV1({
    run_id: `mega-research-${seed.scope.instrument.toLowerCase()}-m${seed.scope.timeframe}-${seed.scope.batch_id}-${seed.variant.global_index}`,
    strategy_version_id: seed.ids.versionId,
    compiled_artifact: compilation.compilation.compiled_artifact,
    dataset: simulationDataset(dataset, rows),
    rows,
    parameters: seed.parameters,
    reproducibility_seed: `${DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION}:${seed.variant.candidate_key}`,
    cutoff_utc: dataset.cutoff_utc,
    cutoff_paris: dataset.cutoff_paris,
    run_started_at_utc: dataset.time_range_start_utc,
  });
}

async function registerSimulation(store, seed, dataset, simulation, compilation, command) {
  return store.simulationRuns.recordSimulationResult({
    simulation_run_id: seed.ids.simulationRunId,
    strategy_version_id: seed.ids.versionId,
    dataset_id: dataset.dataset_id,
    compiled_artifact_hash: compilation.compilation.evidence.compiled_artifact_hash,
    result: simulation,
    metadata: {
      source: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      batch_id: seed.scope.batch_id,
      dataset_key: dataset.dataset_key,
      family_id: seed.variant.family_id,
      family_label: seed.variant.family_label,
      variant_index: seed.variant.variant_index,
      total_rows: simulation?.data_quality?.consumed_rows || 0,
      metrics: simulation.metrics || {},
    },
    created_at_utc: seed.timestamp,
  }, {
    ...command,
    idempotency_key: `idem_mega_sim_${seed.ids.simulationRunId}`,
    run_link_id: seed.ids.reportId,
  });
}

async function registerCandidateAndEvaluation({ registry, seed, registered, simulation, command }) {
  const candidate = await ensureCandidate(registry, seed, command);
  const report = await registry.recordEvaluationReport(buildEvaluation(seed, registered.run, simulation.metrics || {}), {
    ...command,
    idempotency_key: `idem_mega_eval_${seed.ids.reportId}`,
    run_link_id: seed.ids.reportId,
  });
  return {
    experiment_id: seed.familyIds.experimentId,
    hypothesis_id: seed.familyIds.hypothesisId,
    candidate_id: seed.ids.candidateId,
    report_id: seed.ids.reportId,
    candidate,
    report,
  };
}

async function ensureCandidate(registry, seed, command) {
  try {
    return await registry.getCandidate(seed.ids.candidateId);
  } catch (error) {
    if (error?.code !== "RESEARCH_CANDIDATE_NOT_FOUND") throw error;
  }
  return registry.registerCandidate({
    research_candidate_id: seed.ids.candidateId,
    research_experiment_id: seed.familyIds.experimentId,
    research_hypothesis_id: seed.familyIds.hypothesisId,
    candidate_key: seed.variant.candidate_key,
    source_type: "AI_GENERATED",
    status: "UNDER_REVIEW",
    strategy_definition_id: seed.ids.definitionId,
    strategy_version_id: seed.ids.versionId,
    primary_change_summary: seed.variant.primary_change_summary,
    deterministic_plan_ref: `strategy-version://${seed.ids.versionId}`,
    novelty_score: noveltyScore(seed.variant),
    promotion_blocked: true,
    promotion_block_reason: "Attente review agent après backtest data-driven mega batch.",
    metadata: {
      generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      batch_id: seed.scope.batch_id,
      dataset_key: seed.dataset.dataset_key,
      family_id: seed.variant.family_id,
      family_label: seed.variant.family_label,
      anchor_kind: seed.variant.anchor_kind,
      variant_index: seed.variant.variant_index,
      global_index: seed.variant.global_index,
      parameters: seed.variant.parameters,
    },
    created_at_utc: seed.timestamp,
    updated_at_utc: seed.timestamp,
  }, command);
}

function buildEvaluation(seed, run, metrics) {
  const verdict = evaluationVerdict(metrics);
  return {
    research_evaluation_report_id: seed.ids.reportId,
    research_experiment_id: seed.familyIds.experimentId,
    research_candidate_id: seed.ids.candidateId,
    simulation_run_id: run.simulation_run_id,
    report_kind: "VALIDATION",
    verdict,
    score: evaluationScore(metrics, verdict),
    metric_snapshot: metrics,
    criteria_snapshot: {
      schema_version: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      min_trade_count: 2,
      min_total_r: 0,
      max_drawdown_floor_r: -8,
      decision: verdict === "PASS" ? "READY_FOR_CONTRADICTORY_REVIEW" : "REJECT_OR_REVIEW",
      reasons: evaluationReasons(metrics),
      family_id: seed.variant.family_id,
      anchor_kind: seed.variant.anchor_kind,
    },
    artifact_refs: [run.result_ref, run.metrics_ref, `strategy-version://${seed.ids.versionId}`].filter(Boolean),
    reviewer_ref: "deterministic-mega-bootstrap",
    metadata: {
      source: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      batch_id: seed.scope.batch_id,
      dataset_id: seed.dataset.dataset_id,
      dataset_key: seed.dataset.dataset_key,
      strategy_version_id: seed.ids.versionId,
      family_id: seed.variant.family_id,
      variant_index: seed.variant.variant_index,
    },
    created_at_utc: seed.timestamp,
  };
}

async function enqueueReviewTask(pool, { seed, dataset, registered, research, operationTime }) {
  return enqueueResearchAgentTask(pool, {
    mission: {
      agent_mission_id: seed.ids.missionId,
      mission_key: safeKey(`mega-review:${seed.scope.batch_id}:${seed.variant.family_id}:${seed.variant.variant_index}`),
      mission_type: "RESEARCH_STRATEGY_VALIDATION",
      lane: "research",
      objective: "Relire un candidat data-driven du mega batch et décider contradiction, robustesse ou rejet.",
      context_ref: `research://${seed.familyIds.experimentId}`,
      correlation_id: `corr_mega_${seed.ids.simulationRunId}`,
      priority: 45,
      model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-review" },
      metadata: {
        source: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
        simulation_run_id: registered.run.simulation_run_id,
        strategy_version_id: seed.ids.versionId,
        family_id: seed.variant.family_id,
      },
      created_at_utc: operationTime,
    },
    task: {
      agent_task_id: seed.ids.taskId,
      agent_mission_id: seed.ids.missionId,
      task_key: safeKey(`mega-review:${seed.scope.batch_id}:${seed.variant.family_id}:${seed.variant.variant_index}`),
      task_type: "RESEARCH_BACKTEST_REVIEW",
      lane: "research",
      input_ref: `simulation-run://${registered.run.simulation_run_id}`,
      priority: 45,
      payload: {
        dataset_id: dataset.dataset_id,
        dataset_key: dataset.dataset_key,
        generator_version: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
        generator_slug: "mega-data-driven-v1",
        strategy_version_id: seed.ids.versionId,
        simulation_run_id: registered.run.simulation_run_id,
        research_candidate_id: research.candidate_id,
        required_decision: "REVIEW_OR_PROMOTE_NO_AUTO_ITERATION",
        iteration_index: 1,
        max_iterations: 1,
        max_variants: 1,
        metrics: registered.run.metadata?.metrics || {},
        family: {
          family_id: seed.variant.family_id,
          family_label: seed.variant.family_label,
          anchor_kind: seed.variant.anchor_kind,
          parameters: seed.variant.parameters,
        },
      },
      idempotency_key: `idem_mega_review_${seed.ids.taskId}`,
      max_attempts: 3,
      not_before_utc: operationTime,
      correlation_id: `corr_mega_${seed.ids.simulationRunId}`,
      metadata: { source: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION },
      created_at_utc: operationTime,
    },
  });
}

function stableExperimentIds(scope) {
  return {
    experimentId: uuidFromValue({ kind: "research_experiment", batch_id: scope.batch_id, dataset_key: scope.dataset_key }),
  };
}

function stableVariantIds(scope, variant) {
  const key = `${scope.batch_id}:${scope.dataset_key}:${variant.family_id}:${variant.variant_index}`;
  return {
    definitionId: uuidFromValue({ kind: "strategy_definition", family: variant.strategy_external_key }),
    versionId: uuidFromValue({ kind: "strategy_version", key }),
    instanceId: uuidFromValue({ kind: "strategy_instance", key, mode: "shadow" }),
    simulationRunId: uuidFromValue({ kind: "simulation_run", key }),
    candidateId: uuidFromValue({ kind: "research_candidate", key }),
    reportId: uuidFromValue({ kind: "research_evaluation_report", key, report_kind: "VALIDATION" }),
    missionId: uuidFromValue({ kind: "agent_mission", key }),
    taskId: uuidFromValue({ kind: "agent_task", key }),
  };
}

function compileScope(seed) {
  return {
    trading_date: seed.scope.start_utc.slice(0, 10),
    session: "mega_data_driven_research",
    cutoff_utc: seed.dataset.cutoff_utc,
    cutoff_paris: seed.dataset.cutoff_paris,
    strategy_id: seed.variant.strategy_external_key,
    pack_id: seed.dataset.dataset_key,
    pack_build_id: seed.dataset.dataset_id,
  };
}

function simulationDataset(dataset, rows) {
  return {
    ...dataset,
    dataset_hash: dataset.content_hash,
    sealed: true,
    sealed_at_utc: dataset.cutoff_utc,
    time_range: {
      from_utc: dataset.time_range_start_utc,
      to_utc: dataset.time_range_end_utc,
      to_paris: dataset.cutoff_paris,
    },
    rows,
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
    validation_scope: "mega_data_driven_research",
  };
}

function datasetSummary(dataset, rows) {
  return {
    dataset_id: dataset.dataset_id,
    dataset_key: dataset.dataset_key,
    rows: rows.length,
    trading_days: new Set(rows.map((row) => row.trading_date)).size,
    start_utc: dataset.time_range_start_utc,
    end_utc: dataset.time_range_end_utc,
    content_hash: dataset.content_hash,
  };
}

function recordFamily(byFamily, variant, metrics) {
  const existing = byFamily.get(variant.family_id) || {
    family_id: variant.family_id,
    family_label: variant.family_label,
    count: 0,
    best_total_r: -Infinity,
    pass_count: 0,
  };
  existing.count += 1;
  existing.best_total_r = Math.max(existing.best_total_r, number(metrics.total_r));
  if (evaluationVerdict(metrics) === "PASS") existing.pass_count += 1;
  byFamily.set(variant.family_id, existing);
}

function pushBest(best, seed, metrics, run) {
  best.push({
    candidate_id: seed.ids.candidateId,
    strategy_version_id: seed.ids.versionId,
    simulation_run_id: run.simulation_run_id,
    family_id: seed.variant.family_id,
    variant_index: seed.variant.variant_index,
    total_r: number(metrics.total_r),
    trade_count: number(metrics.trade_count),
    win_rate: number(metrics.win_rate),
    max_drawdown_r: number(metrics.max_drawdown_r),
    verdict: evaluationVerdict(metrics),
  });
  best.sort((left, right) => right.total_r - left.total_r);
  if (best.length > 50) best.length = 50;
}

function evaluationVerdict(metrics) {
  if (number(metrics.trade_count) < 2) return "NEEDS_REVIEW";
  if (number(metrics.total_r) <= 0 || number(metrics.max_drawdown_r) < -8) return "FAIL";
  return "PASS";
}

function evaluationReasons(metrics) {
  const reasons = [];
  if (number(metrics.trade_count) < 2) reasons.push("INSUFFICIENT_TRADE_SAMPLE");
  if (number(metrics.total_r) <= 0) reasons.push("NON_POSITIVE_TOTAL_R");
  if (number(metrics.max_drawdown_r) < -8) reasons.push("DRAWDOWN_BELOW_RESEARCH_FLOOR");
  if (!reasons.length) reasons.push("BASELINE_BACKTEST_ACCEPTABLE");
  return reasons;
}

function evaluationScore(metrics, verdict) {
  const total = Math.max(-12, Math.min(20, number(metrics.total_r)));
  const tradeCount = Math.min(20, Math.max(0, number(metrics.trade_count)));
  const drawdown = Math.max(0, 1 - Math.abs(number(metrics.max_drawdown_r)) / 10);
  const raw = verdict === "PASS"
    ? 0.62 + Math.min(0.18, total / 80) + Math.min(0.08, tradeCount / 250) + drawdown * 0.12
    : 0.18 + Math.min(0.24, Math.max(0, total + 6) / 50) + Math.min(0.16, tradeCount / 100) + drawdown * 0.18;
  return Math.max(0.01, Math.min(0.99, Math.round(raw * 10_000) / 10_000));
}

function noveltyScore(variant) {
  return Math.min(0.97, 0.55 + variant.family_index * 0.01 + (variant.variant_index % 17) * 0.01);
}

function marketRow(row, scope) {
  return {
    instrument: scope.instrument,
    symbol: scope.symbol_code,
    timeframe: `M${scope.timeframe}`,
    trading_date: row.trading_date,
    time: typeof row.timestamp_paris === "string" ? row.timestamp_paris : toParisIso(Date.parse(row.timestamp_utc)),
    timestamp_utc: iso(row.timestamp_utc),
    timestamp_paris: typeof row.timestamp_paris === "string" ? row.timestamp_paris : null,
    open: number(row.open),
    high: number(row.high),
    low: number(row.low),
    close: number(row.close),
    volume: number(row.volume),
    is_closed: row.is_closed === true,
  };
}

function commandContext(actor, input, ids) {
  return {
    idempotency_key: text(input.idempotency_key || input.idempotencyKey, `idem_mega_research_${ids.experimentId}`),
    correlation_id: text(input.correlation_id || input.correlationId, `corr_mega_research_${ids.experimentId}`),
    actor: actor?.email || actor?.uid || actor?.kind || "mega_research_bootstrap",
    reason: text(input.reason, "Bootstrap data-driven mega research batch."),
  };
}

function operationTimestamp(store) {
  const now = store?.clock && typeof store.clock.now === "function" ? store.clock.now() : null;
  if (now?.utc) return new Date(now.utc).toISOString();
  return new Date().toISOString();
}

function pick(values, index) {
  return values[Math.abs(index) % values.length];
}

function boundedInteger(value, fallback, min = 0, max = 1_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function percentile(sortedValues, ratio) {
  const values = (sortedValues || []).filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!values.length) return null;
  const index = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * ratio)));
  return values[index];
}

function variantCandidateKey(scope, familySpec, variantIndex) {
  return safeKey(`mega:${scope.batch_id}:${familySpec.family_id}:v${String(variantIndex).padStart(3, "0")}`);
}

function versionLabel({ familyIndex, familyVariantIndex, scope, familySpec, parameters, dataset }) {
  return [
    `1.${familyIndex + 1}.${familyVariantIndex + 1}`,
    canonicalSha256({ scope, family_id: familySpec.family_id, parameters, dataset_key: dataset.dataset_key }).slice(0, 12),
  ].join("+");
}

function safeKey(value) {
  const normalized = String(value || "key")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  const bounded = normalized.slice(0, 180).replace(/[^a-z0-9]+$/, "");
  return bounded || "key";
}

function hashValue(value) { return `sha256:${canonicalSha256(value)}`; }
function sha256Text(value) { return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`; }
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function iso(value, fallback = null) { const parsed = Date.parse(value || fallback || ""); if (!Number.isFinite(parsed)) throw coded("MEGA_RESEARCH_INVALID_TIMESTAMP", "Invalid timestamp.", { value }); return new Date(parsed).toISOString(); }
function uuidFromValue(value) { return uuidFromHash(canonicalSha256(value)); }

function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

function assertStore(store) {
  if (!store?.persistence?.pool) throw coded("MEGA_RESEARCH_POSTGRES_REQUIRED", "PostgreSQL-backed store is required.");
  if (!store.strategyKernel) throw coded("MEGA_RESEARCH_STRATEGY_KERNEL_REQUIRED", "Strategy Kernel service is required.");
  if (!store.simulationRuns) throw coded("MEGA_RESEARCH_SIMULATION_REGISTRY_REQUIRED", "Simulation Run service is required.");
}

function coded(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details, retryable: false });
}
