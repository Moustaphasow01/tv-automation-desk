import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  MacroCalendarService,
  normalizeMacroCalendarEvents,
  normalizeForexFactoryActualObservations,
  parseForexFactoryCalendarIcs,
  parseForexFactoryCalendarHtml,
} from "../src/macro-calendar-service.js";
import { loadFrontDailyMacroSource } from "../src/front-session-projection.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const COLLECTIONS = DESK_COLLECTIONS;
const nowUtc = "2026-07-26T12:00:00.000Z";
const clock = new FixedClock(Date.parse(nowUtc));

test("macro calendar normalization converts provider instants to Europe/Paris deterministically", () => {
  const events = normalizeMacroCalendarEvents([{
    title: "German ifo Business Climate",
    country: "EUR",
    date: "2026-07-27T04:00:00-04:00",
    impact: "Medium",
    forecast: "86.1",
    previous: "85.6",
  }], { nowUtc });

  assert.equal(events.length, 1);
  assert.equal(events[0].date, "2026-07-27");
  assert.equal(events[0].time_paris, "10:00");
  assert.equal(events[0].timestamp_utc, "2026-07-27T08:00:00.000Z");
  assert.equal(events[0].impact, "MEDIUM");
  assert.equal(events[0].event_id, "2026-07-27__10:00__German_ifo_Business_Climate");
});

test("Forex Factory calendar HTML exposes published actuals with an absolute event timestamp", () => {
  const html = forexFactoryHtml([{
    id: 150835,
    name: "BRC Shop Price Index y/y",
    dateline: 1785193260,
    currency: "GBP",
    actual: "0.9%",
    forecast: "1.1%",
    previous: "1.2%",
    actualBetterWorse: 2,
  }]);

  const parsed = parseForexFactoryCalendarHtml(html);
  const observations = normalizeForexFactoryActualObservations(parsed, {
    fetchedAtUtc: "2026-07-28T00:05:00.000Z",
  });

  assert.equal(parsed.length, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].event_id, "2026-07-28__01:01__BRC_Shop_Price_Index_y_y");
  assert.equal(observations[0].timestamp_utc, "2026-07-27T23:01:00.000Z");
  assert.equal(observations[0].actual, "0.9%");
  assert.equal(observations[0].actual_source, "forex_factory_calendar");
  assert.equal(observations[0].actual_source_event_id, "150835");
});

test("Forex Factory ICS export exposes occurrence IDs without requiring the blocked calendar page", () => {
  const events = parseForexFactoryCalendarIcs(forexFactoryIcs());

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "150835");
  assert.equal(events[0].name, "BRC Shop Price Index y/y");
  assert.equal(events[0].currency, "GBP");
  assert.equal(events[0].timestamp_utc, "2026-07-27T23:01:00.000Z");
});

test("calendar refresh enriches the schedule with Forex Factory actuals and first-observation time", async () => {
  const persistence = new InMemoryDeskPersistence();
  const actualClock = new FixedClock(Date.parse("2026-07-28T00:05:00.000Z"));
  const fetchImpl = async (url) => {
    if (String(url).endsWith("ff_calendar_thisweek.ics")) {
      return {
        ok: true,
        text: async () => forexFactoryIcs(),
      };
    }
    if (String(url).includes("/calendar/150835.json")) {
      return {
        ok: true,
        json: async () => ({
          event_id: 150835,
          dateline: 1785193260,
          actual: "0.9%",
          forecast: "1.1%",
          previous: "1.2%",
        }),
      };
    }
    return {
      ok: true,
      json: async () => [{
        title: "BRC Shop Price Index y/y",
        country: "GBP",
        date: "2026-07-27T19:01:00-04:00",
        impact: "Low",
        forecast: "1.1%",
        previous: "1.2%",
        actual: null,
      }],
    };
  };
  const service = new MacroCalendarService({
    persistence,
    clock: actualClock,
    fetchImpl,
  });

  const result = await service.refresh({
    anchor_date: "2026-07-28",
    requested_by: "test",
    force: true,
  });
  const event = persistence.peek(
    COLLECTIONS.macroCalendarEvents,
    "2026-07-28__01:01__BRC_Shop_Price_Index_y_y",
  );

  assert.equal(result.actual_source.status, "READY");
  assert.equal(result.actual_source.actuals_received, 1);
  assert.equal(result.actual_source.actuals_matched, 1);
  assert.equal(event.actual, "0.9%");
  assert.equal(event.actual_source, "forex_factory_calendar");
  assert.equal(event.actual_published_at_utc, "2026-07-28T00:05:00.000Z");
  assert.equal(event.actual_available_at_utc, "2026-07-28T00:05:00.000Z");
  assert.equal(event.actual_last_observed_at_utc, "2026-07-28T00:05:00.000Z");
});

test("Forex Factory actual enrichment continues when the weekly schedule endpoint is throttled", async () => {
  const eventId = "2026-07-28__01:01__BRC_Shop_Price_Index_y_y";
  const persistence = new InMemoryDeskPersistence({
    documents: {
      [COLLECTIONS.macroCalendarEvents]: {
        [eventId]: {
          event_id: eventId,
          date: "2026-07-28",
          time_paris: "01:01",
          timestamp_utc: "2026-07-27T23:01:00.000Z",
          timestamp_paris: "2026-07-28T01:01:00.000+02:00",
          title: "BRC Shop Price Index y/y",
          currency: "GBP",
          impact: "LOW",
          active: true,
        },
      },
    },
  });
  const fetchImpl = async (url) => {
    if (String(url).endsWith("ff_calendar_thisweek.ics")) {
      return { ok: true, text: async () => forexFactoryIcs() };
    }
    if (String(url).includes("/calendar/150835.json")) {
      return {
        ok: true,
        json: async () => ({ event_id: 150835, dateline: 1785193260, actual: "0.9%" }),
      };
    }
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const service = new MacroCalendarService({
    persistence,
    clock: new FixedClock(Date.parse("2026-07-28T00:05:00.000Z")),
    fetchImpl,
  });

  const result = await service.refresh({ anchor_date: "2026-07-28", force: true });

  assert.equal(result.status, "FETCH_FAILED");
  assert.equal(result.actual_source.status, "READY");
  assert.equal(result.actual_source.actuals_matched, 1);
  assert.equal(persistence.peek(COLLECTIONS.macroCalendarEvents, eventId).actual, "0.9%");
});

test("a Forex Factory event without a numeric endpoint is unavailable rather than degraded", async () => {
  const speechIcs = forexFactoryIcs({
    uid: "151379",
    summary: "⁎ US President Speaks",
    start: "20260727T145000",
  });
  const fetchImpl = async (url) => {
    if (String(url).endsWith(".ics")) return { ok: true, text: async () => speechIcs };
    if (String(url).includes("/calendar/151379.json")) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      json: async () => [{
        title: "President Speaks",
        country: "USD",
        date: "2026-07-27T14:50:00-04:00",
        impact: "Medium",
      }],
    };
  };
  const service = new MacroCalendarService({
    persistence: new InMemoryDeskPersistence(),
    clock: new FixedClock(Date.parse("2026-07-27T19:00:00.000Z")),
    fetchImpl,
  });

  const result = await service.refresh({ anchor_date: "2026-07-27", force: true });

  assert.equal(result.actual_source.status, "READY");
  assert.equal(result.actual_source.events_unavailable, 1);
  assert.equal(result.actual_source.events_failed, 0);
});

test("autonomous refresh is idempotent, preserves observed actuals and validates the next session", async () => {
  const persistence = new InMemoryDeskPersistence({
    documents: {
      [COLLECTIONS.macroCalendarEvents]: {
        friday: {
          event_id: "friday",
          date: "2026-07-24",
          timestamp_utc: "2026-07-24T12:00:00.000Z",
          impact: "HIGH",
          active: true,
        },
      },
    },
  });
  let providerActual = "2.8%";
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [{
      title: "Core Durable Goods Orders m/m",
      country: "USD",
      date: "2026-07-27T08:30:00-04:00",
      impact: "High",
      forecast: "0.3%",
      previous: "0.5%",
      actual: providerActual,
    }],
  });
  const service = new MacroCalendarService({ persistence, clock, fetchImpl });

  const first = await service.refresh({ anchor_date: "2026-07-26", requested_by: "test" });
  assert.equal(first.status, "READY");
  assert.equal(first.coverage.next_trading_date_ready, true);
  assert.deepEqual(first.coverage.missing_required_dates, []);
  assert.equal(persistence.count(COLLECTIONS.macroCalendarEvents), 2);

  providerActual = "";
  const second = await service.refresh({ anchor_date: "2026-07-26", requested_by: "test", force: true });
  assert.equal(second.status, "READY");
  assert.equal(persistence.count(COLLECTIONS.macroCalendarEvents), 2);

  const monday = persistence.peek(
    COLLECTIONS.macroCalendarEvents,
    "2026-07-27__14:30__Core_Durable_Goods_Orders_m_m",
  );
  assert.equal(monday.actual, "2.8%");
  assert.equal(monday.actual_published_at_utc, nowUtc);
  assert.equal(persistence.peek(COLLECTIONS.macroNewsState, "current").status, "READY");
});

test("calendar source failures persist a degraded state and an actionable alert", async () => {
  const persistence = new InMemoryDeskPersistence();
  const service = new MacroCalendarService({
    persistence,
    clock,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });

  const result = await service.refresh({ anchor_date: "2026-07-26" });
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal(result.ok, false);
  assert.equal(persistence.peek(COLLECTIONS.macroNewsState, "current").stale, true);
  const alert = persistence.peek(COLLECTIONS.deskAlerts, "macro_calendar_coverage__2026-07-27");
  assert.equal(alert.status, "OPEN");
  assert.equal(alert.level, "critical");
});

test("daily PostgreSQL calendar query is date-filtered beyond the former 500-row ceiling and cutoff-safe", async () => {
  const documents = {};
  for (let index = 0; index < 600; index += 1) {
    documents[`old-${String(index).padStart(3, "0")}`] = {
      event_id: `old-${index}`,
      date: "2026-06-01",
      timestamp_utc: "2026-06-01T08:00:00.000Z",
      impact: "HIGH",
    };
  }
  documents.target = {
    event_id: "target",
    date: "2026-07-24",
    timestamp_utc: "2026-07-24T12:00:00.000Z",
    timestamp_paris: "2026-07-24T14:00:00+02:00",
    impact: "HIGH",
    title: "US CPI",
    actual: "2.7%",
    actual_published_at_utc: "2026-07-24T12:05:00.000Z",
  };
  const persistence = new InMemoryDeskPersistence({
    documents: { [COLLECTIONS.macroCalendarEvents]: documents },
  });
  const service = new MacroCalendarService({
    persistence,
    clock,
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  });

  const result = await service.getDailyCalendar({
    date: "2026-07-24",
    as_of_utc: "2026-07-24T12:00:00.000Z",
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event_id, "target");
  assert.equal(result.events[0].actual, null);
  assert.equal(result.events[0].actual_hidden_reason, "published_after_cutoff_or_unknown");
});

test("front macro loader prefers the current PostgreSQL calendar in live mode", async () => {
  const event = {
    event_id: "macro-1",
    date: "2026-07-27",
    timestamp_utc: "2026-07-27T12:30:00.000Z",
    impact: "HIGH",
    title: "US Durable Goods",
  };
  let packReads = 0;
  const store = {
    getMacroCalendar: async () => {
      packReads += 1;
      throw new Error("desk_packs_document_not_found:2026-07-27_asia_open");
    },
    getFrontDailyMacroCalendar: async () => ({
      ok: true,
      date: "2026-07-27",
      source: "macro_calendar_events",
      events: [event],
    }),
  };

  const result = await loadFrontDailyMacroSource(store, {
    date: "2026-07-27",
    mode: "live",
    as_of_utc: nowUtc,
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.source, "macro_calendar_events");
  assert.equal(packReads, 0);
});

test("rolling front window keeps past and future macro events across a weekend", async () => {
  const persistence = new InMemoryDeskPersistence({
    documents: {
      [COLLECTIONS.macroCalendarEvents]: {
        friday: {
          event_id: "friday",
          date: "2026-07-24",
          timestamp_utc: "2026-07-24T16:00:00.000Z",
          timestamp_paris: "2026-07-24T18:00:00+02:00",
          impact: "HIGH",
          title: "US Friday release",
        },
        monday: {
          event_id: "monday",
          date: "2026-07-27",
          timestamp_utc: "2026-07-27T08:00:00.000Z",
          timestamp_paris: "2026-07-27T10:00:00+02:00",
          impact: "LOW",
          title: "Monday business climate",
        },
        outside: {
          event_id: "outside",
          date: "2026-07-29",
          timestamp_utc: "2026-07-29T12:00:00.000Z",
          impact: "HIGH",
          title: "Outside rolling window",
        },
      },
    },
  });
  const service = new MacroCalendarService({
    persistence,
    clock,
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  });

  const result = await service.getWindowCalendar({
    date: "2026-07-26",
    as_of_utc: nowUtc,
    before_hours: 48,
    after_hours: 48,
  });
  assert.deepEqual(result.events.map((event) => event.event_id), ["friday", "monday"]);
  assert.equal(result.window.before_hours, 48);
  assert.equal(result.window.after_hours, 48);
});

function forexFactoryHtml(events) {
  return `<html><script>window.calendarComponent = {days: ${JSON.stringify([{
    date: "Tue <span>Jul 28</span>",
    dateline: 1785189600,
    events,
  }])}, timezone: "Europe/Paris"};</script></html>`;
}

function forexFactoryIcs({
  uid = "150835",
  summary = "⁎ UK BRC Shop Price Index y/y",
  start = "20260727T190100",
} = {}) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260727T234215Z",
    `SUMMARY:${summary}`,
    `DTSTART;TZID=America/New_York:${start}`,
    `DTEND;TZID=America/New_York:${start}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
