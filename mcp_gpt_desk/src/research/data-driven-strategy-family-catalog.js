export const DATA_DRIVEN_STRATEGY_FAMILY_CATALOG_VERSION = "data_driven_strategy_family_catalog_v2";
export const DATA_DRIVEN_FAMILY_SET_V1 = "v1";
export const DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2 = "diversified_v2";

export const DATA_DRIVEN_PARAMETER_GRID = Object.freeze({
  openingBars: Object.freeze([4, 6, 8, 12, 18]),
  tolerancePoints: Object.freeze([2, 3, 4, 5, 6, 8, 10, 12]),
  maxBars: Object.freeze([12, 18, 24, 36, 48, 72, 96, 144]),
  riskPoints: Object.freeze([10, 14, 18, 22, 28, 34, 42, 55]),
  targetRr: Object.freeze([1.2, 1.5, 1.8, 2.1, 2.4, 2.8, 3.2]),
  offsets: Object.freeze([-6, -3, 0, 3, 6]),
  orderTypes: Object.freeze(["LIMIT", "MARKET"]),
  requireRejection: Object.freeze([false, true]),
});

export const DATA_DRIVEN_STRATEGY_FAMILIES_V1 = Object.freeze([
  family("opening_range_breakout_long", "Opening range breakout long", "long", "OPENING_RANGE_HIGH", ["opening-range", "breakout"]),
  family("opening_range_breakout_short", "Opening range breakout short", "short", "OPENING_RANGE_LOW", ["opening-range", "breakout"]),
  family("asia_range_breakout_long", "Asia range breakout long", "long", "ASIA_RANGE_HIGH", ["asia", "breakout"]),
  family("asia_range_breakout_short", "Asia range breakout short", "short", "ASIA_RANGE_LOW", ["asia", "breakout"]),
  family("ny_opening_drive_long", "NY opening drive long", "long", "NY_OPENING_HIGH", ["ny-open", "drive"]),
  family("ny_opening_drive_short", "NY opening drive short", "short", "NY_OPENING_LOW", ["ny-open", "drive"]),
  family("previous_day_high_reclaim", "Previous day high reclaim", "long", "PREVIOUS_DAY_HIGH", ["previous-day", "reclaim"]),
  family("previous_day_low_break", "Previous day low break", "short", "PREVIOUS_DAY_LOW", ["previous-day", "break"]),
  family("previous_day_mid_reclaim_long", "Previous day midpoint reclaim long", "long", "PREVIOUS_DAY_MID", ["previous-day", "midpoint"]),
  family("previous_day_mid_reject_short", "Previous day midpoint reject short", "short", "PREVIOUS_DAY_MID", ["previous-day", "midpoint"]),
  family("prior_close_reclaim_long", "Prior close reclaim long", "long", "PREVIOUS_DAY_CLOSE", ["prior-close", "reclaim"]),
  family("prior_close_reject_short", "Prior close reject short", "short", "PREVIOUS_DAY_CLOSE", ["prior-close", "reject"]),
  family("vwap_proxy_reclaim_long", "VWAP proxy reclaim long", "long", "ROLLING_VWAP", ["vwap", "reclaim"]),
  family("vwap_proxy_reject_short", "VWAP proxy reject short", "short", "ROLLING_VWAP", ["vwap", "reject"]),
  family("vwap_deviation_fade_long", "VWAP lower deviation fade long", "long", "VWAP_LOWER_DEVIATION", ["vwap", "fade"]),
  family("vwap_deviation_fade_short", "VWAP upper deviation fade short", "short", "VWAP_UPPER_DEVIATION", ["vwap", "fade"]),
  family("compression_breakout_long", "Compression breakout long", "long", "COMPRESSION_HIGH", ["compression", "breakout"]),
  family("compression_breakout_short", "Compression breakout short", "short", "COMPRESSION_LOW", ["compression", "breakout"]),
  family("weekly_anchor_breakout_long", "Weekly anchor breakout long", "long", "ROLLING_WEEK_HIGH", ["weekly", "breakout"]),
  family("weekly_anchor_breakout_short", "Weekly anchor breakout short", "short", "ROLLING_WEEK_LOW", ["weekly", "breakout"]),
]);

export const DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V2 = Object.freeze([
  ...DATA_DRIVEN_STRATEGY_FAMILIES_V1,
  family("previous_day_high_reject_short", "Previous day high rejection short", "short", "PREVIOUS_DAY_HIGH", ["previous-day", "failed-breakout"]),
  family("previous_day_low_reclaim_long", "Previous day low reclaim long", "long", "PREVIOUS_DAY_LOW", ["previous-day", "failed-breakdown"]),
  family("previous_day_upper_quartile_reclaim_long", "Previous day upper quartile reclaim long", "long", "PREVIOUS_DAY_Q75", ["previous-day", "quartile"]),
  family("previous_day_upper_quartile_reject_short", "Previous day upper quartile reject short", "short", "PREVIOUS_DAY_Q75", ["previous-day", "quartile"]),
  family("previous_day_lower_quartile_reclaim_long", "Previous day lower quartile reclaim long", "long", "PREVIOUS_DAY_Q25", ["previous-day", "quartile"]),
  family("previous_day_lower_quartile_break_short", "Previous day lower quartile break short", "short", "PREVIOUS_DAY_Q25", ["previous-day", "quartile"]),
  family("session_open_drive_long", "Session open drive long", "long", "DAY_OPEN", ["session-open", "momentum"]),
  family("session_open_drive_short", "Session open drive short", "short", "DAY_OPEN", ["session-open", "momentum"]),
  family("opening_mid_reclaim_long", "Opening range midpoint reclaim long", "long", "OPENING_RANGE_MID", ["opening-range", "midpoint"]),
  family("opening_mid_reject_short", "Opening range midpoint reject short", "short", "OPENING_RANGE_MID", ["opening-range", "midpoint"]),
  family("asia_mid_reclaim_long", "Asia range midpoint reclaim long", "long", "ASIA_RANGE_MID", ["asia", "midpoint"]),
  family("asia_mid_reject_short", "Asia range midpoint reject short", "short", "ASIA_RANGE_MID", ["asia", "midpoint"]),
  family("ny_opening_mid_reclaim_long", "NY opening midpoint reclaim long", "long", "NY_OPENING_MID", ["ny-open", "midpoint"]),
  family("ny_opening_mid_reject_short", "NY opening midpoint reject short", "short", "NY_OPENING_MID", ["ny-open", "midpoint"]),
  family("rolling_three_day_breakout_long", "Rolling 3-day breakout long", "long", "ROLLING_3D_HIGH", ["multi-day", "breakout"]),
  family("rolling_three_day_breakout_short", "Rolling 3-day breakout short", "short", "ROLLING_3D_LOW", ["multi-day", "breakout"]),
  family("rolling_three_day_mean_reclaim_long", "Rolling 3-day mean reclaim long", "long", "ROLLING_3D_MID", ["multi-day", "mean"]),
  family("rolling_three_day_mean_reject_short", "Rolling 3-day mean reject short", "short", "ROLLING_3D_MID", ["multi-day", "mean"]),
  family("previous_day_open_reclaim_long", "Previous day open reclaim long", "long", "PREVIOUS_DAY_OPEN", ["previous-day", "open"]),
  family("previous_day_open_reject_short", "Previous day open reject short", "short", "PREVIOUS_DAY_OPEN", ["previous-day", "open"]),
]);

export const DATA_DRIVEN_STRATEGY_FAMILIES = DATA_DRIVEN_STRATEGY_FAMILIES_V1;

export function normalizeDataDrivenFamilySet(value) {
  const normalized = String(value || DATA_DRIVEN_FAMILY_SET_V1).trim().toLowerCase();
  if (["v2", "diversified-v2", "diversified_v2", "mega-diversified-v2"].includes(normalized)) {
    return DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2;
  }
  return DATA_DRIVEN_FAMILY_SET_V1;
}

export function getDataDrivenStrategyFamilies(familySet = DATA_DRIVEN_FAMILY_SET_V1) {
  return normalizeDataDrivenFamilySet(familySet) === DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2
    ? DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V2
    : DATA_DRIVEN_STRATEGY_FAMILIES_V1;
}

export function findDataDrivenStrategyFamily(familyId) {
  const id = String(familyId || "").trim();
  return DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V2.find((item) => item.family_id === id) || null;
}

export function getDataDrivenStrategyFamilyIndex(familyId, familySet = DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2) {
  return getDataDrivenStrategyFamilies(familySet).findIndex((item) => item.family_id === familyId);
}

export function dataDrivenParameterCombination(familyIndex, index) {
  return {
    opening_bars: pick(DATA_DRIVEN_PARAMETER_GRID.openingBars, index + familyIndex),
    tolerance_points: pick(DATA_DRIVEN_PARAMETER_GRID.tolerancePoints, index * 3 + familyIndex),
    max_bars: pick(DATA_DRIVEN_PARAMETER_GRID.maxBars, index * 5 + familyIndex),
    risk_points: pick(DATA_DRIVEN_PARAMETER_GRID.riskPoints, index * 7 + familyIndex),
    target_rr: pick(DATA_DRIVEN_PARAMETER_GRID.targetRr, index * 11 + familyIndex),
    break_offset_points: pick(DATA_DRIVEN_PARAMETER_GRID.offsets, index * 13 + familyIndex),
    order_type: pick(DATA_DRIVEN_PARAMETER_GRID.orderTypes, index + familyIndex),
    require_rejection_confirmation: pick(DATA_DRIVEN_PARAMETER_GRID.requireRejection, index * 17 + familyIndex),
  };
}

export function dataDrivenAnchorForFamily({ familySpec, parameters = {}, day, tradingDays = [], dayIndex = 0 }) {
  const previous = day?.previous || tradingDays[Math.max(0, dayIndex - 1)] || null;
  const week = rollingWindow(tradingDays, dayIndex, 5);
  const threeDays = rollingWindow(tradingDays, dayIndex, 3);
  const compression = previous && day?.dataset_stats && previous.range <= day.dataset_stats.range_p35;
  switch (familySpec?.anchor_kind) {
    case "OPENING_RANGE_HIGH": return priceAnchor(day.opening(parameters.opening_bars).high, "opening_range_high");
    case "OPENING_RANGE_LOW": return priceAnchor(day.opening(parameters.opening_bars).low, "opening_range_low");
    case "OPENING_RANGE_MID": return rangeMidAnchor(day.opening(parameters.opening_bars), "opening_range_mid");
    case "ASIA_RANGE_HIGH": return priceAnchor(day.asia.high ?? day.opening(parameters.opening_bars).high, "asia_range_high");
    case "ASIA_RANGE_LOW": return priceAnchor(day.asia.low ?? day.opening(parameters.opening_bars).low, "asia_range_low");
    case "ASIA_RANGE_MID": return rangeMidAnchor(day.asia, "asia_range_mid") ?? rangeMidAnchor(day.opening(parameters.opening_bars), "fallback_opening_range_mid");
    case "NY_OPENING_HIGH": return priceAnchor(day.nyOpening.high ?? day.opening(parameters.opening_bars).high, "ny_opening_high");
    case "NY_OPENING_LOW": return priceAnchor(day.nyOpening.low ?? day.opening(parameters.opening_bars).low, "ny_opening_low");
    case "NY_OPENING_MID": return rangeMidAnchor(day.nyOpening, "ny_opening_mid") ?? rangeMidAnchor(day.opening(parameters.opening_bars), "fallback_opening_range_mid");
    case "DAY_OPEN": return priceAnchor(day.open, "day_open");
    case "PREVIOUS_DAY_OPEN": return previous ? priceAnchor(previous.open, "previous_day_open") : null;
    case "PREVIOUS_DAY_HIGH": return previous ? priceAnchor(previous.high, "previous_day_high") : null;
    case "PREVIOUS_DAY_LOW": return previous ? priceAnchor(previous.low, "previous_day_low") : null;
    case "PREVIOUS_DAY_MID": return previous ? priceAnchor((previous.high + previous.low) / 2, "previous_day_mid") : null;
    case "PREVIOUS_DAY_Q25": return previous ? priceAnchor(previous.low + previous.range * 0.25, "previous_day_q25") : null;
    case "PREVIOUS_DAY_Q75": return previous ? priceAnchor(previous.low + previous.range * 0.75, "previous_day_q75") : null;
    case "PREVIOUS_DAY_CLOSE": return previous ? priceAnchor(previous.close, "previous_day_close") : null;
    case "ROLLING_VWAP": return priceAnchor(day.vwap, "daily_vwap_proxy");
    case "VWAP_LOWER_DEVIATION": return priceAnchor(day.vwap - day.range * deviationMultiplier(parameters), "vwap_lower_deviation");
    case "VWAP_UPPER_DEVIATION": return priceAnchor(day.vwap + day.range * deviationMultiplier(parameters), "vwap_upper_deviation");
    case "COMPRESSION_HIGH": return compression ? priceAnchor(day.opening(parameters.opening_bars).high, "compression_high") : priceAnchor(day.dataset_stats.range_p35_high, "fallback_compression_high");
    case "COMPRESSION_LOW": return compression ? priceAnchor(day.opening(parameters.opening_bars).low, "compression_low") : priceAnchor(day.dataset_stats.range_p35_low, "fallback_compression_low");
    case "ROLLING_WEEK_HIGH": return rollingHighAnchor(week, "rolling_week_high");
    case "ROLLING_WEEK_LOW": return rollingLowAnchor(week, "rolling_week_low");
    case "ROLLING_WEEK_MID": return rollingMidAnchor(week, "rolling_week_mid");
    case "ROLLING_3D_HIGH": return rollingHighAnchor(threeDays, "rolling_3d_high");
    case "ROLLING_3D_LOW": return rollingLowAnchor(threeDays, "rolling_3d_low");
    case "ROLLING_3D_MID": return rollingMidAnchor(threeDays, "rolling_3d_mid");
    default: return null;
  }
}

function family(family_id, label, direction, anchor_kind, tags = []) {
  return Object.freeze({ family_id, label, direction, anchor_kind, tags: Object.freeze([...tags]) });
}

function rangeMidAnchor(range, source) {
  if (!range || !Number.isFinite(Number(range.high)) || !Number.isFinite(Number(range.low))) return null;
  return priceAnchor((Number(range.high) + Number(range.low)) / 2, source);
}

function rollingHighAnchor(days, source) {
  return days.length ? priceAnchor(Math.max(...days.map((item) => item.high)), source) : null;
}

function rollingLowAnchor(days, source) {
  return days.length ? priceAnchor(Math.min(...days.map((item) => item.low)), source) : null;
}

function rollingMidAnchor(days, source) {
  if (!days.length) return null;
  const high = Math.max(...days.map((item) => item.high));
  const low = Math.min(...days.map((item) => item.low));
  return priceAnchor((high + low) / 2, source);
}

function rollingWindow(items, index, size) {
  return items.slice(Math.max(0, index - size + 1), index + 1);
}

function deviationMultiplier(parameters) {
  return 0.18 + (Number(parameters.tolerance_points || 0) % 5) * 0.04;
}

function priceAnchor(level, source) {
  if (level === null || level === undefined || level === "") return null;
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) return null;
  return { level: parsed, source };
}

function pick(values, index) {
  return values[Math.abs(index) % values.length];
}
