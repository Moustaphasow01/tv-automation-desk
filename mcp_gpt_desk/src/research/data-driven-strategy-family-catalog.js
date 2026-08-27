export const DATA_DRIVEN_STRATEGY_FAMILY_CATALOG_VERSION = "data_driven_strategy_family_catalog_v4";
export const DATA_DRIVEN_FAMILY_SET_V1 = "v1";
export const DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2 = "diversified_v2";
export const DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V3 = "diversified_v3";
export const DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V4 = "diversified_v4";

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

export const DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V3 = Object.freeze([
  ...DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V2,
  family("gap_up_fill_short", "Gap-up fill short", "short", "GAP_UP_OPEN", ["gap", "mean-reversion", "session-open"]),
  family("gap_down_fill_long", "Gap-down fill long", "long", "GAP_DOWN_OPEN", ["gap", "mean-reversion", "session-open"]),
  family("gap_up_continuation_long", "Gap-up continuation long", "long", "GAP_UP_OPEN", ["gap", "continuation", "session-open"]),
  family("gap_down_continuation_short", "Gap-down continuation short", "short", "GAP_DOWN_OPEN", ["gap", "continuation", "session-open"]),
  family("inside_day_breakout_long", "Inside-day breakout long", "long", "INSIDE_DAY_HIGH", ["inside-day", "breakout", "multi-day"]),
  family("inside_day_breakout_short", "Inside-day breakout short", "short", "INSIDE_DAY_LOW", ["inside-day", "breakout", "multi-day"]),
  family("inside_day_mid_reclaim_long", "Inside-day midpoint reclaim long", "long", "INSIDE_DAY_MID", ["inside-day", "midpoint", "multi-day"]),
  family("inside_day_mid_reject_short", "Inside-day midpoint reject short", "short", "INSIDE_DAY_MID", ["inside-day", "midpoint", "multi-day"]),
  family("outside_day_reversal_short", "Outside-day high reversal short", "short", "OUTSIDE_DAY_HIGH", ["outside-day", "reversal", "multi-day"]),
  family("outside_day_reversal_long", "Outside-day low reversal long", "long", "OUTSIDE_DAY_LOW", ["outside-day", "reversal", "multi-day"]),
  family("previous_body_high_reclaim_long", "Previous body high reclaim long", "long", "PREVIOUS_DAY_BODY_HIGH", ["candle-body", "reclaim", "previous-day"]),
  family("previous_body_high_reject_short", "Previous body high reject short", "short", "PREVIOUS_DAY_BODY_HIGH", ["candle-body", "reject", "previous-day"]),
  family("previous_body_low_reclaim_long", "Previous body low reclaim long", "long", "PREVIOUS_DAY_BODY_LOW", ["candle-body", "reclaim", "previous-day"]),
  family("previous_body_low_break_short", "Previous body low break short", "short", "PREVIOUS_DAY_BODY_LOW", ["candle-body", "break", "previous-day"]),
  family("previous_body_mid_reclaim_long", "Previous body midpoint reclaim long", "long", "PREVIOUS_DAY_BODY_MID", ["candle-body", "midpoint", "previous-day"]),
  family("previous_body_mid_reject_short", "Previous body midpoint reject short", "short", "PREVIOUS_DAY_BODY_MID", ["candle-body", "midpoint", "previous-day"]),
  family("first_hour_breakout_long", "First-hour breakout long", "long", "FIRST_HOUR_HIGH", ["first-hour", "breakout", "intraday"]),
  family("first_hour_breakout_short", "First-hour breakout short", "short", "FIRST_HOUR_LOW", ["first-hour", "breakout", "intraday"]),
  family("first_hour_mid_reclaim_long", "First-hour midpoint reclaim long", "long", "FIRST_HOUR_MID", ["first-hour", "midpoint", "intraday"]),
  family("first_hour_mid_reject_short", "First-hour midpoint reject short", "short", "FIRST_HOUR_MID", ["first-hour", "midpoint", "intraday"]),
  family("value_area_proxy_reclaim_long", "Previous value-area proxy reclaim long", "long", "PREVIOUS_DAY_VALUE_AREA_LOW", ["value-area-proxy", "reclaim", "previous-day"]),
  family("value_area_proxy_reject_short", "Previous value-area proxy reject short", "short", "PREVIOUS_DAY_VALUE_AREA_HIGH", ["value-area-proxy", "reject", "previous-day"]),
  family("close_location_upper_continuation_long", "Upper close-location continuation long", "long", "PREVIOUS_DAY_CLOSE_LOCATION_UPPER", ["close-location", "continuation", "previous-day"]),
  family("close_location_lower_continuation_short", "Lower close-location continuation short", "short", "PREVIOUS_DAY_CLOSE_LOCATION_LOWER", ["close-location", "continuation", "previous-day"]),
  family("rolling_week_mean_reclaim_long", "Rolling week mean reclaim long", "long", "ROLLING_WEEK_MID", ["weekly", "mean", "reclaim"]),
  family("rolling_week_mean_reject_short", "Rolling week mean reject short", "short", "ROLLING_WEEK_MID", ["weekly", "mean", "reject"]),
  family("volatility_expansion_breakout_long", "Volatility-expansion breakout long", "long", "VOLATILITY_EXPANSION_HIGH", ["volatility-expansion", "breakout"]),
  family("volatility_expansion_breakout_short", "Volatility-expansion breakout short", "short", "VOLATILITY_EXPANSION_LOW", ["volatility-expansion", "breakout"]),
  family("rolling_three_day_upper_quartile_reclaim_long", "Rolling 3-day upper quartile reclaim long", "long", "ROLLING_3D_Q75", ["multi-day", "quartile", "reclaim"]),
  family("rolling_three_day_lower_quartile_break_short", "Rolling 3-day lower quartile break short", "short", "ROLLING_3D_Q25", ["multi-day", "quartile", "break"]),
]);

export const DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V4 = Object.freeze([
  ...DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V3,
  family("lunch_range_breakout_long", "Lunch range breakout long", "long", "LUNCH_RANGE_HIGH", ["lunch", "intraday", "breakout"]),
  family("lunch_range_breakout_short", "Lunch range breakout short", "short", "LUNCH_RANGE_LOW", ["lunch", "intraday", "breakout"]),
  family("lunch_mid_reclaim_long", "Lunch range midpoint reclaim long", "long", "LUNCH_RANGE_MID", ["lunch", "midpoint", "reclaim"]),
  family("lunch_mid_reject_short", "Lunch range midpoint reject short", "short", "LUNCH_RANGE_MID", ["lunch", "midpoint", "reject"]),
  family("pre_ny_range_breakout_long", "Pre-NY range breakout long", "long", "PRE_NY_RANGE_HIGH", ["pre-ny", "intraday", "breakout"]),
  family("pre_ny_range_breakout_short", "Pre-NY range breakout short", "short", "PRE_NY_RANGE_LOW", ["pre-ny", "intraday", "breakout"]),
  family("pre_ny_mid_reclaim_long", "Pre-NY range midpoint reclaim long", "long", "PRE_NY_RANGE_MID", ["pre-ny", "midpoint", "reclaim"]),
  family("pre_ny_mid_reject_short", "Pre-NY range midpoint reject short", "short", "PRE_NY_RANGE_MID", ["pre-ny", "midpoint", "reject"]),
  family("overnight_high_reclaim_long", "Overnight high reclaim long", "long", "OVERNIGHT_HIGH", ["overnight", "reclaim"]),
  family("overnight_low_break_short", "Overnight low break short", "short", "OVERNIGHT_LOW", ["overnight", "break"]),
  family("overnight_mid_reclaim_long", "Overnight midpoint reclaim long", "long", "OVERNIGHT_MID", ["overnight", "midpoint", "reclaim"]),
  family("overnight_mid_reject_short", "Overnight midpoint reject short", "short", "OVERNIGHT_MID", ["overnight", "midpoint", "reject"]),
  family("previous_atr_upper_reclaim_long", "Previous ATR upper band reclaim long", "long", "PREVIOUS_ATR_UPPER", ["atr-band", "previous-day", "reclaim"]),
  family("previous_atr_upper_reject_short", "Previous ATR upper band rejection short", "short", "PREVIOUS_ATR_UPPER", ["atr-band", "previous-day", "reject"]),
  family("previous_atr_lower_reclaim_long", "Previous ATR lower band reclaim long", "long", "PREVIOUS_ATR_LOWER", ["atr-band", "previous-day", "reclaim"]),
  family("previous_atr_lower_break_short", "Previous ATR lower band break short", "short", "PREVIOUS_ATR_LOWER", ["atr-band", "previous-day", "break"]),
  family("rolling_five_day_high_breakout_long", "Rolling 5-day high breakout long", "long", "ROLLING_5D_HIGH", ["multi-day", "5d", "breakout"]),
  family("rolling_five_day_low_break_short", "Rolling 5-day low break short", "short", "ROLLING_5D_LOW", ["multi-day", "5d", "break"]),
  family("rolling_five_day_mid_reclaim_long", "Rolling 5-day midpoint reclaim long", "long", "ROLLING_5D_MID", ["multi-day", "5d", "midpoint"]),
  family("rolling_five_day_mid_reject_short", "Rolling 5-day midpoint reject short", "short", "ROLLING_5D_MID", ["multi-day", "5d", "midpoint"]),
  family("rolling_ten_day_high_breakout_long", "Rolling 10-day high breakout long", "long", "ROLLING_10D_HIGH", ["multi-day", "10d", "breakout"]),
  family("rolling_ten_day_low_break_short", "Rolling 10-day low break short", "short", "ROLLING_10D_LOW", ["multi-day", "10d", "break"]),
  family("rolling_ten_day_mid_reclaim_long", "Rolling 10-day midpoint reclaim long", "long", "ROLLING_10D_MID", ["multi-day", "10d", "midpoint"]),
  family("rolling_ten_day_mid_reject_short", "Rolling 10-day midpoint reject short", "short", "ROLLING_10D_MID", ["multi-day", "10d", "midpoint"]),
  family("previous_extension_high_fade_short", "Previous range extension high fade short", "short", "PREVIOUS_DAY_EXT_HIGH", ["range-extension", "fade", "previous-day"]),
  family("previous_extension_low_fade_long", "Previous range extension low fade long", "long", "PREVIOUS_DAY_EXT_LOW", ["range-extension", "fade", "previous-day"]),
  family("previous_extension_high_breakout_long", "Previous range extension high breakout long", "long", "PREVIOUS_DAY_EXT_HIGH", ["range-extension", "breakout", "previous-day"]),
  family("previous_extension_low_break_short", "Previous range extension low break short", "short", "PREVIOUS_DAY_EXT_LOW", ["range-extension", "break", "previous-day"]),
  family("previous_body_extension_high_reclaim_long", "Previous body extension high reclaim long", "long", "PREVIOUS_BODY_EXT_HIGH", ["body-extension", "reclaim", "previous-day"]),
  family("previous_body_extension_low_break_short", "Previous body extension low break short", "short", "PREVIOUS_BODY_EXT_LOW", ["body-extension", "break", "previous-day"]),
  family("previous_close_upper_band_reject_short", "Previous close upper band reject short", "short", "PREVIOUS_CLOSE_UPPER_BAND", ["close-band", "reject", "previous-day"]),
  family("previous_close_lower_band_reclaim_long", "Previous close lower band reclaim long", "long", "PREVIOUS_CLOSE_LOWER_BAND", ["close-band", "reclaim", "previous-day"]),
  family("trend_day_upper_continuation_long", "Trend day upper continuation long", "long", "TREND_DAY_UPPER", ["trend-day", "continuation"]),
  family("trend_day_lower_continuation_short", "Trend day lower continuation short", "short", "TREND_DAY_LOWER", ["trend-day", "continuation"]),
  family("contraction_mid_reclaim_long", "Contraction midpoint reclaim long", "long", "CONTRACTION_MID", ["contraction", "midpoint", "reclaim"]),
  family("contraction_mid_reject_short", "Contraction midpoint reject short", "short", "CONTRACTION_MID", ["contraction", "midpoint", "reject"]),
  family("opening_vwap_dislocation_fade_long", "Opening VWAP lower dislocation fade long", "long", "OPENING_VWAP_LOWER", ["vwap", "opening", "dislocation", "fade"]),
  family("opening_vwap_dislocation_fade_short", "Opening VWAP upper dislocation fade short", "short", "OPENING_VWAP_UPPER", ["vwap", "opening", "dislocation", "fade"]),
  family("afternoon_range_breakout_long", "Afternoon range breakout long", "long", "AFTERNOON_RANGE_HIGH", ["afternoon", "intraday", "breakout"]),
  family("afternoon_range_breakout_short", "Afternoon range breakout short", "short", "AFTERNOON_RANGE_LOW", ["afternoon", "intraday", "breakout"]),
]);

export const DATA_DRIVEN_STRATEGY_FAMILIES = DATA_DRIVEN_STRATEGY_FAMILIES_V1;

export function normalizeDataDrivenFamilySet(value) {
  const normalized = String(value || DATA_DRIVEN_FAMILY_SET_V1).trim().toLowerCase();
  if (["v4", "diversified-v4", "diversified_v4", "mega-diversified-v4", "orthogonal-v4", "orthogonal_v4"].includes(normalized)) {
    return DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V4;
  }
  if (["v3", "diversified-v3", "diversified_v3", "mega-diversified-v3", "orthogonal-v3", "orthogonal_v3"].includes(normalized)) {
    return DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V3;
  }
  if (["v2", "diversified-v2", "diversified_v2", "mega-diversified-v2"].includes(normalized)) {
    return DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2;
  }
  return DATA_DRIVEN_FAMILY_SET_V1;
}

export function getDataDrivenStrategyFamilies(familySet = DATA_DRIVEN_FAMILY_SET_V1) {
  const normalized = normalizeDataDrivenFamilySet(familySet);
  if (normalized === DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V4) return DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V4;
  if (normalized === DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V3) return DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V3;
  if (normalized === DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2) return DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V2;
  return DATA_DRIVEN_STRATEGY_FAMILIES_V1;
}

export function findDataDrivenStrategyFamily(familyId) {
  const id = String(familyId || "").trim();
  return DATA_DRIVEN_STRATEGY_FAMILIES_DIVERSIFIED_V4.find((item) => item.family_id === id) || null;
}

export function getDataDrivenStrategyFamilyIndex(familyId, familySet = DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V4) {
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
  const previousPrevious = tradingDays[Math.max(0, dayIndex - 2)] || null;
  const week = rollingWindow(tradingDays, dayIndex, 5);
  const threeDays = rollingWindow(tradingDays, dayIndex, 3);
  const fiveDays = rollingWindow(tradingDays, dayIndex, 5);
  const tenDays = rollingWindow(tradingDays, dayIndex, 10);
  const compression = previous && day?.dataset_stats && previous.range <= day.dataset_stats.range_p35;
  const firstHour = day?.firstHour || day?.opening?.(parameters.opening_bars);
  switch (familySpec?.anchor_kind) {
    case "OPENING_RANGE_HIGH": return priceAnchor(day.opening(parameters.opening_bars).high, "opening_range_high");
    case "OPENING_RANGE_LOW": return priceAnchor(day.opening(parameters.opening_bars).low, "opening_range_low");
    case "OPENING_RANGE_MID": return rangeMidAnchor(day.opening(parameters.opening_bars), "opening_range_mid");
    case "ASIA_RANGE_HIGH": return priceAnchor(day.asia.high ?? day.opening(parameters.opening_bars).high, "asia_range_high");
    case "ASIA_RANGE_LOW": return priceAnchor(day.asia.low ?? day.opening(parameters.opening_bars).low, "asia_range_low");
    case "ASIA_RANGE_MID": return rangeMidAnchor(day.asia, "asia_range_mid") ?? rangeMidAnchor(day.opening(parameters.opening_bars), "fallback_opening_range_mid");
    case "LUNCH_RANGE_HIGH": return priceAnchor(day?.lunch?.high ?? day?.opening?.(parameters.opening_bars)?.high, "lunch_range_high");
    case "LUNCH_RANGE_LOW": return priceAnchor(day?.lunch?.low ?? day?.opening?.(parameters.opening_bars)?.low, "lunch_range_low");
    case "LUNCH_RANGE_MID": return rangeMidAnchor(day?.lunch, "lunch_range_mid") ?? rangeMidAnchor(day.opening(parameters.opening_bars), "fallback_opening_range_mid");
    case "PRE_NY_RANGE_HIGH": return priceAnchor(day?.preNy?.high ?? day?.nyOpening?.high ?? day?.opening?.(parameters.opening_bars)?.high, "pre_ny_range_high");
    case "PRE_NY_RANGE_LOW": return priceAnchor(day?.preNy?.low ?? day?.nyOpening?.low ?? day?.opening?.(parameters.opening_bars)?.low, "pre_ny_range_low");
    case "PRE_NY_RANGE_MID": return rangeMidAnchor(day?.preNy, "pre_ny_range_mid") ?? rangeMidAnchor(day?.nyOpening, "fallback_ny_opening_mid") ?? rangeMidAnchor(day.opening(parameters.opening_bars), "fallback_opening_range_mid");
    case "AFTERNOON_RANGE_HIGH": return priceAnchor(day?.afternoon?.high ?? day?.nyOpening?.high ?? day?.opening?.(parameters.opening_bars)?.high, "afternoon_range_high");
    case "AFTERNOON_RANGE_LOW": return priceAnchor(day?.afternoon?.low ?? day?.nyOpening?.low ?? day?.opening?.(parameters.opening_bars)?.low, "afternoon_range_low");
    case "OVERNIGHT_HIGH": return priceAnchor(day?.overnight?.high ?? previous?.high, "overnight_high");
    case "OVERNIGHT_LOW": return priceAnchor(day?.overnight?.low ?? previous?.low, "overnight_low");
    case "OVERNIGHT_MID": return rangeMidAnchor(day?.overnight, "overnight_mid") ?? (previous ? priceAnchor((previous.high + previous.low) / 2, "fallback_previous_day_mid") : null);
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
    case "PREVIOUS_DAY_BODY_HIGH": return previous ? priceAnchor(Math.max(previous.open, previous.close), "previous_day_body_high") : null;
    case "PREVIOUS_DAY_BODY_LOW": return previous ? priceAnchor(Math.min(previous.open, previous.close), "previous_day_body_low") : null;
    case "PREVIOUS_DAY_BODY_MID": return previous ? priceAnchor((Math.max(previous.open, previous.close) + Math.min(previous.open, previous.close)) / 2, "previous_day_body_mid") : null;
    case "PREVIOUS_BODY_EXT_HIGH": return previousBodyExtensionAnchor(previous, "high", parameters);
    case "PREVIOUS_BODY_EXT_LOW": return previousBodyExtensionAnchor(previous, "low", parameters);
    case "PREVIOUS_DAY_VALUE_AREA_HIGH": return previous ? priceAnchor(previousValueAreaHigh(previous), "previous_day_value_area_proxy_high") : null;
    case "PREVIOUS_DAY_VALUE_AREA_LOW": return previous ? priceAnchor(previousValueAreaLow(previous), "previous_day_value_area_proxy_low") : null;
    case "PREVIOUS_DAY_EXT_HIGH": return previousExtensionAnchor(previous, "high", parameters);
    case "PREVIOUS_DAY_EXT_LOW": return previousExtensionAnchor(previous, "low", parameters);
    case "PREVIOUS_ATR_UPPER": return previousCloseBandAnchor(previous, fiveDays, "upper", parameters, "previous_atr_upper");
    case "PREVIOUS_ATR_LOWER": return previousCloseBandAnchor(previous, fiveDays, "lower", parameters, "previous_atr_lower");
    case "PREVIOUS_CLOSE_UPPER_BAND": return previousCloseBandAnchor(previous, fiveDays, "upper", parameters, "previous_close_upper_band");
    case "PREVIOUS_CLOSE_LOWER_BAND": return previousCloseBandAnchor(previous, fiveDays, "lower", parameters, "previous_close_lower_band");
    case "PREVIOUS_DAY_CLOSE_LOCATION_UPPER": return previous ? closeLocationAnchor(previous, 0.66, "upper", "previous_day_close_location_upper") : null;
    case "PREVIOUS_DAY_CLOSE_LOCATION_LOWER": return previous ? closeLocationAnchor(previous, 0.34, "lower", "previous_day_close_location_lower") : null;
    case "GAP_UP_OPEN": return gapAnchor({ previous, day, parameters, direction: "up", source: "gap_up_open" });
    case "GAP_DOWN_OPEN": return gapAnchor({ previous, day, parameters, direction: "down", source: "gap_down_open" });
    case "ROLLING_VWAP": return priceAnchor(day.vwap, "daily_vwap_proxy");
    case "VWAP_LOWER_DEVIATION": return priceAnchor(day.vwap - day.range * deviationMultiplier(parameters), "vwap_lower_deviation");
    case "VWAP_UPPER_DEVIATION": return priceAnchor(day.vwap + day.range * deviationMultiplier(parameters), "vwap_upper_deviation");
    case "COMPRESSION_HIGH": return compression ? priceAnchor(day.opening(parameters.opening_bars).high, "compression_high") : priceAnchor(day.dataset_stats.range_p35_high, "fallback_compression_high");
    case "COMPRESSION_LOW": return compression ? priceAnchor(day.opening(parameters.opening_bars).low, "compression_low") : priceAnchor(day.dataset_stats.range_p35_low, "fallback_compression_low");
    case "ROLLING_WEEK_HIGH": return rollingHighAnchor(week, "rolling_week_high");
    case "ROLLING_WEEK_LOW": return rollingLowAnchor(week, "rolling_week_low");
    case "ROLLING_WEEK_MID": return rollingMidAnchor(week, "rolling_week_mid");
    case "ROLLING_5D_HIGH": return rollingHighAnchor(fiveDays, "rolling_5d_high");
    case "ROLLING_5D_LOW": return rollingLowAnchor(fiveDays, "rolling_5d_low");
    case "ROLLING_5D_MID": return rollingMidAnchor(fiveDays, "rolling_5d_mid");
    case "ROLLING_10D_HIGH": return rollingHighAnchor(tenDays, "rolling_10d_high");
    case "ROLLING_10D_LOW": return rollingLowAnchor(tenDays, "rolling_10d_low");
    case "ROLLING_10D_MID": return rollingMidAnchor(tenDays, "rolling_10d_mid");
    case "ROLLING_3D_HIGH": return rollingHighAnchor(threeDays, "rolling_3d_high");
    case "ROLLING_3D_LOW": return rollingLowAnchor(threeDays, "rolling_3d_low");
    case "ROLLING_3D_MID": return rollingMidAnchor(threeDays, "rolling_3d_mid");
    case "ROLLING_3D_Q25": return rollingQuantileAnchor(threeDays, 0.25, "rolling_3d_q25");
    case "ROLLING_3D_Q75": return rollingQuantileAnchor(threeDays, 0.75, "rolling_3d_q75");
    case "INSIDE_DAY_HIGH": return insideDayAnchor(previous, previousPrevious, "high");
    case "INSIDE_DAY_LOW": return insideDayAnchor(previous, previousPrevious, "low");
    case "INSIDE_DAY_MID": return insideDayAnchor(previous, previousPrevious, "mid");
    case "OUTSIDE_DAY_HIGH": return outsideDayAnchor(previous, previousPrevious, "high");
    case "OUTSIDE_DAY_LOW": return outsideDayAnchor(previous, previousPrevious, "low");
    case "FIRST_HOUR_HIGH": return priceAnchor(firstHour?.high, "first_hour_high");
    case "FIRST_HOUR_LOW": return priceAnchor(firstHour?.low, "first_hour_low");
    case "FIRST_HOUR_MID": return rangeMidAnchor(firstHour, "first_hour_mid");
    case "VOLATILITY_EXPANSION_HIGH": return volatilityExpansionAnchor({ previous, day, side: "high" });
    case "VOLATILITY_EXPANSION_LOW": return volatilityExpansionAnchor({ previous, day, side: "low" });
    case "TREND_DAY_UPPER": return previous ? closeLocationAnchor(previous, 0.6, "upper", "trend_day_upper") : null;
    case "TREND_DAY_LOWER": return previous ? closeLocationAnchor(previous, 0.4, "lower", "trend_day_lower") : null;
    case "CONTRACTION_MID": return contractionMidAnchor({ previous, threeDays, day });
    case "OPENING_VWAP_LOWER": return openingVwapDislocationAnchor(day, "lower", parameters);
    case "OPENING_VWAP_UPPER": return openingVwapDislocationAnchor(day, "upper", parameters);
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

function rollingQuantileAnchor(days, ratio, source) {
  if (!days.length) return null;
  const high = Math.max(...days.map((item) => item.high));
  const low = Math.min(...days.map((item) => item.low));
  return priceAnchor(low + (high - low) * ratio, source);
}

function insideDayAnchor(previous, previousPrevious, side) {
  if (!previous) return null;
  const isInside = previousPrevious && previous.high < previousPrevious.high && previous.low > previousPrevious.low;
  const sourcePrefix = isInside ? "inside_day" : "fallback_previous_day";
  if (side === "high") return priceAnchor(previous.high, `${sourcePrefix}_high`);
  if (side === "low") return priceAnchor(previous.low, `${sourcePrefix}_low`);
  return priceAnchor((previous.high + previous.low) / 2, `${sourcePrefix}_mid`);
}

function outsideDayAnchor(previous, previousPrevious, side) {
  if (!previous) return null;
  const isOutside = previousPrevious && previous.high > previousPrevious.high && previous.low < previousPrevious.low;
  const sourcePrefix = isOutside ? "outside_day" : "fallback_previous_day";
  if (side === "high") return priceAnchor(previous.high, `${sourcePrefix}_high`);
  return priceAnchor(previous.low, `${sourcePrefix}_low`);
}

function previousValueAreaHigh(previous) {
  const base = Number.isFinite(Number(previous.vwap)) ? Number(previous.vwap) : (Number(previous.high) + Number(previous.low)) / 2;
  return base + Number(previous.range || 0) * 0.18;
}

function previousValueAreaLow(previous) {
  const base = Number.isFinite(Number(previous.vwap)) ? Number(previous.vwap) : (Number(previous.high) + Number(previous.low)) / 2;
  return base - Number(previous.range || 0) * 0.18;
}

function closeLocationAnchor(previous, threshold, side, source) {
  const range = Math.max(0.25, Number(previous.range || 0));
  const location = (Number(previous.close) - Number(previous.low)) / range;
  if (side === "upper") {
    return priceAnchor(location >= threshold ? previous.close : previous.low + range * 0.75, location >= threshold ? source : "fallback_previous_day_q75");
  }
  return priceAnchor(location <= threshold ? previous.close : previous.low + range * 0.25, location <= threshold ? source : "fallback_previous_day_q25");
}

function gapAnchor({ previous, day, parameters, direction, source }) {
  if (!previous || !day) return null;
  const gap = Number(day.open) - Number(previous.close);
  const minGap = Math.max(0.25, Number(parameters.tolerance_points || 0) / 2);
  if (direction === "up") {
    return priceAnchor(day.open, gap >= minGap ? source : "fallback_day_open_no_gap_up");
  }
  return priceAnchor(day.open, gap <= -minGap ? source : "fallback_day_open_no_gap_down");
}

function averageRange(days) {
  const ranges = days.map((item) => Number(item?.range || 0)).filter((item) => Number.isFinite(item) && item > 0);
  if (!ranges.length) return 0;
  return ranges.reduce((sum, item) => sum + item, 0) / ranges.length;
}

function atrBandMultiplier(parameters) {
  return 0.22 + (Number(parameters.tolerance_points || 0) % 6) * 0.035;
}

function extensionMultiplier(parameters) {
  return 0.12 + (Number(parameters.risk_points || 0) % 7) * 0.025;
}

function previousCloseBandAnchor(previous, days, side, parameters, source) {
  if (!previous) return null;
  const range = averageRange(days) || Number(previous.range || 0);
  const distance = Math.max(0.25, range * atrBandMultiplier(parameters));
  return priceAnchor(side === "upper" ? Number(previous.close) + distance : Number(previous.close) - distance, source);
}

function previousExtensionAnchor(previous, side, parameters) {
  if (!previous) return null;
  const distance = Math.max(0.25, Number(previous.range || 0) * extensionMultiplier(parameters));
  return priceAnchor(side === "high" ? Number(previous.high) + distance : Number(previous.low) - distance, side === "high" ? "previous_day_extension_high" : "previous_day_extension_low");
}

function previousBodyExtensionAnchor(previous, side, parameters) {
  if (!previous) return null;
  const bodyHigh = Math.max(Number(previous.open), Number(previous.close));
  const bodyLow = Math.min(Number(previous.open), Number(previous.close));
  const distance = Math.max(0.25, Number(previous.range || 0) * extensionMultiplier(parameters) * 0.75);
  return priceAnchor(side === "high" ? bodyHigh + distance : bodyLow - distance, side === "high" ? "previous_body_extension_high" : "previous_body_extension_low");
}

function contractionMidAnchor({ previous, threeDays, day }) {
  if (previous && day?.dataset_stats && Number(previous.range || 0) <= Number(day.dataset_stats.range_p35 || 0)) {
    return priceAnchor((Number(previous.high) + Number(previous.low)) / 2, "contraction_previous_day_mid");
  }
  return rollingMidAnchor(threeDays, "fallback_rolling_3d_mid");
}

function openingVwapDislocationAnchor(day, side, parameters) {
  if (!day) return null;
  const opening = day.opening?.(parameters.opening_bars);
  const openingMid = rangeMidAnchor(opening, "opening_mid")?.level ?? Number(day.open);
  const base = Number.isFinite(Number(day.vwap)) ? Number(day.vwap) : Number(openingMid);
  const openingRange = Number(opening?.high || 0) - Number(opening?.low || 0);
  const distance = Math.max(0.25, (openingRange || Number(day.range || 0)) * deviationMultiplier(parameters) * 0.65);
  return priceAnchor(side === "upper" ? base + distance : base - distance, side === "upper" ? "opening_vwap_upper_dislocation" : "opening_vwap_lower_dislocation");
}

function volatilityExpansionAnchor({ previous, day, side }) {
  if (!previous) return null;
  const threshold = Number(day?.dataset_stats?.range_p65 || day?.dataset_stats?.range_p35 || 0);
  const isExpansion = threshold > 0 && Number(previous.range || 0) >= threshold;
  if (side === "high") {
    return priceAnchor(isExpansion ? previous.high : day?.dataset_stats?.range_p65_high ?? previous.high, isExpansion ? "volatility_expansion_previous_high" : "fallback_dataset_high_p65");
  }
  return priceAnchor(isExpansion ? previous.low : day?.dataset_stats?.range_p65_low ?? previous.low, isExpansion ? "volatility_expansion_previous_low" : "fallback_dataset_low_p35");
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
