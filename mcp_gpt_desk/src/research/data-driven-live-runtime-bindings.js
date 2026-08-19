import { canonicalSha256 } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";

export const DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION = "data_driven_live_runtime_bindings_v1";

const FAMILY_SPECS = Object.freeze([
  family("opening_range_breakout_long", "long", "OPENING_RANGE_HIGH"),
  family("opening_range_breakout_short", "short", "OPENING_RANGE_LOW"),
  family("asia_range_breakout_long", "long", "ASIA_RANGE_HIGH"),
  family("asia_range_breakout_short", "short", "ASIA_RANGE_LOW"),
  family("ny_opening_drive_long", "long", "NY_OPENING_HIGH"),
  family("ny_opening_drive_short", "short", "NY_OPENING_LOW"),
  family("previous_day_high_reclaim", "long", "PREVIOUS_DAY_HIGH"),
  family("previous_day_low_break", "short", "PREVIOUS_DAY_LOW"),
  family("previous_day_mid_reclaim_long", "long", "PREVIOUS_DAY_MID"),
  family("previous_day_mid_reject_short", "short", "PREVIOUS_DAY_MID"),
  family("prior_close_reclaim_long", "long", "PREVIOUS_DAY_CLOSE"),
  family("prior_close_reject_short", "short", "PREVIOUS_DAY_CLOSE"),
  family("vwap_proxy_reclaim_long", "long", "ROLLING_VWAP"),
  family("vwap_proxy_reject_short", "short", "ROLLING_VWAP"),
  family("vwap_deviation_fade_long", "long", "VWAP_LOWER_DEVIATION"),
  family("vwap_deviation_fade_short", "short", "VWAP_UPPER_DEVIATION"),
  family("compression_breakout_long", "long", "COMPRESSION_HIGH"),
  family("compression_breakout_short", "short", "COMPRESSION_LOW"),
  family("weekly_anchor_breakout_long", "long", "ROLLING_WEEK_HIGH"),
  family("weekly_anchor_breakout_short", "short", "ROLLING_WEEK_LOW"),
]);

const PARAMETER_GRID = Object.freeze({
  openingBars: Object.freeze([4, 6, 8, 12, 18]),
  tolerancePoints: Object.freeze([2, 3, 4, 5, 6, 8, 10, 12]),
  maxBars: Object.freeze([12, 18, 24, 36, 48, 72, 96, 144]),
  riskPoints: Object.freeze([10, 14, 18, 22, 28, 34, 42, 55]),
  targetRr: Object.freeze([1.2, 1.5, 1.8, 2.1, 2.4, 2.8, 3.2]),
  offsets: Object.freeze([-6, -3, 0, 3, 6]),
  orderTypes: Object.freeze(["LIMIT", "MARKET"]),
  requireRejection: Object.freeze([false, true]),
});

export function buildDataDrivenLiveRuntimeBindings({
  version = {},
  dsl = {},
  instance = {},
  market = {},
  instrument = "MNQ",
} = {}) {
  const descriptor = dataDrivenDescriptor(version, dsl);
  if (!descriptor.ok) return descriptor;
  const contextRows = Array.isArray(market.contextRows) && market.contextRows.length
    ? market.contextRows
    : market.rows;
  const tradingDays = buildTradingDays(contextRows || []);
  const currentDate = market.rows?.[0]?.trading_date || market.tradingDate;
  const dayIndex = tradingDays.findIndex((day) => day.trading_date === currentDate);
  if (dayIndex < 0) return rejected(["DATA_DRIVEN_RUNTIME_DAY_NOT_FOUND"]);

  const familyIndex = FAMILY_SPECS.findIndex((item) => item.family_id === descriptor.family_id);
  const familySpec = FAMILY_SPECS[familyIndex];
  const parameters = mergeTemplateParameters(
    parameterCombination(familyIndex, descriptor.variant_index - 1),
    firstTemplate(dsl),
  );
  const setup = dataDrivenSetup({
    day: tradingDays[dayIndex],
    dayIndex,
    tradingDays,
    familySpec,
    parameters,
    familyVariantIndex: descriptor.variant_index - 1,
    instrument,
    instanceId: instance.strategy_instance_id,
  });
  if (!setup) return rejected(["DATA_DRIVEN_RUNTIME_ANCHOR_UNAVAILABLE"]);
  return {
    ok: true,
    status: "READY",
    descriptor,
    parameters,
    runtime_bindings: {
      valid_from_paris: setup.valid_from_paris,
      expires_at_paris: setup.expires_at_paris,
      cutoff_paris: toParisIso(Date.parse(market.cutoffUtc)),
      pack_id: market.dataset.dataset_id,
      pack_build_id: market.dataset.dataset_hash,
      plan_id: `runtime_plan_${instance.strategy_instance_id}_${setup.trading_date}`,
      session: "canonical_strategy_runtime",
      trading_date: setup.trading_date,
      setup_id_prefix: `runtime_${instance.strategy_instance_id}`,
      setups: [setup],
      metadata: {
        binding_version: DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION,
        binding_hash: `sha256:${canonicalSha256({ descriptor, parameters, setup })}`,
      },
    },
  };
}

function dataDrivenDescriptor(version = {}, dsl = {}) {
  const metadata = { ...(version.metadata || {}), ...(dsl.metadata || {}) };
  const familyId = text(metadata.family_id);
  const variantIndex = integer(metadata.variant_index ?? version.metadata?.variant_index, null);
  const familySpec = FAMILY_SPECS.find((item) => item.family_id === familyId);
  if (!familySpec) return rejected(["DATA_DRIVEN_RUNTIME_FAMILY_UNKNOWN"]);
  if (!Number.isInteger(variantIndex) || variantIndex < 1) return rejected(["DATA_DRIVEN_RUNTIME_VARIANT_INDEX_MISSING"]);
  return {
    ok: true,
    family_id: familyId,
    variant_index: variantIndex,
    anchor_kind: metadata.anchor_kind || familySpec.anchor_kind,
  };
}

function dataDrivenSetup({ day, dayIndex, tradingDays, familySpec, parameters, familyVariantIndex, instrument, instanceId }) {
  const anchor = anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
  if (!anchor) return null;
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
  return {
    setup_id: setupId({ familySpec, familyVariantIndex, dayIndex, day, instanceId }),
    template_id: `${familySpec.family_id}_${familySpec.direction}`,
    instrument,
    direction,
    rank: 1,
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
      source: DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION,
      family_id: familySpec.family_id,
      anchor_kind: familySpec.anchor_kind,
      anchor_source: anchor.source,
    },
  };
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

function buildTradingDays(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.time?.slice(0, 10);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const days = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([trading_date, dayRows]) => summarizeDay(trading_date, dayRows));
  const ranges = days.map((day) => day.range).sort((left, right) => left - right);
  const highs = days.map((day) => day.high).sort((left, right) => left - right);
  const lows = days.map((day) => day.low).sort((left, right) => left - right);
  for (let index = 0; index < days.length; index += 1) {
    days[index].previous = days[index - 1] || null;
    days[index].dataset_stats = {
      range_p35: percentile(ranges, 0.35) || 0,
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
    opening: (bars) => rangeSummary(sorted.slice(0, Math.max(1, bars))),
    asia: rangeSummary(sessionRows(sorted, "09:15", "14:45")),
    nyOpening: rangeSummary(sessionRows(sorted, "15:30", "17:00")),
  };
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

function mergeTemplateParameters(parameters, template) {
  return {
    ...parameters,
    tolerance_points: number(template.tolerance_points, parameters.tolerance_points),
    max_bars: number(template.max_bars, parameters.max_bars),
    order_type: String(template.order_type || parameters.order_type).toUpperCase(),
    require_rejection_confirmation: template.require_rejection_confirmation ?? parameters.require_rejection_confirmation,
  };
}

function entryZone({ direction, retest, tolerance, orderType }) {
  const half = orderType === "MARKET" ? Math.max(0.25, tolerance / 4) : Math.max(0.25, tolerance);
  if (direction === "long") return { lower: roundPrice(retest - half), upper: roundPrice(retest + Math.max(0.25, half / 2)) };
  return { lower: roundPrice(retest - Math.max(0.25, half / 2)), upper: roundPrice(retest + half) };
}

function setupId({ familySpec, familyVariantIndex, dayIndex, day, instanceId }) {
  return [
    "runtime",
    familySpec.family_id,
    `v${String(familyVariantIndex + 1).padStart(3, "0")}`,
    day.trading_date.replaceAll("-", ""),
    `d${String(dayIndex + 1).padStart(3, "0")}`,
    String(instanceId || "instance").slice(0, 8),
  ].join("_");
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

function family(family_id, direction, anchor_kind) { return Object.freeze({ family_id, direction, anchor_kind }); }
function firstTemplate(dsl) { return Array.isArray(dsl?.setup_templates) ? dsl.setup_templates[0] || {} : {}; }
function priceAnchor(level, source) { return Number.isFinite(Number(level)) ? { level: Number(level), source } : null; }
function deviationMultiplier(parameters) { return Math.max(0.15, Math.min(0.9, Number(parameters.tolerance_points || 4) / 20)); }
function pick(values, index) { return values[Math.abs(index) % values.length]; }
function percentile(values, ratio) { if (!values.length) return null; const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio))); return values[index]; }
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function integer(value, fallback = 0) { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : fallback; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value) { return String(value ?? "").trim(); }
function rejected(reasons) { return { ok: false, status: "REJECTED", reasons }; }
