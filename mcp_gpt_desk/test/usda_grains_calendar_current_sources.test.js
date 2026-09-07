import assert from "node:assert/strict";
import test from "node:test";
import {
  collectUsdaGrainsCalendar,
  fetchUsdaSourceText,
} from "../src/adapters/usda-grains-calendar-collector.js";
import { buildUsdaGrainsCalendarSources } from
  "../src/adapters/usda-grains-calendar-sources.js";

const RECEIPT = "2026-09-07T07:00:00.000Z";
const WINDOW_END = "2026-09-21T07:00:00.000Z";

test("current official descriptors are year-aware and explicitly scoped", () => {
  const sources = sourcesFor2026();
  assert.deepEqual(sources.map(({ sourceId }) => sourceId), [
    "usda_nass_release_calendar",
    "usda_wasde_release_schedule",
    "usda_fas_export_sales_schedule",
  ]);
  assert.equal(sources[0].url,
    "https://www.nass.usda.gov/Publications/Calendar/2026/NassReleases2026.ics");
  assert.equal(sources[2].url, "https://fas.usda.gov/data/scheduled-reports");
  assert.deepEqual(sources[1].scope.instruments, ["ZC", "ZW"]);
  assert.ok(Object.isFrozen(sources));
  assert.throws(() => buildUsdaGrainsCalendarSources({
    asOfUtc: RECEIPT,
    coverageStart: RECEIPT,
    coverageEnd: "2027-01-02T00:00:00Z",
  }), /CROSS_YEAR/);
});

test("three parsed official schedule formats prove a current 14-day window", async () => {
  const documents = currentDocuments();
  const result = await collectUsdaGrainsCalendar({
    sources: sourcesFor2026(),
    retrievedAtUtc: RECEIPT,
    coverageStart: RECEIPT,
    coverageEnd: WINDOW_END,
    fetchText: async (_url, source) => documents[source.sourceKind],
  });
  assert.equal(result.agriCalendarCoverage[0].status, "AVAILABLE");
  assert.equal(result.manifests.every((item) =>
    item.calendar_evidence_status === "CALENDAR_SCHEDULE"), true);
  assert.equal(result.manifests.every((item) => item.source_document.length > 0), true);
  assert.equal(result.manifests.every((item) =>
    item.coverage.instruments.join() === "ZC,ZW"), true);
  assert.ok(result.agriEvents.some((item) =>
    item.provider === "USDA_FAS"
      && item.event_timestamp_utc === "2026-09-11T12:30:00.000Z"));
  assert.ok(result.agriEvents.some((item) =>
    item.provider === "USDA_WAOB"
      && item.event_timestamp_utc === "2026-09-11T16:00:00.000Z"));
  assert.equal(result.calendarVersion.knownAtUtc, RECEIPT);
});

test("FAS embedded iCalendar proves the holiday-shifted Friday, not a weekday rule", async () => {
  const sources = sourcesFor2026();
  const fas = sources[2];
  const result = await collectUsdaGrainsCalendar({
    sources: [fas],
    retrievedAtUtc: RECEIPT,
    coverageStart: RECEIPT,
    coverageEnd: "2026-09-12T00:00:00Z",
    fetchText: async () => fasHtml(["20260911T123000Z", "20260917T123000Z"]),
  });
  assert.deepEqual(result.agriEvents.map((item) => item.event_timestamp_utc), [
    "2026-09-11T12:30:00.000Z",
    "2026-09-17T12:30:00.000Z",
  ]);
  assert.equal(result.manifests[0].coverage.start_utc, RECEIPT);
});

test("stale or incomplete official-looking schedules fail closed", async () => {
  const sources = sourcesFor2026();
  await assert.rejects(() => collectUsdaGrainsCalendar({
    sources: [sources[2]],
    retrievedAtUtc: RECEIPT,
    fetchText: async () => fasHtml(["20250911T123000Z"]),
  }), /FAS_SCHEDULE_YEAR_INVALID/);
  await assert.rejects(() => collectUsdaGrainsCalendar({
    sources: [sources[1]],
    retrievedAtUtc: RECEIPT,
    fetchText: async () => wasdeHtml("Jan. 12, Feb. 10"),
  }), /ANNUAL_SCHEDULE_INCOMPLETE/);
});

test("generic source fetch bounds redirects and response size", async () => {
  let calls = 0;
  const redirected = await fetchUsdaSourceText(
    "https://example.test/start",
    async (url, options) => {
      assert.equal(options.redirect, "manual");
      calls += 1;
      return url.endsWith("start")
        ? new Response(null, { status: 302, headers: { location: "/final" } })
        : new Response("official schedule", {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
    },
  );
  assert.equal(redirected, "official schedule");
  assert.equal(calls, 2);
  await assert.rejects(() => fetchUsdaSourceText(
    "https://example.test/large",
    async () => new Response("x", {
      headers: { "content-type": "text/html", "content-length": "2097153" },
    }),
  ), /DOCUMENT_TOO_LARGE/);
  await assert.rejects(() => fetchUsdaSourceText(
    "https://example.test/start",
    async () => new Response(null, {
      status: 302, headers: { location: "https://attacker.test/final" },
    }),
  ), /REDIRECT_FORBIDDEN/);
});

function sourcesFor2026() {
  return buildUsdaGrainsCalendarSources({
    asOfUtc: RECEIPT,
    coverageStart: RECEIPT,
    coverageEnd: WINDOW_END,
  });
}

function currentDocuments() {
  return {
    NASS_ICS: [
      "BEGIN:VCALENDAR",
      icsEvent("20260112T120000", "Grain Stocks", "jan"),
      icsEvent("20260911T120000", "Crop Production", "sep"),
      icsEvent("20261231T120000", "Grain Stocks", "dec"),
      "END:VCALENDAR",
    ].join("\n"),
    WASDE_HTML: wasdeHtml(
      "Jan. 12, Feb. 10, Mar. 10, Apr. 9, May 12, Jun. 11, "
      + "Jul. 10, Aug. 12, Sep. 11, Oct. 9, Nov. 10, and Dec. 10.",
    ),
    FAS_SCHEDULE_HTML: fasHtml([
      "20260911T123000Z", "20260917T123000Z", "20260924T123000Z",
    ]),
  };
}

function icsEvent(stamp, title, uid) {
  return `BEGIN:VEVENT\nDTSTART:${stamp}\nSUMMARY:${title}\nUID:${uid}\nEND:VEVENT`;
}

function wasdeHtml(dates) {
  return `<html><h5>2026 WASDE Release Dates (12:00pm ET)</h5><p>`
    + `<strong>In 2026 the WASDE report will be released on ${dates}</strong>`
    + "</p></html>";
}

function fasHtml(stamps) {
  return `<html><h1>Report Release Calendar</h1><p>All times in ET.</p>${stamps
    .map((stamp) => `<article><a href="data:text/calendar;charset=utf8,`
      + `BEGIN:VCALENDAR%0D%0ABEGIN:VEVENT%0D%0ADTSTART:${stamp}`
      + '%0D%0ASUMMARY:Weekly Export Sales%0D%0AEND:VEVENT%0D%0AEND:VCALENDAR">'
      + "iCalendar</a><h3>Weekly Export Sales</h3></article>")
    .join("")}</html>`;
}
