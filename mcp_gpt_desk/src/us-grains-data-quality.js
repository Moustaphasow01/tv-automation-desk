export const US_GRAINS_DATA_QUALITY_VERSION = "us_grains_data_quality_v1";

const EXPECTED_RTH_M1_ROWS = 291;
const EXPECTED_RTH_M5_ROWS = 59;
const MIN_RTH_M1_ROWS = 250;
const MIN_RTH_M5_ROWS = 50;
const MAX_GAP_MINUTES_M1 = 3;
const MAX_GAP_MINUTES_M5 = 10;
const CHICAGO_TZ = "America/Chicago";
const RTH_START_MINUTE = 8 * 60 + 30;
const RTH_END_MINUTE = 13 * 60 + 20;
const dtfCache = new Map();

export function evaluateUsGrainsDataQuality(input = {}) {
  const instrument = upper(input.instrument || "ZW");
  const tradingDate = String(input.tradingDate || input.trading_date || "");
  const asOfUtc = iso(input.asOfUtc || input.as_of_utc || null);
  const m1 = qualityForTimeframe(input.m1Rows || input.m1_rows || [], "1", {
    ...timeframePolicy("1", asOfUtc),
    maxGapMinutes: MAX_GAP_MINUTES_M1,
  });
  const m5 = qualityForTimeframe(input.m5Rows || input.m5_rows || [], "5", {
    ...timeframePolicy("5", asOfUtc),
    maxGapMinutes: MAX_GAP_MINUTES_M5,
  });
  const issues = [
    ...m1.issues.map((code) => `M1_${code}`),
    ...m5.issues.map((code) => `M5_${code}`),
  ];
  return {
    schema_version: US_GRAINS_DATA_QUALITY_VERSION,
    instrument,
    trading_date: tradingDate || null,
    as_of_utc: asOfUtc,
    status: issues.some((code) => code.includes("BLOCKING")) ? "BLOCKED" : issues.length ? "DEGRADED" : "TRADEABLE",
    tradeable: !issues.some((code) => code.includes("BLOCKING")),
    issues,
    timeframes: { M1: m1, M5: m5 },
  };
}

function timeframePolicy(timeframe, asOfUtc) {
  const fullExpected = timeframe === "1" ? EXPECTED_RTH_M1_ROWS : EXPECTED_RTH_M5_ROWS;
  const fullMin = timeframe === "1" ? MIN_RTH_M1_ROWS : MIN_RTH_M5_ROWS;
  if (!asOfUtc) return { minRows: fullMin, expectedRows: fullExpected };
  const expectedRows = expectedRowsAtCutoff(asOfUtc, timeframe === "1" ? 1 : 5);
  const minRows = expectedRows >= fullExpected
    ? fullMin
    : Math.max(1, Math.floor(expectedRows * 0.85));
  return { minRows, expectedRows };
}

function expectedRowsAtCutoff(asOfUtc, stepMinutes) {
  const parts = zonedParts(asOfUtc);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute < RTH_START_MINUTE) return 0;
  const boundedMinute = Math.min(minute, RTH_END_MINUTE);
  return Math.floor((boundedMinute - RTH_START_MINUTE) / stepMinutes) + 1;
}

export function normalizeGrainRows(rows = []) {
  return array(rows)
    .map((row) => ({
      timestamp_utc: iso(row.timestamp_utc || row.timestampUtc || row.time || row.timestamp),
      open: finite(row.open),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close),
      volume: finite(row.volume, 0),
    }))
    .filter((row) => row.timestamp_utc && row.open > 0 && row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close))
    .sort((left, right) => Date.parse(left.timestamp_utc) - Date.parse(right.timestamp_utc));
}

export function grainChicagoDate(timestampUtc) {
  const parts = zonedParts(timestampUtc);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isGrainsRth(timestampUtc) {
  const parts = zonedParts(timestampUtc);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return isWeekday(parts.weekday) && minute >= RTH_START_MINUTE && minute <= RTH_END_MINUTE;
}

export function grainsTradingSessionState(timestampUtc) {
  const asOfUtc = iso(timestampUtc);
  if (!asOfUtc) throw new Error("invalid_grains_session_timestamp");
  const parts = zonedParts(asOfUtc);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = isWeekday(parts.weekday);
  const open = weekday && minute >= RTH_START_MINUTE && minute <= RTH_END_MINUTE;
  const state = open
    ? "OPEN"
    : !weekday
      ? "WEEKEND_CLOSED"
      : minute < RTH_START_MINUTE
        ? "PREOPEN"
        : "POSTCLOSE";
  const reason = state === "PREOPEN" && parts.weekday === "Mon"
    ? "cbot_grains_monday_preopen"
    : `cbot_grains_${state.toLowerCase()}`;
  return {
    market_profile: "cbot_us_grains_rth",
    active_session: open ? "CBOT_GRAINS_RTH" : state === "PREOPEN" ? "CBOT_GRAINS_PREOPEN" : "CBOT_GRAINS_CLOSED",
    exchange_timezone: CHICAGO_TZ,
    timestamp_utc: asOfUtc,
    trading_date: grainChicagoDate(asOfUtc),
    weekday: parts.weekday,
    market_closed: !open,
    state,
    reason,
    next_eligible_at_utc: open ? asOfUtc : nextGrainsRthOpen(asOfUtc),
  };
}

export function grainsRuntimeEvaluationDisposition({ timestampUtc, hasSignal = false } = {}) {
  const session = grainsTradingSessionState(timestampUtc);
  if (session.state !== "OPEN") {
    return {
      session,
      status: "WAITING_SESSION",
      next_evaluation_at_utc: session.next_eligible_at_utc,
      reason_codes: ["US_GRAINS_RUNTIME_EVALUATED", "WAITING_FOR_CBOT_RTH"],
    };
  }
  return {
    session,
    status: hasSignal ? "SIGNAL_CREATED" : "NO_SIGNAL",
    next_evaluation_at_utc: new Date(Date.parse(session.timestamp_utc) + 60_000).toISOString(),
    reason_codes: hasSignal
      ? ["US_GRAINS_RUNTIME_EVALUATED", "SIGNAL_CREATED"]
      : ["US_GRAINS_RUNTIME_EVALUATED", "NO_ACTIONABLE_SIGNAL"],
  };
}

function qualityForTimeframe(rows, timeframe, policy) {
  const rthRows = normalizeGrainRows(rows).filter((row) => isGrainsRth(row.timestamp_utc));
  const gaps = gapCount(rthRows, timeframe === "1" ? 1 : 5, policy.maxGapMinutes);
  const volumeSum = rthRows.reduce((sum, row) => sum + Math.max(0, finite(row.volume, 0)), 0);
  const range = priceRange(rthRows);
  const issues = [
    ...(rthRows.length < policy.minRows ? ["ROW_COUNT_BLOCKING"] : []),
    ...(volumeSum <= 0 ? ["VOLUME_ZERO_BLOCKING"] : []),
    ...(range !== null && range <= 0 ? ["RANGE_ZERO_BLOCKING"] : []),
    ...(gaps > 0 ? ["GAPS_DEGRADED"] : []),
  ];
  return {
    timeframe,
    row_count: rthRows.length,
    expected_row_count: policy.expectedRows,
    coverage_ratio: round(policy.expectedRows ? rthRows.length / policy.expectedRows : null, 4),
    volume_sum: round(volumeSum, 4),
    volume_state: volumeSum > 0 ? "KNOWN" : "ZERO_VOLUME",
    range_points: range,
    gap_count: gaps,
    status: issues.some((code) => code.includes("BLOCKING")) ? "BLOCKED" : issues.length ? "DEGRADED" : "READY",
    issues,
  };
}

function gapCount(rows, expectedStepMinutes, maxGapMinutes) {
  let count = 0;
  const values = normalizeGrainRows(rows);
  for (let index = 1; index < values.length; index += 1) {
    const deltaMinutes = (Date.parse(values[index].timestamp_utc) - Date.parse(values[index - 1].timestamp_utc)) / 60_000;
    if (deltaMinutes > Math.max(maxGapMinutes, expectedStepMinutes * 1.5)) count += 1;
  }
  return count;
}

function priceRange(rows) {
  const values = normalizeGrainRows(rows);
  if (!values.length) return null;
  return round(Math.max(...values.map((row) => row.high)) - Math.min(...values.map((row) => row.low)), 4);
}

function zonedParts(timestampUtc) {
  if (!dtfCache.has(CHICAGO_TZ)) {
    dtfCache.set(CHICAGO_TZ, new Intl.DateTimeFormat("en-CA", {
      timeZone: CHICAGO_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }));
  }
  const parts = {};
  for (const item of dtfCache.get(CHICAGO_TZ).formatToParts(new Date(timestampUtc))) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }
  return parts;
}

function nextGrainsRthOpen(timestampUtc) {
  const startMs = Date.parse(timestampUtc);
  const rounded = startMs - (startMs % 60_000);
  for (let offset = 60_000; offset <= 8 * 24 * 60 * 60_000; offset += 60_000) {
    const candidate = new Date(rounded + offset).toISOString();
    const parts = zonedParts(candidate);
    if (isWeekday(parts.weekday)
      && Number(parts.hour) * 60 + Number(parts.minute) === RTH_START_MINUTE) return candidate;
  }
  return null;
}

function isWeekday(value) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(String(value || ""));
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
