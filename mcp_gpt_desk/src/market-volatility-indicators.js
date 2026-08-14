export const MARKET_VOLATILITY_INDICATORS_VERSION = "market_volatility_indicators_v1";
export const WILDER_ATR_14_VERSION = "wilder_atr_14_v1";
export const AVERAGE_RANGE_LEGACY_VERSION = "average_high_low_range_v1";

export function trueRange(row, previousClose = null) {
  const high = finite(row?.high);
  const low = finite(row?.low);
  if (high === null || low === null) return null;
  const highLow = high - low;
  const previous = finite(previousClose);
  if (previous === null) return round(highLow);
  return round(Math.max(highLow, Math.abs(high - previous), Math.abs(low - previous)));
}

export function wilderAtrSeries(rows = [], { period = 14, digits = 4 } = {}) {
  const ordered = Array.isArray(rows) ? rows : [];
  const output = Array.from({ length: ordered.length }, () => null);
  if (ordered.length <= period) return output;
  let averageTrueRange = null;
  const trueRanges = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const value = trueRange(ordered[index], ordered[index - 1]?.close);
    if (value === null) continue;
    trueRanges.push(value);
    if (averageTrueRange === null && trueRanges.length >= period) {
      averageTrueRange = average(trueRanges.slice(0, period));
    } else if (index > period && averageTrueRange !== null) {
      averageTrueRange = ((averageTrueRange * (period - 1)) + value) / period;
    }
    if (averageTrueRange !== null) output[index] = round(averageTrueRange, digits);
  }
  return output;
}

export function wilderAtr(rows = [], { period = 14, digits = 4 } = {}) {
  const values = wilderAtrSeries(rows, { period, digits }).filter((value) => value !== null);
  return values.length ? values[values.length - 1] : null;
}

export function recentAverageRange(rows = [], count = 14, { digits = 4 } = {}) {
  const ranges = (Array.isArray(rows) ? rows : [])
    .slice(-count)
    .map((row) => {
      const high = finite(row?.high);
      const low = finite(row?.low);
      return high === null || low === null ? null : high - low;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  return ranges.length ? round(average(ranges), digits) : 0;
}

export function buildVolatilityIndicators(rows = [], { atrPeriod = 14, averageRangeCount = 20 } = {}) {
  const averageRange14 = recentAverageRange(rows, 14);
  const averageRangeRecent = recentAverageRange(rows, averageRangeCount);
  const atr14 = wilderAtr(rows, { period: atrPeriod });
  return Object.freeze({
    schema_version: MARKET_VOLATILITY_INDICATORS_VERSION,
    atr_14: atr14,
    atr_14_version: WILDER_ATR_14_VERSION,
    average_range_14: averageRange14,
    average_range_recent: averageRangeRecent,
    average_range_legacy_version: AVERAGE_RANGE_LEGACY_VERSION,
    volatility_reference_points: atr14 ?? averageRange14,
    volatility_reference_source: atr14 === null ? "average_range_legacy_fallback" : "wilder_atr_14",
  });
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}
