import {
  chicagoDate,
  chicagoMinute,
  grainFinite as finite,
  grainRound as round,
  isGrainStrategyRth as isRth,
  normalizeGrainStrategyEvents as normalizeAgriEvents,
  normalizeGrainStrategyRows as normalizeRows,
} from "./us-grains-strategy-input.js";

const DEFAULT_TICK_SIZE = 0.25;
const RTH_START_MINUTE = 8 * 60 + 30;
const RTH_END_MINUTE = 13 * 60 + 20;

function compareRows(left, right) {
  return Date.parse(left.timestamp_utc) - Date.parse(right.timestamp_utc);
}

export function groupRthRowsByChicagoDate(rows = []) {
  const groups = {};
  for (const row of normalizeRows(rows)) {
    if (!isRth(row.timestamp_utc)) continue;
    const day = chicagoDate(row.timestamp_utc);
    groups[day] ||= [];
    groups[day].push(row);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([day, values]) => [
      day,
      values.sort(compareRows),
    ]),
  );
}

export function previousRthDayRows(groups, tradingDate) {
  const previous = Object.keys(groups)
    .filter((day) => day < tradingDate)
    .sort()
    .at(-1);
  return previous ? groups[previous] : [];
}

export function dataQualityForDay(rows = []) {
  const valid = normalizeRows(rows);
  const volumeSum = valid.reduce(
    (sum, row) => sum + Math.max(0, finite(row.volume, 0)),
    0,
  );
  const highs = valid.map((row) => row.high);
  const lows = valid.map((row) => row.low);
  return {
    row_count: valid.length,
    volume_sum: round(volumeSum, 4),
    volume_state: volumeSum > 0 ? "KNOWN" : "ZERO_VOLUME",
    range_points: highs.length
      ? round(Math.max(...highs) - Math.min(...lows), 4)
      : null,
  };
}

export function buildGrainRelativeContext({
  config,
  rows = [],
  contextRowsBySymbol = {},
}) {
  const own = sessionReturn(rows);
  const zc = sessionReturn(
    contextRowsBySymbol["ZC1!:5"] || contextRowsBySymbol["ZC1!:1"] || [],
  );
  const zw = sessionReturn(
    contextRowsBySymbol["ZW1!:5"] || contextRowsBySymbol["ZW1!:1"] || [],
  );
  const peer = config.symbol === "ZW1!" ? zc : zw;
  return {
    schema_version: "us_grains_relative_context_v1",
    own_return_points: own,
    peer_return_points: peer,
    peer_available: Number.isFinite(peer),
  };
}

export function grainContextAdjustment(context = {}, direction) {
  const reasons = [];
  let confidenceDelta = 0;
  let blocked = false;
  const own = finite(context.own_return_points);
  const peer = finite(context.peer_return_points);
  if (direction === "LONG") {
    if (own !== null && own > 0) {
      confidenceDelta += 0.04;
      reasons.push("OWN_SESSION_BIAS_LONG");
    }
    if (peer !== null && peer >= -0.5) {
      confidenceDelta += 0.03;
      reasons.push("GRAIN_COMPLEX_NOT_FIGHTING_LONG");
    }
    if (peer !== null && peer < -3) {
      confidenceDelta -= 0.08;
      reasons.push("GRAIN_COMPLEX_HEADWIND_LONG");
    }
  }
  if (direction === "SHORT") {
    if (own !== null && own < 0) {
      confidenceDelta += 0.04;
      reasons.push("OWN_SESSION_BIAS_SHORT");
    }
    if (peer !== null && peer <= 0.5) {
      confidenceDelta += 0.03;
      reasons.push("GRAIN_COMPLEX_NOT_FIGHTING_SHORT");
    }
    if (peer !== null && peer > 3) {
      confidenceDelta -= 0.08;
      reasons.push("GRAIN_COMPLEX_HEADWIND_SHORT");
    }
  }
  return {
    blocked,
    confidenceDelta,
    reasonCodes: reasons.length ? reasons : ["GRAIN_COMPLEX_CONTEXT_PARTIAL"],
    alignment: blocked
      ? "REJECT"
      : confidenceDelta >= 0.05
        ? "ALIGNED"
        : confidenceDelta < 0
          ? "PARTIAL"
          : "NEUTRAL",
  };
}

export function highLowClose(rows = []) {
  const valid = normalizeRows(rows);
  if (!valid.length)
    return {
      high: null,
      low: null,
      close: null,
      range_points: null,
      row_count: 0,
    };
  const highs = valid.map((row) => row.high);
  const lows = valid.map((row) => row.low);
  return {
    high: round(Math.max(...highs), 4),
    low: round(Math.min(...lows), 4),
    close: round(valid.at(-1).close, 4),
    range_points: round(Math.max(...highs) - Math.min(...lows), 4),
    row_count: valid.length,
  };
}

export function atrSeries(rows = [], { period = 14 } = {}) {
  const values = normalizeRows(rows);
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const previousClose = values[index - 1]?.close ?? row.close;
    const tr = Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose),
    );
    const slice = [
      ...output.map((item) => item.tr).filter(Number.isFinite),
      tr,
    ].slice(-period);
    output.push({
      tr,
      atr: slice.reduce((sum, item) => sum + item, 0) / slice.length,
    });
  }
  return output.map((item) => item.atr);
}

export function sessionVwap(rows = []) {
  let pv = 0;
  let volume = 0;
  let typicalSum = 0;
  let count = 0;
  for (const row of normalizeRows(rows)) {
    const typical = (row.high + row.low + row.close) / 3;
    const vol = finite(row.volume, 0);
    if (vol > 0) {
      pv += typical * vol;
      volume += vol;
    }
    typicalSum += typical;
    count += 1;
  }
  if (volume > 0) return pv / volume;
  return count ? typicalSum / count : null;
}

export function isInReportBlackout(timestampUtc, events = [], minutes = 30) {
  const ts = Date.parse(timestampUtc);
  const windowMs = minutes * 60_000;
  return normalizeAgriEvents(events).some((event) => {
    const eventMs = Date.parse(event.event_timestamp_utc);
    if (!Number.isFinite(eventMs)) return false;
    if (!["HIGH", "CRITICAL"].includes(event.importance)) return false;
    return Math.abs(eventMs - ts) <= windowMs;
  });
}

export function validRiskDistance(value, config) {
  return (
    Number.isFinite(value) &&
    value >= config.minStopDistance &&
    value <= config.maxStopDistance
  );
}

export function dedupeNearbyCandidates(candidates = [], minutes = 30) {
  const result = [];
  let lastByDirection = {};
  for (const candidate of candidates.sort(
    (left, right) =>
      Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc),
  )) {
    const direction = candidate.direction;
    const lastMs = lastByDirection[direction] || 0;
    const currentMs = Date.parse(candidate.generated_at_utc);
    if (currentMs - lastMs < minutes * 60_000) continue;
    result.push(candidate);
    lastByDirection[direction] = currentMs;
  }
  return result;
}

export function sessionReturn(rows = []) {
  const valid = normalizeRows(rows).filter((row) => isRth(row.timestamp_utc));
  if (valid.length < 2) return null;
  return round(valid.at(-1).close - valid[0].open, 4);
}

export function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  return round(Math.round(value / tickSize) * tickSize, 4);
}
