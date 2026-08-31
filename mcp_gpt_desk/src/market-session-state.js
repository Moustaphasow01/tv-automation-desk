import { toParisIso } from "@tv-automation/desk-time";

const CME_DAILY_MAINTENANCE_START_MINUTES = 17 * 60;
const CME_DAILY_MAINTENANCE_END_MINUTES = 18 * 60;
const CME_WEEKLY_OPEN_MINUTES = 18 * 60;
const CME_WEEKLY_CLOSE_MINUTES = 17 * 60;
const DEFAULT_OPEN_MARKET_FRESHNESS_SECONDS = 15 * 60;
const CME_DAILY_MAINTENANCE_FRESHNESS_SECONDS = 2 * 60 * 60;
const CME_WEEKEND_FRESHNESS_SECONDS = 74 * 60 * 60;
const CBOT_GRAINS_DAILY_CLOSED_FRESHNESS_SECONDS = 24 * 60 * 60;

export function parisMarketSessionState(now = new Date()) {
  const epochMs = normalizeEpochMs(now);
  if (!Number.isFinite(epochMs)) throw new Error("invalid_market_session_timestamp");
  const timestampParis = toParisIso(epochMs);
  const tradingDate = timestampParis.slice(0, 10);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(new Date(epochMs));
  const cme = cmeEquityFuturesSessionState(epochMs);
  const marketClosed = cme.market_closed;
  return {
    timestamp_paris: timestampParis,
    timestamp_new_york: cme.timestamp_new_york,
    trading_date: tradingDate,
    weekday,
    new_york_weekday: cme.weekday,
    market_closed: marketClosed,
    state: cme.state,
    reason: cme.reason,
    market_profile: cme.market_profile,
    next_transition_hint: cme.next_transition_hint,
  };
}

export function cmeEquityFuturesSessionState(now = new Date()) {
  const epochMs = normalizeEpochMs(now);
  if (!Number.isFinite(epochMs)) throw new Error("invalid_market_session_timestamp");
  const parts = timeZoneParts(epochMs, "America/New_York");
  const minutes = parts.hour * 60 + parts.minute;
  const day = weekdayIndex(parts.weekday);
  const dailyMaintenance = day >= 1
    && day <= 4
    && minutes >= CME_DAILY_MAINTENANCE_START_MINUTES
    && minutes < CME_DAILY_MAINTENANCE_END_MINUTES;
  const weeklyClosed = day === 6
    || (day === 0 && minutes < CME_WEEKLY_OPEN_MINUTES)
    || (day === 5 && minutes >= CME_WEEKLY_CLOSE_MINUTES);
  const marketClosed = dailyMaintenance || weeklyClosed;
  const reason = dailyMaintenance
    ? "cme_daily_maintenance_break"
    : weeklyClosed
      ? "cme_weekend_closed"
      : "inside_cme_globex_session";
  return {
    market_profile: "cme_equity_index_futures_globex",
    timestamp_new_york: `${parts.date}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`,
    date: parts.date,
    weekday: parts.weekday,
    minutes,
    market_closed: marketClosed,
    state: dailyMaintenance ? "maintenance_break" : marketClosed ? "market_closed" : "trading_day",
    reason,
    next_transition_hint: nextCmeTransitionHint({ day, minutes, reason }),
  };
}

export function marketDataFreshnessPolicyForSession(session = {}) {
  const reason = String(session.reason || "");
  if (["cbot_grains_weekend_closed", "cbot_grains_monday_preopen"].includes(reason)) {
    return {
      max_age_seconds: CME_WEEKEND_FRESHNESS_SECONDS,
      reason,
    };
  }
  if (["cbot_grains_preopen", "cbot_grains_postclose"].includes(reason)) {
    return {
      max_age_seconds: CBOT_GRAINS_DAILY_CLOSED_FRESHNESS_SECONDS,
      reason,
    };
  }
  if (reason === "cme_daily_maintenance_break") {
    return {
      max_age_seconds: CME_DAILY_MAINTENANCE_FRESHNESS_SECONDS,
      reason,
    };
  }
  if (reason === "cme_weekend_closed") {
    return {
      max_age_seconds: CME_WEEKEND_FRESHNESS_SECONDS,
      reason,
    };
  }
  return {
    max_age_seconds: DEFAULT_OPEN_MARKET_FRESHNESS_SECONDS,
    reason: reason || "inside_cme_globex_session",
  };
}

function timeZoneParts(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
    second: Number(values.second || 0),
  };
}

function weekdayIndex(weekday) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(weekday || ""));
}

function nextCmeTransitionHint({ day, minutes, reason }) {
  if (reason === "cme_daily_maintenance_break") return "reopens_at_18_00_new_york";
  if (reason === "cme_weekend_closed" && day === 0) return "weekly_open_at_18_00_new_york";
  if (reason === "cme_weekend_closed") return "weekly_open_sunday_18_00_new_york";
  if (day >= 1 && day <= 4 && minutes < CME_DAILY_MAINTENANCE_START_MINUTES) {
    return "daily_maintenance_at_17_00_new_york";
  }
  if (day === 5 && minutes < CME_WEEKLY_CLOSE_MINUTES) return "weekly_close_at_17_00_new_york";
  return "session_open";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(String(value));
}
