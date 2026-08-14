export const MARKET_DERIVED_FEATURES_VERSION = "market_derived_features_v1";
export const VOLUME_PROFILE_PROXY_VERSION = "volume_profile_typical_price_bucket_v1";
export const RSI_WILDER_14_VERSION = "rsi_wilder_14_v1";
export const REALIZED_VOLATILITY_VERSION = "realized_volatility_close_return_v1";
export const DOWNSIDE_SEMIVARIANCE_VERSION = "downside_semivariance_close_return_v1";
export const ROLLING_RELATIONSHIP_VERSION = "rolling_correlation_beta_close_return_v1";

export function buildVolumeProfileLevels(rows = [], {
  tickSize = 0.25,
  valueAreaPercent = 0.7,
  digits = 4,
} = {}) {
  const buckets = new Map();
  for (const row of closedRows(rows)) {
    const volume = finite(row.volume, 0);
    const typical = typicalPrice(row);
    if (typical === null || volume <= 0) continue;
    const price = roundToTick(typical, tickSize);
    buckets.set(price, (buckets.get(price) || 0) + volume);
  }
  const levels = [...buckets.entries()]
    .map(([price, volume]) => ({ price: Number(price), volume }))
    .sort((left, right) => right.volume - left.volume || left.price - right.price);
  const totalVolume = levels.reduce((total, item) => total + item.volume, 0);
  if (!levels.length || totalVolume <= 0) return emptyProfile();

  const poc = levels[0].price;
  const selected = [];
  let selectedVolume = 0;
  for (const level of levels) {
    selected.push(level);
    selectedVolume += level.volume;
    if (selectedVolume >= totalVolume * valueAreaPercent) break;
  }
  const selectedPrices = selected.map((item) => item.price).sort((left, right) => left - right);
  return {
    schema_version: MARKET_DERIVED_FEATURES_VERSION,
    formula_version: VOLUME_PROFILE_PROXY_VERSION,
    approximation: "ohlcv_typical_price_volume_bucket",
    poc: round(poc, digits),
    vah: round(selectedPrices.at(-1), digits),
    val: round(selectedPrices[0], digits),
    value_area_percent: valueAreaPercent,
    total_volume: round(totalVolume, digits),
    bucket_count: levels.length,
  };
}

export function buildDevelopingVolumeProfile(rows = [], {
  cutoffUtc,
  tickSize = 0.25,
  valueAreaPercent = 0.7,
} = {}) {
  const cutoffMs = Date.parse(String(cutoffUtc || ""));
  const filtered = Number.isFinite(cutoffMs)
    ? rows.filter((row) => Date.parse(String(row.timestamp_utc || row.timestamp || "")) <= cutoffMs)
    : rows;
  const profile = buildVolumeProfileLevels(filtered, { tickSize, valueAreaPercent });
  return {
    ...profile,
    developing: true,
    cutoff_utc: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : null,
  };
}

export function rsiWilderSeries(rows = [], { period = 14, digits = 4 } = {}) {
  const closes = closedRows(rows).map((row) => finite(row.close)).filter((value) => value !== null);
  const output = Array.from({ length: closes.length }, () => null);
  if (closes.length <= period) return output;
  const gains = [];
  const losses = [];
  let averageGain = null;
  let averageLoss = null;
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    gains.push(gain);
    losses.push(loss);
    if (gains.length < period) continue;
    if (averageGain === null || averageLoss === null) {
      averageGain = average(gains.slice(0, period));
      averageLoss = average(losses.slice(0, period));
    } else {
      averageGain = ((averageGain * (period - 1)) + gain) / period;
      averageLoss = ((averageLoss * (period - 1)) + loss) / period;
    }
    output[index] = round(rsiFromAverages(averageGain, averageLoss), digits);
  }
  return output;
}

export function latestRsiWilder(rows = [], options = {}) {
  return lastNumeric(rsiWilderSeries(rows, options));
}

export function priorDayLevels(rows = [], { tradingDate } = {}) {
  const previousRows = closedRows(rows).filter((row) => tradingDay(row) < tradingDate);
  const latestDay = previousRows.map(tradingDay).filter(Boolean).sort().at(-1);
  return highLowClose(previousRows.filter((row) => tradingDay(row) === latestDay), { label: latestDay });
}

export function priorWeekLevels(rows = [], { tradingDate } = {}) {
  const cutoff = Date.parse(`${tradingDate}T00:00:00.000Z`);
  if (!Number.isFinite(cutoff)) return highLowClose([], { label: null });
  const weekStart = cutoff - 7 * 24 * 60 * 60_000;
  const previousWeekRows = closedRows(rows).filter((row) => {
    const value = Date.parse(String(row.timestamp_utc || row.timestamp || ""));
    return Number.isFinite(value) && value >= weekStart && value < cutoff;
  });
  return highLowClose(previousWeekRows, { label: "rolling_7d_before_trading_date" });
}

export function initialBalanceLevels(rows = [], { startUtc, minutes = 60 } = {}) {
  const startMs = Date.parse(String(startUtc || ""));
  const endMs = startMs + minutes * 60_000;
  const ibRows = closedRows(rows).filter((row) => {
    const value = Date.parse(String(row.timestamp_utc || row.timestamp || ""));
    return Number.isFinite(value) && value >= startMs && value < endMs;
  });
  return highLowClose(ibRows, { label: `${minutes}m` });
}

export function realizedVolatility(rows = [], { periods = 20, annualization = 1, digits = 6 } = {}) {
  const returns = closeReturns(rows).slice(-periods);
  if (!returns.length) return null;
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return round(Math.sqrt(variance) * Math.sqrt(annualization), digits);
}

export function downsideSemivariance(rows = [], { periods = 20, threshold = 0, digits = 8 } = {}) {
  const downside = closeReturns(rows).slice(-periods).filter((value) => value < threshold);
  if (!downside.length) return 0;
  return round(average(downside.map((value) => (value - threshold) ** 2)), digits);
}

export function rollingCorrelation(leftRows = [], rightRows = [], { periods = 20, digits = 6 } = {}) {
  const pairs = alignedReturns(leftRows, rightRows).slice(-periods);
  if (pairs.length < 2) return null;
  const left = pairs.map((item) => item.left);
  const right = pairs.map((item) => item.right);
  const covariance = average(left.map((value, index) => (value - average(left)) * (right[index] - average(right))));
  const deviation = standardDeviation(left) * standardDeviation(right);
  return deviation ? round(covariance / deviation, digits) : null;
}

export function rollingBeta(leftRows = [], benchmarkRows = [], { periods = 20, digits = 6 } = {}) {
  const pairs = alignedReturns(leftRows, benchmarkRows).slice(-periods);
  if (pairs.length < 2) return null;
  const left = pairs.map((item) => item.left);
  const benchmark = pairs.map((item) => item.right);
  const benchmarkMean = average(benchmark);
  const covariance = average(left.map((value, index) => (value - average(left)) * (benchmark[index] - benchmarkMean)));
  const variance = average(benchmark.map((value) => (value - benchmarkMean) ** 2));
  return variance ? round(covariance / variance, digits) : null;
}

function closedRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.is_closed !== false);
}

function emptyProfile() {
  return {
    schema_version: MARKET_DERIVED_FEATURES_VERSION,
    formula_version: VOLUME_PROFILE_PROXY_VERSION,
    approximation: "ohlcv_typical_price_volume_bucket",
    poc: null,
    vah: null,
    val: null,
    value_area_percent: null,
    total_volume: 0,
    bucket_count: 0,
  };
}

function typicalPrice(row) {
  const high = finite(row.high);
  const low = finite(row.low);
  const close = finite(row.close);
  return high === null || low === null || close === null ? null : (high + low + close) / 3;
}

function roundToTick(value, tickSize) {
  const tick = finite(tickSize, 0.25) || 0.25;
  return round(Math.round(value / tick) * tick, 8);
}

function closeReturns(rows = []) {
  const ordered = closedRows(rows);
  const returns = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = finite(ordered[index - 1].close);
    const current = finite(ordered[index].close);
    if (previous && current !== null) returns.push((current - previous) / previous);
  }
  return returns;
}

function alignedReturns(leftRows = [], rightRows = []) {
  const left = returnsByTimestamp(leftRows);
  const right = returnsByTimestamp(rightRows);
  return [...left.keys()]
    .filter((timestamp) => right.has(timestamp))
    .sort()
    .map((timestamp) => ({ timestamp, left: left.get(timestamp), right: right.get(timestamp) }));
}

function returnsByTimestamp(rows = []) {
  const ordered = closedRows(rows).sort((left, right) => String(left.timestamp_utc || left.timestamp).localeCompare(String(right.timestamp_utc || right.timestamp)));
  const map = new Map();
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = finite(ordered[index - 1].close);
    const current = finite(ordered[index].close);
    const timestamp = String(ordered[index].timestamp_utc || ordered[index].timestamp || "");
    if (previous && current !== null && timestamp) map.set(timestamp, (current - previous) / previous);
  }
  return map;
}

function highLowClose(rows = [], { label = null } = {}) {
  const valid = closedRows(rows);
  if (!valid.length) return { label, high: null, low: null, close: null, range_points: null, row_count: 0 };
  const highs = valid.map((row) => finite(row.high)).filter((value) => value !== null);
  const lows = valid.map((row) => finite(row.low)).filter((value) => value !== null);
  return {
    label,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    close: finite(valid.at(-1).close),
    range_points: highs.length && lows.length ? round(Math.max(...highs) - Math.min(...lows), 4) : null,
    row_count: valid.length,
  };
}

function tradingDay(row) {
  return String(row.trading_date || row.timestamp_paris || row.timestamp_utc || row.timestamp || "").slice(0, 10);
}

function rsiFromAverages(averageGain, averageLoss) {
  if (averageLoss === 0) return 100;
  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function average(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function standardDeviation(values = []) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function lastNumeric(values = []) {
  return [...values].reverse().find((value) => Number.isFinite(value)) ?? null;
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}
