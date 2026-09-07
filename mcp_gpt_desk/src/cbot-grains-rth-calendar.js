import { chicagoPartsAtUtc } from "./us-grains-chicago-time.js";

export const CBOT_GRAINS_RTH_CALENDAR_VERSION =
  "cbot_grains_rth_calendar_v1";

const CHICAGO_TZ = "America/Chicago";
const RTH_START_MINUTE = 8 * 60 + 30;
const RTH_END_MINUTE = 13 * 60 + 20;
const HOLIDAY_FRESHNESS_SECONDS = 96 * 60 * 60;
const OPEN_FRESHNESS_SECONDS = 20 * 60;
const WEEKEND_FRESHNESS_SECONDS = 74 * 60 * 60;
const DAILY_CLOSED_FRESHNESS_SECONDS = 24 * 60 * 60;

const RTH_EXCEPTIONS = Object.freeze({
  "2026-09-07": Object.freeze({
    state: "HOLIDAY",
    reason: "cbot_grains_labor_day_2026_closed",
    nextOpenUtc: "2026-09-08T13:30:00.000Z",
    lastExpectedMarketDate: "2026-09-04",
    lastExpectedCoreClosesUtc: Object.freeze({
      "1": "2026-09-04T18:20:00.000Z",
      "5": "2026-09-04T18:20:00.000Z",
    }),
    qualification: Object.freeze({
      status: "QUALIFIED_RTH_ONLY",
      evidence: Object.freeze([
        "https://www.cmegroup.com/trading-hours.html",
        "https://www.cmegroup.com/trading/agricultural/files/grain-and-oilseed-futures-options-fact-card.pdf",
      ]),
      limitation:
        "authenticated_product_globex_holiday_rows_not_obtained",
    }),
  }),
});

const REOPEN_GRACE_BY_DATE = Object.freeze({
  "2026-09-08": Object.freeze({
    startsAtUtc: "2026-09-08T13:30:00.000Z",
    endsAtUtc: "2026-09-08T13:55:00.000Z",
    lastExpectedMarketDate: "2026-09-04",
    lastExpectedCoreClosesUtc: Object.freeze({
      "1": "2026-09-04T18:20:00.000Z",
      "5": "2026-09-04T18:20:00.000Z",
    }),
    reason: "first_required_m5_close_plus_open_feed_tolerance",
  }),
});

export function cbotGrainsRthSessionState(timestampUtc) {
  const asOfUtc = iso(timestampUtc);
  if (!asOfUtc) throw new Error("invalid_grains_session_timestamp");
  const parts = chicagoPartsAtUtc(asOfUtc);
  const tradingDate = chicagoDate(parts);
  const exception = RTH_EXCEPTIONS[tradingDate] || null;
  if (exception) return holidayState({ asOfUtc, parts, tradingDate, exception });
  return regularState({ asOfUtc, parts, tradingDate });
}

export function cbotGrainsFreshnessPolicy(session = {}) {
  const reason = String(session.reason || "");
  if (reason === "cbot_grains_labor_day_2026_closed") {
    return { max_age_seconds: HOLIDAY_FRESHNESS_SECONDS, reason };
  }
  if (reason === "cbot_grains_post_holiday_preopen") {
    return { max_age_seconds: HOLIDAY_FRESHNESS_SECONDS, reason };
  }
  if (["cbot_grains_weekend_closed", "cbot_grains_monday_preopen"].includes(reason)) {
    return { max_age_seconds: WEEKEND_FRESHNESS_SECONDS, reason };
  }
  if (["cbot_grains_preopen", "cbot_grains_postclose"].includes(reason)) {
    return { max_age_seconds: DAILY_CLOSED_FRESHNESS_SECONDS, reason };
  }
  if (reason === "cbot_grains_open") {
    return { max_age_seconds: OPEN_FRESHNESS_SECONDS, reason };
  }
  return null;
}

function regularState({ asOfUtc, parts, tradingDate }) {
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = isWeekday(parts.weekday);
  const open =
    weekday && minute >= RTH_START_MINUTE && minute < RTH_END_MINUTE;
  const state = sessionState({ weekday, minute, open });
  const reopenGrace = reopenGraceAt(asOfUtc, tradingDate);
  const reopenPlan = REOPEN_GRACE_BY_DATE[tradingDate] || null;
  const reason = reopenPlan && state === "PREOPEN"
    ? "cbot_grains_post_holiday_preopen"
    : sessionReason(state, parts.weekday);
  return sessionProjection({
    asOfUtc,
    parts,
    tradingDate,
    open,
    state,
    reason,
    nextOpenUtc: open ? asOfUtc : nextRthOpen(asOfUtc),
    qualification: null,
    reopenGrace,
    lastExpectedMarketDate:
      state === "PREOPEN" && reopenPlan ? reopenPlan.lastExpectedMarketDate : null,
    lastExpectedCoreClosesUtc:
      state === "PREOPEN" && reopenPlan
        ? reopenPlan.lastExpectedCoreClosesUtc
        : null,
  });
}

function holidayState({ asOfUtc, parts, tradingDate, exception }) {
  return sessionProjection({
    asOfUtc,
    parts,
    tradingDate,
    open: false,
    state: exception.state,
    reason: exception.reason,
    nextOpenUtc: exception.nextOpenUtc,
    qualification: exception.qualification,
    reopenGrace: null,
    lastExpectedMarketDate: exception.lastExpectedMarketDate,
    lastExpectedCoreClosesUtc: exception.lastExpectedCoreClosesUtc,
  });
}

function sessionProjection(input) {
  return {
    market_profile: "cbot_us_grains_rth",
    active_session: activeSession(input.state, input.open),
    exchange_timezone: CHICAGO_TZ,
    timestamp_utc: input.asOfUtc,
    trading_date: input.tradingDate,
    weekday: input.parts.weekday,
    market_closed: !input.open,
    state: input.state,
    reason: input.reason,
    next_eligible_at_utc: input.nextOpenUtc,
    calendar_version: CBOT_GRAINS_RTH_CALENDAR_VERSION,
    calendar_qualification: input.qualification,
    reopen_data_grace_until_utc: input.reopenGrace?.endsAtUtc || null,
    reopen_data_grace_active: Boolean(input.reopenGrace),
    last_expected_market_date: input.lastExpectedMarketDate || null,
    last_expected_core_close_utc_by_timeframe:
      input.lastExpectedCoreClosesUtc || null,
  };
}

function sessionState({ weekday, minute, open }) {
  if (open) return "OPEN";
  if (!weekday) return "WEEKEND_CLOSED";
  return minute < RTH_START_MINUTE ? "PREOPEN" : "POSTCLOSE";
}

function sessionReason(state, weekday) {
  if (state === "PREOPEN" && weekday === "Mon") {
    return "cbot_grains_monday_preopen";
  }
  return `cbot_grains_${state.toLowerCase()}`;
}

function activeSession(state, open) {
  if (open) return "CBOT_GRAINS_RTH";
  if (state === "PREOPEN") return "CBOT_GRAINS_PREOPEN";
  if (state === "HOLIDAY") return "CBOT_GRAINS_HOLIDAY";
  return "CBOT_GRAINS_CLOSED";
}

function reopenGraceAt(asOfUtc, tradingDate) {
  const grace = REOPEN_GRACE_BY_DATE[tradingDate] || null;
  if (!grace) return null;
  const at = Date.parse(asOfUtc);
  return at >= Date.parse(grace.startsAtUtc) && at < Date.parse(grace.endsAtUtc)
    ? grace
    : null;
}

function nextRthOpen(timestampUtc) {
  const startMs = Date.parse(timestampUtc);
  const rounded = startMs - (startMs % 60_000);
  for (let offset = 60_000; offset <= 8 * 24 * 60 * 60_000; offset += 60_000) {
    const candidate = new Date(rounded + offset).toISOString();
    const parts = chicagoPartsAtUtc(candidate);
    if (RTH_EXCEPTIONS[chicagoDate(parts)]) continue;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (isWeekday(parts.weekday) && minute === RTH_START_MINUTE) return candidate;
  }
  return null;
}

function chicagoDate(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isWeekday(value) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(String(value || ""));
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
